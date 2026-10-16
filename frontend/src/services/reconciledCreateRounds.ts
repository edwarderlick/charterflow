import { getPersistedTransactions } from './transactionService';

/** Public read-only record of a reconciled create_round. Not a broadcast instruction. */
export const RECONCILED_CREATE_ROUNDS: Record<string, { txHash: `0x${string}`; contractAddress: string }> = {
  'round-open-source-rpc--mvb7nltc': {
    txHash: '0x753a915e0a882d403d0338a04ae4c9569e34eeb04afbd7b275b09c28128dd8d0',
    contractAddress: '0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8',
  },
};

export function createRoundTxHash(roundId: string): { hash: string; source: 'browser' | 'reconciled' } | null {
  const persisted = getPersistedTransactions()
    .filter((tx) => tx.roundId === roundId && typeof tx.txId === 'string' && tx.txId.startsWith('0x'))
    .sort((a, b) => b.submittedAt - a.submittedAt);
  if (persisted[0]?.txId) return { hash: persisted[0].txId, source: 'browser' };
  const known = RECONCILED_CREATE_ROUNDS[roundId];
  if (!known) return null;
  return { hash: known.txHash, source: 'reconciled' };
}
