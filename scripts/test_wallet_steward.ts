/**
 * Wallet session, EIP-1193 discovery, and contract-aligned permission matrix.
 * Uses two distinct mock addresses and provider mocks for account/chain/role changes.
 * No seed phrase or private key is requested.
 */

import {
  canClaimCreatorRefund,
  canCloseExpiredRound,
  canCreateRound,
  canEvaluateCharterFit,
  canNominate,
  canSettleExpiredProposal,
  canVote,
  canWithdrawCredit,
  describeWalletRole,
  expectedEffectForAction,
} from '../frontend/src/services/permissions';
import {
  classifyWalletError,
  collectInjectedProviders,
  formatWalletBalanceLabel,
  readWalletSession,
  selectWalletByRdns,
  shouldAdoptAuthorizedAccounts,
  WALLET_SESSION_KEY,
  writeWalletSession,
  type DiscoveredWallet,
  type Eip1193Provider,
} from '../frontend/src/services/eip1193';
import { VERIFIED_DEPLOYMENT } from '../frontend/src/config/network';
import type { Proposal, Round } from '../frontend/src/types';

let passed = 0;
let total = 0;

function assert(condition: boolean, msg: string) {
  total++;
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    throw new Error(msg);
  }
  passed++;
  console.log(`PASS: ${msg}`);
}

const CREATOR = '0x1111111111111111111111111111111111111111';
const COMMITTEE = '0x2222222222222222222222222222222222222222';
const RECIPIENT = '0x3333333333333333333333333333333333333333';
const VISITOR = '0x4444444444444444444444444444444444444444';
const NOW = 1_700_000_000;

function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    id: 'round-live-alpha',
    title: 'Alpha',
    summary: 'Round for permission tests',
    creatorAddress: CREATOR,
    status: 'ACTIVE',
    totalPoolGen: 10,
    availableGen: 8,
    reservedGen: 2,
    approvedGen: 0,
    withdrawnGen: 0,
    capPerProposalGen: 1,
    deadlineDisplay: 'OPEN',
    nominationCutoffUnix: NOW + 86_400,
    roundEndUnix: NOW + 200_000,
    consensusThresholdPercent: 67,
    requiredVotes: 2,
    totalVoters: 3,
    currentYesVotes: 0,
    proposalsCount: { inReview: 1, decided: 0, total: 1 },
    charterRules: [],
    charterExclusions: [],
    committeeMembers: [
      { address: CREATOR, hasVoted: false, isCreator: true },
      { address: COMMITTEE, hasVoted: false },
      { address: RECIPIENT, hasVoted: false },
    ],
    eventStream: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'prp-live-1',
    roundId: 'round-live-alpha',
    roundTitle: 'Alpha',
    title: 'Work item',
    requestedGen: 1,
    recipientAddress: RECIPIENT,
    nominatorAddress: COMMITTEE,
    status: 'ELIGIBLE',
    workDescription: 'Work description for tests that is long enough',
    deliverables: [],
    matchedRuleIds: [],
    votes: {
      yesCount: 0,
      noCount: 0,
      requiredYes: 2,
      totalEligibleVoters: 2,
      deadlineRemaining: '12H REMAINING',
    },
    eventLog: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

class MockProvider implements Eip1193Provider {
  public account: string;
  public chainIdHex: string;
  public rejected = false;
  public listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

  constructor(account: string, chainIdHex = '0xf22d') {
    this.account = account;
    this.chainIdHex = chainIdHex;
  }

  async request(args: { method: string; params?: unknown[] }): Promise<unknown> {
    if (this.rejected) {
      const err = new Error('User rejected the request');
      (err as { code?: number }).code = 4001;
      throw err;
    }
    if (args.method === 'eth_accounts' || args.method === 'eth_requestAccounts') {
      return [this.account];
    }
    if (args.method === 'eth_chainId') return this.chainIdHex;
    if (args.method === 'wallet_switchEthereumChain') {
      const next = (args.params?.[0] as { chainId?: string } | undefined)?.chainId;
      if (next) this.chainIdHex = next;
      return null;
    }
    return '0x0';
  }

  on(event: string, handler: (...args: unknown[]) => void) {
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(handler);
  }

  emit(event: string, payload: unknown) {
    for (const handler of this.listeners[event] || []) handler(payload);
  }
}

const memoryStore = new Map<string, string>();
const memoryStorage = {
  getItem: (key: string) => memoryStore.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memoryStore.set(key, value);
  },
};

async function main() {
  console.log('--- Wallet session and discovery ---');
  {
    memoryStore.clear();
    assert(shouldAdoptAuthorizedAccounts(null) === false, 'no session does not silent-reconnect');
    writeWalletSession(memoryStorage, { status: 'cleared' });
    assert(shouldAdoptAuthorizedAccounts(readWalletSession(memoryStorage)) === false, 'cleared session does not silent-reconnect');
    writeWalletSession(memoryStorage, { status: 'connected', rdns: 'io.metamask' });
    assert(shouldAdoptAuthorizedAccounts(readWalletSession(memoryStorage)) === true, 'connected session may adopt eth_accounts');
    assert(WALLET_SESSION_KEY === 'cf_wallet_session_v1', 'session key is namespaced');
  }

  {
    const a = new MockProvider(CREATOR);
    const b = new MockProvider(COMMITTEE);
    const wallets = collectInjectedProviders({
      ethereum: { request: async () => [], providers: [a, b] } as Eip1193Provider,
    });
    assert(wallets.length === 2, 'multiple injected providers are listed');
    assert(selectWalletByRdns(wallets) === null, 'multiple wallets require an explicit choice');
    const single = collectInjectedProviders({ ethereum: a });
    assert(single.length === 1, 'single injected wallet is selectable');
    assert(selectWalletByRdns(single)?.provider === a, 'single wallet auto-selects');
  }

  {
    const rejected = classifyWalletError({ code: 4001, message: 'User rejected the request' });
    assert(rejected.code === 4001, 'user rejection classified as 4001');
    assert(
      /did not store a seed phrase or private key/i.test(rejected.message),
      'rejection copy states the app does not store a seed or private key'
    );
    const missing = classifyWalletError({ code: 4902, message: 'Unrecognized chain' });
    assert(missing.code === 4902, 'unknown chain classified as 4902');
  }

  {
    assert(
      formatWalletBalanceLabel({ isConnected: false, isCorrectNetwork: false, balanceGen: null }) === 'NO WALLET',
      'disconnected balance label'
    );
    assert(
      formatWalletBalanceLabel({ isConnected: true, isCorrectNetwork: false, balanceGen: null }) === 'WRONG CHAIN',
      'wrong-chain balance label'
    );
    assert(
      formatWalletBalanceLabel({
        isConnected: true,
        isCorrectNetwork: true,
        balanceGen: null,
        balanceReadFailed: true,
      }) === 'BALANCE READ FAILED',
      'RPC failure balance label'
    );
    assert(
      formatWalletBalanceLabel({ isConnected: true, isCorrectNetwork: true, balanceGen: '0.00' }) === '0.00 GEN',
      'zero balance is shown as 0.00 GEN'
    );
  }

  console.log('\n--- Two-address provider mocks: account and chain change ---');
  {
    const providerA = new MockProvider(CREATOR, '0x1');
    let seenAccount = providerA.account;
    let seenChain = providerA.chainIdHex;
    providerA.on('accountsChanged', (accounts) => {
      const list = Array.isArray(accounts) ? accounts.map(String) : [];
      seenAccount = list[0] || '';
    });
    providerA.on('chainChanged', (hex) => {
      seenChain = String(hex);
    });
    providerA.account = COMMITTEE;
    providerA.emit('accountsChanged', [COMMITTEE]);
    assert(seenAccount.toLowerCase() === COMMITTEE.toLowerCase(), 'account change switches from creator to committee');
    providerA.emit('chainChanged', '0xf22d');
    assert(seenChain === '0xf22d', 'chain change to 61997 is observed');
    const switched = await providerA.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0xf22d' }],
    });
    assert(switched === null && providerA.chainIdHex === '0xf22d', 'switch is explicit request, not automatic');
    providerA.rejected = true;
    let threw = false;
    try {
      await providerA.request({ method: 'eth_requestAccounts' });
    } catch {
      threw = true;
    }
    assert(threw, 'rejected connection surfaces to caller');
  }

  console.log('\n--- Role / action matrix ---');
  {
    const round = makeRound();
    const proposal = makeProposal();
    const recovery = makeRound({ id: VERIFIED_DEPLOYMENT.intendedRoundId });

    assert(describeWalletRole({ account: null }) === 'disconnected', 'disconnected role');
    assert(describeWalletRole({ account: CREATOR, round }) === 'creator_committee', 'creator on roster');
    assert(describeWalletRole({ account: COMMITTEE, round }) === 'committee', 'committee role');
    assert(describeWalletRole({ account: RECIPIENT, round, proposal }) === 'recipient', 'recipient role');
    assert(describeWalletRole({ account: VISITOR, round }) === 'visitor', 'visitor role');

    assert(canCreateRound({ connected: false, correctChain: false }).allowed === false, 'create blocked when disconnected');
    assert(canCreateRound({ connected: true, correctChain: true, balanceGen: '0.00' }).allowed === false, 'create blocked at 0 GEN');
    assert(canCreateRound({ connected: true, correctChain: true, balanceGen: '2.0000' }).allowed === true, 'funded wallet may create');

    assert(canNominate({ connected: true, correctChain: true, round: recovery, account: COMMITTEE }).allowed === false, 'recovery round nomination forbidden');
    assert(
      canNominate({ connected: true, correctChain: true, round, account: VISITOR }).allowed === false,
      'visitor cannot nominate'
    );
    assert(
      canNominate({ connected: true, correctChain: true, round, account: COMMITTEE, chainTimeSec: NOW }).allowed === true,
      'committee may nominate before cutoff'
    );
    assert(
      canNominate({
        connected: true,
        correctChain: true,
        round,
        account: COMMITTEE,
        chainTimeSec: NOW + 90_000,
      }).allowed === false,
      'nomination blocked after cutoff'
    );

    assert(
      canEvaluateCharterFit({ proposal: makeProposal({ status: 'SUBMITTED' }), connected: true, correctChain: true }).allowed ===
        true,
      'evaluate is permissionless when SUBMITTED'
    );
    assert(
      canEvaluateCharterFit({ proposal, connected: true, correctChain: true }).allowed === false,
      'evaluate blocked when not SUBMITTED'
    );

    assert(canVote({ connected: true, correctChain: true, account: VISITOR, round, proposal }).allowed === false, 'visitor cannot vote');
    assert(
      canVote({ connected: true, correctChain: true, account: RECIPIENT, round, proposal }).allowed === false,
      'recipient recusal blocks vote'
    );
    assert(
      canVote({ connected: true, correctChain: true, account: COMMITTEE, round, proposal }).allowed === true,
      'committee may vote on another recipient'
    );
    assert(
      canVote({
        connected: true,
        correctChain: true,
        account: COMMITTEE,
        round,
        proposal,
        hasAlreadyVoted: true,
      }).allowed === false,
      'duplicate vote blocked'
    );

    const approved = makeProposal({ status: 'APPROVED' });
    assert(
      canWithdrawCredit({ connected: true, correctChain: true, account: COMMITTEE, proposal: approved }).allowed === false,
      'committee cannot withdraw another address credit'
    );
    assert(
      canWithdrawCredit({ connected: true, correctChain: true, account: RECIPIENT, proposal: approved }).allowed === true,
      'named recipient may withdraw'
    );

    assert(
      canCloseExpiredRound({
        connected: true,
        correctChain: true,
        account: COMMITTEE,
        round,
        chainTimeSec: NOW + 300_000,
      }).allowed === false,
      'non-creator cannot close'
    );
    assert(
      canCloseExpiredRound({
        connected: true,
        correctChain: true,
        account: CREATOR,
        round,
        chainTimeSec: NOW + 300_000,
      }).allowed === true,
      'creator may close after round_end'
    );
    assert(
      canClaimCreatorRefund({
        connected: true,
        correctChain: true,
        account: CREATOR,
        round: makeRound({ status: 'CLOSED' }),
      }).allowed === true,
      'creator may claim after close'
    );
    assert(
      canClaimCreatorRefund({
        connected: true,
        correctChain: true,
        account: COMMITTEE,
        round: makeRound({ status: 'CLOSED' }),
      }).allowed === false,
      'committee cannot claim creator refund'
    );

    assert(canSettleExpiredProposal({ proposal, isExpirable: false }).allowed === false, 'settle hidden when deadline not passed');
    assert(canSettleExpiredProposal({ proposal, isExpirable: true }).allowed === true, 'settle shown only when actually expired');

    assert(expectedEffectForAction('create_round').includes('isolated round ledger'), 'create expected effect');
    assert(expectedEffectForAction('cast_vote').includes('Recipients'), 'vote expected effect names recusal');
  }

  {
    const announced: DiscoveredWallet[] = [
      { uuid: '1', name: 'Injected A', rdns: 'wallet.a', provider: new MockProvider(CREATOR) },
      { uuid: '2', name: 'Injected B', rdns: 'wallet.b', provider: new MockProvider(COMMITTEE) },
    ];
    const found = collectInjectedProviders({ discovered: announced });
    assert(found.length === 2, 'EIP-6963 announcements collected');
    assert(selectWalletByRdns(found, 'wallet.b')?.name === 'Injected B', 'explicit rdns selects second wallet');
  }

  console.log(`\n${passed}/${total} wallet steward tests passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
