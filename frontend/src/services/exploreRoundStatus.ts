import type { RoundState } from '../types';

export function isOpenRoundStatus(status: string): boolean {
  return status === 'ACTIVE' || status === 'ACTIVE_VOTING';
}

export function countOpenRounds(rounds: Array<{ status: string }>): number {
  return rounds.filter((round) => isOpenRoundStatus(round.status)).length;
}

/** Card label for the on-chain round state. ACTIVE must not read as settled. */
export function exploreRoundStatusLabel(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'ACTIVE';
    case 'ACTIVE_VOTING':
      return 'VOTING OPEN';
    case 'COMPLIANCE':
      return 'COMPLIANCE STAGE';
    case 'CLOSED':
    case 'FINALIZED':
    case 'REFUND_EMITTED':
      return 'FINALIZED / SETTLED';
    default:
      return status || 'UNKNOWN';
  }
}

export function exploreRoundStatusClass(status: string): string {
  if (status === 'ACTIVE' || status === 'ACTIVE_VOTING') return 'bg-[#00e599]/20 text-[#00e599]';
  if (status === 'COMPLIANCE') return 'bg-[#ffb800]/20 text-[#ffb800]';
  return 'bg-[#353534] text-[#c8c6c2]';
}

export function roundMatchesExploreTab(status: RoundState | string, tab: 'ALL' | 'ACTIVE' | 'CLOSED' | 'COMPLIANCE'): boolean {
  if (tab === 'ACTIVE') return isOpenRoundStatus(status);
  if (tab === 'CLOSED') return status === 'CLOSED' || status === 'FINALIZED' || status === 'REFUND_EMITTED';
  if (tab === 'COMPLIANCE') return status === 'COMPLIANCE';
  return true;
}
