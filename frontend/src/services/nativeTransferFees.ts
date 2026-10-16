import { createClient } from 'genlayer-js';
import type { FeesDistribution, MessageFeeAllocationInput } from 'genlayer-js/types';
import type { Eip1193Provider } from '@genlayer/transaction-kit';

const STANDARD_APPEAL_ROUNDS = 3n;

export interface WithdrawFeeSimulation {
  distribution: FeesDistribution;
  messageAllocations: MessageFeeAllocationInput[];
  feeValue: bigint;
}

export interface WithdrawFeeSimulationRequest {
  chain: unknown;
  provider: Eip1193Provider;
  account: `0x${string}`;
  address: `0x${string}`;
  proposalId: string;
  value: bigint;
}

export interface SealedNativeTransfer {
  account: string;
  proposalId: string;
  contractAddress: string;
  argsJson: string;
  allocations: MessageFeeAllocationInput[];
  sealedAllocationsJson: string;
  simulatedFeeValueWei: string;
  simulatedTotalMessageFeesWei: string;
  requiredBudgetWei: string;
}

export interface NativeTransferSubmitRequest {
  address: `0x${string}`;
  functionName: 'withdraw_credit';
  args: [string];
  value: bigint;
  account: `0x${string}`;
  fees: {
    distribution: FeesDistribution;
    feeValue: bigint;
    messageAllocations: MessageFeeAllocationInput[];
  };
}

type FeeSimulator = (input: WithdrawFeeSimulationRequest) => Promise<WithdrawFeeSimulation>;
type FeeSubmitter = (input: NativeTransferSubmitRequest) => Promise<`0x${string}`>;

let simulatorOverride: FeeSimulator | null = null;
let submitOverride: FeeSubmitter | null = null;

export function setNativeTransferFeeSimulatorForTesting(simulator: FeeSimulator | null): void {
  simulatorOverride = simulator;
}

export function setNativeTransferSubmitForTesting(submitter: FeeSubmitter | null): void {
  submitOverride = submitter;
}

export function serializeWithBigints(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? { __bigint: item.toString() } : item));
}

export function reviveBigints(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && value !== null && '__bigint' in value) {
    const record = value as { __bigint?: unknown };
    if (Object.keys(record).length === 1) {
      return BigInt(String(record.__bigint));
    }
  }
  return value;
}

export function allocationBudgetWei(allocations: MessageFeeAllocationInput[]): bigint {
  return allocations.reduce((sum, item) => sum + BigInt(item.budget ?? 0), 0n);
}

export function allocationIncludesRecipient(allocations: MessageFeeAllocationInput[], recipient: string): boolean {
  const expected = recipient.toLowerCase();
  return allocations.some((item) => String(item.recipient).toLowerCase() === expected);
}

export async function resolveWithdrawFeeSimulation(
  request: WithdrawFeeSimulationRequest,
  options: { kitOverridden: boolean }
): Promise<WithdrawFeeSimulation | null> {
  if (simulatorOverride) {
    return simulatorOverride(request);
  }
  if (options.kitOverridden) {
    return null;
  }
  return simulateWithdrawFeesOnChain(request);
}

export async function simulateWithdrawFeesOnChain(
  request: WithdrawFeeSimulationRequest
): Promise<WithdrawFeeSimulation> {
  const appealRounds = STANDARD_APPEAL_ROUNDS;
  const rotations = Array.from({ length: Number(appealRounds) + 1 }, () => 1n);
  const sdk = createClient({
    chain: request.chain as never,
    provider: request.provider,
    account: request.account,
  });
  const simulation = await sdk.estimateTransactionFeesForWrite({
    address: request.address,
    functionName: 'withdraw_credit',
    args: [request.proposalId],
    account: { address: request.account, type: 'json-rpc' },
    value: request.value,
    leaderTimeunitsAllocation: 125n,
    validatorTimeunitsAllocation: 250n,
    appealRounds,
    rotations,
  });
  return {
    distribution: simulation.distribution,
    messageAllocations: simulation.messageAllocations ?? [],
    feeValue: simulation.feeValue,
  };
}

export function sealNativeTransfer(params: {
  account: string;
  proposalId: string;
  contractAddress: string;
  argsJson: string;
  simulation: WithdrawFeeSimulation;
}): SealedNativeTransfer {
  const allocations = params.simulation.messageAllocations;
  return {
    account: params.account.toLowerCase(),
    proposalId: params.proposalId,
    contractAddress: params.contractAddress.toLowerCase(),
    argsJson: params.argsJson,
    allocations,
    sealedAllocationsJson: serializeWithBigints(allocations),
    simulatedFeeValueWei: params.simulation.feeValue.toString(),
    simulatedTotalMessageFeesWei: params.simulation.distribution.totalMessageFees.toString(),
    requiredBudgetWei: allocationBudgetWei(allocations).toString(),
  };
}

export function assertSealedWithdrawReady(params: {
  seal: SealedNativeTransfer | undefined;
  account: string;
  proposalId: string | undefined;
  contractAddress: string;
  argsJson: string;
  payableValueWei: bigint;
  quoteUserValue: bigint;
  quoteFeeValue: bigint;
  quoteTotalMessageFees: bigint;
  quoteMessageFees: bigint | null | undefined;
}): void {
  const seal = params.seal;
  if (!seal || !seal.allocations?.length || !seal.sealedAllocationsJson) {
    throw new Error('The native-transfer fee allocation is missing or stale. Re-estimate before signing.');
  }
  const sameIdentity =
    seal.account === params.account.toLowerCase() &&
    seal.proposalId === params.proposalId &&
    seal.contractAddress === params.contractAddress.toLowerCase() &&
    seal.argsJson === params.argsJson &&
    serializeWithBigints(seal.allocations) === seal.sealedAllocationsJson;
  if (!sameIdentity) {
    throw new Error('The native-transfer fee allocation is missing or stale. Re-estimate before signing.');
  }
  const required = BigInt(seal.requiredBudgetWei);
  const simulatedFee = BigInt(seal.simulatedFeeValueWei);
  if (params.quoteTotalMessageFees < required || params.quoteFeeValue < simulatedFee) {
    throw new Error("The payout fee quote is below Studio Next's simulated requirement. Re-estimate before signing.");
  }
  if (params.quoteMessageFees === undefined || params.quoteMessageFees === null || BigInt(params.quoteMessageFees) <= 0n) {
    throw new Error(
      'Submission disabled: emit_transfer requires a fresh positive native-message fee estimate (quote.breakdown.messageFees > 0). UI gating is guidance; the contract is authoritative.'
    );
  }
  if (params.payableValueWei !== 0n || params.quoteUserValue !== 0n) {
    throw new Error('withdraw_credit payable value must be zero. Re-estimate before signing.');
  }
}

export function sealedAllocations(seal: SealedNativeTransfer): MessageFeeAllocationInput[] {
  return JSON.parse(seal.sealedAllocationsJson, reviveBigints) as MessageFeeAllocationInput[];
}

export async function submitWithdrawWithAllocations(
  request: NativeTransferSubmitRequest,
  options: { chain: unknown; provider: Eip1193Provider; refuseLiveSubmit: boolean }
): Promise<{ genlayerTxId: `0x${string}` }> {
  if (submitOverride) {
    const genlayerTxId = await submitOverride(request);
    if (!genlayerTxId?.startsWith('0x')) {
      throw new Error('Submission failed: transaction ID not returned by provider.');
    }
    return { genlayerTxId };
  }
  if (options.refuseLiveSubmit) {
    throw new Error('The native-transfer fee allocation is missing or stale. Re-estimate before signing.');
  }
  const sdk = createClient({
    chain: options.chain as never,
    provider: options.provider,
    account: request.account,
  });
  const genlayerTxId = await sdk.writeContract({
    address: request.address,
    functionName: request.functionName,
    args: request.args,
    value: request.value,
    fees: request.fees,
  });
  return { genlayerTxId: genlayerTxId as `0x${string}` };
}
