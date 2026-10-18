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

const mockSession = new Map<string, string>();
(globalThis as any).sessionStorage = {
  getItem: (key: string) => mockSession.get(key) ?? null,
  setItem: (key: string, val: string) => {
    mockSession.set(key, String(val));
  },
  removeItem: (key: string) => {
    mockSession.delete(key);
  },
  clear: () => mockSession.clear(),
  key: (idx: number) => Array.from(mockSession.keys())[idx] ?? null,
  get length() {
    return mockSession.size;
  },
};

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
  assertNominationWindowOpen,
  RECOVERY_ROUND_ID,
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
  recordedActionBlocksResubmit,
  type PreparedTransaction,
  type PersistedTx,
  type ActionType,
} from '../frontend/src/services/transactionService';
import {
  setNativeTransferFeeSimulatorForTesting,
  setNativeTransferSubmitForTesting,
  reviveBigints,
  type NativeTransferSubmitRequest,
} from '../frontend/src/services/nativeTransferFees';
import {
  clearTxModalSnapshot,
  closeModalResume,
  modalAllowsSubmit,
  openFreshQuote,
  quoteResumeToken,
  readTxModalSnapshot,
  receiptStateForQuote,
  resumeModalState,
  resumeTxModalSnapshot,
  seedModalSnapshot,
  TX_MODAL_SNAPSHOT_KEY,
  writeTxModalSnapshot,
} from '../frontend/src/services/txModalSnapshot';
import {
  assessReceiptClaim,
  identityFromCallText,
  localForeignReceipt,
  modalReceiptFlags,
  payoutFeeNotice,
  resolveReceiptIdentity,
  setTxIdentityReaderForTesting,
} from '../frontend/src/services/txActionIdentity';
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
  public blockTimestampSec: number = Math.floor(Date.now() / 1000);
  public failBlockRead = false;

  async request(args: { method: string; params?: any[] }): Promise<any> {
    if (args.method === 'eth_accounts' || args.method === 'eth_requestAccounts') {
      return [this.account];
    }
    if (args.method === 'eth_chainId') {
      return this.chainIdHex;
    }
    if (args.method === 'eth_getBlockByNumber') {
      if (this.failBlockRead) {
        throw new Error('block read failed');
      }
      return { timestamp: `0x${this.blockTimestampSec.toString(16)}`, number: '0x1' };
    }
    return '0x';
  }
}

interface MockKitOptions {
  verificationStatus?: 'verified' | 'mismatch' | 'unavailable';
  feeValue?: bigint;
  messageFees?: bigint;
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
      messageFees: opts.messageFees ?? 0n,
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
      const userVal = input.userValue ?? opts.userValue ?? 0n;
      const quote = buildMockPolicyQuote(opts, userVal);
      const overrides = input.overrides ?? {};
      const distribution = quote.distribution as Record<string, unknown>;
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) continue;
        if (key === 'rotations' && Array.isArray(value)) {
          distribution.rotations = value.map((item) => BigInt(item as bigint));
        } else if (typeof value === 'bigint' || typeof value === 'number' || (typeof value === 'string' && /^-?\d+$/.test(value))) {
          distribution[key] = BigInt(value as bigint);
        }
      }
      if (overrides.totalMessageFees !== undefined && opts.messageFees === undefined) {
        quote.breakdown.messageFees = BigInt(overrides.totalMessageFees);
      }
      return quote;
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

function openNominationRound(id: string): Round {
  return {
    id,
    title: 'Test Round',
    summary: 'Test summary',
    creatorAddress: '0x1111111111111111111111111111111111111111',
    status: 'ACTIVE',
    totalPoolGen: 2,
    availableGen: 2,
    reservedGen: 0,
    approvedGen: 0,
    withdrawnGen: 0,
    capPerProposalGen: 1,
    deadlineDisplay: 'TBD',
    nominationCutoffUnix: Math.floor(Date.now() / 1000) + 86400,
    roundEndUnix: Math.floor(Date.now() / 1000) + 86400 * 3,
    consensusThresholdPercent: 66.7,
    requiredVotes: 2,
    totalVoters: 2,
    currentYesVotes: 0,
    proposalsCount: { inReview: 0, decided: 0, total: 0 },
    charterRules: [],
    charterExclusions: [],
    committeeMembers: [],
    eventStream: [],
    createdAt: new Date().toISOString(),
  };
}

class MockDataAccessAdapter implements Partial<DataAccessAdapter> {
  rounds: Record<string, Round> = {};
  proposals: Record<string, Proposal> = {};
  failGetProposalsByRound?: Error;
  failGetRoundById?: Error;
  malformedProposalsByRound?: any;
  defaultOpenNomination = true;

  async getRoundById(id: string): Promise<Round | null> {
    if (this.failGetRoundById) throw this.failGetRoundById;
    if (this.rounds[id]) return this.rounds[id];
    if (this.defaultOpenNomination) return openNominationRound(id);
    return null;
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

function approvedProposal(id: string, recipient: string): Proposal {
  return {
    id,
    roundId: 'round-open-source-rpc--mvb7nltc',
    roundTitle: 'Open-Source RPC Health Dashboard',
    title: 'Dashboard',
    requestedGen: 0.05,
    requestedAmountWei: '50000000000000000',
    recipientAddress: recipient,
    nominatorAddress: '0x1111111111111111111111111111111111111111',
    status: 'APPROVED',
    workDescription: 'Work',
    deliverables: [],
    matchedRuleIds: [],
    votes: { yesCount: 1, noCount: 0, requiredYes: 1, totalEligibleVoters: 1, deadlineRemaining: '0H REMAINING' },
    eventLog: [],
    createdAt: '2026-10-16T17:00:00.000Z',
  };
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
    const withdrawAdapter = new MockDataAccessAdapter();
    withdrawAdapter.proposals['prp-test-emit'] = approvedProposal('prp-test-emit', callerAddress);
    withdrawAdapter.proposals['prp-test-emit-live'] = approvedProposal('prp-test-emit-live', callerAddress);
    const prepWithdraw = await prepareActionTransaction({
      action: 'withdraw_credit',
      provider,
      account: callerAddress,
      chainId: 61997,
      contractAddress,
      adapter: withdrawAdapter as any,
      proposalId: 'prp-test-emit',
    });
    assert(prepWithdraw.isBlocked === true, 'withdraw_credit submission is blocked');
    assert(
      prepWithdraw.blockReason?.includes('emit_transfer requires a fresh positive native-message fee estimate') ?? false,
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
      prepClaimRefund.blockReason?.includes('emit_transfer requires a fresh positive native-message fee estimate') ?? false,
      'claim_creator_refund provides explicit diagnostic regarding unmeasured message fee budget'
    );

    setTransactionKitFactoryForTesting(() => buildMockKit({ messageFees: 25000000000000000n }));
    const prepWithdrawLive = await prepareActionTransaction({
      action: 'withdraw_credit',
      provider,
      account: callerAddress,
      chainId: 61997,
      contractAddress,
      adapter: withdrawAdapter as any,
      proposalId: 'prp-test-emit-live',
    });
    assert(prepWithdrawLive.isBlocked === false, 'withdraw_credit unblocks when messageFees are a positive bigint');
    assert(
      prepWithdrawLive.expectedEffect.includes('Named recipient'),
      'withdraw_credit carries expectedEffect before signature'
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
    assert(
      prep.expectedEffect.includes('isolated round ledger'),
      'create_round expectedEffect is shown before signature'
    );
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
    mockAdapter.defaultOpenNomination = false;

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

  // --------------------------------------------------------------------------
  // TEST SUITE 12: Pre-broadcast nomination cutoff (zero writes)
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 12: Expired nomination window blocks before estimate/submit ---');
  {
    let submitCount = 0;
    setTransactionKitFactoryForTesting(() => {
      const kit = buildMockKit();
      const originalSubmit = kit.submit;
      kit.submit = async (quote: any, tx: any) => {
        submitCount++;
        return originalSubmit(quote, tx);
      };
      return kit;
    });

    const windowProvider = new MockEip1193Provider();
    windowProvider.blockTimestampSec = 1_800_000_000;
    const expiredAdapter = new MockDataAccessAdapter();
    expiredAdapter.defaultOpenNomination = false;
    expiredAdapter.rounds['round-expired'] = {
      ...openNominationRound('round-expired'),
      nominationCutoffUnix: 1_700_000_000,
    };

    await assertThrows(
      async () =>
        prepareActionTransaction({
          action: 'nominate_proposal',
          provider: windowProvider,
          account: callerAddress,
          chainId: 61997,
          contractAddress,
          adapter: expiredAdapter as any,
          roundId: 'round-expired',
          nominateProposalArgs: {
            round_id: 'round-expired',
            recipient: otherAddress,
            title: 'Too late',
            requested_amount_wei: 1000000000000000000n,
            deliverables_text: 'Deliverables specification text with sufficient characters',
          },
        }),
      'EXPIRED_NOMINATION_WINDOW',
      'Expired on-chain cutoff yields EXPIRED_NOMINATION_WINDOW'
    );
    assert(submitCount === 0, 'Expired cutoff makes zero kit.submit writes');

    await assertThrows(
      async () =>
        prepareActionTransaction({
          action: 'nominate_proposal',
          provider: windowProvider,
          account: callerAddress,
          chainId: 61997,
          contractAddress,
          adapter: new MockDataAccessAdapter() as any,
          roundId: RECOVERY_ROUND_ID,
          nominateProposalArgs: {
            round_id: RECOVERY_ROUND_ID,
            recipient: otherAddress,
            title: 'Recovery round',
            requested_amount_wei: 1000000000000000000n,
            deliverables_text: 'Deliverables specification text with sufficient characters',
          },
        }),
      'RECOVERY_ROUND_NOMINATION_FORBIDDEN',
      'Locked recovery round rnd-pilot-354517 cannot be nominated into'
    );
    assert(submitCount === 0, 'Recovery-round block makes zero kit.submit writes');

    const { LEGACY_FUNDED_ROUND } = await import('../frontend/src/config/network');
    await assertThrows(
      async () =>
        prepareActionTransaction({
          action: 'nominate_proposal',
          provider: windowProvider,
          account: callerAddress,
          chainId: 61997,
          contractAddress,
          adapter: new MockDataAccessAdapter() as any,
          roundId: LEGACY_FUNDED_ROUND.roundId,
          nominateProposalArgs: {
            round_id: LEGACY_FUNDED_ROUND.roundId,
            recipient: otherAddress,
            title: 'Funded recovery round',
            requested_amount_wei: 50000000000000000n,
            deliverables_text: 'Deliverables specification text with sufficient characters',
          },
        }),
      'RECOVERY_ROUND_NOMINATION_FORBIDDEN',
      'Funded Studio Next round is a locked recovery/refund case'
    );

    const openAdapter = new MockDataAccessAdapter();
    const openProvider = new MockEip1193Provider();
    const openPrep = await prepareActionTransaction({
      action: 'nominate_proposal',
      provider: openProvider,
      account: callerAddress,
      chainId: 61997,
      contractAddress,
      adapter: openAdapter as any,
      roundId: 'round-open-window',
      nominateProposalArgs: {
        round_id: 'round-open-window',
        recipient: otherAddress,
        title: 'Open window',
        requested_amount_wei: 1000000000000000000n,
        deliverables_text: 'Deliverables specification text with sufficient characters',
      },
    });
    assert(openPrep.action === 'nominate_proposal', 'Open nomination window still prepares a quote');

    const pureExpired = (() => {
      try {
        assertNominationWindowOpen({
          chainTimeSec: 200,
          nominationCutoffSec: 100,
          roundId: 'round-x',
        });
        return false;
      } catch (err: any) {
        return String(err.message).includes('EXPIRED_NOMINATION_WINDOW');
      }
    })();
    assert(pureExpired, 'Pure cutoff helper reports EXPIRED_NOMINATION_WINDOW');
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 12: Duplicate evaluation/vote guards and modal snapshot reload
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 13: Fresh proposal state, duplicate submits, snapshot reload ---');
  {
    clearPersistedTransactions();
    mockStore.clear();
    mockSession.clear();
    const proposalId = 'prp-round-open-source-rpc--mvb7nltc-1';
    const live = new MockDataAccessAdapter();
    const baseProposal = {
      id: proposalId,
      roundId: 'round-open-source-rpc--mvb7nltc',
      roundTitle: 'Open-Source RPC Health Dashboard',
      title: 'Dashboard',
      requestedGen: 0.1,
      recipientAddress: otherAddress,
      nominatorAddress: callerAddress,
      status: 'SUBMITTED' as const,
      workDescription: 'Work',
      deliverables: [],
      matchedRuleIds: [],
      votes: { yesCount: 0, noCount: 0, requiredYes: 1, deadlineRemaining: '48H REMAINING' },
      eventLog: [] as { voterNode: string }[],
      createdAt: '2026-10-16T17:00:00.000Z',
    };
    live.proposals[proposalId] = { ...baseProposal };

    let estimates = 0;
    let submits = 0;
    setTransactionKitFactoryForTesting(() => {
      const kit = buildMockKit({ submittedTxId: '0x121377a431bc73fde4595abbe22108fe07070ebcffe48ab5fb899cf6dde362c3' });
      const estimate = kit.estimate.bind(kit);
      const submit = kit.submit.bind(kit);
      kit.estimate = (async (...args: Parameters<TransactionKit['estimate']>) => {
        estimates += 1;
        return estimate(...args);
      }) as TransactionKit['estimate'];
      kit.submit = (async (...args: Parameters<TransactionKit['submit']>) => {
        submits += 1;
        return submit(...args);
      }) as TransactionKit['submit'];
      return kit;
    });

    live.proposals[proposalId].status = 'ELIGIBLE';
    await assertThrows(
      async () =>
        prepareActionTransaction({
          action: 'evaluate_charter_fit',
          provider,
          account: callerAddress,
          chainId: 61997,
          contractAddress,
          adapter: live as any,
          proposalId,
        }),
      'EVALUATION_STATE_CHANGED',
      'Stale SUBMITTED page cannot quote an evaluation once the live proposal is ELIGIBLE'
    );
    assert(estimates === 0 && submits === 0, 'A changed evaluation state does not quote or submit');

    live.proposals[proposalId].status = 'SUBMITTED';
    const quoted = await prepareActionTransaction({
      action: 'evaluate_charter_fit',
      provider,
      account: callerAddress,
      chainId: 61997,
      contractAddress,
      adapter: live as any,
      proposalId,
    });
    assert(estimates === 1, 'A SUBMITTED proposal is quoted once');
    live.proposals[proposalId].status = 'ELIGIBLE';
    await assertThrows(
      async () => executeAndTrackTransaction(quoted, provider, callerAddress, { adapter: live as any }),
      'EVALUATION_STATE_CHANGED',
      'Evaluation submit re-reads the proposal and stops when it is no longer SUBMITTED'
    );
    assert(submits === 0, 'The second evaluation read blocks the wallet submit');

    live.getProposalById = async () => {
      throw new Error('rate limit');
    };
    await assertThrows(
      async () =>
        prepareActionTransaction({
          action: 'evaluate_charter_fit',
          provider,
          account: callerAddress,
          chainId: 61997,
          contractAddress,
          adapter: live as any,
          proposalId,
        }),
      'EVALUATION_STATE_READ_FAILED',
      'A failed evaluation read does not become a quote'
    );

    live.proposals[proposalId].status = 'SUBMITTED';
    live.getProposalById = async (id: string) => live.proposals[id] || null;
    clearPersistedTransactions();
    await assertThrows(
      async () =>
        prepareActionTransaction({
          action: 'cast_vote',
          provider,
          account: callerAddress,
          chainId: 61997,
          contractAddress,
          adapter: live as any,
          proposalId,
          castVoteArgs: { proposal_id: proposalId, vote_type: 'YES', recipientAddress: otherAddress },
        }),
      'VOTE_STATE_CHANGED',
      'A vote quote requires the live proposal to be ELIGIBLE or VOTING'
    );

    live.proposals[proposalId].status = 'ELIGIBLE';
    const voteQuote = await prepareActionTransaction({
      action: 'cast_vote',
      provider,
      account: callerAddress,
      chainId: 61997,
      contractAddress,
      adapter: live as any,
      proposalId,
      castVoteArgs: { proposal_id: proposalId, vote_type: 'YES', recipientAddress: otherAddress },
    });
    live.proposals[proposalId].eventLog = [{ voterNode: callerAddress }];
    const submitsBeforeVote = submits;
    await assertThrows(
      async () => executeAndTrackTransaction(voteQuote, provider, callerAddress, { adapter: live as any }),
      'ALREADY_VOTED',
      'Vote submit re-reads ballots and blocks a duplicate YES'
    );
    assert(submits === submitsBeforeVote, 'An already-voted proposal does not reach wallet submit');

    live.proposals[proposalId].eventLog = [];
    live.proposals[proposalId].recipientAddress = callerAddress;
    await assertThrows(
      async () =>
        prepareActionTransaction({
          action: 'cast_vote',
          provider,
          account: callerAddress,
          chainId: 61997,
          contractAddress,
          adapter: live as any,
          proposalId,
          castVoteArgs: { proposal_id: proposalId, vote_type: 'YES', recipientAddress: otherAddress },
        }),
      'Recipient recusal',
      'The live recipient is recused before a vote quote'
    );
    live.proposals[proposalId].recipientAddress = otherAddress;

    const knownHash = '0x121377a431bc73fde4595abbe22108fe07070ebcffe48ab5fb899cf6dde362c3';
    savePersistedTransaction({
      intentId: 'intent-eval-known',
      txId: knownHash,
      action: 'evaluate_charter_fit',
      proposalId,
      account: callerAddress,
      chainId: 61997,
      contractAddress,
      targetIdentifier: `evaluate_charter_fit:${proposalId}`,
      compositeTargetKey: `k`,
      userValueWei: '0',
      feeValueWei: '1',
      totalValueWei: '1',
      submittedAt: Date.now(),
      status: 'finalized-success',
    });
    const blockedEval = recordedActionBlocksResubmit('evaluate_charter_fit', proposalId);
    assert(blockedEval?.txId === knownHash, 'A completed evaluation record blocks another evaluation action');
    savePersistedTransaction({
      intentId: 'intent-vote-uncertain',
      action: 'cast_vote',
      proposalId,
      account: callerAddress,
      chainId: 61997,
      contractAddress,
      targetIdentifier: `cast_vote:${proposalId}`,
      compositeTargetKey: 'vote-key',
      userValueWei: '0',
      feeValueWei: '1',
      totalValueWei: '1',
      submittedAt: Date.now(),
      status: 'broadcast-unknown',
    });
    assert(
      recordedActionBlocksResubmit('cast_vote', proposalId)?.status === 'broadcast-unknown',
      'An uncertain vote record blocks another vote action'
    );

    const snapshotPath = `/proposals/${proposalId}`;
    writeTxModalSnapshot({
      open: true,
      path: snapshotPath,
      prepared: quoted,
      currentTx: blockedEval,
      livePhase: 'finalized',
      errorMsg: null,
      verificationResult: { verified: false, message: 'Readback uncertain' },
    });
    writeTxModalSnapshot({
      open: true,
      path: snapshotPath,
      prepared: quoted,
      currentTx: null,
      livePhase: 'standby',
      errorMsg: null,
      verificationResult: null,
    });
    const reloaded = readTxModalSnapshot();
    assert(reloaded?.currentTx?.txId === knownHash, 'Reload keeps the known evaluation hash');
    assert(modalAllowsSubmit(reloaded!) === false, 'A stale signable snapshot cannot replace a completed or uncertain attempt');
    assert(resumeTxModalSnapshot('/rounds/somewhere') === null, 'A redirect to another route does not restore a signable modal');
    const returned = resumeTxModalSnapshot(snapshotPath);
    assert(returned?.currentTx?.txId === knownHash && modalAllowsSubmit(returned) === false, 'Returning to the proposal restores the recorded attempt, not a submit button');
    clearTxModalSnapshot();
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 14: withdraw_credit simulation allocations survive into submit
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 14: withdraw_credit fee allocation quote and submit ---');
  {
    clearPersistedTransactions();
    mockStore.clear();
    mockSession.clear();
    setNativeTransferFeeSimulatorForTesting(null);
    setNativeTransferSubmitForTesting(null);

    const proposalId = 'prp-round-open-source-rpc--mvb7nltc-1';
    const recipient = callerAddress;
    const messageBudget = 25000000000000000n;
    const simulatedFee = 40000000000000000n;
    const live = new MockDataAccessAdapter();
    live.proposals[proposalId] = approvedProposal(proposalId, recipient);

    const allocation = {
      messageType: 0,
      onAcceptance: true,
      parentIndex: 0n,
      recipient: recipient as `0x${string}`,
      budget: messageBudget,
    };
    const distribution = {
      leaderTimeunitsAllocation: 125n,
      validatorTimeunitsAllocation: 250n,
      appealRounds: 3n,
      executionBudgetPerRound: 1n,
      executionConsumed: 0n,
      totalMessageFees: messageBudget,
      rotations: [1n, 1n, 1n, 1n],
      maxPriceGenPerTimeUnit: 1n,
      storageFeeMaxGasPrice: 1n,
      receiptFeeMaxGasPrice: 1n,
    };

    let simulations = 0;
    const writes: NativeTransferSubmitRequest[] = [];
    setNativeTransferSubmitForTesting(async (request) => {
      writes.push(request);
      return '0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcd';
    });
    let kitSubmits = 0;
    setTransactionKitFactoryForTesting(() => {
      const kit = buildMockKit({
        submittedTxId: '0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcd',
        feeValue: simulatedFee,
      });
      const submit = kit.submit.bind(kit);
      kit.submit = (async (...args: Parameters<TransactionKit['submit']>) => {
        kitSubmits += 1;
        return submit(...args);
      }) as TransactionKit['submit'];
      return kit;
    });

    setNativeTransferFeeSimulatorForTesting(async () => {
      simulations += 1;
      return { distribution, messageAllocations: [], feeValue: simulatedFee };
    });
    const missing = await prepareActionTransaction({
      action: 'withdraw_credit',
      provider,
      account: recipient,
      chainId: 61997,
      contractAddress,
      adapter: live as any,
      proposalId,
    });
    assert(missing.isBlocked === true, 'A simulation with no message allocations blocks withdraw_credit');
    assert(
      missing.blockReason?.includes('did not return a native-transfer fee allocation') ?? false,
      'Missing allocations name the Studio Next allocation failure'
    );
    assert(!missing.nativeTransfer, 'A missing allocation tree is not sealed onto the quote');
    await assertThrows(
      async () => executeAndTrackTransaction(missing, provider, recipient, { adapter: live as any }),
      'did not return a native-transfer fee allocation',
      'A missing allocation quote cannot be submitted'
    );
    assert(writes.length === 0 && kitSubmits === 0, 'Missing allocations do not reach a wallet write');

    setNativeTransferFeeSimulatorForTesting(null);
    setTransactionKitFactoryForTesting(() => buildMockKit({ messageFees: messageBudget, feeValue: simulatedFee }));
    const unsealed = await prepareActionTransaction({
      action: 'withdraw_credit',
      provider,
      account: recipient,
      chainId: 61997,
      contractAddress,
      adapter: live as any,
      proposalId,
    });
    assert(unsealed.isBlocked === false, 'A positive kit message fee still unblocks the quote gate');
    assert(!unsealed.nativeTransfer, 'A kit-only positive fee does not invent an allocation tree');
    const writesBeforeUnsealed = writes.length;
    await assertThrows(
      async () => executeAndTrackTransaction(unsealed, provider, recipient, { adapter: live as any }),
      'missing or stale',
      'Submit refuses a positive fee quote that has no allocation tree'
    );
    assert(writes.length === writesBeforeUnsealed && kitSubmits === 0, 'An unsealed quote does not call the wallet write');

    setNativeTransferFeeSimulatorForTesting(async (request) => {
      simulations += 1;
      assert(request.proposalId === proposalId, 'Simulation is for the exact proposal');
      assert(request.account.toLowerCase() === recipient, 'Simulation is for the recipient account');
      assert(request.value === 0n, 'Each fresh simulation uses zero payable value');
      return {
        distribution,
        messageAllocations: [{ ...allocation, recipient }],
        feeValue: simulatedFee,
      };
    });
    setTransactionKitFactoryForTesting(() => {
      const kit = buildMockKit({ feeValue: simulatedFee });
      const submit = kit.submit.bind(kit);
      kit.submit = (async (...args: Parameters<TransactionKit['submit']>) => {
        kitSubmits += 1;
        return submit(...args);
      }) as TransactionKit['submit'];
      return kit;
    });

    const quoted = await prepareActionTransaction({
      action: 'withdraw_credit',
      provider,
      account: recipient,
      chainId: 61997,
      contractAddress,
      adapter: live as any,
      proposalId,
    });
    assert(quoted.isBlocked === false, 'A covering simulation unblocks withdraw_credit');
    assert(quoted.payableValueWei === 0n, 'Quoted payable value stays zero');
    assert(quoted.quote.breakdown.messageFees === messageBudget, 'Quoted message fees come from the simulation distribution');
    assert(quoted.nativeTransfer?.allocations.length === 1, 'The quote seals one message allocation');
    assert(
      quoted.nativeTransfer?.allocations[0]?.recipient.toLowerCase() === recipient,
      'The sealed allocation recipient is the named recipient'
    );
    assert(quoted.withdrawRecipient === recipient, 'The review recipient is the named recipient');

    const stale = {
      ...quoted,
      nativeTransfer: quoted.nativeTransfer
        ? {
            ...quoted.nativeTransfer,
            allocations: [{ ...quoted.nativeTransfer.allocations[0], recipient: otherAddress as `0x${string}` }],
          }
        : undefined,
    };
    const writesBeforeStale = writes.length;
    await assertThrows(
      async () => executeAndTrackTransaction(stale, provider, recipient, { adapter: live as any }),
      'missing or stale',
      'A changed allocation recipient is rejected before signing'
    );
    assert(writes.length === writesBeforeStale, 'A stale allocation does not reach the wallet write');

    const mismatched = {
      ...quoted,
      quote: {
        ...quoted.quote,
        feeValue: simulatedFee - 1n,
        distribution: { ...quoted.quote.distribution, totalMessageFees: messageBudget - 1n },
      },
    };
    await assertThrows(
      async () => executeAndTrackTransaction(mismatched, provider, recipient, { adapter: live as any }),
      'below Studio Next',
      'A quote below the simulated fee or message budget is rejected'
    );
    assert(writes.length === writesBeforeStale, 'A mismatched quote does not reach the wallet write');

    const switched = new MockEip1193Provider();
    switched.account = otherAddress;
    await assertThrows(
      async () => executeAndTrackTransaction(quoted, switched, recipient, { adapter: live as any }),
      'Wallet switch detected after quote',
      'An account switch after the withdrawal quote requires a fresh simulation'
    );
    assert(writes.length === writesBeforeStale, 'An account switch does not submit the previous allocation');

    const revived = JSON.parse(
      JSON.stringify(quoted, (_key, value) => (typeof value === 'bigint' ? { __bigint: value.toString() } : value)),
      reviveBigints
    ) as PreparedTransaction;
    const carried = await executeAndTrackTransaction(revived, provider, recipient, { adapter: live as any });
    assert(writes.length === writesBeforeStale + 1, 'The wallet submit receives the revived quote once');
    assert(kitSubmits === 0, 'withdraw_credit does not use the Transaction Kit submit path');
    const sent = writes[writes.length - 1];
    assert(sent.functionName === 'withdraw_credit', 'Submitted method is withdraw_credit');
    assert(sent.args[0] === proposalId, 'Submitted args carry the exact proposal');
    assert(sent.value === 0n, 'Submitted payable value is zero');
    assert(sent.fees.feeValue === simulatedFee, 'Submitted feeValue is the quoted fee');
    assert(sent.fees.distribution.totalMessageFees === messageBudget, 'Submitted distribution keeps the simulated message fees');
    assert(sent.fees.messageAllocations.length === 1, 'Submitted payload includes one allocation');
    assert(
      String(sent.fees.messageAllocations[0].recipient).toLowerCase() === recipient,
      'Submitted allocation recipient matches the quote'
    );
    assert(sent.fees.messageAllocations[0].budget === messageBudget, 'Submitted allocation budget matches the quote');
    assert(carried.txId === '0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcd', 'Successful submit keeps the returned transaction id');
    assert(carried.status === 'finalized-success', 'A finalized return is recorded as success');

    clearPersistedTransactions();
    live.proposals[proposalId].status = 'APPROVED';
    setTransactionKitFactoryForTesting(() =>
      buildMockKit({
        feeValue: simulatedFee,
        phase: 'processing',
        statusName: 'COMMITTING',
        executionResultName: null,
      })
    );
    const uncertainQuote = await prepareActionTransaction({
      action: 'withdraw_credit',
      provider,
      account: recipient,
      chainId: 61997,
      contractAddress,
      adapter: live as any,
      proposalId,
    });
    const uncertain = await executeAndTrackTransaction(uncertainQuote, provider, recipient, { adapter: live as any });
    assert(uncertain.status === 'unresolved', 'A receipt without a finalized result stays unresolved');
    assert(Boolean(uncertain.txId), 'The unresolved withdrawal keeps its transaction id');
    assert(
      modalAllowsSubmit({
        currentTx: uncertain,
        livePhase: uncertain.phase || 'processing',
        errorMsg: uncertain.error || null,
        verificationResult: null,
      }) === false,
      'An uncertain withdrawal receipt is not a new sign button'
    );
    assert(
      recordedActionBlocksResubmit('withdraw_credit', proposalId)?.txId === uncertain.txId,
      'The uncertain withdrawal record blocks another withdrawal'
    );
    await assertThrows(
      async () =>
        prepareActionTransaction({
          action: 'withdraw_credit',
          provider,
          account: recipient,
          chainId: 61997,
          contractAddress,
          adapter: live as any,
          proposalId,
        }),
      'already recorded',
      'A second withdrawal quote is refused while the receipt is uncertain'
    );
    const snapshotPath = `/proposals/${proposalId}`;
    writeTxModalSnapshot({
      open: true,
      path: snapshotPath,
      prepared: uncertainQuote,
      currentTx: uncertain,
      livePhase: 'processing',
      errorMsg: 'Tracking timeout reached. Transaction may still be executing on-chain.',
      verificationResult: { verified: false, message: 'Readback uncertain' },
    });
    writeTxModalSnapshot({
      open: true,
      path: snapshotPath,
      prepared: uncertainQuote,
      currentTx: null,
      livePhase: 'standby',
      errorMsg: null,
      verificationResult: null,
    });
    const reloaded = readTxModalSnapshot();
    assert(simulations > 0, 'The withdrawal quote used a fresh fee simulation');
    assert(reloaded?.currentTx?.txId === uncertain.txId, 'Reload keeps the uncertain withdrawal hash');
    assert(modalAllowsSubmit(reloaded!) === false, 'A stale signable snapshot cannot replace an uncertain withdrawal');
    clearTxModalSnapshot();
    clearPersistedTransactions();
    setNativeTransferFeeSimulatorForTesting(null);
    setNativeTransferSubmitForTesting(null);
  }

  // --------------------------------------------------------------------------
  // TEST SUITE 15: a finalized vote hash must not complete a withdrawal modal
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 15: cross-action receipt identity ---');
  {
    clearTxModalSnapshot();
    mockSession.clear();
    const proposalId = 'prp-round-open-source-rpc--mvb7nltc-1';
    const recipient = '0x31e14df3b4f47F2428F3B78E7279691A78f70a05';
    const creator = '0xb3F7518df619ef485f7a1568ED3705bB6f5B0407';
    const liveContract = '0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8';
    const voteHash = '0x899a922020fde7f680e39812df9d344d04f1c5702f71099e9648d528f3684526';
    const payoutHash = '0xabababababababababababababababababababababababababababababababab';
    const childHash = '0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd';
    const credit = '50000000000000000';
    const snapshotPath = `/proposals/${proposalId}`;
    const withdrawPrepared = {
      action: 'withdraw_credit',
      targetIdentifier: `withdraw_credit:${proposalId}`,
      compositeTargetKey: `${recipient.toLowerCase()}:61997:${liveContract.toLowerCase()}:withdraw_credit:${proposalId}`,
      proposalId,
      submitInput: {
        kind: 'write',
        address: liveContract,
        method: 'withdraw_credit',
        args: [proposalId],
      },
      quotedAccount: recipient.toLowerCase(),
      quotedChainId: 61997,
      quotedContractAddress: liveContract.toLowerCase(),
      quotedArgsJson: JSON.stringify({ kind: 'write', method: 'withdraw_credit', args: [proposalId] }),
      withdrawRecipient: recipient.toLowerCase(),
    } as PreparedTransaction;
    const voteTx: PersistedTx = {
      intentId: 'intent-vote-899a',
      txId: voteHash,
      action: 'cast_vote',
      proposalId,
      account: creator.toLowerCase(),
      chainId: 61997,
      contractAddress: liveContract.toLowerCase(),
      targetIdentifier: `cast_vote:${proposalId}`,
      compositeTargetKey: `${creator.toLowerCase()}:61997:${liveContract.toLowerCase()}:cast_vote:${proposalId}`,
      userValueWei: '0',
      feeValueWei: '1',
      totalValueWei: '1',
      intendedArgumentsJson: JSON.stringify({
        kind: 'write',
        method: 'cast_vote',
        args: [proposalId, 'YES'],
      }),
      submittedAt: 1,
      status: 'finalized-success',
    };
    const decoded = identityFromCallText(
      '{"":"cast_vote","args":["prp-round-open-source-rpc--mvb7nltc-1","YES",]}'
    );
    assert(decoded.method === 'cast_vote', 'Readable vote calldata identifies cast_vote');
    assert(
      decoded.args[0] === proposalId && decoded.args[1] === 'YES',
      'Readable vote calldata keeps the proposal id and YES argument'
    );

    writeTxModalSnapshot({
      open: true,
      path: snapshotPath,
      prepared: withdrawPrepared,
      currentTx: voteTx,
      livePhase: 'finalized',
      errorMsg: null,
      verificationResult: { verified: true, message: 'Ballot on proposal recorded on-chain.' },
    });
    assert(readTxModalSnapshot() === null, 'A cross-action write does not store the vote hash as a withdrawal receipt');

    sessionStorage.setItem(
      TX_MODAL_SNAPSHOT_KEY,
      JSON.stringify({
        open: true,
        path: snapshotPath,
        prepared: withdrawPrepared,
        currentTx: voteTx,
        livePhase: 'finalized',
        errorMsg: null,
        verificationResult: { verified: true, message: 'Ballot on proposal recorded on-chain.' },
      })
    );
    const reloaded = resumeTxModalSnapshot(snapshotPath);
    assert(reloaded?.currentTx?.txId === voteHash, 'Reload keeps the injected vote hash');
    assert(reloaded?.currentTx?.action === 'cast_vote', 'Reload keeps the vote action on that hash');
    assert(reloaded?.verificationResult?.verified === false, 'Reload does not keep a verified receipt for the foreign hash');
    assert(modalAllowsSubmit(reloaded!) === false, 'The injected vote hash cannot become a withdrawal submit button');
    const local = localForeignReceipt(withdrawPrepared, voteTx);
    assert(Boolean(local && local.includes('cast_vote') && local.includes(voteHash)), 'The local mismatch names the vote hash');
    const reloadFlags = modalReceiptFlags({
      preparedAction: 'withdraw_credit',
      currentTx: voteTx,
      verificationVerified: true,
      receipt: { claim: 'identity-mismatch', hash: voteHash, message: local || '' },
      connectedAccount: recipient,
      quotedAccount: recipient,
    });
    assert(reloadFlags.workflowComplete === false, 'A verified vote result does not complete the withdrawal modal');
    assert(Boolean(reloadFlags.identityError), 'The withdrawal modal surfaces an identity error');

    writeTxModalSnapshot({
      open: true,
      path: snapshotPath,
      prepared: withdrawPrepared,
      currentTx: null,
      livePhase: 'standby',
      errorMsg: null,
      verificationResult: null,
    });
    const kept = readTxModalSnapshot();
    assert(kept?.currentTx?.txId === voteHash, 'A later signable snapshot cannot erase the injected vote hash');
    assert(modalAllowsSubmit(kept!) === false, 'The preserved mismatch stays non-signable');

    const switched = modalReceiptFlags({
      preparedAction: 'withdraw_credit',
      currentTx: voteTx,
      verificationVerified: true,
      receipt: { claim: 'identity-mismatch', hash: voteHash, message: local || '' },
      connectedAccount: creator,
      quotedAccount: recipient,
    });
    assert(switched.accountBlocked === true, 'An account switch away from the quoted recipient is blocked');
    assert(switched.workflowComplete === false, 'An account switch does not complete the contaminated withdrawal modal');

    const observedVote = {
      readStatus: 'ok' as const,
      sender: creator,
      contract: liveContract,
      method: 'cast_vote',
      args: [proposalId, 'YES'],
      finalizedSuccess: true,
      triggeredTxIds: [],
      proposalState: 'APPROVED',
      creditWithdrawn: false,
    };
    const chainMismatch = assessReceiptClaim(
      withdrawPrepared,
      { ...voteTx, action: 'withdraw_credit', account: recipient.toLowerCase() },
      observedVote
    );
    assert(chainMismatch.claim === 'identity-mismatch', 'On-chain cast_vote is not a withdrawal even if the local label was changed');
    assert(
      chainMismatch.claim === 'identity-mismatch' && chainMismatch.message.includes('cast_vote') && chainMismatch.message.includes(creator),
      'The chain mismatch names the vote method and creator signer'
    );
    const chainFlags = modalReceiptFlags({
      preparedAction: 'withdraw_credit',
      currentTx: voteTx,
      verificationVerified: true,
      receipt: chainMismatch,
      connectedAccount: recipient,
      quotedAccount: recipient,
    });
    assert(chainFlags.workflowComplete === false, 'Chain identity failure blocks WORKFLOW COMPLETE');

    setTxIdentityReaderForTesting(async () => observedVote);
    const resolved = await resolveReceiptIdentity(withdrawPrepared, voteTx);
    assert(resolved.claim === 'identity-mismatch', 'The receipt resolver reports the vote hash as a mismatch');
    setTxIdentityReaderForTesting(async () => {
      throw new Error('identity rpc unavailable');
    });
    const unresolved = await resolveReceiptIdentity(withdrawPrepared, voteTx);
    assert(unresolved.claim === 'identity-mismatch', 'A failed identity read of a foreign hash stays an identity error');
    assert(
      unresolved.claim === 'identity-mismatch' && unresolved.message.includes(voteHash),
      'The uncertain foreign hash is still preserved in the error'
    );

    const uncertain = assessReceiptClaim(
      withdrawPrepared,
      { txId: payoutHash },
      { readStatus: 'uncertain', detail: 'latest-final read failed' }
    );
    assert(uncertain.claim === 'uncertain', 'An unreadable withdrawal hash stays uncertain');
    const uncertainFlags = modalReceiptFlags({
      preparedAction: 'withdraw_credit',
      currentTx: { txId: payoutHash, status: 'finalized-success' },
      verificationVerified: true,
      receipt: uncertain,
      connectedAccount: recipient,
      quotedAccount: recipient,
    });
    assert(uncertainFlags.workflowComplete === false, 'An uncertain receipt is not WORKFLOW COMPLETE');
    assert(Boolean(uncertainFlags.uncertainMessage), 'The uncertain receipt keeps an explicit reconciliation message');

    const parentOnly = assessReceiptClaim(withdrawPrepared, { txId: payoutHash }, {
      readStatus: 'ok',
      sender: recipient,
      contract: liveContract,
      method: 'withdraw_credit',
      args: [proposalId],
      finalizedSuccess: true,
      triggeredTxIds: [],
      proposalState: 'PAYOUT_EMITTED',
      creditWithdrawn: true,
      requestedAmountWei: credit,
      childReadStatus: 'absent',
    });
    assert(parentOnly.claim === 'parent-matched', 'PAYOUT_EMITTED without a child transfer is not delivery');
    assert(
      modalReceiptFlags({
        preparedAction: 'withdraw_credit',
        currentTx: { txId: payoutHash, status: 'finalized-success' },
        verificationVerified: true,
        receipt: parentOnly,
        connectedAccount: recipient,
        quotedAccount: recipient,
      }).workflowComplete === false,
      'A parent-only payout does not show WORKFLOW COMPLETE'
    );

    const delivered = assessReceiptClaim(withdrawPrepared, { txId: payoutHash }, {
      readStatus: 'ok',
      sender: recipient,
      contract: liveContract,
      method: 'withdraw_credit',
      args: [proposalId],
      finalizedSuccess: true,
      triggeredTxIds: [childHash],
      proposalState: 'PAYOUT_EMITTED',
      creditWithdrawn: true,
      requestedAmountWei: credit,
      childHash,
      childRecipient: recipient,
      childValueWei: credit,
      childReadStatus: 'ok',
    });
    assert(delivered.claim === 'delivered', 'A matching child transfer can complete a withdrawal');
    assert(
      delivered.claim === 'delivered' && delivered.childHash === childHash,
      'The genuine payout reports the child transaction hash'
    );
    assert(
      modalReceiptFlags({
        preparedAction: 'withdraw_credit',
        currentTx: { txId: payoutHash, status: 'finalized-success' },
        verificationVerified: true,
        receipt: delivered,
        connectedAccount: recipient,
        quotedAccount: recipient,
      }).workflowComplete === true,
      'A genuine payout with matching delivery can show WORKFLOW COMPLETE'
    );

    // Adverse and in-flight child transfer states for withdraw_credit
    const withdrawPending = assessReceiptClaim(withdrawPrepared, { txId: payoutHash }, {
      readStatus: 'ok',
      sender: recipient,
      contract: liveContract,
      method: 'withdraw_credit',
      args: [proposalId],
      finalizedSuccess: true,
      triggeredTxIds: [childHash],
      proposalState: 'PAYOUT_EMITTED',
      creditWithdrawn: true,
      requestedAmountWei: credit,
      childHash,
      childRecipient: recipient,
      childValueWei: credit,
      childReadStatus: 'pending',
      detail: 'the emitted child transfer is pending finalization on the chain layer',
    });
    assert(withdrawPending.claim === 'parent-matched' && withdrawPending.message.includes('pending'), 'In-flight child payout remains parent-matched and notes pending state');
    assert(
      modalReceiptFlags({
        preparedAction: 'withdraw_credit',
        currentTx: { txId: payoutHash, status: 'finalized-success' },
        verificationVerified: true,
        receipt: withdrawPending,
        connectedAccount: recipient,
        quotedAccount: recipient,
      }).workflowComplete === false,
      'Pending child transfer blocks WORKFLOW COMPLETE'
    );

    const withdrawFailed = assessReceiptClaim(withdrawPrepared, { txId: payoutHash }, {
      readStatus: 'ok',
      sender: recipient,
      contract: liveContract,
      method: 'withdraw_credit',
      args: [proposalId],
      finalizedSuccess: true,
      triggeredTxIds: [childHash],
      proposalState: 'PAYOUT_EMITTED',
      creditWithdrawn: true,
      requestedAmountWei: credit,
      childHash,
      childRecipient: recipient,
      childValueWei: credit,
      childReadStatus: 'failed',
      detail: 'the emitted transfer failed or reverted on the chain layer',
    });
    assert(withdrawFailed.claim === 'parent-matched' && withdrawFailed.message.includes('failed or reverted'), 'Failed child payout remains parent-matched and notes failure');
    assert(
      modalReceiptFlags({
        preparedAction: 'withdraw_credit',
        currentTx: { txId: payoutHash, status: 'finalized-success' },
        verificationVerified: true,
        receipt: withdrawFailed,
        connectedAccount: recipient,
        quotedAccount: recipient,
      }).workflowComplete === false,
      'Failed child transfer blocks WORKFLOW COMPLETE'
    );

    const withdrawUncredited = assessReceiptClaim(withdrawPrepared, { txId: payoutHash }, {
      readStatus: 'ok',
      sender: recipient,
      contract: liveContract,
      method: 'withdraw_credit',
      args: [proposalId],
      finalizedSuccess: true,
      triggeredTxIds: [childHash],
      proposalState: 'PAYOUT_EMITTED',
      creditWithdrawn: true,
      requestedAmountWei: credit,
      childHash,
      childRecipient: recipient,
      childValueWei: credit,
      childValueCredited: false,
      childReadStatus: 'ok',
    });
    assert(withdrawUncredited.claim === 'parent-matched' && withdrawUncredited.message.includes('value_credited is not true'), 'Uncredited child transfer remains parent-matched');

    const withdrawConflictingTrigger = assessReceiptClaim(withdrawPrepared, { txId: payoutHash }, {
      readStatus: 'ok',
      sender: recipient,
      contract: liveContract,
      method: 'withdraw_credit',
      args: [proposalId],
      finalizedSuccess: true,
      triggeredTxIds: [childHash],
      proposalState: 'PAYOUT_EMITTED',
      creditWithdrawn: true,
      requestedAmountWei: credit,
      childHash,
      childRecipient: recipient,
      childValueWei: credit,
      childTriggeredBy: '0x9999999999999999999999999999999999999999999999999999999999999999',
      childValueCredited: true,
      childReadStatus: 'ok',
    });
    assert(
      withdrawConflictingTrigger.claim === 'parent-matched' && withdrawConflictingTrigger.message.includes('does not match parent'),
      'Child with conflicting parent trigger hash is rejected as delivery'
    );

    const withdrawConflictingRecipient = assessReceiptClaim(withdrawPrepared, { txId: payoutHash }, {
      readStatus: 'ok',
      sender: recipient,
      contract: liveContract,
      method: 'withdraw_credit',
      args: [proposalId],
      finalizedSuccess: true,
      triggeredTxIds: [childHash],
      proposalState: 'PAYOUT_EMITTED',
      creditWithdrawn: true,
      requestedAmountWei: credit,
      childHash,
      childRecipient: '0x8888888888888888888888888888888888888888',
      childValueWei: credit,
      childTriggeredBy: payoutHash,
      childValueCredited: true,
      childReadStatus: 'ok',
    });
    assert(
      withdrawConflictingRecipient.claim === 'parent-matched' && withdrawConflictingRecipient.message.includes('is not'),
      'Child with conflicting recipient address is rejected as delivery'
    );

    const withdrawConflictingAmount = assessReceiptClaim(withdrawPrepared, { txId: payoutHash }, {
      readStatus: 'ok',
      sender: recipient,
      contract: liveContract,
      method: 'withdraw_credit',
      args: [proposalId],
      finalizedSuccess: true,
      triggeredTxIds: [childHash],
      proposalState: 'PAYOUT_EMITTED',
      creditWithdrawn: true,
      requestedAmountWei: credit,
      childHash,
      childRecipient: recipient,
      childValueWei: '100',
      childTriggeredBy: payoutHash,
      childValueCredited: true,
      childReadStatus: 'ok',
    });
    assert(
      withdrawConflictingAmount.claim === 'parent-matched' && withdrawConflictingAmount.message.includes('does not match credit'),
      'Child with conflicting value is rejected as delivery'
    );

    // Test claim_creator_refund child resolution taxonomy
    const roundId = 'round-open-source-rpc--mvb7nltc';
    const refundAmount = '1000000000000000000'; // 1 GEN
    const refundHash = '0x1212121212121212121212121212121212121212121212121212121212121212';
    const refundChildHash = '0x3434343434343434343434343434343434343434343434343434343434343434';
    const refundPrepared = {
      action: 'claim_creator_refund',
      targetIdentifier: `claim_creator_refund:${roundId}`,
      compositeTargetKey: `${creator.toLowerCase()}:61997:${liveContract.toLowerCase()}:claim_creator_refund:${roundId}`,
      roundId,
      submitInput: {
        kind: 'write',
        address: liveContract,
        method: 'claim_creator_refund',
        args: [roundId],
      },
      quotedAccount: creator.toLowerCase(),
      quotedChainId: 61997,
      quotedContractAddress: liveContract.toLowerCase(),
      quotedArgsJson: JSON.stringify({ kind: 'write', method: 'claim_creator_refund', args: [roundId] }),
    } as PreparedTransaction;

    const refundParentOnly = assessReceiptClaim(refundPrepared, { txId: refundHash }, {
      readStatus: 'ok',
      sender: creator,
      contract: liveContract,
      method: 'claim_creator_refund',
      args: [roundId],
      finalizedSuccess: true,
      roundState: 'REFUND_EMITTED',
      creatorClaimableWei: '0',
      refundsEmittedWei: refundAmount,
      childReadStatus: 'absent',
    });
    assert(refundParentOnly.claim === 'parent-matched', 'Creator refund without child transfer is parent-matched');
    assert(
      modalReceiptFlags({
        preparedAction: 'claim_creator_refund',
        currentTx: { txId: refundHash, status: 'finalized-success' },
        verificationVerified: true,
        receipt: refundParentOnly,
        connectedAccount: creator,
        quotedAccount: creator,
      }).workflowComplete === false,
      'Parent-only refund does not show WORKFLOW COMPLETE'
    );

    const refundChildPending = assessReceiptClaim(refundPrepared, { txId: refundHash }, {
      readStatus: 'ok',
      sender: creator,
      contract: liveContract,
      method: 'claim_creator_refund',
      args: [roundId],
      finalizedSuccess: true,
      roundState: 'REFUND_EMITTED',
      creatorClaimableWei: '0',
      refundsEmittedWei: refundAmount,
      childHash: refundChildHash,
      childReadStatus: 'pending',
      detail: 'the emitted child transfer is pending finalization on the chain layer',
    });
    assert(refundChildPending.claim === 'parent-matched' && refundChildPending.message.includes('pending'), 'In-flight child refund is parent-matched');

    const refundChildFailed = assessReceiptClaim(refundPrepared, { txId: refundHash }, {
      readStatus: 'ok',
      sender: creator,
      contract: liveContract,
      method: 'claim_creator_refund',
      args: [roundId],
      finalizedSuccess: true,
      roundState: 'REFUND_EMITTED',
      creatorClaimableWei: '0',
      refundsEmittedWei: refundAmount,
      childHash: refundChildHash,
      childReadStatus: 'failed',
      detail: 'the emitted transfer failed or reverted on the chain layer',
    });
    assert(refundChildFailed.claim === 'parent-matched' && refundChildFailed.message.includes('failed or reverted'), 'Failed child refund is parent-matched and reports failure');

    const refundDelivered = assessReceiptClaim(refundPrepared, { txId: refundHash }, {
      readStatus: 'ok',
      sender: creator,
      contract: liveContract,
      method: 'claim_creator_refund',
      args: [roundId],
      finalizedSuccess: true,
      triggeredTxIds: [refundChildHash],
      roundState: 'REFUND_EMITTED',
      creatorClaimableWei: '0',
      refundsEmittedWei: refundAmount,
      childHash: refundChildHash,
      childRecipient: creator,
      childValueWei: refundAmount,
      childValueCredited: true,
      childReadStatus: 'ok',
    });
    assert(refundDelivered.claim === 'delivered', 'A matching child transfer delivers the creator refund');
    assert(refundDelivered.claim === 'delivered' && refundDelivered.childHash === refundChildHash, 'Refund reports child transaction hash');
    assert(
      modalReceiptFlags({
        preparedAction: 'claim_creator_refund',
        currentTx: { txId: refundHash, status: 'finalized-success' },
        verificationVerified: true,
        receipt: refundDelivered,
        connectedAccount: creator,
        quotedAccount: creator,
      }).workflowComplete === true,
      'A genuine creator refund with matching delivery shows WORKFLOW COMPLETE'
    );

    const refundUncredited = assessReceiptClaim(refundPrepared, { txId: refundHash }, {
      readStatus: 'ok',
      sender: creator,
      contract: liveContract,
      method: 'claim_creator_refund',
      args: [roundId],
      finalizedSuccess: true,
      triggeredTxIds: [refundChildHash],
      roundState: 'REFUND_EMITTED',
      creatorClaimableWei: '0',
      refundsEmittedWei: refundAmount,
      childHash: refundChildHash,
      childRecipient: creator,
      childValueWei: refundAmount,
      childValueCredited: false,
      childReadStatus: 'ok',
    });
    assert(refundUncredited.claim === 'parent-matched' && refundUncredited.message.includes('value_credited is not true'), 'Uncredited refund child transfer remains parent-matched');

    const refundConflictingTrigger = assessReceiptClaim(refundPrepared, { txId: refundHash }, {
      readStatus: 'ok',
      sender: creator,
      contract: liveContract,
      method: 'claim_creator_refund',
      args: [roundId],
      finalizedSuccess: true,
      triggeredTxIds: [refundChildHash],
      roundState: 'REFUND_EMITTED',
      creatorClaimableWei: '0',
      refundsEmittedWei: refundAmount,
      childHash: refundChildHash,
      childRecipient: creator,
      childValueWei: refundAmount,
      childTriggeredBy: '0x9999999999999999999999999999999999999999999999999999999999999999',
      childValueCredited: true,
      childReadStatus: 'ok',
    });
    assert(
      refundConflictingTrigger.claim === 'parent-matched' && refundConflictingTrigger.message.includes('does not match parent'),
      'Refund child with conflicting parent trigger hash is rejected as delivery'
    );

    const refundConflictingRecipient = assessReceiptClaim(refundPrepared, { txId: refundHash }, {
      readStatus: 'ok',
      sender: creator,
      contract: liveContract,
      method: 'claim_creator_refund',
      args: [roundId],
      finalizedSuccess: true,
      triggeredTxIds: [refundChildHash],
      roundState: 'REFUND_EMITTED',
      creatorClaimableWei: '0',
      refundsEmittedWei: refundAmount,
      childHash: refundChildHash,
      childRecipient: '0x8888888888888888888888888888888888888888',
      childValueWei: refundAmount,
      childTriggeredBy: refundHash,
      childValueCredited: true,
      childReadStatus: 'ok',
    });
    assert(
      refundConflictingRecipient.claim === 'parent-matched' && refundConflictingRecipient.message.includes('is not'),
      'Refund child with conflicting recipient address is rejected as delivery'
    );

    const refundConflictingAmount = assessReceiptClaim(refundPrepared, { txId: refundHash }, {
      readStatus: 'ok',
      sender: creator,
      contract: liveContract,
      method: 'claim_creator_refund',
      args: [roundId],
      finalizedSuccess: true,
      triggeredTxIds: [refundChildHash],
      roundState: 'REFUND_EMITTED',
      creatorClaimableWei: '0',
      refundsEmittedWei: refundAmount,
      childHash: refundChildHash,
      childRecipient: creator,
      childValueWei: '100',
      childTriggeredBy: refundHash,
      childValueCredited: true,
      childReadStatus: 'ok',
    });
    assert(
      refundConflictingAmount.claim === 'parent-matched' && refundConflictingAmount.message.includes('does not match refund'),
      'Refund child with conflicting value is rejected as delivery'
    );

    const refundUncertainChild = assessReceiptClaim(refundPrepared, { txId: refundHash }, {
      readStatus: 'ok',
      sender: creator,
      contract: liveContract,
      method: 'claim_creator_refund',
      args: [roundId],
      finalizedSuccess: true,
      roundState: 'REFUND_EMITTED',
      creatorClaimableWei: '0',
      refundsEmittedWei: refundAmount,
      childHash: refundChildHash,
      childReadStatus: 'uncertain',
      detail: 'the emitted transfer could not be read',
    });
    assert(
      refundUncertainChild.claim === 'parent-matched' && refundUncertainChild.message.includes('could not be read'),
      'Uncertain child status keeps creator refund as parent-matched'
    );

    const blockedFee = payoutFeeNotice('withdraw_credit', 0n);
    const measuredFee = payoutFeeNotice('withdraw_credit', 1n);
    assert(blockedFee?.tone === 'blocked' && blockedFee.text.includes('Zero or missing'), 'A zero message fee keeps the blocking warning');
    assert(measuredFee?.tone === 'measured', 'A positive message fee is described as measured');
    assert(
      Boolean(measuredFee && !measuredFee.text.includes('Zero or missing') && measuredFee.text.includes('1')),
      'A positive message fee does not keep the stale zero-fee sentence'
    );
    const ballotMessage = 'Ballot on proposal recorded on-chain.';
    const quotedWithdraw = { ...withdrawPrepared, quotedAt: 1_700_000_000_000 };
    const savedVote = savePersistedTransaction(voteTx);
    assert(savedVote.success === true, 'The historical vote record can be stored in cf_active_txs_rc2');
    const voteRecord = mockStore.get('cf_active_txs_rc2') || '';
    assert(voteRecord.includes(voteHash), 'cf_active_txs_rc2 contains the vote hash before the modal closes');
    sessionStorage.setItem(
      TX_MODAL_SNAPSHOT_KEY,
      JSON.stringify({
        open: true,
        path: snapshotPath,
        prepared: quotedWithdraw,
        currentTx: voteTx,
        livePhase: 'finalized',
        errorMsg: null,
        verificationResult: { verified: true, message: ballotMessage },
      })
    );
    const resumed = resumeModalState(snapshotPath);
    assert(resumed.show === true, 'Reload opens the contaminated withdrawal modal');
    assert(resumed.initialSnapshot?.currentTx?.txId === voteHash, 'Reload restores the vote hash into the in-memory snapshot');
    const contaminated = receiptStateForQuote(true, resumed.prepared, resumed.initialSnapshot, snapshotPath);
    assert(contaminated.currentTx?.txId === voteHash, 'The restored receipt still shows the vote hash');
    assert(
      quoteResumeToken(true, resumed.prepared, resumed.initialSnapshot).includes(voteHash),
      'The open resume token still carries the vote hash'
    );
    const freshQuote = { ...quotedWithdraw, quotedAt: quotedWithdraw.quotedAt + 1 };
    const reattached = seedModalSnapshot(freshQuote, resumed.initialSnapshot, snapshotPath);
    assert(reattached?.currentTx?.txId === voteHash, 'Passing the retained snapshot into a new quote would reattach the vote hash');

    const closed = closeModalResume(resumed);
    assert(closed.show === false && closed.initialSnapshot === null, 'Close drops the in-memory snapshot');
    assert(readTxModalSnapshot() === null, 'Close drops the session snapshot');
    const closedReceipt = receiptStateForQuote(false, closed.prepared, closed.initialSnapshot, snapshotPath);
    assert(
      closedReceipt.currentTx == null &&
        closedReceipt.livePhase === 'standby' &&
        closedReceipt.errorMsg == null &&
        closedReceipt.verificationResult == null,
      'Closing resets the modal receipt state'
    );
    assert(mockStore.get('cf_active_txs_rc2') === voteRecord, 'Close does not rewrite cf_active_txs_rc2');

    const opened = openFreshQuote(closed, freshQuote);
    assert(opened.show === true && opened.initialSnapshot === null, 'A fresh quote does not keep the resume snapshot');
    assert(
      !quoteResumeToken(true, opened.prepared, opened.initialSnapshot).includes(voteHash),
      'The fresh quote token has no vote hash'
    );
    const visible = receiptStateForQuote(true, opened.prepared, opened.initialSnapshot, snapshotPath);
    const visibleText = JSON.stringify(visible);
    assert(!visible.currentTx?.txId, 'The fresh withdrawal quote has no transaction hash');
    assert(!visibleText.includes(voteHash), 'The fresh receipt does not contain the vote hash');
    assert(visible.verificationResult == null, 'The fresh quote drops the old verification');
    assert(!visibleText.includes(ballotMessage), 'The fresh receipt does not contain the old ballot verification');
    assert(!visibleText.includes('WORKFLOW COMPLETE'), 'The fresh receipt state has no workflow-complete label');
    const freshFlags = modalReceiptFlags({
      preparedAction: 'withdraw_credit',
      currentTx: visible.currentTx,
      verificationVerified: visible.verificationResult?.verified ?? null,
      receipt: null,
      connectedAccount: recipient,
      quotedAccount: recipient,
    });
    assert(freshFlags.workflowComplete === false, 'The fresh withdrawal quote does not show WORKFLOW COMPLETE');
    assert(
      getPersistedTransactions().some((tx) => tx.txId === voteHash && tx.action === 'cast_vote'),
      'The historical cast_vote record remains in cf_active_txs_rc2'
    );
    assert(mockStore.get('cf_active_txs_rc2') === voteRecord, 'The fresh quote does not rewrite cf_active_txs_rc2');

    setTxIdentityReaderForTesting(null);
    clearTxModalSnapshot();
  }

  // Reset kit factory
  setTransactionKitFactoryForTesting(null);
  setNativeTransferFeeSimulatorForTesting(null);
  setNativeTransferSubmitForTesting(null);

  console.log('\n================================================================');
  console.log(`ALL WRITE REGRESSION TESTS PASSED: ${passedTests} / ${totalTests}`);
  console.log('================================================================');
}

runWriteTests().catch((err) => {
  console.error('\n❌ TEST RUNNER CRASHED:', err);
  process.exit(1);
});
