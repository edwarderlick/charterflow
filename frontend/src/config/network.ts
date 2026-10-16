/**
 * Public, non-secret network configuration for GenLayer Studio Next.
 * Chain ID: 61997
 */

export interface NetworkConfig {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorerUrl: string;
  contractAddress: string;
}

const getEnvVar = (key: string): string => {
  if (typeof import.meta !== 'undefined' && (import.meta as any)?.env?.[key]) {
    return (import.meta as any).env[key];
  }
  const proc = (globalThis as any)?.process;
  if (proc?.env?.[key]) {
    return proc.env[key] as string;
  }
  return '';
};

/**
 * Previous Studio Next deployment. Source 4ec11b1b calls run_nondet_unsafe and cannot be patched.
 * Its two funded rounds stay here for recovery. AI review and voting are closed on this address.
 */
export const LEGACY_UNPATCHABLE_CONTRACT = {
  chainId: 61997,
  contractAddress: '0x9579A19c2aD0a2DBd0B806Abb85bE9a2E6391E48',
  sourceSha256: '4ec11b1bee98122d3dad5ab86f5823d676797c1c0873133d386adeeba12b9b72',
  deployTransaction: '0x9f23ec04bc3c29f325afc9b1026da6247395b11602c2c783473fe22e59364cfd',
  deployer: '0x31e14df3b4f47F2428F3B78E7279691A78f70a05',
  fundedRoundIds: [
    'round-studio-next-rpc--mvarlewq',
    'round-studio-next-rpc--mvas9jju',
  ],
  failedEvaluateTransactions: [
    '0x3e6541640c119ca4c1120349f3b7771c8ad5d4d712d663aee2c3ef6bce6bb1bc',
    '0xe6a80afea1222bdde3da64a27d64068d52e469a8dac149c04c3f82ad86996ab8',
  ],
} as const;

/** Receipt-verified runner-compat deployment. Empty round registry. Do not deploy this source again. */
export const VERIFIED_DEPLOYMENT = {
  chainId: 61997,
  contractAddress: '0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8',
  sourceSha256: '4b146292c840cf16e0dcfd7b8d488492092d73c2c3160dda366f922642eaee78',
  deployTransaction: '0x700b462e4620bf849b873af0e515357d08e905aa03a3682d5abb06d58f80da6c',
  deployer: '0x7E4E1f7DcC3DA063F9110477Ad348C90E8599253',
  stage2ReadbackVerified: false,
} as const;

/**
 * Source that is already deployed at VERIFIED_DEPLOYMENT.
 * unpatchableLiveSourceSha256 remains the bytecode at 0x9579, not this deployment.
 */
export const NEXT_RUNNER_COMPAT_SOURCE = {
  sourceSha256: '4b146292c840cf16e0dcfd7b8d488492092d73c2c3160dda366f922642eaee78',
  unpatchableLiveSourceSha256: LEGACY_UNPATCHABLE_CONTRACT.sourceSha256,
  userValueWei: '0',
  deployedContractAddress: VERIFIED_DEPLOYMENT.contractAddress,
} as const;

export const LEGACY_AI_VOTE_WRITE_BLOCK =
  'WRITE BLOCKED: AI review and voting are closed on legacy contract 0x9579A19c2aD0a2DBd0B806Abb85bE9a2E6391E48 (source 4ec11b1bee98122d3dad5ab86f5823d676797c1c0873133d386adeeba12b9b72). Its funded rounds stay visible for recovery only.';

export function isLegacyUnpatchableAddress(address?: string | null): boolean {
  if (!address) return false;
  return address.toLowerCase() === LEGACY_UNPATCHABLE_CONTRACT.contractAddress.toLowerCase();
}

export function isLegacyUnpatchableRound(roundId?: string | null): boolean {
  if (!roundId) return false;
  const id = roundId.toLowerCase();
  return LEGACY_UNPATCHABLE_CONTRACT.fundedRoundIds.some((roundIdOnLegacy) => roundIdOnLegacy.toLowerCase() === id);
}

export function legacyUnpatchableRoundIdForProposal(proposalId?: string | null): string | null {
  if (!proposalId) return null;
  const id = proposalId.toLowerCase();
  for (const roundId of LEGACY_UNPATCHABLE_CONTRACT.fundedRoundIds) {
    if (id.startsWith(`prp-${roundId.toLowerCase()}-`)) return roundId;
  }
  return null;
}

export function legacyAiVoteWriteBlock(params: {
  contractAddress?: string | null;
  roundId?: string | null;
  proposalId?: string | null;
}): string | null {
  if (
    isLegacyUnpatchableAddress(params.contractAddress) ||
    isLegacyUnpatchableRound(params.roundId) ||
    legacyUnpatchableRoundIdForProposal(params.proposalId)
  ) {
    return LEGACY_AI_VOTE_WRITE_BLOCK;
  }
  return null;
}

export const LEGACY_FUNDED_ROUND = {
  chainId: 61997,
  contractAddress: '0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21',
  deployTransaction: '0xc5c220571c8d890c04715ce65cfd23ae92a0d49e696c596979591f771ab734e4',
  roundId: 'round-studio-next-rpc--mv9pwatt',
  createTransaction: '0x09766c41512138c085b095ac8809f65d4b30ff1b6a31bf0d7649f1b58bc5e754',
  failedNominationTransaction: '0x56c7d6d56cb4434bf341a2ab56f42c9db2ee8cef468f87c199c0b120475080f5',
  deployedSourceSha256: '34ea0e374cfe68788067838cebf4ca0c226e139c713aca6e7345716b35aad5ee',
  // Source that replaced 34ea0e37 and still runs at 0x9579. The verified runner-compat deploy is VERIFIED_DEPLOYMENT.
  correctedSourceSha256: '4ec11b1bee98122d3dad5ab86f5823d676797c1c0873133d386adeeba12b9b72',
  pilotRoundId: 'rnd-pilot-354517',
  stage2Transaction: '0x1476320746c0efda5f97d2db6256c571c6da7adff7c494af33031bf9adfb0bdc',
} as const;

export const LOCKED_RECOVERY_ROUND_IDS = [
  LEGACY_FUNDED_ROUND.pilotRoundId,
  LEGACY_FUNDED_ROUND.roundId,
] as const;

export function isLockedRecoveryRound(roundId?: string | null): boolean {
  if (!roundId) return false;
  const id = roundId.toLowerCase();
  return LOCKED_RECOVERY_ROUND_IDS.some((locked) => locked.toLowerCase() === id);
}

export const NETWORK_CONFIG: NetworkConfig = {
  chainId: 61997,
  chainName: 'GenLayer Studio Next',
  rpcUrl: getEnvVar('VITE_RPC_URL') || 'https://studio-next.genlayer.com/api',
  explorerUrl: getEnvVar('VITE_EXPLORER_URL') || 'https://explorer-studio-dev.genlayer.com',
  contractAddress: getEnvVar('VITE_CONTRACT_ADDRESS').trim() || VERIFIED_DEPLOYMENT.contractAddress,
};

/**
 * Returns true if a valid, non-empty, non-zero EVM contract address is configured.
 */
export function isContractConfigured(addressOverride?: string): boolean {
  const addr = addressOverride || NETWORK_CONFIG.contractAddress;
  return (
    typeof addr === 'string' &&
    addr.startsWith('0x') &&
    addr.length === 42 &&
    addr.toLowerCase() !== '0x0000000000000000000000000000000000000000'
  );
}
