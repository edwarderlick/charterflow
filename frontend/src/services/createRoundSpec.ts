import { NETWORK_CONFIG } from '../config/network';
import { parseGenToWei } from './dataAccess';
import type { StoredRoundDraft } from './roundDraft';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
export const CHARTERFLOW_CORE_ADDRESS = NETWORK_CONFIG.contractAddress;
export const NETWORK_READBACK_UNAVAILABLE_MESSAGE =
  'Network readback unavailable; no transaction sent. Studio Next contract views are failing, so another 1 GEN was not locked. Your completed form and local draft were kept.';

export interface CreateRoundFormValues {
  title: string;
  summary: string;
  capInput: string;
  durationDaysInput: string;
  votingDaysInput: string;
  depositInput: string;
  permittedDirectives: string[];
  exclusions: string[];
  rosterInput: string;
  plannedRecipient: string;
  ratified: boolean;
}

/** Creator, nominator, and sole eligible voter for the two-signer RPC dashboard pilot. */
export const PILOT_CREATOR = '0xb3F7518df619ef485f7a1568ED3705bB6f5B0407';
/** Planned proposal recipient. On the roster, so the contract recuses this address. */
export const PILOT_RECIPIENT = '0x31e14df3b4f47F2428F3B78E7279691A78f70a05';

export interface RecipientRecusalThreshold {
  rosterSize: number;
  plannedRecipient: string;
  recipientOnRoster: boolean;
  eligibleVoters: string[];
  eligibleCount: number;
  requiredYes: number;
  formula: string;
}

/**
 * Contract vote rule: n_eligible = roster_size, minus 1 when the proposal
 * recipient is on the roster. required YES = (n_eligible * 2 + 2) // 3.
 */
export function recipientRecusalThreshold(roster: string[], plannedRecipient: string): RecipientRecusalThreshold {
  const recipient = plannedRecipient.trim();
  const recipientKey = recipient.toLowerCase();
  const rosterSize = roster.length;
  const recipientOnRoster = recipientKey.length > 0 && roster.some((addr) => addr.toLowerCase() === recipientKey);
  const eligibleVoters = recipientOnRoster ? roster.filter((addr) => addr.toLowerCase() !== recipientKey) : [...roster];
  const eligibleCount = recipient.length === 0 ? rosterSize : eligibleVoters.length;
  const requiredYes = eligibleCount > 0 ? Math.floor((eligibleCount * 2 + 2) / 3) : 0;
  let formula: string;
  if (recipient.length === 0) {
    formula = `No planned recipient yet. With no recusal, n_eligible = ${rosterSize} and required YES = (${rosterSize} * 2 + 2) // 3 = ${requiredYes}. A recipient who is on the roster is subtracted before that formula.`;
  } else if (recipientOnRoster) {
    formula = `n_eligible = ${rosterSize} - 1 = ${eligibleCount} because ${recipient} is on the roster and recused. required YES = (${eligibleCount} * 2 + 2) // 3 = ${requiredYes}. Approval is ${requiredYes}-of-${eligibleCount}.`;
  } else {
    formula = `n_eligible = ${rosterSize} because ${recipient} is not on the roster. required YES = (${eligibleCount} * 2 + 2) // 3 = ${requiredYes}. Approval is ${requiredYes}-of-${eligibleCount}.`;
  }
  return {
    rosterSize,
    plannedRecipient: recipient,
    recipientOnRoster,
    eligibleVoters,
    eligibleCount,
    requiredYes,
    formula,
  };
}

export const PILOT_SIGN_EVIDENCE_URL = 'http://127.0.0.1:8765/pilot-evidence';

export function pilotControlMessage(nowIso: string): string {
  return `CharterFlow signing-control check ${nowIso}. No transaction. No GEN is spent.`;
}

export function pilotControlReady(proved: readonly string[]): boolean {
  const set = new Set(proved.map((addr) => addr.toLowerCase()));
  return set.has(PILOT_CREATOR.toLowerCase()) && set.has(PILOT_RECIPIENT.toLowerCase());
}

export function twoSignerRpcHealthPilotForm(): CreateRoundFormValues {
  return {
    title: 'Open-Source RPC Health Dashboard',
    summary: 'Fund one open-source TypeScript dashboard that reads Studio Next RPC health and publishes the check result.',
    capInput: '0.1',
    durationDaysInput: '7',
    votingDaysInput: '3',
    depositInput: '1',
    permittedDirectives: [
      'Publish the dashboard source under an OSI-approved license with setup instructions.',
      'Read Studio Next chain 61997 RPC health without custodial keys or seed phrases.',
      'Document the public endpoints checked and the expected public output.',
    ],
    exclusions: [
      'No closed-source dashboard build or custodial key handling.',
      'No speculative token marketing, liquidity bots, or influencer promotions.',
    ],
    rosterInput: `${PILOT_CREATOR},\n${PILOT_RECIPIENT}`,
    plannedRecipient: PILOT_RECIPIENT,
    ratified: true,
  };
}

export interface ParsedRoster {
  parsed: string[];
  valid: string[];
  invalid: string[];
  duplicates: boolean;
  hasZero: boolean;
}

export function parseCommitteeRoster(rosterInput: string): ParsedRoster {
  const parsed = rosterInput
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const valid = parsed.filter((addr) => ETH_ADDRESS_RE.test(addr));
  const invalid = parsed.filter((addr) => !ETH_ADDRESS_RE.test(addr));
  const normalized = valid.map((addr) => addr.toLowerCase());
  return {
    parsed,
    valid,
    invalid,
    duplicates: new Set(normalized).size !== normalized.length,
    hasZero: normalized.includes(ZERO_ADDRESS),
  };
}

export function assembleCharterText(params: {
  title: string;
  summary: string;
  permittedDirectives: string[];
  exclusions: string[];
}): string {
  return [
    `CHARTER DIRECTIVES FOR: ${params.title.trim()}`,
    `SUMMARY: ${params.summary.trim()}`,
    'PERMITTED SCOPE:',
    ...params.permittedDirectives.map((directive, index) => `${index + 1}. ${directive}`),
    'STRICT EXCLUSIONS:',
    ...params.exclusions.map((exclusion, index) => `EXCL-${index + 1}: ${exclusion}`),
  ].join('\n\n');
}

const REVIEW_BUFFER_SECS = 86400;

export function unixSecondsToUtcIso(sec: number): string {
  return new Date(sec * 1000).toISOString();
}

export function currentBrowserOrigin(locationLike?: { origin?: string }): string {
  try {
    const origin = locationLike?.origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
    return typeof origin === 'string' ? origin : '';
  } catch {
    return '';
  }
}

export function buildCreateRoundSchedule(durationDays: number, votingDays: number, nowSec = Math.floor(Date.now() / 1000)) {
  const nominationWindowSecs = Math.max(1, durationDays) * 86400;
  const nominationCutoff = nowSec + Math.max(3600, Math.floor(nominationWindowSecs));
  const votingDuration = Math.max(3600, Math.min(1209600, Math.floor(votingDays * 86400)));
  const roundEnd = nominationCutoff + REVIEW_BUFFER_SECS + votingDuration;
  return { nowSec, nominationCutoff, votingDuration, roundEnd };
}

export interface CreateRoundValidation {
  ok: boolean;
  errors: string[];
  titleOk: boolean;
  summaryOk: boolean;
  charterOk: boolean;
  charterLength: number;
  rosterOk: boolean;
  depositOk: boolean;
  capOk: boolean;
  scheduleOk: boolean;
  ratifiedOk: boolean;
  roster: ParsedRoster;
  capWei: bigint | null;
  depositWei: bigint | null;
  durationDays: number;
  votingDays: number;
  charterText: string;
  schedule: ReturnType<typeof buildCreateRoundSchedule> | null;
}

function parsePositiveNumber(raw: string): number {
  if (raw.trim() === '') return Number.NaN;
  return Number(raw);
}

export function validateCreateRoundForm(values: CreateRoundFormValues, nowSec = Math.floor(Date.now() / 1000)): CreateRoundValidation {
  const errors: string[] = [];
  const title = values.title.trim();
  const summary = values.summary.trim();
  const titleOk = title.length >= 5 && title.length <= 120;
  const summaryOk = summary.length >= 10 && summary.length <= 2000;
  if (!titleOk) errors.push('Title must be 5–120 characters.');
  if (!summaryOk) errors.push('Description must be 10–2000 characters.');

  const charterText = assembleCharterText({
    title,
    summary,
    permittedDirectives: values.permittedDirectives,
    exclusions: values.exclusions,
  });
  const charterOk = charterText.length >= 100 && charterText.length <= 16384;
  if (!charterOk) errors.push(`Assembled charter must be 100–16384 characters (currently ${charterText.length}).`);

  const roster = parseCommitteeRoster(values.rosterInput);
  const rosterOk =
    roster.valid.length >= 2 &&
    roster.valid.length <= 50 &&
    roster.invalid.length === 0 &&
    !roster.duplicates &&
    !roster.hasZero;
  if (roster.valid.length < 2) errors.push('Committee roster needs at least 2 unique nonzero addresses.');
  if (roster.valid.length > 50) errors.push('Committee roster cannot exceed 50 addresses.');
  if (roster.invalid.length > 0) errors.push('Committee roster contains an invalid address.');
  if (roster.duplicates) errors.push('Committee roster contains duplicate addresses.');
  if (roster.hasZero) errors.push('Committee roster cannot include the zero address.');

  const plannedRecipient = values.plannedRecipient.trim();
  if (plannedRecipient.length > 0 && !ETH_ADDRESS_RE.test(plannedRecipient)) {
    errors.push('Planned proposal recipient must be a 0x address.');
  }
  if (plannedRecipient.length > 0 && plannedRecipient.toLowerCase() === ZERO_ADDRESS) {
    errors.push('Planned proposal recipient cannot be the zero address.');
  }

  const durationDays = parsePositiveNumber(values.durationDaysInput);
  const votingDays = parsePositiveNumber(values.votingDaysInput);
  let schedule: ReturnType<typeof buildCreateRoundSchedule> | null = null;
  let scheduleOk = false;
  if (!Number.isFinite(durationDays) || durationDays < 1) {
    errors.push('Nomination window must be at least 1 day.');
  } else if (!Number.isFinite(votingDays) || votingDays <= 0) {
    errors.push('Voting window must be a positive number of days.');
  } else {
    schedule = buildCreateRoundSchedule(durationDays, votingDays, nowSec);
    scheduleOk =
      schedule.nominationCutoff >= nowSec + 3600 &&
      schedule.votingDuration >= 3600 &&
      schedule.votingDuration <= 1209600 &&
      schedule.roundEnd >= schedule.nominationCutoff + 86400 + schedule.votingDuration;
    if (!scheduleOk) errors.push('Cutoff, voting duration, and round end must satisfy now+1h ≤ cutoff and cutoff+24h+voting ≤ end.');
  }

  let capWei: bigint | null = null;
  let depositWei: bigint | null = null;
  let capOk = false;
  let depositOk = false;
  try {
    if (values.depositInput.trim() === '') {
      errors.push('Initial deposit is required (minimum 1 GEN).');
    } else {
      depositWei = parseGenToWei(values.depositInput, { minWei: 10n ** 18n, context: 'Initial deposit' });
      depositOk = depositWei >= 10n ** 18n;
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : 'Initial deposit must be at least 1 GEN.');
  }
  try {
    if (values.capInput.trim() === '') {
      errors.push('Grant cap is required and must be positive.');
    } else {
      capWei = parseGenToWei(values.capInput, { context: 'Grant cap' });
      capOk = capWei > 0n && (depositWei == null || capWei <= depositWei);
      if (capWei <= 0n) errors.push('Grant cap must be positive.');
      if (depositWei != null && capWei > depositWei) errors.push('Grant cap cannot exceed the initial deposit.');
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : 'Grant cap must be a positive GEN amount.');
  }

  const ratifiedOk = values.ratified === true;
  if (!ratifiedOk) errors.push('Confirm that this calls create_round on the deployed CharterFlowCore.');

  return {
    ok: errors.length === 0,
    errors,
    titleOk,
    summaryOk,
    charterOk,
    charterLength: charterText.length,
    rosterOk,
    depositOk,
    capOk,
    scheduleOk,
    ratifiedOk,
    roster,
    capWei,
    depositWei,
    durationDays,
    votingDays,
    charterText,
    schedule,
  };
}

export function formValuesFromDraft(draft: StoredRoundDraft): CreateRoundFormValues {
  const cap = Number.isFinite(draft.capPerProposalGen) ? String(draft.capPerProposalGen) : '';
  const deposit = Number.isFinite(draft.initialDepositGen) ? String(draft.initialDepositGen) : '';
  const duration = Number.isFinite(draft.durationDays) ? String(draft.durationDays) : '';
  const voting = Number.isFinite(draft.votingWindowDays) ? String(draft.votingWindowDays) : '';
  return {
    title: draft.title || '',
    summary: draft.summary || '',
    capInput: cap,
    durationDaysInput: duration,
    votingDaysInput: voting,
    depositInput: deposit,
    permittedDirectives: draft.charterRules.map((rule) => rule.title).filter((item) => item.length > 0),
    exclusions: draft.charterExclusions.map((rule) => rule.title).filter((item) => item.length > 0),
    rosterInput: draft.rosterRaw && draft.rosterRaw.trim().length > 0 ? draft.rosterRaw : draft.committeeAddresses.join(',\n'),
    plannedRecipient: draft.plannedRecipient || '',
    ratified:
      draft.ratified === true ||
      (draft.ratified !== false && draft.committeeAddresses.length >= 2 && Number(draft.initialDepositGen) > 0),
  };
}

export function draftFromFormValues(values: CreateRoundFormValues, extra?: Partial<StoredRoundDraft>): StoredRoundDraft {
  const roster = parseCommitteeRoster(values.rosterInput);
  return {
    title: values.title,
    summary: values.summary,
    capPerProposalGen: Number(values.capInput),
    durationDays: Number(values.durationDaysInput),
    charterRules: values.permittedDirectives.map((title) => ({ title, description: title })),
    charterExclusions: values.exclusions.map((title) => ({ title, severity: 'EXCLUSION' })),
    committeeAddresses: roster.valid,
    consensusThresholdPercent: 66.67,
    votingWindowDays: Number(values.votingDaysInput),
    initialDepositGen: Number(values.depositInput),
    savedAt: new Date().toISOString(),
    rosterRaw: values.rosterInput,
    plannedRecipient: values.plannedRecipient.trim(),
    ratified: values.ratified,
    ...extra,
  };
}

export function isNetworkReadbackUnavailableError(err: unknown): boolean {
  const anyErr = err as { code?: number | string; message?: string } | null;
  const message = String(anyErr?.message || err || '');
  const code = anyErr?.code;
  return code === -32603 || code === '-32603' || /-32603/.test(message);
}
