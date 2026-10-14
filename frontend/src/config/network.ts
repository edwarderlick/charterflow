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

export const VERIFIED_DEPLOYMENT = {
  chainId: 61997,
  contractAddress: '0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21',
  sourceSha256: '34ea0e374cfe68788067838cebf4ca0c226e139c713aca6e7345716b35aad5ee',
  stage2Transaction: '0x1476320746c0efda5f97d2db6256c571c6da7adff7c494af33031bf9adfb0bdc',
  intendedRoundId: 'rnd-pilot-354517',
  stage2ReadbackVerified: false,
} as const;

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
