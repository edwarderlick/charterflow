/**
 * Comprehensive Unit Tests for TruthfulLiveDataAccessAdapter.
 *
 * Verifies:
 * 1. Unconfigured contract address (returns empty arrays / null truthfully without RPC calls).
 * 2. Zero rounds on configured contract (genuinely EMPTY chain state, no error).
 * 3. Paginated reads in bounded chunks (max 50, validates count, unique IDs).
 * 4. Malformed responses, negative/non-integer counts, short pages, and duplicate IDs (fail-closed, throws informative error).
 * 5. RPC timeouts and network errors (fail-closed, throws informative error, never swallowed as empty/null).
 * 6. RC network preset (studioDevnet for chain 61997, never spreading studionet, preserves all RC fields).
 * 7. Missing optional fields handled safely; AI score is null (never manufactured as 95).
 * 8. Known voter with unknown vote stance (voted_addresses proves participation only; choice is labeled unrecorded, never manufactured as YES).
 */

import {
  TruthfulLiveDataAccessAdapter,
  weiToGen,
  validateSafeCount,
  validateWei,
  withTimeout,
  mapContractProposalState,
  mapContractRoundState,
} from '../frontend/src/services/dataAccess';
import { NETWORK_CONFIG, VERIFIED_DEPLOYMENT, isContractConfigured } from '../frontend/src/config/network';
import { studioDevnet, studionet } from 'genlayer-js/chains';

interface MockCall {
  functionName: string;
  args: any[];
}

class MockGenLayerClient {
  calls: MockCall[] = [];
  responses: Record<string, any | ((args: any[]) => any)> = {};

  setResponse(functionName: string, resp: any | ((args: any[]) => any)) {
    this.responses[functionName] = resp;
  }

  async readContract(params: { address: string; functionName: string; args: any[] }) {
    this.calls.push({ functionName: params.functionName, args: params.args });
    const handler = this.responses[params.functionName];
    if (handler === undefined) {
      throw new Error(`[MockClient] Unhandled functionName: ${params.functionName}`);
    }
    if (typeof handler === 'function') {
      return handler(params.args);
    }
    return handler;
  }
}

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

async function runTests() {
  console.log('================================================================');
  console.log('CHARTERFLOW FRONTEND LIVE READS ADAPTER TEST SUITE');
  console.log('================================================================\n');

  const DUMMY_CONTRACT = '0x1234567890123456789012345678901234567890';

  // --------------------------------------------------------------------------
  // TEST SUITE 1: Default verified address vs explicit unconfigured
  // --------------------------------------------------------------------------
  console.log('--- Test Suite 1: Default verified address vs explicit unconfigured ---');
  {
    assert(
      NETWORK_CONFIG.contractAddress.toLowerCase() === VERIFIED_DEPLOYMENT.contractAddress.toLowerCase(),
      'NETWORK_CONFIG defaults to the verified Studio Next deployment'
    );
    assert(isContractConfigured(), 'Empty/missing VITE_CONTRACT_ADDRESS still counts as configured via the verified default');

    const defaultAdapter = new TruthfulLiveDataAccessAdapter(new MockGenLayerClient(), '');
    assert(
      defaultAdapter.isConfigured(),
      'Blank constructor address uses the verified deployment instead of an unconfigured live UI'
    );

    const ZERO = '0x0000000000000000000000000000000000000000';
    const mockClient = new MockGenLayerClient();
    const adapter = new TruthfulLiveDataAccessAdapter(mockClient, ZERO);

    assert(!adapter.isConfigured(), 'Adapter reports isConfigured() = false for the zero address');

    const rounds = await adapter.getRounds();
    assert(Array.isArray(rounds) && rounds.length === 0, 'Unconfigured address returns empty rounds array');

    const round = await adapter.getRoundById('round-1');
    assert(round === null, 'Unconfigured address returns null for round by ID');

    const proposals = await adapter.getProposalsByRound('round-1');
    assert(Array.isArray(proposals) && proposals.length === 0, 'Unconfigured address returns empty proposals array');

    const proposal = await adapter.getProposalById('prp-1');
    assert(proposal === null, 'Unconfigured address returns null for proposal by ID');

    const activity = await adapter.getUserActivity('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    assert(
      activity.claimableCredits.length === 0 &&
      activity.nominatedProposals.length === 0 &&
      activity.roundsDeployed.length === 0 &&
      activity.votesCast.length === 0,
      'Unconfigured address returns zeroed user activity structure'
    );

    assert(mockClient.calls.length === 0, 'No RPC calls are made when contract is unconfigured');
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 2: Zero Rounds on Configured Contract (Genuinely Empty)
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 2: Configured Contract with Zero Rounds (Empty State) ---');
  {
    const mockClient = new MockGenLayerClient();
    mockClient.setResponse('get_round_ids_count', () => 0);

    const adapter = new TruthfulLiveDataAccessAdapter(mockClient, DUMMY_CONTRACT);
    assert(adapter.isConfigured(), 'Adapter is configured with valid address');

    const rounds = await adapter.getRounds();
    assert(Array.isArray(rounds) && rounds.length === 0, 'Configured contract with 0 rounds returns empty array without throwing');
    assert(mockClient.calls.length === 1, 'Only get_round_ids_count was queried');
    assert(mockClient.calls[0].functionName === 'get_round_ids_count', 'Queried get_round_ids_count');
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 3: >50 Proposals Paginated Reads (Bounded Chunks)
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 3: >50 Proposals Paginated Reads ---');
  {
    const mockClient = new MockGenLayerClient();
    const totalCount = 75;

    mockClient.setResponse('get_round_proposals_count', (args: any[]) => {
      assert(args[0] === 'round-large', 'Queries proposal count for target round');
      return totalCount;
    });

    mockClient.setResponse('get_round_proposals_summary', (args: any[]) => {
      const [roundId, offset, limit] = args;
      assert(roundId === 'round-large', 'Queries correct round ID');
      assert(limit <= 50, `Bounded page limit <= 50 (got ${limit})`);

      const items = [];
      const end = Math.min(offset + limit, totalCount);
      for (let i = offset + 1; i <= end; i++) {
        items.push({
          proposal_id: `prp-${roundId}-${i}`,
          round_id: roundId,
          proposer: '0x1111111111111111111111111111111111111111',
          recipient: '0x2222222222222222222222222222222222222222',
          title: `Proposal ${i}`,
          requested_amount_wei: '1000000000000000000', // 1 GEN
          deliverables_preview: `Preview deliverables for proposal ${i}`,
          submission_timestamp: 1700000000 + i,
          state: i % 2 === 0 ? 'VOTING' : 'SUBMITTED',
          review_verdict: 'ELIGIBLE',
          voting_deadline: 1700100000,
          votes_yes: 2,
          votes_no: 0,
          credit_withdrawn: false,
        });
      }
      return items;
    });

    const adapter = new TruthfulLiveDataAccessAdapter(mockClient, DUMMY_CONTRACT);
    const proposals = await adapter.getProposalsByRound('round-large');

    assert(proposals.length === 75, `Successfully fetched all ${totalCount} proposals across multiple pages`);
    assert(proposals[0].id === 'prp-round-large-1', 'First proposal ID matches page 1 first item');
    assert(proposals[74].id === 'prp-round-large-75', 'Last proposal ID matches page 2 last item');
    assert(proposals[0].requestedGen === 1, 'weiToGen correctly converts 1e18 wei to 1 GEN');

    const summaryCalls = mockClient.calls.filter((c) => c.functionName === 'get_round_proposals_summary');
    assert(summaryCalls.length === 2, `Pagination executed exactly 2 pages for 75 items (got ${summaryCalls.length})`);
    assert(summaryCalls[0].args[1] === 0 && summaryCalls[0].args[2] === 50, 'Page 1 offset=0, limit=50');
    assert(summaryCalls[1].args[1] === 50 && summaryCalls[1].args[2] === 25, 'Page 2 offset=50, limit=25');
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 4: Malformed Responses, Short Pages, and Duplicate IDs
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 4: Malformed Responses, Short Pages, & Duplicate IDs ---');
  {
    const mockClient = new MockGenLayerClient();
    const adapter = new TruthfulLiveDataAccessAdapter(mockClient, DUMMY_CONTRACT);

    // 4a. Malformed round count (string/NaN)
    mockClient.setResponse('get_round_ids_count', () => 'invalid_count_string');
    await assertThrows(
      () => adapter.getRounds(),
      'Malformed response: get_round_ids_count',
      'Non-integer round count throws descriptive error'
    );

    // 4b. Negative round count
    mockClient.setResponse('get_round_ids_count', () => -3);
    await assertThrows(
      () => adapter.getRounds(),
      'expected non-negative integer count',
      'Negative round count throws descriptive error'
    );

    // 4c. Incomplete page (short page length returned by contract)
    mockClient.setResponse('get_round_ids_count', () => 5);
    mockClient.setResponse('get_round_ids', () => ['round-1', 'round-2']); // expected 5, returned 2
    await assertThrows(
      () => adapter.getRounds(),
      'Incomplete page',
      'Short page (fewer items than requested limit) throws Incomplete page error'
    );

    // 4d. Duplicate IDs in page
    mockClient.setResponse('get_round_ids_count', () => 3);
    mockClient.setResponse('get_round_ids', () => ['round-1', 'round-duplicate', 'round-duplicate']);
    await assertThrows(
      () => adapter.getRounds(),
      'duplicate round ID',
      'Duplicate round IDs in pagination throw explicit error'
    );

    // 4e. get_round returning invalid object
    mockClient.setResponse('get_round', () => ({ missing_round_id: true }));
    await assertThrows(
      () => adapter.getRoundById('round-broken'),
      'missing round_id',
      'get_round missing round_id throws descriptive error'
    );

    // 4f. Short proposal page
    mockClient.setResponse('get_round_proposals_count', () => 10);
    mockClient.setResponse('get_round_proposals_summary', () => [
      { proposal_id: 'prp-1' }, // expected 10, returned 1
    ]);
    await assertThrows(
      () => adapter.getProposalsByRound('round-short'),
      'Incomplete page',
      'Short proposal summary page throws Incomplete page error'
    );

    // 4g. Duplicate proposal IDs
    mockClient.setResponse('get_round_proposals_count', () => 2);
    mockClient.setResponse('get_round_proposals_summary', () => [
      { proposal_id: 'prp-dup', round_id: 'r1', state: 'VOTING' },
      { proposal_id: 'prp-dup', round_id: 'r1', state: 'VOTING' },
    ]);
    await assertThrows(
      () => adapter.getProposalsByRound('round-dup'),
      'duplicate proposal ID',
      'Duplicate proposal IDs in pagination throw explicit error'
    );

    // 4h. Failed get_round_proposals_count must remain an error (never substituted)
    mockClient.setResponse('get_round_proposals_count', () => {
      throw new Error('RPC error: get_round_proposals_count execution reverted');
    });
    await assertThrows(
      () => adapter.getProposalsByRound('round-failed-count'),
      'get_round_proposals_count execution reverted',
      'Failed get_round_proposals_count remains an error (never substitutes proposal_nonce)'
    );

    // 4i. get_round with missing required wei field
    mockClient.setResponse('get_round_proposals_count', () => 0);
    mockClient.setResponse('get_round', () => ({
      round_id: 'round-missing-money',
      creator: '0x1111111111111111111111111111111111111111',
      title: 'Missing Money Round',
      summary: 'Summary',
      charter_rule_ids: [],
      member_addresses: [],
      // total_pool_wei is missing
      available_wei: '1000000000000000000',
      reserved_wei: '0',
      approved_wei: '0',
      withdrawn_wei: '0',
      cap_per_proposal_wei: '1000000000000000000',
      round_start: 1700000000,
      round_end: 1700100000,
      state: 'ACTIVE',
    }));
    await assertThrows(
      () => adapter.getRoundById('round-missing-money'),
      'required wei value is missing',
      'Missing required money field in getRoundById throws (never displays as 0 GEN)'
    );

    // 4j. get_proposal with missing required requested_amount_wei
    mockClient.setResponse('get_proposal', () => ({
      proposal_id: 'prp-missing-req',
      round_id: 'round-1',
      proposer: '0x1111111111111111111111111111111111111111',
      recipient: '0x2222222222222222222222222222222222222222',
      title: 'Missing Requested Wei',
      // requested_amount_wei is missing
      deliverables_text: 'Deliverables',
      submission_timestamp: 1700000000,
      state: 'ELIGIBLE',
      review_verdict: 'ELIGIBLE',
      voting_deadline: 1700100000,
      votes_yes: 0,
      votes_no: 0,
      credit_withdrawn: false,
    }));
    await assertThrows(
      () => adapter.getProposalById('prp-missing-req'),
      'required wei value is missing',
      'Missing required requested_amount_wei in getProposalById throws (never displays as 0 GEN)'
    );
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 5: RPC Timeouts and Network Errors (Fail-Closed)
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 5: RPC Timeouts & Network Failures ---');
  {
    const mockClient = new MockGenLayerClient();
    const adapter = new TruthfulLiveDataAccessAdapter(mockClient, DUMMY_CONTRACT);

    // 5a. getRounds bubbles network exception
    mockClient.setResponse('get_round_ids_count', () => {
      throw new Error('ECONNREFUSED 127.0.0.1:4000');
    });
    await assertThrows(
      () => adapter.getRounds(),
      'ECONNREFUSED',
      'Network exception in getRounds bubbles up to caller (never swallowed as empty array)'
    );

    // 5b. getRoundById bubbles 504 Gateway Timeout
    mockClient.setResponse('get_round', () => {
      throw new Error('504 Gateway Timeout: upstream RPC did not respond');
    });
    await assertThrows(
      () => adapter.getRoundById('round-fail'),
      '504 Gateway Timeout',
      '504 Timeout in getRoundById bubbles up to caller (never swallowed as null / 404)'
    );

    // 5c. withTimeout enforces timeout
    let timedOut = false;
    try {
      await withTimeout(new Promise((resolve) => setTimeout(resolve, 500)), 50, 'Strict timeout check');
    } catch (err: any) {
      if (err.message.includes('exceeded 50ms limit')) {
        timedOut = true;
      }
    }
    assert(timedOut, 'withTimeout helper rejects when operation exceeds specified limit');
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 6: Chain Preset Verification (RC studioDevnet vs studionet)
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 6: Chain Preset Verification ---');
  {
    // Verify studioDevnet definition in installed genlayer-js@2.0.0-rc.1
    assert(studioDevnet.id === 61997, 'studioDevnet chain ID is 61997 (Chain ID for Studio Next)');
    assert(studioDevnet.name === 'GenLayer Studio Devnet', 'studioDevnet preset name is "GenLayer Studio Devnet"');
    assert(studioDevnet.isStudio === true, 'studioDevnet is marked isStudio: true');
    assert(Boolean(studioDevnet.consensusMainContract), 'studioDevnet defines consensusMainContract');
    assert(Boolean(studioDevnet.consensusDataContract), 'studioDevnet defines consensusDataContract');
    assert(studioDevnet.defaultNumberOfInitialValidators === 5, 'studioDevnet default initial validators is 5');

    // Verify studionet is the different chain 61999 and must not be spread
    assert(studionet.id === 61999, 'studionet chain ID is 61999 (NOT 61997)');
    assert(studionet.id !== studioDevnet.id, 'studionet ID (61999) differs from studioDevnet ID (61997)');

    // Verify TruthfulLiveDataAccessAdapter getClient creates client with studioDevnet preset
    const adapter = new TruthfulLiveDataAccessAdapter(undefined, DUMMY_CONTRACT);
    const client = adapter.getClient();
    assert(client !== null && client !== undefined, 'Adapter initializes client');
    assert(client.chain.id === 61997, 'Adapter client chain ID is 61997');
    assert(client.chain.name === 'GenLayer Studio Devnet', 'Adapter client chain name matches studioDevnet');
    assert(
      client.chain.consensusMainContract.address === studioDevnet.consensusMainContract.address,
      'Preserves consensusMainContract from studioDevnet'
    );
    assert(
      client.chain.consensusDataContract.address === studioDevnet.consensusDataContract.address,
      'Preserves consensusDataContract from studioDevnet'
    );
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 7: Missing Optional Fields & No Manufactured Scores
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 7: Missing Optional Fields & No Fabricated Scores ---');
  {
    const mockClient = new MockGenLayerClient();
    const adapter = new TruthfulLiveDataAccessAdapter(mockClient, DUMMY_CONTRACT);

    mockClient.setResponse('get_proposal', () => ({
      proposal_id: 'prp-sparse-1',
      round_id: 'round-1',
      proposer: '0x1111111111111111111111111111111111111111',
      recipient: '0x2222222222222222222222222222222222222222',
      title: 'Sparse Fields Proposal',
      requested_amount_wei: '0',
      deliverables_text: '',
      submission_timestamp: 0,
      state: 'ELIGIBLE',
      review_verdict: 'ELIGIBLE',
      review_reason: '', // empty reason
      voting_deadline: 0, // 0 deadline
      votes_yes: 0,
      votes_no: 0,
      voted_addresses: [],
      credit_withdrawn: false,
    }));

    const p = await adapter.getProposalById('prp-sparse-1');
    assert(p !== null, 'Proposal with sparse fields parses successfully');
    assert(p!.aiEvaluation?.score === null, 'aiEvaluation.score is null (never manufactured as 95)');
    assert(p!.aiEvaluation?.status === 'ELIGIBLE', 'aiEvaluation.status is ELIGIBLE');
    assert(p!.aiEvaluation?.oracleSynthesis === 'Automated compliance review', 'Fallback reason provided');
    assert(p!.votes.deadlineRemaining === 'NO ON-CHAIN DEADLINE', '0 deadline labeled "NO ON-CHAIN DEADLINE"');
    assert(p!.votes.targetBlock === undefined, 'targetBlock is undefined (never manufactured as #0)');
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 8: Known Voter with Unknown Vote Stance
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 8: Known Voter with Unknown Vote Stance ---');
  {
    const voterAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const mockClient = new MockGenLayerClient();
    const adapter = new TruthfulLiveDataAccessAdapter(mockClient, DUMMY_CONTRACT);

    mockClient.setResponse('get_proposal', () => ({
      proposal_id: 'prp-vote-test',
      round_id: 'round-gov',
      proposer: '0x1111111111111111111111111111111111111111',
      recipient: '0x2222222222222222222222222222222222222222',
      title: 'Secret Ballot Verification',
      requested_amount_wei: '2000000000000000000',
      deliverables_text: 'Complete governance deliverables text',
      submission_timestamp: 1710000000,
      state: 'VOTING',
      review_verdict: 'ELIGIBLE',
      review_reason: 'Eligible for governance voting',
      voting_deadline: 1710500000,
      votes_yes: 1, // On-chain tally totals
      votes_no: 0,
      voted_addresses: [voterAddress], // Proves participation only
      credit_withdrawn: false,
    }));

    const p = await adapter.getProposalById('prp-vote-test');
    assert(p !== null, 'Proposal fetched');
    assert(p!.votes.yesCount === 1, 'Total YES votes is 1');
    assert(p!.votes.noCount === 0, 'Total NO votes is 0');
    assert(p!.eventLog.length === 1, 'Event log records 1 voter participation entry');
    assert(p!.eventLog[0].voterNode === voterAddress.toLowerCase(), 'Voter address recorded in event log');
    assert(p!.eventLog[0].stance === undefined, 'Per-voter stance is undefined (never manufactured as YES)');
    assert(
      p!.eventLog[0].description.includes('choice unrecorded on-chain'),
      'Description states choice unrecorded on-chain'
    );

    // Verify getUserActivity for this voter
    mockClient.setResponse('get_round_ids_count', () => 0);
    mockClient.setResponse('get_all_proposal_ids_count', () => 1);
    mockClient.setResponse('get_all_proposal_ids', () => ['prp-vote-test']);

    const activity = await adapter.getUserActivity(voterAddress);
    assert(activity.votesCast.length === 1, 'User activity records 1 cast vote');
    assert(
      activity.votesCast[0].stance === 'PARTICIPATION_RECORDED',
      'votesCast stance is PARTICIPATION_RECORDED (never manufactured as YES)'
    );
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 9: State Mappings, validateWei, and weiToGen Helper
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 9: State Mappings, validateWei, & weiToGen Helper ---');
  {
    assert(mapContractRoundState('ACTIVE') === 'ACTIVE', 'Round state ACTIVE mapped');
    assert(mapContractRoundState('CLOSED') === 'CLOSED', 'Round state CLOSED mapped');
    assert(mapContractRoundState('REFUND_EMITTED') === 'REFUND_EMITTED', 'Round state REFUND_EMITTED mapped');

    // Unknown round state must throw incompatible-response error (never map to ACTIVE)
    let roundStateThrew = false;
    try {
      mapContractRoundState('UNKNOWN_STATE');
    } catch (err: any) {
      if (err.message.includes('Incompatible contract round state')) {
        roundStateThrew = true;
      }
    }
    assert(roundStateThrew, 'Unknown contract round state surfaces an incompatible-response error (never maps to ACTIVE)');

    assert(mapContractProposalState('SUBMITTED') === 'SUBMITTED', 'Proposal state SUBMITTED mapped');
    assert(mapContractProposalState('ELIGIBLE') === 'ELIGIBLE', 'Proposal state ELIGIBLE mapped');
    assert(mapContractProposalState('VOTING') === 'VOTING', 'Proposal state VOTING mapped');
    assert(mapContractProposalState('APPROVED') === 'APPROVED', 'Proposal state APPROVED mapped');
    assert(mapContractProposalState('REJECTED') === 'REJECTED', 'Proposal state REJECTED mapped');
    assert(mapContractProposalState('EXPIRED') === 'EXPIRED', 'Proposal state EXPIRED mapped');
    assert(mapContractProposalState('PAYOUT_EMITTED') === 'PAYOUT_EMITTED', 'Proposal state PAYOUT_EMITTED mapped');

    // Unknown proposal state must throw incompatible-response error (never map to SUBMITTED)
    let proposalStateThrew = false;
    try {
      mapContractProposalState('UNKNOWN_PROPOSAL_STATE');
    } catch (err: any) {
      if (err.message.includes('Incompatible contract proposal state')) {
        proposalStateThrew = true;
      }
    }
    assert(proposalStateThrew, 'Unknown contract proposal state surfaces an incompatible-response error (never maps to SUBMITTED)');

    // validateWei tests
    assert(validateWei('1000000000000000000', 'test') === 1000000000000000000n, 'validateWei parses valid 1e18 string');
    assert(validateWei(1000000000000000000n, 'test') === 1000000000000000000n, 'validateWei accepts bigint');
    assert(validateWei(0, 'test') === 0n, 'validateWei accepts 0');

    let missingWeiThrew = false;
    try {
      validateWei(null, 'test context');
    } catch (err: any) {
      if (err.message.includes('required wei value is missing')) missingWeiThrew = true;
    }
    assert(missingWeiThrew, 'validateWei rejects null/missing value');

    let negativeWeiThrew = false;
    try {
      validateWei('-50', 'test context');
    } catch (err: any) {
      if (err.message.includes('wei value cannot be negative')) negativeWeiThrew = true;
    }
    assert(negativeWeiThrew, 'validateWei rejects negative value');

    let nonIntWeiThrew = false;
    try {
      validateWei('not_a_number', 'test context');
    } catch (err: any) {
      if (err.message.includes('expected valid wei integer')) nonIntWeiThrew = true;
    }
    assert(nonIntWeiThrew, 'validateWei rejects unparseable string');

    assert(weiToGen('1000000000000000000') === 1, 'weiToGen 1e18 wei = 1 GEN');
    assert(weiToGen('5000000000000000000000') === 5000, 'weiToGen 5000e18 wei = 5000 GEN');
    assert(weiToGen(0) === 0, 'weiToGen 0 = 0');
    assert(weiToGen('not_a_number') === 0, 'weiToGen invalid string returns 0 safely');

    assert(validateSafeCount(0, 'zero') === 0, 'validateSafeCount 0 is valid');
    assert(validateSafeCount(42, 'forty two') === 42, 'validateSafeCount 42 is valid');
  }

  console.log('\n================================================================');
  console.log(`ALL TESTS PASSED: ${passedTests} / ${totalTests}`);
  console.log('================================================================');
}

runTests().catch((err) => {
  console.error('\n❌ TEST RUNNER CRASHED:', err);
  process.exit(1);
});
