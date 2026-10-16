import { createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';
import { NETWORK_CONFIG } from '../config/network';
import type { PersistedTx, PreparedTransaction } from './transactionService';

const KNOWN_METHODS = [
  'create_round',
  'nominate_proposal',
  'evaluate_charter_fit',
  'cast_vote',
  'settle_expired_proposal',
  'withdraw_credit',
  'close_round_and_refund',
  'claim_creator_refund',
] as const;

export interface ObservedChainAction {
  readStatus: 'ok' | 'uncertain' | 'missing';
  detail?: string;
  sender?: string;
  contract?: string;
  method?: string;
  args?: string[];
  finalizedSuccess?: boolean;
  triggeredTxIds?: string[];
  proposalState?: string;
  creditWithdrawn?: boolean;
  requestedAmountWei?: string;
  payoutsEmittedWei?: string;
  childHash?: string;
  childRecipient?: string;
  childValueWei?: string;
  childReadStatus?: 'ok' | 'uncertain' | 'absent';
}

export type ReceiptClaim =
  | { claim: 'none' }
  | { claim: 'pending-identity'; hash: string; message: string }
  | { claim: 'uncertain'; hash: string; message: string }
  | { claim: 'identity-mismatch'; hash: string; message: string }
  | { claim: 'parent-matched'; hash: string; message: string }
  | { claim: 'delivered'; hash: string; childHash: string; message: string };

export interface ReceiptFlagInput {
  preparedAction?: string | null;
  currentTx?: Pick<PersistedTx, 'txId' | 'status'> | null;
  verificationVerified?: boolean | null;
  receipt?: ReceiptClaim | null;
  connectedAccount?: string | null;
  quotedAccount?: string | null;
}

export interface ReceiptFlags {
  workflowComplete: boolean;
  identityError: string | null;
  uncertainMessage: string | null;
  deliveryUnverified: string | null;
  pendingIdentity: boolean;
  accountBlocked: boolean;
}

type IdentityReader = (
  prepared: PreparedTransaction,
  hash: string
) => Promise<ObservedChainAction>;

let readerOverride: IdentityReader | null = null;

export function setTxIdentityReaderForTesting(reader: IdentityReader | null): void {
  readerOverride = reader;
}

export function sameAddress(left?: string | null, right?: string | null): boolean {
  if (!left || !right) return false;
  return left.toLowerCase() === right.toLowerCase();
}

export function messageFeeIsPositive(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  try {
    return BigInt(value as bigint | string | number) > 0n;
  } catch {
    return false;
  }
}

export function payoutFeeNotice(
  action: string,
  messageFees: unknown
): { tone: 'measured' | 'blocked'; text: string } | null {
  if (action !== 'withdraw_credit' && action !== 'claim_creator_refund') return null;
  if (messageFeeIsPositive(messageFees)) {
    return {
      tone: 'measured',
      text: `Native-message fee measured for this quote: ${BigInt(messageFees as bigint | string | number).toString()} wei. The wallet review uses that fresh estimate.`,
    };
  }
  return {
    tone: 'blocked',
    text: 'Native-message fees must be a fresh positive estimate before this payout can be signed. Zero or missing message fees block broadcast.',
  };
}

export function identityFromCallText(text: string): { method?: string; args: string[] } {
  if (!text) return { args: [] };
  const method = KNOWN_METHODS.find((name) => text.includes(name));
  const args = [...text.matchAll(/"((?:prp-|round-|rnd-)[^"]+|YES|NO|0x[0-9a-fA-F]{40})"/g)].map(
    (match) => match[1]
  );
  return { method, args };
}

export function identityFromBytes(bytes: Uint8Array): { method?: string; args: string[] } {
  const tokens: string[] = [];
  let current = '';
  for (const byte of bytes) {
    if (byte >= 32 && byte < 127) current += String.fromCharCode(byte);
    else if (current.length >= 2) {
      tokens.push(current);
      current = '';
    } else current = '';
  }
  if (current.length >= 2) tokens.push(current);
  const method = KNOWN_METHODS.find((name) => tokens.includes(name));
  const args = tokens.filter(
    (token) =>
      token !== method &&
      (token.startsWith('prp-') ||
        token.startsWith('round-') ||
        token.startsWith('rnd-') ||
        token === 'YES' ||
        token === 'NO' ||
        /^0x[0-9a-fA-F]{40}$/.test(token))
  );
  return { method, args };
}

function preparedArgs(prepared: PreparedTransaction): string[] {
  if (prepared.submitInput?.kind === 'write' && Array.isArray(prepared.submitInput.args)) {
    return prepared.submitInput.args.map((arg) => String(arg));
  }
  return [];
}

function argsMatch(expected: string[], observed: string[]): boolean {
  if (!expected.length) return observed.length === 0;
  if (observed.length < expected.length) return false;
  return expected.every((arg, index) => {
    const actual = observed[index];
    if (!actual) return false;
    if (arg.startsWith('0x') || actual.startsWith('0x')) return sameAddress(arg, actual);
    return arg === actual;
  });
}

export function localForeignReceipt(
  prepared: PreparedTransaction | null,
  tx: PersistedTx | null
): string | null {
  if (!prepared || !tx?.txId) return null;
  const problems: string[] = [];
  if (tx.action !== prepared.action) problems.push(`recorded action ${tx.action} is not ${prepared.action}`);
  if (tx.account && prepared.quotedAccount && !sameAddress(tx.account, prepared.quotedAccount)) {
    problems.push(`recorded signer ${tx.account} is not ${prepared.quotedAccount}`);
  }
  if (
    tx.contractAddress &&
    prepared.quotedContractAddress &&
    !sameAddress(tx.contractAddress, prepared.quotedContractAddress)
  ) {
    problems.push(`recorded contract ${tx.contractAddress} is not ${prepared.quotedContractAddress}`);
  }
  const expectedProposal = prepared.proposalId || '';
  if (expectedProposal && tx.proposalId && tx.proposalId !== expectedProposal) {
    problems.push(`recorded proposal ${tx.proposalId} is not ${expectedProposal}`);
  }
  if (
    tx.intendedArgumentsJson &&
    prepared.quotedArgsJson &&
    tx.intendedArgumentsJson !== prepared.quotedArgsJson
  ) {
    problems.push('recorded arguments do not match the prepared call');
  }
  if (!problems.length) return null;
  return `Identity mismatch: transaction ${tx.txId} cannot be shown as ${prepared.action}. ${problems.join('; ')}.`;
}

function expectedSigner(prepared: PreparedTransaction): string {
  return (prepared.withdrawRecipient || prepared.quotedAccount || '').toLowerCase();
}

export function assessReceiptClaim(
  prepared: PreparedTransaction,
  attached: Pick<PersistedTx, 'txId'> | null,
  observed: ObservedChainAction | null
): ReceiptClaim {
  const hash = attached?.txId;
  if (!hash) return { claim: 'none' };
  if (!observed) {
    return {
      claim: 'pending-identity',
      hash,
      message: `Resolving on-chain identity for ${hash}. This hash is not yet a receipt for ${prepared.action}.`,
    };
  }
  if (observed.readStatus === 'uncertain') {
    return {
      claim: 'uncertain',
      hash,
      message: `On-chain identity for ${hash} is uncertain. ${observed.detail || 'Read-only reconciliation is required.'} Another submit is blocked.`,
    };
  }
  if (observed.readStatus === 'missing') {
    return {
      claim: 'uncertain',
      hash,
      message: `Transaction ${hash} was not found on-chain. Another submit is blocked until it can be reconciled.`,
    };
  }

  const problems: string[] = [];
  if (observed.method !== prepared.action) {
    problems.push(`on-chain method ${observed.method || 'unknown'} is not ${prepared.action}`);
  }
  const signer = expectedSigner(prepared);
  if (!sameAddress(observed.sender, signer)) {
    problems.push(`on-chain signer ${observed.sender || 'unknown'} is not ${signer}`);
  }
  if (!sameAddress(observed.contract, prepared.quotedContractAddress)) {
    problems.push(`on-chain contract ${observed.contract || 'unknown'} is not ${prepared.quotedContractAddress}`);
  }
  const expectedArgs = preparedArgs(prepared);
  const observedArgs = observed.args || [];
  if (!argsMatch(expectedArgs, observedArgs)) {
    problems.push(
      `on-chain arguments ${JSON.stringify(observedArgs)} do not match ${JSON.stringify(expectedArgs)}`
    );
  }
  if (prepared.proposalId && !observedArgs.includes(prepared.proposalId) && expectedArgs.includes(prepared.proposalId)) {
    problems.push(`on-chain call does not include proposal ${prepared.proposalId}`);
  }
  if (!observed.finalizedSuccess) {
    problems.push('the transaction is not a finalized successful parent');
  }
  if (problems.length) {
    return {
      claim: 'identity-mismatch',
      hash,
      message: `Identity mismatch: ${hash} is not this ${prepared.action}. ${problems.join('; ')}. Another submit is blocked pending reconciliation.`,
    };
  }

  if (prepared.action !== 'withdraw_credit') {
    return {
      claim: 'delivered',
      hash,
      childHash: hash,
      message: `${hash} matches ${prepared.action} for ${signer} on ${prepared.quotedContractAddress}.`,
    };
  }

  const deliveryProblems: string[] = [];
  if (observed.proposalState !== 'PAYOUT_EMITTED') {
    deliveryProblems.push(`proposal state is ${observed.proposalState || 'unknown'}, not PAYOUT_EMITTED`);
  }
  if (observed.creditWithdrawn !== true) {
    deliveryProblems.push('credit_withdrawn is not true');
  }
  if (observed.childReadStatus === 'uncertain') {
    deliveryProblems.push(observed.detail || 'the emitted transfer could not be read');
  } else if (!observed.childHash || observed.childReadStatus === 'absent') {
    deliveryProblems.push('no emitted transfer or child transaction was found');
  } else {
    if (!sameAddress(observed.childRecipient, signer)) {
      deliveryProblems.push(`child recipient ${observed.childRecipient || 'unknown'} is not ${signer}`);
    }
    if (
      !observed.requestedAmountWei ||
      !observed.childValueWei ||
      observed.childValueWei !== observed.requestedAmountWei
    ) {
      deliveryProblems.push(
        `child value ${observed.childValueWei || 'missing'} does not match credit ${observed.requestedAmountWei || 'missing'}`
      );
    }
  }
  if (deliveryProblems.length) {
    return {
      claim: 'parent-matched',
      hash,
      message: `Withdrawal parent ${hash} matches the recipient call, but delivery is not proven. ${deliveryProblems.join('; ')}. Parent finalization is not recipient delivery. Another submit is blocked pending reconciliation.`,
    };
  }
  return {
    claim: 'delivered',
    hash,
    childHash: observed.childHash || hash,
    message: `Withdrawal ${hash} matches withdraw_credit. Child ${observed.childHash} paid ${observed.childValueWei} wei to ${observed.childRecipient}. Proposal is PAYOUT_EMITTED and credit_withdrawn is true.`,
  };
}

export function modalReceiptFlags(input: ReceiptFlagInput): ReceiptFlags {
  const receipt = input.receipt ?? null;
  const accountBlocked = Boolean(
    input.connectedAccount &&
      input.quotedAccount &&
      !sameAddress(input.connectedAccount, input.quotedAccount)
  );
  const pendingIdentity = Boolean(input.currentTx?.txId) && (!receipt || receipt.claim === 'pending-identity');
  const identityError = receipt?.claim === 'identity-mismatch' ? receipt.message : null;
  const uncertainMessage = receipt?.claim === 'uncertain' ? receipt.message : null;
  const deliveryUnverified = receipt?.claim === 'parent-matched' ? receipt.message : null;
  const workflowComplete =
    !accountBlocked &&
    !pendingIdentity &&
    receipt?.claim === 'delivered' &&
    input.verificationVerified === true;
  return {
    workflowComplete,
    identityError,
    uncertainMessage,
    deliveryUnverified,
    pendingIdentity,
    accountBlocked,
  };
}

function senderOf(tx: Record<string, unknown>): string | undefined {
  const fee = tx.fee_accounting as { sender?: string } | undefined;
  const data = tx.data as { from_address?: string } | undefined;
  const value =
    tx.from_address || tx.fromAddress || tx.from || tx.sender || fee?.sender || data?.from_address;
  return typeof value === 'string' ? value : undefined;
}

function contractOf(tx: Record<string, unknown>): string | undefined {
  const data = tx.data as { to_address?: string } | undefined;
  const value = tx.to_address || tx.recipient || tx.to || tx.contractAddress || data?.to_address;
  return typeof value === 'string' ? value : undefined;
}

function callTextOf(tx: Record<string, unknown>): string {
  const data = tx.data as { calldata?: unknown } | undefined;
  const calldata = data?.calldata ?? tx.txCalldata ?? tx.data;
  if (typeof calldata === 'string') return calldata;
  if (calldata && typeof calldata === 'object' && 'readable' in calldata) {
    const readable = (calldata as { readable?: unknown }).readable;
    if (typeof readable === 'string') return readable;
  }
  return '';
}

function valueOf(tx: Record<string, unknown>): string | undefined {
  const candidates = [tx.value, tx.value_credited, tx.user_value, (tx.data as { user_value?: unknown } | undefined)?.user_value];
  for (const candidate of candidates) {
    if (typeof candidate === 'bigint') return candidate.toString();
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return BigInt(candidate).toString();
    if (typeof candidate === 'string' && candidate) {
      try {
        return (candidate.startsWith('0x') ? BigInt(candidate) : BigInt(candidate)).toString();
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

function studioClient() {
  const chain = {
    ...studioDevnet,
    rpcUrls: {
      ...studioDevnet.rpcUrls,
      default: { http: [NETWORK_CONFIG.rpcUrl] },
    },
  };
  return createClient({ chain, endpoint: NETWORK_CONFIG.rpcUrl });
}

async function readChildTransfer(
  client: ReturnType<typeof studioClient>,
  ids: string[],
  recipient: string,
  amountWei: string | undefined
): Promise<Pick<ObservedChainAction, 'childHash' | 'childRecipient' | 'childValueWei' | 'childReadStatus' | 'detail'>> {
  if (!ids.length) return { childReadStatus: 'absent', detail: 'triggered_transactions is empty' };
  let uncertain = false;
  for (const id of ids) {
    try {
      const child = (await client.getTransaction({ hash: id as `0x${string}` & { length: 66 } })) as Record<string, unknown>;
      const childRecipient = contractOf(child);
      const childValue = valueOf(child);
      if (sameAddress(childRecipient, recipient) && amountWei && childValue === amountWei) {
        return {
          childHash: id,
          childRecipient,
          childValueWei: childValue,
          childReadStatus: 'ok',
        };
      }
    } catch (err: unknown) {
      uncertain = true;
      void err;
    }
  }
  if (uncertain) {
    return { childReadStatus: 'uncertain', detail: 'A child transaction id was present but could not be read.' };
  }
  return { childReadStatus: 'absent', detail: 'Child transactions did not show the recipient credit transfer.' };
}

export async function readChainAction(
  prepared: PreparedTransaction,
  hash: string
): Promise<ObservedChainAction> {
  try {
    const client = studioClient();
    const tx = (await client.getTransaction({ hash: hash as `0x${string}` & { length: 66 } })) as Record<string, unknown> | null;
    if (!tx) return { readStatus: 'missing', detail: 'getTransaction returned empty' };
    const identity = identityFromCallText(callTextOf(tx));
    const statusName = String(tx.statusName || '');
    const execution = String(tx.txExecutionResultName || '');
    const triggered = Array.isArray(tx.triggered_transactions)
      ? tx.triggered_transactions.map((item) => String(item))
      : [];
    const observed: ObservedChainAction = {
      readStatus: 'ok',
      sender: senderOf(tx),
      contract: contractOf(tx),
      method: identity.method,
      args: identity.args,
      finalizedSuccess: statusName === 'FINALIZED' && execution === 'FINISHED_WITH_RETURN',
      triggeredTxIds: triggered,
    };
    if (prepared.action !== 'withdraw_credit' || identity.method !== 'withdraw_credit') return observed;
    try {
      const proposal = (await client.readContract({
        address: prepared.quotedContractAddress as `0x${string}`,
        functionName: 'get_proposal',
        args: [prepared.proposalId || ''],
        jsonSafeReturn: true,
        transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
      })) as Record<string, unknown>;
      observed.proposalState = typeof proposal?.state === 'string' ? proposal.state : undefined;
      observed.creditWithdrawn = proposal?.credit_withdrawn === true;
      observed.requestedAmountWei =
        proposal?.requested_amount_wei !== undefined ? String(proposal.requested_amount_wei) : undefined;
      const roundId = typeof proposal?.round_id === 'string' ? proposal.round_id : prepared.roundId;
      if (roundId) {
        const round = (await client.readContract({
          address: prepared.quotedContractAddress as `0x${string}`,
          functionName: 'get_round',
          args: [roundId],
          jsonSafeReturn: true,
          transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
        })) as Record<string, unknown>;
        observed.payoutsEmittedWei =
          round?.payouts_emitted_wei !== undefined ? String(round.payouts_emitted_wei) : undefined;
      }
    } catch (err: unknown) {
      return {
        ...observed,
        readStatus: 'uncertain',
        detail: `Withdrawal identity was read, but proposal readback failed: ${String((err as { message?: string })?.message || err)}`,
      };
    }
    const child = await readChildTransfer(
      client,
      triggered,
      expectedSigner(prepared),
      observed.requestedAmountWei
    );
    return { ...observed, ...child };
  } catch (err: unknown) {
    return {
      readStatus: 'uncertain',
      detail: String((err as { message?: string })?.message || err || 'Transaction identity read failed'),
    };
  }
}

export async function resolveReceiptIdentity(
  prepared: PreparedTransaction,
  attached: PersistedTx | null
): Promise<ReceiptClaim> {
  if (!attached?.txId) return { claim: 'none' };
  const local = localForeignReceipt(prepared, attached);
  try {
    const observed = readerOverride
      ? await readerOverride(prepared, attached.txId)
      : await readChainAction(prepared, attached.txId);
    const claim = assessReceiptClaim(prepared, attached, observed);
    if (local && (claim.claim === 'uncertain' || claim.claim === 'pending-identity')) {
      return {
        claim: 'identity-mismatch',
        hash: attached.txId,
        message: `${local} On-chain confirmation is uncertain. Another submit is blocked pending reconciliation.`,
      };
    }
    return claim;
  } catch (err: unknown) {
    if (local) {
      return {
        claim: 'identity-mismatch',
        hash: attached.txId,
        message: `${local} On-chain confirmation failed: ${String((err as { message?: string })?.message || err)}.`,
      };
    }
    return {
      claim: 'uncertain',
      hash: attached.txId,
      message: `On-chain identity for ${attached.txId} is uncertain. Another submit is blocked pending reconciliation.`,
    };
  }
}
