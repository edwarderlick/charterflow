import type { PolicyQuote } from '@genlayer/transaction-kit';
import type { Eip1193Provider } from './eip1193';
import { GENLAYER_STUDIO_NEXT } from '../context/WalletContext';
import { NEXT_RUNNER_COMPAT_SOURCE, VERIFIED_DEPLOYMENT } from '../config/network';
import { getTransactionKitInstance } from './transactionService';

function intentTestsBypassVerifiedDeployGate(): boolean {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.CF_ALLOW_DEPLOY_INTENT_TESTS === '1';
}

export function verifiedDeployWriteBlock(): string | null {
  if (intentTestsBypassVerifiedDeployGate()) return null;
  if (
    NEXT_RUNNER_COMPAT_SOURCE.deployedContractAddress &&
    NEXT_RUNNER_COMPAT_SOURCE.sourceSha256 === VERIFIED_DEPLOYMENT.sourceSha256
  ) {
    return `WRITE BLOCKED: source ${VERIFIED_DEPLOYMENT.sourceSha256} is already deployed at ${VERIFIED_DEPLOYMENT.contractAddress} by ${VERIFIED_DEPLOYMENT.deployTransaction}. Do not send another deploy.`;
  }
  return null;
}

/** Next-deploy gate. This is not the bytecode running at 0x9579. */
export const CORRECTED_SOURCE_SHA256 = NEXT_RUNNER_COMPAT_SOURCE.sourceSha256;
export const DEPLOY_SOURCE_PATH = '/CharterFlowCore.py';
/** Historical one-shot record for the 0x9579 deploy. Do not clear it. */
export const HISTORICAL_DEPLOY_RESULT_KEY = 'cf_corrected_deploy_v1';
/** One-shot record for the runner-compat candidate. A second submit of this hash is refused. */
export const DEPLOY_RESULT_KEY = 'cf_runner_compat_deploy_v1';
/**
 * Durable BROADCASTING / OUTCOME_UNCERTAIN / SUBMITTED intent for this candidate.
 * A reload or a second tab must read this key. It is not the historical 0x9579 record.
 */
export const DEPLOY_INTENT_KEY = 'cf_runner_compat_deploy_intent_v1';
export const DEPLOY_CALLBACK_URL = 'http://127.0.0.1:8787/deploy-result';

const QUOTE_MAX_AGE_MS = 120000;

export interface CorrectedDeployQuote {
  quote: PolicyQuote;
  code: string;
  sourceSha256: string;
  account: string;
  chainId: number;
  feeValueWei: bigint;
  userValueWei: bigint;
  quotedAt: number;
}

export interface CorrectedDeployResult {
  genlayerTxId: `0x${string}`;
  evmTxHash?: `0x${string}`;
  sourceSha256: string;
  account: string;
  submittedAt: string;
}

export type DeployIntentStatus = 'BROADCASTING' | 'OUTCOME_UNCERTAIN' | 'SUBMITTED';

export interface DeployBroadcastIntent {
  status: DeployIntentStatus;
  sourceSha256: string;
  account: string;
  chainId: number;
  intentId: string;
  startedAt: string;
  phase: 'before-provider' | 'submitted' | 'uncertain';
  genlayerTxId?: `0x${string}`;
  evmTxHash?: `0x${string}`;
  error?: string;
  uncertainAt?: string;
  recordedAt?: string;
}

export interface DeployIntentState {
  status: 'empty' | 'valid' | 'corrupt';
  intent: DeployBroadcastIntent | null;
  error?: string;
}

export interface DeployReconciliationLookup {
  /** Set only when a read-only check proves the wallet never broadcast. */
  demonstrableAbsence?: boolean;
  genlayerTxId?: `0x${string}`;
  evmTxHash?: `0x${string}`;
  statusName?: string;
  executionResultName?: string;
}

/** Same-page lock. A second tab cannot see this; it must read DEPLOY_INTENT_KEY. */
let inMemoryDeployLock: DeployBroadcastIntent | null = null;

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  const digest = await crypto.subtle.digest('SHA-256', copy);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function loadCorrectedContractSource(): Promise<{ code: string; sha256: string; bytes: Uint8Array }> {
  const res = await fetch(DEPLOY_SOURCE_PATH, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to load ${DEPLOY_SOURCE_PATH}: HTTP ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const sha256 = await sha256Hex(buf);
  if (sha256 !== CORRECTED_SOURCE_SHA256) {
    throw new Error(
      `Served CharterFlowCore.py SHA-256 ${sha256} does not match corrected ${CORRECTED_SOURCE_SHA256}`
    );
  }
  return { code: new TextDecoder('utf-8').decode(buf), sha256, bytes: buf };
}

function readDeployResult(key: string): CorrectedDeployResult | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CorrectedDeployResult;
    if (!parsed?.genlayerTxId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readStoredDeployResult(): CorrectedDeployResult | null {
  return readDeployResult(DEPLOY_RESULT_KEY);
}

export function readHistoricalDeployResult(): CorrectedDeployResult | null {
  return readDeployResult(HISTORICAL_DEPLOY_RESULT_KEY);
}

function isIntentShape(value: unknown): value is DeployBroadcastIntent {
  if (!value || typeof value !== 'object') return false;
  const intent = value as DeployBroadcastIntent;
  return (
    (intent.status === 'BROADCASTING' || intent.status === 'OUTCOME_UNCERTAIN' || intent.status === 'SUBMITTED') &&
    typeof intent.sourceSha256 === 'string' &&
    typeof intent.account === 'string' &&
    typeof intent.chainId === 'number' &&
    typeof intent.intentId === 'string' &&
    intent.intentId.length > 0
  );
}

export function readDeployIntentState(): DeployIntentState {
  let raw: string | null;
  try {
    raw = localStorage.getItem(DEPLOY_INTENT_KEY);
  } catch (err: any) {
    return {
      status: 'corrupt',
      intent: null,
      error: `Deploy intent storage is unreadable: ${err?.message || 'Access error'}`,
    };
  }
  if (raw === null || raw.trim() === '') {
    return { status: 'empty', intent: null };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isIntentShape(parsed)) {
      return {
        status: 'corrupt',
        intent: null,
        error: 'Deploy intent storage has an invalid shape and was left unchanged.',
      };
    }
    return { status: 'valid', intent: parsed };
  } catch (err: any) {
    return {
      status: 'corrupt',
      intent: null,
      error: `Deploy intent storage is corrupt JSON and was left unchanged: ${err?.message || 'Parse error'}`,
    };
  }
}

export function readDeployIntent(): DeployBroadcastIntent | null {
  const state = readDeployIntentState();
  return state.status === 'valid' ? state.intent : null;
}

export function clearDeployMemoryLockForTests(): void {
  inMemoryDeployLock = null;
}

function intentBlocksResubmit(intent: DeployBroadcastIntent | null): boolean {
  return Boolean(intent);
}

function blockMessage(intent: DeployBroadcastIntent): string {
  const hash = intent.genlayerTxId ? ` Transaction ${intent.genlayerTxId}.` : '';
  return `Resubmission blocked: runner-compat deploy intent ${intent.intentId} is ${intent.status} for ${intent.sourceSha256} on account ${intent.account} chain ${intent.chainId}.${hash} Reconcile the existing attempt read-only. Do not send another deploy.`;
}

export function deployResubmitBlockReason(): string | null {
  const verified = verifiedDeployWriteBlock();
  if (verified) return verified;
  if (inMemoryDeployLock && intentBlocksResubmit(inMemoryDeployLock)) {
    return blockMessage(inMemoryDeployLock);
  }
  const state = readDeployIntentState();
  if (state.status === 'corrupt') {
    return state.error || 'Resubmission blocked: deploy intent storage is corrupt and was not erased.';
  }
  if (state.intent) {
    return blockMessage(state.intent);
  }
  const existing = readStoredDeployResult();
  if (existing) {
    return `This source was already submitted: ${existing.genlayerTxId}. Do not send a second deploy.`;
  }
  return null;
}

function writeIntent(intent: DeployBroadcastIntent): void {
  inMemoryDeployLock = intent;
  localStorage.setItem(DEPLOY_INTENT_KEY, JSON.stringify(intent));
}

function isDemonstrableWalletRejection(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (code === 4001 || code === 'ACTION_REJECTED') return true;
  const message = String((err as { message?: string })?.message || '').toLowerCase();
  return (
    message.includes('user rejected') ||
    message.includes('user denied') ||
    message.includes('user cancelled') ||
    message.includes('user canceled')
  );
}

/**
 * A reload cannot tell whether the wallet prompt already submitted.
 * Upgrade a hash-less BROADCASTING intent to OUTCOME_UNCERTAIN and keep it.
 * Never removes the historical deploy record.
 */
export function respectDeployIntentAfterReload(): DeployBroadcastIntent | null {
  const state = readDeployIntentState();
  if (state.status === 'corrupt') {
    if (inMemoryDeployLock) return inMemoryDeployLock;
    return null;
  }
  const stored = state.intent;
  if (!stored) {
    return inMemoryDeployLock;
  }
  if (stored.status === 'BROADCASTING' && !stored.genlayerTxId) {
    const uncertain: DeployBroadcastIntent = {
      ...stored,
      status: 'OUTCOME_UNCERTAIN',
      phase: 'uncertain',
      uncertainAt: new Date().toISOString(),
      error:
        stored.error ||
        'A reload or second tab observed a BROADCASTING intent before a transaction hash was recorded. The wallet may already have submitted. Resubmission is blocked until read-only reconciliation.',
    };
    try {
      writeIntent(uncertain);
    } catch {
      inMemoryDeployLock = uncertain;
    }
    return inMemoryDeployLock;
  }
  inMemoryDeployLock = stored;
  return stored;
}

function clearDemonstrablePreBroadcast(intentId: string): void {
  const state = readDeployIntentState();
  if (state.status === 'corrupt') {
    return;
  }
  const stored = state.intent;
  if (stored && stored.intentId !== intentId) {
    inMemoryDeployLock = stored;
    return;
  }
  if (stored?.genlayerTxId || stored?.status === 'SUBMITTED') {
    inMemoryDeployLock = stored;
    return;
  }
  if (stored && (stored.status === 'OUTCOME_UNCERTAIN' || stored.status === 'BROADCASTING')) {
    try {
      localStorage.removeItem(DEPLOY_INTENT_KEY);
    } catch (err: any) {
      inMemoryDeployLock = {
        ...stored,
        status: 'OUTCOME_UNCERTAIN',
        phase: 'uncertain',
        error: `Pre-broadcast rejection could not be cleared from storage: ${err?.message || 'Storage error'}. Resubmission remains blocked.`,
      };
      return;
    }
  }
  if (inMemoryDeployLock?.intentId === intentId && !inMemoryDeployLock.genlayerTxId) {
    inMemoryDeployLock = null;
  }
}

function markOutcomeUncertain(intent: DeployBroadcastIntent, error: string, genlayerTxId?: `0x${string}`): void {
  const retainedHash = genlayerTxId || intent.genlayerTxId || inMemoryDeployLock?.genlayerTxId;
  const next: DeployBroadcastIntent = {
    ...intent,
    status: 'OUTCOME_UNCERTAIN',
    phase: 'uncertain',
    uncertainAt: new Date().toISOString(),
    error,
    genlayerTxId: retainedHash,
    evmTxHash: intent.evmTxHash || inMemoryDeployLock?.evmTxHash,
  };
  inMemoryDeployLock = next;
  try {
    localStorage.setItem(DEPLOY_INTENT_KEY, JSON.stringify(next));
  } catch {
    // The in-memory lock still blocks this page. Storage keeps the previous intent if the write failed.
  }
}

/**
 * Resolves a blocked intent from a read-only lookup. Does not broadcast.
 * Absence is not enough to clear the intent. A hash is recorded and still blocks another deploy.
 */
export function reconcileDeployIntentReadOnly(lookup: DeployReconciliationLookup): {
  intent: DeployBroadcastIntent | null;
  result: CorrectedDeployResult | null;
  resubmitBlocked: boolean;
} {
  const state = readDeployIntentState();
  const base = state.intent || inMemoryDeployLock;
  if (state.status === 'corrupt') {
    return {
      intent: inMemoryDeployLock,
      result: readStoredDeployResult(),
      resubmitBlocked: true,
    };
  }
  if (!base) {
    const result = readStoredDeployResult();
    return { intent: null, result, resubmitBlocked: Boolean(result) };
  }
  if (lookup.genlayerTxId && lookup.genlayerTxId.startsWith('0x')) {
    const finalized =
      lookup.statusName === 'FINALIZED' && lookup.executionResultName === 'FINISHED_WITH_RETURN';
    const next: DeployBroadcastIntent = {
      ...base,
      status: finalized ? 'SUBMITTED' : 'OUTCOME_UNCERTAIN',
      phase: finalized ? 'submitted' : 'uncertain',
      genlayerTxId: lookup.genlayerTxId,
      evmTxHash: lookup.evmTxHash || base.evmTxHash,
      recordedAt: new Date().toISOString(),
      error: finalized ? undefined : base.error || 'Read-only reconciliation found a transaction that is not a successful final deployment.',
    };
    writeIntent(next);
    if (finalized) {
      const result: CorrectedDeployResult = {
        genlayerTxId: lookup.genlayerTxId,
        evmTxHash: next.evmTxHash,
        sourceSha256: base.sourceSha256,
        account: base.account,
        submittedAt: base.startedAt,
      };
      localStorage.setItem(DEPLOY_RESULT_KEY, JSON.stringify(result));
      return { intent: next, result, resubmitBlocked: true };
    }
    return { intent: next, result: readStoredDeployResult(), resubmitBlocked: true };
  }
  if (lookup.demonstrableAbsence === true && !base.genlayerTxId && base.status !== 'SUBMITTED') {
    try {
      localStorage.removeItem(DEPLOY_INTENT_KEY);
    } catch {
      markOutcomeUncertain(base, 'Read-only absence could not be written. Resubmission remains blocked.');
      return { intent: inMemoryDeployLock, result: readStoredDeployResult(), resubmitBlocked: true };
    }
    if (inMemoryDeployLock?.intentId === base.intentId) {
      inMemoryDeployLock = null;
    }
    const result = readStoredDeployResult();
    return { intent: null, result, resubmitBlocked: Boolean(result) };
  }
  markOutcomeUncertain(
    base,
    base.error || 'Read-only reconciliation did not prove a pre-broadcast rejection. Resubmission remains blocked.'
  );
  return { intent: inMemoryDeployLock, result: readStoredDeployResult(), resubmitBlocked: true };
}

export async function prepareCorrectedDeploy(params: {
  provider: Eip1193Provider;
  account: string;
}): Promise<CorrectedDeployQuote> {
  const chainHex = await params.provider.request({ method: 'eth_chainId' });
  const chainId = typeof chainHex === 'string' ? parseInt(chainHex, 16) : Number(chainHex);
  if (chainId !== GENLAYER_STUDIO_NEXT.chainId) {
    throw new Error(`Wallet is on chain ${chainId}. Switch to GenLayer Studio Next (61997) with an explicit click.`);
  }
  const accounts = await params.provider.request({ method: 'eth_accounts' });
  const active = Array.isArray(accounts) && accounts[0] ? String(accounts[0]).toLowerCase() : '';
  if (!active || active !== params.account.toLowerCase()) {
    throw new Error('Active wallet account does not match the connected session.');
  }

  const { code, sha256 } = await loadCorrectedContractSource();
  const kit = getTransactionKitInstance(params.provider, params.account as `0x${string}`);
  const quote = await kit.estimate({ userValue: 0n }, { kind: 'deploy', code, args: [] });
  if (quote.userValue !== 0n) {
    throw new Error('Deploy quote must have userValue 0. No round deposit is sent with this deployment.');
  }
  return {
    quote,
    code,
    sourceSha256: sha256,
    account: params.account.toLowerCase(),
    chainId,
    feeValueWei: quote.feeValue,
    userValueWei: quote.userValue,
    quotedAt: Date.now(),
  };
}

export async function submitCorrectedDeploy(params: {
  provider: Eip1193Provider;
  account: string;
  prepared: CorrectedDeployQuote;
}): Promise<CorrectedDeployResult> {
  const preparedHash: string = params.prepared.sourceSha256;
  const verifiedBlock = verifiedDeployWriteBlock();
  if (verifiedBlock) {
    throw new Error(verifiedBlock);
  }
  if (preparedHash !== CORRECTED_SOURCE_SHA256) {
    throw new Error('Prepared source hash does not match the runner-compat candidate.');
  }
  if (params.prepared.chainId !== GENLAYER_STUDIO_NEXT.chainId) {
    throw new Error('Prepared deploy quote is not bound to GenLayer Studio Next (61997).');
  }
  if (params.prepared.account.toLowerCase() !== params.account.toLowerCase()) {
    throw new Error('Prepared deploy quote is bound to a different account.');
  }
  const existing = readStoredDeployResult();
  if (existing) {
    throw new Error(`This source was already submitted: ${existing.genlayerTxId}. Do not send a second deploy.`);
  }
  const historical = readHistoricalDeployResult();
  if (historical && historical.sourceSha256 === params.prepared.sourceSha256) {
    throw new Error(`Historical deploy ${historical.genlayerTxId} already used this source.`);
  }
  if (Date.now() - params.prepared.quotedAt > QUOTE_MAX_AGE_MS) {
    throw new Error('Deploy quote is stale. Request a fresh fee quote.');
  }
  const alreadyBlocked = deployResubmitBlockReason();
  if (alreadyBlocked) {
    throw new Error(alreadyBlocked);
  }

  const intent: DeployBroadcastIntent = {
    status: 'BROADCASTING',
    sourceSha256: preparedHash,
    account: params.prepared.account.toLowerCase(),
    chainId: params.prepared.chainId,
    intentId: `deploy_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    startedAt: new Date().toISOString(),
    phase: 'before-provider',
  };

  // Synchronous reservation. The next line that can yield is the provider read below.
  inMemoryDeployLock = intent;
  try {
    localStorage.setItem(DEPLOY_INTENT_KEY, JSON.stringify(intent));
  } catch (err: any) {
    inMemoryDeployLock = {
      ...intent,
      status: 'OUTCOME_UNCERTAIN',
      phase: 'uncertain',
      error: `Deploy intent could not be persisted before broadcast: ${err?.message || 'Storage error'}. No second submit is allowed in this page.`,
    };
    throw new Error(inMemoryDeployLock.error);
  }
  const confirmed = readDeployIntent();
  if (!confirmed || confirmed.intentId !== intent.intentId) {
    if (confirmed) inMemoryDeployLock = confirmed;
    throw new Error('Another tab persisted a runner-compat deploy intent first. Resubmission blocked.');
  }

  let broadcastAttemptStarted = false;
  try {
    const chainHex = await params.provider.request({ method: 'eth_chainId' });
    const chainId = typeof chainHex === 'string' ? parseInt(chainHex, 16) : Number(chainHex);
    if (chainId !== params.prepared.chainId) {
      throw new Error('Chain changed after quote. Request a fresh fee quote.');
    }
    const accounts = await params.provider.request({ method: 'eth_accounts' });
    const active = Array.isArray(accounts) && accounts[0] ? String(accounts[0]).toLowerCase() : '';
    if (!active || active !== params.prepared.account.toLowerCase()) {
      throw new Error('Active wallet account changed after the deploy quote. Request a fresh fee quote.');
    }

    const kit = getTransactionKitInstance(params.provider, params.account as `0x${string}`);
    broadcastAttemptStarted = true;
    const submitted = await kit.submit(params.prepared.quote, {
      kind: 'deploy',
      code: params.prepared.code,
      args: [],
    });
    const genlayerTxId = submitted?.genlayerTxId;
    if (!genlayerTxId || !genlayerTxId.startsWith('0x')) {
      markOutcomeUncertain(intent, 'Submit returned without a transaction hash. The wallet may have submitted. Resubmission is blocked.');
      throw new Error('Deploy outcome uncertain: the wallet returned no transaction hash. Do not send another deploy.');
    }

    const recorded: DeployBroadcastIntent = {
      ...intent,
      status: 'SUBMITTED',
      phase: 'submitted',
      genlayerTxId,
      evmTxHash: submitted.evmTxHash,
      recordedAt: new Date().toISOString(),
    };
    inMemoryDeployLock = recorded;
    try {
      localStorage.setItem(DEPLOY_INTENT_KEY, JSON.stringify(recorded));
    } catch (err: any) {
      markOutcomeUncertain(
        recorded,
        `Returned hash ${genlayerTxId} could not be written to the deploy intent: ${err?.message || 'Storage error'}.`
      );
      throw new Error(`Deploy outcome uncertain after hash ${genlayerTxId}. Resubmission is blocked.`);
    }

    const result: CorrectedDeployResult = {
      genlayerTxId,
      evmTxHash: submitted.evmTxHash,
      sourceSha256: params.prepared.sourceSha256,
      account: params.prepared.account,
      submittedAt: recorded.recordedAt || new Date().toISOString(),
    };
    try {
      localStorage.setItem(DEPLOY_RESULT_KEY, JSON.stringify(result));
    } catch (err: any) {
      markOutcomeUncertain(recorded, `Hash ${genlayerTxId} is on the intent, but the deploy result record failed: ${err?.message || 'Storage error'}.`);
      throw new Error(`Deploy outcome uncertain after hash ${genlayerTxId}. Resubmission is blocked.`);
    }
    try {
      await fetch(DEPLOY_CALLBACK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(result),
      });
    } catch {
      // Local callback is optional. The hash is already stored.
    }
    return result;
  } catch (err) {
    if (!broadcastAttemptStarted || isDemonstrableWalletRejection(err)) {
      const current = readDeployIntent();
      if (current?.genlayerTxId) {
        markOutcomeUncertain(current, `Exception after a transaction hash was recorded: ${(err as { message?: string })?.message || 'error'}`);
      } else if (!isDemonstrableWalletRejection(err) && broadcastAttemptStarted) {
        markOutcomeUncertain(intent, String((err as { message?: string })?.message || err));
      } else {
        clearDemonstrablePreBroadcast(intent.intentId);
      }
    } else {
      const current = readDeployIntent() || inMemoryDeployLock || intent;
      const retainedHash = current.genlayerTxId || inMemoryDeployLock?.genlayerTxId;
      markOutcomeUncertain(
        {
          ...intent,
          ...current,
          genlayerTxId: retainedHash,
          evmTxHash: current.evmTxHash || inMemoryDeployLock?.evmTxHash,
        },
        `Exception after the wallet may have submitted: ${(err as { message?: string })?.message || 'Submit error'}.`
      );
    }
    const message = (err as { message?: string })?.message || 'Deploy submit failed';
    if (broadcastAttemptStarted && !isDemonstrableWalletRejection(err) && !message.includes('Resubmission blocked')) {
      throw new Error(`OUTCOME_UNCERTAIN: ${message} Resubmission blocked until read-only reconciliation resolves this attempt.`);
    }
    throw err;
  }
}
