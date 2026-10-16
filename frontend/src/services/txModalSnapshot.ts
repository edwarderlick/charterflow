import { useState } from 'react';
import type { PersistedTx, PreparedTransaction } from './transactionService';
import { localForeignReceipt } from './txActionIdentity';

export const TX_MODAL_SNAPSHOT_KEY = 'cf_tx_modal_snapshot_v1';

export interface TxModalSnapshot {
  open: boolean;
  path: string;
  prepared: PreparedTransaction | null;
  currentTx: PersistedTx | null;
  livePhase: string;
  errorMsg: string | null;
  verificationResult: { verified: boolean; message: string; correlatedProposalId?: string } | null;
}

function revive(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && '__bigint' in value) {
    return BigInt(String((value as { __bigint: string }).__bigint));
  }
  return value;
}

export function readTxModalSnapshot(): TxModalSnapshot | null {
  try {
    const raw = sessionStorage.getItem(TX_MODAL_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw, revive) as TxModalSnapshot;
    if (!parsed || parsed.open !== true || !parsed.prepared) return null;
    return presentStoredSnapshot(parsed);
  } catch {
    return null;
  }
}

/** A stored mix of one action's quote and another action's hash stays visible and non-signable. */
export function presentStoredSnapshot(snapshot: TxModalSnapshot): TxModalSnapshot {
  const foreign = localForeignReceipt(snapshot.prepared, snapshot.currentTx);
  if (!foreign) return snapshot;
  return {
    ...snapshot,
    livePhase: 'identity-mismatch',
    errorMsg: foreign,
    verificationResult: { verified: false, message: foreign },
  };
}

/** A fresh quote may be signed. A completed, submitted, or uncertain attempt may not. */
export function modalAllowsSubmit(
  snapshot: Pick<TxModalSnapshot, 'currentTx' | 'livePhase' | 'errorMsg' | 'verificationResult'>
): boolean {
  if (snapshot.verificationResult && snapshot.verificationResult.verified === false) return false;
  const tx = snapshot.currentTx;
  if (tx?.txId || tx?.storageFailure) return false;
  if (
    tx &&
    (tx.status === 'intent-prepared' ||
      tx.status === 'broadcast-unknown' ||
      tx.status === 'submitted' ||
      tx.status === 'pending' ||
      tx.status === 'processing' ||
      tx.status === 'accepted' ||
      tx.status === 'finalized-success' ||
      tx.status === 'finalized-error' ||
      tx.status === 'unresolved' ||
      tx.status === 'timeout')
  ) {
    return false;
  }
  if (snapshot.livePhase && snapshot.livePhase !== 'standby') return false;
  if (snapshot.errorMsg && /broadcast|reconcil|submitted|uncertain|identity mismatch/i.test(snapshot.errorMsg)) return false;
  return true;
}

export function writeTxModalSnapshot(snapshot: TxModalSnapshot): void {
  try {
    const foreign = localForeignReceipt(snapshot.prepared, snapshot.currentTx);
    if (foreign) {
      // Never persist another action's hash as this quote's successful receipt.
      return;
    }
    const existing = readTxModalSnapshot();
    if (
      existing?.prepared &&
      snapshot.prepared &&
      existing.prepared.compositeTargetKey === snapshot.prepared.compositeTargetKey &&
      !modalAllowsSubmit(existing) &&
      modalAllowsSubmit(snapshot)
    ) {
      // A refresh or redirect must not turn a recorded attempt back into a signable quote.
      return;
    }
    sessionStorage.setItem(
      TX_MODAL_SNAPSHOT_KEY,
      JSON.stringify(snapshot, (_key, value) => (typeof value === 'bigint' ? { __bigint: value.toString() } : value))
    );
  } catch {
    // A private-mode storage failure must not discard the in-memory hash.
  }
}

export function resumeTxModalSnapshot(pathname: string): TxModalSnapshot | null {
  const snapshot = readTxModalSnapshot();
  if (!snapshot?.prepared) return null;
  if (snapshot.path !== pathname) return null;
  return snapshot;
}

export function seedModalSnapshot(
  prepared: PreparedTransaction | null,
  initialSnapshot: TxModalSnapshot | null,
  pathname: string
): TxModalSnapshot | null {
  if (!prepared) return null;
  const candidates = [readTxModalSnapshot(), initialSnapshot].filter(
    (item): item is TxModalSnapshot => Boolean(item?.prepared)
  );
  const sameTarget = candidates.filter(
    (item) => item.path === pathname && item.prepared?.compositeTargetKey === prepared.compositeTargetKey
  );
  return sameTarget.find((item) => !modalAllowsSubmit(item)) ?? sameTarget[0] ?? null;
}

export function clearTxModalSnapshot(): void {
  try {
    sessionStorage.removeItem(TX_MODAL_SNAPSHOT_KEY);
  } catch {
    // Ignore storage denial. The open modal still holds the hash in memory.
  }
}

export interface ModalResumeState {
  prepared: PreparedTransaction | null;
  show: boolean;
  initialSnapshot: TxModalSnapshot | null;
}

export interface ModalReceiptState {
  currentTx: PersistedTx | null;
  livePhase: string;
  errorMsg: string | null;
  verificationResult: TxModalSnapshot['verificationResult'];
  receiptClaim: null;
}

/** Resume on reload. A later close or new quote must not keep using this object. */
export function resumeModalState(pathname: string): ModalResumeState {
  const initialSnapshot = resumeTxModalSnapshot(pathname);
  return {
    prepared: initialSnapshot?.prepared ?? null,
    show: Boolean(initialSnapshot?.prepared),
    initialSnapshot,
  };
}

/**
 * Close drops the session snapshot and the in-memory resume.
 * cf_active_txs_rc2 is a different store and is left untouched.
 */
export function closeModalResume(state: ModalResumeState): ModalResumeState {
  clearTxModalSnapshot();
  return {
    prepared: state.prepared,
    show: false,
    initialSnapshot: null,
  };
}

/** A newly prepared quote does not inherit the previous resume snapshot. */
export function openFreshQuote(state: ModalResumeState, quote: PreparedTransaction | null): ModalResumeState {
  if (quote == null) {
    return { ...state, prepared: null };
  }
  return {
    prepared: quote,
    show: true,
    initialSnapshot: null,
  };
}

const EMPTY_RECEIPT: ModalReceiptState = {
  currentTx: null,
  livePhase: 'standby',
  errorMsg: null,
  verificationResult: null,
  receiptClaim: null,
};

/**
 * Changes when the quote or the resume snapshot changes.
 * Live receipt updates (hash, verification) stay off this token so a submit is not wiped.
 */
export function quoteResumeToken(
  isOpen: boolean,
  prepared: Pick<PreparedTransaction, 'compositeTargetKey' | 'quotedAt'> | null,
  initialSnapshot: TxModalSnapshot | null,
): string {
  if (!isOpen || !prepared) return 'closed';
  const resumeHash = initialSnapshot?.currentTx?.txId || '';
  const resumeVerified = initialSnapshot?.verificationResult?.verified === true ? 'verified' : 'unverified';
  const resumeMessage = initialSnapshot?.verificationResult?.message || '';
  return [prepared.compositeTargetKey, String(prepared.quotedAt ?? ''), resumeHash, resumeVerified, resumeMessage].join('|');
}

/** Closed modal and a quote with no stored resume both start from an empty receipt. */
export function receiptStateForQuote(
  isOpen: boolean,
  prepared: PreparedTransaction | null,
  initialSnapshot: TxModalSnapshot | null,
  pathname: string,
): ModalReceiptState {
  if (!isOpen || !prepared) return EMPTY_RECEIPT;
  const next = seedModalSnapshot(prepared, initialSnapshot, pathname);
  if (!next) return EMPTY_RECEIPT;
  return {
    currentTx: next.currentTx,
    livePhase: next.livePhase || 'standby',
    errorMsg: next.errorMsg,
    verificationResult: next.verificationResult,
    receiptClaim: null,
  };
}

export function useTxModalResume() {
  const [resume, setResume] = useState(() => resumeModalState(window.location.pathname));
  const setPreparedTx = (next: PreparedTransaction | null) => {
    setResume((prev) => openFreshQuote(prev, next));
  };
  const setShowTxModal = (show: boolean) => {
    setResume((prev) => ({ ...prev, show }));
  };
  const closeTxModal = () => {
    setResume((prev) => closeModalResume(prev));
  };
  return {
    preparedTx: resume.prepared,
    setPreparedTx,
    showTxModal: resume.show,
    setShowTxModal,
    closeTxModal,
    initialSnapshot: resume.initialSnapshot,
  };
}
