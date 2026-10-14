import React, { createContext, useContext, useState } from 'react';
import type {
  Proposal,
  ProposalDraft,
  Round,
  RoundDraft,
  UserActivity,
  ProposalState,
  RoundState,
} from '../types';

import {
  SAMPLE_PROPOSALS,
  SAMPLE_ROUNDS,
  SAMPLE_USER_ACTIVITY,
} from './sampleData';

import { createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { NETWORK_CONFIG, isContractConfigured } from '../config/network';

export interface DataAccessAdapter {
  isLive: boolean;
  getRounds(): Promise<Round[]>;
  getRoundById(id: string): Promise<Round | null>;
  getProposalsByRound(roundId: string): Promise<Proposal[]>;
  getProposalById(id: string): Promise<Proposal | null>;
  getUserActivity(walletAddress?: string): Promise<UserActivity>;
  saveRoundDraft(draft: RoundDraft): void;
  getRoundDraft(): RoundDraft | null;
  clearRoundDraft(): void;
  saveProposalDraft(draft: ProposalDraft): void;
  getProposalDraft(roundId: string): ProposalDraft | null;
  clearProposalDraft(roundId: string): void;
}

class PreviewDataAccessAdapter implements DataAccessAdapter {
  isLive = false;

  async getRounds(): Promise<Round[]> {
    return [...SAMPLE_ROUNDS];
  }

  async getRoundById(id: string): Promise<Round | null> {
    const round = SAMPLE_ROUNDS.find((r) => r.id === id);
    return round ? { ...round } : null;
  }

  async getProposalsByRound(roundId: string): Promise<Proposal[]> {
    return SAMPLE_PROPOSALS.filter((p) => p.roundId === roundId);
  }

  async getProposalById(id: string): Promise<Proposal | null> {
    const proposal = SAMPLE_PROPOSALS.find((p) => p.id === id);
    return proposal ? { ...proposal } : null;
  }

  async getUserActivity(_walletAddress?: string): Promise<UserActivity> {
    return JSON.parse(JSON.stringify(SAMPLE_USER_ACTIVITY));
  }

  saveRoundDraft(draft: RoundDraft): void {
    localStorage.setItem('cf_round_draft_preview', JSON.stringify(draft));
  }

  getRoundDraft(): RoundDraft | null {
    const raw = localStorage.getItem('cf_round_draft_preview');
    return raw ? JSON.parse(raw) : null;
  }

  clearRoundDraft(): void {
    localStorage.removeItem('cf_round_draft_preview');
  }

  saveProposalDraft(draft: ProposalDraft): void {
    localStorage.setItem(`cf_prp_draft_${draft.roundId}_preview`, JSON.stringify(draft));
  }

  getProposalDraft(roundId: string): ProposalDraft | null {
    const raw = localStorage.getItem(`cf_prp_draft_${roundId}_preview`);
    return raw ? JSON.parse(raw) : null;
  }

  clearProposalDraft(roundId: string): void {
    localStorage.removeItem(`cf_prp_draft_${roundId}_preview`);
  }
}

/**
 * Converts Wei (string, number, or bigint) to human-readable GEN decimal amount.
 */
export function weiToGen(weiStr: string | number | bigint): number {
  try {
    const val = BigInt(weiStr.toString());
    const whole = val / 1000000000000000000n;
    const fraction = val % 1000000000000000000n;
    return Number(whole) + Number(fraction) / 1e18;
  } catch {
    return 0;
  }
}

/**
 * Validates a value as a safe non-negative integer count.
 * Throws explicit descriptive error if value is invalid.
 */
export function validateSafeCount(val: any, context: string): number {
  if (val === null || val === undefined) {
    throw new Error(`Malformed response: ${context} returned null or undefined`);
  }
  const n = Number(val);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`Malformed response: ${context} expected non-negative integer count, received ${String(val)}`);
  }
  return n;
}

/**
 * Validates a required money field as a valid non-negative wei value.
 * Throws explicit descriptive error if value is missing, negative, or unparseable.
 * Missing required values must never display as zero GEN.
 */
export function validateWei(val: any, context: string): bigint {
  if (val === null || val === undefined || val === '') {
    throw new Error(`Malformed response: ${context} required wei value is missing`);
  }
  let b: bigint;
  try {
    b = BigInt(val.toString());
  } catch {
    throw new Error(`Malformed response: ${context} expected valid wei integer, received "${String(val)}"`);
  }
  if (b < 0n) {
    throw new Error(`Malformed response: ${context} wei value cannot be negative, got ${b.toString()}`);
  }
  return b;
}

export function parseGenToWei(
  val: string,
  options?: { minWei?: bigint; maxWei?: bigint; context?: string }
): bigint {
  const ctx = options?.context ? `${options.context}: ` : '';
  if (typeof val !== 'string') {
    throw new Error(`${ctx}Expected decimal GEN string, received ${typeof val}`);
  }
  const trimmed = val.trim();
  if (!trimmed) {
    throw new Error(`${ctx}Amount cannot be empty`);
  }
  if (trimmed.startsWith('-')) {
    throw new Error(`${ctx}Amount cannot be negative`);
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed) && !/^\.\d+$/.test(trimmed)) {
    throw new Error(`${ctx}Invalid decimal number format: "${val}"`);
  }

  const [intPartRaw, fracPartRaw = ''] = trimmed.includes('.')
    ? trimmed.split('.')
    : [trimmed, ''];

  const intPart = intPartRaw === '' ? '0' : intPartRaw;

  if (fracPartRaw.length > 18) {
    throw new Error(`${ctx}Precision exceeds maximum 18 decimals`);
  }

  const fracPartPadded = fracPartRaw.padEnd(18, '0');
  const wei = BigInt(intPart) * 1000000000000000000n + BigInt(fracPartPadded);

  if (options?.minWei !== undefined && wei < options.minWei) {
    throw new Error(`${ctx}Amount ${wei.toString()} wei is below minimum (${options.minWei.toString()} wei)`);
  }
  if (options?.maxWei !== undefined && wei > options.maxWei) {
    throw new Error(`${ctx}Amount ${wei.toString()} wei exceeds maximum (${options.maxWei.toString()} wei)`);
  }

  return wei;
}

/**
 * Sanitizes raw error strings for safe diagnostic presentation in UI.
 */
export function sanitizeDiagnostic(err: any): string {
  if (!err) return 'Unknown RPC error';
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/https?:\/\/[^\s/]+/g, (m) => m).slice(0, 300);
}

/**
 * Maps contract proposal state string to strictly validated ProposalState union.
 * Unknown states surface an incompatible-response error; never maps them to SUBMITTED.
 */
export function mapContractProposalState(state: string | undefined): ProposalState {
  const s = String(state || '').trim().toUpperCase();
  switch (s) {
    case 'SUBMITTED':
      return 'SUBMITTED';
    case 'ELIGIBLE':
      return 'ELIGIBLE';
    case 'INELIGIBLE':
      return 'INELIGIBLE';
    case 'NEEDS_CLARITY':
      return 'NEEDS_CLARITY';
    case 'VOTING':
      return 'VOTING';
    case 'APPROVED':
      return 'APPROVED';
    case 'REJECTED':
      return 'REJECTED';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'PAYOUT_EMITTED':
      return 'PAYOUT_EMITTED';
    default:
      throw new Error(`Incompatible contract proposal state: received "${state}"`);
  }
}

/**
 * Maps contract round state string to strictly validated RoundState union.
 * Unknown states surface an incompatible-response error; never maps them to ACTIVE.
 */
export function mapContractRoundState(state: string | undefined): RoundState {
  const s = String(state || '').trim().toUpperCase();
  switch (s) {
    case 'ACTIVE':
      return 'ACTIVE';
    case 'CLOSED':
      return 'CLOSED';
    case 'REFUND_EMITTED':
      return 'REFUND_EMITTED';
    case 'ACTIVE_VOTING':
      return 'ACTIVE_VOTING';
    case 'COMPLIANCE':
      return 'COMPLIANCE';
    case 'FINALIZED':
      return 'FINALIZED';
    default:
      throw new Error(`Incompatible contract round state: received "${state}"`);
  }
}

/**
 * Enforces an upper bound timeout on an asynchronous promise.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number = 15000,
  context: string = 'RPC Call'
): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timeout: ${context} exceeded ${ms}ms limit`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

export class TruthfulLiveDataAccessAdapter implements DataAccessAdapter {
  isLive = true;
  private client: any;
  private customContractAddress?: string;

  constructor(client?: any, customContractAddress?: string) {
    this.client = client;
    this.customContractAddress = customContractAddress;
  }

  private getContractAddress(): string {
    return this.customContractAddress || NETWORK_CONFIG.contractAddress;
  }

  public isConfigured(): boolean {
    if (this.customContractAddress) {
      return (
        typeof this.customContractAddress === 'string' &&
        this.customContractAddress.startsWith('0x') &&
        this.customContractAddress.length === 42 &&
        this.customContractAddress.toLowerCase() !== '0x0000000000000000000000000000000000000000'
      );
    }
    return isContractConfigured();
  }

  public getClient(): any {
    if (this.client) return this.client;
    // Uses installed genlayer-js@2.0.0-rc.1 studioDevnet preset for chain 61997.
    // Preserves every other RC chain field (consensus contracts, nativeCurrency, validators)
    // while allowing configurable RPC endpoint via NETWORK_CONFIG.rpcUrl.
    const chain = {
      ...studioDevnet,
      rpcUrls: {
        ...studioDevnet.rpcUrls,
        default: {
          http: [NETWORK_CONFIG.rpcUrl],
        },
      },
    };
    this.client = createClient({ chain });
    return this.client;
  }

  async getRounds(): Promise<Round[]> {
    if (!this.isConfigured()) {
      return [];
    }

    const client = this.getClient();
    const contractAddress = this.getContractAddress();

    // Query total round count (strictly validated as safe non-negative integer)
    const rawCount = await withTimeout(
      client.readContract({
        address: contractAddress,
        functionName: 'get_round_ids_count',
        args: [],
      }),
      10000,
      'get_round_ids_count'
    );
    const totalCount = validateSafeCount(rawCount, 'get_round_ids_count');
    if (totalCount === 0) {
      return [];
    }

    // Paginate through round IDs in bounded chunks (max 50)
    const roundIds: string[] = [];
    const seenIds = new Set<string>();
    const pageSize = 50;

    for (let offset = 0; offset < totalCount; offset += pageSize) {
      const limit = Math.min(pageSize, totalCount - offset);
      const pageIds = await withTimeout(
        client.readContract({
          address: contractAddress,
          functionName: 'get_round_ids',
          args: [offset, limit],
        }),
        10000,
        `get_round_ids(offset=${offset}, limit=${limit})`
      );

      if (!Array.isArray(pageIds)) {
        throw new Error(`Malformed response: get_round_ids at offset ${offset} did not return an array`);
      }
      if (pageIds.length !== limit) {
        throw new Error(`Incomplete page: expected ${limit} round IDs at offset ${offset}, received ${pageIds.length}`);
      }

      for (const id of pageIds) {
        if (typeof id !== 'string' || !id.trim()) {
          throw new Error(`Malformed round ID in get_round_ids at offset ${offset}`);
        }
        if (seenIds.has(id)) {
          throw new Error(`Malformed response: duplicate round ID "${id}" returned by contract`);
        }
        seenIds.add(id);
        roundIds.push(id);
      }
    }

    if (roundIds.length !== totalCount) {
      throw new Error(`Incomplete round list: expected ${totalCount} round IDs, retrieved ${roundIds.length}`);
    }

    // Fetch complete detail for each round without silently hiding partial list failures
    const rounds: Round[] = [];
    for (const roundId of roundIds) {
      const r = await this.getRoundById(roundId);
      if (!r) {
        throw new Error(`Incomplete round detail: contract failed to return details for registered round "${roundId}"`);
      }
      rounds.push(r);
    }
    return rounds;
  }

  async getRoundById(id: string): Promise<Round | null> {
    if (!this.isConfigured() || !id) {
      return null;
    }

    const client = this.getClient();
    const contractAddress = this.getContractAddress();

    let rawData: any;
    try {
      rawData = await withTimeout(
        client.readContract({
          address: contractAddress,
          functionName: 'get_round',
          args: [id],
        }),
        10000,
        `get_round(${id})`
      );
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.includes('ERR_ROUND_NOT_FOUND') || msg.includes('not found')) {
        return null;
      }
      throw err;
    }

    const rData = rawData as Record<string, any> | null;
    if (!rData || typeof rData !== 'object' || !rData.round_id) {
      throw new Error(`Malformed response: get_round(${id}) missing round_id or invalid data object`);
    }

    const pCountRaw = await withTimeout(
      client.readContract({
        address: contractAddress,
        functionName: 'get_round_proposals_count',
        args: [id],
      }),
      5000,
      `get_round_proposals_count(${id})`
    );
    const proposalCount = validateSafeCount(pCountRaw, `get_round_proposals_count(${id})`);

    const committee: string[] = Array.isArray(rData.committee_roster)
      ? rData.committee_roster.map((m: any) => String(m).toLowerCase())
      : [];

    const totalPoolGen = weiToGen(validateWei(rData.initial_deposit, `round.initial_deposit(${id})`));
    const availableGen = weiToGen(validateWei(rData.available_wei, `round.available_wei(${id})`));
    const reservedGen = weiToGen(validateWei(rData.reserved_wei, `round.reserved_wei(${id})`));
    const approvedGen = weiToGen(validateWei(rData.approved_credits_wei, `round.approved_credits_wei(${id})`));
    const payoutsEmittedGen = weiToGen(validateWei(rData.payouts_emitted_wei, `round.payouts_emitted_wei(${id})`));
    const capGen = weiToGen(validateWei(rData.grant_cap_wei, `round.grant_cap_wei(${id})`));

    const totalVoters = committee.length;
    const requiredVotes = totalVoters > 0 ? Math.floor((totalVoters * 2 + 2) / 3) : 0;

    const roundEndTs = Number(rData.round_end) || 0;
    const nominationCutoffUnix = Number(rData.nomination_cutoff);
    const deadlineDisplay = roundEndTs > 0
      ? new Date(roundEndTs * 1000).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : 'TBD';

    return {
      id: String(rData.round_id),
      title: String(rData.title || ''),
      summary: String(rData.description || ''),
      creatorAddress: String(rData.creator || ''),
      contractAddress: contractAddress,
      status: mapContractRoundState(rData.state),
      totalPoolGen,
      availableGen,
      reservedGen,
      approvedGen,
      withdrawnGen: payoutsEmittedGen,
      capPerProposalGen: capGen,
      deadlineDisplay,
      nominationCutoffUnix: Number.isFinite(nominationCutoffUnix) ? nominationCutoffUnix : undefined,
      roundEndUnix: roundEndTs > 0 ? roundEndTs : undefined,
      consensusThresholdPercent: 66.67,
      requiredVotes,
      totalVoters,
      currentYesVotes: 0,
      proposalsCount: {
        inReview: 0,
        decided: 0,
        total: proposalCount,
      },
      charterRules: [
        {
          id: 'charter-main',
          code: 'DIR-01',
          title: 'Frozen Charter Directives',
          description: String(rData.charter_text || ''),
          category: 'Mandate',
          maxAllocGen: capGen,
        },
      ],
      charterExclusions: [],
      committeeMembers: committee.map((addr) => ({
        address: addr,
        hasVoted: false,
        isCreator: addr.toLowerCase() === String(rData.creator).toLowerCase(),
      })),
      eventStream: [],
      createdAt: new Date((Number(rData.created_at) || 0) * 1000).toISOString(),
    };
  }

  async getProposalsByRound(roundId: string): Promise<Proposal[]> {
    if (!this.isConfigured() || !roundId) {
      return [];
    }

    const client = this.getClient();
    const contractAddress = this.getContractAddress();

    const rawCount = await withTimeout(
      client.readContract({
        address: contractAddress,
        functionName: 'get_round_proposals_count',
        args: [roundId],
      }),
      10000,
      `get_round_proposals_count(${roundId})`
    );
    const totalCount = validateSafeCount(rawCount, `get_round_proposals_count(${roundId})`);
    if (totalCount === 0) {
      return [];
    }

    const summaries: any[] = [];
    const seenProposalIds = new Set<string>();
    const pageSize = 50;

    for (let offset = 0; offset < totalCount; offset += pageSize) {
      const limit = Math.min(pageSize, totalCount - offset);
      const page = await withTimeout(
        client.readContract({
          address: contractAddress,
          functionName: 'get_round_proposals_summary',
          args: [roundId, offset, limit],
        }),
        10000,
        `get_round_proposals_summary(${roundId}, offset=${offset}, limit=${limit})`
      );

      if (!Array.isArray(page)) {
        throw new Error(`Malformed response: get_round_proposals_summary for round "${roundId}" did not return an array`);
      }
      if (page.length !== limit) {
        throw new Error(`Incomplete page: expected ${limit} proposal summaries at offset ${offset}, received ${page.length}`);
      }

      for (const p of page) {
        if (!p || typeof p !== 'object' || !p.proposal_id) {
          throw new Error(`Malformed proposal summary item in round "${roundId}" at offset ${offset}`);
        }
        if (seenProposalIds.has(String(p.proposal_id))) {
          throw new Error(`Malformed response: duplicate proposal ID "${p.proposal_id}" in round "${roundId}"`);
        }
        seenProposalIds.add(String(p.proposal_id));
        summaries.push(p);
      }
    }

    if (summaries.length !== totalCount) {
      throw new Error(`Incomplete proposal list: expected ${totalCount} summaries, retrieved ${summaries.length}`);
    }

    return summaries.map((p) => {
      const weiVal = validateWei(p.requested_amount_wei, `proposal.requested_amount_wei(${p.proposal_id})`);
      const requestedGen = weiToGen(weiVal);
      const requestedAmountWei = weiVal.toString();
      const submissionTs = Number(p.submission_timestamp) || 0;
      const votingDeadlineTs = Number(p.voting_deadline) || 0;
      const nowTs = Math.floor(Date.now() / 1000);
      const remainingSec = Math.max(0, votingDeadlineTs - nowTs);
      const remainingHours = Math.floor(remainingSec / 3600);

      const verdict = p.review_verdict || 'PENDING';

      return {
        id: String(p.proposal_id),
        roundId: String(p.round_id),
        roundTitle: `Round #${String(p.round_id).toUpperCase()}`,
        title: String(p.title || ''),
        requestedGen,
        requestedAmountWei,
        recipientAddress: String(p.recipient || ''),
        nominatorAddress: String(p.proposer || ''),
        status: mapContractProposalState(p.state),
        workDescription: String(p.deliverables_preview || ''),
        deliverables: [
          {
            id: 'deliv-1',
            title: 'Deliverables Specification',
            description: String(p.deliverables_preview || ''),
          },
        ],
        matchedRuleIds: ['charter-main'],
        aiEvaluation: {
          status: (verdict as any),
          score: null, // Truthful live read: contract stores verdict only, numerical score unavailable
          ruleMatches: [],
          exclusionAudit: 'Evaluated against frozen round charter directives.',
          oracleSynthesis: p.review_reason || 'Automated compliance review',
        },
        votes: {
          yesCount: validateSafeCount(p.votes_yes || 0, 'votes_yes'),
          noCount: validateSafeCount(p.votes_no || 0, 'votes_no'),
          requiredYes: 0,
          totalEligibleVoters: 0,
          deadlineRemaining:
            votingDeadlineTs > 0 ? `${remainingHours}H REMAINING` : 'NO ON-CHAIN DEADLINE',
        },
        eventLog: [],
        createdAt: new Date(submissionTs * 1000).toISOString(),
      };
    });
  }

  async getProposalById(id: string): Promise<Proposal | null> {
    if (!this.isConfigured() || !id) {
      return null;
    }

    const client = this.getClient();
    const contractAddress = this.getContractAddress();

    let rawData: any;
    try {
      rawData = await withTimeout(
        client.readContract({
          address: contractAddress,
          functionName: 'get_proposal',
          args: [id],
        }),
        10000,
        `get_proposal(${id})`
      );
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.includes('ERR_PROPOSAL_NOT_FOUND') || msg.includes('not found')) {
        return null;
      }
      throw err;
    }

    const pData = rawData as Record<string, any> | null;
    if (!pData || typeof pData !== 'object' || !pData.proposal_id) {
      throw new Error(`Malformed response: get_proposal(${id}) missing proposal_id or invalid data object`);
    }

    const weiVal = validateWei(pData.requested_amount_wei, `proposal.requested_amount_wei(${id})`);
    const requestedGen = weiToGen(weiVal);
    const requestedAmountWei = weiVal.toString();
    const submissionTs = Number(pData.submission_timestamp) || 0;
    const votingDeadlineTs = Number(pData.voting_deadline) || 0;
    const nowTs = Math.floor(Date.now() / 1000);
    const remainingSec = Math.max(0, votingDeadlineTs - nowTs);
    const remainingHours = Math.floor(remainingSec / 3600);

    const voters: string[] = Array.isArray(pData.voted_addresses)
      ? pData.voted_addresses.map((v: any) => String(v).toLowerCase())
      : [];

    const verdict = pData.review_verdict || 'PENDING';

    return {
      id: String(pData.proposal_id),
      roundId: String(pData.round_id),
      roundTitle: `Round #${String(pData.round_id).toUpperCase()}`,
      title: String(pData.title || ''),
      requestedGen,
      requestedAmountWei,
      recipientAddress: String(pData.recipient || ''),
      nominatorAddress: String(pData.proposer || ''),
      status: mapContractProposalState(pData.state),
      workDescription: String(pData.deliverables_text || ''),
      deliverables: [
        {
          id: 'deliv-full',
          title: 'Deliverables Specification',
          description: String(pData.deliverables_text || ''),
        },
      ],
      matchedRuleIds: ['charter-main'],
      aiEvaluation: {
        status: (verdict as any),
        score: null, // Truthful live read: contract stores verdict only, numerical score unavailable
        ruleMatches: [],
        exclusionAudit: 'Evaluated against frozen round charter directives.',
        oracleSynthesis: pData.review_reason || 'Automated compliance review',
      },
      votes: {
        yesCount: validateSafeCount(pData.votes_yes || 0, 'votes_yes'),
        noCount: validateSafeCount(pData.votes_no || 0, 'votes_no'),
        requiredYes: 0,
        totalEligibleVoters: 0,
        deadlineRemaining:
          votingDeadlineTs > 0 ? `${remainingHours}H REMAINING` : 'NO ON-CHAIN DEADLINE',
      },
      // voted_addresses proves participation only. Per-voter stance, timestamps, and blocks
      // are private/unrecorded on-chain; per-voter choice is labeled unrecorded.
      eventLog: voters.map((v) => ({
        voterNode: v,
        stance: undefined,
        timestamp: 'RECORDED ON-CHAIN (TIMESTAMP UNAVAILABLE)',
        description: `Ballot cast by ${v.slice(0, 6)}...${v.slice(-4)} (choice unrecorded on-chain)`,
      })),
      createdAt: new Date(submissionTs * 1000).toISOString(),
    };
  }

  async getUserActivity(walletAddress?: string): Promise<UserActivity> {
    if (!this.isConfigured() || !walletAddress) {
      return {
        claimableCredits: [],
        nominatedProposals: [],
        roundsDeployed: [],
        votesCast: [],
      };
    }

    const normAddr = walletAddress.toLowerCase();
    const client = this.getClient();
    const contractAddress = this.getContractAddress();

    // Query deployed rounds
    const rounds = await this.getRounds();
    const roundsDeployed = rounds
      .filter((r) => r.creatorAddress.toLowerCase() === normAddr)
      .map((r) => ({
        id: r.id,
        title: r.title,
        poolGen: r.totalPoolGen,
        status: r.status,
        deployedAt: r.createdAt,
      }));

    // Query all proposals via get_all_proposal_ids (bounded pagination)
    const rawTotalProposals = await withTimeout(
      client.readContract({
        address: contractAddress,
        functionName: 'get_all_proposal_ids_count',
        args: [],
      }),
      10000,
      'get_all_proposal_ids_count'
    );
    const totalProposalCount = validateSafeCount(rawTotalProposals, 'get_all_proposal_ids_count');
    const allProposalIds: string[] = [];
    const seenProposalIds = new Set<string>();
    const pageSize = 50;

    for (let offset = 0; offset < totalProposalCount; offset += pageSize) {
      const limit = Math.min(pageSize, totalProposalCount - offset);
      const pageIds = await withTimeout(
        client.readContract({
          address: contractAddress,
          functionName: 'get_all_proposal_ids',
          args: [offset, limit],
        }),
        10000,
        `get_all_proposal_ids(offset=${offset}, limit=${limit})`
      );

      if (!Array.isArray(pageIds)) {
        throw new Error(`Malformed response: get_all_proposal_ids at offset ${offset} did not return an array`);
      }
      if (pageIds.length !== limit) {
        throw new Error(`Incomplete page: expected ${limit} proposal IDs at offset ${offset}, received ${pageIds.length}`);
      }

      for (const pid of pageIds) {
        if (typeof pid !== 'string' || !pid.trim()) {
          throw new Error(`Malformed proposal ID in get_all_proposal_ids at offset ${offset}`);
        }
        if (seenProposalIds.has(pid)) {
          throw new Error(`Duplicate proposal ID "${pid}" in get_all_proposal_ids`);
        }
        seenProposalIds.add(pid);
        allProposalIds.push(pid);
      }
    }

    if (allProposalIds.length !== totalProposalCount) {
      throw new Error(`Incomplete proposal list: expected ${totalProposalCount} IDs, retrieved ${allProposalIds.length}`);
    }

    const claimableCredits: UserActivity['claimableCredits'] = [];
    const nominatedProposals: UserActivity['nominatedProposals'] = [];
    const votesCast: UserActivity['votesCast'] = [];

    for (const pid of allProposalIds) {
      const p = await this.getProposalById(pid);
      if (!p) {
        throw new Error(`Incomplete proposal detail: failed to load proposal "${pid}" for user activity`);
      }

      if (p.nominatorAddress.toLowerCase() === normAddr) {
        nominatedProposals.push({
          id: p.id,
          roundId: p.roundId,
          title: p.title,
          requestedGen: p.requestedGen,
          status: p.status,
          submittedAt: p.createdAt,
        });
      }

      if (p.recipientAddress.toLowerCase() === normAddr && p.status === 'APPROVED') {
        claimableCredits.push({
          id: `claim-${p.id}`,
          roundId: p.roundId,
          proposalId: p.id,
          proposalTitle: p.title,
          amountGen: p.requestedGen,
          recipientAddress: p.recipientAddress,
          status: 'CREDITED_PENDING_WITHDRAWAL',
          isCurrentUserRecipient: true,
        });
      }

      if (p.eventLog && p.eventLog.some((e) => e.voterNode?.toLowerCase() === normAddr)) {
        votesCast.push({
          id: `vote-${p.id}-${normAddr}`,
          proposalId: p.id,
          proposalTitle: p.title,
          roundId: p.roundId,
          stance: 'PARTICIPATION_RECORDED',
          timestamp: p.createdAt,
        });
      }
    }

    return {
      claimableCredits,
      nominatedProposals,
      roundsDeployed,
      votesCast,
    };
  }

  saveRoundDraft(draft: RoundDraft): void {
    localStorage.setItem('cf_round_draft_live', JSON.stringify(draft));
  }

  getRoundDraft(): RoundDraft | null {
    const raw = localStorage.getItem('cf_round_draft_live');
    return raw ? JSON.parse(raw) : null;
  }

  clearRoundDraft(): void {
    localStorage.removeItem('cf_round_draft_live');
  }

  saveProposalDraft(draft: ProposalDraft): void {
    localStorage.setItem(`cf_prp_draft_${draft.roundId}_live`, JSON.stringify(draft));
  }

  getProposalDraft(roundId: string): ProposalDraft | null {
    const raw = localStorage.getItem(`cf_prp_draft_${roundId}_live`);
    return raw ? JSON.parse(raw) : null;
  }

  clearProposalDraft(roundId: string): void {
    localStorage.removeItem(`cf_prp_draft_${roundId}_live`);
  }
}

interface DataContextType {
  isDesignPreview: boolean;
  setDesignPreview: (val: boolean) => void;
  adapter: DataAccessAdapter;
  refreshData: () => void;
  refreshKey: number;
}

const previewAdapter = new PreviewDataAccessAdapter();
const liveAdapter = new TruthfulLiveDataAccessAdapter();

const DataContext = createContext<DataContextType>({
  isDesignPreview: false,
  setDesignPreview: () => {},
  adapter: liveAdapter,
  refreshData: () => {},
  refreshKey: 0,
});

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Default to truthful empty mode (false). DESIGN PREVIEW must be an explicit user choice.
  const [isDesignPreview, setDesignPreviewState] = useState<boolean>(() => {
    const stored = localStorage.getItem('cf_design_preview');
    return stored !== null ? stored === 'true' : false;
  });
  const [refreshKey, setRefreshKey] = useState<number>(0);

  const setDesignPreview = (val: boolean) => {
    setDesignPreviewState(val);
    localStorage.setItem('cf_design_preview', String(val));
    setRefreshKey((k) => k + 1);
  };

  const refreshData = () => {
    setRefreshKey((k) => k + 1);
  };

  const adapter = isDesignPreview ? previewAdapter : liveAdapter;

  return (
    <DataContext.Provider
      value={{
        isDesignPreview,
        setDesignPreview,
        adapter,
        refreshData,
        refreshKey,
      }}
    >
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => useContext(DataContext);
