const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

const {
  loadEvidence,
  saveEvidence,
  requireEvidenceCheckpointForWrites,
  attachPublicPilotReadFacts,
  sanitizeErrorText,
  extractCandidateParams,
  gatherAttemptedDeploymentHashes,
  getLatestAttemptedDeploymentHash,
  gatherCandidateContractAddresses,
  recordFailure,
  verifyTxFinalizedAndSuccessful,
  verifyRoundMatchesIntent,
  verifyProposalMatchesIntent,
  executeNegativeWithdrawalTest,
  checkCandidateDeploymentSafety,
  resolveDeploymentContractAddress,
  readDeployedContractCode,
  hashDeploymentSourceFromTransaction,
  verifyAndRecordDeploymentReadback,
  runStudioHealthMonitor,
  evaluateStage1RecoveryDecision,
  executeStage1RecoveryStep,
  fetchAllRoundProposalSummaries,
  matchesFullProposalIntent,
  correlateNominatedProposalId,
  correlateResumeProposalId,
  executeDurableStageWrite,
  getDurableWriteHash,
  requireExplicitMessageFee,
  isDefinitiveContractReadNotFound,
  planDurableStageResume,
  runStage2ReadOnlyReconciliation,
  diagnoseStage2StudioReads,
  assertNominationWindowOpen,
  assertNominationWindowOpenOnChain,
  TransactionHashVariant,
  EXPECTED_ROUND_ID,
} = require('./run_charterflow_pilot');

async function runTests() {
  console.log('================================================================');
  console.log('       RUNNING CHARTERFLOW PILOT-RUNNER SAFETY CHECKS           ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    process.stdout.write(`[TEST ${total}] ${name}... `);
    try {
      const res = fn();
      if (res && typeof res.then === 'function') {
        return res
          .then(() => {
            console.log('PASSED');
            passed++;
          })
          .catch(err => {
            console.log('FAILED');
            console.error('  Error:', err.message);
            process.exitCode = 1;
          });
      } else {
        console.log('PASSED');
        passed++;
      }
    } catch (err) {
      console.log('FAILED');
      console.error('  Error:', err.message);
      process.exitCode = 1;
    }
  }

  await test('Durable stage intent blocks an automatic resend after broadcast-then-throw', async () => {
    const evidence = { stages: {} };
    const tempFile = path.join(__dirname, `.durable-write-test-${process.pid}.json`);
    let submitCalls = 0;
    const invoke = () => executeDurableStageWrite({
      evidence,
      stageName: 'createRound',
      request: { functionName: 'create_round', value: 1000n },
      feeEstimate: { feeValue: 10n },
      senderAddress: '0x0000000000000000000000000000000000000001',
      senderNonce: 4n,
      filePath: tempFile,
      submit: async () => {
        submitCalls++;
        throw new Error('transport closed after request may have been accepted');
      },
    });
    try {
      await assert.rejects(invoke, /transport closed/);
      assert.strictEqual(submitCalls, 1);
      assert.strictEqual(evidence.stages.createRound.writeIntent.status, 'OUTCOME_UNCERTAIN');
      assert.strictEqual(evidence.stages.createRound.writeIntent.txHash, null);
      await assert.rejects(invoke, /UNRESOLVED_STAGE_WRITE/);
      assert.strictEqual(submitCalls, 1, 'uncertain write must never be automatically resent');
      const persisted = JSON.parse(fs.readFileSync(tempFile, 'utf8'));
      assert.strictEqual(persisted.stages.createRound.writeIntent.status, 'OUTCOME_UNCERTAIN');
    } finally {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
  });

  await test('Durable stage intent saves a returned transaction hash for read-only resume', async () => {
    const txHash = `0x${'ab'.repeat(32)}`;
    const evidence = { stages: {} };
    let submitCalls = 0;
    const result = await executeDurableStageWrite({
      evidence,
      stageName: 'nominate',
      request: { functionName: 'nominate_proposal' },
      feeEstimate: { feeValue: 10n },
      senderAddress: '0x0000000000000000000000000000000000000002',
      senderNonce: 2n,
      saveEvidenceOption: false,
      submit: async () => { submitCalls++; return txHash; },
    });
    assert.strictEqual(result, txHash);
    assert.strictEqual(submitCalls, 1);
    assert.strictEqual(getDurableWriteHash(evidence.stages.nominate), txHash);
    assert.strictEqual(evidence.stages.nominate.writeIntent.status, 'SUBMITTED');
    await assert.rejects(() => executeDurableStageWrite({
      evidence,
      stageName: 'nominate',
      request: {},
      feeEstimate: { feeValue: 10n },
      submit: async () => { submitCalls++; return txHash; },
      saveEvidenceOption: false,
    }), /WRITE_ALREADY_RECORDED/);
    assert.strictEqual(submitCalls, 1);
  });

  test('Native payout requires an explicit positive network message-fee estimate', () => {
    assert.strictEqual(requireExplicitMessageFee({ distribution: { totalMessageFees: 7n } }, 'withdraw'), 7n);
    assert.throws(() => requireExplicitMessageFee({ feeValue: 9n }, 'withdraw'), /does not expose/);
    assert.throws(() => requireExplicitMessageFee({ distribution: { totalMessageFees: 0n } }, 'withdraw'), /not established/);
  });

  test('Round preflight treats only the exact contract not-found error as absence', () => {
    assert.strictEqual(
      isDefinitiveContractReadNotFound(new Error('UserError: ERR_ROUND_NOT_FOUND'), 'ERR_ROUND_NOT_FOUND'),
      true
    );
    assert.strictEqual(
      isDefinitiveContractReadNotFound(
        new Error("Can't reconnect until invalid transaction is rolled back"),
        'ERR_ROUND_NOT_FOUND'
      ),
      false,
      'database/RPC errors must halt and must never be interpreted as an absent round'
    );
  });

  await test('Stage 2 reconciliation reuses the saved hash and makes zero create_round/deploy calls', async () => {
    const txHash = `0x${'14'.repeat(32)}`;
    const contractAddress = '0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21';
    const creator = '0x6201f71e4501ad61ee6c7d92eb41a47e85dae066';
    const committee = [
      '0xf8cf75561dfdfebeb8928f3cfbf46d8051e5e8ff',
      '0x37ab01d9804f688e53df77ff5d5553890857e428',
    ];
    const intent = {
      roundId: 'rnd-pilot-354517',
      title: 'Pilot Grant Round',
      description: 'A controlled live pilot on Studio Next testing governance and payments.',
      charterText: 'x'.repeat(120),
      committee,
      grantCapWei: '1000000000000000000',
      depositWei: '1000000000000000000',
      creatorAddress: creator,
      durationSec: 3600,
    };
    const evidence = {
      contractAddress,
      stages: {
        deploy: { contractAddress },
        createRound: {
          intendedRound: intent,
          txHash,
          writeIntent: {
            status: 'FINALIZED_SUCCESS_READBACK_UNCERTAIN',
            txHash,
            senderNonce: '1',
            request: { args: [intent.roundId, intent.title, intent.description, intent.charterText, committee, intent.grantCapWei, '1791916554', '3600', '1792109354'] },
            readbackStatus: 'INCONCLUSIVE_RPC_DATABASE_ERROR',
            readbackError: '-32603 prior observation',
          },
        },
      },
    };
    const round = {
      round_id: intent.roundId,
      creator,
      title: intent.title,
      description: intent.description,
      charter_text: intent.charterText,
      committee_roster: committee,
      initial_deposit: intent.depositWei,
      grant_cap_wei: intent.grantCapWei,
      nomination_cutoff: 1791916554,
      voting_duration: 3600,
      round_end: 1792109354,
      available_wei: intent.depositWei,
      reserved_wei: '0',
      approved_credits_wei: '0',
      creator_claimable_wei: '0',
      payouts_emitted_wei: '0',
      refunds_emitted_wei: '0',
      proposal_nonce: 0,
      state: 'ACTIVE',
    };
    let writeCalls = 0;
    const client = {
      getTransaction: async () => ({ hash: txHash, statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', from_address: creator, value: intent.depositWei, nonce: 1 }),
      readContract: async ({ functionName }) => {
        if (functionName === 'get_round') return round;
        if (functionName === 'get_round_ids_count') return 1n;
        if (functionName === 'get_round_ids') return [intent.roundId];
        throw new Error(`unexpected read ${functionName}`);
      },
      getBalance: async () => 1000000000000000000n,
      writeContract: async () => { writeCalls++; throw new Error('must not write'); },
      deployContract: async () => { writeCalls++; throw new Error('must not deploy'); },
    };
    const tempFile = path.join(__dirname, `.stage2-reconcile-test-${process.pid}.json`);
    try {
      const plan = planDurableStageResume(evidence.stages.createRound, 'createRound');
      assert.deepStrictEqual(plan, { action: 'RECONCILE_EXISTING', txHash });
      const result = await runStage2ReadOnlyReconciliation(client, evidence, { maxAttempts: 1, intervalMs: 0, filePath: tempFile });
      assert.strictEqual(result.status, 'VERIFIED');
      assert.strictEqual(writeCalls, 0);
      assert.strictEqual(evidence.stages.createRound.writeIntent.readbackStatus, 'VERIFIED');
      assert.strictEqual(evidence.stages.createRound.readbackHistory[0].readbackStatus, 'INCONCLUSIVE_RPC_DATABASE_ERROR');
    } finally {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
  });

  await test('Stage 2 diagnostic continues after get_round failure and makes zero write calls', async () => {
    const txHash = '0x1476320746c0efda5f97d2db6256c571c6da7adff7c494af33031bf9adfb0bdc';
    const contractAddress = '0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21';
    const creator = '0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066';
    const committee = [
      '0xf8cf75561dfdfebeb8928f3cfbf46d8051e5e8ff',
      '0x37ab01d9804f688e53df77ff5d5553890857e428',
    ];
    const intent = {
      roundId: 'rnd-pilot-354517',
      title: 'Pilot Grant Round',
      description: 'A controlled live pilot on Studio Next testing governance and payments.',
      charterText: 'x'.repeat(120),
      committee,
      grantCapWei: '1000000000000000000',
      depositWei: '1000000000000000000',
      creatorAddress: creator,
      durationSec: 3600,
    };
    const evidence = {
      contractAddress,
      stages: {
        deploy: { contractAddress },
        createRound: {
          intendedRound: intent,
          txHash,
          writeIntent: {
            status: 'FINALIZED_SUCCESS_READBACK_UNCERTAIN',
            txHash,
            senderNonce: '1',
            request: { args: [intent.roundId, intent.title, intent.description, intent.charterText, committee, intent.grantCapWei, '1791916554', '3600', '1792109354'] },
            readbackStatus: 'INCONCLUSIVE_RPC_DATABASE_ERROR',
            readbackError: '-32603 prior observation',
          },
        },
      },
      stage2ReconciliationHistory: [
        { observedAt: '2026-10-14T02:17:57.367Z', status: 'INCONCLUSIVE_OR_MISMATCH', error: 'prior get_round rollback' },
      ],
    };
    const rpcMethods = [];
    let writeCalls = 0;
    const reads = [];
    const rollback = Object.assign(new Error("Can't reconnect until invalid transaction is rolled back. Please rollback() fully before proceeding."), { code: -32603 });
    const client = {
      request: async ({ method, params }) => {
        rpcMethods.push(method);
        if (method === 'eth_sendRawTransaction' || method === 'sim_call') {
          throw new Error('test request must not issue writes');
        }
        if (method === 'gen_call' && params?.[0]?.type === 'write') {
          throw new Error('test request must not issue write gen_call');
        }
        throw new Error(`unexpected raw request ${method}`);
      },
      getTransaction: async () => ({
        hash: txHash,
        statusName: 'FINALIZED',
        txExecutionResultName: 'FINISHED_WITH_RETURN',
        from_address: creator,
        value: intent.depositWei,
        nonce: 1,
      }),
      readContract: async ({ functionName }) => {
        reads.push(functionName);
        if (functionName === 'get_round') throw rollback;
        if (functionName === 'get_round_ids_count') return 1n;
        if (functionName === 'get_round_ids') return [intent.roundId];
        if (functionName === 'get_all_proposal_ids_count') return 0n;
        throw new Error(`unexpected read ${functionName}`);
      },
      getBalance: async () => 1000000000000000000n,
      getTransactionCount: async ({ blockTag }) => (blockTag === 'pending' ? 2n : 2n),
      writeContract: async () => { writeCalls++; throw new Error('must not write'); },
      deployContract: async () => { writeCalls++; throw new Error('must not deploy'); },
      sendRawTransaction: async () => { writeCalls++; throw new Error('must not send raw'); },
      simulateWriteContract: async () => { writeCalls++; throw new Error('must not simulate write'); },
    };
    const tempFile = path.join(__dirname, `.stage2-diag-test-${process.pid}.json`);
    try {
      const result = await diagnoseStage2StudioReads(client, evidence, {
        maxAttempts: 1,
        filePath: tempFile,
        updateSupportDraft: false,
      });
      assert.strictEqual(result.verdict, 'INCONCLUSIVE');
      assert.notStrictEqual(result.status, 'VERIFIED');
      assert.strictEqual(result.failureClass, 'get_round_specific');
      assert.strictEqual(writeCalls, 0);
      assert.strictEqual(result.writeCalls, 0);
      assert.deepStrictEqual(reads, ['get_round', 'get_round_ids_count', 'get_round_ids']);
      assert.ok(result.calls.some(call => call.label === 'transaction' && call.ok));
      assert.ok(result.calls.some(call => call.label === 'get_round' && call.ok === false && call.jsonRpcCode === -32603));
      assert.ok(result.calls.some(call => call.label === 'get_round_ids_count' && call.ok));
      assert.ok(result.calls.some(call => call.label === 'get_round_ids' && call.ok));
      assert.ok(result.calls.some(call => call.label === 'contract_balance' && call.ok));
      assert.ok(result.calls.some(call => call.label === 'creator_latest_nonce' && call.ok));
      assert.ok(result.calls.some(call => call.label === 'creator_pending_nonce' && call.ok));
      assert.ok(!reads.includes('get_all_proposal_ids_count'), 'extra view is unnecessary when another contract view succeeds');
      assert.ok(!rpcMethods.includes('eth_sendRawTransaction'));
      assert.ok(!rpcMethods.includes('sim_call'));
      assert.strictEqual(evidence.stages.createRound.writeIntent.readbackStatus, 'INCONCLUSIVE_RPC_DATABASE_ERROR');
      assert.strictEqual(evidence.stage2ReconciliationHistory[0].status, 'INCONCLUSIVE_OR_MISMATCH');
      assert.strictEqual(evidence.stage2ReconciliationHistory.length, 2);
      await assert.rejects(
        () => client.writeContract({ functionName: 'create_round' }),
        /refused client write method/
      );
      assert.strictEqual(writeCalls, 0, 'diagnostic wrapper must not invoke the original write implementation');
    } finally {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
  });

  await test('Stage 2 diagnostic extra view runs when every contract view fails and still never writes', async () => {
    const txHash = '0x1476320746c0efda5f97d2db6256c571c6da7adff7c494af33031bf9adfb0bdc';
    const contractAddress = '0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21';
    const creator = '0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066';
    const evidence = {
      contractAddress,
      stages: {
        deploy: { contractAddress },
        createRound: {
          intendedRound: {
            roundId: 'rnd-pilot-354517',
            creatorAddress: creator,
            committee: [],
            grantCapWei: '1',
            depositWei: '1',
            durationSec: 1,
          },
          txHash,
          writeIntent: { status: 'FINALIZED_SUCCESS_READBACK_UNCERTAIN', txHash, senderNonce: '1', request: { args: [] } },
        },
      },
    };
    const reads = [];
    let writeCalls = 0;
    const rollback = Object.assign(new Error("Can't reconnect until invalid transaction is rolled back"), { code: -32603 });
    const client = {
      getTransaction: async () => ({ hash: txHash, statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', from_address: creator, value: 1, nonce: 1 }),
      readContract: async ({ functionName }) => {
        reads.push(functionName);
        throw rollback;
      },
      getBalance: async () => 1n,
      getTransactionCount: async () => 2n,
      writeContract: async () => { writeCalls++; return '0xwrite'; },
    };
    const tempFile = path.join(__dirname, `.stage2-diag-views-${process.pid}.json`);
    try {
      const result = await diagnoseStage2StudioReads(client, evidence, {
        filePath: tempFile,
        updateSupportDraft: false,
      });
      assert.strictEqual(result.verdict, 'INCONCLUSIVE');
      assert.strictEqual(result.failureClass, 'all_contract_views');
      assert.deepStrictEqual(reads, ['get_round', 'get_round_ids_count', 'get_round_ids', 'get_all_proposal_ids_count']);
      assert.strictEqual(writeCalls, 0);
      assert.strictEqual(result.writeCalls, 0);
    } finally {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
  });

  await test('Stage 2 diagnostic verifies only after a complete matching read set and still makes zero writes', async () => {
    const txHash = `0x${'14'.repeat(32)}`;
    const contractAddress = '0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21';
    const creator = '0x6201f71e4501ad61ee6c7d92eb41a47e85dae066';
    const committee = [
      '0xf8cf75561dfdfebeb8928f3cfbf46d8051e5e8ff',
      '0x37ab01d9804f688e53df77ff5d5553890857e428',
    ];
    const intent = {
      roundId: 'rnd-pilot-354517',
      title: 'Pilot Grant Round',
      description: 'A controlled live pilot on Studio Next testing governance and payments.',
      charterText: 'x'.repeat(120),
      committee,
      grantCapWei: '1000000000000000000',
      depositWei: '1000000000000000000',
      creatorAddress: creator,
      durationSec: 3600,
    };
    const evidence = {
      contractAddress,
      stages: {
        deploy: { contractAddress },
        createRound: {
          intendedRound: intent,
          txHash,
          writeIntent: {
            status: 'FINALIZED_SUCCESS_READBACK_UNCERTAIN',
            txHash,
            senderNonce: '1',
            request: { args: [intent.roundId, intent.title, intent.description, intent.charterText, committee, intent.grantCapWei, '1791916554', '3600', '1792109354'] },
            readbackStatus: 'INCONCLUSIVE_RPC_DATABASE_ERROR',
            readbackError: '-32603 prior observation',
          },
        },
      },
      stage2ReconciliationHistory: [
        { observedAt: '2026-10-14T02:17:57.367Z', status: 'INCONCLUSIVE_OR_MISMATCH' },
      ],
    };
    const round = {
      round_id: intent.roundId,
      creator,
      title: intent.title,
      description: intent.description,
      charter_text: intent.charterText,
      committee_roster: committee,
      initial_deposit: intent.depositWei,
      grant_cap_wei: intent.grantCapWei,
      nomination_cutoff: 1791916554,
      voting_duration: 3600,
      round_end: 1792109354,
      available_wei: intent.depositWei,
      reserved_wei: '0',
      approved_credits_wei: '0',
      creator_claimable_wei: '0',
      payouts_emitted_wei: '0',
      refunds_emitted_wei: '0',
      proposal_nonce: 0,
      state: 'ACTIVE',
    };
    let writeCalls = 0;
    const client = {
      getTransaction: async () => ({ hash: txHash, statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', from_address: creator, value: intent.depositWei, nonce: 1 }),
      readContract: async ({ functionName }) => {
        if (functionName === 'get_round') return round;
        if (functionName === 'get_round_ids_count') return 1n;
        if (functionName === 'get_round_ids') return [intent.roundId];
        throw new Error(`unexpected read ${functionName}`);
      },
      getBalance: async () => 1000000000000000000n,
      getTransactionCount: async () => 2n,
      writeContract: async () => { writeCalls++; throw new Error('must not write'); },
    };
    const tempFile = path.join(__dirname, `.stage2-diag-ok-${process.pid}.json`);
    try {
      const result = await diagnoseStage2StudioReads(client, evidence, {
        filePath: tempFile,
        updateSupportDraft: false,
      });
      assert.strictEqual(result.verdict, 'VERIFIED');
      assert.strictEqual(writeCalls, 0);
      assert.strictEqual(result.writeCalls, 0);
      assert.strictEqual(evidence.stages.createRound.writeIntent.readbackStatus, 'VERIFIED');
      assert.strictEqual(evidence.stage2ReconciliationHistory[0].status, 'INCONCLUSIVE_OR_MISMATCH');
    } finally {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
  });

  await test('Stage 2 diagnostic passes TransactionHashVariant.LATEST_FINAL to contract views and never writes', async () => {
    assert.strictEqual(TransactionHashVariant.LATEST_FINAL, 'latest-final');
    const txHash = '0x1476320746c0efda5f97d2db6256c571c6da7adff7c494af33031bf9adfb0bdc';
    const contractAddress = '0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21';
    const creator = '0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066';
    const evidence = {
      contractAddress,
      stages: {
        deploy: { contractAddress },
        createRound: {
          intendedRound: { roundId: 'rnd-pilot-354517', creatorAddress: creator, committee: [], grantCapWei: '1', depositWei: '1', durationSec: 1 },
          txHash,
          writeIntent: { status: 'FINALIZED_SUCCESS_READBACK_UNCERTAIN', txHash, senderNonce: '1', request: { args: [] } },
        },
      },
    };
    const variants = [];
    let writeCalls = 0;
    const client = {
      getTransaction: async () => ({ hash: txHash, statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', from_address: creator, value: 1, nonce: 1 }),
      readContract: async ({ functionName, transactionHashVariant }) => {
        variants.push({ functionName, transactionHashVariant });
        if (functionName === 'get_round_ids_count' || functionName === 'get_all_proposal_ids_count') return 0n;
        if (functionName === 'get_round_ids') return [];
        throw Object.assign(new Error('ERR_ROUND_NOT_FOUND'), { code: -32000 });
      },
      getBalance: async () => 1n,
      getTransactionCount: async () => 2n,
      writeContract: async () => { writeCalls++; return '0xwrite'; },
    };
    const tempFile = path.join(__dirname, `.stage2-diag-final-${process.pid}.json`);
    try {
      const result = await diagnoseStage2StudioReads(client, evidence, {
        filePath: tempFile,
        updateSupportDraft: false,
        transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
        includeExtraView: true,
      });
      assert.strictEqual(result.transactionHashVariant, TransactionHashVariant.LATEST_FINAL);
      assert.strictEqual(result.writeCalls, 0);
      assert.strictEqual(writeCalls, 0);
      assert.ok(variants.length >= 4);
      for (const call of variants) {
        assert.strictEqual(call.transactionHashVariant, TransactionHashVariant.LATEST_FINAL, `${call.functionName} must request latest-final`);
      }
      assert.deepStrictEqual(variants.map(v => v.functionName), [
        'get_round',
        'get_round_ids_count',
        'get_round_ids',
        'get_all_proposal_ids_count',
      ]);
    } finally {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
  });

  test('Deployment address resolver accepts the Studio Next to_address receipt field', () => {
    const address = '0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21';
    assert.strictEqual(resolveDeploymentContractAddress({ to_address: address }), address);
  });

  await test('Deployed-code reads prefer GenLayer getContractCode over Ethereum getCode', async () => {
    let genLayerCalls = 0;
    let ethereumCalls = 0;
    const code = await readDeployedContractCode({
      getContractCode: async () => {
        genLayerCalls++;
        return 'genlayer-source';
      },
      getCode: async () => {
        ethereumCalls++;
        return 'ethereum-bytecode';
      },
    }, '0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21');
    assert.strictEqual(code, 'genlayer-source');
    assert.strictEqual(genLayerCalls, 1);
    assert.strictEqual(ethereumCalls, 0);
  });

  await test('Recovery continues past a conclusively absent historical address to verify the adopted address', async () => {
    const txHash = '0xc5c220571c8d890c04715ce65cfd23ae92a0d49e696c596979591f771ab734e4';
    const historicalAddress = '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290';
    const adoptedAddress = '0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21';
    const client = {
      chain: { isStudio: true },
      getTransaction: async () => ({
        hash: txHash,
        statusName: 'FINALIZED',
        txExecutionResultName: 'FINISHED_WITH_RETURN',
        to_address: adoptedAddress,
      }),
      getContractCode: async (address) => {
        if (address.toLowerCase() === historicalAddress.toLowerCase()) {
          throw { code: -32001, message: `Contract ${address} not found` };
        }
        assert.strictEqual(address, adoptedAddress, 'Adopted GenLayer address casing must be preserved for lookup');
        return 'deployed intelligent contract source';
      },
      getTransactionCount: async () => 1n,
    };
    const result = await checkCandidateDeploymentSafety(
      client,
      [txHash],
      [historicalAddress],
      '0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066',
      async () => ({ error: { code: -32001, message: 'Contract not found' } })
    );
    assert.strictEqual(result.codeVerifiedForAdopted, true);
    assert.strictEqual(evaluateStage1RecoveryDecision(result).decision, 'ADOPT');
  });

  test('Deployment source readback hashes the exact base64-encoded transaction bytes', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../contracts/CharterFlowCore.py'), 'utf8');
    const expected = crypto.createHash('sha256').update(source).digest('hex');
    assert.strictEqual(
      hashDeploymentSourceFromTransaction({ data: { contract_code: Buffer.from(source).toString('base64') } }),
      expected
    );
  });

  await test('Read-only deployment readback verifies snake_case address, exact source, code, and schema without saving', async () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../contracts/CharterFlowCore.py'), 'utf8');
    const address = '0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21';
    const schema = { methods: [{ name: 'create_round', params: [] }] };
    const evidence = { stages: { deploy: {} }, latestDeploymentAttempt: {} };
    let readCalls = 0;
    const client = {
      getTransaction: async () => {
        readCalls++;
        return {
          statusName: 'FINALIZED',
          txExecutionResultName: 'FINISHED_WITH_RETURN',
          to_address: address,
          data: { contract_code: Buffer.from(source).toString('base64') },
        };
      },
      getCode: async () => {
        readCalls++;
        return 'non-empty-deployed-code';
      },
      getContractSchema: async () => {
        readCalls++;
        return schema;
      },
      getContractSchemaForCode: async () => {
        readCalls++;
        return schema;
      },
    };

    const readback = await verifyAndRecordDeploymentReadback({
      client,
      evidence,
      txHash: '0xc5c220571c8d890c04715ce65cfd23ae92a0d49e696c596979591f771ab734e4',
      contractAddress: address,
      sourceCode: source,
      expectedSourceHash: crypto.createHash('sha256').update(source).digest('hex'),
      saveEvidenceOption: false,
    });
    assert.strictEqual(readCalls, 4);
    assert.strictEqual(readback.transactionSourceSha256, crypto.createHash('sha256').update(source).digest('hex'));
    assert.strictEqual(readback.schemaMatchesExactSource, true);
    assert.strictEqual(evidence.latestDeploymentAttempt.status, 'FINALIZED_SUCCESS_READBACK_VERIFIED');
  });

  // --------------------------------------------------------------------------
  // Check 1: Corrupt or Unreadable Evidence is a Hard Stop (Preserves file)
  // --------------------------------------------------------------------------
  const tmpCorruptPath = path.resolve(__dirname, '.test_corrupt_evidence.json');
  const tmpValidPath = path.resolve(__dirname, '.test_valid_evidence.json');

  test('Corrupt evidence file throws fatal error and does not start fresh', () => {
    fs.writeFileSync(tmpCorruptPath, '{ "network": { "chainId": 61997, broken_json: true ', 'utf8');
    let threw = false;
    try {
      loadEvidence(tmpCorruptPath);
    } catch (err) {
      threw = true;
      assert(err.message.includes('Evidence file corrupted'), `Unexpected error message: ${err.message}`);
    }
    assert(threw, 'loadEvidence did not throw on corrupt JSON!');
    // Verify file was preserved untouched
    const rawOnDisk = fs.readFileSync(tmpCorruptPath, 'utf8');
    assert(rawOnDisk.includes('broken_json'), 'Corrupt evidence file was modified or deleted!');
    fs.unlinkSync(tmpCorruptPath);
  });

  test('Atomic save evidence writes valid JSON and cleans up temp files', () => {
    const testData = { testKey: 'testVal', timestamp: Date.now() };
    saveEvidence(testData, tmpValidPath);
    const loaded = JSON.parse(fs.readFileSync(tmpValidPath, 'utf8'));
    assert.strictEqual(loaded.testKey, 'testVal');
    // Ensure no lingering temp files in dir
    const tmpFiles = fs.readdirSync(__dirname).filter(f => f.startsWith('.test_valid_evidence.json.tmp'));
    assert.strictEqual(tmpFiles.length, 0, 'Found lingering temp file after atomic save!');
    fs.unlinkSync(tmpValidPath);
  });

  // --------------------------------------------------------------------------
  // Check 2: Restart After Saved Hash (Requires FINALIZED + FINISHED_WITH_RETURN)
  // --------------------------------------------------------------------------
  await test('Saved hash verification passes on FINALIZED + FINISHED_WITH_RETURN', async () => {
    const mockClient = {
      getTransaction: async ({ hash }) => ({
        statusName: 'FINALIZED',
        status: 7,
        txExecutionResultName: 'FINISHED_WITH_RETURN',
        contractAddress: '0x1234567890123456789012345678901234567890',
      }),
      waitForFinalization: async () => {},
    };
    const tx = await verifyTxFinalizedAndSuccessful(mockClient, '0xabc123', 'testStage');
    assert.strictEqual(tx.statusName, 'FINALIZED');
    assert.strictEqual(tx.txExecutionResultName, 'FINISHED_WITH_RETURN');
  });

  await test('Saved hash verification halts with error if transaction failed execution', async () => {
    const mockClient = {
      getTransaction: async ({ hash }) => ({
        statusName: 'FINALIZED',
        status: 7,
        txExecutionResultName: 'EXECUTION_FAILED',
      }),
      waitForFinalization: async () => {},
    };
    let threw = false;
    try {
      await verifyTxFinalizedAndSuccessful(mockClient, '0xfailedtx', 'testStage');
    } catch (err) {
      threw = true;
      assert(err.message.includes('failed execution'), `Unexpected error: ${err.message}`);
      assert(err.message.includes('EXECUTION_FAILED'), `Missing result status: ${err.message}`);
    }
    assert(threw, 'verifyTxFinalizedAndSuccessful did not throw on EXECUTION_FAILED!');
  });

  // --------------------------------------------------------------------------
  // Check 3: Candidate Deployment Health Gate & Probe Safety
  // --------------------------------------------------------------------------
  await test('gen_getContractCode JSON-RPC probe uses SDK Studio shape params: [candidateAddress] for Studio chains', async () => {
    let capturedRequest = null;
    const mockStudioClient = {
      chain: { isStudio: true },
      getTransaction: async () => { throw new Error('Transaction not found'); },
      getCode: async () => '0x',
    };
    const mockProbe = async (rawReq) => {
      capturedRequest = rawReq;
      return { jsonrpc: '2.0', error: { code: -32001, message: 'Contract not found' } };
    };
    const candidateAddr = '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290';
    const res = await checkCandidateDeploymentSafety(
      mockStudioClient,
      '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370',
      candidateAddr,
      mockProbe
    );
    assert.strictEqual(res.rawProbeRequest.method, 'gen_getContractCode');
    assert.deepStrictEqual(res.rawProbeRequest.params, [candidateAddr]);
    assert.notDeepStrictEqual(res.rawProbeRequest.params, [{ address: candidateAddr }], 'Params must not be [{ address }] on Studio!');
    assert.deepStrictEqual(capturedRequest.params, [candidateAddr]);
    assert.strictEqual(typeof res.rawProbeRequest.id, 'number');
  });

  await test('gen_getContractCode JSON-RPC probe uses params: [{ address }] only for non-Studio chains', async () => {
    let capturedRequest = null;
    const mockNonStudioClient = {
      chain: { isStudio: false },
      getTransaction: async () => { throw new Error('Transaction not found'); },
      getCode: async () => '0x',
    };
    const mockProbe = async (rawReq) => {
      capturedRequest = rawReq;
      return { jsonrpc: '2.0', error: { code: -32001, message: 'Contract not found' } };
    };
    const candidateAddr = '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290';
    const res = await checkCandidateDeploymentSafety(
      mockNonStudioClient,
      '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370',
      candidateAddr,
      mockProbe
    );
    assert.strictEqual(res.rawProbeRequest.method, 'gen_getContractCode');
    assert.deepStrictEqual(res.rawProbeRequest.params, [{ address: candidateAddr }]);
    assert.notDeepStrictEqual(res.rawProbeRequest.params, [candidateAddr], 'Params must not be flat array of string on non-Studio!');
    assert.deepStrictEqual(capturedRequest.params, [{ address: candidateAddr }]);
    assert.strictEqual(typeof res.rawProbeRequest.id, 'number');
  });

  await test('Candidate deployment probe handles expected -32001 without blocking', async () => {
    const mockClient = {
      getTransaction: async () => { throw new Error('Transaction not found'); },
      getCode: async () => '0x',
    };
    const mockCleanProbe = async () => ({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Contract not found' },
    });
    const res = await checkCandidateDeploymentSafety(
      mockClient,
      '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370',
      '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290',
      mockCleanProbe
    );
    assert.strictEqual(res.contractCodeProbeStatus, 'CONTRACT_NOT_FOUND_EXPECTED_32001');
    assert.strictEqual(res.dbError, null);
    assert.strictEqual(res.isAmbiguous, false);
    // Explicitly verify this does not block broadcasting
    const blocksBroadcast = res.isAmbiguous || !!res.dbError;
    assert.strictEqual(blocksBroadcast, false, 'Expected -32001 must not block on its own');
  });

  await test('Candidate deployment probe flags unexpected -32603 error and blocks deployment', async () => {
    const mockClient = {
      getTransaction: async () => { throw new Error('Transaction not found'); },
      getCode: async () => '0x',
    };
    const mockRecoveryProbe = async () => ({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: '(psycopg2.OperationalError) connection to server failed: FATAL: the database system is in recovery mode',
      },
    });
    const res = await checkCandidateDeploymentSafety(
      mockClient,
      '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370',
      '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290',
      mockRecoveryProbe
    );
    assert.strictEqual(res.isAmbiguous, true);
    assert(res.dbError !== null);
    assert(res.dbError.includes('-32603'));
    assert(res.dbError.includes('recovery mode'));
    const blocksBroadcast = res.isAmbiguous || !!res.dbError;
    assert.strictEqual(blocksBroadcast, true, 'Unexpected -32603 must block broadcasting');
  });

  await test('Candidate deployment probe flags non-2xx HTTP response and blocks deployment', async () => {
    const mockClient = {
      getTransaction: async () => { throw new Error('Transaction not found'); },
      getCode: async () => '0x',
    };
    const mockProbeHttpErr = async () => ({
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({ error: 'gateway failure' }),
    });
    const res = await checkCandidateDeploymentSafety(
      mockClient,
      '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370',
      '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290',
      mockProbeHttpErr
    );
    assert.strictEqual(res.isAmbiguous, true);
    assert(res.dbError !== null);
    assert(res.dbError.includes('HTTP 503'));
    const blocksBroadcast = res.isAmbiguous || !!res.dbError;
    assert.strictEqual(blocksBroadcast, true, 'HTTP failure must block broadcasting');
  });

  await test('Candidate deployment probe flags malformed JSON response and blocks deployment', async () => {
    const mockClient = {
      getTransaction: async () => { throw new Error('Transaction not found'); },
      getCode: async () => '0x',
    };
    const mockProbeMalformed = async () => ({
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); },
    });
    const res = await checkCandidateDeploymentSafety(
      mockClient,
      '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370',
      '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290',
      mockProbeMalformed
    );
    assert.strictEqual(res.isAmbiguous, true);
    assert(res.dbError !== null);
    assert(res.dbError.includes('Malformed JSON'));
    const blocksBroadcast = res.isAmbiguous || !!res.dbError;
    assert.strictEqual(blocksBroadcast, true, 'Malformed JSON must block broadcasting');
  });

  await test('Candidate deployment probe flags missing result/error in JSON-RPC and blocks deployment', async () => {
    const mockClient = {
      getTransaction: async () => { throw new Error('Transaction not found'); },
      getCode: async () => '0x',
    };
    const mockProbeIncomplete = async () => ({
      jsonrpc: '2.0',
      id: 123,
    });
    const res = await checkCandidateDeploymentSafety(
      mockClient,
      '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370',
      '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290',
      mockProbeIncomplete
    );
    assert.strictEqual(res.isAmbiguous, true);
    assert(res.dbError !== null);
    assert(res.dbError.includes('neither result nor error'));
    const blocksBroadcast = res.isAmbiguous || !!res.dbError;
    assert.strictEqual(blocksBroadcast, true, 'Incomplete response must block broadcasting');
  });

  await test('Nonempty gen_getContractCode result records code hash and blocks deployment broadcasting', async () => {
    const mockClient = {
      getTransaction: async () => { throw new Error('Transaction not found'); },
      getCode: async () => '0x',
    };
    const nonemptyCode = '0x608060405234801561001057600080fd5b50';
    const mockProbeWithCode = async () => ({
      jsonrpc: '2.0',
      id: 1,
      result: nonemptyCode,
    });
    const candidateAddr = '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290';
    const res = await checkCandidateDeploymentSafety(
      mockClient,
      '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370',
      candidateAddr,
      mockProbeWithCode
    );
    assert.strictEqual(res.contractCodeProbeStatus, 'CONTRACT_CODE_FOUND');
    assert.strictEqual(res.hasExistingCode, true);
    assert.strictEqual(res.isAmbiguous, true);
    assert(res.contractCodeHash !== null, 'Code hash must be computed and recorded');
    const expectedHash = crypto.createHash('sha256').update(nonemptyCode).digest('hex');
    assert.strictEqual(res.contractCodeHash, expectedHash);
    // Crucial: Must block broadcasting (never treat CONTRACT_CODE_FOUND as permission to broadcast)
    const blocksBroadcast = res.isAmbiguous || !!res.dbError || res.hasExistingCode;
    assert.strictEqual(blocksBroadcast, true, 'Nonempty contract code must block broadcasting!');
    assert(res.ambiguityReason.includes('CONTRACT_CODE_FOUND') ||
           res.ambiguityReason.includes('already contains deployed contract code'));
  });

  await test('Candidate deployment probe repeats fresh latest and pending nonce checks', async () => {
    let latestQueried = false;
    let pendingQueried = false;
    const mockClient = {
      getTransaction: async () => { throw new Error('Transaction not found'); },
      getCode: async () => '0x',
      getTransactionCount: async ({ blockTag }) => {
        if (blockTag === 'latest') latestQueried = true;
        if (blockTag === 'pending') pendingQueried = true;
        return 0n;
      },
    };
    const mockProbe = async () => ({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Contract not found' },
    });
    const res = await checkCandidateDeploymentSafety(
      mockClient,
      '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370',
      '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290',
      '0xcreator123',
      mockProbe
    );
    assert.strictEqual(latestQueried, true, 'Latest nonce was not queried freshly');
    assert.strictEqual(pendingQueried, true, 'Pending nonce was not queried freshly');
    assert.strictEqual(res.creatorLatestNonce, 0);
    assert.strictEqual(res.creatorPendingNonce, 0);
    assert.strictEqual(res.isAmbiguous, false);
  });

  await test('Pending creator nonce exceeding latest nonce blocks deployment broadcasting', async () => {
    const mockClient = {
      getTransaction: async () => { throw new Error('Transaction not found'); },
      getCode: async () => '0x',
      getTransactionCount: async ({ blockTag }) => {
        if (blockTag === 'latest') return 0n;
        if (blockTag === 'pending') return 1n; // pending tx in flight!
        return 0n;
      },
    };
    const mockProbe = async () => ({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Contract not found' },
    });
    const res = await checkCandidateDeploymentSafety(
      mockClient,
      '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370',
      '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290',
      '0xcreator123',
      mockProbe
    );
    assert.strictEqual(res.isAmbiguous, true);
    assert(res.ambiguityReason.includes('pending transactions'));
    const blocksBroadcast = res.isAmbiguous || !!res.dbError;
    assert.strictEqual(blocksBroadcast, true, 'Pending nonces must block broadcasting');
  });

  await test('Ambiguous candidate deployment query flags isAmbiguous: true on internal DB failure', async () => {
    const mockAmbiguousClient = {
      getTransaction: async () => {
        throw new Error('(psycopg2.OperationalError) connection failed: No space left on device');
      },
      getCode: async () => '0x',
    };
    const mockCleanProbe = async () => ({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Contract not found' },
    });
    const res = await checkCandidateDeploymentSafety(
      mockAmbiguousClient,
      '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370',
      '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290',
      mockCleanProbe
    );
    assert.strictEqual(res.isAmbiguous, true);
    assert(res.ambiguityReason.includes('No space left on device'));
  });

  test('Sanitization truncates raw payloads and preserves candidate hash and contract address', () => {
    const rawSqlError =
      "An internal error was received.\nDetails: (psycopg2.errors.DiskFull) could not extend file \"base/16415/16618.16\": No space left on device\n" +
      "[SQL: INSERT INTO transactions ...]\n" +
      "[parameters: {'hash': '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370', 'contract_address': '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290', 'contract_code': 'IyB7ICJEZXBlbmRzIjogInB5LWdlbmxheWVyOjVqeWNnZTRxOGsyMzQ2Mmp0YjBi...', 'sim_config': '{\"signed_rollup_transaction\": \"0xf984518080830f424094b7278a61aa25c888815afc32ad3cc52ff24fe57588016345785d8a2870b983e435a251fb000000000000000000000000...\"}']";

    const sanitized = sanitizeErrorText(rawSqlError);
    assert(sanitized.includes('0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370'), 'Candidate hash lost!');
    assert(sanitized.includes('0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290'), 'Candidate address lost!');
    assert(sanitized.includes('DiskFull'), 'DiskFull diagnostic lost!');
    assert(sanitized.includes('[TRUNCATED_CONTRACT_SOURCE_PAYLOAD]'), 'Contract source payload not truncated!');
    assert(sanitized.includes('[TRUNCATED_SIGNED_ROLLUP_TX]'), 'Signed tx payload not truncated!');

    const params = extractCandidateParams({ message: rawSqlError });
    assert.strictEqual(params.candidateTxHash, '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370');
    assert.strictEqual(params.candidateContractAddress, '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290');
  });

  // --------------------------------------------------------------------------
  // Check 4: Failed AI / Vote Receipt Halts Runner and Sets Exit Code
  // --------------------------------------------------------------------------
  await test('Failed AI review receipt halts stage and does not proceed', async () => {
    const mockClient = {
      getTransaction: async () => ({
        statusName: 'FINALIZED',
        status: 7,
        txExecutionResultName: 'ERROR_CONSENSUS_FAILED',
      }),
      waitForFinalization: async () => {},
    };
    let threw = false;
    try {
      await verifyTxFinalizedAndSuccessful(mockClient, '0xai123', 'aiReview');
    } catch (err) {
      threw = true;
      assert(err.message.includes('ERROR_CONSENSUS_FAILED'));
    }
    assert(threw, 'verifyTxFinalizedAndSuccessful did not halt on failed AI review receipt!');
  });

  await test('Failed vote receipt halts voting stage', async () => {
    const mockClient = {
      getTransaction: async () => ({
        statusName: 'FINALIZED',
        status: 7,
        txExecutionResultName: 'REVERT',
      }),
      waitForFinalization: async () => {},
    };
    let threw = false;
    try {
      await verifyTxFinalizedAndSuccessful(mockClient, '0xvote123', 'vote1');
    } catch (err) {
      threw = true;
      assert(err.message.includes('REVERT'));
    }
    assert(threw, 'verifyTxFinalizedAndSuccessful did not halt on reverted vote receipt!');
  });

  // --------------------------------------------------------------------------
  // Check 5: Negative Withdrawal Complete Ledger Invariance & Rejection Verification
  // --------------------------------------------------------------------------
  await test('Unrelated RPC error during negative test returns INCONCLUSIVE, not PASS', async () => {
    const mockFailingClient = {
      estimateTransactionFees: async () => {
        throw new Error('(psycopg2.errors.DiskFull) No space left on device');
      },
    };
    const mockReadClient = {
      readContract: async ({ functionName }) => {
        if (functionName === 'get_proposal') return { credit_withdrawn: false, state: 'APPROVED', requested_amount_wei: 500n, recipient: '0xrecip' };
        if (functionName === 'get_round') return {
          available_wei: 1000000000000000000n,
          reserved_wei: 200000000000000000n,
          approved_credits_wei: 100000000000000000n,
          creator_claimable_wei: 0n,
          payouts_emitted_wei: 0n,
          refunds_emitted_wei: 0n,
        };
        return {};
      },
      getBalance: async () => 1000000000000000000n,
    };

    const res = await executeNegativeWithdrawalTest({
      client: mockFailingClient,
      readClient: mockReadClient,
      contractAddress: '0x1234567890123456789012345678901234567890',
      proposalId: 'prop-1',
      roundId: 'rnd-1',
      expectedErrorReason: 'ERR_CALLER_NOT_RECIPIENT',
      testName: 'Test Unrelated RPC Error',
    });

    assert.strictEqual(res.outcome, 'INCONCLUSIVE', `Expected INCONCLUSIVE but got: ${res.outcome}`);
    assert.strictEqual(res.reasonMatched, false);
    assert(res.reason.includes('DiskFull'), `Reason did not preserve error diagnostic: ${res.reason}`);
  });

  await test('Contract rejection with expected reason and complete invariant ledger returns PASS', async () => {
    const mockContractRejectClient = {
      estimateTransactionFees: async () => {
        throw new Error('Transaction reverted: ERR_CALLER_NOT_RECIPIENT');
      },
    };
    const completeRound = {
      available_wei: 1000000000000000000n,
      reserved_wei: 200000000000000000n,
      approved_credits_wei: 100000000000000000n,
      creator_claimable_wei: 0n,
      payouts_emitted_wei: 0n,
      refunds_emitted_wei: 0n,
    };
    const completeProposal = {
      credit_withdrawn: false,
      state: 'APPROVED',
      requested_amount_wei: 100000000000000000n,
      recipient: '0xauthorizedrecipient',
    };
    const mockReadClient = {
      readContract: async ({ functionName }) => {
        if (functionName === 'get_proposal') return { ...completeProposal };
        if (functionName === 'get_round') return { ...completeRound };
        return {};
      },
      getBalance: async () => 1000000000000000000n,
    };

    const res = await executeNegativeWithdrawalTest({
      client: mockContractRejectClient,
      readClient: mockReadClient,
      contractAddress: '0x1234567890123456789012345678901234567890',
      proposalId: 'prop-1',
      roundId: 'rnd-1',
      expectedErrorReason: 'ERR_CALLER_NOT_RECIPIENT',
      testName: 'Test Contract Rejection Matching with Complete Ledger',
    });

    assert.strictEqual(res.outcome, 'PASS', `Expected PASS but got: ${res.outcome}`);
    assert.strictEqual(res.reasonMatched, true);
    assert.strictEqual(res.ledgerUnchanged, true);
  });

  await test('Duplicate withdrawal check with expected reason and invariant ledger returns PASS', async () => {
    const mockContractRejectClient = {
      estimateTransactionFees: async () => {
        throw new Error('Simulation failed: ERR_CREDIT_ALREADY_WITHDRAWN');
      },
    };
    const completeRound = {
      available_wei: 900000000000000000n,
      reserved_wei: 0n,
      approved_credits_wei: 0n,
      creator_claimable_wei: 0n,
      payouts_emitted_wei: 100000000000000000n,
      refunds_emitted_wei: 0n,
    };
    const completeProposal = {
      credit_withdrawn: true,
      state: 'PAYOUT_EMITTED',
      requested_amount_wei: 100000000000000000n,
      recipient: '0xauthorizedrecipient',
    };
    const mockReadClient = {
      readContract: async ({ functionName }) => {
        if (functionName === 'get_proposal') return { ...completeProposal };
        if (functionName === 'get_round') return { ...completeRound };
        return {};
      },
      getBalance: async () => 900000000000000000n,
    };

    const res = await executeNegativeWithdrawalTest({
      client: mockContractRejectClient,
      readClient: mockReadClient,
      contractAddress: '0x1234567890123456789012345678901234567890',
      proposalId: 'prop-1',
      roundId: 'rnd-1',
      expectedErrorReason: 'ERR_CREDIT_ALREADY_WITHDRAWN',
      testName: 'Test Duplicate Claim Rejection',
    });

    assert.strictEqual(res.outcome, 'PASS', `Expected PASS but got: ${res.outcome}`);
    assert.strictEqual(res.reasonMatched, true);
    assert.strictEqual(res.ledgerUnchanged, true);
  });

  await test('Negative test returns FAIL if creator_claimable_wei mutates despite expected error', async () => {
    const mockClient = {
      estimateTransactionFees: async () => {
        throw new Error('Transaction reverted: ERR_CALLER_NOT_RECIPIENT');
      },
    };
    const rBefore = {
      available_wei: 1000000000000000000n,
      reserved_wei: 200000000000000000n,
      approved_credits_wei: 100000000000000000n,
      creator_claimable_wei: 0n,
      payouts_emitted_wei: 0n,
      refunds_emitted_wei: 0n,
    };
    const rAfter = {
      ...rBefore,
      creator_claimable_wei: 50000000000000000n, // mutated!
    };
    let readCount = 0;
    const mockReadClient = {
      readContract: async ({ functionName }) => {
        if (functionName === 'get_proposal') return { credit_withdrawn: false, state: 'APPROVED', requested_amount_wei: 500n, recipient: '0xrecip' };
        if (functionName === 'get_round') {
          readCount++;
          return readCount <= 1 ? rBefore : rAfter;
        }
        return {};
      },
      getBalance: async () => 1000000000000000000n,
    };

    const res = await executeNegativeWithdrawalTest({
      client: mockClient,
      readClient: mockReadClient,
      contractAddress: '0x1234567890123456789012345678901234567890',
      proposalId: 'prop-1',
      roundId: 'rnd-1',
      expectedErrorReason: 'ERR_CALLER_NOT_RECIPIENT',
      testName: 'Test Creator Claimable Mutation Failure',
    });

    assert.strictEqual(res.outcome, 'FAIL', `Expected FAIL but got: ${res.outcome}`);
    assert.strictEqual(res.ledgerUnchanged, false);
    assert(res.reason.includes('mutated'));
  });

  await test('Negative test returns FAIL if payouts_emitted_wei or reserved_wei mutates', async () => {
    const mockClient = {
      estimateTransactionFees: async () => {
        throw new Error('Transaction reverted: ERR_CALLER_NOT_RECIPIENT');
      },
    };
    const rBefore = {
      available_wei: 1000000000000000000n,
      reserved_wei: 200000000000000000n,
      approved_credits_wei: 100000000000000000n,
      creator_claimable_wei: 0n,
      payouts_emitted_wei: 0n,
      refunds_emitted_wei: 0n,
    };
    const rAfter = {
      ...rBefore,
      payouts_emitted_wei: 100000000000000000n, // mutated!
      reserved_wei: 100000000000000000n, // mutated!
    };
    let readCount = 0;
    const mockReadClient = {
      readContract: async ({ functionName }) => {
        if (functionName === 'get_proposal') return { credit_withdrawn: false, state: 'APPROVED', requested_amount_wei: 500n, recipient: '0xrecip' };
        if (functionName === 'get_round') {
          readCount++;
          return readCount <= 1 ? rBefore : rAfter;
        }
        return {};
      },
      getBalance: async () => 1000000000000000000n,
    };

    const res = await executeNegativeWithdrawalTest({
      client: mockClient,
      readClient: mockReadClient,
      contractAddress: '0x1234567890123456789012345678901234567890',
      proposalId: 'prop-1',
      roundId: 'rnd-1',
      expectedErrorReason: 'ERR_CALLER_NOT_RECIPIENT',
      testName: 'Test Payouts Emitted Mutation Failure',
    });

    assert.strictEqual(res.outcome, 'FAIL', `Expected FAIL but got: ${res.outcome}`);
    assert.strictEqual(res.ledgerUnchanged, false);
  });

  await test('Negative test returns FAIL if contract balance mutates despite rejection', async () => {
    const mockClient = {
      estimateTransactionFees: async () => {
        throw new Error('Transaction reverted: ERR_CALLER_NOT_RECIPIENT');
      },
    };
    const rState = {
      available_wei: 1000000000000000000n,
      reserved_wei: 200000000000000000n,
      approved_credits_wei: 100000000000000000n,
      creator_claimable_wei: 0n,
      payouts_emitted_wei: 0n,
      refunds_emitted_wei: 0n,
    };
    let balCount = 0;
    const mockReadClient = {
      readContract: async ({ functionName }) => {
        if (functionName === 'get_proposal') return { credit_withdrawn: false, state: 'APPROVED', requested_amount_wei: 500n, recipient: '0xrecip' };
        if (functionName === 'get_round') return rState;
        return {};
      },
      getBalance: async () => {
        balCount++;
        return balCount <= 1 ? 1000000000000000000n : 900000000000000000n; // mutated!
      },
    };

    const res = await executeNegativeWithdrawalTest({
      client: mockClient,
      readClient: mockReadClient,
      contractAddress: '0x1234567890123456789012345678901234567890',
      proposalId: 'prop-1',
      roundId: 'rnd-1',
      expectedErrorReason: 'ERR_CALLER_NOT_RECIPIENT',
      testName: 'Test Contract Balance Mutation Failure',
    });

    assert.strictEqual(res.outcome, 'FAIL', `Expected FAIL but got: ${res.outcome}`);
    assert.strictEqual(res.ledgerUnchanged, false);
  });

  await test('Negative test returns FAIL if proposal credit_withdrawn mutates', async () => {
    const mockClient = {
      estimateTransactionFees: async () => {
        throw new Error('Transaction reverted: ERR_CALLER_NOT_RECIPIENT');
      },
    };
    const rState = {
      available_wei: 1000000000000000000n,
      reserved_wei: 200000000000000000n,
      approved_credits_wei: 100000000000000000n,
      creator_claimable_wei: 0n,
      payouts_emitted_wei: 0n,
      refunds_emitted_wei: 0n,
    };
    let propCount = 0;
    const mockReadClient = {
      readContract: async ({ functionName }) => {
        if (functionName === 'get_proposal') {
          propCount++;
          return {
            credit_withdrawn: propCount > 1, // mutated to true!
            state: propCount > 1 ? 'PAYOUT_EMITTED' : 'APPROVED',
            requested_amount_wei: 500n,
            recipient: '0xrecip',
          };
        }
        if (functionName === 'get_round') return rState;
        return {};
      },
      getBalance: async () => 1000000000000000000n,
    };

    const res = await executeNegativeWithdrawalTest({
      client: mockClient,
      readClient: mockReadClient,
      contractAddress: '0x1234567890123456789012345678901234567890',
      proposalId: 'prop-1',
      roundId: 'rnd-1',
      expectedErrorReason: 'ERR_CALLER_NOT_RECIPIENT',
      testName: 'Test Proposal Credit Withdrawn Mutation Failure',
    });

    assert.strictEqual(res.outcome, 'FAIL', `Expected FAIL but got: ${res.outcome}`);
    assert.strictEqual(res.ledgerUnchanged, false);
  });

  await test('Transaction failing on-chain for unrelated reason returns INCONCLUSIVE, not PASS', async () => {
    const unrelatedTxHash = `0x${'cd'.repeat(32)}`;
    const mockUnrelatedFailClient = {
      estimateTransactionFees: async () => ({ feeValue: 1000n }),
      writeContract: async () => unrelatedTxHash,
      waitForFinalization: async () => {},
      getTransaction: async ({ hash }) => ({
        hash,
        statusName: 'FINALIZED',
        status: 7,
        txExecutionResultName: 'REVERT',
        consensusData: { reason: 'OUT_OF_GAS' },
      }),
    };
    const mockReadClient = {
      readContract: async ({ functionName }) => {
        if (functionName === 'get_proposal') return { credit_withdrawn: false, state: 'APPROVED', requested_amount_wei: 500n, recipient: '0xrecip' };
        if (functionName === 'get_round') return {
          available_wei: 1000000000000000000n,
          reserved_wei: 200000000000000000n,
          approved_credits_wei: 100000000000000000n,
          creator_claimable_wei: 0n,
          payouts_emitted_wei: 0n,
          refunds_emitted_wei: 0n,
        };
        return {};
      },
      getBalance: async () => 1000000000000000000n,
    };

    const res = await executeNegativeWithdrawalTest({
      client: mockUnrelatedFailClient,
      readClient: mockReadClient,
      contractAddress: '0x1234567890123456789012345678901234567890',
      proposalId: 'prop-1',
      roundId: 'rnd-1',
      expectedErrorReason: 'ERR_CALLER_NOT_RECIPIENT',
      testName: 'Test Unrelated On-Chain Revert',
    });

    assert.strictEqual(res.outcome, 'INCONCLUSIVE', `Expected INCONCLUSIVE but got: ${res.outcome}`);
    assert.strictEqual(res.reasonMatched, false, 'reasonMatched must be false for unrelated failure');
    assert.strictEqual(res.txHash, unrelatedTxHash, 'txHash must be preserved for later investigation');
    assert(res.reason.includes('REVERT'), `Reason must document failure: ${res.reason}`);
  });

  // --------------------------------------------------------------------------
  // Check 6: Intent Verification (Round and Proposal Mismatch Detection)
  // --------------------------------------------------------------------------
  test('verifyRoundMatchesIntent throws on mismatched creator or title', () => {
    const intent = {
      roundId: 'rnd-1',
      title: 'Pilot Round',
      creatorAddress: '0xcreator',
      grantCapWei: '1000',
      committee: ['0xmember1', '0xmember2'],
    };
    const badRound = {
      title: 'Different Title',
      creator: '0xcreator',
      grant_cap_wei: 1000n,
      committee: ['0xmember1', '0xmember2'],
    };
    let threw = false;
    try {
      verifyRoundMatchesIntent(badRound, intent);
    } catch (e) {
      threw = true;
      assert(e.message.includes('Round title mismatch'));
    }
    assert(threw, 'Did not throw on round title mismatch!');
  });

  test('verifyProposalMatchesIntent throws on mismatched amount or recipient', () => {
    const intent = {
      roundId: 'rnd-1',
      recipient: '0xrecip',
      title: 'Prop Title',
      requestedAmountWei: '500',
      proposer: '0xnominator',
      deliverablesText: 'Deliverables text.',
    };
    const badProp = {
      proposal_id: 'prp-rnd-1-1',
      round_id: 'rnd-1',
      recipient: '0xwrong',
      title: 'Prop Title',
      requested_amount_wei: 500n,
      proposer: '0xnominator',
      deliverables_text: 'Deliverables text.',
    };
    let threw = false;
    try {
      verifyProposalMatchesIntent(badProp, intent);
    } catch (e) {
      threw = true;
      assert(e.message.includes('Proposal recipient mismatch'));
    }
    assert(threw, 'Did not throw on proposal recipient mismatch!');
  });

  // --------------------------------------------------------------------------
  // Check 7: Multi-Hash Candidate Deployment Recovery, Regression Coverage & Health Monitor
  // --------------------------------------------------------------------------
  test('Evidence gathering preserves historical hashes and selects the current deployment attempt without fallback', () => {
    const expectedD3be = '0xd3be2e4e9d89bd1bc9a6db535b97354ea314b9d20a1bc9877689eb6be7bd15a4';
    const expected369b = '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370';
    const expectedCurrent = '0xc5c220571c8d890c04715ce65cfd23ae92a0d49e696c596979591f771ab734e4';
    const fixtureEvidence = {
      latestDeploymentAttempt: { candidateTxHash: expectedCurrent, candidateContractAddress: '0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21' },
      lastFailure: { candidateTxHash: expectedD3be, candidateContractAddress: '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290' },
      stages: { deploy: { candidateTxHash: expected369b } },
      deploymentAttempt: { candidateTxHash: expected369b },
    };

    const allHashes = gatherAttemptedDeploymentHashes(fixtureEvidence);
    assert(allHashes.includes(expectedD3be), `Gathered hashes missing latest attempt ${expectedD3be}: ${JSON.stringify(allHashes)}`);
    assert(allHashes.includes(expected369b), `Gathered hashes missing prior attempt ${expected369b}: ${JSON.stringify(allHashes)}`);
    assert(allHashes.includes(expectedCurrent), `Gathered hashes missing current attempt ${expectedCurrent}: ${JSON.stringify(allHashes)}`);

    const latestHash = getLatestAttemptedDeploymentHash(fixtureEvidence);
    assert.strictEqual(latestHash, expectedCurrent, `Expected latest hash to be ${expectedCurrent}, but got ${latestHash}`);

    const addrs = gatherCandidateContractAddresses(fixtureEvidence);
    assert(addrs.includes('0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290'), 'Candidate addresses missing candidate address 0x602A...');

    const emptyHashes = gatherAttemptedDeploymentHashes({});
    assert.deepStrictEqual(emptyHashes, [], 'Empty evidence must return [] without silent fallback!');
    const emptyLatest = getLatestAttemptedDeploymentHash({});
    assert.strictEqual(emptyLatest, null, 'Empty evidence must return null without silent fallback!');
  });

  test('Write modes refuse to start without an existing local evidence checkpoint', () => {
    const missing = path.join(__dirname, '.no-such-pilot-evidence.json');
    if (fs.existsSync(missing)) fs.unlinkSync(missing);
    let threw = false;
    try {
      requireEvidenceCheckpointForWrites('lifecycle-only', missing);
    } catch (err) {
      threw = true;
      assert(err.message.includes('existing local evidence checkpoint'), err.message);
    }
    assert(threw, 'lifecycle-only must halt when the checkpoint file is missing');
    requireEvidenceCheckpointForWrites('probe', missing);
  });

  test('Public read facts fill recorded hashes without inventing a write intent', () => {
    const seeded = attachPublicPilotReadFacts({ network: { chainId: 61997 } });
    assert.strictEqual(seeded.stages.createRound.txHash, '0x1476320746c0efda5f97d2db6256c571c6da7adff7c494af33031bf9adfb0bdc');
    assert.strictEqual(seeded.stages.createRound.writeIntent, undefined);
    assert.strictEqual(seeded.stages.deploy.contractAddress, '0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21');
  });

  await test('Recovery inspects BOTH hashes and blocks broadcast if 0xd3be... is inconclusive (DiskFull) while 0x369b... is not found', async () => {
    const hashD3be = '0xd3be2e4e9d89bd1bc9a6db535b97354ea314b9d20a1bc9877689eb6be7bd15a4';
    const hash369b = '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370';
    const queriedHashes = [];

    const mockClient = {
      chain: { isStudio: true },
      getTransaction: async ({ hash }) => {
        queriedHashes.push(hash.toLowerCase());
        if (hash.toLowerCase() === hash369b) {
          throw { code: -32001, message: 'Transaction not found' };
        }
        if (hash.toLowerCase() === hashD3be) {
          throw new Error('(psycopg2.errors.DiskFull) could not extend file "base/16415/16618.16\": No space left on device');
        }
        throw new Error('Unexpected hash');
      },
      getCode: async () => '0x',
      getTransactionCount: async () => 0n,
    };
    const mockCleanProbe = async () => ({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Contract not found' },
    });

    const res = await checkCandidateDeploymentSafety(
      mockClient,
      [hash369b, hashD3be],
      '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290',
      '0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066',
      mockCleanProbe
    );

    assert(queriedHashes.includes(hash369b), 'Older hash 0x369b... was not queried');
    assert(queriedHashes.includes(hashD3be), 'Latest hash 0xd3be... was not queried');
    assert.strictEqual(res.hashesChecked[hash369b].txStatus, 'NOT_FOUND_IN_NODE_DB');
    assert.strictEqual(res.hashesChecked[hashD3be].txStatus, 'QUERY_INCONCLUSIVE_ERROR');
    assert.strictEqual(res.anyHashInconclusive, true);
    assert.strictEqual(res.isAmbiguous, true);
    assert.strictEqual(res.blocksBroadcast, true, 'DiskFull on 0xd3be must block broadcast!');
  });

  await test('Recovery blocks broadcast if either candidate hash is PENDING on node', async () => {
    const hashD3be = '0xd3be2e4e9d89bd1bc9a6db535b97354ea314b9d20a1bc9877689eb6be7bd15a4';
    const hash369b = '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370';

    const mockPendingClient = {
      chain: { isStudio: true },
      getTransaction: async ({ hash }) => {
        if (hash.toLowerCase() === hash369b) {
          throw { code: -32001, message: 'Transaction not found' };
        }
        if (hash.toLowerCase() === hashD3be) {
          return { hash, statusName: 'PENDING', status: 1 };
        }
      },
      getCode: async () => '0x',
      getTransactionCount: async () => 0n,
    };
    const mockCleanProbe = async () => ({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Contract not found' },
    });

    const res = await checkCandidateDeploymentSafety(
      mockPendingClient,
      [hash369b, hashD3be],
      '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290',
      '0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066',
      mockCleanProbe
    );

    assert.strictEqual(res.anyHashPending, true);
    assert.strictEqual(res.isAmbiguous, true);
    assert.strictEqual(res.blocksBroadcast, true, 'Pending transaction must block broadcast!');
  });

  await test('Recovery adopts verified contract address and receipt if a candidate hash is FINALIZED_SUCCESS', async () => {
    const hashD3be = '0xd3be2e4e9d89bd1bc9a6db535b97354ea314b9d20a1bc9877689eb6be7bd15a4';
    const hash369b = '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370';
    const finalizedAddress = '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290';

    const mockSuccessClient = {
      chain: { isStudio: true },
      getTransaction: async ({ hash }) => {
        if (hash.toLowerCase() === hash369b) {
          throw { code: -32001, message: 'Transaction not found' };
        }
        if (hash.toLowerCase() === hashD3be) {
          return {
            hash,
            statusName: 'FINALIZED',
            txExecutionResultName: 'FINISHED_WITH_RETURN',
            contractAddress: finalizedAddress,
          };
        }
      },
      getCode: async () => '0x608060405234801561001057600080fd5b50', // Non-empty deployed bytecode
      getTransactionCount: async () => 1n, // Nonce 1 for mined deployment
    };
    const mockCleanProbe = async () => ({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Contract not found' },
    });

    const res = await checkCandidateDeploymentSafety(
      mockSuccessClient,
      [hash369b, hashD3be],
      finalizedAddress,
      '0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066',
      mockCleanProbe
    );

    assert(res.finalizedSuccessfulTx !== null, 'Did not adopt finalized successful transaction');
    assert.strictEqual(res.finalizedSuccessfulTx.contractAddress, finalizedAddress);
    assert.strictEqual(res.codeVerifiedForAdopted, true, 'Code at adopted address must be verified');
    assert.strictEqual(res.blocksBroadcast, true, 'Broadcasting new deployment must be blocked when finalized deployment exists');
    const decision = evaluateStage1RecoveryDecision(res);
    assert.strictEqual(decision.decision, 'ADOPT', 'Stage 1 decision must be ADOPT');
    assert.strictEqual(decision.adoptedDeployment.contractAddress, finalizedAddress);
  });

  await test('Candidate hash deduplication queries distinct hashes exactly once', async () => {
    const hash1 = '0xd3be2e4e9d89bd1bc9a6db535b97354ea314b9d20a1bc9877689eb6be7bd15a4';
    const hash2 = '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370';
    const queryCounts = {};

    const mockDedupeClient = {
      chain: { isStudio: true },
      getTransaction: async ({ hash }) => {
        const norm = hash.toLowerCase();
        queryCounts[norm] = (queryCounts[norm] || 0) + 1;
        throw { code: -32001, message: 'Transaction not found' };
      },
      getCode: async () => '0x',
      getTransactionCount: async () => 0n,
    };
    const mockCleanProbe = async () => ({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Contract not found' },
    });

    // Pass duplicates with varying casing and whitespace
    const dupList = [
      hash1.toUpperCase(),
      `  ${hash1}  `,
      hash2,
      hash2.toLowerCase(),
      ` ${hash2} `,
    ];

    const res = await checkCandidateDeploymentSafety(
      mockDedupeClient,
      dupList,
      '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290',
      '0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066',
      mockCleanProbe
    );

    assert.strictEqual(res.candidateTxHashes.length, 2, 'Candidate hashes array was not deduplicated');
    assert.strictEqual(queryCounts[hash1], 1, `Hash ${hash1} was queried ${queryCounts[hash1]} times instead of 1`);
    assert.strictEqual(queryCounts[hash2], 1, `Hash ${hash2} was queried ${queryCounts[hash2]} times instead of 1`);
  });

  test('Malformed evidence objects are handled gracefully without exceptions', () => {
    assert.deepStrictEqual(gatherAttemptedDeploymentHashes(null), []);
    assert.deepStrictEqual(gatherAttemptedDeploymentHashes(undefined), []);
    assert.deepStrictEqual(gatherAttemptedDeploymentHashes('non-object'), []);
    assert.deepStrictEqual(gatherAttemptedDeploymentHashes(12345), []);
    assert.deepStrictEqual(gatherAttemptedDeploymentHashes({ lastFailure: { txHash: 'not-a-valid-hash' } }), []);
    assert.deepStrictEqual(gatherAttemptedDeploymentHashes({ stages: { deploy: { txHash: '0xshort' } } }), []);

    assert.strictEqual(getLatestAttemptedDeploymentHash(null), null);
    assert.strictEqual(getLatestAttemptedDeploymentHash(undefined), null);
    assert.strictEqual(getLatestAttemptedDeploymentHash('non-object'), null);
    assert.strictEqual(getLatestAttemptedDeploymentHash({}), null);

    assert.deepStrictEqual(gatherCandidateContractAddresses(null), []);
    assert.deepStrictEqual(gatherCandidateContractAddresses(undefined), []);
    assert.deepStrictEqual(gatherCandidateContractAddresses('non-object'), []);
  });

  await test('Creator latest nonce > 0 without finalized deployment blocks broadcast', async () => {
    const mockNonceClient = {
      chain: { isStudio: true },
      getTransaction: async () => {
        throw { code: -32001, message: 'Transaction not found' };
      },
      getCode: async () => '0x',
      getTransactionCount: async ({ blockTag }) => {
        if (blockTag === 'latest') return 1n; // Nonce 1 unexpected
        if (blockTag === 'pending') return 1n;
        return 0n;
      },
    };
    const mockCleanProbe = async () => ({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Contract not found' },
    });

    const res = await checkCandidateDeploymentSafety(
      mockNonceClient,
      '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370',
      '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290',
      '0xcreator123',
      mockCleanProbe
    );

    assert.strictEqual(res.isAmbiguous, true);
    assert(res.ambiguityReason.includes('Creator latest nonce is 1 (> 0)'));
    assert.strictEqual(res.blocksBroadcast, true, 'Unexpected creator nonce must block broadcast');
  });

  await test('Bounded Studio health monitor records disclaimer and preserves secrecy', async () => {
    const mockMonitorClient = {
      chain: { isStudio: true, rpcUrls: { default: { http: ['https://studio-next.genlayer.com/api'] } } },
      getChainId: async () => 61997,
      getBlockNumber: async () => 1791871234n,
      getTransactionCount: async () => 0n,
      getTransaction: async () => { throw { code: -32001, message: 'Transaction not found' }; },
      getCode: async () => '0x',
    };
    const mockEvidence = {
      network: { chainId: 61997 },
      accounts: { creator: { address: '0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066' } },
      latestDeploymentAttempt: { candidateTxHash: '0xd3be2e4e9d89bd1bc9a6db535b97354ea314b9d20a1bc9877689eb6be7bd15a4' },
      deploymentAttempt: { candidateTxHash: '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370' },
      monitorObservations: [],
    };

    const observations = await runStudioHealthMonitor(mockMonitorClient, mockEvidence, {
      count: 2,
      intervalSec: 0,
      creatorAddress: '0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066',
      saveEvidence: false,
    });

    assert.strictEqual(observations.length, 2);
    for (const obs of observations) {
      assert(obs.timestamp, 'Missing observation timestamp');
      assert.strictEqual(obs.chainId, 61997);
      assert.strictEqual(obs.chainIdOk, true);
      assert(obs.disclaimer.includes('Healthy read responses indicate RPC read endpoints respond'), 'Missing disclaimer');
      assert(obs.disclaimer.includes('They do not prove database writes are healthy'), 'Disclaimer must mention writes');
      // Ensure no secrets, signed transactions, or contract source stored
      const str = JSON.stringify(obs);
      assert(!str.includes('privateKey'), 'Observation leaked privateKey!');
      assert(!str.includes('signed_rollup_transaction'), 'Observation leaked signed rollup transaction!');
      assert(!str.includes('contract_code'), 'Observation leaked contract source code!');
    }
  });

  // --------------------------------------------------------------------------
  // Check 8: Controlled-Resume Decision & Zero Stage 2 Writes
  // --------------------------------------------------------------------------
  await test('Stage 1 HALT: successful hash plus another pending hash => zero calls to deployContract, zero Stage 2 writes', async () => {
    const succHash = '0xd3be2e4e9d89bd1bc9a6db535b97354ea314b9d20a1bc9877689eb6be7bd15a4';
    const pendingHash = '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370';
    const candidateAddr = '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290';
    const creatorAddr = '0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066';

    let deployCalls = 0;
    let stage2WriteCalls = 0;

    const mockClient = {
      chain: { isStudio: true },
      deployContract: async () => { deployCalls++; return '0xnewtx'; },
      writeContract: async () => { stage2WriteCalls++; return '0xstage2tx'; },
      estimateTransactionFees: async () => ({ feeValue: 100000000000000000n }),
      getTransaction: async ({ hash }) => {
        if (hash.toLowerCase() === succHash) {
          return { hash, statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', contractAddress: candidateAddr };
        }
        if (hash.toLowerCase() === pendingHash) {
          return { hash, statusName: 'PENDING', status: 1 };
        }
        throw { code: -32001, message: 'not found' };
      },
      getCode: async () => '0x60806040',
      getTransactionCount: async () => 1n,
    };
    const mockProbe = async () => ({ jsonrpc: '2.0', error: { code: -32001, message: 'Contract not found' } });

    const candidateCheck = await checkCandidateDeploymentSafety(mockClient, [succHash, pendingHash], candidateAddr, creatorAddr, mockProbe);
    const decision = evaluateStage1RecoveryDecision(candidateCheck);
    assert.strictEqual(decision.decision, 'HALT', `Expected HALT but got: ${decision.decision}`);

    const stepRes = await executeStage1RecoveryStep({
      creatorClient: mockClient,
      candidateCheck,
      code: 'def test(): pass',
      evidence: { stages: {} },
      creatorAddress: creatorAddr,
      creatorNonce: 1,
      candidateHashes: [succHash, pendingHash],
      candidateAddrs: [candidateAddr],
      primaryCandidateAddress: candidateAddr,
      latestCandidateHash: succHash,
      saveEvidenceOption: false,
    });

    if (stepRes.stage2Permitted) {
      await mockClient.writeContract({ address: stepRes.contractAddress, functionName: 'create_round' });
    }

    assert.strictEqual(stepRes.outcome, 'HALT');
    assert.strictEqual(stepRes.stage2Permitted, false);
    assert.strictEqual(deployCalls, 0, 'deployContract must be called 0 times on HALT');
    assert.strictEqual(stage2WriteCalls, 0, 'Stage 2 writeContract must be called 0 times on HALT');
  });

  await test('Stage 1 HALT: successful hash plus another inconclusive lookup => zero calls to deployContract, zero Stage 2 writes', async () => {
    const succHash = '0xd3be2e4e9d89bd1bc9a6db535b97354ea314b9d20a1bc9877689eb6be7bd15a4';
    const diskFullHash = '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370';
    const candidateAddr = '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290';
    const creatorAddr = '0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066';

    let deployCalls = 0;
    let stage2WriteCalls = 0;

    const mockClient = {
      chain: { isStudio: true },
      deployContract: async () => { deployCalls++; return '0xnewtx'; },
      writeContract: async () => { stage2WriteCalls++; return '0xstage2tx'; },
      estimateTransactionFees: async () => ({ feeValue: 100000000000000000n }),
      getTransaction: async ({ hash }) => {
        if (hash.toLowerCase() === succHash) {
          return { hash, statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', contractAddress: candidateAddr };
        }
        if (hash.toLowerCase() === diskFullHash) {
          throw new Error('(psycopg2.errors.DiskFull) could not extend file "base/16415/16618.16": No space left on device');
        }
        throw { code: -32001, message: 'not found' };
      },
      getCode: async () => '0x60806040',
      getTransactionCount: async () => 1n,
    };
    const mockProbe = async () => ({ jsonrpc: '2.0', error: { code: -32001, message: 'Contract not found' } });

    const candidateCheck = await checkCandidateDeploymentSafety(mockClient, [succHash, diskFullHash], candidateAddr, creatorAddr, mockProbe);
    const decision = evaluateStage1RecoveryDecision(candidateCheck);
    assert.strictEqual(decision.decision, 'HALT', `Expected HALT but got: ${decision.decision}`);

    const stepRes = await executeStage1RecoveryStep({
      creatorClient: mockClient,
      candidateCheck,
      code: 'def test(): pass',
      evidence: { stages: {} },
      creatorAddress: creatorAddr,
      creatorNonce: 1,
      candidateHashes: [succHash, diskFullHash],
      candidateAddrs: [candidateAddr],
      primaryCandidateAddress: candidateAddr,
      latestCandidateHash: succHash,
      saveEvidenceOption: false,
    });

    if (stepRes.stage2Permitted) {
      await mockClient.writeContract({ address: stepRes.contractAddress, functionName: 'create_round' });
    }

    assert.strictEqual(stepRes.outcome, 'HALT');
    assert.strictEqual(stepRes.stage2Permitted, false);
    assert.strictEqual(deployCalls, 0, 'deployContract must be called 0 times on HALT');
    assert.strictEqual(stage2WriteCalls, 0, 'Stage 2 writeContract must be called 0 times on HALT');
  });

  await test('Stage 1 HALT: successful hash plus empty or unreadable contract code => zero calls to deployContract, zero Stage 2 writes', async () => {
    const succHash = '0xd3be2e4e9d89bd1bc9a6db535b97354ea314b9d20a1bc9877689eb6be7bd15a4';
    const otherHash = '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370';
    const candidateAddr = '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290';
    const creatorAddr = '0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066';

    let deployCalls = 0;
    let stage2WriteCalls = 0;

    const mockClient = {
      chain: { isStudio: true },
      deployContract: async () => { deployCalls++; return '0xnewtx'; },
      writeContract: async () => { stage2WriteCalls++; return '0xstage2tx'; },
      estimateTransactionFees: async () => ({ feeValue: 100000000000000000n }),
      getTransaction: async ({ hash }) => {
        if (hash.toLowerCase() === succHash) {
          return { hash, statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', contractAddress: candidateAddr };
        }
        throw { code: -32001, message: 'Transaction not found' };
      },
      getCode: async () => '0x', // Empty bytecode despite transaction success!
      getTransactionCount: async () => 1n,
    };
    const mockProbe = async () => ({ jsonrpc: '2.0', error: { code: -32001, message: 'Contract not found' } });

    const candidateCheck = await checkCandidateDeploymentSafety(mockClient, [succHash, otherHash], candidateAddr, creatorAddr, mockProbe);
    const decision = evaluateStage1RecoveryDecision(candidateCheck);
    assert.strictEqual(decision.decision, 'HALT', `Expected HALT but got: ${decision.decision}`);
    assert(decision.reason.includes('empty') || decision.reason.includes('unreadable'), `Reason should mention empty/unreadable code: ${decision.reason}`);

    const stepRes = await executeStage1RecoveryStep({
      creatorClient: mockClient,
      candidateCheck,
      code: 'def test(): pass',
      evidence: { stages: {} },
      creatorAddress: creatorAddr,
      creatorNonce: 1,
      candidateHashes: [succHash, otherHash],
      candidateAddrs: [candidateAddr],
      primaryCandidateAddress: candidateAddr,
      latestCandidateHash: succHash,
      saveEvidenceOption: false,
    });

    if (stepRes.stage2Permitted) {
      await mockClient.writeContract({ address: stepRes.contractAddress, functionName: 'create_round' });
    }

    assert.strictEqual(stepRes.outcome, 'HALT');
    assert.strictEqual(stepRes.stage2Permitted, false);
    assert.strictEqual(deployCalls, 0, 'deployContract must be called 0 times on inconsistent empty code');
    assert.strictEqual(stage2WriteCalls, 0, 'Stage 2 writeContract must be called 0 times on inconsistent empty code');
  });

  await test('Stage 1 HALT: conflicting successful hashes => zero calls to deployContract, zero Stage 2 writes', async () => {
    const succHash1 = '0xd3be2e4e9d89bd1bc9a6db535b97354ea314b9d20a1bc9877689eb6be7bd15a4';
    const succHash2 = '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370';
    const candidateAddr = '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290';
    const creatorAddr = '0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066';

    let deployCalls = 0;
    let stage2WriteCalls = 0;

    const mockClient = {
      chain: { isStudio: true },
      deployContract: async () => { deployCalls++; return '0xnewtx'; },
      writeContract: async () => { stage2WriteCalls++; return '0xstage2tx'; },
      estimateTransactionFees: async () => ({ feeValue: 100000000000000000n }),
      getTransaction: async ({ hash }) => {
        if (hash.toLowerCase() === succHash1) {
          return { hash, statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', contractAddress: candidateAddr };
        }
        if (hash.toLowerCase() === succHash2) {
          return { hash, statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', contractAddress: '0xAnotherContract123456789012345678901234' };
        }
        throw { code: -32001, message: 'not found' };
      },
      getCode: async () => '0x60806040',
      getTransactionCount: async () => 2n,
    };
    const mockProbe = async () => ({ jsonrpc: '2.0', error: { code: -32001, message: 'Contract not found' } });

    const candidateCheck = await checkCandidateDeploymentSafety(mockClient, [succHash1, succHash2], candidateAddr, creatorAddr, mockProbe);
    const decision = evaluateStage1RecoveryDecision(candidateCheck);
    assert.strictEqual(decision.decision, 'HALT', `Expected HALT on conflicting successes but got: ${decision.decision}`);
    assert(decision.reason.includes('Conflicting') || decision.reason.includes('conflicting'), `Reason should mention conflicting successes: ${decision.reason}`);

    const stepRes = await executeStage1RecoveryStep({
      creatorClient: mockClient,
      candidateCheck,
      code: 'def test(): pass',
      evidence: { stages: {} },
      creatorAddress: creatorAddr,
      creatorNonce: 2,
      candidateHashes: [succHash1, succHash2],
      candidateAddrs: [candidateAddr],
      primaryCandidateAddress: candidateAddr,
      latestCandidateHash: succHash1,
      saveEvidenceOption: false,
    });

    if (stepRes.stage2Permitted) {
      await mockClient.writeContract({ address: stepRes.contractAddress, functionName: 'create_round' });
    }

    assert.strictEqual(stepRes.outcome, 'HALT');
    assert.strictEqual(stepRes.stage2Permitted, false);
    assert.strictEqual(deployCalls, 0, 'deployContract must be called 0 times on conflicting successes');
    assert.strictEqual(stage2WriteCalls, 0, 'Stage 2 writeContract must be called 0 times on conflicting successes');
  });

  await test('Stage 1 HALT: unexpected nonce => zero calls to deployContract, zero Stage 2 writes', async () => {
    const succHash = '0xd3be2e4e9d89bd1bc9a6db535b97354ea314b9d20a1bc9877689eb6be7bd15a4';
    const otherHash = '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370';
    const candidateAddr = '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290';
    const creatorAddr = '0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066';

    let deployCalls = 0;
    let stage2WriteCalls = 0;

    // Subcase: finalized successful deployment exists, but creator latest nonce is 0!
    const mockClient = {
      chain: { isStudio: true },
      deployContract: async () => { deployCalls++; return '0xnewtx'; },
      writeContract: async () => { stage2WriteCalls++; return '0xstage2tx'; },
      estimateTransactionFees: async () => ({ feeValue: 100000000000000000n }),
      getTransaction: async ({ hash }) => {
        if (hash.toLowerCase() === succHash) {
          return { hash, statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', contractAddress: candidateAddr };
        }
        throw { code: -32001, message: 'not found' };
      },
      getCode: async () => '0x60806040',
      getTransactionCount: async () => 0n, // Nonce 0 inconsistent with mined deployment!
    };
    const mockProbe = async () => ({ jsonrpc: '2.0', error: { code: -32001, message: 'Contract not found' } });

    const candidateCheck = await checkCandidateDeploymentSafety(mockClient, [succHash, otherHash], candidateAddr, creatorAddr, mockProbe);
    const decision = evaluateStage1RecoveryDecision(candidateCheck);
    assert.strictEqual(decision.decision, 'HALT', `Expected HALT on unexpected nonce but got: ${decision.decision}`);

    const stepRes = await executeStage1RecoveryStep({
      creatorClient: mockClient,
      candidateCheck,
      code: 'def test(): pass',
      evidence: { stages: {} },
      creatorAddress: creatorAddr,
      creatorNonce: 0,
      candidateHashes: [succHash, otherHash],
      candidateAddrs: [candidateAddr],
      primaryCandidateAddress: candidateAddr,
      latestCandidateHash: succHash,
      saveEvidenceOption: false,
    });

    if (stepRes.stage2Permitted) {
      await mockClient.writeContract({ address: stepRes.contractAddress, functionName: 'create_round' });
    }

    assert.strictEqual(stepRes.outcome, 'HALT');
    assert.strictEqual(stepRes.stage2Permitted, false);
    assert.strictEqual(deployCalls, 0, 'deployContract must be called 0 times on unexpected nonce');
    assert.strictEqual(stage2WriteCalls, 0, 'Stage 2 writeContract must be called 0 times on unexpected nonce');
  });

  await test('Stage 1 ADOPT: fully consistent existing deployment is adopted without deploying again', async () => {
    const succHash = '0xd3be2e4e9d89bd1bc9a6db535b97354ea314b9d20a1bc9877689eb6be7bd15a4';
    const otherHash = '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370';
    const candidateAddr = '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290';
    const creatorAddr = '0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066';

    let deployCalls = 0;
    let stage2WriteCalls = 0;

    const mockClient = {
      chain: { isStudio: true },
      deployContract: async () => { deployCalls++; return '0xnewtx'; },
      writeContract: async () => { stage2WriteCalls++; return '0xstage2tx'; },
      estimateTransactionFees: async () => ({ feeValue: 100000000000000000n }),
      getTransaction: async ({ hash }) => {
        if (hash.toLowerCase() === succHash) {
          return { hash, statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', contractAddress: candidateAddr };
        }
        if (hash.toLowerCase() === otherHash) {
          throw { code: -32001, message: 'Transaction not found' };
        }
        throw { code: -32001, message: 'not found' };
      },
      getCode: async () => '0x608060405234801561001057600080fd5b50', // Verified non-empty bytecode
      getTransactionCount: async () => 1n, // Valid nonce 1
    };
    const mockProbe = async () => ({ jsonrpc: '2.0', error: { code: -32001, message: 'Contract not found' } });

    const candidateCheck = await checkCandidateDeploymentSafety(mockClient, [succHash, otherHash], candidateAddr, creatorAddr, mockProbe);
    const decision = evaluateStage1RecoveryDecision(candidateCheck);
    assert.strictEqual(decision.decision, 'ADOPT', `Expected ADOPT but got: ${decision.decision}`);
    assert.strictEqual(decision.adoptedDeployment.contractAddress, candidateAddr);

    const stepRes = await executeStage1RecoveryStep({
      creatorClient: mockClient,
      candidateCheck,
      code: 'def test(): pass',
      evidence: { stages: {} },
      creatorAddress: creatorAddr,
      creatorNonce: 1,
      candidateHashes: [succHash, otherHash],
      candidateAddrs: [candidateAddr],
      primaryCandidateAddress: candidateAddr,
      latestCandidateHash: succHash,
      saveEvidenceOption: false,
    });

    assert.strictEqual(stepRes.outcome, 'ADOPT');
    assert.strictEqual(stepRes.adopted, true);
    assert.strictEqual(stepRes.deployed, false);
    assert.strictEqual(stepRes.contractAddress, candidateAddr);
    assert.strictEqual(stepRes.stage2Permitted, true);
    assert.strictEqual(deployCalls, 0, 'deployContract must NEVER be called when adopting existing deployment!');
  });

  await test('Stage 1 MAY_DEPLOY: clean undeployed case is the only one that permits a deployment attempt', async () => {
    const hash1 = '0xd3be2e4e9d89bd1bc9a6db535b97354ea314b9d20a1bc9877689eb6be7bd15a4';
    const hash2 = '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370';
    const candidateAddr = '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290';
    const creatorAddr = '0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066';

    let deployCalls = 0;

    const mockClient = {
      chain: { isStudio: true },
      deployContract: async () => { deployCalls++; return '0xnewdeploytx'; },
      estimateTransactionFees: async () => ({ feeValue: 100000000000000000n }),
      getTransaction: async () => {
        throw { code: -32001, message: 'Transaction not found' };
      },
      getCode: async () => '0x', // Empty bytecode
      getTransactionCount: async () => 0n, // Nonces 0
    };
    const mockProbe = async () => ({ jsonrpc: '2.0', error: { code: -32001, message: 'Contract not found' } });

    const candidateCheck = await checkCandidateDeploymentSafety(mockClient, [hash1, hash2], candidateAddr, creatorAddr, mockProbe);
    const decision = evaluateStage1RecoveryDecision(candidateCheck);
    assert.strictEqual(decision.decision, 'MAY_DEPLOY', `Expected MAY_DEPLOY but got: ${decision.decision}`);

    // In a test run without waiting for real node finality, verifyTxFinalizedAndSuccessful mock:
    const mockVerifiedClient = {
      ...mockClient,
      getTransaction: async ({ hash }) => {
        if (hash === '0xnewdeploytx') {
          return { hash, statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', contractAddress: '0xbrandnewcontract123' };
        }
        throw { code: -32001, message: 'Transaction not found' };
      },
    };

    const stepRes = await executeStage1RecoveryStep({
      creatorClient: mockVerifiedClient,
      candidateCheck,
      code: 'def test(): pass',
      evidence: { stages: {} },
      creatorAddress: creatorAddr,
      creatorNonce: 0,
      candidateHashes: [hash1, hash2],
      candidateAddrs: [candidateAddr],
      primaryCandidateAddress: candidateAddr,
      latestCandidateHash: hash1,
      saveEvidenceOption: false,
    });

    assert.strictEqual(stepRes.outcome, 'DEPLOYED');
    assert.strictEqual(stepRes.deployed, true);
    assert.strictEqual(stepRes.adopted, false);
    assert.strictEqual(stepRes.contractAddress, '0xbrandnewcontract123');
    assert.strictEqual(stepRes.stage2Permitted, true);
    assert.strictEqual(deployCalls, 1, 'Exactly ONE deployment attempt permitted');
  });

  await test('Deployment-only mode stops after successful Stage 1 with zero Stage 2+ write calls', async () => {
    const hash1 = '0xd3be2e4e9d89bd1bc9877689eb6be7bd15a4';
    const hash2 = '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370';
    const candidateAddr = '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290';
    const creatorAddr = '0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066';
    const deployedAddr = '0x1234567890123456789012345678901234567890';
    let deployCalls = 0;
    let stage2PlusWriteCalls = 0;

    const mockClient = {
      chain: { isStudio: true },
      deployContract: async () => {
        deployCalls++;
        return '0xdeploymentonlytx';
      },
      writeContract: async () => {
        stage2PlusWriteCalls++;
        return '0xforbiddenstage2tx';
      },
      estimateTransactionFees: async () => ({ feeValue: 100000000000000000n }),
      getTransaction: async ({ hash }) => {
        if (hash === '0xdeploymentonlytx') {
          return {
            hash,
            statusName: 'FINALIZED',
            status: 7,
            txExecutionResultName: 'FINISHED_WITH_RETURN',
            contractAddress: deployedAddr,
          };
        }
        throw { code: -32001, message: 'Transaction not found' };
      },
      getCode: async () => '0x',
      getTransactionCount: async () => 0n,
    };
    const mockProbe = async () => ({ jsonrpc: '2.0', error: { code: -32001, message: 'Contract not found' } });
    const candidateCheck = await checkCandidateDeploymentSafety(
      mockClient,
      [hash1, hash2],
      candidateAddr,
      creatorAddr,
      mockProbe
    );

    const stage1Result = await executeStage1RecoveryStep({
      creatorClient: mockClient,
      candidateCheck,
      code: 'def test(): pass',
      evidence: { stages: {} },
      creatorAddress: creatorAddr,
      creatorNonce: 0,
      creatorBalanceWei: 500000000000000000n,
      candidateHashes: [hash1, hash2],
      candidateAddrs: [candidateAddr],
      primaryCandidateAddress: candidateAddr,
      latestCandidateHash: hash1,
      saveEvidenceOption: false,
      deploymentOnly: true,
    });

    if (stage1Result.stage2Permitted) {
      await mockClient.writeContract({
        address: stage1Result.contractAddress,
        functionName: 'create_round',
      });
    }

    assert.strictEqual(stage1Result.outcome, 'DEPLOYED');
    assert.strictEqual(stage1Result.deploymentOnlyComplete, true);
    assert.strictEqual(stage1Result.stage2Permitted, false);
    assert.strictEqual(deployCalls, 1, 'Deployment-only mode permits exactly one Stage 1 deployContract call');
    assert.strictEqual(stage2PlusWriteCalls, 0, 'Deployment-only mode must make zero Stage 2+ write calls');
  });

  // --------------------------------------------------------------------------
  // Check 8: Proposal Schema Mismatch & Correlation Safety Tests
  // --------------------------------------------------------------------------
  test('Regression: verifyProposalMatchesIntent strictly requires requested_amount_wei and rejects old requested_credit_wei schema', () => {
    const intent = {
      roundId: 'rnd-pilot-1',
      recipient: '0xrecip123',
      title: 'Valid Open Source Verifier',
      requestedAmountWei: '50000000000000000',
      proposer: '0xmembera123',
      deliverablesText: 'Valid open source deliverables package.',
    };

    // Old runner / old fixture shape: missing requested_amount_wei, only had requested_credit_wei
    const oldFixtureProp = {
      proposal_id: 'prp-rnd-pilot-1-1',
      round_id: 'rnd-pilot-1',
      recipient: '0xrecip123',
      title: 'Valid Open Source Verifier',
      requested_credit_wei: '50000000000000000',
      proposer: '0xmembera123',
      deliverables_text: 'Valid open source deliverables package.',
    };

    let threwMissingField = false;
    try {
      verifyProposalMatchesIntent(oldFixtureProp, intent);
    } catch (e) {
      threwMissingField = true;
      assert(
        e.message.includes('requested_amount_wei field is missing'),
        `Unexpected error message: ${e.message}`
      );
    }
    assert(
      threwMissingField,
      'verifyProposalMatchesIntent must reject proposals missing requested_amount_wei (old schema)!'
    );

    // Mismatched amount
    const mismatchProp = {
      proposal_id: 'prp-rnd-pilot-1-1',
      round_id: 'rnd-pilot-1',
      recipient: '0xrecip123',
      title: 'Valid Open Source Verifier',
      requested_amount_wei: '99999999999999999',
      proposer: '0xmembera123',
      deliverables_text: 'Valid open source deliverables package.',
    };
    let threwMismatch = false;
    try {
      verifyProposalMatchesIntent(mismatchProp, intent);
    } catch (e) {
      threwMismatch = true;
      assert(
        e.message.includes('Proposal requested amount mismatch'),
        `Unexpected error message: ${e.message}`
      );
    }
    assert(threwMismatch, 'verifyProposalMatchesIntent must reject mismatched requested_amount_wei!');

    // Correct contract return shape
    const correctProp = {
      proposal_id: 'prp-rnd-pilot-1-1',
      round_id: 'rnd-pilot-1',
      recipient: '0xrecip123',
      title: 'Valid Open Source Verifier',
      requested_amount_wei: '50000000000000000',
      proposer: '0xmembera123',
      deliverables_text: 'Valid open source deliverables package.',
    };
    verifyProposalMatchesIntent(correctProp, intent);
  });

  await test('Regression: executeNegativeWithdrawalTest rejects proposal missing requested_amount_wei without fallback', async () => {
    const mockClient = {
      readContract: async ({ functionName }) => {
        if (functionName === 'get_round') {
          return {
            available_wei: 1000n,
            reserved_wei: 500n,
            approved_credits_wei: 0n,
            creator_claimable_wei: 0n,
            payouts_emitted_wei: 0n,
            refunds_emitted_wei: 0n,
          };
        }
        if (functionName === 'get_proposal') {
          // Returns proposal with only old requested_credit_wei, missing requested_amount_wei
          return {
            credit_withdrawn: false,
            state: 'APPROVED',
            requested_credit_wei: 500n,
            recipient: '0xrecip',
          };
        }
        throw new Error(`Unexpected function ${functionName}`);
      },
      writeContract: async () => {
        throw new Error('ERR_CALLER_NOT_RECIPIENT');
      },
      getBalance: async () => 1500n,
    };

    const res = await executeNegativeWithdrawalTest({
      contractAddress: '0xcontract',
      roundId: 'rnd-1',
      proposalId: 'prp-rnd-1-1',
      client: mockClient,
      readClient: mockClient,
      expectedErrorReason: 'ERR_CALLER_NOT_RECIPIENT',
      testName: 'Schema Missing requested_amount_wei Test',
    });

    assert.strictEqual(res.outcome, 'FAIL');
    assert(
      res.reason.includes('requested_amount_wei field is missing'),
      `Expected requested_amount_wei missing error, got: ${res.reason}`
    );
  });

  await test('Proposal ID Correlation: duplicate identical proposals cause correlateResumeProposalId to HALT with AMBIGUOUS_RESUME_PROPOSAL', async () => {
    const intendedProposal = {
      roundId: 'rnd-1',
      recipient: '0xrecipient1',
      title: 'Identical Grant Proposal',
      requestedAmountWei: '50000000000000000',
      deliverablesText: 'Identical open source deliverables text adhering to specifications.',
      proposer: '0xmembera',
    };

    const duplicateProp1 = {
      proposal_id: 'prp-rnd-1-1',
      round_id: 'rnd-1',
      recipient: '0xrecipient1',
      title: 'Identical Grant Proposal',
      requested_amount_wei: '50000000000000000',
      deliverables_text: 'Identical open source deliverables text adhering to specifications.',
      proposer: '0xmembera',
    };
    const duplicateProp2 = {
      proposal_id: 'prp-rnd-1-2',
      round_id: 'rnd-1',
      recipient: '0xrecipient1',
      title: 'Identical Grant Proposal',
      requested_amount_wei: '50000000000000000',
      deliverables_text: 'Identical open source deliverables text adhering to specifications.',
      proposer: '0xmembera',
    };

    const mockClient = {
      readContract: async ({ functionName, args }) => {
        if (functionName === 'get_round_proposals_count') return 2n;
        if (functionName === 'get_round_proposals_summary') {
          return [
            { proposal_id: 'prp-rnd-1-1', recipient: '0xrecipient1', title: 'Identical Grant Proposal', requested_amount_wei: '50000000000000000' },
            { proposal_id: 'prp-rnd-1-2', recipient: '0xrecipient1', title: 'Identical Grant Proposal', requested_amount_wei: '50000000000000000' },
          ];
        }
        if (functionName === 'get_proposal') {
          if (args[0] === 'prp-rnd-1-1') return duplicateProp1;
          if (args[0] === 'prp-rnd-1-2') return duplicateProp2;
        }
        throw new Error(`Unexpected call ${functionName}`);
      },
    };

    let halted = false;
    try {
      await correlateResumeProposalId({
        client: mockClient,
        contractAddress: '0xcontract',
        roundId: 'rnd-1',
        intendedProposal,
        savedProposalId: null,
        nominateTxHash: '0xnomtx123',
      });
    } catch (e) {
      halted = true;
      assert(
        e.message.includes('INCONCLUSIVE_RESUME_ATTRIBUTION'),
        `Expected INCONCLUSIVE_RESUME_ATTRIBUTION, got: ${e.message}`
      );
      assert(e.message.includes('0xnomtx123'), 'Error must preserve txHash');
    }
    assert(halted, 'correlateResumeProposalId must halt as inconclusive and preserve txHash!');

    // Also test with preBroadcastSnapshot where delta is non-unique (2 new proposals created)
    let haltedNonUnique = false;
    try {
      await correlateResumeProposalId({
        client: mockClient,
        contractAddress: '0xcontract',
        roundId: 'rnd-1',
        intendedProposal,
        savedProposalId: null,
        nominateTxHash: '0xnomtx123',
        preBroadcastSnapshot: [],
      });
    } catch (e) {
      haltedNonUnique = true;
      assert(
        e.message.includes('INCONCLUSIVE_RESUME_ATTRIBUTION'),
        `Expected INCONCLUSIVE_RESUME_ATTRIBUTION on non-unique delta, got: ${e.message}`
      );
      assert(e.message.includes('0xnomtx123'), 'Error must preserve txHash');
    }
    assert(haltedNonUnique, 'correlateResumeProposalId must halt when preBroadcastSnapshot delta is not unique (length !== 1)!');
  });

  await test('Proposal ID Correlation: concurrent nominations with duplicate matches cause correlateNominatedProposalId to HALT with AMBIGUOUS_PROPOSAL_ATTRIBUTION', async () => {
    const intendedProposal = {
      roundId: 'rnd-1',
      recipient: '0xrecipient1',
      title: 'Concurrent Proposal',
      requestedAmountWei: '50000000000000000',
      deliverablesText: 'Open source deliverables text.',
      proposer: '0xmembera',
    };

    const idsBeforeSet = new Set(['prp-rnd-1-0']);

    // Two new proposals appeared in round after nomination
    const newProp1 = {
      proposal_id: 'prp-rnd-1-1',
      round_id: 'rnd-1',
      recipient: '0xrecipient1',
      title: 'Concurrent Proposal',
      requested_amount_wei: '50000000000000000',
      deliverables_text: 'Open source deliverables text.',
      proposer: '0xmembera',
    };
    const newProp2 = {
      proposal_id: 'prp-rnd-1-2',
      round_id: 'rnd-1',
      recipient: '0xrecipient1',
      title: 'Concurrent Proposal',
      requested_amount_wei: '50000000000000000',
      deliverables_text: 'Open source deliverables text.',
      proposer: '0xmembera',
    };

    const mockClient = {
      readContract: async ({ functionName, args }) => {
        if (functionName === 'get_round_proposals_count') return 3n;
        if (functionName === 'get_round_proposals_summary') {
          return [
            { proposal_id: 'prp-rnd-1-0' },
            { proposal_id: 'prp-rnd-1-1' },
            { proposal_id: 'prp-rnd-1-2' },
          ];
        }
        if (functionName === 'get_proposal') {
          if (args[0] === 'prp-rnd-1-1') return newProp1;
          if (args[0] === 'prp-rnd-1-2') return newProp2;
        }
        throw new Error(`Unexpected call ${functionName}`);
      },
    };

    let halted = false;
    try {
      await correlateNominatedProposalId({
        client: mockClient,
        contractAddress: '0xcontract',
        roundId: 'rnd-1',
        intendedProposal,
        idsBeforeSet,
        nominateTxHash: '0xnomtx456',
        txReceipt: { statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN' },
      });
    } catch (e) {
      halted = true;
      assert(
        e.message.includes('AMBIGUOUS_PROPOSAL_ATTRIBUTION'),
        `Expected AMBIGUOUS_PROPOSAL_ATTRIBUTION, got: ${e.message}`
      );
      assert(e.message.includes('0xnomtx456'), 'Error message must preserve transaction hash');
    }
    assert(halted, 'correlateNominatedProposalId must halt on ambiguous concurrent matches!');
  });

  await test('Proposal ID Correlation: concurrent nominations disambiguate correctly when only one new proposal matches intent', async () => {
    const intendedProposal = {
      roundId: 'rnd-1',
      recipient: '0xrecipient1',
      title: 'Target Proposal',
      requestedAmountWei: '50000000000000000',
      deliverablesText: 'Target open source deliverables.',
      proposer: '0xmembera',
    };

    const idsBeforeSet = new Set(['prp-rnd-1-0']);

    // Another member submitted a concurrent proposal prp-rnd-1-1 with different recipient and amount
    const otherMemberProp = {
      proposal_id: 'prp-rnd-1-1',
      round_id: 'rnd-1',
      recipient: '0xotherrecip',
      title: 'Other Member Proposal',
      requested_amount_wei: '20000000000000000',
      deliverables_text: 'Other deliverables.',
      proposer: '0xmemberb',
    };
    // Our transaction submitted prp-rnd-1-2
    const ourProp = {
      proposal_id: 'prp-rnd-1-2',
      round_id: 'rnd-1',
      recipient: '0xrecipient1',
      title: 'Target Proposal',
      requested_amount_wei: '50000000000000000',
      deliverables_text: 'Target open source deliverables.',
      proposer: '0xmembera',
    };

    const mockClient = {
      readContract: async ({ functionName, args }) => {
        if (functionName === 'get_round_proposals_count') return 3n;
        if (functionName === 'get_round_proposals_summary') {
          return [
            { proposal_id: 'prp-rnd-1-0' },
            { proposal_id: 'prp-rnd-1-1' },
            { proposal_id: 'prp-rnd-1-2' },
          ];
        }
        if (functionName === 'get_proposal') {
          if (args[0] === 'prp-rnd-1-1') return otherMemberProp;
          if (args[0] === 'prp-rnd-1-2') return ourProp;
        }
        throw new Error(`Unexpected call ${functionName}`);
      },
    };

    const resolvedId = await correlateNominatedProposalId({
      client: mockClient,
      contractAddress: '0xcontract',
      roundId: 'rnd-1',
      intendedProposal,
      idsBeforeSet,
      nominateTxHash: '0xnomtx789',
      txReceipt: { statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN' },
    });

    assert.strictEqual(resolvedId, 'prp-rnd-1-2', 'Must correlate strictly to matching new proposal ID');
  });

  await test('Proposal ID Correlation: pagination beyond 50 entries queries multiple pages and finds proposal on page 2', async () => {
    const pageQueries = [];
    const totalCount = 75;

    const mockSummariesPage1 = Array.from({ length: 50 }, (_, i) => ({
      proposal_id: `prp-rnd-1-${i + 1}`,
      title: `Proposal ${i + 1}`,
      recipient: '0xother',
      requested_amount_wei: '100',
    }));

    const mockSummariesPage2 = Array.from({ length: 25 }, (_, i) => ({
      proposal_id: `prp-rnd-1-${i + 51}`,
      title: `Proposal ${i + 51}`,
      recipient: i + 51 === 65 ? '0xrecip123' : '0xother',
      requested_amount_wei: '100',
    }));

    const mockClient = {
      readContract: async ({ functionName, args }) => {
        if (functionName === 'get_round_proposals_count') {
          return BigInt(totalCount);
        }
        if (functionName === 'get_round_proposals_summary') {
          const [roundId, offset, limit] = args;
          pageQueries.push({ offset, limit });
          if (offset === 0n) return mockSummariesPage1;
          if (offset === 50n) return mockSummariesPage2;
          return [];
        }
        throw new Error(`Unexpected call ${functionName}`);
      },
    };

    const allSummaries = await fetchAllRoundProposalSummaries(mockClient, '0xcontract', 'rnd-1');

    assert.strictEqual(allSummaries.length, 75, 'Must return all 75 summaries across pages');
    assert.strictEqual(pageQueries.length, 2, 'Must query exactly 2 pages');
    assert.strictEqual(pageQueries[0].offset, 0n);
    assert.strictEqual(pageQueries[0].limit, 50n);
    assert.strictEqual(pageQueries[1].offset, 50n);
    assert.strictEqual(pageQueries[1].limit, 50n);

    // Verify item from page 2 is present
    const prop65 = allSummaries.find(s => s.proposal_id === 'prp-rnd-1-65');
    assert(prop65, 'Item from page 2 must be retrieved');
    assert.strictEqual(prop65.recipient, '0xrecip123');
  });

  await test('Proposal ID Correlation: strict resume rules (saved hash cannot adopt without snapshot; no-hash resume fails; persisted snapshot succeeds)', async () => {
    const intendedProposal = {
      roundId: 'rnd-1',
      recipient: '0xrecip',
      title: 'Resume Proposal',
      requestedAmountWei: '500',
      deliverablesText: 'Resume deliverables text.',
      proposer: '0xnominator',
    };

    const onChainProp = {
      proposal_id: 'prp-rnd-1-10',
      round_id: 'rnd-1',
      recipient: '0xrecip',
      title: 'Resume Proposal',
      requested_amount_wei: '500',
      deliverables_text: 'Resume deliverables text.',
      proposer: '0xnominator',
    };

    // Case A: savedProposalId is already populated -> succeeds directly
    let directQueryCalled = false;
    const mockClientDirect = {
      readContract: async ({ functionName, args }) => {
        if (functionName === 'get_proposal' && args[0] === 'prp-rnd-1-10') {
          directQueryCalled = true;
          return onChainProp;
        }
        throw new Error(`Unexpected call ${functionName}`);
      },
    };

    const idFromDirect = await correlateResumeProposalId({
      client: mockClientDirect,
      contractAddress: '0xcontract',
      roundId: 'rnd-1',
      intendedProposal,
      savedProposalId: 'prp-rnd-1-10',
      nominateTxHash: '0xnomtxsaved',
    });
    assert.strictEqual(idFromDirect, 'prp-rnd-1-10');
    assert(directQueryCalled, 'Direct query for savedProposalId must be executed');

    // Case B: saved hash CANNOT adopt an unrelated single matching proposal when snapshot is absent
    const mockClientScan = {
      readContract: async ({ functionName, args }) => {
        if (functionName === 'get_round_proposals_count') return 1n;
        if (functionName === 'get_round_proposals_summary') {
          return [{ proposal_id: 'prp-rnd-1-10' }];
        }
        if (functionName === 'get_proposal' && args[0] === 'prp-rnd-1-10') {
          return onChainProp;
        }
        throw new Error(`Unexpected call ${functionName}`);
      },
    };

    let haltedWithoutSnapshot = false;
    try {
      await correlateResumeProposalId({
        client: mockClientScan,
        contractAddress: '0xcontract',
        roundId: 'rnd-1',
        intendedProposal,
        savedProposalId: null,
        nominateTxHash: '0xnomtxsaved',
        preBroadcastSnapshot: null,
      });
    } catch (e) {
      haltedWithoutSnapshot = true;
      assert(e.message.includes('INCONCLUSIVE_RESUME_ATTRIBUTION'), `Expected INCONCLUSIVE_RESUME_ATTRIBUTION, got: ${e.message}`);
      assert(e.message.includes('0xnomtxsaved'), 'Preserve txHash in error');
    }
    assert(haltedWithoutSnapshot, 'Saved hash must NOT adopt unrelated matching proposal without pre-broadcast snapshot!');

    // Case C: no-hash resume CANNOT adopt a matching pre-existing proposal
    let haltedNoHash = false;
    try {
      await correlateResumeProposalId({
        client: mockClientScan,
        contractAddress: '0xcontract',
        roundId: 'rnd-1',
        intendedProposal,
        savedProposalId: null,
        nominateTxHash: null,
      });
    } catch (e) {
      haltedNoHash = true;
      assert(e.message.includes('DISALLOWED_NO_HASH_RESUME'), `Expected DISALLOWED_NO_HASH_RESUME, got: ${e.message}`);
    }
    assert(haltedNoHash, 'No-hash resume must never adopt a pre-existing proposal!');

    // Case D: saved hash WITH persisted unique before/after delta succeeds
    const mockClientDelta = {
      readContract: async ({ functionName, args }) => {
        if (functionName === 'get_round_proposals_count') return 2n;
        if (functionName === 'get_round_proposals_summary') {
          return [{ proposal_id: 'prp-rnd-1-0' }, { proposal_id: 'prp-rnd-1-10' }];
        }
        if (functionName === 'get_proposal' && args[0] === 'prp-rnd-1-10') {
          return onChainProp;
        }
        throw new Error(`Unexpected call ${functionName}`);
      },
    };

    const idFromDelta = await correlateResumeProposalId({
      client: mockClientDelta,
      contractAddress: '0xcontract',
      roundId: 'rnd-1',
      intendedProposal,
      savedProposalId: null,
      nominateTxHash: '0xnomtxsaved',
      preBroadcastSnapshot: ['prp-rnd-1-0'],
    });
    assert.strictEqual(idFromDelta, 'prp-rnd-1-10', 'Persisted unique before/after delta must succeed');
  });

  await test('Proposal ID Correlation: direct derivation requires verified return value; unverified data/output/result ignored', async () => {
    const intendedProposal = {
      roundId: 'rnd-1',
      recipient: '0xrecip',
      title: 'Direct Return Proposal',
      requestedAmountWei: '500',
      deliverablesText: 'Direct return deliverables.',
      proposer: '0xnominator',
    };

    const fullProp = {
      proposal_id: 'prp-rnd-1-42',
      round_id: 'rnd-1',
      recipient: '0xrecip',
      title: 'Direct Return Proposal',
      requested_amount_wei: '500',
      deliverables_text: 'Direct return deliverables.',
      proposer: '0xnominator',
    };

    let directPropQueried = false;

    const mockClient = {
      readContract: async ({ functionName, args }) => {
        if (functionName === 'get_proposal' && args[0] === 'prp-rnd-1-42') {
          directPropQueried = true;
          return fullProp;
        }
        if (functionName === 'get_round_proposals_count') {
          return 0n;
        }
        throw new Error(`Unexpected call ${functionName}`);
      },
    };

    // Subtest 1: Unverified generic result/data/output is NOT used as proposal ID
    let unverifiedHalted = false;
    try {
      await correlateNominatedProposalId({
        client: mockClient,
        contractAddress: '0xcontract',
        roundId: 'rnd-1',
        intendedProposal,
        idsBeforeSet: new Set(),
        nominateTxHash: '0xnomtxunverified',
        txReceipt: {
          statusName: 'FINALIZED',
          result: 1, // numeric status enum in genlayer-js
          data: '0x12345678',
          output: '0xdeadbeef',
        },
      });
    } catch (e) {
      unverifiedHalted = true;
      assert(e.message.includes('INCONCLUSIVE_NOMINATION_ATTRIBUTION'));
    }
    assert(unverifiedHalted, 'Generic receipt.result, data, or output must NOT be guessed as proposal ID');

    // Subtest 2: Documented verified return value succeeds directly
    const resolvedId = await correlateNominatedProposalId({
      client: mockClient,
      contractAddress: '0xcontract',
      roundId: 'rnd-1',
      intendedProposal,
      idsBeforeSet: new Set(),
      nominateTxHash: '0xnomtxdirect',
      txReceipt: {
        statusName: 'FINALIZED',
        txExecutionResultName: 'FINISHED_WITH_RETURN',
        verifiedReturnValue: 'prp-rnd-1-42',
      },
    });

    assert.strictEqual(resolvedId, 'prp-rnd-1-42');
    assert(directPropQueried, 'Must query get_proposal for verified return ID');
  });

  await test('Proposal Identity Verification: missing or mismatched deliverables_text fails closed', () => {
    const validIntent = {
      roundId: 'rnd-1',
      recipient: '0xrecip',
      title: 'Verifier Deliverables Test',
      requestedAmountWei: '500',
      deliverablesText: 'Expected deliverables text describing the work completely.',
      proposer: '0xproposer',
    };

    // Subtest 1: Missing deliverables_text in on-chain proposal
    const missingDeliverablesProp = {
      proposal_id: 'prp-1',
      round_id: 'rnd-1',
      recipient: '0xrecip',
      title: 'Verifier Deliverables Test',
      requested_amount_wei: '500',
      proposer: '0xproposer',
    };
    let threwMissing = false;
    try {
      verifyProposalMatchesIntent(missingDeliverablesProp, validIntent);
    } catch (e) {
      threwMissing = true;
      assert(e.message.includes('deliverables_text field is missing'), `Expected missing deliverables_text error, got: ${e.message}`);
    }
    assert(threwMissing, 'verifyProposalMatchesIntent must reject missing deliverables_text');

    // Subtest 2: Mismatched deliverables_text
    const mismatchedDeliverablesProp = {
      ...missingDeliverablesProp,
      deliverables_text: 'Different deliverables text that does not match.',
    };
    let threwMismatch = false;
    try {
      verifyProposalMatchesIntent(mismatchedDeliverablesProp, validIntent);
    } catch (e) {
      threwMismatch = true;
      assert(e.message.includes('deliverables_text mismatch'), `Expected deliverables mismatch error, got: ${e.message}`);
    }
    assert(threwMismatch, 'verifyProposalMatchesIntent must reject mismatched deliverables_text');
  });

  await test('Strict Pagination: fetchAllRoundProposalSummaries halts on short page, duplicate ID, or count mismatch', async () => {
    // Subtest 1: Short page (expected 2 items, RPC returns only 1)
    const mockClientShort = {
      readContract: async ({ functionName }) => {
        if (functionName === 'get_round_proposals_count') return 2n;
        if (functionName === 'get_round_proposals_summary') {
          return [{ proposal_id: 'prp-1' }]; // only 1 returned!
        }
        throw new Error(`Unexpected call ${functionName}`);
      },
    };
    let shortHalted = false;
    try {
      await fetchAllRoundProposalSummaries(mockClientShort, '0xcontract', 'rnd-1');
    } catch (e) {
      shortHalted = true;
      assert(e.message.includes('INCONCLUSIVE_PAGINATION') && e.message.includes('Inconsistent page length'));
    }
    assert(shortHalted, 'Short page must halt as INCONCLUSIVE_PAGINATION');

    // Subtest 2: Duplicate proposal ID
    const mockClientDup = {
      readContract: async ({ functionName }) => {
        if (functionName === 'get_round_proposals_count') return 2n;
        if (functionName === 'get_round_proposals_summary') {
          return [{ proposal_id: 'prp-dup' }, { proposal_id: 'prp-dup' }];
        }
        throw new Error(`Unexpected call ${functionName}`);
      },
    };
    let dupHalted = false;
    try {
      await fetchAllRoundProposalSummaries(mockClientDup, '0xcontract', 'rnd-1');
    } catch (e) {
      dupHalted = true;
      assert(e.message.includes('INCONCLUSIVE_PAGINATION') && e.message.includes('Duplicate proposal_id'));
    }
    assert(dupHalted, 'Duplicate proposal ID must halt as INCONCLUSIVE_PAGINATION');

    // Subtest 3: Non-integer or negative count
    const mockClientBadCount = {
      readContract: async ({ functionName }) => {
        if (functionName === 'get_round_proposals_count') return -5n;
        throw new Error(`Unexpected call ${functionName}`);
      },
    };
    let badCountHalted = false;
    try {
      await fetchAllRoundProposalSummaries(mockClientBadCount, '0xcontract', 'rnd-1');
    } catch (e) {
      badCountHalted = true;
      assert(e.message.includes('INCONCLUSIVE_PAGINATION'));
    }
    assert(badCountHalted, 'Negative proposals count must halt as INCONCLUSIVE_PAGINATION');
  });

  await test('Nomination cutoff guard: expired window is EXPIRED_NOMINATION_WINDOW with zero writes', async () => {
    let threw = false;
    try {
      assertNominationWindowOpen({
        chainTimeSec: 1_800_000_000,
        nominationCutoffSec: 1_700_000_000,
        roundId: 'rnd-fresh-open',
      });
    } catch (err) {
      threw = true;
      assert(err.code === 'EXPIRED_NOMINATION_WINDOW' || String(err.message).includes('EXPIRED_NOMINATION_WINDOW'));
    }
    assert(threw, 'expired cutoff must throw');

    const open = assertNominationWindowOpen({
      chainTimeSec: 1_700_000_000,
      nominationCutoffSec: 1_800_000_000,
      roundId: 'rnd-fresh-open',
    });
    assert(open.roundId === 'rnd-fresh-open');

    let recoveryThrew = false;
    try {
      assertNominationWindowOpen({
        chainTimeSec: 1,
        nominationCutoffSec: 9_999_999_999,
        roundId: EXPECTED_ROUND_ID,
      });
    } catch (err) {
      recoveryThrew = true;
      assert(String(err.message).includes('RECOVERY_ROUND_NOMINATION_FORBIDDEN'));
    }
    assert(recoveryThrew, 'recovery round must be forbidden even with a future cutoff');

    let writes = 0;
    const mockClient = {
      getBlock: async () => ({ timestamp: 1_800_000_000 }),
      readContract: async ({ functionName }) => {
        if (functionName === 'get_round') {
          return { nomination_cutoff: 1_700_000_000, round_id: 'rnd-fresh-open' };
        }
        throw new Error(`unexpected ${functionName}`);
      },
      writeContract: async () => {
        writes += 1;
        throw new Error('write must not run');
      },
    };
    let onChainThrew = false;
    try {
      await assertNominationWindowOpenOnChain(mockClient, '0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21', 'rnd-fresh-open');
    } catch (err) {
      onChainThrew = true;
      assert(String(err.message).includes('EXPIRED_NOMINATION_WINDOW'));
    }
    assert(onChainThrew);
    assert(writes === 0, 'expired on-chain cutoff must not call writeContract');

    let readFailThrew = false;
    try {
      await assertNominationWindowOpenOnChain(
        {
          getBlock: async () => ({ timestamp: 1_800_000_000 }),
          readContract: async () => {
            throw new Error("Can't reconnect until invalid transaction is rolled back");
          },
          writeContract: async () => {
            writes += 1;
          },
        },
        '0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21',
        'rnd-fresh-open'
      );
    } catch (err) {
      readFailThrew = true;
      assert(String(err.message).includes('NOMINATION_WINDOW_READ_FAILED'));
    }
    assert(readFailThrew);
    assert(writes === 0, 'failed get_round must not write');
  });

  console.log(`\n================================================================`);
  console.log(`       SAFETY SUITE COMPLETE: ${passed}/${total} TESTS PASSED`);
  console.log(`================================================================\n`);

  if (passed !== total) {
    process.exit(1);
  } else {
    process.exitCode = 0;
  }
}

runTests().catch(err => {
  console.error('Test runner encountered fatal error:', err);
  process.exit(1);
});
