/**
 * Comprehensive Unit & Integration Tests for Wallet-Driven Writes via Transaction Kit RC2.
 *
 * Verifies all required defect repairs & regressions:
 * 1. Nomination attribution:
 *    - Never replaces failed or malformed pre-submit getProposalsByRound read with empty snapshot.
 *    - Captures complete proposal-ID snapshot close to submit, preserves with write intent.
 *    - Requires fresh quote if quote becomes stale (>120s age).
 *    - Correlates newly created proposal_id via unique round delta and full field comparison:
 *      round ID, proposer wallet, recipient, title, full deliverables (>120 chars, not summary preview),
 *      and requested amount in exact wei (not float GEN).
 *    - Halts inconclusive on zero or multiple matches (never attaches arbitrary proposal, preserves txId).
 *    - Verifies same full fields during post-state readback before invoking onSuccess.
 * 2. Transaction persistence:
 *    - Distinguishes empty localStorage from read errors, corrupt JSON, and invalid record shapes.
 *    - Preserves corrupt data; never silently replaces with [] or overwrites.
 *    - Checks persistence works before permitting wallet submission.
 *    - Retains in-memory blocking marker if submission returns txId but saving fails, preventing
 *      another write to that target during session.
 *    - On reload with corrupt/denied storage, reports manual reconciliation required.
 *    - Surfaces update failures.
 * 3. Final transaction classification:
 *    - Marks finalized-error ONLY when chain explicitly reports conclusive execution failure.
 *    - Finalized phase with missing or unknown execution result remains unresolved/inconclusive
 *      and blocks duplicate write.
 */

// Initialize in-memory localStorage for Node test runner
const mockStore = new Map<string, string>();
let mockStorageFail = false;
let mockStorageDenied = false;
let mockStorageFailOnSave = false;
let mockStorageFailOnPreSubmitIntent = false;
let mockStorageFailOnAddTxId = false;

(globalThis as any).localStorage = {
  getItem: (key: string) => {
    if (mockStorageDenied) {
      throw new Error('SecurityError: LocalStorage access denied');
    }
    return mockStore.get(key) ?? null;
  },
  setItem: (key: string, val: string) => {
    if (mockStorageDenied) {
      throw new Error('SecurityError: LocalStorage access denied');
    }
    if (mockStorageFail) {
      throw new Error('QuotaExceededError: LocalStorage quota exceeded');
    }
    if (key === 'cf_active_txs_rc2') {
      if (mockStorageFailOnSave) {
        throw new Error('QuotaExceededError: LocalStorage quota exceeded while saving transactions');
      }
      if (mockStorageFailOnPreSubmitIntent && val.includes('"status":"intent-prepared"')) {
        throw new Error('QuotaExceededError: LocalStorage quota exceeded while saving pre-submit write intent');
      }
      if (mockStorageFailOnAddTxId && (val.includes('"status":"submitted"') || val.includes('"txId"'))) {
        throw new Error('QuotaExceededError: LocalStorage quota exceeded while adding transaction ID to intent');
      }
    }
    mockStore.set(key, String(val));
  },
  removeItem: (key: string) => {
    if (mockStorageDenied) {
      throw new Error('SecurityError: LocalStorage access denied');
    }
    mockStore.delete(key);
  },
  clear: () => mockStore.clear(),
  key: (idx: number) => Array.from(mockStore.keys())[idx] ?? null,
  get length() {
    return mockStore.size;
  },
};

import {
  prepareActionTransaction,
  executeAndTrackTransaction,
  resumeInFlightTracking,
  verifyIntendedStateAfterSuccess,
  correlateNominatedProposalId,
  setTransactionKitFactoryForTesting,
  getPersistedTransactions,
  clearPersistedTransactions,
  savePersistedTransaction,
  updatePersistedTransaction,
  readPersistedTransactions,
  verifyStoragePersistenceWritable,
  buildCompositeTargetKey,
  getInMemoryBlockingMarkers,
  clearInMemoryBlockingMarkers,
  type PreparedTransaction,
  type PersistedTx,
  type ActionType,
} from '../frontend/src/services/transactionService';
import { parseGenToWei, weiToGen } from '../frontend/src/services/dataAccess';
import type { PolicyQuote, TrackedStatus, TransactionKit } from '@genlayer/transaction-kit';
import type { DataAccessAdapter, Round, Proposal } from '../frontend/src/types';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, msg: string) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  passedTests++;
  console.log(`✓ PASS: ${msg}`);
}

async function assertThrows(fn: () => Promise<any>, expectedSubstr: string, msg: string) {
  totalTests++;
  try {
    await fn();
    console.error(`❌ FAIL: Expected function to throw, but it resolved: ${msg}`);
    throw new Error(`Expected function to throw: ${msg}`);
  } catch (err: any) {
    if (String(err?.message || '').includes(expectedSubstr)) {
      passedTests++;
      console.log(`✓ PASS: ${msg}`);
    } else {
      console.error(`❌ FAIL: ${msg} (threw "${err?.message}", expected substring "${expectedSubstr}")`);
      throw err;
    }
  }
}

// -----------------------------------------------------------------------------
// Mock Helpers
// -----------------------------------------------------------------------------

class MockEip1193Provider {
  public account: string = '0x1111111111111111111111111111111111111111';
  public chainIdHex: string = '0xf22d'; // 61997 in hex

  async request(args: { method: string; params?: any[] }): Promise<any> {
    if (args.method === 'eth_accounts' || args.method === 'eth_requestAccounts') {
      return [this.account];
    }
    if (args.method === 'eth_chainId') {
      return this.chainIdHex;
    }
    return '0x';
  }
}

interface MockKitOptions {
  verificationStatus?: 'verified' | 'mismatch' | 'unavailable';
  feeValue?: bigint;
  userValue?: bigint;
  submitError?: Error;
  submittedTxId?: `0x${string}`;
  submittedEvmHash?: `0x${string}`;
  trackError?: Error;
  phase?: string;
  statusName?: string;
  executionResultName?: string | null;
  source?: 'developer' | 'network-default';
  customTrackPhases?: Array<Partial<TrackedStatus>>;
}

function buildMockPolicyQuote(opts: MockKitOptions, userValue: bigint): PolicyQuote {
  const feeValue = opts.feeValue ?? 50000000000000000n; // 0.05 GEN estimated fee
  return {
    distribution: {
      leaderTimeunitsAllocation: 1000000000000000000n,
      validatorTimeunitsAllocation: 1000000000000000000n,
      executionBudgetPerRound: 1000000000000000000n,
      totalMessageFees: 0n,
      rotationsPerRound: 0n,
      appealRounds: 3n,
      rotations: [0n, 0n, 0n, 0n],
      maxPriceGenPerTimeUnit: 1000000000n,
      storageFeeMaxGasPrice: 1000000000n,
      receiptFeeMaxGasPrice: 1000000000n,
    },
    feeValue,
    userValue,
    total: feeValue + userValue,
    source: opts.source ?? 'network-default',
    verification: { status: opts.verificationStatus ?? 'verified' },
    breakdown: {
      timeUnitFees: feeValue / 2n,
      executionBudget: feeValue / 2n,
      messageFees: 0n,
    },
    caps: {
      genPerTimeUnit: 1000000000n,
      storagePrice: 1000000000n,
      receiptPrice: 1000000000n,
    },
    refundable: true,
  };
}

function buildMockKit(opts: MockKitOptions = {}): TransactionKit {
  let submitCallCount = 0;
  return {
    estimate: async (input: any, _tx: any): Promise<PolicyQuote> => {
      const userVal = input.userValue ?? 0n;
      return buildMockPolicyQuote(opts, userVal);
    },
    submit: async (_quote: any, _tx: any) => {
      submitCallCount++;
      if (opts.submitError) {
        throw opts.submitError;
      }
      return {
        genlayerTxId: opts.submittedTxId ?? `0xaaaa1111222233334444555566667777888899990000aaaabbbbccccddddeeee${submitCallCount}`,
        evmTxHash: opts.submittedEvmHash ?? `0xevm1111222233334444555566667777888899990000aaaabbbbccccddddeeee${submitCallCount}`,
      };
    },
    track: async (genlayerTxId: `0x${string}`, onUpdate: (s: TrackedStatus) => void) => {
      if (opts.trackError) {
        throw opts.trackError;
      }
      const phases = opts.customTrackPhases ?? [
        { phase: 'pending', statusName: 'PENDING', genlayerTxId },
        { phase: 'processing', statusName: 'COMMITTING', genlayerTxId },
        {
          phase: opts.phase ?? 'finalized',
          statusName: opts.statusName ?? 'FINALIZED',
          executionResultName: opts.executionResultName === null ? undefined : (opts.executionResultName ?? 'FINISHED_WITH_RETURN'),
          successful:
            (opts.statusName === undefined || opts.statusName === 'FINALIZED' || opts.statusName === 'ACCEPTED') &&
            (opts.executionResultName === undefined || opts.executionResultName === 'FINISHED_WITH_RETURN'),
          genlayerTxId,
        },
      ];

      for (const p of phases) {
        onUpdate({
          phase: p.phase ?? 'processing',
          genlayerTxId,
          statusName: p.statusName,
          executionResultName: p.executionResultName,
          successful: p.successful,
        });
      }

      const finalStatus = phases[phases.length - 1];
      return {
        phase: finalStatus.phase ?? 'finalized',
        genlayerTxId,
        statusName: finalStatus.statusName ?? 'FINALIZED',
        executionResultName: finalStatus.executionResultName,
        successful: finalStatus.successful,
      };
    },
    cancel: async () => ({ transaction_hash: '0x', status: 'cancelled' }),
    topUp: async () => '0x' as `0x${string}`,
    verification: () => ({ feeConfigHash: '0xhash' as `0x${string}`, summary: {} }),
  };
}

class MockDataAccessAdapter implements Partial<DataAccessAdapter> {
  rounds: Record<string, Round> = {};
  proposals: Record<string, Proposal> = {};
  failGetProposalsByRound?: Error;
  malformedProposalsByRound?: any;

  async getRoundById(id: string): Promise<Round | null> {
    return this.rounds[id] || null;
  }

  async getProposalById(id: string): Promise<Proposal | null> {
    return this.proposals[id] || null;
  }

  async getProposalsByRound(roundId: string): Promise<Proposal[]> {
    if (this.failGetProposalsByRound) {
      throw this.failGetProposalsByRound;
    }
    if (this.malformedProposalsByRound !== undefined) {
      return this.malformedProposalsByRound;
    }
    return Object.values(this.proposals).filter((p) => p.roundId === roundId);
  }
}

// -----------------------------------------------------------------------------
// Test Execution
// -----------------------------------------------------------------------------

async function runWriteTests() {
  console.log('================================================================');
  console.log('CHARTERFLOW FRONTEND WALLET WRITES & TRANSACTION KIT RC2 SUITE');
  console.log('================================================================\n');

  const provider = new MockEip1193Provider();
  const callerAddress = '0x1111111111111111111111111111111111111111';
  const otherAddress = '0x2222222222222222222222222222222222222222';
  const contractAddress = '0x43686172746572466c6f77436f726556322e3031'; // 42 char valid hex

  clearPersistedTransactions();
  mockStore.clear();
  mockStorageFail = false;
  mockStorageDenied = false;
  mockStorageFailOnSave = false;

  // --------------------------------------------------------------------------
  // TEST SUITE 1: Exact Decimal GEN to Wei Parsing (0.05 GEN regression)
  // --------------------------------------------------------------------------
  console.log('--- Test Suite 1: Amount Conversion (0.05 GEN & Exact Parsing) ---');
  {
    // 0.05 GEN must convert exactly without floating point error
    const wei5 = parseGenToWei('0.05');
    assert(wei5 === 50000000000000000n, '0.05 GEN parses exactly to 50000000000000000n wei (5e16)');

    // Whole number 1 GEN
    const wei1 = parseGenToWei('1');
    assert(wei1 === 1000000000000000000n, '1 GEN parses exactly to 1e18 wei');

    // Fractional 1 wei (18 decimals)
    const weiMin = parseGenToWei('0.000000000000000001');
    assert(weiMin === 1n, '0.000000000000000001 GEN parses exactly to 1n wei');

    // Reject negative
    await assertThrows(
      async () => parseGenToWei('-0.05'),
      'cannot be negative',
      'Negative GEN string is rejected'
    );

    // Reject precision > 18 decimals
    await assertThrows(
      async () => parseGenToWei('0.1234567890123456789'),
      'exceeds maximum 18 decimals',
      'Precision > 18 decimals is rejected'
    );

    // Reject malformed text
    await assertThrows(
      async () => parseGenToWei('abc'),
      'Invalid decimal number format',
      'Non-numeric text is rejected'
    );

    // Enforce minWei constraint
    await assertThrows(
      async () => parseGenToWei('0.5', { minWei: 1000000000000000000n }),
      'below minimum',
      'Amount below minWei threshold is rejected'
    );
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 2: Strict Chain Safety (No chainId || 61997 fallback)
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 2: Strict Chain Safety & Rejection of Fallbacks ---');
  {
    setTransactionKitFactoryForTesting(() => buildMockKit());

    // Missing chainId (undefined as any) must block immediately
    await assertThrows(
      async () =>
        prepareActionTransaction({
          action: 'create_round',
          provider,
          account: callerAddress,
          chainId: undefined as any,
          contractAddress,
          createRoundArgs: {
            round_id: 'round-fail-chain',
            title: 'Round Title',
            description: 'Round description text with sufficient length',
            charter_text: 'A'.repeat(120),
            committee_roster: [callerAddress, otherAddress],
            grant_cap_wei: 1000000000000000000n,
            nomination_cutoff: Math.floor(Date.now() / 1000) + 7200,
            voting_duration: 3600,
            round_end: Math.floor(Date.now() / 1000) + 7200 + 86400 + 3600 + 100,
            initial_deposit_wei: 2000000000000000000n,
          },
        }),
      'Incorrect network',
      'Missing chainId blocks transaction preparation (no fallback applied)'
    );

    // Connected to wrong chain (e.g. Ethereum Mainnet 1) must block
    await assertThrows(
      async () =>
        prepareActionTransaction({
          action: 'create_round',
          provider,
          account: callerAddress,
          chainId: 1,
          contractAddress,
          createRoundArgs: {
            round_id: 'round-fail-chain',
            title: 'Round Title',
            description: 'Round description text with sufficient length',
            charter_text: 'A'.repeat(120),
            committee_roster: [callerAddress, otherAddress],
            grant_cap_wei: 1000000000000000000n,
            nomination_cutoff: Math.floor(Date.now() / 1000) + 7200,
            voting_duration: 3600,
            round_end: Math.floor(Date.now() / 1000) + 7200 + 86400 + 3600 + 100,
            initial_deposit_wei: 2000000000000000000n,
          },
        }),
      'Incorrect network: wallet connected to Chain ID 1',
      'Chain ID != 61997 is strictly blocked'
    );

    // Provider eth_chainId returning mismatch must block
    const wrongChainProvider = new MockEip1193Provider();
    wrongChainProvider.chainIdHex = '0x1'; // Chain 1
    await assertThrows(
      async () =>
        prepareActionTransaction({
          action: 'create_round',
          provider: wrongChainProvider,
          account: callerAddress,
          chainId: 61997,
          contractAddress,
          createRoundArgs: {
            round_id: 'round-fail-chain',
            title: 'Round Title',
            description: 'Round description text with sufficient length',
            charter_text: 'A'.repeat(120),
            committee_roster: [callerAddress, otherAddress],
            grant_cap_wei: 1000000000000000000n,
            nomination_cutoff: Math.floor(Date.now() / 1000) + 7200,
            voting_duration: 3600,
            round_end: Math.floor(Date.now() / 1000) + 7200 + 86400 + 3600 + 100,
            initial_deposit_wei: 2000000000000000000n,
          },
        }),
      'Provider chain mismatch: provider returned Chain ID 1',
      'Provider live chainId query mismatch blocks before estimate'
    );
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 3: Wallet & Chain Switch Invalidation After Quote + Quote Staleness
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 3: Wallet & Chain Switch Invalidation & Quote Staleness ---');
  {
    setTransactionKitFactoryForTesting(() => buildMockKit());

    const mutableProvider = new MockEip1193Provider();
    mutableProvider.account = callerAddress;
    mutableProvider.chainIdHex = '0xf22d';
    const mockAdapter = new MockDataAccessAdapter();

    const prep = await prepareActionTransaction({
      action: 'nominate_proposal',
      provider: mutableProvider,
      account: callerAddress,
      chainId: 61997,
      contractAddress,
      adapter: mockAdapter as any,
      roundId: 'round-quote-safety',
      nominateProposalArgs: {
        round_id: 'round-quote-safety',
        recipient: otherAddress,
        title: 'Safety Proposal',
        requested_amount_wei: 1000000000000000000n,
        deliverables_text: 'Deliverables specification text with sufficient characters',
      },
    });

    // Case 3a: Account switches in provider before submit
    mutableProvider.account = otherAddress;
    await assertThrows(
      async () => executeAndTrackTransaction(prep, mutableProvider, callerAddress),
      'Wallet switch detected after quote',
      'Account switch between estimate and submit triggers fresh quote error'
    );

    // Case 3b: Chain switches in provider before submit
    mutableProvider.account = callerAddress; // restore account
    mutableProvider.chainIdHex = '0x1'; // switch chain to 1
    await assertThrows(
      async () => executeAndTrackTransaction(prep, mutableProvider, callerAddress),
      'Chain switch detected after quote',
      'Chain switch between estimate and submit triggers fresh quote error'
    );

    // Reset mutable provider
    mutableProvider.chainIdHex = '0xf22d';

    // Case 3c: Stale quote (quote age > 120s) triggers fresh quote error
    const stalePrep = { ...prep, quotedAt: Date.now() - 125000 };
    await assertThrows(
      async () => executeAndTrackTransaction(stalePrep, mutableProvider, callerAddress),
      'Quote has become stale',
      'Quote older than 120s triggers fresh quote requirement'
    );
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 4: Fee Integrity & Message Budget Guardrails
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 4: Fee Integrity & Message Budget Guardrails ---');
  {
    setTransactionKitFactoryForTesting(() => buildMockKit({ source: 'network-default' }));

    // Non-message action uses network-default quote
    const prepRound = await prepareActionTransaction({
      action: 'create_round',
      provider,
      account: callerAddress,
      chainId: 61997,
      contractAddress,
      createRoundArgs: {
        round_id: 'round-net-def',
        title: 'Network Default Round',
        description: 'Round description text with sufficient length',
        charter_text: 'A'.repeat(120),
        committee_roster: [callerAddress, otherAddress],
        grant_cap_wei: 1000000000000000000n,
        nomination_cutoff: Math.floor(Date.now() / 1000) + 7200,
        voting_duration: 3600,
        round_end: Math.floor(Date.now() / 1000) + 7200 + 86400 + 3600 + 100,
        initial_deposit_wei: 2000000000000000000n,
      },
    });
    assert(prepRound.quote.source === 'network-default', 'Fee quote source is network-default (no invented suggestions)');

    // Message-emitting actions (withdraw_credit, claim_creator_refund) MUST be blocked
    const prepWithdraw = await prepareActionTransaction({
      action: 'withdraw_credit',
      provider,
      account: callerAddress,
      chainId: 61997,
      contractAddress,
      proposalId: 'prp-test-emit',
    });
    assert(prepWithdraw.isBlocked === true, 'withdraw_credit submission is blocked');
    assert(
      prepWithdraw.blockReason?.includes('emit_transfer requires verified message fee budget allocation') ?? false,
      'withdraw_credit provides explicit diagnostic regarding unmeasured message fee budget'
    );

    const prepClaimRefund = await prepareActionTransaction({
      action: 'claim_creator_refund',
      provider,
      account: callerAddress,
      chainId: 61997,
      contractAddress,
      roundId: 'round-test-emit',
    });
    assert(prepClaimRefund.isBlocked === true, 'claim_creator_refund submission is blocked');
    assert(
      prepClaimRefund.blockReason?.includes('emit_transfer requires verified message fee budget allocation') ?? false,
      'claim_creator_refund provides explicit diagnostic regarding unmeasured message fee budget'
    );
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 5: Exact Action Identity (create_round)
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 5: Exact Action Identity & create_round Round ID Carrying ---');
  {
    setTransactionKitFactoryForTesting(() => buildMockKit());

    const intendedRoundId = 'round-exact-identity-999';
    const mockAdapter = new MockDataAccessAdapter();

    const prep = await prepareActionTransaction({
      action: 'create_round',
      provider,
      account: callerAddress,
      chainId: 61997,
      contractAddress,
      createRoundArgs: {
        round_id: intendedRoundId,
        title: 'Exact Round Title',
        description: 'Round description with sufficient character length',
        charter_text: 'A'.repeat(120),
        committee_roster: [callerAddress, otherAddress],
        grant_cap_wei: 1000000000000000000n,
        nomination_cutoff: Math.floor(Date.now() / 1000) + 7200,
        voting_duration: 3600,
        round_end: Math.floor(Date.now() / 1000) + 7200 + 86400 + 3600 + 100,
        initial_deposit_wei: 2000000000000000000n,
      },
    });

    assert(prep.roundId === intendedRoundId, 'prepareActionTransaction sets exact roundId');
    assert(prep.targetIdentifier === `create_round:${intendedRoundId}`, 'Target identifier includes exact roundId');

    const executed = await executeAndTrackTransaction(prep, provider, callerAddress);
    assert(executed.roundId === intendedRoundId, 'Persisted transaction retains exact roundId');

    // Simulate post-state on contract
    mockAdapter.rounds[intendedRoundId] = {
      id: intendedRoundId,
      creatorAddress: callerAddress,
      title: 'Exact Round Title',
      summary: 'Round description',
      status: 'ACTIVE',
      totalPoolGen: 2,
      availableGen: 2,
      reservedGen: 0,
      approvedGen: 0,
      withdrawnGen: 0,
      capPerProposalGen: 1,
      totalVoters: 2,
      requiredVotes: 2,
      consensusThresholdPercent: 67,
      currentYesVotes: 0,
      committeeMembers: [],
      charterRules: [],
      charterExclusions: [],
      eventStream: [],
    };

    const verifyRes = await verifyIntendedStateAfterSuccess(
      'create_round',
      executed.roundId,
      mockAdapter as any,
      callerAddress
    );
    assert(verifyRes.verified === true, 'get_round(round_id) verifies exact intended round ID is ACTIVE');
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 6: Nomination Attribution, Snapshot Integrity & Proposal Correlation
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 6: Nomination Attribution & Full Field Correlation ---');
  {
    setTransactionKitFactoryForTesting(() => buildMockKit());
    const mockAdapter = new MockDataAccessAdapter();
    const roundId = 'round-nom-corr';

    // Case 6a: Pre-submit snapshot read failure blocks submission (never replaces with [])
    const failingAdapter = new MockDataAccessAdapter();
    failingAdapter.failGetProposalsByRound = new Error('RPC get_round_proposals_summary connection timeout');
    await assertThrows(
      async () =>
        prepareActionTransaction({
          action: 'nominate_proposal',
          provider,
          account: callerAddress,
          chainId: 61997,
          contractAddress,
          adapter: failingAdapter as any,
          roundId,
          nominateProposalArgs: {
            round_id: roundId,
            recipient: otherAddress,
            title: 'Test Proposal',
            requested_amount_wei: 50000000000000000n,
            deliverables_text: 'Test deliverables text',
          },
        }),
      'Failed to capture pre-broadcast proposal snapshot',
      'Failed pre-submit snapshot read blocks submission with real error (never replaces with [])'
    );

    // Case 6b: Malformed pre-submit snapshot read blocks submission
    const malformedAdapter = new MockDataAccessAdapter();
    malformedAdapter.malformedProposalsByRound = 'not an array' as any;
    await assertThrows(
      async () =>
        prepareActionTransaction({
          action: 'nominate_proposal',
          provider,
          account: callerAddress,
          chainId: 61997,
          contractAddress,
          adapter: malformedAdapter as any,
          roundId,
          nominateProposalArgs: {
            round_id: roundId,
            recipient: otherAddress,
            title: 'Test Proposal',
            requested_amount_wei: 50000000000000000n,
            deliverables_text: 'Test deliverables text',
          },
        }),
      'Malformed response capturing pre-broadcast proposal snapshot',
      'Malformed non-array snapshot read blocks submission with real error'
    );

    // Case 6c: Malformed proposal record inside snapshot (missing proposal ID) blocks submission
    const missingIdAdapter = new MockDataAccessAdapter();
    missingIdAdapter.malformedProposalsByRound = [{ title: 'No ID' }] as any;
    await assertThrows(
      async () =>
        prepareActionTransaction({
          action: 'nominate_proposal',
          provider,
          account: callerAddress,
          chainId: 61997,
          contractAddress,
          adapter: missingIdAdapter as any,
          roundId,
          nominateProposalArgs: {
            round_id: roundId,
            recipient: otherAddress,
            title: 'Test Proposal',
            requested_amount_wei: 50000000000000000n,
            deliverables_text: 'Test deliverables text',
          },
        }),
      'Malformed proposal record at index 0',
      'Proposal items missing id block submission with real error'
    );

    // Existing proposal in round prior to broadcast
    const existingProposal: Proposal = {
      id: 'prp-round-nom-corr-1',
      roundId,
      roundTitle: 'Round',
      title: 'Old Existing Proposal',
      requestedGen: 1,
      requestedAmountWei: '1000000000000000000',
      recipientAddress: otherAddress,
      nominatorAddress: callerAddress,
      status: 'SUBMITTED',
      workDescription: 'Old work deliverables',
      deliverables: [{ id: 'deliv-1', title: 'Deliv', description: 'Old work deliverables' }],
      matchedRuleIds: [],
      votes: { yesCount: 0, noCount: 0, requiredYes: 2, deadlineRemaining: '24h' },
      eventLog: [],
      createdAt: '2026-10-13',
    };
    mockAdapter.proposals[existingProposal.id] = existingProposal;

    // Snapshot pre-broadcast
    const preSnapshot = (await mockAdapter.getProposalsByRound(roundId)).map((p) => p.id);
    assert(preSnapshot.length === 1, 'Pre-broadcast snapshot contains 1 existing proposal ID');

    // Deliverables text longer than 120 characters to test full comparison vs preview truncation
    const longDeliverables =
      'CharterFlow Industrial Intelligence Module: Real-time telemetry pipeline integrating on-chain consensus metrics with automated AI verification protocols across multi-round allocation cycles.';
    assert(longDeliverables.length > 120, 'Deliverables text length is >120 characters');

    const nomArgs = {
      round_id: roundId,
      proposer: callerAddress,
      recipient: otherAddress,
      title: 'New Unique Nominated Proposal',
      requested_amount_wei: 50000000000000000n, // 0.05 GEN exact wei
      deliverables_text: longDeliverables,
    };

    // Case 6d: Regression: DO NOT call getProposalById(roundId)
    const oldBugCheck = await verifyIntendedStateAfterSuccess(
      'nominate_proposal',
      roundId, // Old bug passed roundId as targetId!
      mockAdapter as any
    );
    assert(oldBugCheck.verified === false, 'Passing round ID to nominate_proposal fails cleanly without calling getProposalById(roundId)');

    // Case 6e: Newly created candidate proposal created concurrently with long deliverables
    const newlyCreatedProposal: Proposal = {
      id: 'prp-round-nom-corr-2',
      roundId,
      roundTitle: 'Round',
      title: nomArgs.title,
      requestedGen: 0.05,
      requestedAmountWei: '50000000000000000', // exact wei
      recipientAddress: nomArgs.recipient,
      nominatorAddress: callerAddress,
      status: 'SUBMITTED',
      workDescription: nomArgs.deliverables_text,
      deliverables: [{ id: 'deliv-full', title: 'Deliv', description: nomArgs.deliverables_text }],
      matchedRuleIds: [],
      votes: { yesCount: 0, noCount: 0, requiredYes: 2, deadlineRemaining: '24h' },
      eventLog: [],
      createdAt: '2026-10-13',
    };
    mockAdapter.proposals[newlyCreatedProposal.id] = newlyCreatedProposal;

    const corrResult = await correlateNominatedProposalId(
      roundId,
      nomArgs,
      preSnapshot,
      mockAdapter as any
    );
    assert(corrResult.proposalId === newlyCreatedProposal.id, 'Uniquely correlates newly created proposal_id via snapshot delta & full field match (>120 chars)');

    // Case 6f: Deliverables text disambiguation when preview matches but full text differs
    // Candidate 3 has the exact same first 120 chars as longDeliverables, but differs thereafter
    const truncatedPreview = longDeliverables.slice(0, 120);
    const candidateDifferAfter120: Proposal = {
      id: 'prp-round-nom-corr-3',
      roundId,
      roundTitle: 'Round',
      title: nomArgs.title,
      requestedGen: 0.05,
      requestedAmountWei: '50000000000000000',
      recipientAddress: nomArgs.recipient,
      nominatorAddress: callerAddress,
      status: 'SUBMITTED',
      workDescription: truncatedPreview + ' - COMPLETELY DIFFERENT SPECIFICATION THAT DIVERGES AT CHAR 121',
      deliverables: [{ id: 'deliv-full', title: 'Deliv', description: truncatedPreview + ' - COMPLETELY DIFFERENT SPECIFICATION THAT DIVERGES AT CHAR 121' }],
      matchedRuleIds: [],
      votes: { yesCount: 0, noCount: 0, requiredYes: 2, deadlineRemaining: '24h' },
      eventLog: [],
      createdAt: '2026-10-13',
    };
    mockAdapter.proposals[candidateDifferAfter120.id] = candidateDifferAfter120;

    // With both candidate 2 and candidate 3 in delta:
    // Only candidate 2 matches full deliverables text; candidate 3 fails deliverables comparison.
    // Therefore, correlation still finds exactly 1 match (candidate 2)!
    const corrWithDifferAfter120 = await correlateNominatedProposalId(
      roundId,
      nomArgs,
      preSnapshot,
      mockAdapter as any
    );
    assert(
      corrWithDifferAfter120.proposalId === newlyCreatedProposal.id,
      'Full deliverables text (>120 chars) distinguishes proposals when 120-char preview matches'
    );

    // Case 6g: Exact wei matching vs floating-point GEN
    // Candidate 4 has requestedGen: 0.05, but requestedAmountWei differs by 1 wei
    const candidateDifferentWei: Proposal = {
      id: 'prp-round-nom-corr-4',
      roundId,
      roundTitle: 'Round',
      title: 'Wei Mismatch Proposal',
      requestedGen: 0.05,
      requestedAmountWei: '50000000000000001', // 1 wei difference!
      recipientAddress: nomArgs.recipient,
      nominatorAddress: callerAddress,
      status: 'SUBMITTED',
      workDescription: nomArgs.deliverables_text,
      deliverables: [{ id: 'deliv-full', title: 'Deliv', description: nomArgs.deliverables_text }],
      matchedRuleIds: [],
      votes: { yesCount: 0, noCount: 0, requiredYes: 2, deadlineRemaining: '24h' },
      eventLog: [],
      createdAt: '2026-10-13',
    };
    mockAdapter.proposals[candidateDifferentWei.id] = candidateDifferentWei;

    const corrWeiCheck = await correlateNominatedProposalId(
      roundId,
      { ...nomArgs, title: 'Wei Mismatch Proposal' },
      preSnapshot,
      mockAdapter as any
    );
    assert(corrWeiCheck.proposalId === undefined, 'Candidate differing by 1 wei is rejected (exact wei comparison, not float GEN)');
    assert(corrWeiCheck.error?.includes('No candidate proposal in round delta') ?? false, 'Reports no matching candidate when wei differs');

    // Case 6h: Proposer wallet comparison
    // Candidate with wrong proposer wallet is rejected
    const candidateWrongProposer: Proposal = {
      id: 'prp-round-nom-corr-5',
      roundId,
      roundTitle: 'Round',
      title: 'Wrong Proposer Proposal',
      requestedGen: 0.05,
      requestedAmountWei: '50000000000000000',
      recipientAddress: nomArgs.recipient,
      nominatorAddress: '0x9999999999999999999999999999999999999999', // Different proposer
      status: 'SUBMITTED',
      workDescription: nomArgs.deliverables_text,
      deliverables: [{ id: 'deliv-full', title: 'Deliv', description: nomArgs.deliverables_text }],
      matchedRuleIds: [],
      votes: { yesCount: 0, noCount: 0, requiredYes: 2, deadlineRemaining: '24h' },
      eventLog: [],
      createdAt: '2026-10-13',
    };
    mockAdapter.proposals[candidateWrongProposer.id] = candidateWrongProposer;

    const corrProposerCheck = await correlateNominatedProposalId(
      roundId,
      { ...nomArgs, title: 'Wrong Proposer Proposal' },
      preSnapshot,
      mockAdapter as any
    );
    assert(corrProposerCheck.proposalId === undefined, 'Candidate with different nominatorAddress is rejected');

    // Case 6i: Ambiguity with multiple identical concurrent proposals halts inconclusive
    const duplicateProposal: Proposal = {
      id: 'prp-round-nom-corr-6',
      roundId,
      roundTitle: 'Round',
      title: nomArgs.title,
      requestedGen: 0.05,
      requestedAmountWei: '50000000000000000',
      recipientAddress: nomArgs.recipient,
      nominatorAddress: callerAddress,
      status: 'SUBMITTED',
      workDescription: nomArgs.deliverables_text,
      deliverables: [{ id: 'deliv-full', title: 'Deliv', description: nomArgs.deliverables_text }],
      matchedRuleIds: [],
      votes: { yesCount: 0, noCount: 0, requiredYes: 2, deadlineRemaining: '24h' },
      eventLog: [],
      createdAt: '2026-10-13',
    };
    mockAdapter.proposals[duplicateProposal.id] = duplicateProposal;

    // Now both candidate 2 and candidate 6 match all full fields identically!
    const ambiguousCorr = await correlateNominatedProposalId(
      roundId,
      nomArgs,
      preSnapshot,
      mockAdapter as any
    );
    assert(ambiguousCorr.proposalId === undefined, 'Ambiguous concurrent proposals do not return an arbitrary proposal ID');
    assert(ambiguousCorr.error?.includes('Ambiguous proposal correlation: 2 candidate proposals') ?? false, 'Halts inconclusive on ambiguity; preserves txId without attaching arbitrary proposal');

    // Case 6j: Two new candidate IDs in round delta: one matches, the other cannot be read -> attribution must remain inconclusive
    const twoCandidateAdapter = new MockDataAccessAdapter();
    const roundIdTwo = 'round-two-candidates';
    const matchCandidate: Proposal = {
      id: 'prp-match-cand',
      roundId: roundIdTwo,
      roundTitle: 'Round Two',
      title: 'Target Title',
      requestedGen: 0.05,
      requestedAmountWei: '50000000000000000',
      recipientAddress: otherAddress,
      nominatorAddress: callerAddress,
      status: 'SUBMITTED',
      workDescription: longDeliverables,
      deliverables: [{ id: 'deliv-match', title: 'Deliv', description: longDeliverables }],
      matchedRuleIds: [],
      votes: { yesCount: 0, noCount: 0, requiredYes: 2, deadlineRemaining: '24h' },
      eventLog: [],
      createdAt: '2026-10-13',
    };
    const unreadableCandidateSummary: Proposal = {
      id: 'prp-unreadable-cand',
      roundId: roundIdTwo,
      roundTitle: 'Round Two',
      title: 'Target Title',
      requestedGen: 0.05,
      requestedAmountWei: '50000000000000000',
      recipientAddress: otherAddress,
      nominatorAddress: callerAddress,
      status: 'SUBMITTED',
      workDescription: longDeliverables,
      deliverables: [{ id: 'deliv-unreadable', title: 'Deliv', description: longDeliverables }],
      matchedRuleIds: [],
      votes: { yesCount: 0, noCount: 0, requiredYes: 2, deadlineRemaining: '24h' },
      eventLog: [],
      createdAt: '2026-10-13',
    };
    twoCandidateAdapter.proposals[matchCandidate.id] = matchCandidate;
    twoCandidateAdapter.proposals[unreadableCandidateSummary.id] = unreadableCandidateSummary;

    // Simulate getProposalById throwing for the unreadable candidate
    const originalGetPropById = twoCandidateAdapter.getProposalById.bind(twoCandidateAdapter);
    twoCandidateAdapter.getProposalById = async (id: string) => {
      if (id === 'prp-unreadable-cand') {
        throw new Error('RPC 504 Gateway Timeout reading proposal record');
      }
      return originalGetPropById(id);
    };

    const twoCandidateCorr = await correlateNominatedProposalId(
      roundIdTwo,
      {
        round_id: roundIdTwo,
        proposer: callerAddress,
        recipient: otherAddress,
        title: 'Target Title',
        requested_amount_wei: 50000000000000000n,
        deliverables_text: longDeliverables,
      },
      [], // empty pre-broadcast snapshot -> both are new IDs in delta
      twoCandidateAdapter as any
    );

    assert(twoCandidateCorr.proposalId === undefined, 'Two new IDs with one unreadable does not claim matching proposal is unique');
    assert(twoCandidateCorr.error?.includes('Inconclusive proposal correlation') ?? false, 'Failed read of any candidate makes correlation inconclusive');
    assert(twoCandidateCorr.error?.includes('prp-unreadable-cand') ?? false, 'Inconclusive diagnostic shows which candidate could not be checked');

    // Also test when unreadable candidate returns null record
    twoCandidateAdapter.getProposalById = async (id: string) => {
      if (id === 'prp-unreadable-cand') return null;
      return originalGetPropById(id);
    };
    const nullCandidateCorr = await correlateNominatedProposalId(
      roundIdTwo,
      {
        round_id: roundIdTwo,
        proposer: callerAddress,
        recipient: otherAddress,
        title: 'Target Title',
        requested_amount_wei: 50000000000000000n,
        deliverables_text: longDeliverables,
      },
      [],
      twoCandidateAdapter as any
    );
    assert(nullCandidateCorr.proposalId === undefined, 'Candidate returning null record does not claim other candidate is unique');
    assert(nullCandidateCorr.error?.includes('prp-unreadable-cand') ?? false, 'Inconclusive diagnostic shows null candidate ID');

    // Case 6k: Full field post-state readback verification before onSuccess
    const postStateSuccess = await verifyIntendedStateAfterSuccess(
      'nominate_proposal',
      newlyCreatedProposal.id,
      mockAdapter as any,
      callerAddress,
      { nominateArgs: nomArgs }
    );
    assert(postStateSuccess.verified === true, 'Post-state readback verifies matching full fields on candidate proposal');

    // Mismatched deliverables in post-state readback fails verification
    const postStateDeliverableMismatch = await verifyIntendedStateAfterSuccess(
      'nominate_proposal',
      newlyCreatedProposal.id,
      mockAdapter as any,
      callerAddress,
      { nominateArgs: { ...nomArgs, deliverables_text: 'Altered deliverables text' } }
    );
    assert(postStateDeliverableMismatch.verified === false, 'Post-state readback fails when full deliverables text does not match');
    assert(postStateDeliverableMismatch.message.includes('deliverablesMatch=false'), 'Diagnostic indicates deliverables mismatch');
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 7: Failed Post-State Verification Does NOT Trigger onSuccess
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 7: Failed Post-State Verification Separation ---');
  {
    setTransactionKitFactoryForTesting(() => buildMockKit());
    const mockAdapter = new MockDataAccessAdapter();

    // Transaction succeeds on chain, but record is NOT found in contract storage (readback unverified)
    const unverifiedCheck = await verifyIntendedStateAfterSuccess(
      'create_round',
      'round-unverified-ghost',
      mockAdapter as any,
      callerAddress
    );
    assert(unverifiedCheck.verified === false, 'State verification returns verified: false when readback cannot find record');

    // Simulate modal logic: onSuccess must only be called if verify.verified === true
    let onSuccessInvoked = false;
    const mockOnSuccess = () => {
      onSuccessInvoked = true;
    };

    if (unverifiedCheck.verified) {
      mockOnSuccess();
    }
    assert(onSuccessInvoked === false, 'onSuccess is NOT invoked when post-state verification fails');
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 8: Transaction Persistence, Storage Degradation & Recovery
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 8: Storage Persistence Regressions & Failure Recovery ---');
  {
    setTransactionKitFactoryForTesting(() => buildMockKit());
    mockStore.clear();
    clearInMemoryBlockingMarkers();

    // Case 8a: Genuinely empty storage returns { status: 'empty', txs: [] }
    const emptyState = readPersistedTransactions();
    assert(emptyState.status === 'empty', 'Genuinely empty storage identified as status "empty"');
    assert(emptyState.txs.length === 0, 'Empty storage returns empty transactions array');

    // Case 8b: Corrupt JSON preserved; never overwritten or replaced with []
    mockStore.set('cf_active_txs_rc2', '{ corrupted json content that cannot parse');
    const corruptJsonState = readPersistedTransactions();
    assert(corruptJsonState.status === 'corrupt', 'Corrupt JSON identified as status "corrupt"');
    assert(corruptJsonState.corruptRaw === '{ corrupted json content that cannot parse', 'Corrupt raw string preserved intact');

    // Save attempt against corrupt storage is blocked and preserves data
    const saveAgainstCorrupt = savePersistedTransaction({
      txId: '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeee0001' as `0x${string}`,
      action: 'create_round',
      account: callerAddress,
      chainId: 61997,
      contractAddress,
      targetIdentifier: 'create_round:test-corrupt-preserve',
      compositeTargetKey: 'key',
      userValueWei: '0',
      feeValueWei: '0',
      totalValueWei: '0',
      submittedAt: Date.now(),
      status: 'submitted',
    });
    assert(saveAgainstCorrupt.success === false, 'savePersistedTransaction refuses to write when storage is corrupt');
    assert(saveAgainstCorrupt.corruptPreserved === true, 'savePersistedTransaction confirms corrupt data preserved');
    assert(mockStore.get('cf_active_txs_rc2') === '{ corrupted json content that cannot parse', 'Corrupt data remained completely unmodified');

    // Case 8c: Invalid record shapes identified as corrupt
    mockStore.set('cf_active_txs_rc2', JSON.stringify([{ notAValidTx: true }]));
    const invalidShapeState = readPersistedTransactions();
    assert(invalidShapeState.status === 'corrupt', 'Invalid record shapes identified as status "corrupt"');
    assert(invalidShapeState.error?.includes('invalid record shape') ?? false, 'Surfaces invalid record shape error');

    // Case 8d: Denied localStorage access (SecurityError)
    mockStorageDenied = true;
    const deniedState = readPersistedTransactions();
    assert(deniedState.status === 'denied', 'SecurityError identified as status "denied"');
    assert(deniedState.error?.includes('denied') ?? false, 'Surfaces access denied error');
    mockStorageDenied = false;

    // Case 8e: Quota failure BEFORE submission blocks wallet broadcast
    mockStore.clear();
    mockStorageFail = true;
    const quotaCheck = verifyStoragePersistenceWritable();
    assert(quotaCheck.writable === false, 'verifyStoragePersistenceWritable detects quota exceeded');
    assert(quotaCheck.error?.includes('quota') ?? false, 'Provides quota exceeded diagnostic');

    await assertThrows(
      async () =>
        prepareActionTransaction({
          action: 'create_round',
          provider,
          account: callerAddress,
          chainId: 61997,
          contractAddress,
          createRoundArgs: {
            round_id: 'round-quota-pre-block',
            title: 'Round Title',
            description: 'Round description text with sufficient length',
            charter_text: 'A'.repeat(120),
            committee_roster: [callerAddress, otherAddress],
            grant_cap_wei: 1000000000000000000n,
            nomination_cutoff: Math.floor(Date.now() / 1000) + 7200,
            voting_duration: 3600,
            round_end: Math.floor(Date.now() / 1000) + 7200 + 86400 + 3600 + 100,
            initial_deposit_wei: 2000000000000000000n,
          },
        }),
      'Persistence check failed before submission',
      'Pre-submission storage failure blocks transaction preparation'
    );
    mockStorageFail = false;

    // Case 8e2: A one-byte storage probe alone is insufficient evidence that the actual intent can be saved
    mockStore.clear();
    clearInMemoryBlockingMarkers();
    const mockAdapter = new MockDataAccessAdapter();
    const probeWritable = verifyStoragePersistenceWritable();
    assert(probeWritable.writable === true, 'One-byte storage write probe succeeds');

    const prepProbeTest = await prepareActionTransaction({
      action: 'nominate_proposal',
      provider,
      account: callerAddress,
      chainId: 61997,
      contractAddress,
      adapter: mockAdapter as any,
      roundId: 'round-probe-insufficient',
      nominateProposalArgs: {
        round_id: 'round-probe-insufficient',
        recipient: otherAddress,
        title: 'Probe Test Proposal',
        requested_amount_wei: 1000000000000000000n,
        deliverables_text: 'Deliverables text for testing one-byte probe insufficiency',
      },
    });

    // Simulate quota failure ONLY when saving the actual write intent before submit
    mockStorageFailOnPreSubmitIntent = true;
    let submitCalledOnQuotaFail = false;
    setTransactionKitFactoryForTesting(() => {
      const kit = buildMockKit();
      kit.submit = async () => {
        submitCalledOnQuotaFail = true;
        return { genlayerTxId: '0xmock' as `0x${string}` };
      };
      return kit;
    });

    await assertThrows(
      async () => executeAndTrackTransaction(prepProbeTest, provider, callerAddress),
      'Persistence check failed immediately before submit',
      'Actual intent persistence failure blocks kit.submit even though one-byte probe passed'
    );
    assert(submitCalledOnQuotaFail === false, 'kit.submit was never called when pre-submit write intent failed to save');
    mockStorageFailOnPreSubmitIntent = false;

    // Case 8e3: Two same-target calls cannot both pass the guard while provider
    // chain/account reads are delayed. The first call reserves synchronously.
    mockStore.clear();
    clearInMemoryBlockingMarkers();
    const delayedProvider = new MockEip1193Provider();
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const baseRequest = delayedProvider.request.bind(delayedProvider);
    delayedProvider.request = async (args: { method: string; params?: any[] }) => {
      await providerGate;
      return baseRequest(args);
    };

    let concurrentSubmitCalls = 0;
    setTransactionKitFactoryForTesting(() => {
      const kit = buildMockKit();
      const baseSubmit = kit.submit.bind(kit);
      kit.submit = async (quote, input) => {
        concurrentSubmitCalls++;
        return baseSubmit(quote, input);
      };
      return kit;
    });

    const firstConcurrent = executeAndTrackTransaction(
      prepProbeTest,
      delayedProvider,
      callerAddress
    );
    const secondConcurrent = executeAndTrackTransaction(
      prepProbeTest,
      delayedProvider,
      callerAddress
    );
    releaseProvider();

    await assertThrows(
      async () => secondConcurrent,
      'Double submission prevented',
      'Synchronous same-target reservation blocks a concurrent call during delayed provider reads'
    );
    await firstConcurrent;
    assert(concurrentSubmitCalls <= 1, 'Concurrent same-target calls invoke kit.submit at most once');

    // Case 8f: Storage failure when adding transaction ID retains intent as broadcast-unknown and blocks duplicate write
    mockStore.clear();
    clearInMemoryBlockingMarkers();
    setTransactionKitFactoryForTesting(() => buildMockKit());

    const prepForPostFail = await prepareActionTransaction({
      action: 'nominate_proposal',
      provider,
      account: callerAddress,
      chainId: 61997,
      contractAddress,
      adapter: mockAdapter as any,
      roundId: 'round-storage-post-fail',
      nominateProposalArgs: {
        round_id: 'round-storage-post-fail',
        recipient: otherAddress,
        title: 'Post Fail Proposal',
        requested_amount_wei: 1000000000000000000n,
        deliverables_text: 'Deliverables specification text with sufficient characters',
      },
    });

    // Simulate quota failure ONLY when adding txId after wallet submit succeeded
    mockStorageFailOnAddTxId = true;
    let reportedFailId: string | null = null;

    const persistedRecord = await executeAndTrackTransaction(prepForPostFail, provider, callerAddress, {
      onPersistenceFailure: (txId) => {
        reportedFailId = txId;
      },
    });

    assert(persistedRecord.storageFailure === true, 'Transaction record flagged with storageFailure: true');
    assert(persistedRecord.status === 'broadcast-unknown', 'Status retained as broadcast-unknown when update fails after broadcast');
    assert(reportedFailId === persistedRecord.txId, 'onPersistenceFailure callback invoked with copyable txId');
    assert(persistedRecord.txId?.startsWith('0x') ?? false, 'Transaction ID is returned and copyable');

    // In-memory blocking marker must be active for this session
    const inMemMarkers = getInMemoryBlockingMarkers();
    assert(inMemMarkers.length > 0, 'In-memory session marker retained despite localStorage failure');
    assert(
      inMemMarkers.some((m) => m.compositeTargetKey === prepForPostFail.compositeTargetKey),
      'In-memory marker tracks exact target key'
    );

    // Attempting a duplicate write to that target during this session MUST be blocked by in-memory marker
    await assertThrows(
      async () =>
        prepareActionTransaction({
          action: 'nominate_proposal',
          provider,
          account: callerAddress,
          chainId: 61997,
          contractAddress,
          adapter: mockAdapter as any,
          roundId: 'round-storage-post-fail',
          nominateProposalArgs: {
            round_id: 'round-storage-post-fail',
            recipient: otherAddress,
            title: 'Duplicate Attempt',
            requested_amount_wei: 1000000000000000000n,
            deliverables_text: 'Deliverables specification text with sufficient characters',
          },
        }),
      'failed to save in storage',
      'In-memory session marker blocks duplicate write even when storage saving failed'
    );

    mockStorageFailOnAddTxId = false;

    // Reload with surviving intent from Case 8f: resumeInFlightTracking flags manual reconciliation
    clearInMemoryBlockingMarkers();
    const reloadRes = await resumeInFlightTracking(provider, callerAddress);
    assert(reloadRes.manualReconciliationRequired === true, 'Reload with surviving broadcast-unknown intent flags manualReconciliationRequired');

    // After reload, duplicate write remains blocked by surviving persisted intent
    await assertThrows(
      async () =>
        prepareActionTransaction({
          action: 'nominate_proposal',
          provider,
          account: callerAddress,
          chainId: 61997,
          contractAddress,
          adapter: mockAdapter as any,
          roundId: 'round-storage-post-fail',
          nominateProposalArgs: {
            round_id: 'round-storage-post-fail',
            recipient: otherAddress,
            title: 'Duplicate After Reload',
            requested_amount_wei: 1000000000000000000n,
            deliverables_text: 'Deliverables specification text with sufficient characters',
          },
        }),
      'is already recorded for this target',
      'Surviving intent blocks duplicate write after page reload'
    );

    // Case 8f2: submit throws after possible broadcast: intent retained as broadcast-unknown, never deleted
    mockStore.clear();
    clearInMemoryBlockingMarkers();

    setTransactionKitFactoryForTesting(() => {
      const kit = buildMockKit();
      kit.submit = async () => {
        throw new Error('EIP-1193 transport network error after potential broadcast');
      };
      return kit;
    });

    const prepSubmitThrow = await prepareActionTransaction({
      action: 'nominate_proposal',
      provider,
      account: callerAddress,
      chainId: 61997,
      contractAddress,
      adapter: mockAdapter as any,
      roundId: 'round-submit-throws',
      nominateProposalArgs: {
        round_id: 'round-submit-throws',
        recipient: otherAddress,
        title: 'Submit Throw Proposal',
        requested_amount_wei: 1000000000000000000n,
        deliverables_text: 'Deliverables text for submit throw testing',
      },
    });

    await assertThrows(
      async () => executeAndTrackTransaction(prepSubmitThrow, provider, callerAddress),
      'EIP-1193 transport network error after potential broadcast',
      'executeAndTrackTransaction surfaces submit error when submit throws'
    );

    // Verify intent survived in storage
    const survivingStateAfterThrow = readPersistedTransactions();
    assert(survivingStateAfterThrow.txs.length === 1, 'Write intent was NOT deleted when submit threw');
    const survivingIntent = survivingStateAfterThrow.txs[0];
    assert(survivingIntent.status === 'broadcast-unknown', 'Surviving intent retained as broadcast-unknown');
    assert(survivingIntent.intentId.startsWith('intent_'), 'Surviving intent retains unique intentId');
    assert(survivingIntent.error?.includes('Submit threw after potential broadcast') ?? false, 'Surviving intent records diagnostic error');

    // Duplicate write is blocked across reload
    await assertThrows(
      async () =>
        prepareActionTransaction({
          action: 'nominate_proposal',
          provider,
          account: callerAddress,
          chainId: 61997,
          contractAddress,
          adapter: mockAdapter as any,
          roundId: 'round-submit-throws',
          nominateProposalArgs: {
            round_id: 'round-submit-throws',
            recipient: otherAddress,
            title: 'Duplicate Attempt',
            requested_amount_wei: 1000000000000000000n,
            deliverables_text: 'Deliverables text for submit throw testing',
          },
        }),
      'is already recorded for this target',
      'Surviving broadcast-unknown intent blocks duplicate write'
    );

    // Reload with surviving intent provides manual reconciliation path without auto-retry
    const reloadThrowRes = await resumeInFlightTracking(provider, callerAddress);
    assert(reloadThrowRes.manualReconciliationRequired === true, 'Reload with surviving broadcast-unknown intent reports manual reconciliation required');
    const checkStateStillPreserved = readPersistedTransactions();
    assert(checkStateStillPreserved.txs.length === 1, 'Manual reconciliation path preserves intent without deleting or auto-retrying');

    // Case 8g: Reload with corrupt storage reports manual reconciliation required
    mockStore.set('cf_active_txs_rc2', '{ corrupted json on page reload');
    let reportedStorageErr: string | null = null;
    const resumeRes = await resumeInFlightTracking(
      provider,
      callerAddress,
      undefined,
      (err) => {
        reportedStorageErr = err;
      }
    );
    assert(resumeRes.manualReconciliationRequired === true, 'resumeInFlightTracking flags manualReconciliationRequired: true on corrupt storage');
    assert(reportedStorageErr !== null, 'onStorageError alerted on reload with corrupt storage');
    assert(resumeRes.resumedCount === 0, 'resumedCount is 0 (does not claim safe resubmission)');

    // Case 8h: Update failures are surfaced
    mockStore.clear();
    const validTx: PersistedTx = {
      txId: '0x2222333344445555666677778888999900001111222233334444555566667777' as `0x${string}`,
      action: 'create_round',
      account: callerAddress,
      chainId: 61997,
      contractAddress,
      targetIdentifier: 'create_round:update-test',
      compositeTargetKey: 'key-upd',
      userValueWei: '0',
      feeValueWei: '0',
      totalValueWei: '0',
      submittedAt: Date.now(),
      status: 'pending',
    };
    savePersistedTransaction(validTx);

    mockStorageFail = true;
    const updateFailRes = updatePersistedTransaction(validTx.txId, { status: 'accepted' });
    assert(updateFailRes.error !== undefined, 'updatePersistedTransaction surfaces storage write error');
    assert(updateFailRes.error?.includes('Failed to persist update') ?? false, 'Surfaces explicit update failure diagnostic');
    mockStorageFail = false;
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 9: In-Flight & Timeout Duplicate Write Blocking
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 9: Duplicate Blocking Across All In-Flight & Timeout States ---');
  {
    setTransactionKitFactoryForTesting(() => buildMockKit());
    clearPersistedTransactions();
    mockStore.clear();

    const target = 'create_round:round-block-test';
    const key = buildCompositeTargetKey(callerAddress, 61997, contractAddress, target);

    const statusesToTest: Array<'submitted' | 'pending' | 'processing' | 'accepted' | 'timeout' | 'unresolved'> = [
      'submitted',
      'pending',
      'processing',
      'accepted',
      'timeout',
      'unresolved',
    ];

    for (const status of statusesToTest) {
      clearPersistedTransactions();
      mockStore.clear();
      const mockTx: PersistedTx = {
        txId: `0x1111222233334444555566667777888899990000aaaabbbbccccddddeeee0000` as `0x${string}`,
        action: 'create_round',
        roundId: 'round-block-test',
        account: callerAddress.toLowerCase(),
        chainId: 61997,
        contractAddress: contractAddress.toLowerCase(),
        targetIdentifier: target,
        compositeTargetKey: key,
        userValueWei: '2000000000000000000',
        feeValueWei: '50000000000000000',
        totalValueWei: '2050000000000000000',
        submittedAt: Date.now(),
        status,
      };
      savePersistedTransaction(mockTx);

      await assertThrows(
        async () =>
          prepareActionTransaction({
            action: 'create_round',
            provider,
            account: callerAddress,
            chainId: 61997,
            contractAddress,
            createRoundArgs: {
              round_id: 'round-block-test',
              title: 'Blocked Round',
              description: 'Round description with sufficient character length',
              charter_text: 'A'.repeat(120),
              committee_roster: [callerAddress, otherAddress],
              grant_cap_wei: 1000000000000000000n,
              nomination_cutoff: Math.floor(Date.now() / 1000) + 7200,
              voting_duration: 3600,
              round_end: Math.floor(Date.now() / 1000) + 7200 + 86400 + 3600 + 100,
              initial_deposit_wei: 2000000000000000000n,
            },
          }),
        `An active transaction (${mockTx.txId.slice(0, 10)}...) with status "${status}" is already recorded`,
        `Status "${status}" blocks duplicate write submission`
      );
    }
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 10: Final Transaction Classification
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 10: Final Transaction Classification & Inconclusive Outcomes ---');
  {
    clearPersistedTransactions();
    mockStore.clear();

    // Case 10a: FINISHED_WITH_RETURN and ACCEPTED -> finalized-success
    setTransactionKitFactoryForTesting(() =>
      buildMockKit({
        statusName: 'ACCEPTED',
        executionResultName: 'FINISHED_WITH_RETURN',
      })
    );
    const prepSuccess = await prepareActionTransaction({
      action: 'create_round',
      provider,
      account: callerAddress,
      chainId: 61997,
      contractAddress,
      createRoundArgs: {
        round_id: 'round-class-success',
        title: 'Success Round',
        description: 'Description text',
        charter_text: 'A'.repeat(120),
        committee_roster: [callerAddress, otherAddress],
        grant_cap_wei: 1000000000000000000n,
        nomination_cutoff: Math.floor(Date.now() / 1000) + 7200,
        voting_duration: 3600,
        round_end: Math.floor(Date.now() / 1000) + 7200 + 86400 + 3600 + 100,
        initial_deposit_wei: 2000000000000000000n,
      },
    });
    const txSuccess = await executeAndTrackTransaction(prepSuccess, provider, callerAddress);
    assert(txSuccess.status === 'finalized-success', 'ACCEPTED + FINISHED_WITH_RETURN classifies as finalized-success');

    // Case 10b: Conclusive failure results explicitly reported by chain -> finalized-error
    const explicitFailures = [
      'FINISHED_WITH_ERROR',
      'EXECUTION_FAILED',
      'REVERTED',
      'ERROR',
      'FAILED',
    ];

    for (const failResult of explicitFailures) {
      clearPersistedTransactions();
      mockStore.clear();
      setTransactionKitFactoryForTesting(() =>
        buildMockKit({
          statusName: 'FINALIZED',
          executionResultName: failResult,
        })
      );
      const prepFail = await prepareActionTransaction({
        action: 'create_round',
        provider,
        account: callerAddress,
        chainId: 61997,
        contractAddress,
        createRoundArgs: {
          round_id: `round-class-fail-${failResult}`,
          title: 'Fail Round',
          description: 'Description text',
          charter_text: 'A'.repeat(120),
          committee_roster: [callerAddress, otherAddress],
          grant_cap_wei: 1000000000000000000n,
          nomination_cutoff: Math.floor(Date.now() / 1000) + 7200,
          voting_duration: 3600,
          round_end: Math.floor(Date.now() / 1000) + 7200 + 86400 + 3600 + 100,
          initial_deposit_wei: 2000000000000000000n,
        },
      });
      const txFail = await executeAndTrackTransaction(prepFail, provider, callerAddress);
      assert(txFail.status === 'finalized-error', `Conclusive failure "${failResult}" classifies as finalized-error`);
    }

    // Explicit REJECTED or CANCELED status -> finalized-error
    for (const statusName of ['REJECTED', 'CANCELED']) {
      clearPersistedTransactions();
      mockStore.clear();
      setTransactionKitFactoryForTesting(() =>
        buildMockKit({
          statusName,
          executionResultName: null,
        })
      );
      const prepReject = await prepareActionTransaction({
        action: 'create_round',
        provider,
        account: callerAddress,
        chainId: 61997,
        contractAddress,
        createRoundArgs: {
          round_id: `round-class-reject-${statusName}`,
          title: 'Reject Round',
          description: 'Description text',
          charter_text: 'A'.repeat(120),
          committee_roster: [callerAddress, otherAddress],
          grant_cap_wei: 1000000000000000000n,
          nomination_cutoff: Math.floor(Date.now() / 1000) + 7200,
          voting_duration: 3600,
          round_end: Math.floor(Date.now() / 1000) + 7200 + 86400 + 3600 + 100,
          initial_deposit_wei: 2000000000000000000n,
        },
      });
      const txReject = await executeAndTrackTransaction(prepReject, provider, callerAddress);
      assert(txReject.status === 'finalized-error', `Status "${statusName}" classifies as finalized-error`);
    }

    // Case 10c: Finalized phase with MISSING executionResultName -> unresolved (blocks duplicate write)
    clearPersistedTransactions();
    mockStore.clear();
    setTransactionKitFactoryForTesting(() =>
      buildMockKit({
        statusName: 'FINALIZED',
        executionResultName: null, // Missing execution result!
      })
    );
    const prepMissingResult = await prepareActionTransaction({
      action: 'create_round',
      provider,
      account: callerAddress,
      chainId: 61997,
      contractAddress,
      createRoundArgs: {
        round_id: 'round-class-missing-exec',
        title: 'Missing Exec Round',
        description: 'Description text',
        charter_text: 'A'.repeat(120),
        committee_roster: [callerAddress, otherAddress],
        grant_cap_wei: 1000000000000000000n,
        nomination_cutoff: Math.floor(Date.now() / 1000) + 7200,
        voting_duration: 3600,
        round_end: Math.floor(Date.now() / 1000) + 7200 + 86400 + 3600 + 100,
        initial_deposit_wei: 2000000000000000000n,
      },
    });
    const txMissingResult = await executeAndTrackTransaction(prepMissingResult, provider, callerAddress);
    assert(txMissingResult.status === 'unresolved', 'Finalized phase with missing executionResultName classifies as unresolved');

    // Duplicate write to that target MUST be blocked
    await assertThrows(
      async () =>
        prepareActionTransaction({
          action: 'create_round',
          provider,
          account: callerAddress,
          chainId: 61997,
          contractAddress,
          createRoundArgs: {
            round_id: 'round-class-missing-exec',
            title: 'Duplicate Attempt',
            description: 'Description text',
            charter_text: 'A'.repeat(120),
            committee_roster: [callerAddress, otherAddress],
            grant_cap_wei: 1000000000000000000n,
            nomination_cutoff: Math.floor(Date.now() / 1000) + 7200,
            voting_duration: 3600,
            round_end: Math.floor(Date.now() / 1000) + 7200 + 86400 + 3600 + 100,
            initial_deposit_wei: 2000000000000000000n,
          },
        }),
      'already recorded for this target',
      'Unresolved outcome blocks duplicate write'
    );

    // Case 10d: Finalized phase with UNKNOWN executionResultName -> unresolved (blocks duplicate write)
    clearPersistedTransactions();
    mockStore.clear();
    setTransactionKitFactoryForTesting(() =>
      buildMockKit({
        statusName: 'FINALIZED',
        executionResultName: 'CUSTOM_UNKNOWN_CHAIN_CODE',
      })
    );
    const prepUnknownResult = await prepareActionTransaction({
      action: 'create_round',
      provider,
      account: callerAddress,
      chainId: 61997,
      contractAddress,
      createRoundArgs: {
        round_id: 'round-class-unknown-exec',
        title: 'Unknown Exec Round',
        description: 'Description text',
        charter_text: 'A'.repeat(120),
        committee_roster: [callerAddress, otherAddress],
        grant_cap_wei: 1000000000000000000n,
        nomination_cutoff: Math.floor(Date.now() / 1000) + 7200,
        voting_duration: 3600,
        round_end: Math.floor(Date.now() / 1000) + 7200 + 86400 + 3600 + 100,
        initial_deposit_wei: 2000000000000000000n,
      },
    });
    const txUnknownResult = await executeAndTrackTransaction(prepUnknownResult, provider, callerAddress);
    assert(txUnknownResult.status === 'unresolved', 'Finalized phase with unknown executionResultName classifies as unresolved');
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 11: State Transitions for Other Contract Actions
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 11: Exact State Transition Checks for All Other Actions ---');
  {
    const mockAdapter = new MockDataAccessAdapter();

    // evaluate_charter_fit: fails if proposal remains SUBMITTED
    mockAdapter.proposals['prp-eval-test'] = {
      id: 'prp-eval-test',
      roundId: 'round-eval',
      roundTitle: 'Round',
      title: 'Eval Proposal',
      requestedGen: 1,
      recipientAddress: otherAddress,
      nominatorAddress: callerAddress,
      status: 'SUBMITTED', // Not transitioned!
      workDescription: 'Work',
      deliverables: [],
      matchedRuleIds: [],
      votes: { yesCount: 0, noCount: 0, requiredYes: 2, deadlineRemaining: '24h' },
      eventLog: [],
      createdAt: '2026-10-13',
    };
    const evalFail = await verifyIntendedStateAfterSuccess(
      'evaluate_charter_fit',
      'prp-eval-test',
      mockAdapter as any
    );
    assert(evalFail.verified === false, 'evaluate_charter_fit fails verification if state remained SUBMITTED');

    // evaluate_charter_fit: passes when state is ELIGIBLE
    mockAdapter.proposals['prp-eval-test'].status = 'ELIGIBLE';
    const evalPass = await verifyIntendedStateAfterSuccess(
      'evaluate_charter_fit',
      'prp-eval-test',
      mockAdapter as any
    );
    assert(evalPass.verified === true, 'evaluate_charter_fit verifies transition to ELIGIBLE');

    // settle_expired_proposal: fails if state did not transition (deadlines not lapsed)
    mockAdapter.proposals['prp-settle-test'] = {
      id: 'prp-settle-test',
      roundId: 'round-settle',
      roundTitle: 'Round',
      title: 'Settle Proposal',
      requestedGen: 1,
      recipientAddress: otherAddress,
      nominatorAddress: callerAddress,
      status: 'VOTING', // Still voting; deadline did not lapse!
      workDescription: 'Work',
      deliverables: [],
      matchedRuleIds: [],
      votes: { yesCount: 0, noCount: 0, requiredYes: 2, deadlineRemaining: '24h' },
      eventLog: [],
      createdAt: '2026-10-13',
    };
    const settleFail = await verifyIntendedStateAfterSuccess(
      'settle_expired_proposal',
      'prp-settle-test',
      mockAdapter as any
    );
    assert(settleFail.verified === false, 'settle_expired_proposal fails if proposal remains in VOTING state');

    // settle_expired_proposal: passes when state is EXPIRED or REJECTED
    mockAdapter.proposals['prp-settle-test'].status = 'REJECTED';
    const settlePass = await verifyIntendedStateAfterSuccess(
      'settle_expired_proposal',
      'prp-settle-test',
      mockAdapter as any
    );
    assert(settlePass.verified === true, 'settle_expired_proposal verifies transition to REJECTED');

    // cast_vote: verifies voter participation in event log
    mockAdapter.proposals['prp-vote-test'] = {
      id: 'prp-vote-test',
      roundId: 'round-vote',
      roundTitle: 'Round',
      title: 'Vote Proposal',
      requestedGen: 1,
      recipientAddress: otherAddress,
      nominatorAddress: callerAddress,
      status: 'VOTING',
      workDescription: 'Work',
      deliverables: [],
      matchedRuleIds: [],
      votes: { yesCount: 1, noCount: 0, requiredYes: 2, deadlineRemaining: '24h' },
      eventLog: [{ voterNode: callerAddress, description: 'Ballot cast' }],
      createdAt: '2026-10-13',
    };
    const votePass = await verifyIntendedStateAfterSuccess(
      'cast_vote',
      'prp-vote-test',
      mockAdapter as any,
      callerAddress
    );
    assert(votePass.verified === true, 'cast_vote verifies voter recorded in voter log');
  }

  // Reset kit factory
  setTransactionKitFactoryForTesting(null);

  console.log('\n================================================================');
  console.log(`ALL WRITE REGRESSION TESTS PASSED: ${passedTests} / ${totalTests}`);
  console.log('================================================================');
}

runWriteTests().catch((err) => {
  console.error('\n❌ TEST RUNNER CRASHED:', err);
  process.exit(1);
});
