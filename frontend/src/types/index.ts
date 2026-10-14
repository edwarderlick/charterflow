// CharterFlow Domain Types and Protocol Specifications

export type ProposalState =
  | 'SUBMITTED'
  | 'ELIGIBLE'
  | 'INELIGIBLE'
  | 'NEEDS_CLARITY'
  | 'VOTING'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'PAYOUT_EMITTED';

export type RoundState =
  | 'ACTIVE'
  | 'CLOSED'
  | 'REFUND_EMITTED'
  | 'ACTIVE_VOTING'
  | 'COMPLIANCE'
  | 'FINALIZED';

export interface Deliverable {
  id: string;
  title: string;
  description: string;
}

export interface ProposalVote {
  voterAddress: string;
  stance: 'YES' | 'NO';
  timestamp: string;
  blockNumber: number;
  txHash?: string;
}

export interface ProposalEvent {
  block?: number;
  voterNode?: string;
  stance?: 'YES' | 'NO';
  txHash?: string;
  timestamp?: string;
  description: string;
}

export interface Proposal {
  id: string;
  roundId: string;
  roundTitle: string;
  title: string;
  requestedGen: number;
  requestedAmountWei?: string;
  recipientAddress: string;
  nominatorAddress: string;
  status: ProposalState;
  workDescription: string;
  deliverables: Deliverable[];
  matchedRuleIds: string[];
  aiEvaluation?: {
    status: 'ELIGIBLE' | 'INELIGIBLE' | 'NEEDS_CLARITY' | 'PENDING' | 'EXPIRED';
    score?: number | null;
    ruleMatches: { ruleId: string; title: string; note: string }[];
    exclusionAudit: string;
    oracleSynthesis: string;
    oracleTx?: string;
  };
  votes: {
    yesCount: number;
    noCount: number;
    requiredYes: number;
    totalEligibleVoters: number;
    deadlineRemaining: string;
    targetBlock?: number;
  };
  eventLog: ProposalEvent[];
  createdAt: string;
}

export interface CharterRule {
  id: string;
  code: string;
  title: string;
  description: string;
  category: string;
  maxAllocGen?: number;
}

export interface CharterExclusion {
  id: string;
  code: string;
  title: string;
  severity: string;
}

export interface Round {
  id: string;
  title: string;
  summary: string;
  creatorAddress: string;
  contractAddress?: string;
  status: RoundState;
  totalPoolGen: number;
  availableGen: number;
  reservedGen: number;
  approvedGen: number;
  withdrawnGen: number;
  capPerProposalGen: number;
  deadlineDisplay: string;
  consensusThresholdPercent: number;
  requiredVotes: number;
  totalVoters: number;
  currentYesVotes: number;
  proposalsCount: {
    inReview: number;
    decided: number;
    total: number;
  };
  charterRules: CharterRule[];
  charterExclusions: CharterExclusion[];
  committeeMembers: {
    address: string;
    hasVoted: boolean;
    isCreator?: boolean;
    isUser?: boolean;
  }[];
  eventStream: {
    time: string;
    type: string;
    details: string;
  }[];
  createdAt: string;
}

export interface RoundDraft {
  title: string;
  summary: string;
  capPerProposalGen: number;
  durationDays: number;
  charterRules: { title: string; description: string }[];
  charterExclusions: { title: string; severity: string }[];
  committeeAddresses: string[];
  consensusThresholdPercent: number;
  votingWindowDays: number;
  initialDepositGen: number;
  savedAt: string;
}

export interface ProposalDraft {
  roundId: string;
  recipientAddress: string;
  requestedGen: number;
  primaryDirectiveId: string;
  workDescription: string;
  deliverablesText: string;
  attested: boolean;
  savedAt: string;
}

export interface UserActivity {
  claimableCredits: {
    id: string;
    roundId: string;
    proposalId: string;
    proposalTitle: string;
    amountGen: number;
    recipientAddress: string;
    status: 'CREDITED_PENDING_WITHDRAWAL';
    isCurrentUserRecipient: boolean;
  }[];
  nominatedProposals: {
    id: string;
    roundId: string;
    title: string;
    requestedGen: number;
    status: ProposalState;
    submittedAt: string;
  }[];
  roundsDeployed: {
    id: string;
    title: string;
    poolGen: number;
    status: string;
    deployedAt: string;
  }[];
  votesCast: {
    id: string;
    proposalId: string;
    proposalTitle: string;
    roundId: string;
    stance: 'YES' | 'NO' | 'PARTICIPATION_RECORDED';
    block?: number;
    timestamp?: string;
  }[];
}
