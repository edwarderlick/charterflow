import {
  createTransactionKit,
  type TransactionKit,
  type PolicyQuote,
  type SubmitInput,
  type TrackedStatus,
  type Eip1193Provider,
} from '@genlayer/transaction-kit';
import { studioDevnet } from 'genlayer-js/chains';
import { NETWORK_CONFIG, isContractConfigured, VERIFIED_DEPLOYMENT } from '../config/network';
import { GENLAYER_STUDIO_NEXT } from '../context/WalletContext';
import { type DataAccessAdapter } from './dataAccess';
import type { Proposal } from '../types';

export type ActionType =
  | 'create_round'
  | 'nominate_proposal'
  | 'evaluate_charter_fit'
  | 'cast_vote'
  | 'settle_expired_proposal'
  | 'withdraw_credit'
  | 'close_round_and_refund'
  | 'claim_creator_refund';

export type PersistedTxStatus =
  | 'intent-prepared'
  | 'broadcast-unknown'
  | 'submitted'
  | 'pending'
  | 'processing'
  | 'accepted'
  | 'finalized-success'
  | 'finalized-error'
  | 'unresolved'
  | 'timeout';

export const BLOCKING_STATUSES: PersistedTxStatus[] = [
  'intent-prepared',
  'broadcast-unknown',
  'submitted',
  'pending',
  'processing',
  'accepted',
  'timeout',
  'unresolved',
];

export interface PersistedTx {
  intentId: string;
  txId?: `0x${string}`;
  evmTxHash?: `0x${string}`;
  action: ActionType;
  roundId?: string;
  proposalId?: string;
  account: string;
  chainId: number;
  contractAddress: string;
  targetIdentifier: string; // e.g. "create_round:round-1" or "vote:prp-1"
  compositeTargetKey: string; // account:chainId:contractAddress:targetIdentifier
  userValueWei: string;
  feeValueWei: string;
  totalValueWei: string;
  intendedArgumentsJson?: string;
  submittedAt: number;
  status: PersistedTxStatus;
  phase?: string;
  statusName?: string;
  executionResultName?: string;
  successful?: boolean;
  error?: string;
  completedAt?: number;
  storageFailure?: boolean;
  preBroadcastProposalIds?: string[];
  nominateArgs?: {
    round_id: string;
    proposer: string;
    recipient: string;
    title: string;
    requested_amount_wei: string;
    deliverables_text: string;
  };
}

export interface PreparedTransaction {
  action: ActionType;
  targetIdentifier: string;
  compositeTargetKey: string;
  roundId?: string;
  proposalId?: string;
  submitInput: SubmitInput;
  quote: PolicyQuote;
  payableValueWei: bigint;
  feeValueWei: bigint;
  totalValueWei: bigint;
  isBlocked: boolean;
  blockReason?: string;
  quotedAccount: string;
  quotedChainId: number;
  quotedContractAddress: string;
  quotedArgsJson: string;
  quotedAt: number;
  preBroadcastProposalIds?: string[];
  nominateArgs?: {
    round_id: string;
    proposer: string;
    recipient: string;
    title: string;
    requested_amount_wei: bigint;
    deliverables_text: string;
  };
}

export interface StorageState {
  status: 'empty' | 'valid' | 'corrupt' | 'denied';
  txs: PersistedTx[];
  error?: string;
  corruptRaw?: string;
}

const STORAGE_KEY = 'cf_active_txs_rc2';

// In-memory session blocking markers to ensure unpersisted submissions remain blocked
const inMemoryBlockingMarkers = new Map<string, PersistedTx>();

/**
 * Releases this call's reservation only while it is conclusively pre-broadcast.
 * If durable cleanup fails, the in-memory blocker is retained so a duplicate
 * cannot be submitted while stale storage still requires reconciliation.
 */
function releasePreBroadcastReservation(intent: PersistedTx): void {
  const marker = inMemoryBlockingMarkers.get(intent.compositeTargetKey);
  if (
    !marker ||
    marker.intentId !== intent.intentId ||
    marker.status !== 'intent-prepared' ||
    marker.txId
  ) {
    return;
  }

  const state = readPersistedTransactions();
  if (state.status === 'valid') {
    const persisted = state.txs.find((tx) => tx.intentId === intent.intentId);
    if (persisted && (persisted.status !== 'intent-prepared' || persisted.txId)) {
      return;
    }

    if (persisted) {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(state.txs.filter((tx) => tx.intentId !== intent.intentId))
        );
      } catch (err: any) {
        inMemoryBlockingMarkers.set(intent.compositeTargetKey, {
          ...intent,
          storageFailure: true,
          error: `Pre-broadcast reservation cleanup failed: ${err?.message || 'Storage write failed'}. Manual reconciliation required.`,
        });
        return;
      }
    }
  } else if (state.status === 'corrupt' || state.status === 'denied') {
    // Storage cannot be inspected safely, so retain the blocker.
    return;
  }

  inMemoryBlockingMarkers.delete(intent.compositeTargetKey);
}

export function getInMemoryBlockingMarkers(): PersistedTx[] {
  return Array.from(inMemoryBlockingMarkers.values());
}

export function clearInMemoryBlockingMarkers(): void {
  inMemoryBlockingMarkers.clear();
}

/**
 * Distinguishes genuinely empty localStorage from read errors, corrupt JSON,
 * and invalid record shapes. Preserves corrupt data without replacing or overwriting it.
 */
export function readPersistedTransactions(): StorageState {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err: any) {
    return {
      status: 'denied',
      txs: [],
      error: `LocalStorage access denied or unreadable: ${err?.message || 'Access error'}`,
    };
  }

  // Genuinely empty storage
  if (raw === null || raw.trim() === '') {
    return {
      status: 'empty',
      txs: [],
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    return {
      status: 'corrupt',
      txs: [],
      error: `LocalStorage contains corrupt JSON: ${err?.message || 'Parse error'}`,
      corruptRaw: raw,
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      status: 'corrupt',
      txs: [],
      error: `LocalStorage data is malformed: expected JSON array, found ${typeof parsed}`,
      corruptRaw: raw,
    };
  }

  const validTxs: PersistedTx[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    const hasValidTxId = typeof item?.txId === 'string' && item.txId.startsWith('0x');
    const hasValidIntentId = typeof item?.intentId === 'string' && item.intentId.length > 0;
    if (
      !item ||
      typeof item !== 'object' ||
      (!hasValidTxId && !hasValidIntentId) ||
      typeof item.action !== 'string' ||
      typeof item.status !== 'string'
    ) {
      return {
        status: 'corrupt',
        txs: [],
        error: `LocalStorage record at index ${i} has invalid record shape (missing required intentId/txId, action, or status)`,
        corruptRaw: raw,
      };
    }
    if (!item.intentId && item.txId) {
      item.intentId = `intent_${item.txId}`;
    }
    validTxs.push(item as PersistedTx);
  }

  return {
    status: 'valid',
    txs: validTxs,
  };
}

/**
 * Checks that persistence works before permitting a wallet submission.
 */
export function verifyStoragePersistenceWritable(): { writable: boolean; error?: string } {
  const state = readPersistedTransactions();
  if (state.status === 'corrupt') {
    return {
      writable: false,
      error: `Storage contains corrupt data (${state.error}). Submissions blocked to preserve data for manual reconciliation.`,
    };
  }
  if (state.status === 'denied') {
    return {
      writable: false,
      error: `Storage access is denied or unavailable (${state.error}).`,
    };
  }

  const probeKey = 'cf_storage_write_probe';
  try {
    localStorage.setItem(probeKey, '1');
    localStorage.removeItem(probeKey);
    return { writable: true };
  } catch (err: any) {
    return {
      writable: false,
      error: `Storage quota exceeded or storage unwritable: ${err?.message || 'Write failed'}`,
    };
  }
}

/**
 * Returns all valid persisted transactions. Returns empty array if storage is corrupt
 * without overwriting the corrupt data.
 */
export function getPersistedTransactions(): PersistedTx[] {
  const state = readPersistedTransactions();
  return state.txs;
}

/**
 * Saves a persisted transaction. Never overwrites corrupt storage.
 * Retains an in-memory session marker so failed storage writes still block duplicate attempts.
 */
export function savePersistedTransaction(tx: PersistedTx): {
  success: boolean;
  error?: string;
  corruptPreserved?: boolean;
} {
  if (!tx.intentId) {
    tx.intentId = tx.txId
      ? `intent_${tx.txId}`
      : `intent_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  // Always register in in-memory session markers
  if (tx.compositeTargetKey) {
    inMemoryBlockingMarkers.set(tx.compositeTargetKey, tx);
  }

  const state = readPersistedTransactions();
  if (state.status === 'corrupt') {
    return {
      success: false,
      error: `Storage write blocked: localStorage contains corrupt data which must be preserved for manual reconciliation. ${state.error}`,
      corruptPreserved: true,
    };
  }
  if (state.status === 'denied') {
    return {
      success: false,
      error: state.error,
    };
  }

  try {
    const txs = state.txs.filter(
      (item) =>
        (tx.intentId ? item.intentId !== tx.intentId : true) &&
        (tx.txId ? item.txId !== tx.txId : true)
    );
    txs.push(tx);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(txs));
    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'LocalStorage quota exceeded or storage unavailable',
    };
  }
}

/**
 * Updates a persisted transaction and surfaces update failures.
 * Matches by either intentId or txId.
 */
export function updatePersistedTransaction(
  idOrTxId: string,
  updates: Partial<PersistedTx>
): { updated: PersistedTx | null; error?: string } {
  // Update in-memory session marker if present
  let inMemoryMatch: PersistedTx | null = null;
  for (const [key, marker] of inMemoryBlockingMarkers.entries()) {
    if (marker.intentId === idOrTxId || marker.txId === idOrTxId) {
      const updated = { ...marker, ...updates };
      inMemoryBlockingMarkers.set(key, updated);
      inMemoryMatch = updated;
    }
  }

  const state = readPersistedTransactions();
  if (state.status === 'corrupt' || state.status === 'denied') {
    return {
      updated: inMemoryMatch,
      error: `Storage update failed: localStorage is ${state.status} (${state.error})`,
    };
  }

  const txs = state.txs;
  const idx = txs.findIndex(
    (item) => item.intentId === idOrTxId || item.txId === idOrTxId
  );
  if (idx === -1) {
    return {
      updated: inMemoryMatch,
      error: inMemoryMatch ? undefined : `Transaction "${idOrTxId}" not found in storage`,
    };
  }

  const updated = { ...txs[idx], ...updates };
  txs[idx] = updated;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(txs));
    return { updated };
  } catch (err: any) {
    return {
      updated: inMemoryMatch || updated,
      error: `Failed to persist update to storage: ${err?.message || 'Storage write failed'}`,
    };
  }
}

export function buildCompositeTargetKey(
  account: string,
  chainId: number,
  contractAddress: string,
  targetIdentifier: string
): string {
  return `${account.toLowerCase()}:${chainId}:${contractAddress.toLowerCase()}:${targetIdentifier}`;
}

export function getInFlightTransaction(compositeTargetKey: string): PersistedTx | null {
  // Check in-memory session markers first
  const inMemory = inMemoryBlockingMarkers.get(compositeTargetKey);
  if (inMemory && (BLOCKING_STATUSES.includes(inMemory.status) || inMemory.storageFailure)) {
    return inMemory;
  }

  // Then check persisted records
  const { txs } = readPersistedTransactions();
  return (
    txs.find(
      (tx) =>
        tx.compositeTargetKey === compositeTargetKey &&
        (BLOCKING_STATUSES.includes(tx.status) || tx.storageFailure)
    ) || null
  );
}

export function getInFlightTransactionForTarget(targetIdentifier: string): PersistedTx | null {
  // Check in-memory session markers
  for (const marker of inMemoryBlockingMarkers.values()) {
    if (
      (marker.targetIdentifier === targetIdentifier ||
        marker.compositeTargetKey.endsWith(`:${targetIdentifier}`)) &&
      (BLOCKING_STATUSES.includes(marker.status) || marker.storageFailure)
    ) {
      return marker;
    }
  }

  // Check persisted records
  const { txs } = readPersistedTransactions();
  return (
    txs.find(
      (tx) =>
        (tx.targetIdentifier === targetIdentifier ||
          (tx.compositeTargetKey && tx.compositeTargetKey.endsWith(`:${targetIdentifier}`))) &&
        (BLOCKING_STATUSES.includes(tx.status) || tx.storageFailure)
    ) || null
  );
}

export function clearPersistedTransactions(): void {
  inMemoryBlockingMarkers.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}

/**
 * Returns the chain preset for Chain ID 61997 preserving studioDevnet fields.
 */
export function getStudioDevnetChain() {
  return {
    ...studioDevnet,
    rpcUrls: {
      ...studioDevnet.rpcUrls,
      default: {
        http: [NETWORK_CONFIG.rpcUrl],
      },
    },
  };
}

let kitFactoryOverride: ((provider: Eip1193Provider, account?: `0x${string}`) => TransactionKit) | null = null;

export function setTransactionKitFactoryForTesting(
  factory: ((provider: Eip1193Provider, account?: `0x${string}`) => TransactionKit) | null
): void {
  kitFactoryOverride = factory;
}

/**
 * Creates a Transaction Kit instance for the active injected provider.
 * Uses Transaction Kit's documented network-default quote.
 */
export function getTransactionKitInstance(
  provider: Eip1193Provider,
  account?: `0x${string}`
): TransactionKit {
  if (kitFactoryOverride) {
    return kitFactoryOverride(provider, account);
  }
  const chain = getStudioDevnetChain();
  return createTransactionKit({
    chain,
    provider,
    ...(account ? { account } : {}),
  });
}

export function serializeSubmitInput(input: SubmitInput): string {
  return JSON.stringify(input, (_key, value) =>
    typeof value === 'bigint' ? `${value.toString()}n` : value
  );
}

export const RECOVERY_ROUND_ID = VERIFIED_DEPLOYMENT.intendedRoundId;

export function parseBlockTimestampSeconds(block: unknown): number {
  const raw = (block as { timestamp?: string | number } | null)?.timestamp;
  if (raw === undefined || raw === null || raw === '') {
    throw new Error('NOMINATION_WINDOW_READ_FAILED: latest block timestamp missing');
  }
  const n = typeof raw === 'string' && raw.startsWith('0x') ? parseInt(raw, 16) : Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('NOMINATION_WINDOW_READ_FAILED: latest block timestamp is not a unix time');
  }
  return n;
}

export function assertNominationWindowOpen(params: {
  chainTimeSec: number | bigint | string;
  nominationCutoffSec: number | bigint | string;
  roundId: string;
}): { chainTimeSec: string; nominationCutoffSec: string; roundId: string } {
  const rid = String(params.roundId || '');
  if (rid.toLowerCase() === RECOVERY_ROUND_ID.toLowerCase()) {
    const err = new Error(
      `RECOVERY_ROUND_NOMINATION_FORBIDDEN: ${RECOVERY_ROUND_ID} is a locked recovery/refund case. Nomination is forbidden.`
    );
    (err as Error & { code?: string }).code = 'RECOVERY_ROUND_NOMINATION_FORBIDDEN';
    throw err;
  }
  const chainTime = BigInt(params.chainTimeSec);
  const cutoff = BigInt(params.nominationCutoffSec);
  if (chainTime >= cutoff) {
    const err = new Error(
      `EXPIRED_NOMINATION_WINDOW: chainTime=${chainTime} cutoff=${cutoff} round=${rid}`
    );
    (err as Error & { code?: string }).code = 'EXPIRED_NOMINATION_WINDOW';
    throw err;
  }
  return {
    chainTimeSec: chainTime.toString(),
    nominationCutoffSec: cutoff.toString(),
    roundId: rid,
  };
}

async function readProviderChainTimeSeconds(provider: Eip1193Provider): Promise<number> {
  let block: unknown;
  try {
    block = await provider.request({ method: 'eth_getBlockByNumber', params: ['latest', false] });
  } catch (err: any) {
    throw new Error(
      `NOMINATION_WINDOW_READ_FAILED: eth_getBlockByNumber failed: ${err?.message || 'Provider error'}`
    );
  }
  return parseBlockTimestampSeconds(block);
}

// ==============================================================================
// Pre-Flight & Preparation
// ==============================================================================

export interface PrepareActionParams {
  action: ActionType;
  provider: Eip1193Provider;
  account: string;
  chainId: number;
  contractAddress?: string;
  roundId?: string;
  proposalId?: string;
  adapter?: DataAccessAdapter;
  // Specific method args
  createRoundArgs?: {
    round_id: string;
    title: string;
    description: string;
    charter_text: string;
    committee_roster: string[];
    grant_cap_wei: bigint;
    nomination_cutoff: number;
    voting_duration: number;
    round_end: number;
    initial_deposit_wei: bigint;
  };
  nominateProposalArgs?: {
    round_id: string;
    recipient: string;
    title: string;
    requested_amount_wei: bigint;
    deliverables_text: string;
  };
  castVoteArgs?: {
    proposal_id: string;
    vote_type: 'YES' | 'NO';
    recipientAddress?: string;
  };
  settleExpiredArgs?: {
    round_id: string;
    proposal_id: string;
  };
}

export async function prepareActionTransaction(
  params: PrepareActionParams
): Promise<PreparedTransaction> {
  const { action, provider, account, chainId, adapter } = params;

  // 1. Check persistence works before permitting wallet preparation
  const storageCheck = verifyStoragePersistenceWritable();
  if (!storageCheck.writable) {
    throw new Error(
      `Persistence check failed before submission: ${storageCheck.error} Action blocked to prevent unpersisted broadcast.`
    );
  }

  // 2. Strict Chain & Wallet Verification (No Fallbacks)
  if (!account || !account.startsWith('0x')) {
    throw new Error('Wallet not connected. Connect an EIP-1193 wallet on Chain 61997 to continue.');
  }
  if (typeof chainId !== 'number' || chainId !== GENLAYER_STUDIO_NEXT.chainId) {
    throw new Error(
      `Incorrect network: wallet connected to Chain ID ${chainId}. CharterFlow operates strictly on GenLayer Studio Next (Chain ID 61997).`
    );
  }

  // 3. Query provider live state immediately before estimate
  let liveChainHex: any;
  try {
    liveChainHex = await provider.request({ method: 'eth_chainId' });
  } catch (err: any) {
    throw new Error(`Failed to query provider chain ID: ${err?.message || 'Provider error'}`);
  }
  const liveChainId = typeof liveChainHex === 'string' ? parseInt(liveChainHex, 16) : Number(liveChainHex);
  if (liveChainId !== GENLAYER_STUDIO_NEXT.chainId) {
    throw new Error(
      `Provider chain mismatch: provider returned Chain ID ${liveChainId}, expected ${GENLAYER_STUDIO_NEXT.chainId} (GenLayer Studio Next).`
    );
  }

  let liveAccounts: any;
  try {
    liveAccounts = await provider.request({ method: 'eth_accounts' });
  } catch (err: any) {
    throw new Error(`Failed to query provider accounts: ${err?.message || 'Provider error'}`);
  }
  const activeAccount = Array.isArray(liveAccounts) && liveAccounts[0] ? String(liveAccounts[0]).toLowerCase() : null;
  if (!activeAccount || activeAccount !== account.toLowerCase()) {
    throw new Error(
      `Active account mismatch: provider account is ${activeAccount || 'none'}, expected ${account}.`
    );
  }

  // 4. Contract Address Verification
  const contractAddr = (params.contractAddress || NETWORK_CONFIG.contractAddress) as `0x${string}`;
  if (!contractAddr || !isContractConfigured(contractAddr)) {
    throw new Error('CharterFlow contract address not configured or invalid on Chain 61997.');
  }

  // 5. Exact Action Identity & Target Identification
  let targetIdentifier = `${action}`;
  let carriedRoundId = params.roundId;
  let carriedProposalId = params.proposalId;

  if (action === 'create_round') {
    if (!params.createRoundArgs?.round_id) {
      throw new Error('Missing round_id for create_round');
    }
    carriedRoundId = params.createRoundArgs.round_id;
    targetIdentifier = `create_round:${carriedRoundId}`;
  } else if (action === 'nominate_proposal') {
    if (!params.nominateProposalArgs?.round_id) {
      throw new Error('Missing round_id for nominate_proposal');
    }
    carriedRoundId = params.nominateProposalArgs.round_id;
    targetIdentifier = `nominate_proposal:${carriedRoundId}:${params.nominateProposalArgs.recipient.toLowerCase()}`;
  } else if (carriedProposalId) {
    targetIdentifier = `${action}:${carriedProposalId}`;
  } else if (carriedRoundId) {
    targetIdentifier = `${action}:${carriedRoundId}`;
  }

  const compositeTargetKey = buildCompositeTargetKey(account, chainId, contractAddr, targetIdentifier);

  const existingInFlight = getInFlightTransaction(compositeTargetKey);
  if (existingInFlight) {
    const idDisplay = existingInFlight.txId
      ? `${existingInFlight.txId.slice(0, 10)}...`
      : `intent:${existingInFlight.intentId}`;
    if (existingInFlight.storageFailure) {
      throw new Error(
        `A previous submission (${idDisplay}) to this target (${targetIdentifier}) failed to save in storage. An in-memory blocking marker prevents further writes to this target in this session. Manual reconciliation is required.`
      );
    }
    throw new Error(
      `An active transaction (${idDisplay}) with status "${existingInFlight.status}" is already recorded for this target (${targetIdentifier}). Duplicate write is blocked until conclusively resolved on-chain.`
    );
  }

  // 6. Build exact contract write input and payable value
  let submitInput: SubmitInput;
  let payableValueWei = 0n;
  let preBroadcastProposalIds: string[] | undefined;
  let preparedNominateArgs: PreparedTransaction['nominateArgs'] | undefined;

  switch (action) {
    case 'create_round': {
      const args = params.createRoundArgs;
      if (!args) throw new Error('Missing arguments for create_round');
      payableValueWei = args.initial_deposit_wei;
      if (payableValueWei < 1000000000000000000n) {
        throw new Error('Initial deposit must be at least 1 GEN (1e18 wei).');
      }
      if (args.grant_cap_wei <= 0n || args.grant_cap_wei > payableValueWei) {
        throw new Error('Grant cap must be positive and cannot exceed initial deposit.');
      }
      if (args.round_end <= args.nomination_cutoff) {
        throw new Error('Invalid time sequence: round_end must be strictly after nomination_cutoff');
      }
      if (args.voting_duration < 3600) {
        throw new Error('Invalid voting duration: voting duration must be at least 3600 seconds (1 hour)');
      }
      if (args.nomination_cutoff + 86400 + args.voting_duration > args.round_end) {
        throw new Error('Invalid time sequence: round_end must allow at least 24h + voting duration buffer after nomination cutoff');
      }
      submitInput = {
        kind: 'write',
        address: contractAddr,
        method: 'create_round',
        args: [
          args.round_id,
          args.title,
          args.description,
          args.charter_text,
          args.committee_roster,
          args.grant_cap_wei,
          args.nomination_cutoff,
          args.voting_duration,
          args.round_end,
        ],
      };
      break;
    }

    case 'nominate_proposal': {
      const args = params.nominateProposalArgs;
      if (!args) throw new Error('Missing arguments for nominate_proposal');
      if (args.requested_amount_wei <= 0n) {
        throw new Error('Requested amount must be greater than zero wei.');
      }
      if (!args.recipient || !args.recipient.startsWith('0x') || args.recipient === '0x0000000000000000000000000000000000000000') {
        throw new Error('Invalid recipient address.');
      }

      // Capture complete, paginated proposal-ID snapshot. Never replace a failed or malformed read with [].
      if (!adapter) {
        throw new Error('DataAccessAdapter is required to capture pre-broadcast proposal snapshot for nomination attribution.');
      }

      if (args.round_id.toLowerCase() === RECOVERY_ROUND_ID.toLowerCase()) {
        throw new Error(
          `RECOVERY_ROUND_NOMINATION_FORBIDDEN: ${RECOVERY_ROUND_ID} is a locked recovery/refund case. Nomination is forbidden.`
        );
      }

      const chainTimeSec = await readProviderChainTimeSeconds(provider);
      let liveRound;
      try {
        liveRound = await adapter.getRoundById(args.round_id);
      } catch (err: any) {
        throw new Error(
          `NOMINATION_WINDOW_READ_FAILED: get_round(${args.round_id}) failed: ${err?.message || 'Read error'}. Submission blocked.`
        );
      }
      if (!liveRound) {
        throw new Error(
          `NOMINATION_WINDOW_READ_FAILED: round "${args.round_id}" was not returned. Submission blocked.`
        );
      }
      if (liveRound.nominationCutoffUnix === undefined || liveRound.nominationCutoffUnix === null) {
        throw new Error(
          `NOMINATION_WINDOW_READ_FAILED: round "${args.round_id}" is missing on-chain nomination_cutoff. Submission blocked.`
        );
      }
      assertNominationWindowOpen({
        chainTimeSec,
        nominationCutoffSec: liveRound.nominationCutoffUnix,
        roundId: args.round_id,
      });

      if (!carriedRoundId) {
        throw new Error('Target round ID is required for proposal nomination.');
      }

      let existingProposals: Proposal[];
      try {
        existingProposals = await adapter.getProposalsByRound(carriedRoundId);
      } catch (err: any) {
        throw new Error(
          `Failed to capture pre-broadcast proposal snapshot for round "${carriedRoundId}": ${err?.message || 'Read error'}. Submission blocked.`
        );
      }

      if (!Array.isArray(existingProposals)) {
        throw new Error(
          `Malformed response capturing pre-broadcast proposal snapshot for round "${carriedRoundId}": expected array. Submission blocked.`
        );
      }

      for (let i = 0; i < existingProposals.length; i++) {
        const ep = existingProposals[i];
        if (!ep || typeof ep !== 'object' || !ep.id || typeof ep.id !== 'string') {
          throw new Error(
            `Malformed proposal record at index ${i} in pre-broadcast snapshot for round "${carriedRoundId}". Submission blocked.`
          );
        }
      }

      preBroadcastProposalIds = existingProposals.map((p) => p.id);

      preparedNominateArgs = {
        round_id: carriedRoundId,
        proposer: account.toLowerCase(),
        recipient: args.recipient.toLowerCase(),
        title: args.title.trim(),
        requested_amount_wei: args.requested_amount_wei,
        deliverables_text: args.deliverables_text.trim(),
      };

      submitInput = {
        kind: 'write',
        address: contractAddr,
        method: 'nominate_proposal',
        args: [
          args.round_id,
          args.recipient,
          args.title,
          args.requested_amount_wei,
          args.deliverables_text,
        ],
      };
      break;
    }

    case 'evaluate_charter_fit': {
      if (!params.proposalId) throw new Error('Missing proposalId for evaluate_charter_fit');
      submitInput = {
        kind: 'write',
        address: contractAddr,
        method: 'evaluate_charter_fit',
        args: [params.proposalId],
      };
      break;
    }

    case 'cast_vote': {
      const args = params.castVoteArgs;
      if (!args || !args.proposal_id || !args.vote_type) {
        throw new Error('Missing proposal_id or vote_type for cast_vote');
      }
      if (args.vote_type !== 'YES' && args.vote_type !== 'NO') {
        throw new Error('Invalid vote type: vote must be YES or NO');
      }
      if (args.recipientAddress && args.recipientAddress.toLowerCase() === account.toLowerCase()) {
        throw new Error('Recipient recusal: proposal recipient cannot vote on their own proposal.');
      }
      submitInput = {
        kind: 'write',
        address: contractAddr,
        method: 'cast_vote',
        args: [args.proposal_id, args.vote_type],
      };
      break;
    }

    case 'settle_expired_proposal': {
      const args = params.settleExpiredArgs;
      if (!args || !args.round_id || !args.proposal_id) {
        throw new Error('Missing round_id or proposal_id for settle_expired_proposal');
      }
      submitInput = {
        kind: 'write',
        address: contractAddr,
        method: 'settle_expired_proposal',
        args: [args.round_id, args.proposal_id],
      };
      break;
    }

    case 'withdraw_credit': {
      if (!params.proposalId) throw new Error('Missing proposalId for withdraw_credit');
      submitInput = {
        kind: 'write',
        address: contractAddr,
        method: 'withdraw_credit',
        args: [params.proposalId],
      };
      break;
    }

    case 'close_round_and_refund': {
      if (!params.roundId) throw new Error('Missing roundId for close_round_and_refund');
      submitInput = {
        kind: 'write',
        address: contractAddr,
        method: 'close_round_and_refund',
        args: [params.roundId],
      };
      break;
    }

    case 'claim_creator_refund': {
      if (!params.roundId) throw new Error('Missing roundId for claim_creator_refund');
      submitInput = {
        kind: 'write',
        address: contractAddr,
        method: 'claim_creator_refund',
        args: [params.roundId],
      };
      break;
    }

    default:
      throw new Error(`Unsupported action type: ${action}`);
  }

  // 7. Estimate fees using network-default quoting
  const kit = getTransactionKitInstance(provider, account as `0x${string}`);
  const quote = await kit.estimate(
    {
      preset: 'standard',
      userValue: payableValueWei,
    },
    submitInput
  );

  // 8. Verification and message fee policy guardrails
  let isBlocked = false;
  let blockReason: string | undefined;

  // Fee policy price cap mismatch
  if (quote.verification && quote.verification.status === 'mismatch') {
    isBlocked = true;
    blockReason =
      'Fee policy mismatch detected: live chain fee price caps do not match the quoted distribution hash. Action is blocked to prevent gas loss or stale execution.';
  }

  // Message-emitting actions: withdraw_credit and claim_creator_refund emit external transfers.
  if (action === 'withdraw_credit' || action === 'claim_creator_refund') {
    isBlocked = true;
    blockReason =
      'Submission disabled: emit_transfer requires verified message fee budget allocation. Fee measurement cannot be completed in local test mode and must be verified against deployed contract before live broadcast.';
  }

  return {
    action,
    targetIdentifier,
    compositeTargetKey,
    roundId: carriedRoundId,
    proposalId: carriedProposalId,
    submitInput,
    quote,
    payableValueWei,
    feeValueWei: quote.feeValue,
    totalValueWei: quote.total,
    isBlocked,
    blockReason,
    quotedAccount: account.toLowerCase(),
    quotedChainId: chainId,
    quotedContractAddress: contractAddr.toLowerCase(),
    quotedArgsJson: serializeSubmitInput(submitInput),
    quotedAt: Date.now(),
    preBroadcastProposalIds,
    nominateArgs: preparedNominateArgs,
  };
}

// ==============================================================================
// Proposal Correlation for nominate_proposal
// ==============================================================================

export async function correlateNominatedProposalId(
  roundId: string,
  args: {
    round_id: string;
    proposer: string;
    recipient: string;
    title: string;
    requested_amount_wei: bigint;
    deliverables_text: string;
  },
  preBroadcastSnapshot: string[],
  adapter: DataAccessAdapter
): Promise<{ proposalId?: string; error?: string }> {
  let currentProposals: Proposal[];
  try {
    currentProposals = await adapter.getProposalsByRound(roundId);
  } catch (err: any) {
    return {
      error: `Failed to fetch post-finalization proposals for round "${roundId}": ${err?.message || 'Read error'}`,
    };
  }

  // Calculate new-ID delta
  const candidateIds = currentProposals
    .map((p) => p.id)
    .filter((id) => !preBroadcastSnapshot.includes(id));

  if (candidateIds.length === 0) {
    return {
      error: `Could not uniquely correlate newly created proposal: no new proposal IDs found in round delta (0 new proposals created).`,
    };
  }

  // For EVERY candidate, fetch the FULL get_proposal record
  const matchingCandidates: Proposal[] = [];
  for (const cid of candidateIds) {
    let fullProposal: Proposal | null = null;
    try {
      fullProposal = await adapter.getProposalById(cid);
    } catch (err: any) {
      return {
        error: `Inconclusive proposal correlation: candidate proposal "${cid}" could not be read (${err?.message || 'Read error'}). Attribution halted inconclusive; transaction ID preserved without attaching unverified proposal.`,
      };
    }
    if (!fullProposal) {
      return {
        error: `Inconclusive proposal correlation: candidate proposal "${cid}" returned null or empty record. Attribution halted inconclusive; transaction ID preserved without attaching unverified proposal.`,
      };
    }

    if (
      typeof fullProposal !== 'object' ||
      !fullProposal.id ||
      !fullProposal.roundId ||
      !fullProposal.nominatorAddress ||
      !fullProposal.recipientAddress ||
      typeof fullProposal.title !== 'string' ||
      fullProposal.requestedAmountWei === undefined ||
      fullProposal.requestedAmountWei === null ||
      !fullProposal.status
    ) {
      return {
        error: `Inconclusive proposal correlation: candidate proposal "${cid}" returned a malformed record. Attribution halted inconclusive; transaction ID preserved without attaching unverified proposal.`,
      };
    }

    const isRound = fullProposal.roundId === args.round_id;
    const isProposer = fullProposal.nominatorAddress.toLowerCase() === args.proposer.toLowerCase();
    const isRecipient = fullProposal.recipientAddress.toLowerCase() === args.recipient.toLowerCase();
    const isTitle = fullProposal.title.trim() === args.title.trim();
    // Compare full deliverables text (not a 120-character summary preview!)
    const candidateDeliverables = (
      fullProposal.deliverables?.[0]?.description ||
      fullProposal.workDescription ||
      ''
    ).trim();
    const isDeliverables = candidateDeliverables === args.deliverables_text.trim();
    // Compare requested amount in exact wei (not floating-point GEN!)
    const isWei = fullProposal.requestedAmountWei
      ? BigInt(fullProposal.requestedAmountWei) === args.requested_amount_wei
      : false;
    const isState = fullProposal.status === 'SUBMITTED';

    if (isRound && isProposer && isRecipient && isTitle && isDeliverables && isWei && isState) {
      matchingCandidates.push(fullProposal);
    }
  }

  if (matchingCandidates.length === 1) {
    return { proposalId: matchingCandidates[0].id };
  }
  if (matchingCandidates.length === 0) {
    return {
      error: `No candidate proposal in round delta (${candidateIds.length} candidate IDs examined) matched all required full fields (round ID, proposer wallet, recipient, title, exact wei amount, and full deliverables text).`,
    };
  }
  // Multiple matches -> Inconclusive
  return {
    error: `Ambiguous proposal correlation: ${matchingCandidates.length} candidate proposals in round delta matched all nomination fields exactly. Inconclusive correlation halted; transaction ID preserved without attaching arbitrary proposal.`,
  };
}

// ==============================================================================
// Submission, Immediate Persistence & Tracking
// ==============================================================================

export interface ExecuteTransactionCallbacks {
  onStatusUpdate?: (status: TrackedStatus) => void;
  onSubmitted?: (txId: `0x${string}`, evmTxHash?: `0x${string}`) => void;
  onPersistenceFailure?: (txId: `0x${string}`, error?: string) => void;
}

export async function executeAndTrackTransaction(
  prepared: PreparedTransaction,
  provider: Eip1193Provider,
  account: string,
  callbacks?: ExecuteTransactionCallbacks
): Promise<PersistedTx> {
  if (prepared.isBlocked) {
    throw new Error(prepared.blockReason || 'Transaction is blocked due to policy verification failure.');
  }

  // Pre-submit persistence verification: ensure persistence works before wallet broadcast
  const storageCheck = verifyStoragePersistenceWritable();
  if (!storageCheck.writable) {
    throw new Error(
      `Persistence check failed immediately before submit: ${storageCheck.error} Action blocked to prevent unpersisted broadcast.`
    );
  }

  // Atomically check and reserve the target in this JavaScript turn. There must
  // be no await between this check and the in-memory reservation.
  const existingInFlight = getInFlightTransaction(prepared.compositeTargetKey);
  if (existingInFlight) {
    const idDisplay = existingInFlight.txId || existingInFlight.intentId;
    if (existingInFlight.storageFailure) {
      throw new Error(
        `Double submission prevented: a previous submission (${idDisplay}) failed to save in storage and remains blocked in this session.`
      );
    }
    throw new Error(
      `Double submission prevented: transaction ${idDisplay} with status "${existingInFlight.status}" is already recorded for this target.`
    );
  }

  const intentId = `intent_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const initialIntentRecord: PersistedTx = {
    intentId,
    action: prepared.action,
    roundId: prepared.roundId,
    proposalId: prepared.proposalId,
    account: prepared.quotedAccount,
    chainId: prepared.quotedChainId,
    contractAddress: prepared.quotedContractAddress,
    targetIdentifier: prepared.targetIdentifier,
    compositeTargetKey: prepared.compositeTargetKey,
    userValueWei: prepared.payableValueWei.toString(),
    feeValueWei: prepared.feeValueWei.toString(),
    totalValueWei: prepared.totalValueWei.toString(),
    intendedArgumentsJson: prepared.quotedArgsJson,
    submittedAt: Date.now(),
    status: 'intent-prepared',
    phase: 'intent-prepared',
    preBroadcastProposalIds: prepared.preBroadcastProposalIds,
    nominateArgs: prepared.nominateArgs
      ? {
          round_id: prepared.nominateArgs.round_id,
          proposer: prepared.nominateArgs.proposer,
          recipient: prepared.nominateArgs.recipient,
          title: prepared.nominateArgs.title,
          requested_amount_wei: prepared.nominateArgs.requested_amount_wei.toString(),
          deliverables_text: prepared.nominateArgs.deliverables_text,
        }
      : undefined,
  };
  inMemoryBlockingMarkers.set(initialIntentRecord.compositeTargetKey, initialIntentRecord);

  // Persist the full durable intent before the first await and before any wallet
  // broadcast. A one-byte storage probe is not sufficient evidence.
  const saveIntentRes = savePersistedTransaction(initialIntentRecord);
  if (!saveIntentRes.success) {
    releasePreBroadcastReservation(initialIntentRecord);
    throw new Error(
      `Persistence check failed immediately before submit: ${saveIntentRes.error}. Action blocked to prevent unpersisted broadcast.`
    );
  }

  // Re-query provider immediately before submit. Every failure in this section
  // is provably pre-broadcast and may release only this call's reservation.
  let kit: TransactionKit;
  try {
  let liveChainHex: any;
  try {
    liveChainHex = await provider.request({ method: 'eth_chainId' });
  } catch (err: any) {
    throw new Error(`Failed to verify provider chain ID before submit: ${err?.message || 'Provider error'}`);
  }
  const liveChainId = typeof liveChainHex === 'string' ? parseInt(liveChainHex, 16) : Number(liveChainHex);
  if (liveChainId !== prepared.quotedChainId) {
    throw new Error(
      `Chain switch detected after quote: provider is on Chain ID ${liveChainId}, expected ${prepared.quotedChainId}. Please request a fresh quote.`
    );
  }

  let liveAccounts: any;
  try {
    liveAccounts = await provider.request({ method: 'eth_accounts' });
  } catch (err: any) {
    throw new Error(`Failed to verify provider accounts before submit: ${err?.message || 'Provider error'}`);
  }
  const activeAccount = Array.isArray(liveAccounts) && liveAccounts[0] ? String(liveAccounts[0]).toLowerCase() : null;
  if (!activeAccount || activeAccount !== prepared.quotedAccount) {
    throw new Error(
      `Wallet switch detected after quote: active account changed to ${activeAccount || 'none'}, expected ${prepared.quotedAccount}. Please request a fresh quote.`
    );
  }

  const currentArgsJson = serializeSubmitInput(prepared.submitInput);
  if (currentArgsJson !== prepared.quotedArgsJson) {
    throw new Error('Transaction arguments changed after quote. Please request a fresh quote.');
  }

  // Check quote staleness: quotes expire after 120 seconds (2 minutes)
  const MAX_QUOTE_AGE_MS = 120000;
  if (prepared.quotedAt && Date.now() - prepared.quotedAt > MAX_QUOTE_AGE_MS) {
    throw new Error(
      `Quote has become stale (${Math.floor((Date.now() - prepared.quotedAt) / 1000)}s old). Network conditions, fee distribution, or proposal state may have shifted. Please request a fresh quote.`
    );
  }

  // Nomination write intent must retain pre-broadcast snapshot
  if (prepared.action === 'nominate_proposal' && (!prepared.preBroadcastProposalIds || !prepared.nominateArgs)) {
    throw new Error('Nomination intent is missing pre-broadcast proposal snapshot. Please request a fresh quote.');
  }
    kit = getTransactionKitInstance(provider, account as `0x${string}`);
  } catch (preBroadcastErr) {
    releasePreBroadcastReservation(initialIntentRecord);
    throw preBroadcastErr;
  }

  // Submit via Transaction Kit
  let submitResult: { genlayerTxId?: `0x${string}`; evmTxHash?: `0x${string}` };
  try {
    submitResult = await kit.submit(prepared.quote, prepared.submitInput);
  } catch (submitErr: any) {
    // If submit throws after a possible broadcast, retain the intent as broadcast-unknown
    // and block duplicate writes after reload. Never delete it!
    const updatedUnknown = updatePersistedTransaction(intentId, {
      status: 'broadcast-unknown',
      error: `Submit threw after potential broadcast: ${submitErr?.message || 'Submit error'}. Manual reconciliation required.`,
    });
    if (updatedUnknown.updated) {
      inMemoryBlockingMarkers.set(initialIntentRecord.compositeTargetKey, updatedUnknown.updated);
    }
    throw submitErr;
  }

  const { genlayerTxId, evmTxHash } = submitResult;
  if (!genlayerTxId || !genlayerTxId.startsWith('0x')) {
    updatePersistedTransaction(intentId, {
      status: 'broadcast-unknown',
      error: 'Submission failed: transaction ID not returned by provider after potential broadcast.',
    });
    throw new Error('Submission failed: transaction ID not returned by provider.');
  }

  // Submit returned transaction ID: update that intent with the ID
  const updateRes = updatePersistedTransaction(intentId, {
    txId: genlayerTxId,
    evmTxHash,
    status: 'submitted',
    phase: 'submitted',
  });

  const persistedRecord: PersistedTx = updateRes.updated || {
    ...initialIntentRecord,
    txId: genlayerTxId,
    evmTxHash,
    status: 'submitted',
    phase: 'submitted',
  };

  if (updateRes.error) {
    persistedRecord.storageFailure = true;
    persistedRecord.status = 'broadcast-unknown';
    persistedRecord.error = `Transaction was submitted (${genlayerTxId}), but updating storage failed: ${updateRes.error}. Manual reconciliation required.`;
    inMemoryBlockingMarkers.set(initialIntentRecord.compositeTargetKey, persistedRecord);
    callbacks?.onPersistenceFailure?.(genlayerTxId, updateRes.error);
    callbacks?.onSubmitted?.(genlayerTxId, evmTxHash);
    return persistedRecord;
  }

  callbacks?.onSubmitted?.(genlayerTxId, evmTxHash);

  // Track transaction lifecycle
  try {
    const finalTracked = await kit.track(
      genlayerTxId,
      (tracked) => {
        callbacks?.onStatusUpdate?.(tracked);
        let status: PersistedTxStatus = 'processing';
        if (tracked.phase === 'pending') status = 'pending';
        else if (tracked.phase === 'decided' && tracked.statusName === 'ACCEPTED') status = 'accepted';

        updatePersistedTransaction(genlayerTxId, {
          phase: tracked.phase,
          statusName: tracked.statusName,
          executionResultName: tracked.executionResultName,
          status,
        });
      },
      { until: 'finalized' }
    );

    // If tracking ended without phase === 'finalized', do not mark as finalized
    if (finalTracked.phase !== 'finalized') {
      const res = updatePersistedTransaction(genlayerTxId, {
        status: 'unresolved',
        phase: finalTracked.phase,
        statusName: finalTracked.statusName,
        executionResultName: finalTracked.executionResultName,
      });
      return res.updated || persistedRecord;
    }

    // Call successful ONLY when (status is ACCEPTED or FINALIZED) AND (execution is FINISHED_WITH_RETURN)
    const isAcceptedOrFinalized =
      finalTracked.statusName === 'ACCEPTED' || finalTracked.statusName === 'FINALIZED';
    const isFinishedWithReturn =
      finalTracked.executionResultName === 'FINISHED_WITH_RETURN';

    const isSuccessful = isAcceptedOrFinalized && isFinishedWithReturn;

    // Conclusive failure results explicitly reported by chain
    const conclusiveFailures = [
      'FINISHED_WITH_ERROR',
      'EXECUTION_FAILED',
      'REVERTED',
      'ERROR',
      'FAILED',
    ];
    const isConclusiveFailure =
      conclusiveFailures.includes(String(finalTracked.executionResultName || '')) ||
      finalTracked.statusName === 'REJECTED' ||
      finalTracked.statusName === 'CANCELED' ||
      finalTracked.statusName === 'CANCELLED';

    let finalStatus: PersistedTxStatus;
    if (isSuccessful) {
      finalStatus = 'finalized-success';
    } else if (isConclusiveFailure) {
      finalStatus = 'finalized-error';
    } else {
      // Missing or unknown execution result remains inconclusive / unresolved
      finalStatus = 'unresolved';
    }

    const res = updatePersistedTransaction(genlayerTxId, {
      phase: finalTracked.phase,
      statusName: finalTracked.statusName,
      executionResultName: finalTracked.executionResultName,
      successful: isSuccessful,
      status: finalStatus,
      completedAt: Date.now(),
      error: !isSuccessful
        ? isConclusiveFailure
          ? `Execution ${finalTracked.executionResultName || 'UNSUCCESSFUL'} (Status: ${finalTracked.statusName || 'UNKNOWN'})`
          : 'Execution result missing or unknown; outcome is inconclusive and blocks duplicate write.'
        : undefined,
    });

    return res.updated || persistedRecord;
  } catch (err: any) {
    // Tracking failed or timed out: DO NOT AUTO-RESEND. Persist as unresolved/timeout.
    const isTimeout = String(err?.message || '').toLowerCase().includes('time');
    const status: PersistedTxStatus = isTimeout ? 'timeout' : 'unresolved';
    const res = updatePersistedTransaction(genlayerTxId, {
      status,
      error: err?.message || 'Transaction tracking unresolved or timed out.',
      completedAt: Date.now(),
    });
    return res.updated || persistedRecord;
  }
}

/**
 * Resumes tracking for any in-flight transactions persisted in local storage.
 * Does not resubmit. Non-finalized outcomes remain unresolved or timeout.
 * If storage is corrupt, flags manualReconciliationRequired rather than claiming safe resubmission.
 */
export async function resumeInFlightTracking(
  provider: Eip1193Provider,
  account: string,
  onUpdate?: (tx: PersistedTx) => void,
  onStorageError?: (error: string) => void
): Promise<{ resumedCount: number; manualReconciliationRequired?: boolean; error?: string }> {
  const state = readPersistedTransactions();
  if (state.status === 'corrupt' || state.status === 'denied') {
    onStorageError?.(`Storage is in ${state.status} state: ${state.error}. Manual reconciliation required.`);
    return {
      resumedCount: 0,
      manualReconciliationRequired: true,
      error: state.error,
    };
  }

  const inFlight = state.txs.filter((tx) => BLOCKING_STATUSES.includes(tx.status));
  if (inFlight.length === 0) {
    return { resumedCount: 0 };
  }

  let manualReconciliationRequired = false;
  const kit = getTransactionKitInstance(provider, account as `0x${string}`);

  for (const tx of inFlight) {
    // If the transaction is broadcast-unknown, intent-prepared, or missing a valid txId:
    // It cannot be tracked automatically. Never delete it, never auto-retry.
    if (tx.status === 'broadcast-unknown' || tx.status === 'intent-prepared' || !tx.txId) {
      manualReconciliationRequired = true;
      if (tx.status === 'intent-prepared') {
        const res = updatePersistedTransaction(tx.intentId, {
          status: 'broadcast-unknown',
          error: 'Transaction was prepared for broadcast before reload. Broadcast status is unknown; manual reconciliation required.',
        });
        if (res.updated && onUpdate) onUpdate(res.updated);
      } else {
        if (onUpdate) onUpdate(tx);
      }
      continue;
    }

    const currentTxId = tx.txId;
    try {
      const finalTracked = await kit.track(
        currentTxId,
        (tracked) => {
          let status: PersistedTxStatus = 'processing';
          if (tracked.phase === 'pending') status = 'pending';
          else if (tracked.phase === 'decided' && tracked.statusName === 'ACCEPTED') status = 'accepted';

          const res = updatePersistedTransaction(currentTxId, {
            phase: tracked.phase,
            statusName: tracked.statusName,
            executionResultName: tracked.executionResultName,
            status,
          });
          if (res.updated && onUpdate) onUpdate(res.updated);
        },
        { until: 'finalized' }
      );

      if (finalTracked.phase === 'finalized') {
        const isSuccessful =
          (finalTracked.statusName === 'ACCEPTED' || finalTracked.statusName === 'FINALIZED') &&
          finalTracked.executionResultName === 'FINISHED_WITH_RETURN';

        const conclusiveFailures = [
          'FINISHED_WITH_ERROR',
          'EXECUTION_FAILED',
          'REVERTED',
          'ERROR',
          'FAILED',
        ];
        const isConclusiveFailure =
          conclusiveFailures.includes(String(finalTracked.executionResultName || '')) ||
          finalTracked.statusName === 'REJECTED' ||
          finalTracked.statusName === 'CANCELED' ||
          finalTracked.statusName === 'CANCELLED';

        let finalStatus: PersistedTxStatus;
        if (isSuccessful) {
          finalStatus = 'finalized-success';
        } else if (isConclusiveFailure) {
          finalStatus = 'finalized-error';
        } else {
          finalStatus = 'unresolved';
        }

        const res = updatePersistedTransaction(currentTxId, {
          status: finalStatus,
          phase: finalTracked.phase,
          statusName: finalTracked.statusName,
          executionResultName: finalTracked.executionResultName,
          successful: isSuccessful,
          completedAt: Date.now(),
        });
        if (res.updated && onUpdate) onUpdate(res.updated);
      } else {
        const res = updatePersistedTransaction(currentTxId, {
          status: 'unresolved',
          phase: finalTracked.phase,
          statusName: finalTracked.statusName,
          executionResultName: finalTracked.executionResultName,
          completedAt: Date.now(),
        });
        if (res.updated && onUpdate) onUpdate(res.updated);
      }
    } catch (err: any) {
      const isTimeout = String(err?.message || '').toLowerCase().includes('time');
      const res = updatePersistedTransaction(currentTxId, {
        status: isTimeout ? 'timeout' : 'unresolved',
        error: err?.message || 'Tracking stopped.',
        completedAt: Date.now(),
      });
      if (res.updated && onUpdate) onUpdate(res.updated);
    }
  }

  return {
    resumedCount: inFlight.length,
    manualReconciliationRequired: manualReconciliationRequired ? true : undefined,
  };
}

// ==============================================================================
// Post-Execution State Verification
// ==============================================================================

export interface PostStateVerificationContext {
  nominateArgs?: {
    round_id: string;
    proposer: string;
    recipient: string;
    title: string;
    requested_amount_wei: bigint;
    deliverables_text: string;
  };
  preBroadcastProposalIds?: string[];
  roundId?: string;
}

/**
 * Verifies on-chain state transition after successful transaction.
 * Strictly verifies the exact intended record ID and state rather than selecting a global latest item.
 */
export async function verifyIntendedStateAfterSuccess(
  action: ActionType,
  targetId: string,
  adapter: DataAccessAdapter,
  expectedCaller?: string,
  context?: PostStateVerificationContext
): Promise<{ verified: boolean; message: string; correlatedProposalId?: string }> {
  switch (action) {
    case 'create_round': {
      const round = await adapter.getRoundById(targetId);
      if (!round) {
        return { verified: false, message: `Round "${targetId}" not found in contract storage.` };
      }
      if (round.status !== 'ACTIVE') {
        return {
          verified: false,
          message: `Expected round "${targetId}" to be ACTIVE, found "${round.status}".`,
        };
      }
      if (expectedCaller && round.creatorAddress.toLowerCase() !== expectedCaller.toLowerCase()) {
        return {
          verified: false,
          message: `Creator address mismatch: expected ${expectedCaller}, got ${round.creatorAddress}.`,
        };
      }
      return { verified: true, message: `Round "${targetId}" verified ACTIVE on Chain 61997.` };
    }

    case 'nominate_proposal': {
      // If targetId is already a correlated proposal ID (prp-...)
      if (targetId && targetId.startsWith('prp-')) {
        const proposal = await adapter.getProposalById(targetId);
        if (!proposal) {
          return { verified: false, message: `Proposal "${targetId}" not found in contract storage.` };
        }
        if (proposal.status !== 'SUBMITTED') {
          return {
            verified: false,
            message: `Expected proposal "${targetId}" to be SUBMITTED, found "${proposal.status}".`,
          };
        }
        if (context?.nominateArgs) {
          const args = context.nominateArgs;
          const isRound = proposal.roundId === args.round_id;
          const isProposer = proposal.nominatorAddress.toLowerCase() === args.proposer.toLowerCase();
          const isRecipient = proposal.recipientAddress.toLowerCase() === args.recipient.toLowerCase();
          const isTitle = proposal.title.trim() === args.title.trim();
          const candidateDeliverables = (
            proposal.deliverables?.[0]?.description ||
            proposal.workDescription ||
            ''
          ).trim();
          const isDeliverables = candidateDeliverables === args.deliverables_text.trim();
          const isWei = proposal.requestedAmountWei
            ? BigInt(proposal.requestedAmountWei) === args.requested_amount_wei
            : false;

          if (!isRound || !isProposer || !isRecipient || !isTitle || !isDeliverables || !isWei) {
            return {
              verified: false,
              message: `Proposal "${targetId}" readback failed full field comparison (roundMatch=${isRound}, proposerMatch=${isProposer}, recipientMatch=${isRecipient}, titleMatch=${isTitle}, deliverablesMatch=${isDeliverables}, weiMatch=${isWei}).`,
            };
          }
        }
        return {
          verified: true,
          message: `Proposal "${targetId}" verified SUBMITTED with matching full fields.`,
          correlatedProposalId: targetId,
        };
      }

      // Correlate from round delta
      if (context?.roundId && context.nominateArgs && context.preBroadcastProposalIds) {
        const corr = await correlateNominatedProposalId(
          context.roundId,
          context.nominateArgs,
          context.preBroadcastProposalIds,
          adapter
        );
        if (corr.error || !corr.proposalId) {
          return {
            verified: false,
            message: corr.error || 'Proposal correlation failed.',
          };
        }
        const proposal = await adapter.getProposalById(corr.proposalId);
        if (!proposal) {
          return {
            verified: false,
            message: `Correlated proposal "${corr.proposalId}" could not be retrieved from contract.`,
          };
        }
        if (proposal.status !== 'SUBMITTED') {
          return {
            verified: false,
            message: `Expected correlated proposal "${corr.proposalId}" to be SUBMITTED, found "${proposal.status}".`,
          };
        }

        const args = context.nominateArgs;
        const isRound = proposal.roundId === args.round_id;
        const isProposer = proposal.nominatorAddress.toLowerCase() === args.proposer.toLowerCase();
        const isRecipient = proposal.recipientAddress.toLowerCase() === args.recipient.toLowerCase();
        const isTitle = proposal.title.trim() === args.title.trim();
        const candidateDeliverables = (
          proposal.deliverables?.[0]?.description ||
          proposal.workDescription ||
          ''
        ).trim();
        const isDeliverables = candidateDeliverables === args.deliverables_text.trim();
        const isWei = proposal.requestedAmountWei
          ? BigInt(proposal.requestedAmountWei) === args.requested_amount_wei
          : false;

        if (!isRound || !isProposer || !isRecipient || !isTitle || !isDeliverables || !isWei) {
          return {
            verified: false,
            message: `Correlated proposal "${corr.proposalId}" readback failed full field comparison.`,
          };
        }

        return {
          verified: true,
          message: `Proposal "${corr.proposalId}" uniquely correlated and verified SUBMITTED with matching full fields.`,
          correlatedProposalId: corr.proposalId,
        };
      }

      // If targetId is a roundId, explicitly DO NOT call getProposalById(targetId)!
      return {
        verified: false,
        message:
          'Nomination post-state unverified: cannot verify without correlated proposal ID or pre-broadcast snapshot.',
      };
    }

    case 'evaluate_charter_fit': {
      const proposal = await adapter.getProposalById(targetId);
      if (!proposal) {
        return { verified: false, message: `Proposal "${targetId}" not found.` };
      }
      if (proposal.status === 'SUBMITTED') {
        return {
          verified: false,
          message: `Proposal "${targetId}" remained in SUBMITTED state; charter evaluation did not take effect.`,
        };
      }
      const validEvaluated = ['ELIGIBLE', 'INELIGIBLE', 'NEEDS_CLARITY', 'EXPIRED'];
      if (!validEvaluated.includes(proposal.status)) {
        return {
          verified: false,
          message: `Proposal "${targetId}" status "${proposal.status}" is not a recognized post-evaluation state.`,
        };
      }
      return {
        verified: true,
        message: `Proposal "${targetId}" verified evaluated (${proposal.status}).`,
      };
    }

    case 'cast_vote': {
      const proposal = await adapter.getProposalById(targetId);
      if (!proposal) {
        return { verified: false, message: `Proposal "${targetId}" not found.` };
      }
      if (expectedCaller) {
        const hasVoted = proposal.eventLog?.some(
          (e) => e.voterNode?.toLowerCase() === expectedCaller.toLowerCase()
        );
        if (!hasVoted) {
          return {
            verified: false,
            message: `Voter ${expectedCaller} ballot participation not recorded in contract voter log.`,
          };
        }
      }
      if (proposal.status !== 'VOTING' && proposal.status !== 'APPROVED') {
        return {
          verified: false,
          message: `Proposal "${targetId}" state is "${proposal.status}"; expected VOTING or APPROVED.`,
        };
      }
      return { verified: true, message: `Ballot on proposal "${targetId}" recorded on-chain.` };
    }

    case 'settle_expired_proposal': {
      const proposal = await adapter.getProposalById(targetId);
      if (!proposal) {
        return { verified: false, message: `Proposal "${targetId}" not found.` };
      }
      if (proposal.status !== 'EXPIRED' && proposal.status !== 'REJECTED') {
        return {
          verified: false,
          message: `Proposal "${targetId}" state did not transition; still in "${proposal.status}" state (deadlines may not have lapsed).`,
        };
      }
      return { verified: true, message: `Proposal "${targetId}" settled as ${proposal.status}.` };
    }

    case 'withdraw_credit': {
      const proposal = await adapter.getProposalById(targetId);
      if (!proposal) {
        return { verified: false, message: `Proposal "${targetId}" not found.` };
      }
      if (proposal.status !== 'PAYOUT_EMITTED') {
        return {
          verified: false,
          message: `Expected state PAYOUT_EMITTED, received "${proposal.status}".`,
        };
      }
      return {
        verified: true,
        message: `Grant allocation verified as PAYOUT_EMITTED (native transfer emitted by contract).`,
      };
    }

    case 'close_round_and_refund': {
      const round = await adapter.getRoundById(targetId);
      if (!round) {
        return { verified: false, message: `Round "${targetId}" not found.` };
      }
      if (round.status !== 'CLOSED') {
        return {
          verified: false,
          message: `Expected round to be CLOSED, received "${round.status}".`,
        };
      }
      return { verified: true, message: `Round "${targetId}" closed. Creator refund now claimable.` };
    }

    case 'claim_creator_refund': {
      const round = await adapter.getRoundById(targetId);
      if (!round) {
        return { verified: false, message: `Round "${targetId}" not found.` };
      }
      if (round.status !== 'REFUND_EMITTED') {
        return {
          verified: false,
          message: `Expected state REFUND_EMITTED, received "${round.status}".`,
        };
      }
      return {
        verified: true,
        message: `Creator refund verified as REFUND_EMITTED (native transfer emitted by contract).`,
      };
    }

    default:
      return { verified: true, message: 'Action complete.' };
  }
}
