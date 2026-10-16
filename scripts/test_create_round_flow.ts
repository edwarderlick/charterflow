/**
 * Create-round UX, draft recovery, read-health gate, and post-finality readback.
 * Covers the user path: enter form → save/preview → navigate → restore all values;
 * preview/live toggle; read error blocks wallet; healthy mock read → one signature;
 * successful receipt + failed readback preserves hash and does not write again.
 */

const mockStore = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => mockStore.get(key) ?? null,
  setItem: (key: string, val: string) => {
    mockStore.set(key, String(val));
  },
  removeItem: (key: string) => {
    mockStore.delete(key);
  },
  clear: () => mockStore.clear(),
  key: (idx: number) => Array.from(mockStore.keys())[idx] ?? null,
  get length() {
    return mockStore.size;
  },
};

import {
  assembleCharterText,
  buildCreateRoundSchedule,
  currentBrowserOrigin,
  draftFromFormValues,
  formValuesFromDraft,
  isNetworkReadbackUnavailableError,
  NETWORK_READBACK_UNAVAILABLE_MESSAGE,
  PILOT_CREATOR,
  PILOT_RECIPIENT,
  pilotControlReady,
  recipientRecusalThreshold,
  twoSignerRpcHealthPilotForm,
  unixSecondsToUtcIso,
  validateCreateRoundForm,
  type CreateRoundFormValues,
} from '../frontend/src/services/createRoundSpec';
import {
  commitDraftsForVerifiedRounds,
  commitMatchingRoundDrafts,
  firstUncommittedRoundDraft,
  importPreviewDraftToLive,
  pickHydrationDraft,
  readRoundDraftInventory,
  ROUND_DRAFT_LIVE_KEY,
  ROUND_DRAFT_PREVIEW_KEY,
  ROUND_DRAFT_WORKING_KEY,
  saveRoundDraftToStore,
  withCarriedCommit,
} from '../frontend/src/services/roundDraft';
import {
  countOpenRounds,
  exploreRoundStatusLabel,
  roundMatchesExploreTab,
} from '../frontend/src/services/exploreRoundStatus';
import {
  executeAndTrackTransaction,
  prepareActionTransaction,
  setTransactionKitFactoryForTesting,
  verifyIntendedStateAfterSuccess,
  presentPostSuccessException,
  getPersistedTransactions,
  clearPersistedTransactions,
  clearInMemoryBlockingMarkers,
  type PreparedTransaction,
} from '../frontend/src/services/transactionService';
import type { DataAccessAdapter, Round } from '../frontend/src/types';
import { NETWORK_CONFIG } from '../frontend/src/config/network';
import type { PolicyQuote, TrackedStatus, TransactionKit } from '@genlayer/transaction-kit';

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

const recoveredDraft = {
  title: 'GenLayer RPC Read Health Dashboard',
  summary: 'Build a public TypeScript dashboard for Studio Next read health, with clear failure states and reproducible checks.',
  capPerProposalGen: 0.1,
  durationDays: 7,
  charterRules: [
    { title: 'Open-source dashboards for GenLayer Studio Next RPC health.', description: 'Open-source dashboards for GenLayer Studio Next RPC health.' },
    { title: 'Automated tests covering successful and failed contract reads.', description: 'Automated tests covering successful and failed contract reads.' },
    { title: 'Public documentation for setup, chain 61997, and safe diagnostics.', description: 'Public documentation for setup, chain 61997, and safe diagnostics.' },
  ],
  charterExclusions: [
    { title: 'No speculative token marketing, liquidity bot promotions, or centralized influencers', severity: 'EXCLUSION' },
    { title: 'No closed-source or custodial proprietary software', severity: 'EXCLUSION' },
  ],
  committeeAddresses: [
    '0x7E4E1f7DcC3DA063F9110477Ad348C90E8599253',
    '0x9471C57aF9DF875d4D42EDb046e446E85D9CFE3A',
    '0xb3F7518df619ef485f7a1568ED3705bB6f5B0407',
  ],
  consensusThresholdPercent: 66.67,
  votingWindowDays: 3,
  initialDepositGen: 1,
  savedAt: '2026-10-14T12:28:04.700Z',
};

const completeForm: CreateRoundFormValues = formValuesFromDraft({
  ...recoveredDraft,
  rosterRaw: recoveredDraft.committeeAddresses.join(',\n'),
  ratified: true,
  sourceStore: 'preview',
});

function makeRound(id: string, overrides: Partial<Round> = {}): Round {
  return {
    id,
    title: recoveredDraft.title,
    summary: recoveredDraft.summary,
    creatorAddress: '0x1111111111111111111111111111111111111111',
    contractAddress: NETWORK_CONFIG.contractAddress,
    status: 'ACTIVE',
    totalPoolGen: 1,
    availableGen: 1,
    reservedGen: 0,
    approvedGen: 0,
    withdrawnGen: 0,
    capPerProposalGen: 0.1,
    deadlineDisplay: 'TBD',
    consensusThresholdPercent: 66.67,
    requiredVotes: 2,
    totalVoters: 3,
    currentYesVotes: 0,
    proposalsCount: { inReview: 0, decided: 0, total: 0 },
    charterExclusions: [],
    committeeMembers: recoveredDraft.committeeAddresses.map((address) => ({ address: address.toLowerCase(), hasVoted: false })),
    charterRules: [
      {
        id: 'charter-main',
        code: 'DIR-01',
        title: 'Frozen Charter Directives',
        description: assembleCharterText({
          title: recoveredDraft.title,
          summary: recoveredDraft.summary,
          permittedDirectives: recoveredDraft.charterRules.map((rule) => rule.title),
          exclusions: recoveredDraft.charterExclusions.map((rule) => rule.title),
        }),
        category: 'Mandate' as const,
        maxAllocGen: 0.1,
      },
    ],
    eventStream: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

class MockAdapter implements Partial<DataAccessAdapter> {
  healthOk = true;
  healthError = 'JSON-RPC error -32603 Internal error';
  rounds: Record<string, Round> = {};
  failGetRounds = false;
  submitShouldBeUnreachable = false;
  slotErrorsRemaining = 0;

  async getRounds(): Promise<Round[]> {
    if (this.failGetRounds) throw new Error('JSON-RPC error -32603 Internal error');
    return Object.values(this.rounds);
  }
  async getRoundById(id: string): Promise<Round | null> {
    if (this.slotErrorsRemaining > 0) {
      this.slotErrorsRemaining -= 1;
      throw new Error('Server busy: all 8 execution slots occupied, retry later.');
    }
    return this.rounds[id] || null;
  }
  async getProposalsByRound(): Promise<never[]> {
    return [];
  }
  async getProposalById(): Promise<null> {
    return null;
  }
  async probeContractViewHealth() {
    if (this.healthOk) {
      return { ok: true, method: 'get_round_ids_count', diagnostic: 'ok' };
    }
    return { ok: false, method: 'get_round_ids_count', diagnostic: this.healthError, code: -32603 };
  }
}

class MockProvider {
  request = async ({ method }: { method: string }) => {
    if (method === 'eth_chainId') return '0xf22d';
    if (method === 'eth_accounts') return ['0x1111111111111111111111111111111111111111'];
    if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
    throw new Error(`unexpected ${method}`);
  };
}

function buildKit(opts: { submitCount: { n: number } }): TransactionKit {
  const txId = '0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabca' as `0x${string}`;
  return {
    estimate: async (input: { userValue?: bigint }) =>
      ({
        feeValue: 1n,
        userValue: input.userValue ?? 10n ** 18n,
        total: (input.userValue ?? 10n ** 18n) + 1n,
        verification: { status: 'verified' },
        breakdown: { messageFees: 1n },
      }) as PolicyQuote,
    submit: async () => {
      opts.submitCount.n += 1;
      return { genlayerTxId: txId, evmTxHash: txId };
    },
    track: async (genlayerTxId: `0x${string}`, onUpdate: (status: TrackedStatus) => void) => {
      const finalStatus = {
        phase: 'finalized',
        genlayerTxId,
        statusName: 'FINALIZED',
        executionResultName: 'FINISHED_WITH_RETURN',
        successful: true,
      } as TrackedStatus;
      onUpdate(finalStatus);
      return finalStatus;
    },
    cancel: async () => ({ transaction_hash: '0x', status: 'cancelled' }),
    topUp: async () => '0x' as `0x${string}`,
    verification: () => ({ feeConfigHash: '0xhash' as `0x${string}`, summary: {} }),
  } as TransactionKit;
}

function blockWalletIfUnhealthy(health: { ok: boolean; diagnostic: string }): string | null {
  if (health.ok) return null;
  return `${NETWORK_READBACK_UNAVAILABLE_MESSAGE} Diagnostic: ${health.diagnostic}`;
}

async function run() {
  console.log('--- Create round validation ---');
  {
    const empty = validateCreateRoundForm({
      title: '',
      summary: '',
      capInput: '',
      durationDaysInput: '',
      votingDaysInput: '',
      depositInput: '',
      permittedDirectives: [],
      exclusions: [],
      rosterInput: '',
      plannedRecipient: '',
      ratified: false,
    });
    assert(empty.ok === false, 'empty form is not ready to submit');
    assert(empty.errors.some((e) => /5–120/.test(e)), 'title 5–120 is enforced');
    assert(!empty.roster.valid.includes('0x71C5928A3F81C9B20E176D63A5D3B0F6E9C04F9B'), 'fabricated committee is not a default');
  }
  {
    const recovered = validateCreateRoundForm(completeForm);
    assert(recovered.ok === true, 'recovered user draft satisfies contract create_round rules');
    assert(recovered.depositWei === 10n ** 18n, 'recovered deposit is 1 GEN');
    assert(recovered.charterLength >= 100, 'assembled charter meets 100-char minimum');
  }
  {
    const shortTitle = validateCreateRoundForm({ ...completeForm, title: 'abcd' });
    assert(shortTitle.titleOk === false, '4-char title is rejected');
    const capOverDeposit = validateCreateRoundForm({ ...completeForm, capInput: '2', depositInput: '1' });
    assert(capOverDeposit.ok === false, 'cap greater than deposit is rejected');
    const oneAddr = validateCreateRoundForm({ ...completeForm, rosterInput: '0x7E4E1f7DcC3DA063F9110477Ad348C90E8599253' });
    assert(oneAddr.rosterOk === false, 'single committee address is rejected');
  }

  console.log('\n--- Two-signer recipient recusal is 1-of-1 ---');
  {
    const pilot = validateCreateRoundForm(twoSignerRpcHealthPilotForm(), 1_760_000_000);
    assert(pilot.ok === true, 'two-signer RPC health pilot satisfies create_round rules');
    assert(pilot.roster.valid[0] === PILOT_CREATOR, 'roster order starts with the creator and sole voter');
    assert(pilot.roster.valid[1] === PILOT_RECIPIENT, 'roster order ends with the planned recipient');
    assert(pilot.depositWei === 10n ** 18n, 'pilot deposit is 1 GEN');
    assert(pilot.capWei === 10n ** 17n, 'pilot cap is 0.1 GEN');
    assert(pilot.schedule!.votingDuration === 3 * 86400, 'pilot voting window is 3 days');
    assert(pilot.schedule!.nominationCutoff === 1_760_000_000 + 7 * 86400, 'pilot nomination window is 7 days');
    assert(
      pilot.schedule!.roundEnd === pilot.schedule!.nominationCutoff + 86400 + pilot.schedule!.votingDuration,
      'pilot round end includes the one-day buffer'
    );
    const threshold = recipientRecusalThreshold(pilot.roster.valid, PILOT_RECIPIENT);
    assert(threshold.recipientOnRoster === true, 'planned recipient is on the roster');
    assert(threshold.eligibleCount === 1, 'recusal leaves one eligible voter');
    assert(threshold.eligibleVoters[0] === PILOT_CREATOR, 'eligible voter is 0xb3F7…0407');
    assert(threshold.requiredYes === 1, 'required YES is (1 * 2 + 2) // 3 = 1');
    assert(threshold.formula.includes('1-of-1'), 'formula states the 1-of-1 approval threshold');
    assert(pilotControlReady([]) === false, 'pilot review waits until both wallets sign');
    assert(pilotControlReady([PILOT_CREATOR]) === false, 'creator signature alone does not open the deposit');
    assert(pilotControlReady([PILOT_CREATOR, PILOT_RECIPIENT]) === true, 'both pilot signatures open the deposit review');
    const noRecusal = recipientRecusalThreshold(pilot.roster.valid, '0x1111111111111111111111111111111111111111');
    assert(noRecusal.eligibleCount === 2 && noRecusal.requiredYes === 2, 'an off-roster recipient leaves a 2-of-2 threshold');
  }

  console.log('\n--- Nomination window is exactly durationDays after prepare time ---');
  {
    const nowSec = 1_760_000_000;
    const oneDay = buildCreateRoundSchedule(1, 3, nowSec);
    assert(oneDay.nominationCutoff === nowSec + 86400, '1-day nomination cutoff is now+1d, not half the window');
    assert(oneDay.votingDuration === 3 * 86400, '1-day form keeps 3-day voting duration');
    assert(oneDay.roundEnd === oneDay.nominationCutoff + 86400 + oneDay.votingDuration, '1-day round end keeps 24h review + voting');
    const seven = buildCreateRoundSchedule(7, 3, nowSec);
    assert(seven.nominationCutoff === nowSec + 7 * 86400, '7-day nomination cutoff is now+7d');
    assert(seven.votingDuration === 3 * 86400, '7-day form keeps 3-day voting duration');
    assert(seven.roundEnd === seven.nominationCutoff + 86400 + seven.votingDuration, '7-day round end keeps 24h review + voting');
    const oneDayForm = validateCreateRoundForm({ ...completeForm, durationDaysInput: '1', votingDaysInput: '3' }, nowSec);
    assert(oneDayForm.ok === true, '1-day nomination / 3-day voting form is valid');
    assert(oneDayForm.schedule!.nominationCutoff === oneDay.nominationCutoff, '1-day form cutoff matches helper');
    assert(oneDayForm.schedule!.roundEnd === oneDay.roundEnd, '1-day form round end matches helper');
    const sevenForm = validateCreateRoundForm(completeForm, nowSec);
    assert(sevenForm.ok === true, '7-day recovered form is valid');
    assert(sevenForm.schedule!.nominationCutoff === seven.nominationCutoff, '7-day form cutoff matches helper');
    assert(sevenForm.schedule!.roundEnd === seven.roundEnd, '7-day form round end matches helper');
    assert(unixSecondsToUtcIso(seven.nominationCutoff) === '2025-10-16T08:53:20.000Z', 'frozen 7-day cutoff UTC');
    assert(unixSecondsToUtcIso(seven.roundEnd) === '2025-10-20T08:53:20.000Z', 'frozen 7-day round-end UTC');
  }

  console.log('\n--- Draft banner uses the actual browser origin ---');
  {
    assert(currentBrowserOrigin({ origin: 'http://127.0.0.1:5174' }) === 'http://127.0.0.1:5174', 'origin helper reports 5174');
    assert(currentBrowserOrigin({ origin: 'http://127.0.0.1:5173' }) === 'http://127.0.0.1:5173', 'origin helper reports 5173 when that is the window origin');
  }

  console.log('\n--- Draft save / navigate / restore ---');
  mockStore.clear();
  {
    const saved = saveRoundDraftToStore(localStorage, 'preview', draftFromFormValues(completeForm, { currentStep: 4 }));
    localStorage.setItem('cf_design_preview', 'true');
    const afterNavigate = readRoundDraftInventory(localStorage);
    assert(afterNavigate.preview?.title === recoveredDraft.title, 'preview draft survives navigation');
    const restored = formValuesFromDraft(afterNavigate.preview!);
    assert(restored.title === completeForm.title, 'restore keeps title');
    assert(restored.summary === completeForm.summary, 'restore keeps description');
    assert(restored.capInput === '0.1', 'restore keeps 0.1 GEN cap');
    assert(restored.depositInput === '1', 'restore keeps 1 GEN deposit');
    assert(restored.durationDaysInput === '7', 'restore keeps duration');
    assert(restored.votingDaysInput === '3', 'restore keeps voting window');
    assert(restored.permittedDirectives.length === 3, 'restore keeps all charter directives');
    assert(restored.exclusions.length === 2, 'restore keeps exclusions');
    assert(restored.rosterInput.includes('0x7E4E1f7DcC3DA063F9110477Ad348C90E8599253'), 'restore keeps first roster address');
    assert(restored.rosterInput.includes('0xb3F7518df619ef485f7a1568ED3705bB6f5B0407'), 'restore keeps third roster address');
    assert(restored.ratified === true, 'restore keeps ratification');
    assert(saved.currentStep === 4, 'restore keeps wizard step');
  }

  console.log('\n--- Preview / live toggle does not discard ---');
  {
    saveRoundDraftToStore(localStorage, 'working', draftFromFormValues(completeForm, { currentStep: 2 }));
    const liveMode = pickHydrationDraft(readRoundDraftInventory(localStorage), true);
    const previewMode = pickHydrationDraft(readRoundDraftInventory(localStorage), false);
    assert(liveMode?.title === recoveredDraft.title, 'live mode still sees working/preview values');
    assert(previewMode?.title === recoveredDraft.title, 'preview mode still sees the same values');
    const imported = importPreviewDraftToLive(localStorage);
    assert(imported?.title === recoveredDraft.title, 'explicit preview-to-live import copies title');
    assert(imported?.committeeAddresses.length === 3, 'import copies every roster address');
    assert(readRoundDraftInventory(localStorage).preview?.title === recoveredDraft.title, 'preview copy remains after import');
    assert(localStorage.getItem(ROUND_DRAFT_LIVE_KEY)?.includes(recoveredDraft.title) === true, 'live key receives imported draft');
  }

  console.log('\n--- Read error blocks wallet prompt ---');
  {
    const adapter = new MockAdapter();
    adapter.healthOk = false;
    const health = await adapter.probeContractViewHealth();
    const blocked = blockWalletIfUnhealthy(health);
    assert(blocked !== null, 'unhealthy gen_call blocks the wallet prompt');
    assert(/Network readback unavailable; no transaction sent/.test(blocked || ''), 'explicit readback-unavailable copy is shown');
    assert(isNetworkReadbackUnavailableError({ code: -32603, message: health.diagnostic }), '-32603 is classified as readback unavailable');
    const stillThere = formValuesFromDraft(readRoundDraftInventory(localStorage).preview!);
    assert(stillThere.title === recoveredDraft.title, 'form/draft remains after blocked submit');
  }

  console.log('\n--- Healthy read → one wallet prompt → verified round ---');
  clearPersistedTransactions();
  clearInMemoryBlockingMarkers();
  const submitCount = { n: 0 };
  setTransactionKitFactoryForTesting(() => buildKit({ submitCount }));
  const adapter = new MockAdapter();
  const provider = new MockProvider();
  const account = '0x1111111111111111111111111111111111111111';
  const validation = validateCreateRoundForm(completeForm);
  const roundId = 'round-rpc-health-test';
  const prepared = await prepareActionTransaction({
    action: 'create_round',
    provider: provider as any,
    account,
    chainId: 61997,
    adapter: adapter as any,
    createRoundArgs: {
      round_id: roundId,
      title: completeForm.title,
      description: completeForm.summary,
      charter_text: assembleCharterText({
        title: completeForm.title,
        summary: completeForm.summary,
        permittedDirectives: completeForm.permittedDirectives,
        exclusions: completeForm.exclusions,
      }),
      committee_roster: validation.roster.valid,
      grant_cap_wei: validation.capWei!,
      nomination_cutoff: validation.schedule!.nominationCutoff,
      voting_duration: validation.schedule!.votingDuration,
      round_end: validation.schedule!.roundEnd,
      initial_deposit_wei: validation.depositWei!,
    },
  });
  assert(prepared.roundId === roundId, 'prepared transaction carries the exact round ID');
  assert(prepared.quotedChainId === 61997, 'prepared transaction is chain 61997');
  assert(prepared.quotedContractAddress.toLowerCase() === NETWORK_CONFIG.contractAddress.toLowerCase(), 'prepared transaction targets CharterFlowCore');
  assert(prepared.payableValueWei === 10n ** 18n, 'prepared payable value is 1 GEN');
  assert(prepared.createRoundExpected?.committee.length === 3, 'review payload includes committee');
  const writeArgs = 'args' in prepared.submitInput ? prepared.submitInput.args : [];
  assert(prepared.createRoundExpected?.nominationCutoff === validation.schedule!.nominationCutoff, 'review cutoff matches prepared schedule');
  assert(prepared.createRoundExpected?.votingDuration === validation.schedule!.votingDuration, 'review voting duration matches prepared schedule');
  assert(prepared.createRoundExpected?.roundEnd === validation.schedule!.roundEnd, 'review round end matches prepared schedule');
  assert(writeArgs[6] === validation.schedule!.nominationCutoff, 'create_round arg nomination_cutoff matches review');
  assert(writeArgs[7] === validation.schedule!.votingDuration, 'create_round arg voting_duration matches review');
  assert(writeArgs[8] === validation.schedule!.roundEnd, 'create_round arg round_end matches review');
  {
    const nowSec = 1_760_000_000;
    const oneDayForm = validateCreateRoundForm({ ...completeForm, durationDaysInput: '1', votingDaysInput: '3' }, nowSec);
    const preparedOneDay = await prepareActionTransaction({
      action: 'create_round',
      provider: provider as any,
      account,
      chainId: 61997,
      adapter: adapter as any,
      createRoundArgs: {
        round_id: 'round-one-day-window',
        title: completeForm.title,
        description: completeForm.summary,
        charter_text: assembleCharterText({
          title: completeForm.title,
          summary: completeForm.summary,
          permittedDirectives: completeForm.permittedDirectives,
          exclusions: completeForm.exclusions,
        }),
        committee_roster: oneDayForm.roster.valid,
        grant_cap_wei: oneDayForm.capWei!,
        nomination_cutoff: oneDayForm.schedule!.nominationCutoff,
        voting_duration: oneDayForm.schedule!.votingDuration,
        round_end: oneDayForm.schedule!.roundEnd,
        initial_deposit_wei: oneDayForm.depositWei!,
      },
    });
    const oneDayArgs = 'args' in preparedOneDay.submitInput ? preparedOneDay.submitInput.args : [];
    assert(oneDayArgs[6] === nowSec + 86400, '1-day create_round cutoff arg is now+1d');
    assert(oneDayArgs[8] === nowSec + 86400 + 86400 + 3 * 86400, '1-day create_round round_end arg is cutoff+24h+voting');
    assert(preparedOneDay.createRoundExpected?.nominationCutoff === oneDayArgs[6], '1-day review cutoff matches write arg');
    assert(preparedOneDay.createRoundExpected?.roundEnd === oneDayArgs[8], '1-day review round end matches write arg');
  }

  const health = await adapter.probeContractViewHealth();
  assert(blockWalletIfUnhealthy(health) === null, 'healthy read allows the wallet prompt');
  const executed = await executeAndTrackTransaction(prepared, provider as any, account);
  assert(submitCount.n === 1, 'exactly one wallet/kit submit is sent');
  assert(executed.status === 'finalized-success', 'receipt finalizes successfully');
  adapter.rounds[roundId] = makeRound(roundId, { creatorAddress: account });
  const verified = await verifyIntendedStateAfterSuccess('create_round', roundId, adapter as any, account, {
    createRoundExpected: prepared.createRoundExpected,
    contractBalanceWei: 10n ** 18n,
  });
  assert(verified.verified === true, 'verified round is shown after matching readback');
  const reversedRoster = await verifyIntendedStateAfterSuccess('create_round', roundId, adapter as any, account, {
    createRoundExpected: {
      ...prepared.createRoundExpected!,
      committee: [...prepared.createRoundExpected!.committee].reverse(),
    },
    contractBalanceWei: 10n ** 18n,
  });
  assert(reversedRoster.verified === false, 'reversed committee order fails readback');
  assert(reversedRoster.message.includes('roster order'), 'roster-order mismatch names the order');

  console.log('\n--- Successful receipt + failed readback ---');
  clearPersistedTransactions();
  clearInMemoryBlockingMarkers();
  submitCount.n = 0;
  const uncertainId = 'round-readback-uncertain';
  const preparedUncertain: PreparedTransaction = {
    ...prepared,
    roundId: uncertainId,
    targetIdentifier: `create_round:${uncertainId}`,
    compositeTargetKey: `${account}:61997:${prepared.quotedContractAddress}:create_round:${uncertainId}`,
    createRoundExpected: { ...prepared.createRoundExpected!, },
  };
  const executedUncertain = await executeAndTrackTransaction(preparedUncertain, provider as any, account);
  assert(executedUncertain.txId, 'transaction hash is preserved');
  const failedRead = await verifyIntendedStateAfterSuccess('create_round', uncertainId, adapter as any, account, {
    createRoundExpected: preparedUncertain.createRoundExpected,
    contractBalanceWei: 10n ** 18n,
  });
  assert(failedRead.verified === false, 'missing round yields FINALIZED, READBACK UNCERTAIN');
  assert(submitCount.n === 1, 'failed readback does not send a second write');
  const persisted = getPersistedTransactions();
  assert(persisted.some((tx) => tx.txId === executedUncertain.txId), 'hash remains in persisted intents');
  const retryRead = await verifyIntendedStateAfterSuccess('create_round', uncertainId, adapter as any, account, {
    createRoundExpected: preparedUncertain.createRoundExpected,
  });
  assert(retryRead.verified === false, 'retry read without a round still does not write');
  assert(submitCount.n === 1, 'retry readback does not duplicate create_round');

  console.log('\n--- Successful receipt + execution-slot read error ---');
  const slotId = 'round-slots-occupied';
  adapter.rounds[slotId] = makeRound(slotId, { creatorAddress: account });
  adapter.slotErrorsRemaining = 1;
  const writesBeforeSlotRead = submitCount.n;
  const slotRead = await verifyIntendedStateAfterSuccess('create_round', slotId, adapter as any, account, {
    createRoundExpected: prepared.createRoundExpected,
    contractBalanceWei: 10n ** 18n,
  });
  assert(slotRead.verified === false, 'execution-slot exhaustion is READBACK UNCERTAIN');
  assert(
    slotRead.message.includes('all 8 execution slots occupied'),
    'slot exhaustion message is preserved'
  );
  assert(submitCount.n === writesBeforeSlotRead, 'slot read error sends zero additional writes');
  const slotReceipt = {
    status: 'finalized-success' as const,
    txId: executedUncertain.txId,
  };
  const presented = presentPostSuccessException(slotReceipt, new Error('Server busy: all 8 execution slots occupied, retry later.'));
  assert(presented.preserveReceipt === true, 'successful receipt is preserved');
  assert(presented.errorMsg === null, 'slot error is not a generic failed submission');
  assert(presented.banner === 'FINALIZED, READBACK UNCERTAIN', 'modal banner is FINALIZED, READBACK UNCERTAIN');
  assert(presented.showRetry === true, 'RETRY READBACK is offered');
  assert(presented.txId === executedUncertain.txId, 'full transaction hash remains');
  const slotRetry = await verifyIntendedStateAfterSuccess('create_round', slotId, adapter as any, account, {
    createRoundExpected: prepared.createRoundExpected,
    contractBalanceWei: 10n ** 18n,
  });
  assert(slotRetry.verified === true, 'read-only retry confirms the round after slots free');
  assert(submitCount.n === writesBeforeSlotRead, 'read-only retry sends zero additional writes');

  console.log('\n--- Explore ACTIVE label and open count ---');
  assert(exploreRoundStatusLabel('ACTIVE') === 'ACTIVE', 'ACTIVE card label is ACTIVE');
  assert(exploreRoundStatusLabel('ACTIVE') !== 'FINALIZED / SETTLED', 'ACTIVE does not fall through to FINALIZED / SETTLED');
  assert(exploreRoundStatusLabel('ACTIVE_VOTING') === 'VOTING OPEN', 'ACTIVE_VOTING card label is VOTING OPEN');
  assert(exploreRoundStatusLabel('COMPLIANCE') === 'COMPLIANCE STAGE', 'COMPLIANCE card label is unchanged');
  assert(exploreRoundStatusLabel('FINALIZED') === 'FINALIZED / SETTLED', 'FINALIZED card label stays settled');
  assert(exploreRoundStatusLabel('CLOSED') === 'FINALIZED / SETTLED', 'CLOSED card label stays settled');
  assert(exploreRoundStatusLabel('REFUND_EMITTED') === 'FINALIZED / SETTLED', 'REFUND_EMITTED card label stays settled');
  const openCount = countOpenRounds([
    { status: 'ACTIVE' },
    { status: 'ACTIVE' },
    { status: 'ACTIVE_VOTING' },
    { status: 'FINALIZED' },
    { status: 'COMPLIANCE' },
  ]);
  assert(openCount === 3, 'Active / Voting Open count includes ACTIVE and ACTIVE_VOTING');
  assert(roundMatchesExploreTab('ACTIVE', 'ACTIVE') === true, 'ACTIVE filter includes contract state ACTIVE');
  assert(roundMatchesExploreTab('FINALIZED', 'ACTIVE') === false, 'ACTIVE filter excludes FINALIZED');
  assert(roundMatchesExploreTab('CLOSED', 'CLOSED') === true, 'closed count includes CLOSED');
  assert(roundMatchesExploreTab('REFUND_EMITTED', 'CLOSED') === true, 'closed count includes REFUND_EMITTED');

  console.log('\n--- Verified create_round commits only the matching draft ---');
  mockStore.clear();
  const txEvidenceKey = 'cf_active_txs_rc2';
  const txEvidence = JSON.stringify([{ txId: '0xd29b3820cc1f45c2328c3c1e38f09fbef1c539689261311292afd3dd7f91ac2c', action: 'create_round' }]);
  mockStore.set(txEvidenceKey, txEvidence);
  const committedTitle = 'Studio Next RPC Health Dashboard Pilot';
  const otherTitle = 'A different uncommitted round';
  saveRoundDraftToStore(localStorage, 'live', {
    ...recoveredDraft,
    title: committedTitle,
    savedAt: '2026-10-16T09:40:00.000Z',
  });
  saveRoundDraftToStore(localStorage, 'preview', {
    ...recoveredDraft,
    title: otherTitle,
    savedAt: '2026-10-16T09:40:00.000Z',
  });
  const commitResult = commitMatchingRoundDrafts(localStorage, {
    roundId: 'round-studio-next-rpc--mvas9jju',
    title: `  ${committedTitle}  `,
    txId: '0xd29b3820cc1f45c2328c3c1e38f09fbef1c539689261311292afd3dd7f91ac2c',
  });
  assert(commitResult.committedStores.includes('live'), 'matching live draft is marked committed');
  assert(commitResult.preservedStores.includes('preview'), 'different-title preview draft is preserved');
  assert(!commitResult.committedStores.includes('preview'), 'different-title draft is not committed');
  const afterCommit = readRoundDraftInventory(localStorage);
  assert(afterCommit.live?.committedRoundId === 'round-studio-next-rpc--mvas9jju', 'committed draft records the verified round id');
  assert(
    afterCommit.live?.committedTxId === '0xd29b3820cc1f45c2328c3c1e38f09fbef1c539689261311292afd3dd7f91ac2c',
    'committed draft records the transaction id'
  );
  assert(afterCommit.live?.title === committedTitle, 'committed draft keeps its specification');
  assert(afterCommit.preview?.title === otherTitle, 'other draft title is unchanged');
  assert(!afterCommit.preview?.committedRoundId, 'other draft stays uncommitted');
  assert(firstUncommittedRoundDraft(afterCommit)?.title === otherTitle, 'explore candidate is the remaining uncommitted draft');
  assert(pickHydrationDraft(afterCommit, true)?.title === otherTitle, 'hydration skips the committed draft');
  assert(mockStore.get(txEvidenceKey) === txEvidence, 'transaction evidence is not cleared');
  const carried = withCarriedCommit(afterCommit.live, {
    ...afterCommit.live!,
    savedAt: '2026-10-16T10:00:00.000Z',
  });
  assert(carried.committedRoundId === 'round-studio-next-rpc--mvas9jju', 'resaving the same title keeps the committed mark');
  const retitled = withCarriedCommit(afterCommit.live, {
    ...afterCommit.live!,
    title: 'New specification',
  });
  assert(!retitled.committedRoundId, 'a different title does not inherit the committed mark');
  const already = commitDraftsForVerifiedRounds(localStorage, [
    { id: 'round-studio-next-rpc--mvas9jju', title: committedTitle },
  ]);
  assert(!already.committedStores.includes('live'), 'an already committed draft is not rewritten');
  assert(readRoundDraftInventory(localStorage).live?.committedTxId === '0xd29b3820cc1f45c2328c3c1e38f09fbef1c539689261311292afd3dd7f91ac2c', 'existing transaction id stays on the draft');

  mockStore.delete(ROUND_DRAFT_LIVE_KEY);
  mockStore.delete(ROUND_DRAFT_PREVIEW_KEY);
  mockStore.delete(ROUND_DRAFT_WORKING_KEY);
  saveRoundDraftToStore(localStorage, 'working', {
    ...recoveredDraft,
    title: committedTitle,
    savedAt: '2026-10-16T09:46:54.000Z',
  });
  saveRoundDraftToStore(localStorage, 'preview', {
    ...recoveredDraft,
    title: otherTitle,
    savedAt: '2026-10-16T09:46:54.000Z',
  });
  const fromChain = commitDraftsForVerifiedRounds(localStorage, [
    { id: 'round-studio-next-rpc--mvarlewq', title: committedTitle },
    { id: 'round-studio-next-rpc--mvas9jju', title: committedTitle },
  ]);
  assert(fromChain.committedStores.includes('working'), 'verified on-chain title commits the matching working draft');
  assert(fromChain.preservedStores.includes('preview'), 'a different title stays available');
  const afterChain = readRoundDraftInventory(localStorage);
  assert(afterChain.working?.committedRoundId === 'round-studio-next-rpc--mvas9jju', 'duplicate titles record the newest verified round id');
  assert(firstUncommittedRoundDraft(afterChain)?.title === otherTitle, 'only the unmatched draft remains an uncommitted candidate');
  assert(mockStore.get(txEvidenceKey) === txEvidence, 'on-chain draft commit does not clear transaction evidence');

  console.log('\n--- Storage keys ---');
  assert(ROUND_DRAFT_PREVIEW_KEY === 'cf_round_draft_preview', 'preview key name is unchanged');
  assert(ROUND_DRAFT_LIVE_KEY === 'cf_round_draft_live', 'live key name is unchanged');
  assert(ROUND_DRAFT_WORKING_KEY === 'cf_round_draft_working', 'working snapshot has its own key');

  const liveNow = Math.floor(Date.now() / 1000);
  const liveSeven = buildCreateRoundSchedule(7, 3, liveNow);
  console.log('\n--- Newly prepared 7-day nomination / 3-day voting UTC ---');
  console.log(`prepareTimeUnix=${liveNow} utc=${unixSecondsToUtcIso(liveNow)}`);
  console.log(`nominationCutoffUnix=${liveSeven.nominationCutoff} utc=${unixSecondsToUtcIso(liveSeven.nominationCutoff)}`);
  console.log(`votingDurationSecs=${liveSeven.votingDuration}`);
  console.log(`roundEndUnix=${liveSeven.roundEnd} utc=${unixSecondsToUtcIso(liveSeven.roundEnd)}`);

  console.log(`\n${passed}/${total} create-round flow tests passed`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
