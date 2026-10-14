import { VERIFIED_DEPLOYMENT } from '../config/network';
import type { Proposal, Round } from '../types';

const RECOVERY_ROUND_ID = VERIFIED_DEPLOYMENT.intendedRoundId;

export interface PermissionDecision {
  allowed: boolean;
  reason: string;
}

export type WalletRole = 'disconnected' | 'visitor' | 'creator' | 'committee' | 'recipient' | 'creator_committee';

export function addressesEqual(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

export function describeWalletRole(params: {
  account?: string | null;
  round?: Round | null;
  proposal?: Proposal | null;
}): WalletRole {
  if (!params.account) return 'disconnected';
  const isCreator = addressesEqual(params.account, params.round?.creatorAddress);
  const isCommittee = Boolean(
    params.round?.committeeMembers?.some((m) => addressesEqual(m.address, params.account))
  );
  const isRecipient = addressesEqual(params.account, params.proposal?.recipientAddress);
  if (isCreator && isCommittee) return 'creator_committee';
  if (isCreator) return 'creator';
  if (isRecipient) return 'recipient';
  if (isCommittee) return 'committee';
  return 'visitor';
}

export function canCreateRound(params: {
  connected: boolean;
  correctChain: boolean;
  balanceGen?: string | null;
}): PermissionDecision {
  if (!params.connected) {
    return { allowed: false, reason: 'Connect an injected EIP-1193 wallet on chain 61997 to create a round. Browsing does not require a wallet.' };
  }
  if (!params.correctChain) {
    return { allowed: false, reason: 'Switch the connected wallet to GenLayer Studio Next (chain 61997). The app will not auto-switch.' };
  }
  if (params.balanceGen === '0.00') {
    return {
      allowed: false,
      reason: 'This wallet has 0 GEN. The contract requires a minimum 1 GEN deposit plus network fees. UI gating is guidance; the contract is authoritative.',
    };
  }
  return {
    allowed: true,
    reason: 'Any funded wallet on chain 61997 may create a round, subject to a 1 GEN minimum deposit, roster, deadline, and fee-estimate checks. The contract enforces those rules.',
  };
}

export function canNominate(params: {
  connected: boolean;
  correctChain: boolean;
  round?: Round | null;
  account?: string | null;
  chainTimeSec?: number | null;
}): PermissionDecision {
  if (!params.round) {
    return { allowed: false, reason: 'Round state is unavailable. Nomination is blocked until a live get_round read succeeds.' };
  }
  if (params.round.id.toLowerCase() === RECOVERY_ROUND_ID.toLowerCase()) {
    return { allowed: false, reason: `RECOVERY_ROUND_NOMINATION_FORBIDDEN: ${RECOVERY_ROUND_ID} is a locked recovery/refund case.` };
  }
  if (!params.connected || !params.account) {
    return { allowed: false, reason: 'Only a listed committee member may nominate. Connect a roster wallet to submit. Anyone may still read the round.' };
  }
  if (!params.correctChain) {
    return { allowed: false, reason: 'Nomination requires chain 61997. Switch network with an explicit click.' };
  }
  const onRoster = params.round.committeeMembers.some((m) => addressesEqual(m.address, params.account));
  if (!onRoster) {
    return {
      allowed: false,
      reason: `Connected wallet is not on this round's committee roster. Only listed members may nominate. Contract enforcement is authoritative.`,
    };
  }
  if (
    params.chainTimeSec != null &&
    params.round.nominationCutoffUnix != null &&
    params.chainTimeSec >= params.round.nominationCutoffUnix
  ) {
    return { allowed: false, reason: 'EXPIRED_NOMINATION_WINDOW: on-chain nomination cutoff has passed.' };
  }
  return { allowed: true, reason: 'This wallet is a listed committee member and may nominate, subject to cap, recipient, and cutoff checks.' };
}

export function canEvaluateCharterFit(params: { proposal?: Proposal | null; connected: boolean; correctChain: boolean }): PermissionDecision {
  if (!params.proposal) {
    return { allowed: false, reason: 'Proposal state is unavailable.' };
  }
  if (params.proposal.status !== 'SUBMITTED') {
    return { allowed: false, reason: `evaluate_charter_fit applies only while the proposal is SUBMITTED (current state: ${params.proposal.status}).` };
  }
  if (!params.connected) {
    return { allowed: false, reason: 'evaluate_charter_fit is permissionless on-chain but still a paid transaction. Connect a wallet on chain 61997; anyone may pay the fee.' };
  }
  if (!params.correctChain) {
    return { allowed: false, reason: 'Switch to chain 61997 before paying for charter evaluation.' };
  }
  return { allowed: true, reason: 'evaluate_charter_fit is permissionless. Any wallet on chain 61997 may pay to trigger AI charter review.' };
}

export function canVote(params: {
  connected: boolean;
  correctChain: boolean;
  account?: string | null;
  round?: Round | null;
  proposal?: Proposal | null;
  hasAlreadyVoted?: boolean;
}): PermissionDecision {
  if (!params.proposal || !params.round) {
    return { allowed: false, reason: 'Proposal or round state is unavailable.' };
  }
  const votingOpen = params.proposal.status === 'ELIGIBLE' || params.proposal.status === 'VOTING';
  if (!votingOpen) {
    return { allowed: false, reason: `Voting is closed for state ${params.proposal.status}.` };
  }
  if (!params.connected || !params.account) {
    return { allowed: false, reason: 'Only a listed committee member may vote. Connect a roster wallet. Anyone may still read the proposal.' };
  }
  if (!params.correctChain) {
    return { allowed: false, reason: 'Voting requires chain 61997.' };
  }
  const onRoster = params.round.committeeMembers.some((m) => addressesEqual(m.address, params.account));
  if (!onRoster) {
    return { allowed: false, reason: 'Connected wallet is not on the committee roster. Only listed members may vote.' };
  }
  if (addressesEqual(params.account, params.proposal.recipientAddress)) {
    return { allowed: false, reason: 'Recipient recusal: a committee member who is this proposal’s recipient cannot vote on it.' };
  }
  if (params.hasAlreadyVoted) {
    return { allowed: false, reason: 'This wallet already has a recorded ballot. Duplicate votes are rejected by the contract.' };
  }
  return { allowed: true, reason: 'This wallet is an eligible committee member and may cast one YES or NO vote.' };
}

export function canWithdrawCredit(params: {
  connected: boolean;
  correctChain: boolean;
  account?: string | null;
  proposal?: Proposal | null;
}): PermissionDecision {
  if (!params.proposal) {
    return { allowed: false, reason: 'Proposal state is unavailable.' };
  }
  if (params.proposal.status === 'PAYOUT_EMITTED') {
    return { allowed: false, reason: 'Credit already withdrawn (PAYOUT_EMITTED). Duplicate withdrawal is rejected by the contract.' };
  }
  if (params.proposal.status !== 'APPROVED') {
    return { allowed: false, reason: `Only the named recipient may withdraw after APPROVED (current state: ${params.proposal.status}).` };
  }
  if (!params.connected || !params.account) {
    return { allowed: false, reason: 'Connect the named recipient wallet to withdraw. Other addresses cannot pull this credit.' };
  }
  if (!params.correctChain) {
    return { allowed: false, reason: 'Withdrawal requires chain 61997 and a positive native-message fee estimate.' };
  }
  if (!addressesEqual(params.account, params.proposal.recipientAddress)) {
    return {
      allowed: false,
      reason: `Only the named recipient ${params.proposal.recipientAddress.slice(0, 6)}…${params.proposal.recipientAddress.slice(-4)} may withdraw this credit.`,
    };
  }
  return {
    allowed: true,
    reason: 'This wallet is the named recipient. Withdrawal emits a native transfer (PAYOUT_EMITTED unless delivery is independently proven).',
  };
}

export function canCloseExpiredRound(params: {
  connected: boolean;
  correctChain: boolean;
  account?: string | null;
  round?: Round | null;
  chainTimeSec?: number | null;
}): PermissionDecision {
  if (!params.round) {
    return { allowed: false, reason: 'Round state is unavailable.' };
  }
  if (params.round.status !== 'ACTIVE' && params.round.status !== 'ACTIVE_VOTING') {
    return { allowed: false, reason: `Round is ${params.round.status}. Close applies to an expired active round.` };
  }
  if (params.round.roundEndUnix != null && params.chainTimeSec != null && params.chainTimeSec < params.round.roundEndUnix) {
    return { allowed: false, reason: 'Round end has not been reached. Only the creator may close after round_end, with reservations settled.' };
  }
  if (!params.connected || !params.account) {
    return { allowed: false, reason: 'Only the round creator may close an expired round. Connect that wallet.' };
  }
  if (!params.correctChain) {
    return { allowed: false, reason: 'Closing a round requires chain 61997.' };
  }
  if (!addressesEqual(params.account, params.round.creatorAddress)) {
    return { allowed: false, reason: 'Only the round creator may close this round and start the refund path.' };
  }
  return { allowed: true, reason: 'This wallet is the round creator. Close is still subject to round_end and reserved=0 on-chain.' };
}

export function canClaimCreatorRefund(params: {
  connected: boolean;
  correctChain: boolean;
  account?: string | null;
  round?: Round | null;
}): PermissionDecision {
  if (!params.round) {
    return { allowed: false, reason: 'Round state is unavailable.' };
  }
  if (params.round.status !== 'CLOSED') {
    return { allowed: false, reason: 'Creator refund is available after the round is closed. UI gating is guidance; the contract is authoritative.' };
  }
  if (!params.connected || !params.account) {
    return { allowed: false, reason: 'Only the round creator may claim the leftover refund. Connect that wallet.' };
  }
  if (!params.correctChain) {
    return { allowed: false, reason: 'Refund claim requires chain 61997 and a positive native-message fee estimate.' };
  }
  if (!addressesEqual(params.account, params.round.creatorAddress)) {
    return { allowed: false, reason: 'Only the round creator may claim this refund.' };
  }
  return { allowed: true, reason: 'This wallet is the round creator and may claim leftover refund after close.' };
}

export function canSettleExpiredProposal(params: { proposal?: Proposal | null; isExpirable: boolean }): PermissionDecision {
  if (!params.proposal) {
    return { allowed: false, reason: 'Proposal state is unavailable.' };
  }
  if (!params.isExpirable) {
    return { allowed: false, reason: 'Permissionless expired-proposal settlement is shown only when the submission or voting deadline has actually passed.' };
  }
  return {
    allowed: true,
    reason: 'Settlement is permissionless once the applicable deadline has passed. Any wallet may pay to unreserve funds.',
  };
}

export function expectedEffectForAction(action: string): string {
  switch (action) {
    case 'create_round':
      return 'Creates an isolated round ledger, freezes the charter and roster, and deposits the payable GEN. Nomination cutoff is at least 24 hours.';
    case 'nominate_proposal':
      return 'Reserves requested GEN from the round available balance and records a SUBMITTED proposal. Only a listed committee member may succeed.';
    case 'evaluate_charter_fit':
      return 'Pays for permissionless AI charter review. Result is a categorical verdict; semantic rationale is not independently verified.';
    case 'cast_vote':
      return 'Records one committee YES or NO. Recipients on the committee are recused. Quorum is (N*2+2)//3.';
    case 'withdraw_credit':
      return 'Named recipient pulls approved credit. Contract emits a native transfer (PAYOUT_EMITTED). Delivery is not independently proven from emission alone.';
    case 'close_round_and_refund':
      return 'Creator closes an expired round with no remaining reservations and makes leftovers claimable.';
    case 'claim_creator_refund':
      return 'Creator pulls leftover GEN after close. Native-message fees must be positive before broadcast.';
    case 'settle_expired_proposal':
      return 'Permissionless settlement unreserves funds for an expired proposal. Shown only when that deadline has passed.';
    default:
      return 'Submits the named contract method on chain 61997 after an explicit wallet signature.';
  }
}
