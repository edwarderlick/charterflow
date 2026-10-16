import type { RoundDraft } from '../types';

export const ROUND_DRAFT_PREVIEW_KEY = 'cf_round_draft_preview';
export const ROUND_DRAFT_LIVE_KEY = 'cf_round_draft_live';
export const ROUND_DRAFT_WORKING_KEY = 'cf_round_draft_working';

export type RoundDraftStore = 'preview' | 'live' | 'working';

export interface StoredRoundDraft extends RoundDraft {
  rosterRaw?: string;
  ratified?: boolean;
  currentStep?: number;
  sourceStore?: RoundDraftStore;
  committedRoundId?: string;
  committedTxId?: string;
  committedAt?: string;
}

export interface RoundDraftInventory {
  preview: StoredRoundDraft | null;
  live: StoredRoundDraft | null;
  working: StoredRoundDraft | null;
}

function storageGet(storage: Pick<Storage, 'getItem'> | null | undefined, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(storage: Pick<Storage, 'setItem'> | null | undefined, key: string, value: string): void {
  if (!storage) return;
  storage.setItem(key, value);
}

export function parseRoundDraft(raw: string | null | undefined, sourceStore?: RoundDraftStore): StoredRoundDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredRoundDraft;
    if (!parsed || typeof parsed !== 'object') return null;
    const title = typeof parsed.title === 'string' ? parsed.title : '';
    const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
    const committeeAddresses = Array.isArray(parsed.committeeAddresses)
      ? parsed.committeeAddresses.map((item) => String(item))
      : [];
    const charterRules = Array.isArray(parsed.charterRules)
      ? parsed.charterRules.map((rule) => ({
          title: String(rule?.title || ''),
          description: String(rule?.description || rule?.title || ''),
        }))
      : [];
    const charterExclusions = Array.isArray(parsed.charterExclusions)
      ? parsed.charterExclusions.map((rule) => ({
          title: String(rule?.title || ''),
          severity: String(rule?.severity || 'EXCLUSION'),
        }))
      : [];
    return {
      title,
      summary,
      capPerProposalGen: Number(parsed.capPerProposalGen),
      durationDays: Number(parsed.durationDays),
      charterRules,
      charterExclusions,
      committeeAddresses,
      consensusThresholdPercent: Number(parsed.consensusThresholdPercent) || 66.67,
      votingWindowDays: Number(parsed.votingWindowDays),
      initialDepositGen: Number(parsed.initialDepositGen),
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
      rosterRaw: typeof parsed.rosterRaw === 'string' ? parsed.rosterRaw : committeeAddresses.join(',\n'),
      plannedRecipient: typeof parsed.plannedRecipient === 'string' ? parsed.plannedRecipient : '',
      ratified: parsed.ratified === true,
      currentStep: Number.isFinite(Number(parsed.currentStep)) ? Number(parsed.currentStep) : undefined,
      sourceStore,
      committedRoundId: typeof parsed.committedRoundId === 'string' ? parsed.committedRoundId : undefined,
      committedTxId: typeof parsed.committedTxId === 'string' ? parsed.committedTxId : undefined,
      committedAt: typeof parsed.committedAt === 'string' ? parsed.committedAt : undefined,
    };
  } catch {
    return null;
  }
}

export function keyForStore(store: RoundDraftStore): string {
  if (store === 'preview') return ROUND_DRAFT_PREVIEW_KEY;
  if (store === 'live') return ROUND_DRAFT_LIVE_KEY;
  return ROUND_DRAFT_WORKING_KEY;
}

export function readRoundDraft(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  store: RoundDraftStore
): StoredRoundDraft | null {
  return parseRoundDraft(storageGet(storage, keyForStore(store)), store);
}

export function readRoundDraftInventory(
  storage: Pick<Storage, 'getItem'> | null | undefined
): RoundDraftInventory {
  return {
    preview: readRoundDraft(storage, 'preview'),
    live: readRoundDraft(storage, 'live'),
    working: readRoundDraft(storage, 'working'),
  };
}

export function isCommittedRoundDraft(draft: StoredRoundDraft | null | undefined): boolean {
  return Boolean(draft?.committedRoundId);
}

export function firstUncommittedRoundDraft(inventory: RoundDraftInventory): StoredRoundDraft | null {
  const candidates = [inventory.preview, inventory.live, inventory.working];
  for (const draft of candidates) {
    if (draftHasUserContent(draft) && !isCommittedRoundDraft(draft)) return draft || null;
  }
  return null;
}

export function commitDraftsForVerifiedRounds(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined,
  rounds: Array<{ id: string; title: string }>
): { committedStores: RoundDraftStore[]; preservedStores: RoundDraftStore[] } {
  const stores: RoundDraftStore[] = ['preview', 'live', 'working'];
  const committedStores: RoundDraftStore[] = [];
  const preservedStores: RoundDraftStore[] = [];
  const committedAt = new Date().toISOString();
  for (const store of stores) {
    const draft = readRoundDraft(storage, store);
    if (!draft || !draftHasUserContent(draft)) continue;
    if (isCommittedRoundDraft(draft)) {
      preservedStores.push(store);
      continue;
    }
    const match = [...rounds].reverse().find((round) => round.title.trim() && round.title.trim() === draft.title.trim());
    if (!match) {
      preservedStores.push(store);
      continue;
    }
    saveRoundDraftToStore(storage, store, {
      ...draft,
      committedRoundId: match.id,
      committedAt,
      sourceStore: store,
    });
    committedStores.push(store);
  }
  return { committedStores, preservedStores };
}

export function commitMatchingRoundDrafts(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined,
  match: { roundId: string; title: string; txId?: string }
): { committedStores: RoundDraftStore[]; preservedStores: RoundDraftStore[] } {
  const committedAt = new Date().toISOString();
  const stores: RoundDraftStore[] = ['preview', 'live', 'working'];
  const committedStores: RoundDraftStore[] = [];
  const preservedStores: RoundDraftStore[] = [];
  const title = match.title.trim();
  for (const store of stores) {
    const draft = readRoundDraft(storage, store);
    if (!draft || !draftHasUserContent(draft)) continue;
    if (title && draft.title.trim() === title) {
      saveRoundDraftToStore(storage, store, {
        ...draft,
        committedRoundId: match.roundId,
        committedTxId: match.txId,
        committedAt,
        sourceStore: store,
      });
      committedStores.push(store);
    } else {
      preservedStores.push(store);
    }
  }
  return { committedStores, preservedStores };
}

export function draftHasUserContent(draft: StoredRoundDraft | null | undefined): boolean {
  if (!draft) return false;
  return Boolean(
    draft.title.trim() ||
      draft.summary.trim() ||
      (draft.rosterRaw && draft.rosterRaw.trim()) ||
      draft.committeeAddresses.length > 0 ||
      draft.charterRules.length > 0 ||
      Number.isFinite(draft.initialDepositGen) ||
      Number.isFinite(draft.capPerProposalGen)
  );
}

export function saveRoundDraftToStore(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  store: RoundDraftStore,
  draft: StoredRoundDraft
): StoredRoundDraft {
  const payload: StoredRoundDraft = {
    ...draft,
    savedAt: new Date().toISOString(),
    sourceStore: store,
  };
  storageSet(storage, keyForStore(store), JSON.stringify(payload));
  return payload;
}

/**
 * Explicit preview → live copy. Does not clear the preview draft.
 */
export function importPreviewDraftToLive(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined
): StoredRoundDraft | null {
  const preview = readRoundDraft(storage, 'preview');
  if (!preview || !draftHasUserContent(preview)) return null;
  return saveRoundDraftToStore(storage, 'live', { ...preview, sourceStore: 'live' });
}

/** Keep a verified create_round mark when the same title is saved again. A different title stays uncommitted. */
export function withCarriedCommit(existing: StoredRoundDraft | null | undefined, next: StoredRoundDraft): StoredRoundDraft {
  if (existing?.committedRoundId && next.title.trim() && existing.title.trim() === next.title.trim()) {
    return {
      ...next,
      committedRoundId: existing.committedRoundId,
      committedTxId: existing.committedTxId,
      committedAt: existing.committedAt,
    };
  }
  const uncommitted: StoredRoundDraft = { ...next };
  delete uncommitted.committedRoundId;
  delete uncommitted.committedTxId;
  delete uncommitted.committedAt;
  return uncommitted;
}

export function pickHydrationDraft(inventory: RoundDraftInventory, preferLive: boolean): StoredRoundDraft | null {
  const usable = (draft: StoredRoundDraft | null) => draftHasUserContent(draft) && !isCommittedRoundDraft(draft);
  if (usable(inventory.working)) return inventory.working;
  const primary = preferLive ? inventory.live : inventory.preview;
  const secondary = preferLive ? inventory.preview : inventory.live;
  if (usable(primary)) return primary;
  if (usable(secondary)) return secondary;
  return null;
}
