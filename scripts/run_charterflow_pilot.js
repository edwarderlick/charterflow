const { createClient, createAccount } = require('genlayer-js');
const { studioDevnet } = require('genlayer-js/chains');
const { TransactionHashVariant } = require('genlayer-js/types');
let keytar;
try {
  keytar = require('keytar');
} catch (e) {
  keytar = null;
}
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXPECTED_SOURCE_HASH = '34ea0e374cfe68788067838cebf4ca0c226e139c713aca6e7345716b35aad5ee';
const EXPECTED_CHAIN_ID = 61997;
const EXPECTED_RPC_URL = 'https://studio-next.genlayer.com/api';
const EXPECTED_PILOT_CONTRACT_ADDRESS = '0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21';
const EXPECTED_PILOT_DEPLOYMENT_TX = '0xc5c220571c8d890c04715ce65cfd23ae92a0d49e696c596979591f771ab734e4';
const EXPECTED_CREATE_ROUND_TX = '0x1476320746c0efda5f97d2db6256c571c6da7adff7c494af33031bf9adfb0bdc';
const EXPECTED_ROUND_ID = 'rnd-pilot-354517';
const EXPECTED_CREATOR_ADDRESS = '0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066';

const studioNext = {
  ...studioDevnet,
  id: EXPECTED_CHAIN_ID,
  name: 'GenLayer Studio Next',
  rpcUrls: {
    default: { http: [EXPECTED_RPC_URL] },
  },
};

const EVIDENCE_FILE = path.resolve(
  process.env.CHARTERFLOW_EVIDENCE_FILE || path.join(__dirname, 'pilot_evidence.json')
);

/**
 * Sanitize error messages and stacks by stripping large embedded payloads
 * (such as base64 contract source or signed rollup transactions) while
 * preserving diagnostic facts (transaction hash, contract address, SQL errors, RDS host).
 */
function sanitizeErrorText(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/"contract_code":\s*"[^"]+"/g, '"contract_code": "[TRUNCATED_CONTRACT_SOURCE_PAYLOAD]"')
    .replace(/'contract_code':\s*'[^']+'/g, "'contract_code': '[TRUNCATED_CONTRACT_SOURCE_PAYLOAD]'")
    .replace(/"signed_rollup_transaction":\s*"[^"]+"/g, '"signed_rollup_transaction": "[TRUNCATED_SIGNED_ROLLUP_TX]"')
    .replace(/'signed_rollup_transaction':\s*'[^']+'/g, "'signed_rollup_transaction': '[TRUNCATED_SIGNED_ROLLUP_TX]'");
}

/**
 * Extract candidate transaction hash and contract address from error text if present.
 */
function extractCandidateParams(err) {
  const combined = `${err?.message || ''} ${err?.details || ''} ${err?.stack || ''}`;
  const hashMatch =
    combined.match(/'hash':\s*'(0x[a-fA-F0-9]{64})'/) ||
    combined.match(/"hash":\s*"(0x[a-fA-F0-9]{64})"/);
  const addrMatch =
    combined.match(/'contract_address':\s*'(0x[a-fA-F0-9]{40})'/) ||
    combined.match(/"contract_address":\s*"(0x[a-fA-F0-9]{40})"/);
  return {
    candidateTxHash: hashMatch ? hashMatch[1] : null,
    candidateContractAddress: addrMatch ? addrMatch[1] : null,
  };
}

/**
 * Gather EVERY distinct attempted deployment transaction hash from evidence.
 * Inspects latestDeploymentAttempt, lastFailure, stages.deploy, deploymentAttempt,
 * candidateRecoveryProbe, historicalProbes, preparedSupportMessage, and error text payloads.
 * Returns an array of unique lowercase 0x... hashes. Never falls back to a hardcoded hash.
 */
function gatherAttemptedDeploymentHashes(evidence) {
  const hashes = new Set();
  const txHashRegex = /^0x[a-fA-F0-9]{64}$/;

  function addHash(val) {
    if (typeof val === 'string' && txHashRegex.test(val.trim())) {
      hashes.add(val.trim().toLowerCase());
    }
  }

  if (!evidence || typeof evidence !== 'object') return [];

  // 1. Latest failure / latest deployment attempt (most recent write attempts)
  addHash(evidence.latestDeploymentAttempt?.candidateTxHash);
  addHash(evidence.latestDeploymentAttempt?.txHash);
  addHash(evidence.lastFailure?.txHash);
  addHash(evidence.lastFailure?.candidateTxHash);

  // 2. Stage deploy records and stage failures
  addHash(evidence.stages?.deploy?.txHash);
  addHash(evidence.stages?.deploy?.failure?.txHash);
  addHash(evidence.stages?.deploy?.failure?.candidateTxHash);

  // 3. Historical deployment attempts & recovery probes
  addHash(evidence.deploymentAttempt?.candidateTxHash);
  addHash(evidence.deploymentAttempt?.txHash);
  addHash(evidence.candidateRecoveryProbe?.candidateTxHash);

  if (Array.isArray(evidence.candidateRecoveryProbe?.candidateTxHashes)) {
    for (const h of evidence.candidateRecoveryProbe.candidateTxHashes) {
      addHash(h);
    }
  }

  if (Array.isArray(evidence.historicalProbes)) {
    for (const p of evidence.historicalProbes) {
      addHash(p?.candidateTxHash);
      addHash(p?.txHash);
      if (Array.isArray(p?.candidateTxHashes)) {
        for (const h of p.candidateTxHashes) addHash(h);
      }
    }
  }

  // 4. Prepared support message occurrences
  if (Array.isArray(evidence.preparedSupportMessage?.occurrences)) {
    for (const occ of evidence.preparedSupportMessage.occurrences) {
      addHash(occ?.txHash);
    }
  }

  // 5. Extract from stored error messages if present
  if (evidence.lastFailure?.errorMessage) {
    const ext = extractCandidateParams({ message: evidence.lastFailure.errorMessage });
    addHash(ext?.candidateTxHash);
  }
  if (evidence.lastFailure?.rawErrorStack) {
    const ext = extractCandidateParams({ message: evidence.lastFailure.rawErrorStack });
    addHash(ext?.candidateTxHash);
  }
  if (evidence.stages?.deploy?.failure?.errorMessage) {
    const ext = extractCandidateParams({ message: evidence.stages.deploy.failure.errorMessage });
    addHash(ext?.candidateTxHash);
  }

  return Array.from(hashes);
}

/**
 * Return the most recent attempted deployment transaction hash from evidence.
 * Prioritizes latestDeploymentAttempt, lastFailure, stage failures, then earlier attempts.
 * Returns null if no attempt has been recorded. Never falls back to a hardcoded hash.
 */
function getLatestAttemptedDeploymentHash(evidence) {
  if (!evidence || typeof evidence !== 'object') return null;
  const txHashRegex = /^0x[a-fA-F0-9]{64}$/;

  const candidates = [
    evidence.stages?.deploy?.txHash,
    evidence.latestDeploymentAttempt?.candidateTxHash,
    evidence.latestDeploymentAttempt?.txHash,
    evidence.lastFailure?.txHash,
    evidence.lastFailure?.candidateTxHash,
    evidence.stages?.deploy?.failure?.txHash,
    evidence.stages?.deploy?.failure?.candidateTxHash,
    evidence.deploymentAttempt?.candidateTxHash,
    evidence.deploymentAttempt?.txHash,
    evidence.candidateRecoveryProbe?.candidateTxHash,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && txHashRegex.test(c.trim())) {
      return c.trim().toLowerCase();
    }
  }

  // Also check if extractable from lastFailure message
  if (evidence.lastFailure?.errorMessage) {
    const ext = extractCandidateParams({ message: evidence.lastFailure.errorMessage });
    if (ext?.candidateTxHash && txHashRegex.test(ext.candidateTxHash.trim())) {
      return ext.candidateTxHash.trim().toLowerCase();
    }
  }

  // Check historical probes in reverse
  if (Array.isArray(evidence.historicalProbes) && evidence.historicalProbes.length > 0) {
    for (let i = evidence.historicalProbes.length - 1; i >= 0; i--) {
      const p = evidence.historicalProbes[i];
      if (typeof p?.candidateTxHash === 'string' && txHashRegex.test(p.candidateTxHash.trim())) {
        return p.candidateTxHash.trim().toLowerCase();
      }
    }
  }

  return null;
}

/**
 * Gather candidate contract addresses from evidence.
 * Returns unique array of 0x... addresses. Never falls back to a hardcoded address.
 */
function gatherCandidateContractAddresses(evidence) {
  const addrs = new Set();
  const addrRegex = /^0x[a-fA-F0-9]{40}$/;

  function addAddr(val) {
    if (typeof val === 'string' && addrRegex.test(val.trim())) {
      addrs.add(val.trim());
    }
  }

  if (!evidence || typeof evidence !== 'object') return [];

  addAddr(evidence.contractAddress);
  addAddr(evidence.stages?.deploy?.contractAddress);
  addAddr(evidence.stages?.deploy?.failure?.candidateContractAddress);
  addAddr(evidence.lastFailure?.candidateContractAddress);
  addAddr(evidence.latestDeploymentAttempt?.candidateContractAddress);
  addAddr(evidence.deploymentAttempt?.candidateContractAddress);
  addAddr(evidence.candidateRecoveryProbe?.candidateContractAddress);

  if (evidence.lastFailure?.errorMessage) {
    const ext = extractCandidateParams({ message: evidence.lastFailure.errorMessage });
    addAddr(ext?.candidateContractAddress);
  }

  if (Array.isArray(evidence.historicalProbes)) {
    for (const p of evidence.historicalProbes) {
      addAddr(p?.candidateContractAddress);
    }
  }
  if (Array.isArray(evidence.preparedSupportMessage?.occurrences)) {
    for (const occ of evidence.preparedSupportMessage.occurrences) {
      addAddr(occ?.contractAddress);
    }
  }

  return Array.from(addrs);
}

/**
 * Load evidence from file.
 * A corrupt or unreadable evidence file is a HARD STOP; it does NOT fallback to starting fresh.
 */
function loadEvidence(filePath = EVIDENCE_FILE) {
  if (fs.existsSync(filePath)) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (readErr) {
      console.error(`FATAL: Evidence file at ${filePath} exists but could not be read: ${readErr.message}`);
      throw new Error(`Evidence file unreadable: ${readErr.message}`);
    }

    try {
      return JSON.parse(content);
    } catch (parseErr) {
      console.error(`FATAL: Evidence file at ${filePath} exists but contains invalid or corrupted JSON: ${parseErr.message}`);
      throw new Error(`Evidence file corrupted: ${parseErr.message}`);
    }
  }

  return {
    network: { chainId: EXPECTED_CHAIN_ID, rpcUrl: EXPECTED_RPC_URL },
    source: { file: 'contracts/CharterFlowCore.py', sha256: EXPECTED_SOURCE_HASH },
    accounts: {},
    stages: {},
  };
}

/**
 * Atomic save of evidence using temporary file in same directory + renameSync.
 * Prevents partially written or corrupted evidence files during unexpected termination.
 */
function saveEvidence(evidence, filePath = EVIDENCE_FILE) {
  const resolved = path.resolve(filePath);
  const creating = !fs.existsSync(resolved);
  if (
    creating &&
    resolved === path.resolve(EVIDENCE_FILE) &&
    process.env.CHARTERFLOW_ALLOW_EVIDENCE_CREATE !== '1'
  ) {
    console.warn(`Refusing to create a new evidence checkpoint at ${resolved}.`);
    console.warn('Copy the operator-held local checkpoint or set CHARTERFLOW_EVIDENCE_FILE to an existing file. A missing file must not start or replay the funded pilot.');
    return;
  }
  const dir = path.dirname(resolved);
  const tmpFile = path.join(dir, `.${path.basename(resolved)}.tmp.${process.pid}.${Date.now()}`);
  const data = JSON.stringify(evidence, null, 2);
  fs.writeFileSync(tmpFile, data, 'utf8');
  fs.renameSync(tmpFile, resolved);
}

function requireEvidenceCheckpointForWrites(mode, filePath = EVIDENCE_FILE) {
  const writeModes = new Set(['resume', 'lifecycle-only', 'deploy-only']);
  if (!writeModes.has(mode)) return;
  if (fs.existsSync(filePath)) return;
  throw new Error(
    `FATAL: ${mode} requires an existing local evidence checkpoint at ${path.resolve(filePath)}. ` +
      'Copy the operator-held scripts/pilot_evidence.json (never commit it) or set CHARTERFLOW_EVIDENCE_FILE. ' +
      'A public checkout must not silently start or replay the funded pilot.'
  );
}

function attachPublicPilotReadFacts(evidence) {
  if (!evidence || typeof evidence !== 'object') return evidence;
  if (!evidence.stages) evidence.stages = {};
  if (!evidence.accounts) evidence.accounts = {};
  if (!evidence.contractAddress) evidence.contractAddress = EXPECTED_PILOT_CONTRACT_ADDRESS;
  if (!evidence.stages.deploy) evidence.stages.deploy = {};
  if (!evidence.stages.deploy.contractAddress) {
    evidence.stages.deploy.contractAddress = EXPECTED_PILOT_CONTRACT_ADDRESS;
  }
  if (!evidence.stages.deploy.txHash) evidence.stages.deploy.txHash = EXPECTED_PILOT_DEPLOYMENT_TX;
  if (!evidence.stages.createRound) evidence.stages.createRound = {};
  if (!evidence.stages.createRound.txHash) evidence.stages.createRound.txHash = EXPECTED_CREATE_ROUND_TX;
  if (!evidence.stages.createRound.intendedRound) {
    evidence.stages.createRound.intendedRound = {
      roundId: EXPECTED_ROUND_ID,
      creatorAddress: EXPECTED_CREATOR_ADDRESS,
    };
  }
  if (!evidence.accounts.creator) evidence.accounts.creator = { address: EXPECTED_CREATOR_ADDRESS };
  if (!evidence.accounts.creator.address) evidence.accounts.creator.address = EXPECTED_CREATOR_ADDRESS;
  return evidence;
}

const UNRESOLVED_WRITE_STATUSES = new Set(['BROADCASTING', 'OUTCOME_UNCERTAIN']);

function getDurableWriteHash(stage, intentKey = 'writeIntent', txHashField = 'txHash') {
  return stage?.[txHashField] || stage?.[intentKey]?.txHash || null;
}

function planDurableStageResume(stage, stageName, intentKey = 'writeIntent', txHashField = 'txHash') {
  const txHash = getDurableWriteHash(stage, intentKey, txHashField);
  if (txHash) return { action: 'RECONCILE_EXISTING', txHash };
  assertNoUnresolvedWrite(stage, stageName, intentKey);
  return { action: 'SUBMIT_NEW', txHash: null };
}

function assertNoUnresolvedWrite(stage, stageName, intentKey = 'writeIntent') {
  const intent = stage?.[intentKey];
  if (intent && UNRESOLVED_WRITE_STATUSES.has(intent.status) && !intent.txHash) {
    throw new Error(
      `UNRESOLVED_STAGE_WRITE: ${stageName} has a durable ${intent.status} intent without a transaction hash. ` +
      'A broadcast may have occurred; read-only nonce/transaction reconciliation is required before any resend.'
    );
  }
}

/**
 * Persist a write intent synchronously before calling the SDK. Once submit() may
 * have run, every thrown/invalid result is retained as OUTCOME_UNCERTAIN and a
 * later invocation fails closed instead of automatically sending again.
 */
async function executeDurableStageWrite({
  evidence,
  stageName,
  intentKey = 'writeIntent',
  txHashField = 'txHash',
  request,
  feeEstimate,
  senderAddress,
  senderNonce,
  submit,
  filePath = EVIDENCE_FILE,
  saveEvidenceOption = true,
}) {
  if (!evidence.stages) evidence.stages = {};
  if (!evidence.stages[stageName]) evidence.stages[stageName] = {};
  const stage = evidence.stages[stageName];
  assertNoUnresolvedWrite(stage, stageName, intentKey);

  const existingHash = getDurableWriteHash(stage, intentKey, txHashField);
  if (existingHash) {
    throw new Error(`WRITE_ALREADY_RECORDED: ${stageName} already has transaction ${existingHash}`);
  }

  const now = new Date().toISOString();
  stage[intentKey] = {
    intentId: `${stageName}-${intentKey}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
    status: 'BROADCASTING',
    createdAt: now,
    chainId: EXPECTED_CHAIN_ID,
    rpcUrl: EXPECTED_RPC_URL,
    sourceHash: EXPECTED_SOURCE_HASH,
    senderAddress,
    senderNonce: senderNonce === undefined || senderNonce === null ? null : senderNonce.toString(),
    request: sanitizeRpcEvidence(request),
    feeEstimate: sanitizeRpcEvidence(feeEstimate),
    feeValueWei: feeEstimate?.feeValue === undefined ? null : feeEstimate.feeValue.toString(),
    submitCallCount: 0,
    txHash: null,
  };
  if (saveEvidenceOption) saveEvidence(evidence, filePath);

  let submitMayHaveRun = false;
  try {
    submitMayHaveRun = true;
    stage[intentKey].submitCallCount = 1;
    const txHash = await submit();
    if (typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      throw new Error(`writeContract returned an invalid transaction hash: ${String(txHash)}`);
    }
    stage[intentKey].status = 'SUBMITTED';
    stage[intentKey].txHash = txHash;
    stage[intentKey].submittedAt = new Date().toISOString();
    stage[txHashField] = txHash;
    if (saveEvidenceOption) saveEvidence(evidence, filePath);
    return txHash;
  } catch (err) {
    if (submitMayHaveRun) {
      const extracted = extractCandidateParams(err);
      stage[intentKey].status = 'OUTCOME_UNCERTAIN';
      stage[intentKey].txHash = extracted.candidateTxHash || null;
      stage[intentKey].uncertainAt = new Date().toISOString();
      stage[intentKey].error = sanitizeErrorText(err?.message || String(err));
      if (extracted.candidateTxHash) stage[txHashField] = extracted.candidateTxHash;
      if (saveEvidenceOption) saveEvidence(evidence, filePath);
    }
    throw err;
  }
}

function markDurableStageWriteFinalized(
  evidence,
  stageName,
  tx,
  intentKey = 'writeIntent',
  filePath = EVIDENCE_FILE,
  saveEvidenceOption = true
) {
  const intent = evidence.stages?.[stageName]?.[intentKey];
  if (intent) {
    intent.status = 'FINALIZED_SUCCESS';
    intent.finalizedAt = new Date().toISOString();
    intent.statusName = tx?.statusName || null;
    intent.txExecutionResultName = tx?.txExecutionResultName || null;
  }
  if (saveEvidenceOption) saveEvidence(evidence, filePath);
}

function requireSufficientWriteBalance(balanceWei, feeEstimate, payableValueWei, label) {
  if (feeEstimate?.feeValue === undefined || feeEstimate?.feeValue === null) {
    throw new Error(`${label} fee estimate is missing feeValue`);
  }
  const feeWei = BigInt(feeEstimate.feeValue);
  const valueWei = BigInt(payableValueWei || 0n);
  const requiredWei = feeWei + valueWei;
  if (BigInt(balanceWei) < requiredWei) {
    throw new Error(
      `${label} balance ${balanceWei.toString()} wei is below payable value plus estimated fee ${requiredWei.toString()} wei ` +
      `(value=${valueWei.toString()}, fee=${feeWei.toString()})`
    );
  }
  return { balanceWei: balanceWei.toString(), valueWei: valueWei.toString(), feeWei: feeWei.toString(), requiredWei: requiredWei.toString() };
}

function requireExplicitMessageFee(feeEstimate, label) {
  const raw = feeEstimate?.distribution?.totalMessageFees;
  if (raw === undefined || raw === null) {
    throw new Error(`${label} fee estimate does not expose distribution.totalMessageFees; native message budget is unproven`);
  }
  const messageFeeWei = BigInt(raw);
  if (messageFeeWei <= 0n) {
    throw new Error(`${label} estimated distribution.totalMessageFees=${messageFeeWei.toString()}; native emit_transfer budget is not established`);
  }
  return messageFeeWei;
}

function verifyRoundAccountingInvariant(roundState, label) {
  const fields = [
    'available_wei', 'reserved_wei', 'approved_credits_wei', 'creator_claimable_wei',
    'payouts_emitted_wei', 'refunds_emitted_wei',
  ];
  for (const field of ['initial_deposit', ...fields]) {
    if (roundState?.[field] === undefined || roundState?.[field] === null) {
      throw new Error(`${label} readback is missing ${field}`);
    }
  }
  const accountedWei = fields.reduce((sum, field) => sum + BigInt(roundState[field]), 0n);
  const initialDepositWei = BigInt(roundState.initial_deposit);
  if (accountedWei !== initialDepositWei) {
    throw new Error(`${label} accounting invariant failed: accounted=${accountedWei}, initial_deposit=${initialDepositWei}`);
  }
  return { accountedWei: accountedWei.toString(), initialDepositWei: initialDepositWei.toString() };
}

function isDefinitiveContractReadNotFound(err, expectedReason) {
  const detail = `${err?.message || ''} ${err?.details || ''} ${err?.shortMessage || ''}`;
  return detail.includes(expectedReason);
}

function getTransactionSender(tx) {
  return tx?.from_address || tx?.fromAddress || tx?.from || tx?.data?.from_address || null;
}

function getTransactionValue(tx) {
  const value = tx?.value ?? tx?.data?.value;
  return value === undefined || value === null ? null : BigInt(value);
}

function getTransactionNonce(tx) {
  const nonce = tx?.nonce ?? tx?.data?.nonce;
  return nonce === undefined || nonce === null ? null : BigInt(nonce);
}

function verifyStage2GenesisReadback({ tx, stage, round, roundIdsCount, roundIds, contractBalanceWei }) {
  const intent = stage?.intendedRound;
  const expectedTxHash = getDurableWriteHash(stage);
  if (!intent || !expectedTxHash) throw new Error('Stage 2 evidence is missing its intended round or transaction hash');
  if (!tx || (tx.hash && tx.hash.toLowerCase() !== expectedTxHash.toLowerCase())) {
    throw new Error('Create-round transaction response is missing or has the wrong hash');
  }
  if (tx.statusName !== 'FINALIZED' || tx.txExecutionResultName !== 'FINISHED_WITH_RETURN') {
    throw new Error(`Create-round transaction is not finalized-success: status=${tx.statusName}, result=${tx.txExecutionResultName}`);
  }
  const sender = getTransactionSender(tx);
  const value = getTransactionValue(tx);
  const nonce = getTransactionNonce(tx);
  if (!sender || sender.toLowerCase() !== intent.creatorAddress.toLowerCase()) {
    throw new Error(`Create-round sender mismatch: ${sender || 'missing'} != ${intent.creatorAddress}`);
  }
  if (value === null || value !== BigInt(intent.depositWei)) {
    throw new Error(`Create-round payable value mismatch: ${value === null ? 'missing' : value} != ${intent.depositWei}`);
  }
  const expectedNonce = stage?.writeIntent?.senderNonce;
  if (nonce === null || expectedNonce === undefined || nonce !== BigInt(expectedNonce)) {
    throw new Error(`Create-round nonce mismatch: ${nonce === null ? 'missing' : nonce} != ${expectedNonce ?? 'missing intent nonce'}`);
  }

  verifyRoundMatchesIntent(round, intent);
  const exactFields = [
    ['round_id', intent.roundId],
    ['description', intent.description],
    ['charter_text', intent.charterText],
    ['initial_deposit', intent.depositWei],
    ['grant_cap_wei', intent.grantCapWei],
    ['nomination_cutoff', stage.writeIntent.request.args[6].toString()],
    ['voting_duration', intent.durationSec.toString()],
    ['round_end', stage.writeIntent.request.args[8].toString()],
    ['available_wei', intent.depositWei],
    ['reserved_wei', '0'],
    ['approved_credits_wei', '0'],
    ['creator_claimable_wei', '0'],
    ['payouts_emitted_wei', '0'],
    ['refunds_emitted_wei', '0'],
    ['proposal_nonce', '0'],
    ['state', 'ACTIVE'],
  ];
  for (const [field, expected] of exactFields) {
    if (round?.[field] === undefined || round[field] === null || round[field].toString() !== expected.toString()) {
      throw new Error(`Stage 2 round ${field} mismatch: ${round?.[field] ?? 'missing'} != ${expected}`);
    }
  }
  const onChainCommittee = (round.committee_roster || []).map(v => v.toLowerCase());
  const intendedCommittee = intent.committee.map(v => v.toLowerCase());
  if (onChainCommittee.length !== intendedCommittee.length ||
      intendedCommittee.some((member, i) => onChainCommittee[i] !== member)) {
    throw new Error('Stage 2 committee roster/order does not exactly match the intended roster');
  }
  const accounting = verifyRoundAccountingInvariant(round, 'Stage 2 reconciliation');
  if (BigInt(roundIdsCount) !== 1n || !Array.isArray(roundIds) || roundIds.length !== 1 || roundIds[0] !== intent.roundId) {
    throw new Error(`Round registry cross-check mismatch: count=${roundIdsCount}, ids=${JSON.stringify(roundIds)}`);
  }
  if (BigInt(contractBalanceWei) !== BigInt(intent.depositWei)) {
    throw new Error(`Contract balance mismatch: ${contractBalanceWei} != ${intent.depositWei}`);
  }
  return {
    txHash: expectedTxHash,
    sender,
    payableValueWei: value.toString(),
    nonce: nonce.toString(),
    roundId: intent.roundId,
    accounting,
    contractBalanceWei: BigInt(contractBalanceWei).toString(),
  };
}

function toUnixSeconds(value, label) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`NOMINATION_WINDOW_READ_FAILED: ${label} is missing`);
  }
  const n = typeof value === 'string' && value.startsWith('0x') ? BigInt(value) : BigInt(value);
  if (n < 0n) throw new Error(`NOMINATION_WINDOW_READ_FAILED: ${label} is negative`);
  return n;
}

/**
 * Pre-broadcast nomination guard. Zero writes. Uses chain time vs on-chain cutoff.
 * rnd-pilot-354517 is a locked recovery/refund case and must never receive a nomination.
 */
function assertNominationWindowOpen({ chainTimeSec, nominationCutoffSec, roundId }) {
  const rid = String(roundId || '');
  if (rid.toLowerCase() === EXPECTED_ROUND_ID.toLowerCase()) {
    const err = new Error(
      `RECOVERY_ROUND_NOMINATION_FORBIDDEN: ${EXPECTED_ROUND_ID} is a locked recovery/refund case. Nomination is forbidden.`
    );
    err.code = 'RECOVERY_ROUND_NOMINATION_FORBIDDEN';
    throw err;
  }
  const chainTime = toUnixSeconds(chainTimeSec, 'chainTimeSec');
  const cutoff = toUnixSeconds(nominationCutoffSec, 'nominationCutoffSec');
  if (chainTime >= cutoff) {
    const err = new Error(
      `EXPIRED_NOMINATION_WINDOW: chainTime=${chainTime} cutoff=${cutoff} round=${rid}`
    );
    err.code = 'EXPIRED_NOMINATION_WINDOW';
    throw err;
  }
  return {
    chainTimeSec: chainTime.toString(),
    nominationCutoffSec: cutoff.toString(),
    roundId: rid,
  };
}

async function readLatestChainTimeSeconds(client) {
  let block;
  if (client && typeof client.getBlock === 'function') {
    block = await client.getBlock({ blockTag: 'latest' });
  } else if (client && typeof client.request === 'function') {
    block = await client.request({ method: 'eth_getBlockByNumber', params: ['latest', false] });
  } else {
    const res = await fetch(EXPECTED_RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getBlockByNumber',
        params: ['latest', false],
      }),
    });
    const body = await res.json();
    if (body.error) {
      throw new Error(body.error.message || JSON.stringify(body.error));
    }
    block = body.result;
  }
  const ts = block?.timestamp ?? block?.result?.timestamp;
  return toUnixSeconds(ts, 'latest block timestamp');
}

async function assertNominationWindowOpenOnChain(client, contractAddress, roundId) {
  if (String(roundId || '').toLowerCase() === EXPECTED_ROUND_ID.toLowerCase()) {
    const err = new Error(
      `RECOVERY_ROUND_NOMINATION_FORBIDDEN: ${EXPECTED_ROUND_ID} is a locked recovery/refund case. Nomination is forbidden.`
    );
    err.code = 'RECOVERY_ROUND_NOMINATION_FORBIDDEN';
    throw err;
  }
  let chainTimeSec;
  try {
    chainTimeSec = await readLatestChainTimeSeconds(client);
  } catch (err) {
    throw new Error(
      `NOMINATION_WINDOW_READ_FAILED: chain time unavailable: ${sanitizeErrorText(err?.message || String(err))}`
    );
  }
  let round;
  try {
    round = await client.readContract({
      address: contractAddress,
      functionName: 'get_round',
      args: [roundId],
    });
  } catch (err) {
    throw new Error(
      `NOMINATION_WINDOW_READ_FAILED: get_round(${roundId}) failed: ${sanitizeErrorText(err?.message || String(err))}`
    );
  }
  if (!round || round.nomination_cutoff === undefined || round.nomination_cutoff === null) {
    throw new Error(`NOMINATION_WINDOW_READ_FAILED: get_round(${roundId}) missing nomination_cutoff`);
  }
  return assertNominationWindowOpen({
    chainTimeSec,
    nominationCutoffSec: round.nomination_cutoff,
    roundId,
  });
}

function sanitizeRpcEvidence(value) {
  const blockedKeys = /private.?key|mnemonic|password|secret|keystore/i;
  const visit = (item) => {
    if (typeof item === 'bigint') return item.toString();
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object') {
      const clean = {};
      for (const [key, nested] of Object.entries(item)) {
        clean[key] = blockedKeys.test(key) ? '[REDACTED]' : visit(nested);
      }
      return clean;
    }
    return item;
  };
  return visit(value);
}

function stableJson(value) {
  const normalize = (item) => {
    if (typeof item === 'bigint') return item.toString();
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.keys(item).sort().map(key => [key, normalize(item[key])])
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

function resolveDeploymentContractAddress(transactionResponse) {
  if (!transactionResponse || typeof transactionResponse !== 'object') return null;
  return transactionResponse.contractAddress ||
    transactionResponse.data?.contract_address ||
    transactionResponse.data?.contractAddress ||
    transactionResponse.to_address ||
    transactionResponse.toAddress ||
    null;
}

async function requestRawReadOnlyRpc(method, params) {
  const request = { jsonrpc: '2.0', id: Date.now(), method, params };
  try {
    const response = await fetch(EXPECTED_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    let body;
    try {
      body = await response.json();
    } catch (err) {
      body = { parseError: err.message };
    }
    return sanitizeRpcEvidence({ request, httpStatus: response.status, response: body });
  } catch (err) {
    return sanitizeRpcEvidence({ request, transportError: err.message });
  }
}

async function collectRawDeploymentReadbackDiagnostics(txHash, contractAddress) {
  const [transaction, code, schema] = await Promise.all([
    requestRawReadOnlyRpc('eth_getTransactionByHash', [txHash]),
    requestRawReadOnlyRpc('gen_getContractCode', [contractAddress]),
    requestRawReadOnlyRpc('gen_getContractSchema', [contractAddress]),
  ]);
  return {
    recordedAt: new Date().toISOString(),
    chainId: EXPECTED_CHAIN_ID,
    rpcUrl: EXPECTED_RPC_URL,
    txHash,
    candidateContractAddress: contractAddress,
    transaction,
    code,
    schema,
  };
}

async function readDeployedContractCode(client, address) {
  if (typeof client?.getContractCode === 'function') {
    return client.getContractCode(address);
  }
  if (typeof client?.getCode === 'function') {
    return client.getCode({ address });
  }
  throw new Error('Client does not expose getContractCode or getCode');
}

function hashDeploymentSourceFromTransaction(transactionResponse) {
  const encodedSource = transactionResponse?.data?.contract_code ||
    transactionResponse?.data?.contractCode ||
    null;
  if (typeof encodedSource !== 'string' || encodedSource.length === 0) {
    throw new Error('Deployment transaction readback is missing data.contract_code');
  }

  let sourceBytes;
  try {
    sourceBytes = Buffer.from(encodedSource, 'base64');
  } catch (err) {
    throw new Error(`Deployment transaction contract_code is not valid base64: ${err.message}`);
  }
  if (sourceBytes.length === 0 || sourceBytes.toString('base64').replace(/=+$/, '') !== encodedSource.replace(/=+$/, '')) {
    throw new Error('Deployment transaction contract_code is not canonical base64 source bytes');
  }
  return crypto.createHash('sha256').update(sourceBytes).digest('hex');
}

function archiveHistoricalDeploymentEvidence(evidence) {
  if (!evidence) return;
  const records = [];
  if (evidence.stages?.deploy && Object.keys(evidence.stages.deploy).length > 0) {
    records.push({ kind: 'stage-deploy', record: evidence.stages.deploy });
  }
  if (evidence.latestDeploymentAttempt && Object.keys(evidence.latestDeploymentAttempt).length > 0) {
    records.push({ kind: 'latest-attempt', record: evidence.latestDeploymentAttempt });
  }
  if (records.length === 0) return;
  if (!Array.isArray(evidence.historicalDeploymentRecords)) {
    evidence.historicalDeploymentRecords = [];
  }
  for (const entry of records) {
    const fingerprint = stableJson(entry);
    const exists = evidence.historicalDeploymentRecords.some(
      prior => stableJson({ kind: prior.kind, record: prior.record }) === fingerprint
    );
    if (!exists) {
      evidence.historicalDeploymentRecords.push({
        ...sanitizeRpcEvidence(entry),
        archivedAt: new Date().toISOString(),
      });
    }
  }
}

async function verifyAndRecordDeploymentReadback({
  client,
  evidence,
  txHash,
  contractAddress,
  sourceCode,
  expectedSourceHash = EXPECTED_SOURCE_HASH,
  saveEvidenceOption = true,
}) {
  const verifiedAt = new Date().toISOString();
  const transactionResponse = await client.getTransaction({ hash: txHash });
  if (transactionResponse.statusName !== 'FINALIZED') {
    throw new Error(`Deployment readback status is ${transactionResponse.statusName}, expected FINALIZED`);
  }
  if (transactionResponse.txExecutionResultName !== 'FINISHED_WITH_RETURN') {
    throw new Error(
      `Deployment readback execution result is ${transactionResponse.txExecutionResultName}, expected FINISHED_WITH_RETURN`
    );
  }
  const readbackContractAddress = resolveDeploymentContractAddress(transactionResponse);
  if (!readbackContractAddress || readbackContractAddress.toLowerCase() !== contractAddress.toLowerCase()) {
    throw new Error(
      `Deployment readback contract address mismatch: ${readbackContractAddress || 'missing'} != ${contractAddress}`
    );
  }
  const transactionSourceSha256 = hashDeploymentSourceFromTransaction(transactionResponse);
  const suppliedSourceSha256 = crypto.createHash('sha256').update(sourceCode).digest('hex');
  if (transactionSourceSha256 !== expectedSourceHash || suppliedSourceSha256 !== expectedSourceHash) {
    throw new Error(
      `Deployment source mismatch: transaction=${transactionSourceSha256}, local=${suppliedSourceSha256}, expected=${expectedSourceHash}`
    );
  }

  const codeResponse = await readDeployedContractCode(client, contractAddress);
  if (!codeResponse || codeResponse === '0x' || codeResponse === '0x0') {
    throw new Error(`Deployment readback returned empty code for ${contractAddress}`);
  }

  const deployedSchemaResponse = await client.getContractSchema(contractAddress);
  const sourceSchemaResponse = await client.getContractSchemaForCode(sourceCode);
  const deployedSchemaCanonical = stableJson(deployedSchemaResponse);
  const sourceSchemaCanonical = stableJson(sourceSchemaResponse);
  if (deployedSchemaCanonical !== sourceSchemaCanonical) {
    throw new Error('Deployed contract schema does not match schema extracted from the exact candidate source bytes');
  }

  const readback = {
    verifiedAt,
    chainId: EXPECTED_CHAIN_ID,
    rpcUrl: EXPECTED_RPC_URL,
    sourceHash: expectedSourceHash,
    transactionSourceSha256,
    txHash,
    contractAddress,
    transactionResponse: sanitizeRpcEvidence(transactionResponse),
    codeResponse: sanitizeRpcEvidence(codeResponse),
    codeResponseSha256: crypto.createHash('sha256').update(
      typeof codeResponse === 'string' ? codeResponse : stableJson(codeResponse)
    ).digest('hex'),
    deployedSchemaResponse: sanitizeRpcEvidence(deployedSchemaResponse),
    sourceSchemaResponse: sanitizeRpcEvidence(sourceSchemaResponse),
    schemaCanonicalSha256: crypto.createHash('sha256').update(deployedSchemaCanonical).digest('hex'),
    schemaMatchesExactSource: true,
  };

  if (!evidence.stages) evidence.stages = {};
  if (!evidence.stages.deploy) evidence.stages.deploy = {};
  evidence.stages.deploy.readback = readback;
  evidence.stages.deploy.readbackVerified = true;
  evidence.stages.deploy.readbackVerifiedAt = verifiedAt;
  evidence.latestDeploymentAttempt = {
    ...evidence.latestDeploymentAttempt,
    status: 'FINALIZED_SUCCESS_READBACK_VERIFIED',
    readbackVerifiedAt: verifiedAt,
  };
  if (saveEvidenceOption !== false) saveEvidence(evidence);
  return readback;
}

async function runStage2ReadOnlyReconciliation(client, evidence, options = {}) {
  const maxAttempts = Math.max(1, Math.min(Number(options.maxAttempts || 3), 3));
  const intervalMs = Math.max(0, Math.min(Number(options.intervalMs || 2000), 10000));
  const stage = evidence.stages?.createRound;
  const contractAddress = evidence.stages?.deploy?.contractAddress || evidence.contractAddress;
  const txHash = getDurableWriteHash(stage);
  const roundId = stage?.intendedRound?.roundId;
  if (!stage || !contractAddress || !txHash || !roundId) {
    throw new Error('Stage 2 reconciliation requires recorded deployment, create-round intent, and create-round transaction hash');
  }
  if (contractAddress.toLowerCase() !== EXPECTED_PILOT_CONTRACT_ADDRESS.toLowerCase()) {
    throw new Error(`Stage 2 reconciliation contract mismatch: ${contractAddress}`);
  }
  if (!Array.isArray(evidence.stage2ReconciliationHistory)) evidence.stage2ReconciliationHistory = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const observedAt = new Date().toISOString();
    const observation = {
      observedAt,
      mode: 'READ_ONLY',
      attempt,
      maxAttempts,
      chainId: EXPECTED_CHAIN_ID,
      rpcUrl: EXPECTED_RPC_URL,
      contractAddress,
      txHash,
      roundId,
      status: 'STARTED',
      writeCalls: 0,
    };
    try {
      const tx = await client.getTransaction({ hash: txHash });
      observation.transactionResponse = sanitizeRpcEvidence(tx);
      const round = await client.readContract({
        address: contractAddress,
        functionName: 'get_round',
        args: [roundId],
      });
      observation.roundResponse = sanitizeRpcEvidence(round);
      const roundIdsCount = await client.readContract({
        address: contractAddress,
        functionName: 'get_round_ids_count',
        args: [],
      });
      observation.roundIdsCount = roundIdsCount.toString();
      const roundIds = await client.readContract({
        address: contractAddress,
        functionName: 'get_round_ids',
        args: [0n, 50n],
      });
      observation.roundIds = sanitizeRpcEvidence(roundIds);
      const contractBalance = await client.getBalance({ address: contractAddress });
      observation.contractBalanceWei = contractBalance.toString();

      const verification = verifyStage2GenesisReadback({
        tx,
        stage,
        round,
        roundIdsCount,
        roundIds,
        contractBalanceWei: contractBalance,
      });
      observation.status = 'VERIFIED';
      observation.verification = verification;
      evidence.stage2ReconciliationHistory.push(observation);
      if (!Array.isArray(stage.readbackHistory)) stage.readbackHistory = [];
      if (stage.writeIntent?.readbackStatus || stage.writeIntent?.readbackError) {
        const prior = {
          status: stage.writeIntent.status,
          readbackStatus: stage.writeIntent.readbackStatus || null,
          readbackError: stage.writeIntent.readbackError || null,
          recordedBefore: observedAt,
        };
        if (!stage.readbackHistory.some(item => stableJson(item) === stableJson(prior))) {
          stage.readbackHistory.push(prior);
        }
      }
      if (!Array.isArray(stage.readbackVerifications)) stage.readbackVerifications = [];
      stage.readbackVerifications.push(observation);
      stage.roundState = sanitizeRpcEvidence(round);
      stage.contractBalanceWei = contractBalance.toString();
      stage.accountingInvariant = verification.accounting;
      stage.writeIntent.status = 'FINALIZED_SUCCESS_READBACK_VERIFIED';
      stage.writeIntent.readbackStatus = 'VERIFIED';
      stage.writeIntent.readbackVerifiedAt = observedAt;
      saveEvidence(evidence, options.filePath || EVIDENCE_FILE);
      return observation;
    } catch (err) {
      observation.status = 'INCONCLUSIVE_OR_MISMATCH';
      observation.error = sanitizeErrorText(err?.message || String(err));
      observation.errorDetails = sanitizeErrorText(err?.details || null);
      evidence.stage2ReconciliationHistory.push(observation);
      saveEvidence(evidence, options.filePath || EVIDENCE_FILE);
      const combined = `${err?.message || ''} ${err?.details || ''}`;
      if (/(-32603|rollback|database|malformed|mismatch|unexpected)/i.test(combined) || attempt === maxAttempts) {
        throw err;
      }
    }
    if (attempt < maxAttempts && intervalMs > 0) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
  throw new Error('Stage 2 reconciliation exhausted its bounded attempts without verification');
}

const STAGE2_FORBIDDEN_RPC_METHODS = new Set([
  'eth_sendRawTransaction',
  'eth_sendTransaction',
  'eth_sendUnsignedTransaction',
  'personal_sendTransaction',
  'sim_call',
  'sim_fundAccount',
]);
const STAGE2_FORBIDDEN_CLIENT_METHODS = [
  'writeContract',
  'deployContract',
  'sendRawTransaction',
  'sendTransaction',
  'transfer',
  'fundAccount',
  'simulateWriteContract',
];
const STAGE2_SUPPORT_DRAFT_PATH = path.resolve(__dirname, '../docs/GENLAYER_SUPPORT_DRAFT.md');

function isWriteGenCallRpc(method, params) {
  if (String(method || '') !== 'gen_call') return false;
  const body = Array.isArray(params) ? params[0] : params;
  return !!(body && typeof body === 'object' && String(body.type || '').toLowerCase() === 'write');
}

function truncateDiagnosticText(text, max = 400) {
  if (text == null) return null;
  const value = sanitizeErrorText(String(text));
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…[truncated]`;
}

function conciseDiagnosticScalar(value, depth = 0) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return truncateDiagnosticText(value, 180);
  if (depth >= 3) return '[omitted-nested]';
  if (Array.isArray(value)) {
    if (value.length > 8) return `[array:${value.length}]`;
    return value.map(item => conciseDiagnosticScalar(item, depth + 1));
  }
  if (typeof value === 'object') return '[object]';
  return String(value);
}

function sanitizeDiagnosticRpcParams(method, params) {
  const list = Array.isArray(params) ? params : params == null ? [] : [params];
  return list.map(item => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const out = {};
      for (const [key, nested] of Object.entries(item)) {
        if (/^(data|input|calldata|contract_code|code|signed|raw|source|receipt)$/i.test(key)) {
          out[key] = '[OMITTED]';
        } else if (/private.?key|mnemonic|password|secret|keystore/i.test(key)) {
          out[key] = '[REDACTED]';
        } else {
          out[key] = conciseDiagnosticScalar(nested, 1);
        }
      }
      return out;
    }
    return conciseDiagnosticScalar(item, 1);
  });
}

function extractRpcErrorMeta(err) {
  const combined = `${err?.shortMessage || ''} ${err?.message || ''} ${err?.details || ''} ${err?.cause?.message || ''} ${err?.cause?.details || ''}`;
  const codeFromText = combined.match(/JSON-RPC(?: error)?:?\s*(-?\d+)/i) || combined.match(/"code"\s*:\s*(-?\d+)/);
  const jsonRpcCode = (
    err?.code ??
    err?.cause?.code ??
    err?.error?.code ??
    err?.data?.code ??
    (codeFromText ? Number(codeFromText[1]) : null)
  );
  const httpStatus = (
    err?.status ??
    err?.statusCode ??
    err?.cause?.status ??
    err?.cause?.statusCode ??
    err?.response?.status ??
    null
  );
  const candidates = [
    err?.details,
    err?.cause?.details,
    err?.data?.message,
    err?.error?.message,
    err?.cause?.message,
    err?.message,
    err?.shortMessage,
  ].filter(value => typeof value === 'string' && value.trim());
  const generic = /internal error was received/i;
  const message = candidates.find(value => !generic.test(value)) || candidates[0] || String(err);
  return {
    jsonRpcCode: jsonRpcCode === undefined ? null : jsonRpcCode,
    httpStatus: httpStatus === undefined ? null : httpStatus,
    message: truncateDiagnosticText(message, 400),
  };
}

function conciseTransactionRead(tx) {
  if (!tx || typeof tx !== 'object') return tx == null ? null : String(tx);
  const nonce = getTransactionNonce(tx);
  const value = getTransactionValue(tx);
  return {
    hash: tx.hash || null,
    statusName: tx.statusName || tx.status || null,
    txExecutionResultName: tx.txExecutionResultName || tx.result || null,
    sender: getTransactionSender(tx),
    nonce: nonce === null ? null : nonce.toString(),
    valueWei: value === null ? null : value.toString(),
  };
}

function conciseRoundRead(round) {
  if (!round || typeof round !== 'object') return round == null ? null : String(round);
  return {
    round_id: round.round_id ?? null,
    creator: round.creator ?? null,
    title: round.title ?? null,
    state: round.state ?? null,
    initial_deposit: round.initial_deposit == null ? null : String(round.initial_deposit),
    grant_cap_wei: round.grant_cap_wei == null ? null : String(round.grant_cap_wei),
    available_wei: round.available_wei == null ? null : String(round.available_wei),
    reserved_wei: round.reserved_wei == null ? null : String(round.reserved_wei),
    approved_credits_wei: round.approved_credits_wei == null ? null : String(round.approved_credits_wei),
    creator_claimable_wei: round.creator_claimable_wei == null ? null : String(round.creator_claimable_wei),
    payouts_emitted_wei: round.payouts_emitted_wei == null ? null : String(round.payouts_emitted_wei),
    refunds_emitted_wei: round.refunds_emitted_wei == null ? null : String(round.refunds_emitted_wei),
    proposal_nonce: round.proposal_nonce == null ? null : String(round.proposal_nonce),
    committee_len: Array.isArray(round.committee_roster) ? round.committee_roster.length : null,
  };
}

function conciseDiagnosticValue(label, value) {
  if (label === 'transaction') return conciseTransactionRead(value);
  if (label === 'get_round') return conciseRoundRead(value);
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(item => (typeof item === 'bigint' ? item.toString() : item));
  if (value && typeof value === 'object') return conciseDiagnosticScalar(value, 0);
  return value == null ? null : String(value);
}

function installStage2ReadOnlyCapture(client) {
  const rpcCaptures = [];
  const writeAttempts = [];

  const originalRequest = typeof client.request === 'function' ? client.request.bind(client) : null;
  if (originalRequest) {
    client.request = async (args) => {
      const method = args?.method;
      const params = args?.params;
      const timestamp = new Date().toISOString();
      if (STAGE2_FORBIDDEN_RPC_METHODS.has(String(method || '')) || isWriteGenCallRpc(method, params)) {
        writeAttempts.push({ method: String(method), timestamp });
        throw new Error(`Stage 2 diagnostic refused write RPC method: ${method}`);
      }
      const sanitizedParams = sanitizeDiagnosticRpcParams(method, params);
      try {
        const result = await originalRequest(args);
        rpcCaptures.push({
          method,
          sanitizedParams,
          timestamp,
          ok: true,
          httpStatus: 200,
          jsonRpcCode: null,
          conciseResponse: method === 'eth_getTransactionByHash'
            ? conciseTransactionRead(result)
            : conciseDiagnosticScalar(result, 0),
        });
        return result;
      } catch (err) {
        const meta = extractRpcErrorMeta(err);
        rpcCaptures.push({
          method,
          sanitizedParams,
          timestamp,
          ok: false,
          httpStatus: meta.httpStatus,
          jsonRpcCode: meta.jsonRpcCode,
          conciseResponse: meta.message,
        });
        throw err;
      }
    };
  }

  for (const name of STAGE2_FORBIDDEN_CLIENT_METHODS) {
    const original = typeof client[name] === 'function' ? client[name].bind(client) : null;
    client[name] = async () => {
      writeAttempts.push({ method: name, timestamp: new Date().toISOString() });
      if (original) {
        // Refuse without invoking the original write implementation.
      }
      throw new Error(`Stage 2 diagnostic refused client write method: ${name}`);
    };
  }

  return { rpcCaptures, writeAttempts };
}

function classifyStage2DiagnosticFailure(callsByLabel) {
  const ok = (label) => callsByLabel[label]?.ok === true;
  const attempted = (label) => Object.prototype.hasOwnProperty.call(callsByLabel, label);
  const txOk = ok('transaction');
  const roundOk = ok('get_round');
  const countOk = ok('get_round_ids_count');
  const idsOk = ok('get_round_ids');
  const balanceOk = ok('contract_balance');
  const latestOk = ok('creator_latest_nonce');
  const pendingOk = ok('creator_pending_nonce');
  const extraAttempted = attempted('get_all_proposal_ids_count');
  const extraOk = extraAttempted ? ok('get_all_proposal_ids_count') : null;

  const requiredComplete = txOk && roundOk && countOk && idsOk && balanceOk;
  const viewResults = [roundOk, countOk, idsOk];
  if (extraAttempted) viewResults.push(extraOk);
  const anyViewOk = viewResults.some(Boolean);
  const allViewsFailed = viewResults.length > 0 && viewResults.every(value => value === false);
  const chainOk = txOk && balanceOk && latestOk && pendingOk;

  if (requiredComplete) {
    return {
      class: 'REQUIRED_READS_COMPLETE',
      summary: 'All required Stage 2 reads succeeded and may be passed to the exact verifier.',
    };
  }
  if (!roundOk && anyViewOk && (txOk || balanceOk)) {
    return {
      class: 'get_round_specific',
      summary: 'get_round failed while at least one other contract view succeeded; failure is not a general gen_call outage.',
    };
  }
  if (!roundOk && allViewsFailed && chainOk) {
    return {
      class: 'all_contract_views',
      summary: 'Contract gen_call views failed while transaction, balance, and nonce endpoints responded.',
    };
  }
  if (!txOk || !balanceOk || !latestOk || !pendingOk) {
    return {
      class: 'broader_rpc',
      summary: 'Failure reached transaction, balance, or nonce endpoints in addition to or instead of contract views.',
    };
  }
  return {
    class: 'partial_or_mixed',
    summary: 'Required Stage 2 reads were incomplete; results are diagnostic only.',
  };
}

function renderStage2SupportDraft({ observedAt, diagnosis, calls, attempted, blocked, previousObservedAt, transactionHashVariant }) {
  const callLines = calls.map(call => {
    const rpc = (call.rpcCalls && call.rpcCalls[0]) || {};
    return [
      `- **${call.label}** @ ${call.timestamp}`,
      `  - SDK: \`${call.sdkMethod}\``,
      `  - RPC method: \`${rpc.method || call.rpcMethodHint || 'n/a'}\``,
      `  - Sanitized params: \`${JSON.stringify(call.sanitizedParams || rpc.sanitizedParams || {})}\``,
      `  - HTTP status: \`${rpc.httpStatus ?? call.httpStatus ?? 'n/a'}\``,
      `  - JSON-RPC code: \`${rpc.jsonRpcCode ?? call.jsonRpcCode ?? 'none'}\``,
      `  - Result: ${call.ok ? 'ok' : 'failed'} — ${truncateDiagnosticText(JSON.stringify(call.conciseResponse), 280)}`,
    ].join('\n');
  }).join('\n');

  return `# DRAFT — GenLayer Studio Next Stage 2 readback error

**Status:** Draft only; not sent  
**Latest observation:** ${observedAt}  
**Read variant this pass:** \`${transactionHashVariant || 'unspecified'}\`  
**Previous preserved observation:** ${previousObservedAt || '2026-10-14T02:17:57.367Z'}  
**Network:** Studio Next, chain ID \`61997\`

Hello GenLayer support,

CharterFlow remains blocked on independently reproducible Studio Next reads after a finalized contract call:

- Contract: \`0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21\`
- Deployed source SHA-256: \`34ea0e374cfe68788067838cebf4ca0c226e139c713aca6e7345716b35aad5ee\`
- \`create_round\` transaction: \`0x1476320746c0efda5f97d2db6256c571c6da7adff7c494af33031bf9adfb0bdc\`
- Intended round ID: \`rnd-pilot-354517\`

## Latest diagnostic (one bounded read-only pass)

Failure class: **${diagnosis.class}**

${diagnosis.summary}

Stage 2 verdict: **INCONCLUSIVE**. A partial set of successful reads is not Stage 2 verification.

### Cross-checks attempted
${attempted.map(item => `- ${item}`).join('\n')}

### Cross-checks blocked
${blocked.length ? blocked.map(item => `- ${item}`).join('\n') : '- None of the planned read groups were skipped; a failed get_round did not abort later reads.'}

### Per-call capture (no keys, signed txs, source payloads, or full receipts)
${callLines}

## Prior observation (preserved)

Observed ${previousObservedAt || '2026-10-14T02:17:57.367Z'}: the create-round transaction was \`FINALIZED\` / \`FINISHED_WITH_RETURN\`, then an immediate \`get_round\` via Studio Next \`gen_call\` failed with JSON-RPC \`-32603\`:

> Can't reconnect until invalid transaction is rolled back. Please rollback() fully before proceeding.

A later independent diagnostic at 2026-10-14T06:20:21.083Z used the SDK default \`transactionHashVariant = latest-nonfinal\` (\`TransactionHashVariant.LATEST_NONFINAL\`). All four contract views (\`get_round\`, \`get_round_ids_count\`, \`get_round_ids\`, extra \`get_all_proposal_ids_count\`) failed with JSON-RPC \`-32603\` rollback, while \`eth_getTransactionByHash\`, \`eth_getBalance\`, and \`eth_getTransactionCount\` succeeded. That classified the default path as an all-contract-view / \`gen_call\` latest-nonfinal failure.

This draft's latest observation is a separate one-pass diagnostic that requests \`TransactionHashVariant.LATEST_FINAL\` (\`latest-final\`) on the same contract views. Do not treat both variants as a general \`gen_call\` outage unless this latest-final pass also failed those views.

This is distinct from older, preserved deployment attempts for a historical \`dd04779...\` source, which failed during writes with PostgreSQL \`DiskFull\`. The present deployment is verified; the current issue is Studio Next readback after the finalized Stage 2 transaction.

Could you please investigate the Studio Next database/session state behind \`gen_call\` for this contract and transaction? No private key, signed transaction, full source payload, or unrelated account data is included here.
`;
}

function updateGenLayerSupportDraft(payload) {
  fs.writeFileSync(STAGE2_SUPPORT_DRAFT_PATH, renderStage2SupportDraft(payload), 'utf8');
}

async function diagnoseStage2StudioReads(client, evidence, options = {}) {
  const stage = evidence.stages?.createRound;
  const contractAddress = evidence.stages?.deploy?.contractAddress || evidence.contractAddress;
  const txHash = getDurableWriteHash(stage);
  const roundId = stage?.intendedRound?.roundId;
  const creatorAddress = (
    stage?.intendedRound?.creatorAddress ||
    stage?.writeIntent?.senderAddress ||
    evidence.accounts?.creator?.address
  );
  if (!stage || !contractAddress || !txHash || !roundId) {
    throw new Error('Stage 2 diagnostic requires recorded deployment, create-round intent, and create-round transaction hash');
  }
  if (contractAddress.toLowerCase() !== EXPECTED_PILOT_CONTRACT_ADDRESS.toLowerCase()) {
    throw new Error(`Stage 2 diagnostic contract mismatch: ${contractAddress}`);
  }

  if (!Array.isArray(evidence.stage2ReconciliationHistory)) evidence.stage2ReconciliationHistory = [];
  const previousObservedAt = evidence.stage2ReconciliationHistory[0]?.observedAt || null;
  const transactionHashVariant = options.transactionHashVariant || TransactionHashVariant.LATEST_NONFINAL;
  const includeExtraView = options.includeExtraView === true;
  const capture = installStage2ReadOnlyCapture(client);
  const observedAt = new Date().toISOString();
  const calls = [];
  const callsByLabel = {};

  async function independentCall(label, sdkMethod, rpcMethodHint, sanitizedParams, fn) {
    const timestamp = new Date().toISOString();
    const rpcBefore = capture.rpcCaptures.length;
    const entry = {
      label,
      sdkMethod,
      rpcMethodHint,
      sanitizedParams,
      timestamp,
      ok: false,
      httpStatus: null,
      jsonRpcCode: null,
      conciseResponse: null,
      rpcCalls: [],
    };
    try {
      const value = await fn();
      entry.ok = true;
      entry.value = value;
      entry.conciseResponse = conciseDiagnosticValue(label, value);
      entry.rpcCalls = capture.rpcCaptures.slice(rpcBefore);
      if (entry.rpcCalls[0]) {
        entry.httpStatus = entry.rpcCalls[0].httpStatus;
        entry.jsonRpcCode = entry.rpcCalls[0].jsonRpcCode;
      }
    } catch (err) {
      const meta = extractRpcErrorMeta(err);
      entry.ok = false;
      entry.value = null;
      entry.httpStatus = meta.httpStatus;
      entry.jsonRpcCode = meta.jsonRpcCode;
      entry.conciseResponse = meta.message;
      entry.rpcCalls = capture.rpcCaptures.slice(rpcBefore);
      if (entry.rpcCalls[0]) {
        if (entry.httpStatus == null) entry.httpStatus = entry.rpcCalls[0].httpStatus;
        if (entry.jsonRpcCode == null) entry.jsonRpcCode = entry.rpcCalls[0].jsonRpcCode;
      }
    }
    if (!entry.rpcCalls.length) {
      entry.rpcCalls = [{
        method: rpcMethodHint,
        sanitizedParams,
        timestamp,
        ok: entry.ok,
        httpStatus: entry.httpStatus,
        jsonRpcCode: entry.jsonRpcCode,
        conciseResponse: entry.conciseResponse,
      }];
    }
    calls.push(entry);
    callsByLabel[label] = entry;
    const rpc = entry.rpcCalls[0] || {};
    console.log(
      `[STAGE2-DIAG] ${label} sdk=${sdkMethod} rpc=${rpc.method || rpcMethodHint} ` +
      `ts=${entry.timestamp} http=${entry.httpStatus ?? 'n/a'} code=${entry.jsonRpcCode ?? 'none'} ` +
      `ok=${entry.ok} params=${JSON.stringify(sanitizedParams)} ` +
      `response=${truncateDiagnosticText(JSON.stringify(entry.conciseResponse), 220)}`
    );
    return entry;
  }

  await independentCall(
    'transaction',
    'getTransaction',
    'eth_getTransactionByHash',
    { hash: txHash },
    () => client.getTransaction({ hash: txHash })
  );
  await independentCall(
    'get_round',
    'readContract',
    'gen_call',
    { type: 'read', to: contractAddress, functionName: 'get_round', args: [roundId], transactionHashVariant, transaction_hash_variant: transactionHashVariant },
    () => client.readContract({
      address: contractAddress,
      functionName: 'get_round',
      args: [roundId],
      transactionHashVariant,
    })
  );
  await independentCall(
    'get_round_ids_count',
    'readContract',
    'gen_call',
    { type: 'read', to: contractAddress, functionName: 'get_round_ids_count', args: [], transactionHashVariant, transaction_hash_variant: transactionHashVariant },
    () => client.readContract({
      address: contractAddress,
      functionName: 'get_round_ids_count',
      args: [],
      transactionHashVariant,
    })
  );
  await independentCall(
    'get_round_ids',
    'readContract',
    'gen_call',
    { type: 'read', to: contractAddress, functionName: 'get_round_ids', args: ['0', '50'], transactionHashVariant, transaction_hash_variant: transactionHashVariant },
    () => client.readContract({
      address: contractAddress,
      functionName: 'get_round_ids',
      args: [0n, 50n],
      transactionHashVariant,
    })
  );
  await independentCall(
    'contract_balance',
    'getBalance',
    'eth_getBalance',
    { address: contractAddress },
    () => client.getBalance({ address: contractAddress })
  );
  await independentCall(
    'creator_latest_nonce',
    'getTransactionCount',
    'eth_getTransactionCount',
    { address: creatorAddress, blockTag: 'latest' },
    () => client.getTransactionCount({ address: creatorAddress, blockTag: 'latest' })
  );
  await independentCall(
    'creator_pending_nonce',
    'getTransactionCount',
    'eth_getTransactionCount',
    { address: creatorAddress, blockTag: 'pending' },
    () => client.getTransactionCount({ address: creatorAddress, blockTag: 'pending' })
  );

  const registryViewsFailed = !callsByLabel.get_round_ids_count?.ok && !callsByLabel.get_round_ids?.ok;
  if (includeExtraView || (!callsByLabel.get_round?.ok && registryViewsFailed)) {
    await independentCall(
      'get_all_proposal_ids_count',
      'readContract',
      'gen_call',
      { type: 'read', to: contractAddress, functionName: 'get_all_proposal_ids_count', args: [], transactionHashVariant, transaction_hash_variant: transactionHashVariant },
      () => client.readContract({
        address: contractAddress,
        functionName: 'get_all_proposal_ids_count',
        args: [],
        transactionHashVariant,
      })
    );
  }

  const diagnosis = classifyStage2DiagnosticFailure(callsByLabel);
  const requiredComplete = diagnosis.class === 'REQUIRED_READS_COMPLETE';
  const attempted = [
    `Transaction status/result/sender/nonce/value via SDK getTransaction (${txHash})`,
    `Contract view get_round(${roundId}) via SDK readContract → gen_call type=read, transactionHashVariant=${transactionHashVariant}`,
    `Contract views get_round_ids_count and get_round_ids(0,50) via separate gen_call reads with transactionHashVariant=${transactionHashVariant}`,
    `Contract eth_getBalance and creator eth_getTransactionCount latest/pending (${creatorAddress})`,
  ];
  const blocked = [];
  if (callsByLabel.get_all_proposal_ids_count) {
    attempted.push('Extra harmless view get_all_proposal_ids_count to distinguish a general gen_call failure from get_round-specific failure');
  } else if (!callsByLabel.get_round?.ok) {
    attempted.push('Extra view get_all_proposal_ids_count was not required because another contract view already responded');
  } else {
    attempted.push('Extra view get_all_proposal_ids_count skipped because get_round succeeded');
  }

  const persistableCalls = calls.map(call => ({
    label: call.label,
    sdkMethod: call.sdkMethod,
    rpcMethod: call.rpcCalls?.[0]?.method || call.rpcMethodHint,
    sanitizedParams: call.sanitizedParams,
    timestamp: call.timestamp,
    ok: call.ok,
    httpStatus: call.httpStatus,
    jsonRpcCode: call.jsonRpcCode,
    conciseResponse: call.conciseResponse,
  }));

  const observation = {
    observedAt,
    mode: 'READ_ONLY_DIAGNOSTIC',
    attempt: 1,
    maxAttempts: 1,
    chainId: EXPECTED_CHAIN_ID,
    rpcUrl: EXPECTED_RPC_URL,
    contractAddress,
    txHash,
    roundId,
    transactionHashVariant,
    writeCalls: capture.writeAttempts.length,
    writeAttempts: capture.writeAttempts,
    failureClass: diagnosis.class,
    diagnosisSummary: diagnosis.summary,
    calls: persistableCalls,
    status: 'INCONCLUSIVE',
    verdict: 'INCONCLUSIVE',
  };

  if (requiredComplete) {
    try {
      const verification = verifyStage2GenesisReadback({
        tx: callsByLabel.transaction.value,
        stage,
        round: callsByLabel.get_round.value,
        roundIdsCount: callsByLabel.get_round_ids_count.value,
        roundIds: callsByLabel.get_round_ids.value,
        contractBalanceWei: callsByLabel.contract_balance.value,
      });
      observation.status = 'VERIFIED';
      observation.verdict = 'VERIFIED';
      observation.failureClass = null;
      observation.verification = {
        txHash: verification.txHash,
        sender: verification.sender,
        payableValueWei: verification.payableValueWei,
        nonce: verification.nonce,
        roundId: verification.roundId,
        accounting: verification.accounting,
        contractBalanceWei: verification.contractBalanceWei,
      };
      if (!Array.isArray(stage.readbackHistory)) stage.readbackHistory = [];
      if (stage.writeIntent?.readbackStatus || stage.writeIntent?.readbackError) {
        const prior = {
          status: stage.writeIntent.status,
          readbackStatus: stage.writeIntent.readbackStatus || null,
          readbackError: stage.writeIntent.readbackError || null,
          recordedBefore: observedAt,
        };
        if (!stage.readbackHistory.some(item => stableJson(item) === stableJson(prior))) {
          stage.readbackHistory.push(prior);
        }
      }
      if (!Array.isArray(stage.readbackVerifications)) stage.readbackVerifications = [];
      stage.readbackVerifications.push({
        observedAt,
        status: 'VERIFIED',
        verification: observation.verification,
      });
      stage.roundState = sanitizeRpcEvidence(conciseRoundRead(callsByLabel.get_round.value));
      stage.contractBalanceWei = verification.contractBalanceWei;
      stage.accountingInvariant = verification.accounting;
      stage.writeIntent.status = 'FINALIZED_SUCCESS_READBACK_VERIFIED';
      stage.writeIntent.readbackStatus = 'VERIFIED';
      stage.writeIntent.readbackVerifiedAt = observedAt;
    } catch (err) {
      observation.status = 'INCONCLUSIVE_OR_MISMATCH';
      observation.verdict = 'INCONCLUSIVE';
      observation.failureClass = 'verifier_mismatch';
      observation.error = truncateDiagnosticText(err?.message || String(err));
      blocked.push(`Exact Stage 2 verifier rejected complete reads: ${observation.error}`);
    }
  } else {
    observation.status = 'INCONCLUSIVE';
    observation.verdict = 'INCONCLUSIVE';
    blocked.push('Exact Stage 2 verifier was not run because the required read set was incomplete');
    if (!callsByLabel.get_round?.ok) {
      blocked.push('Complete round parameters, genesis ledger, and accounting equation could not be checked');
    }
    if (!callsByLabel.get_round_ids_count?.ok || !callsByLabel.get_round_ids?.ok) {
      blocked.push('Round registry count/ids could not be fully cross-checked');
    }
    if (!callsByLabel.contract_balance?.ok) {
      blocked.push('Contract balance could not be cross-checked');
    }
    if (!callsByLabel.transaction?.ok) {
      blocked.push('Create-round transaction status, sender, nonce, and 1 GEN value could not be re-read');
    }
  }

  observation.crossChecksAttempted = attempted;
  observation.crossChecksBlocked = blocked;
  evidence.stage2ReconciliationHistory.push(observation);
  evidence.stage2LatestDiagnostic = {
    observedAt,
    verdict: observation.verdict,
    failureClass: observation.failureClass,
    transactionHashVariant,
    writeCalls: observation.writeCalls,
    calls: persistableCalls,
    crossChecksAttempted: attempted,
    crossChecksBlocked: blocked,
  };

  if (options.saveEvidence !== false) {
    saveEvidence(evidence, options.filePath || EVIDENCE_FILE);
  }
  if (observation.verdict !== 'VERIFIED' && options.updateSupportDraft !== false) {
    updateGenLayerSupportDraft({
      observedAt,
      diagnosis: { class: observation.failureClass, summary: diagnosis.summary },
      calls: persistableCalls.map((call, index) => ({ ...call, rpcCalls: calls[index].rpcCalls })),
      attempted,
      blocked,
      previousObservedAt,
      transactionHashVariant,
    });
  }
  return observation;
}

/**
 * Record a stage failure into evidence, set process.exitCode = 1, and save atomically.
 */
function recordFailure(evidence, stage, err, txHash = null, extraDetails = {}) {
  console.error(`\n[STAGE FAILED: ${stage}]`);
  console.error(err);

  const rawMsg = err?.message || String(err);
  const rawDetails = err?.details || null;
  const rawStack = err?.stack ? err.stack.split('\n').slice(0, 15).join('\n') : null;
  const candidate = extractCandidateParams(err);

  const errorEntry = {
    failedAt: new Date().toISOString(),
    stage,
    sourceHash: EXPECTED_SOURCE_HASH,
    hasTxHash: !!(txHash || candidate.candidateTxHash),
    txHash: txHash || candidate.candidateTxHash || null,
    candidateContractAddress: candidate.candidateContractAddress || null,
    errorMessage: sanitizeErrorText(rawMsg),
    errorDetails: sanitizeErrorText(rawDetails),
    errorCode: err?.code || null,
    shortMessage: err?.shortMessage || null,
    rawErrorStack: sanitizeErrorText(rawStack),
    ...extraDetails,
  };

  evidence.lastFailure = errorEntry;
  if (!evidence.stages) {
    evidence.stages = {};
  }
  if (!evidence.stages[stage]) {
    evidence.stages[stage] = {};
  }
  evidence.stages[stage].failure = errorEntry;
  saveEvidence(evidence);

  process.exitCode = 1;
}

/**
 * Load an account from OS keychain.
 */
async function getAccount(name) {
  if (!keytar) throw new Error(`keytar module is not available in environment for loading account:${name}`);
  const pk = await keytar.getPassword('genlayer-cli', `account:${name}`);
  if (!pk) throw new Error(`Missing keychain key for ${name}`);
  return createAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
}

/**
 * Verify that a transaction has FINALIZED status AND FINISHED_WITH_RETURN execution result.
 * If not finalized, polls until finalized.
 * If statusName is not FINALIZED or txExecutionResultName is not FINISHED_WITH_RETURN,
 * throws an Error with the real result. Never treats non-success as completed.
 */
async function verifyTxFinalizedAndSuccessful(client, txHash, stageName) {
  console.log(`Inspecting transaction for ${stageName}: ${txHash}...`);
  let tx = null;
  try {
    tx = await client.getTransaction({ hash: txHash });
  } catch (e) {
    console.log(`Initial getTransaction query: ${e.message}. Polling waitForFinalization...`);
  }

  if (!tx || tx.statusName !== 'FINALIZED') {
    console.log(`Waiting for finalization of ${txHash}...`);
    await client.waitForFinalization({ hash: txHash });
    tx = await client.getTransaction({ hash: txHash });
  }

  console.log(`  Tx Finalized: Status = ${tx.statusName} (${tx.status}), Result = ${tx.txExecutionResultName}`);

  if (tx.statusName !== 'FINALIZED') {
    throw new Error(`Stage ${stageName} transaction ${txHash} did not finalize: status=${tx.statusName}`);
  }
  if (tx.txExecutionResultName !== 'FINISHED_WITH_RETURN') {
    throw new Error(
      `Stage ${stageName} transaction ${txHash} failed execution: status=${tx.statusName}, result=${tx.txExecutionResultName}`
    );
  }

  return tx;
}

/**
 * Validate that an on-chain round object matches the exact persisted intent.
 */
function verifyRoundMatchesIntent(round, intent) {
  if (!round) throw new Error(`Round ${intent.roundId} not found on chain.`);
  if (round.title !== intent.title) {
    throw new Error(`Round title mismatch: on-chain "${round.title}" !== intended "${intent.title}"`);
  }
  if (round.creator.toLowerCase() !== intent.creatorAddress.toLowerCase()) {
    throw new Error(`Round creator mismatch: on-chain "${round.creator}" !== intended "${intent.creatorAddress}"`);
  }
  if (round.grant_cap_wei.toString() !== intent.grantCapWei.toString()) {
    throw new Error(`Round grant cap mismatch: on-chain "${round.grant_cap_wei}" !== intended "${intent.grantCapWei}"`);
  }
  const committeeList = round.committee_roster || round.committee || [];
  const onChainCommittee = committeeList.map(a => a.toLowerCase());
  const intentCommittee = (intent.committee || []).map(a => a.toLowerCase());
  for (const member of intentCommittee) {
    if (!onChainCommittee.includes(member)) {
      throw new Error(`Round committee missing intended member ${member}`);
    }
  }
}

/**
 * Validate that an on-chain proposal object matches the exact persisted intent.
 * Requires the contract's actual requested_amount_wei field to exist and match explicitly.
 * Does NOT use a requested_credit_wei fallback.
 */
function verifyProposalMatchesIntent(prop, intent, expectedProposalId = null) {
  if (!prop || typeof prop !== 'object') {
    throw new Error('Proposal not found on chain or invalid proposal object.');
  }
  if (!prop.proposal_id || typeof prop.proposal_id !== 'string') {
    throw new Error('Proposal proposal_id field is missing from on-chain proposal object');
  }
  if (expectedProposalId && prop.proposal_id !== expectedProposalId) {
    throw new Error(`Proposal ID mismatch: "${prop.proposal_id}" !== "${expectedProposalId}"`);
  }
  if (!prop.round_id || prop.round_id !== intent.roundId) {
    throw new Error(`Proposal round_id mismatch: "${prop.round_id}" !== "${intent.roundId}"`);
  }
  if (!prop.recipient || prop.recipient.toLowerCase() !== (intent.recipient || '').toLowerCase()) {
    throw new Error(`Proposal recipient mismatch: "${prop.recipient}" !== "${intent.recipient}"`);
  }
  if (!prop.title || prop.title !== intent.title) {
    throw new Error(`Proposal title mismatch: "${prop.title}" !== "${intent.title}"`);
  }
  if (prop.requested_amount_wei === undefined || prop.requested_amount_wei === null) {
    throw new Error('Proposal requested_amount_wei field is missing from on-chain proposal object');
  }
  const expectedAmount = (intent.requestedAmountWei || intent.requestedCreditWei || '').toString();
  if (prop.requested_amount_wei.toString() !== expectedAmount) {
    throw new Error(`Proposal requested amount mismatch: "${prop.requested_amount_wei}" !== "${expectedAmount}"`);
  }
  // Require on-chain prop.proposer explicitly (never accept invented on-chain names like nominator)
  if (!prop.proposer || typeof prop.proposer !== 'string') {
    throw new Error('Proposal proposer field is missing from on-chain proposal object');
  }
  const expectedProposer = ((intent.proposer || intent.nominator) || '').toLowerCase();
  if (prop.proposer.toLowerCase() !== expectedProposer) {
    throw new Error(`Proposal proposer mismatch: "${prop.proposer}" !== "${expectedProposer}"`);
  }
  // Deliverables text MUST exist on on-chain proposal and match intent
  if (prop.deliverables_text === undefined || prop.deliverables_text === null) {
    throw new Error('Proposal deliverables_text field is missing from on-chain proposal object');
  }
  const expectedDeliverables = intent.deliverablesText || intent.deliverables_text;
  if (!expectedDeliverables || typeof expectedDeliverables !== 'string') {
    throw new Error('Intended deliverablesText is missing or invalid in intent');
  }
  if (prop.deliverables_text !== expectedDeliverables) {
    throw new Error('Proposal deliverables_text mismatch');
  }
}

/**
 * Paginated retrieval of ALL proposal summaries for a round.
 * Queries get_round_proposals_count first, then pages in chunks of 50 (MAX_PAGE_LIMIT).
 */
async function fetchAllRoundProposalSummaries(client, contractAddress, roundId) {
  let countBig;
  try {
    countBig = await client.readContract({
      address: contractAddress,
      functionName: 'get_round_proposals_count',
      args: [roundId],
    });
  } catch (err) {
    throw new Error(`INCONCLUSIVE_PAGINATION: get_round_proposals_count RPC failed for round ${roundId}: ${sanitizeErrorText(err.message)}`);
  }

  if (typeof countBig !== 'bigint' && typeof countBig !== 'number') {
    throw new Error(`INCONCLUSIVE_PAGINATION: Invalid proposals count type (${typeof countBig}) for round ${roundId}`);
  }
  const total = Number(countBig);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error(`INCONCLUSIVE_PAGINATION: Invalid integer proposals count (${total}) for round ${roundId}`);
  }
  if (total === 0) return [];

  const allSummaries = [];
  const seenIds = new Set();
  const pageSize = 50n;

  for (let offset = 0n; offset < BigInt(total); offset += pageSize) {
    let page;
    try {
      page = await client.readContract({
        address: contractAddress,
        functionName: 'get_round_proposals_summary',
        args: [roundId, offset, pageSize],
      });
    } catch (err) {
      throw new Error(`INCONCLUSIVE_PAGINATION: get_round_proposals_summary RPC failed at offset ${offset} for round ${roundId}: ${sanitizeErrorText(err.message)}`);
    }

    if (!Array.isArray(page)) {
      throw new Error(`INCONCLUSIVE_PAGINATION: Page at offset ${offset} for round ${roundId} is not an array: ${typeof page}`);
    }

    const expectedPageLength = Math.min(Number(pageSize), total - Number(offset));
    if (page.length !== expectedPageLength) {
      throw new Error(`INCONCLUSIVE_PAGINATION: Inconsistent page length at offset ${offset} for round ${roundId}. Expected ${expectedPageLength}, got ${page.length}`);
    }

    for (const item of page) {
      if (!item || typeof item !== 'object' || !item.proposal_id) {
        throw new Error(`INCONCLUSIVE_PAGINATION: Malformed proposal summary item at offset ${offset} for round ${roundId}`);
      }
      if (seenIds.has(item.proposal_id)) {
        throw new Error(`INCONCLUSIVE_PAGINATION: Duplicate proposal_id "${item.proposal_id}" encountered in round ${roundId} pagination`);
      }
      seenIds.add(item.proposal_id);
      allSummaries.push(item);
    }
  }

  if (allSummaries.length !== total) {
    throw new Error(`INCONCLUSIVE_PAGINATION: Total fetched proposal summaries count (${allSummaries.length}) does not match expected total (${total}) for round ${roundId}`);
  }

  return allSummaries;
}

/**
 * Check whether a full on-chain proposal object matches the intended proposal across ALL critical fields.
 * Fails closed if any identity field is missing or undefined.
 */
function matchesFullProposalIntent(prop, intent, expectedProposalId = null) {
  if (!prop || typeof prop !== 'object') return false;
  if (!prop.proposal_id || typeof prop.proposal_id !== 'string') return false;
  if (expectedProposalId && prop.proposal_id !== expectedProposalId) return false;
  if (!prop.round_id || prop.round_id !== intent.roundId) return false;
  if (!prop.recipient || prop.recipient.toLowerCase() !== (intent.recipient || '').toLowerCase()) return false;
  if (!prop.title || prop.title !== intent.title) return false;
  if (prop.requested_amount_wei === undefined || prop.requested_amount_wei === null) return false;
  const expectedAmount = (intent.requestedAmountWei || intent.requestedCreditWei || '').toString();
  if (prop.requested_amount_wei.toString() !== expectedAmount) return false;
  if (!prop.proposer || typeof prop.proposer !== 'string') return false;
  const expectedProposer = ((intent.proposer || intent.nominator) || '').toLowerCase();
  if (prop.proposer.toLowerCase() !== expectedProposer) return false;
  if (prop.deliverables_text === undefined || prop.deliverables_text === null) return false;
  const expectedDeliverables = intent.deliverablesText || intent.deliverables_text;
  if (!expectedDeliverables || typeof expectedDeliverables !== 'string') return false;
  if (prop.deliverables_text !== expectedDeliverables) return false;
  return true;
}

/**
 * Correlate the proposal ID created by a nomination transaction.
 * Uses before/after ID set comparison, full on-chain field verification, and halts on ambiguity.
 */
/**
 * Correlate the proposal ID created by a nomination transaction.
 * Uses verified return value if available, or pre-broadcast snapshot diff. Halts on ambiguity.
 */
async function correlateNominatedProposalId({
  client,
  contractAddress,
  roundId,
  intendedProposal,
  idsBeforeSet,
  nominateTxHash,
  txReceipt = null,
}) {
  // 1. Derive proposal ID directly from finalized transaction return value if verified
  let derivedId = null;
  // Use ONLY a documented/observed return-value field (e.g. txReceipt?.verifiedReturnValue).
  // Do NOT guess from generic data, output, or result fields.
  if (typeof txReceipt?.verifiedReturnValue === 'string' && (txReceipt.verifiedReturnValue.startsWith(`prp-${roundId}-`) || txReceipt.verifiedReturnValue.startsWith('prp-'))) {
    derivedId = txReceipt.verifiedReturnValue;
  }

  if (derivedId) {
    console.log(`Derived proposal ID directly from transaction return: ${derivedId}`);
    const fullProp = await client.readContract({
      address: contractAddress,
      functionName: 'get_proposal',
      args: [derivedId],
    });
    verifyProposalMatchesIntent(fullProp, intendedProposal, derivedId);
    return derivedId;
  }

  // 2. Otherwise, require that a pre-broadcast ID snapshot was provided
  if (!idsBeforeSet || !(idsBeforeSet instanceof Set)) {
    throw new Error(
      `INCONCLUSIVE_NOMINATION_ATTRIBUTION: No verified return value and no pre-broadcast ID snapshot for tx ${nominateTxHash}. Halting with txHash preserved.`
    );
  }

  const summariesAfter = await fetchAllRoundProposalSummaries(client, contractAddress, roundId);
  const idsAfter = summariesAfter.map(s => s.proposal_id);
  const newIds = idsAfter.filter(id => !idsBeforeSet.has(id));

  console.log(`Correlating nomination transaction ${nominateTxHash}:`);
  console.log(`  Proposals before submission: ${idsBeforeSet.size}`);
  console.log(`  Proposals after finalization: ${idsAfter.length}`);
  console.log(`  New candidate IDs detected: [${newIds.join(', ')}]`);

  if (newIds.length === 0) {
    throw new Error(
      `INCONCLUSIVE_NOMINATION_ATTRIBUTION: Nomination transaction ${nominateTxHash} finalized, but no new proposal ID was created in round ${roundId}. Preserving txHash.`
    );
  }

  // Fetch full proposal details for all new IDs and verify all fields
  const matchingCandidates = [];
  for (const cid of newIds) {
    const fullProp = await client.readContract({
      address: contractAddress,
      functionName: 'get_proposal',
      args: [cid],
    });
    if (matchesFullProposalIntent(fullProp, intendedProposal, cid)) {
      matchingCandidates.push({ id: cid, proposal: fullProp });
    }
  }

  if (matchingCandidates.length === 1) {
    const matched = matchingCandidates[0];
    verifyProposalMatchesIntent(matched.proposal, intendedProposal, matched.id);
    return matched.id;
  }

  if (matchingCandidates.length > 1) {
    const candidateList = matchingCandidates.map(c => c.id).join(', ');
    throw new Error(
      `AMBIGUOUS_PROPOSAL_ATTRIBUTION: Multiple new proposals ([${candidateList}]) match intent for tx ${nominateTxHash}. Halting to prevent misattribution.`
    );
  }

  throw new Error(
    `INCONCLUSIVE_NOMINATION_ATTRIBUTION: No newly created proposal matched the intended parameters for tx ${nominateTxHash}. Candidate IDs checked: [${newIds.join(', ')}]. Preserving txHash.`
  );
}

/**
 * Correlate proposal ID during a RESUME scenario.
 * Strictly verifies transaction attribution. Never adopts an existing proposal merely because content matches.
 */
async function correlateResumeProposalId({
  client,
  contractAddress,
  roundId,
  intendedProposal,
  savedProposalId = null,
  nominateTxHash = null,
  preBroadcastSnapshot = null,
  txReceipt = null,
}) {
  // If there is no saved nomination txHash, never adopt an existing proposal
  if (!nominateTxHash) {
    throw new Error(
      `DISALLOWED_NO_HASH_RESUME: Cannot resume proposal attribution without a saved nomination txHash. Existing proposals will not be adopted based on content alone.`
    );
  }

  // If an exact proposalId was already saved and bound, verify it directly on chain
  if (savedProposalId) {
    const prop = await client.readContract({
      address: contractAddress,
      functionName: 'get_proposal',
      args: [savedProposalId],
    });
    verifyProposalMatchesIntent(prop, intendedProposal, savedProposalId);
    return savedProposalId;
  }

  // Check if txReceipt has a verified return value
  if (typeof txReceipt?.verifiedReturnValue === 'string' && (txReceipt.verifiedReturnValue.startsWith(`prp-${roundId}-`) || txReceipt.verifiedReturnValue.startsWith('prp-'))) {
    const derivedId = txReceipt.verifiedReturnValue;
    const prop = await client.readContract({
      address: contractAddress,
      functionName: 'get_proposal',
      args: [derivedId],
    });
    verifyProposalMatchesIntent(prop, intendedProposal, derivedId);
    return derivedId;
  }

  // If a persisted pre-broadcast snapshot is present, verify unique delta
  if (Array.isArray(preBroadcastSnapshot)) {
    const idsBeforeSet = new Set(preBroadcastSnapshot);
    const summariesAfter = await fetchAllRoundProposalSummaries(client, contractAddress, roundId);
    const idsAfter = summariesAfter.map(s => s.proposal_id);
    const newIds = idsAfter.filter(id => !idsBeforeSet.has(id));

    if (newIds.length === 1) {
      const candidateId = newIds[0];
      const prop = await client.readContract({
        address: contractAddress,
        functionName: 'get_proposal',
        args: [candidateId],
      });
      if (matchesFullProposalIntent(prop, intendedProposal, candidateId)) {
        verifyProposalMatchesIntent(prop, intendedProposal, candidateId);
        return candidateId;
      }
    }
  }

  // If proof is absent (no verified return value, no persisted snapshot, or snapshot does not yield exactly 1 unique matching new ID):
  // Halt as INCONCLUSIVE with txHash preserved. Do NOT scan all proposals and adopt the only matching one!
  throw new Error(
    `INCONCLUSIVE_RESUME_ATTRIBUTION: Nomination transaction ${nominateTxHash} lacks a verified return value or persisted pre-broadcast snapshot proving a unique new proposal ID. Cannot safely attribute proposal. Preserving txHash.`
  );
}

/**
 * Execute a negative withdrawal test (unauthorized caller or duplicate claim)
 * with strict rejection reason checking and complete ledger/proposal invariance assertions.
 * Returns: { outcome: 'PASS' | 'INCONCLUSIVE' | 'FAIL', reason, reasonMatched, ledgerUnchanged, txHash }
 */
async function executeNegativeWithdrawalTest({
  client,
  readClient,
  contractAddress,
  proposalId,
  roundId,
  expectedErrorReason,
  testName,
  evidence = null,
  stageName = null,
  senderAddress = null,
}) {
  console.log(`\n--- RUNNING NEGATIVE TEST: ${testName} ---`);
  console.log(`Expected contract rejection reason: ${expectedErrorReason}`);

  // 1. Snapshot state BEFORE negative test call
  const pBefore = await readClient.readContract({
    address: contractAddress,
    functionName: 'get_proposal',
    args: [proposalId],
  });
  const rBefore = await readClient.readContract({
    address: contractAddress,
    functionName: 'get_round',
    args: [roundId],
  });
  const contractBalBefore = await readClient.getBalance({ address: contractAddress });

  let rejectionObserved = false;
  let reasonMatched = false;
  let rejectionDetail = '';
  let txHash = null;
  let unrelatedFailureReason = null;

  try {
    let fees = null;
    try {
      fees = await client.estimateTransactionFees({
        address: contractAddress,
        functionName: 'withdraw_credit',
        args: [proposalId],
        leaderOnly: false,
      });
    } catch (estErr) {
      const estMsg = `${estErr?.message || ''} ${estErr?.details || ''} ${estErr?.shortMessage || ''}`;
      if (estMsg.includes(expectedErrorReason)) {
        rejectionObserved = true;
        reasonMatched = true;
        rejectionDetail = `Fee estimation rejected with expected reason: ${expectedErrorReason}`;
      } else {
        rejectionObserved = true;
        unrelatedFailureReason = `Fee estimation failed with unrelated error: ${sanitizeErrorText(estMsg).slice(0, 250)}`;
      }
    }

    if (!rejectionObserved && !unrelatedFailureReason) {
      const negativeEvidence = evidence || { stages: {} };
      const durableStageName = stageName || 'negativeWithdrawal';
      const senderNonce = senderAddress && typeof client.getTransactionCount === 'function'
        ? await client.getTransactionCount({ address: senderAddress, blockTag: 'pending' })
        : null;
      txHash = await executeDurableStageWrite({
        evidence: negativeEvidence,
        stageName: durableStageName,
        request: { address: contractAddress, functionName: 'withdraw_credit', args: [proposalId] },
        feeEstimate: fees,
        senderAddress,
        senderNonce,
        saveEvidenceOption: Boolean(evidence),
        submit: () => client.writeContract({
          address: contractAddress,
          functionName: 'withdraw_credit',
          args: [proposalId],
          fees,
        }),
      });
      console.log(`Negative test tx submitted: ${txHash}. Waiting for finalization...`);

      let tx = null;
      try {
        await client.waitForFinalization({ hash: txHash });
        tx = await client.getTransaction({ hash: txHash });
      } catch (waitErr) {
        unrelatedFailureReason = `Transaction finalization wait failed: ${waitErr.message}`;
      }

      if (tx) {
        if (tx.txExecutionResultName === 'FINISHED_WITH_RETURN') {
          return {
            outcome: 'FAIL',
            reason: `Transaction unexpectedly succeeded with FINISHED_WITH_RETURN!`,
            reasonMatched: false,
            ledgerUnchanged: false,
            txHash,
          };
        } else {
          rejectionObserved = true;
          // Search for expectedErrorReason across all receipt, error, trace, and consensus fields
          const txFullDetail = `${tx.txExecutionResultName || ''} ${JSON.stringify(tx.consensusData || {})} ${JSON.stringify(tx.data || {})} ${JSON.stringify(tx.error || {})} ${JSON.stringify(tx.receipt || {})} ${JSON.stringify(tx.messages || [])}`;
          if (txFullDetail.includes(expectedErrorReason)) {
            reasonMatched = true;
            rejectionDetail = `Execution rejected with expected error: ${expectedErrorReason} (${tx.txExecutionResultName})`;
            const intent = negativeEvidence.stages?.[durableStageName]?.writeIntent;
            if (intent) {
              intent.status = 'FINALIZED_EXPECTED_REJECTION';
              intent.finalizedAt = new Date().toISOString();
              intent.txExecutionResultName = tx.txExecutionResultName;
              if (evidence) saveEvidence(evidence);
            }
          } else {
            // A generic REVERT or FAILED without the exact expected reason visible MUST NOT count as proof.
            // Mark unrelated failure and keep txHash for investigation.
            unrelatedFailureReason = `Transaction rejected with result "${tx.txExecutionResultName}", but exact expected reason "${expectedErrorReason}" was not found in receipt/consensusData/error: ${sanitizeErrorText(txFullDetail).slice(0, 200)}`;
          }
        }
      }
    }
  } catch (callErr) {
    const errMsg = `${callErr?.message || ''} ${callErr?.details || ''} ${callErr?.shortMessage || ''}`;
    const unresolved = evidence && stageName &&
      UNRESOLVED_WRITE_STATUSES.has(evidence.stages?.[stageName]?.writeIntent?.status) &&
      !evidence.stages?.[stageName]?.writeIntent?.txHash;
    if (unresolved) {
      rejectionObserved = true;
      unrelatedFailureReason = `Write outcome is uncertain despite the surfaced error; durable intent blocks resend: ${sanitizeErrorText(errMsg).slice(0, 250)}`;
    } else if (errMsg.includes(expectedErrorReason)) {
      rejectionObserved = true;
      reasonMatched = true;
      rejectionDetail = `Call rejected with expected reason: ${expectedErrorReason}`;
    } else {
      rejectionObserved = true;
      unrelatedFailureReason = `Call failed with unrelated error: ${sanitizeErrorText(errMsg).slice(0, 250)}`;
    }
  }

  // 2. Snapshot state AFTER call and assert strict complete ledger/proposal invariance
  let pAfter = null;
  let rAfter = null;
  let contractBalAfter = null;
  try {
    pAfter = await readClient.readContract({
      address: contractAddress,
      functionName: 'get_proposal',
      args: [proposalId],
    });
    rAfter = await readClient.readContract({
      address: contractAddress,
      functionName: 'get_round',
      args: [roundId],
    });
    contractBalAfter = await readClient.getBalance({ address: contractAddress });
  } catch (readErr) {
    return {
      outcome: 'INCONCLUSIVE',
      reason: `Could not read post-test contract state: ${readErr.message}`,
      reasonMatched,
      ledgerUnchanged: false,
      txHash,
    };
  }

  // Compare the complete money-related round ledger before and after the rejected call:
  // available, reserved, approved credits, creator claimable, payouts emitted, refunds emitted,
  // plus relevant proposal fields (credit_withdrawn, state, requested amount, recipient) and contract balance.
  const toStr = v => (v !== undefined && v !== null ? v.toString() : '0');

  if (pBefore.requested_amount_wei === undefined || pBefore.requested_amount_wei === null ||
      pAfter.requested_amount_wei === undefined || pAfter.requested_amount_wei === null) {
    return {
      outcome: 'FAIL',
      reason: 'Proposal requested_amount_wei field is missing in ledger verification',
      reasonMatched,
      ledgerUnchanged: false,
      details: { pBefore, pAfter }
    };
  }

  const ledgerUnchanged =
    pBefore.credit_withdrawn === pAfter.credit_withdrawn &&
    pBefore.state === pAfter.state &&
    toStr(pBefore.requested_amount_wei) === toStr(pAfter.requested_amount_wei) &&
    pBefore.recipient === pAfter.recipient &&
    toStr(rBefore.available_wei) === toStr(rAfter.available_wei) &&
    toStr(rBefore.reserved_wei) === toStr(rAfter.reserved_wei) &&
    toStr(rBefore.approved_credits_wei) === toStr(rAfter.approved_credits_wei) &&
    toStr(rBefore.creator_claimable_wei) === toStr(rAfter.creator_claimable_wei) &&
    toStr(rBefore.payouts_emitted_wei) === toStr(rAfter.payouts_emitted_wei) &&
    toStr(rBefore.refunds_emitted_wei) === toStr(rAfter.refunds_emitted_wei) &&
    toStr(contractBalBefore) === toStr(contractBalAfter);

  if (!ledgerUnchanged) {
    return {
      outcome: 'FAIL',
      reason: 'Ledger, round, or proposal state was mutated during negative test!',
      reasonMatched,
      ledgerUnchanged: false,
      txHash,
    };
  }

  if (unrelatedFailureReason) {
    return {
      outcome: 'INCONCLUSIVE',
      reason: unrelatedFailureReason,
      reasonMatched: false,
      ledgerUnchanged: true,
      txHash,
    };
  }

  if (rejectionObserved && reasonMatched && ledgerUnchanged) {
    return {
      outcome: 'PASS',
      reason: rejectionDetail,
      reasonMatched: true,
      ledgerUnchanged: true,
      txHash,
    };
  }

  return {
    outcome: 'INCONCLUSIVE',
    reason: `Inconclusive negative test: rejectionObserved=${rejectionObserved}, reasonMatched=${reasonMatched}, ledgerUnchanged=${ledgerUnchanged}`,
    reasonMatched,
    ledgerUnchanged,
    txHash,
  };
}

/**
 * Check candidate deployment state and node health before attempting any write transaction.
 * - Gathers and queries EVERY distinct candidate transaction lookup.
 * - Checks candidate contract address code (must be empty/0x).
 * - Freshly checks creator latest and pending nonces.
 * - Sends gen_getContractCode matching SDK chain.isStudio convention: params: [candidateAddress] for Studio, [{ address }] for non-Studio.
 * - Treats every unexpected JSON-RPC error, malformed response, non-2xx HTTP status,
 *   or database error as a failed/inconclusive health check that blocks deployment.
 * - An expected -32001 "contract not found" is logged precisely; it does not by itself prove deployment writes succeed.
 * - Never infers that an RPC error means "not found".
 */
async function checkCandidateDeploymentSafety(
  client,
  candidateTxHash,
  candidateAddress,
  creatorAddress = null,
  probeFn = null
) {
  // Support calling convention: checkCandidateDeploymentSafety(client, txHash, addr, probeFn)
  if (typeof creatorAddress === 'function') {
    probeFn = creatorAddress;
    creatorAddress = null;
  }

  // Normalize and deduplicate candidate hashes (supports array of hashes or single hash)
  const rawHashes = Array.isArray(candidateTxHash)
    ? candidateTxHash.filter(h => typeof h === 'string' && h.trim() !== '').map(h => h.trim().toLowerCase())
    : (candidateTxHash && typeof candidateTxHash === 'string' ? [candidateTxHash.trim().toLowerCase()] : []);
  const hashes = Array.from(new Set(rawHashes));

  // Normalize candidate addresses (supports array or single string)
  const addrsToCheck = Array.isArray(candidateAddress)
    ? candidateAddress.filter(a => typeof a === 'string' && a.trim() !== '').map(a => a.trim())
    : (candidateAddress && typeof candidateAddress === 'string' ? [candidateAddress.trim()] : []);
  const primaryAddress = addrsToCheck[0] || '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290';

  console.log('Checking candidate deployment state via read-only RPC queries:');
  console.log(`  Candidate txHashes (${hashes.length}): ${hashes.join(', ') || 'none'}`);
  console.log(`  Candidate contract address: ${primaryAddress || 'none'}`);

  const probeTimestamp = new Date().toISOString();
  const hashesChecked = {};
  let anyHashPending = false;
  let anyHashInconclusive = false;
  const finalizedSuccessfulTxs = [];
  let finalizedSuccessfulTx = null;
  let isAmbiguous = false;
  let ambiguityReason = null;
  let contractCodeHash = null;
  let hasExistingCode = false;
  let codeVerifiedForAdopted = false;

  // 1. Candidate Transaction Lookups (Query EVERY known candidate hash)
  for (const h of hashes) {
    let txFoundForHash = false;
    let txDetailsForHash = null;
    let txQueryErrorForHash = null;
    let txStatusForHash = null;

    try {
      const tx = await client.getTransaction({ hash: h });
      if (tx) {
        txFoundForHash = true;
        txDetailsForHash = tx;
        if (tx.statusName === 'PENDING') {
          txStatusForHash = 'PENDING';
          anyHashPending = true;
          isAmbiguous = true;
          ambiguityReason = ambiguityReason || `Candidate deployment transaction ${h} is currently PENDING in node mempool/queue. Never broadcast while a candidate transaction is in flight.`;
          console.log(`  [IN-FLIGHT] Candidate transaction ${h} is PENDING on node.`);
        } else if (tx.statusName === 'FINALIZED') {
          const resolvedContractAddress = resolveDeploymentContractAddress(tx);
          if (tx.txExecutionResultName === 'FINISHED_WITH_RETURN' && resolvedContractAddress) {
            txStatusForHash = 'FINALIZED_SUCCESS';
            const txWithResolvedAddress = { ...tx, contractAddress: resolvedContractAddress };
            finalizedSuccessfulTxs.push(txWithResolvedAddress);
            finalizedSuccessfulTx = txWithResolvedAddress;
            txDetailsForHash = txWithResolvedAddress;
            console.log(`  [FINALIZED SUCCESS] Candidate tx ${h} finalized successfully with contract address: ${resolvedContractAddress}`);
          } else {
            txStatusForHash = `FINALIZED_${tx.txExecutionResultName || 'FAILED'}`;
            console.log(`  [FINALIZED FAILURE] Candidate tx ${h} finalized with non-success result: ${tx.txExecutionResultName}`);
          }
        } else {
          txStatusForHash = `STATUS_${tx.statusName || tx.status}`;
          isAmbiguous = true;
          ambiguityReason = ambiguityReason || `Candidate deployment transaction ${h} has unhandled status: ${tx.statusName}`;
          console.log(`  [UNHANDLED STATUS] Candidate tx ${h} returned status: ${tx.statusName}`);
        }
      }
    } catch (err) {
      const msg = err?.message || String(err);
      const details = err?.details || '';
      const combined = `${msg} ${details}`;
      const errCode = err?.code;

      const isCleanNotFound =
        (errCode === -32001 || combined.includes('not found') || (combined.includes('Transaction') && combined.includes('not found'))) &&
        !combined.includes('DiskFull') &&
        !combined.includes('No space left on device') &&
        !combined.includes('OperationalError') &&
        !combined.includes('ProgrammingError') &&
        !combined.includes('Internal error') &&
        !combined.includes('FATAL') &&
        !combined.includes('could not connect') &&
        !combined.includes('connection to server') &&
        !combined.includes('recovery mode');

      if (isCleanNotFound) {
        txStatusForHash = 'NOT_FOUND_IN_NODE_DB';
        console.log(`  Candidate transaction ${h} not found in node database at the recorded probe time.`);
      } else {
        txStatusForHash = 'QUERY_INCONCLUSIVE_ERROR';
        txQueryErrorForHash = msg;
        anyHashInconclusive = true;
        isAmbiguous = true;
        ambiguityReason = ambiguityReason || `RPC query for candidate tx ${h} returned indeterminate server/database error: ${sanitizeErrorText(msg).slice(0, 200)}. Never infer that an RPC error means not found.`;
        console.log(`  Candidate tx ${h} query inconclusive: ${ambiguityReason}`);
      }
    }

    hashesChecked[h] = {
      txFound: txFoundForHash,
      txStatus: txStatusForHash,
      txDetails: txDetailsForHash,
      txQueryError: txQueryErrorForHash,
    };
  }

  // Detect conflicting successful deployments
  if (finalizedSuccessfulTxs.length > 1) {
    isAmbiguous = true;
    ambiguityReason = ambiguityReason || `Multiple conflicting successful deployment transactions detected: ${finalizedSuccessfulTxs.map(t => t.hash).join(', ')}`;
    console.log(`  [CONFLICT] ${ambiguityReason}`);
  }

  const allHashesNotFound = hashes.length > 0
    ? hashes.every(h => hashesChecked[h]?.txStatus === 'NOT_FOUND_IN_NODE_DB')
    : true;

  // 2. Candidate Contract Code
  let code = null;
  const uniqueAddresses = new Map();
  for (const candidate of [
    ...addrsToCheck,
    ...(primaryAddress ? [primaryAddress] : []),
    ...(finalizedSuccessfulTx?.contractAddress ? [finalizedSuccessfulTx.contractAddress] : []),
  ].filter(Boolean)) {
    const normalized = candidate.toLowerCase();
    if (!uniqueAddresses.has(normalized)) uniqueAddresses.set(normalized, candidate);
  }
  const addressesToQuery = Array.from(uniqueAddresses.values());

  for (const addr of addressesToQuery) {
    const addrLower = addr.toLowerCase();
    try {
      const c = await readDeployedContractCode(client, addr);
      if (addrLower === primaryAddress?.toLowerCase() || (finalizedSuccessfulTx && addrLower === finalizedSuccessfulTx.contractAddress.toLowerCase())) {
        code = (c !== undefined && c !== null) ? c : '0x';
      }
      console.log(`  Candidate contract code at ${addr}: ${c ? c : 'null / 0x'}`);
      const isNonEmpty = c && c !== '0x' && c !== '0x0' && (typeof c === 'string' ? c.trim() !== '' && c.trim() !== '0x' : true);
      if (isNonEmpty) {
        const codeStr = typeof c === 'string' ? c : JSON.stringify(c);
        contractCodeHash = crypto.createHash('sha256').update(codeStr).digest('hex');
        hasExistingCode = true;

        if (finalizedSuccessfulTx && addrLower === finalizedSuccessfulTx.contractAddress.toLowerCase()) {
          codeVerifiedForAdopted = true;
          console.log(`  [VERIFIED CODE] Contract code at adopted address ${addr} verified (codeHash: ${contractCodeHash}).`);
        } else {
          isAmbiguous = true;
          ambiguityReason = ambiguityReason || `Candidate contract address ${addr} already contains deployed code (codeHash: ${contractCodeHash}) without a verified deployment transaction. Investigate existing contract before any deployment retry. Never treat CONTRACT_CODE_FOUND as permission to broadcast.`;
          console.log(`  [HARD STOP] Candidate contract address is not empty: ${ambiguityReason}`);
          break;
        }
      } else {
        // Code is empty
        if (finalizedSuccessfulTx && addrLower === finalizedSuccessfulTx.contractAddress.toLowerCase()) {
          isAmbiguous = true;
          ambiguityReason = ambiguityReason || `Transaction success reported for tx ${finalizedSuccessfulTx.hash}, but on-chain code at ${addr} is empty (0x). Inconsistent evidence requiring investigation.`;
          console.log(`  [INCONSISTENCY] ${ambiguityReason}`);
        }
      }
    } catch (err) {
      const msg = err?.message || String(err);
      const details = err?.details || '';
      const combined = `${msg} ${details}`;
      const isCleanNotFound =
        (err?.code === -32001 || /(?:requested resource|contract).*not found/i.test(combined)) &&
        !/DiskFull|No space left on device|OperationalError|ProgrammingError|Internal error|FATAL|recovery mode/i.test(combined);
      const isAdoptedAddress = finalizedSuccessfulTx &&
        addrLower === finalizedSuccessfulTx.contractAddress.toLowerCase();
      if (isCleanNotFound && !isAdoptedAddress) {
        console.log(`  Historical candidate contract ${addr} is conclusively absent.`);
        continue;
      }
      isAmbiguous = true;
      ambiguityReason = ambiguityReason || `RPC query for candidate code at ${addr} returned error: ${sanitizeErrorText(msg).slice(0, 200)}`;
      console.log(`  Candidate contract code query ambiguous: ${msg}`);
      break;
    }
  }

  // 3. Creator Nonce Checks (Latest and Pending)
  let creatorLatestNonce = null;
  let creatorPendingNonce = null;
  if (creatorAddress && typeof creatorAddress === 'string') {
    if (typeof client?.getTransactionCount === 'function') {
      try {
        const latest = await client.getTransactionCount({
          address: creatorAddress,
          blockTag: 'latest',
        });
        creatorLatestNonce = Number(latest);
      } catch (err) {
        const msg = err?.message || '';
        isAmbiguous = true;
        ambiguityReason = ambiguityReason || `Query for creator latest nonce failed: ${sanitizeErrorText(msg).slice(0, 200)}`;
        console.log(`  Creator latest nonce query error: ${msg}`);
      }

      try {
        const pending = await client.getTransactionCount({
          address: creatorAddress,
          blockTag: 'pending',
        });
        creatorPendingNonce = Number(pending);
      } catch (err) {
        const msg = err?.message || '';
        isAmbiguous = true;
        ambiguityReason = ambiguityReason || `Query for creator pending nonce failed: ${sanitizeErrorText(msg).slice(0, 200)}`;
        console.log(`  Creator pending nonce query error: ${msg}`);
      }
      console.log(`  Creator fresh nonces: latest=${creatorLatestNonce}, pending=${creatorPendingNonce}`);

      if (creatorLatestNonce !== null && creatorPendingNonce !== null && creatorPendingNonce > creatorLatestNonce) {
        isAmbiguous = true;
        ambiguityReason = ambiguityReason || `Creator has pending transactions: latest=${creatorLatestNonce}, pending=${creatorPendingNonce}`;
        console.log(`  Pending creator transactions detected: ${ambiguityReason}`);
      }
      if (creatorLatestNonce !== null && creatorLatestNonce > 0 && !finalizedSuccessfulTx) {
        isAmbiguous = true;
        ambiguityReason = ambiguityReason || `Creator latest nonce is ${creatorLatestNonce} (> 0), but no finalized successful deployment is recognized in evidence.`;
        console.log(`  Unexpected creator nonce state: ${ambiguityReason}`);
      }
      if (creatorLatestNonce !== null && creatorLatestNonce === 0 && finalizedSuccessfulTx) {
        isAmbiguous = true;
        ambiguityReason = ambiguityReason || `Creator latest nonce is 0, but a finalized successful deployment was reported. Inconsistent nonce state.`;
        console.log(`  Unexpected creator nonce state: ${ambiguityReason}`);
      }
    }
  }

  // 4. Node & Database Health Probe Prerequisite (gen_getContractCode)
  // Derive JSON-RPC request parameter shape from chain.isStudio (consistent with installed genlayer-js SDK):
  // Studio chains expect [address], while non-Studio chains expect [{ address }].
  const isStudio = client?.chain?.isStudio !== undefined ? Boolean(client.chain.isStudio) : true;
  let dbError = null;
  let contractCodeProbeStatus = null;
  const rawProbeRequest = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'gen_getContractCode',
    params: isStudio ? [primaryAddress] : [{ address: primaryAddress }],
  };

  try {
    let probeJson = null;
    let httpStatus = 200;

    if (probeFn) {
      const probeRes = (probeFn.length === 1)
        ? await probeFn(rawProbeRequest)
        : await probeFn(primaryAddress, rawProbeRequest);

      if (probeRes && typeof probeRes === 'object') {
        if (probeRes.status !== undefined) {
          httpStatus = probeRes.status;
          if (typeof probeRes.json === 'function') {
            try {
              probeJson = await probeRes.json();
            } catch (jsonErr) {
              dbError = `Malformed JSON response from node RPC endpoint: ${jsonErr.message}`;
              isAmbiguous = true;
              ambiguityReason = ambiguityReason || dbError;
            }
          } else {
            probeJson = probeRes.body;
          }
        } else {
          probeJson = probeRes;
        }
      } else {
        dbError = 'Malformed or empty JSON response from node RPC endpoint';
        isAmbiguous = true;
        ambiguityReason = ambiguityReason || dbError;
      }
    } else if (client?._probeFn) {
      const probeRes = await client._probeFn(primaryAddress, rawProbeRequest);
      if (probeRes && typeof probeRes === 'object') {
        if (probeRes.status !== undefined) {
          httpStatus = probeRes.status;
          if (typeof probeRes.json === 'function') {
            try {
              probeJson = await probeRes.json();
            } catch (jsonErr) {
              dbError = `Malformed JSON response from node RPC endpoint: ${jsonErr.message}`;
              isAmbiguous = true;
              ambiguityReason = ambiguityReason || dbError;
            }
          } else {
            probeJson = probeRes.body;
          }
        } else {
          probeJson = probeRes;
        }
      } else {
        dbError = 'Malformed or empty JSON response from node RPC endpoint';
        isAmbiguous = true;
        ambiguityReason = ambiguityReason || dbError;
      }
    } else {
      const rpcUrl = client.chain?.rpcUrls?.default?.http?.[0] || 'https://studio-next.genlayer.com/api';
      const probeRes = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rawProbeRequest),
      });
      httpStatus = probeRes.status;
      if (!probeRes.ok) {
        dbError = `HTTP ${probeRes.status} ${probeRes.statusText || 'Error'} from node RPC endpoint`;
        isAmbiguous = true;
        ambiguityReason = ambiguityReason || dbError;
        console.log(`  Candidate deployment probe failed with HTTP error: ${dbError}`);
      } else {
        try {
          probeJson = await probeRes.json();
        } catch (jsonErr) {
          dbError = `Malformed JSON response from node RPC endpoint: ${jsonErr.message}`;
          isAmbiguous = true;
          ambiguityReason = ambiguityReason || dbError;
          console.log(`  Candidate deployment probe returned malformed JSON: ${dbError}`);
        }
      }
    }

    if ((httpStatus < 200 || httpStatus >= 300) && !dbError) {
      dbError = `HTTP ${httpStatus} error from node RPC endpoint`;
      isAmbiguous = true;
      ambiguityReason = ambiguityReason || dbError;
    }

    if (!dbError) {
      if (!probeJson || typeof probeJson !== 'object') {
        dbError = 'Malformed or empty JSON response from node RPC endpoint';
        isAmbiguous = true;
        ambiguityReason = ambiguityReason || dbError;
      } else if (probeJson.error) {
        const errCode = probeJson.error.code;
        const errMsg = probeJson.error.message || '';
        if (errCode === -32001) {
          // Expected query result for the known undeployed candidate contract address.
          // Note: While expected for a non-deployed address, this does not by itself prove deployment writes will succeed.
          contractCodeProbeStatus = 'CONTRACT_NOT_FOUND_EXPECTED_32001';
          console.log(`  Candidate deployment probe returned expected -32001: ${errMsg}`);
        } else {
          // Every unexpected JSON-RPC error (e.g. -32603 internal error, DiskFull, recovery mode)
          // is a failed/inconclusive health check that blocks deployment.
          dbError = `Unexpected JSON-RPC error (${errCode}): ${sanitizeErrorText(errMsg).slice(0, 300)}`;
          isAmbiguous = true;
          ambiguityReason = ambiguityReason || dbError;
          console.log(`  Candidate deployment probe detected unexpected RPC error: ${dbError}`);
        }
      } else if (probeJson.result !== undefined) {
        const rawRes = probeJson.result;
        const isNonEmpty =
          rawRes !== null &&
          rawRes !== '0x' &&
          rawRes !== '0x0' &&
          rawRes !== '' &&
          (typeof rawRes === 'string' ? rawRes.trim() !== '' && rawRes.trim() !== '0x' : true);

        if (isNonEmpty) {
          contractCodeProbeStatus = 'CONTRACT_CODE_FOUND';
          const codeStr = typeof rawRes === 'string' ? rawRes : JSON.stringify(rawRes);
          contractCodeHash = crypto.createHash('sha256').update(codeStr).digest('hex');
          hasExistingCode = true;
          isAmbiguous = true;
          ambiguityReason = `Candidate address ${primaryAddress} already contains deployed contract code (codeHash: ${contractCodeHash}). Investigate existing contract and candidate transaction before any deployment retry. Never treat CONTRACT_CODE_FOUND as permission to broadcast.`;
          console.log(`  [HARD STOP] Candidate deployment probe returned deployed contract code! Code hash: ${contractCodeHash}`);
        } else {
          contractCodeProbeStatus = 'CONTRACT_CODE_EMPTY';
          console.log(`  Candidate deployment probe returned empty contract code (${rawRes}).`);
        }
      } else {
        dbError = 'Malformed JSON-RPC response: neither result nor error property present';
        isAmbiguous = true;
        ambiguityReason = ambiguityReason || dbError;
      }
    }
  } catch (probeFetchErr) {
    dbError = `Candidate deployment DB probe request failed: ${probeFetchErr.message}`;
    isAmbiguous = true;
    ambiguityReason = ambiguityReason || dbError;
    console.log(`  Candidate deployment DB probe request failed: ${probeFetchErr.message}`);
  }

  // Backwards compatibility for single-hash callers
  const primaryHash = hashes[0] || null;
  const primaryHashRecord = primaryHash ? hashesChecked[primaryHash] : null;
  const txFound = Boolean(primaryHashRecord?.txFound);
  const txDetails = primaryHashRecord?.txDetails || null;
  const txQueryError = primaryHashRecord?.txQueryError || null;

  const blocksBroadcast =
    isAmbiguous ||
    !!dbError ||
    (hasExistingCode && !codeVerifiedForAdopted) ||
    anyHashPending ||
    anyHashInconclusive ||
    finalizedSuccessfulTxs.length > 0 ||
    !allHashesNotFound;

  return {
    timestamp: probeTimestamp,
    candidateTxHashes: hashes,
    candidateAddress: primaryAddress,
    candidateAddresses: addrsToCheck,
    hashesChecked,
    allHashesNotFound,
    anyHashInconclusive,
    anyHashPending,
    finalizedSuccessfulTx,
    finalizedSuccessfulTxs,
    hasConflictingSuccesses: finalizedSuccessfulTxs.length > 1,
    txFound,
    txDetails,
    txQueryError,
    code,
    creatorLatestNonce,
    creatorPendingNonce,
    contractCodeProbeStatus,
    contractCodeHash,
    hasExistingCode,
    codeVerifiedForAdopted,
    rawProbeRequest,
    isAmbiguous,
    ambiguityReason,
    dbError,
    blocksBroadcast,
  };
}

/**
 * Evaluate the Stage 1 recovery decision based on multi-hash recovery state.
 *
 * Explicit outcomes:
 * 1. HALT: Any pending hash, inconclusive lookup, RPC error, conflicting successful deployments,
 *    nonce conflict, or transaction/code inconsistency => HALT, nonzero exit, no Stage 2 writes.
 * 2. ADOPT: Exactly one finalized successful deployment, with its receipt, address, code, and
 *    relevant nonces consistently verified, and all other hashes conclusively resolved => ADOPT that deployment; do not deploy again.
 * 3. MAY_DEPLOY: Every known hash conclusively not found, no contract code, creator latest/pending nonces
 *    both 0, and all health checks clean => MAY_DEPLOY after fresh fee estimation, at most one deployment attempt.
 * 4. All other states => HALT. Never use blocksBroadcast alone to decide whether to adopt or deploy.
 */
function evaluateStage1RecoveryDecision(candidateCheck) {
  if (!candidateCheck || typeof candidateCheck !== 'object') {
    return {
      decision: 'HALT',
      action: 'HALT',
      reason: 'Invalid or missing candidateCheck object',
      adoptedDeployment: null,
    };
  }

  // 1. Any RPC or database error
  if (candidateCheck.dbError) {
    return {
      decision: 'HALT',
      action: 'HALT',
      reason: `RPC/database error detected during probe: ${candidateCheck.dbError}`,
      adoptedDeployment: null,
    };
  }

  // 2. Any in-flight pending candidate transaction
  if (candidateCheck.anyHashPending) {
    return {
      decision: 'HALT',
      action: 'HALT',
      reason: `Candidate transaction is pending on node: ${candidateCheck.ambiguityReason || 'Transaction in flight'}`,
      adoptedDeployment: null,
    };
  }

  // 3. Any inconclusive candidate hash query (DiskFull, OperationalError, etc.)
  if (candidateCheck.anyHashInconclusive) {
    return {
      decision: 'HALT',
      action: 'HALT',
      reason: `Candidate transaction query inconclusive: ${candidateCheck.ambiguityReason || 'Query error'}`,
      adoptedDeployment: null,
    };
  }

  // 4. Creator nonce validations
  const latestNonce = candidateCheck.creatorLatestNonce;
  const pendingNonce = candidateCheck.creatorPendingNonce;
  if (latestNonce === null || latestNonce === undefined || pendingNonce === null || pendingNonce === undefined) {
    return {
      decision: 'HALT',
      action: 'HALT',
      reason: 'Creator latest or pending nonce could not be verified conclusively',
      adoptedDeployment: null,
    };
  }
  if (pendingNonce > latestNonce) {
    return {
      decision: 'HALT',
      action: 'HALT',
      reason: `Creator has pending transactions in mempool: latest=${latestNonce}, pending=${pendingNonce}`,
      adoptedDeployment: null,
    };
  }

  // 5. Inspect all candidate hashes
  const hashesChecked = candidateCheck.hashesChecked || {};
  const hashKeys = Object.keys(hashesChecked);
  const successfulHashes = hashKeys.filter(
    h => hashesChecked[h]?.txStatus === 'FINALIZED_SUCCESS'
  );

  // Conflicting successful deployments:
  if (successfulHashes.length > 1 || candidateCheck.hasConflictingSuccesses) {
    return {
      decision: 'HALT',
      action: 'HALT',
      reason: `Conflicting successful deployments detected across multiple hashes: ${successfulHashes.join(', ')}`,
      adoptedDeployment: null,
    };
  }

  // 6. Branch A: Exactly ONE finalized successful deployment
  if (successfulHashes.length === 1 || candidateCheck.finalizedSuccessfulTx) {
    const succHash = successfulHashes[0] || candidateCheck.finalizedSuccessfulTx?.hash;
    const succTx = candidateCheck.finalizedSuccessfulTx || hashesChecked[succHash]?.txDetails;

    if (!succTx || !succTx.contractAddress) {
      return {
        decision: 'HALT',
        action: 'HALT',
        reason: 'Successful deployment record is missing verified contractAddress',
        adoptedDeployment: null,
      };
    }

    // Check all OTHER candidate hashes: must all be conclusively resolved
    const otherHashes = hashKeys.filter(h => h.toLowerCase() !== succHash.toLowerCase());
    for (const otherH of otherHashes) {
      const st = hashesChecked[otherH]?.txStatus;
      const isConclusive =
        st === 'NOT_FOUND_IN_NODE_DB' ||
        (typeof st === 'string' && st.startsWith('FINALIZED_') && st !== 'FINALIZED_SUCCESS') ||
        st === 'STATUS_DROPPED' ||
        st === 'STATUS_CANCELLED';
      if (!isConclusive) {
        return {
          decision: 'HALT',
          action: 'HALT',
          reason: `Other candidate hash ${otherH} is not conclusively resolved (status: ${st})`,
          adoptedDeployment: null,
        };
      }
    }

    // Verify contract bytecode at adopted address:
    // MUST be non-empty and readable! Empty or unreadable bytecode is an inconsistency requiring investigation!
    const code = candidateCheck.code;
    const isCodeNonEmpty =
      code !== null &&
      code !== undefined &&
      code !== '0x' &&
      code !== '0x0' &&
      code !== '' &&
      (typeof code === 'string' ? code.trim() !== '' && code.trim() !== '0x' : true);

    if (!isCodeNonEmpty) {
      return {
        decision: 'HALT',
        action: 'HALT',
        reason: `Transaction success reported for tx ${succHash}, but contract code at ${succTx.contractAddress} is empty (0x) or unreadable. Inconsistent evidence requiring investigation.`,
        adoptedDeployment: null,
      };
    }

    // Verify creator nonce for existing deployment:
    // Mined deployment requires at least nonce 1, and pending === latest
    if (latestNonce < 1) {
      return {
        decision: 'HALT',
        action: 'HALT',
        reason: `Unexpected creator nonce for finalized deployment: creator latest nonce is ${latestNonce} (< 1)`,
        adoptedDeployment: null,
      };
    }

    // Check for any unhandled ambiguity not explained by code verification
    if (candidateCheck.isAmbiguous && !candidateCheck.codeVerifiedForAdopted) {
      return {
        decision: 'HALT',
        action: 'HALT',
        reason: `Ambiguous recovery state: ${candidateCheck.ambiguityReason}`,
        adoptedDeployment: null,
      };
    }

    // All conditions consistently verified: ADOPT that deployment; do not deploy again!
    return {
      decision: 'ADOPT',
      action: 'ADOPT',
      reason: `Exactly one finalized successful deployment consistently verified at ${succTx.contractAddress} (tx: ${succHash}) with non-empty code and nonce ${latestNonce}.`,
      adoptedDeployment: {
        txHash: succHash,
        contractAddress: succTx.contractAddress,
        statusName: succTx.statusName || 'FINALIZED',
        txExecutionResultName: succTx.txExecutionResultName || 'FINISHED_WITH_RETURN',
        receipt: succTx,
      },
    };
  }

  // 7. Branch B: Clean undeployed state => MAY_DEPLOY
  // Requirements:
  // - Every known hash conclusively not found
  // - No contract code (0x / empty)
  // - Creator latest/pending nonces both 0
  // - All health checks clean
  const allHashesCleanlyNotFound =
    candidateCheck.allHashesNotFound &&
    hashKeys.length > 0 &&
    hashKeys.every(h => hashesChecked[h]?.txStatus === 'NOT_FOUND_IN_NODE_DB');

  const isCodeCleanEmpty =
    !candidateCheck.hasExistingCode &&
    (candidateCheck.code === null ||
     candidateCheck.code === undefined ||
     candidateCheck.code === '0x' ||
     candidateCheck.code === '0x0' ||
     candidateCheck.code === '') &&
    (candidateCheck.contractCodeProbeStatus === 'CONTRACT_NOT_FOUND_EXPECTED_32001' ||
     candidateCheck.contractCodeProbeStatus === 'CONTRACT_CODE_EMPTY' ||
     candidateCheck.contractCodeProbeStatus === null);

  const noncesCleanZero = latestNonce === 0 && pendingNonce === 0;

  if (allHashesCleanlyNotFound && isCodeCleanEmpty && noncesCleanZero && !candidateCheck.isAmbiguous && !candidateCheck.dbError) {
    return {
      decision: 'MAY_DEPLOY',
      action: 'MAY_DEPLOY',
      reason: 'All candidate hashes conclusively not found, contract code empty, nonces 0, health checks clean. Single deployment attempt permitted.',
      adoptedDeployment: null,
    };
  }

  // 8. All other states => HALT
  return {
    decision: 'HALT',
    action: 'HALT',
    reason: `Recovery state does not satisfy criteria for ADOPT or MAY_DEPLOY (isAmbiguous=${candidateCheck.isAmbiguous}, allHashesCleanlyNotFound=${allHashesCleanlyNotFound}, isCodeCleanEmpty=${isCodeCleanEmpty}, noncesCleanZero=${noncesCleanZero}, reason=${candidateCheck.ambiguityReason || 'unmatched state'})`,
    adoptedDeployment: null,
  };
}

/**
 * Execute the Stage 1 recovery step based on evaluateStage1RecoveryDecision.
 * Guarantees:
 * - If outcome is HALT: deployContract is NEVER called, stage2Permitted is false.
 * - If outcome is ADOPT: adopts verified deployment, deployContract is NEVER called, stage2Permitted is true.
 * - If outcome is MAY_DEPLOY: performs fresh fee estimation and at most ONE deployContract call.
 * - On any deployment failure (DiskFull, RPC error): halts immediately with nonzero exit code.
 */
async function executeStage1RecoveryStep({
  creatorClient,
  candidateCheck,
  code,
  evidence,
  creatorAddress,
  creatorNonce,
  candidateHashes = [],
  candidateAddrs = [],
  primaryCandidateAddress = null,
  latestCandidateHash = null,
  saveEvidenceOption = true,
  deploymentOnly = false,
  creatorBalanceWei = null,
}) {
  const decisionResult = evaluateStage1RecoveryDecision(candidateCheck);
  console.log(`\nStage 1 Recovery Decision: ${decisionResult.decision}`);
  console.log(`Decision Reason: ${decisionResult.reason}`);

  if (decisionResult.decision === 'ADOPT') {
    const adopted = decisionResult.adoptedDeployment;
    const contractAddress = adopted.contractAddress;
    if (evidence && saveEvidenceOption !== false) {
      if (!evidence.stages) evidence.stages = {};
      evidence.stages.deploy = {
        txHash: adopted.txHash,
        statusName: adopted.statusName,
        txExecutionResultName: adopted.txExecutionResultName,
        contractAddress,
      };
      evidence.contractAddress = contractAddress;
      saveEvidence(evidence);
    }
    console.log(`Adopted finalized candidate deployment: ${contractAddress}`);
    return {
      decision: 'ADOPT',
      outcome: 'ADOPT',
      deployed: false,
      adopted: true,
      contractAddress,
      txHash: adopted.txHash,
      stage2Permitted: !deploymentOnly,
      deploymentOnlyComplete: deploymentOnly,
      decisionResult,
    };
  }

  if (decisionResult.decision === 'MAY_DEPLOY') {
    console.log('Candidate deployment was not found at the recorded probe time, with empty code and latest/pending nonce 0.');
    console.log('Estimating deployment fees to verify RPC and network readiness before submission...');

    let deployFees;
    try {
      deployFees = await creatorClient.estimateTransactionFees({
        code,
        args: [],
        leaderOnly: false,
      });
      console.log(`Estimated deploy feeValue: ${(Number(deployFees.feeValue) / 1e18).toFixed(6)} GEN`);
      if (creatorBalanceWei !== null && BigInt(creatorBalanceWei) < BigInt(deployFees.feeValue)) {
        throw new Error(
          `Creator balance ${creatorBalanceWei.toString()} wei is below estimated deployment fee ${deployFees.feeValue.toString()} wei`
        );
      }
    } catch (estErr) {
      if (evidence && saveEvidenceOption !== false) {
        recordFailure(evidence, 'deploy', estErr, null, {
          candidateTxHashes: candidateHashes,
          candidateContractAddress: primaryCandidateAddress,
          stageDetail: 'Fee estimation failed before broadcast',
        });
      }
      console.error('Cannot submit deployment: Fee estimation rejected by Studio Next node.');
      return {
        decision: 'MAY_DEPLOY',
        outcome: 'HALT',
        deployed: false,
        adopted: false,
        contractAddress: null,
        stage2Permitted: false,
        error: estErr,
        decisionResult,
      };
    }

    console.log('Recording deployment intent before broadcast (ONE attempt only)...');
    if (evidence && saveEvidenceOption !== false) {
      archiveHistoricalDeploymentEvidence(evidence);
      evidence.latestDeploymentAttempt = {
        attemptTimestamp: new Date().toISOString(),
        status: 'INTENT_BROADCASTING',
        mode: deploymentOnly ? 'DEPLOYMENT_ONLY' : 'CONTROLLED_RESUME',
        sourceHash: EXPECTED_SOURCE_HASH,
        chainId: EXPECTED_CHAIN_ID,
        rpcUrl: EXPECTED_RPC_URL,
        feeValueWei: deployFees.feeValue.toString(),
        feeEstimateResponse: sanitizeRpcEvidence(deployFees),
        fromAddress: creatorAddress,
        creatorNonce,
        deployContractCallCount: 0,
      };
      saveEvidence(evidence);
    }

    console.log('Broadcasting deployment transaction to Studio Next...');
    let deployTxHash = null;
    try {
      if (evidence && saveEvidenceOption !== false) {
        evidence.latestDeploymentAttempt.deployContractCallCount = 1;
        evidence.latestDeploymentAttempt.deployContractCalledAt = new Date().toISOString();
        saveEvidence(evidence);
      }
      deployTxHash = await creatorClient.deployContract({
        code,
        args: [],
        fees: deployFees,
      });
      console.log(`Deployment transaction submitted: ${deployTxHash}`);

      if (evidence && saveEvidenceOption !== false) {
        evidence.latestDeploymentAttempt.status = 'SUBMITTED';
        evidence.latestDeploymentAttempt.txHash = deployTxHash;
        evidence.latestDeploymentAttempt.candidateTxHash = deployTxHash;
        if (!evidence.stages) evidence.stages = {};
        evidence.stages.deploy = {
          txHash: deployTxHash,
          submittedAt: new Date().toISOString(),
          sourceHash: EXPECTED_SOURCE_HASH,
          chainId: EXPECTED_CHAIN_ID,
          rpcUrl: EXPECTED_RPC_URL,
          feeValueWei: deployFees.feeValue.toString(),
          feeEstimateResponse: sanitizeRpcEvidence(deployFees),
          deployContractCallCount: 1,
        };
        saveEvidence(evidence);
      }

      console.log('Waiting for deployment finalization...');
      const deployTx = await verifyTxFinalizedAndSuccessful(creatorClient, deployTxHash, 'deploy');

      const contractAddress = resolveDeploymentContractAddress(deployTx);
      if (!contractAddress) {
        throw new Error(
          `Finalized deployment transaction ${deployTxHash} did not expose a contract address in contractAddress, to_address, or toAddress`
        );
      }
      if (evidence && saveEvidenceOption !== false) {
        evidence.stages.deploy.statusName = deployTx.statusName;
        evidence.stages.deploy.txExecutionResultName = deployTx.txExecutionResultName;
        evidence.stages.deploy.contractAddress = contractAddress;
        evidence.contractAddress = contractAddress;
        evidence.latestDeploymentAttempt.status = 'FINALIZED_SUCCESS';
        saveEvidence(evidence);
      }
      console.log(`CharterFlowCore deployed successfully at: ${contractAddress}`);
      return {
        decision: 'MAY_DEPLOY',
        outcome: 'DEPLOYED',
        deployed: true,
        adopted: false,
        contractAddress,
        stage2Permitted: !deploymentOnly,
        deploymentOnlyComplete: deploymentOnly,
        txHash: deployTxHash,
        decisionResult,
      };
    } catch (err) {
      const extracted = extractCandidateParams(err);
      const failedHash = deployTxHash || extracted.candidateTxHash || null;
      if (evidence && saveEvidenceOption !== false) {
        evidence.latestDeploymentAttempt = {
          ...evidence.latestDeploymentAttempt,
          status: deployTxHash || extracted.candidateTxHash
            ? 'OUTCOME_UNCERTAIN'
            : 'SUBMISSION_OUTCOME_UNKNOWN',
          txHash: failedHash,
          candidateTxHash: failedHash,
          candidateContractAddress: extracted.candidateContractAddress || primaryCandidateAddress,
          error: sanitizeErrorText(err?.message || String(err)),
        };
        recordFailure(evidence, 'deploy', err, failedHash, {
          candidateTxHash: failedHash,
          candidateContractAddress: extracted.candidateContractAddress || primaryCandidateAddress,
        });
      }
      console.error('Deployment attempt failed. Error recorded safely. Halting without retry.');
      return {
        decision: 'MAY_DEPLOY',
        outcome: 'DEPLOY_FAILED',
        deployed: true,
        adopted: false,
        contractAddress: extracted.candidateContractAddress || null,
        stage2Permitted: false,
        deploymentOnlyComplete: false,
        error: err,
        decisionResult,
      };
    }
  }

  // Outcome is HALT
  const msg = `Safety halt in Stage 1 recovery: ${decisionResult.reason}`;
  if (evidence && saveEvidenceOption !== false) {
    recordFailure(evidence, 'deploy', new Error(msg), latestCandidateHash, {
      candidateTxHashes: candidateHashes,
      candidateContractAddress: primaryCandidateAddress,
      contractCodeProbeStatus: candidateCheck.contractCodeProbeStatus,
      contractCodeHash: candidateCheck.contractCodeHash,
      hasExistingCode: candidateCheck.hasExistingCode,
      isAmbiguous: candidateCheck.isAmbiguous,
      ambiguityReason: candidateCheck.ambiguityReason,
      dbError: candidateCheck.dbError,
      decisionResult,
    });
  }
  console.error(`\n[SAFETY HALT] ${msg}`);
  return {
    decision: 'HALT',
    outcome: 'HALT',
    deployed: false,
    adopted: false,
    contractAddress: null,
    stage2Permitted: false,
    reason: decisionResult.reason,
    decisionResult,
  };
}

/**
 * Bounded read-only health monitor command for Studio Next.
 * Periodically observes chain ID, latest block, SDK-compatible contract-code probe,
 * every candidate deployment hash, candidate code, and creator nonces.
 * Records short timestamped observations to pilot_evidence.json without storing
 * contract source, signed transactions, or secrets.
 * Explicitly notes that healthy read responses do not prove database writes are healthy.
 */
async function runStudioHealthMonitor(client, evidence, options = {}) {
  const count = Math.max(1, parseInt(options.count, 10) || 3);
  const intervalSec = Math.max(0, parseInt(options.intervalSec, 10) || 5);
  const creatorAddress = options.creatorAddress || evidence.accounts?.creator?.address || null;

  const candidateHashes = gatherAttemptedDeploymentHashes(evidence);
  const candidateAddrs = gatherCandidateContractAddresses(evidence);
  const candidateAddr = candidateAddrs[0] || evidence.contractAddress || '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290';

  console.log('================================================================');
  console.log('         BOUNDED READ-ONLY STUDIO NEXT HEALTH MONITOR           ');
  console.log('================================================================');
  console.log(`Planned Observations: ${count} (Interval: ${intervalSec}s)`);
  console.log(`Candidate Hashes Tracked (${candidateHashes.length}):`, candidateHashes);
  console.log(`Candidate Address:`, candidateAddr);
  console.log(`Creator Address:`, creatorAddress || '(not loaded)');
  console.log('NOTE: Read queries only. No write transactions will be broadcast.\n');

  const observations = [];

  for (let i = 1; i <= count; i++) {
    console.log(`--- Observation ${i}/${count} at ${new Date().toISOString()} ---`);
    let chainId = null;
    let blockNumber = null;
    let chainIdOk = false;
    const readErrors = [];

    // 1. Chain ID and Block Number
    try {
      chainId = await client.getChainId();
      chainIdOk = chainId === EXPECTED_CHAIN_ID;
    } catch (e) {
      readErrors.push(`getChainId: ${e.message}`);
    }

    try {
      const bn = await client.getBlockNumber();
      blockNumber = bn.toString();
    } catch (e) {
      readErrors.push(`getBlockNumber: ${e.message}`);
    }

    // 2. Creator Nonces
    let creatorLatestNonce = null;
    let creatorPendingNonce = null;
    if (creatorAddress) {
      try {
        creatorLatestNonce = Number(await client.getTransactionCount({ address: creatorAddress, blockTag: 'latest' }));
      } catch (e) {
        readErrors.push(`latestNonce: ${e.message}`);
      }
      try {
        creatorPendingNonce = Number(await client.getTransactionCount({ address: creatorAddress, blockTag: 'pending' }));
      } catch (e) {
        readErrors.push(`pendingNonce: ${e.message}`);
      }
    }

    // 3. Candidate Deployment Hashes
    const hashStatuses = {};
    for (const h of candidateHashes) {
      try {
        const tx = await client.getTransaction({ hash: h });
        hashStatuses[h] = tx ? `FOUND_${tx.statusName || 'UNKNOWN'}` : 'NULL';
      } catch (e) {
        const msg = e.message || '';
        if (msg.includes('not found') || msg.includes('-32001')) {
          hashStatuses[h] = 'NOT_FOUND_IN_NODE_DB';
        } else {
          hashStatuses[h] = `RPC_ERROR: ${sanitizeErrorText(msg).slice(0, 100)}`;
          readErrors.push(`txLookup(${h.slice(0, 10)}...): ${sanitizeErrorText(msg).slice(0, 80)}`);
        }
      }
    }

    // 4. Candidate Code & SDK-Compatible Probe
    let codeResult = null;
    try {
      const c = await readDeployedContractCode(client, candidateAddr);
      codeResult = c && c !== '0x' && c !== '0x0' ? 'NONEMPTY_CODE' : '0x (empty)';
    } catch (e) {
      codeResult = `ERROR: ${sanitizeErrorText(e.message).slice(0, 80)}`;
      readErrors.push(`getCode: ${e.message}`);
    }

    let rawCodeProbeStatus = null;
    const isStudio = Boolean(client?.chain?.isStudio ?? true);
    const rawReq = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'gen_getContractCode',
      params: isStudio ? [candidateAddr] : [{ address: candidateAddr }],
    };
    try {
      const rpcUrl = client.chain?.rpcUrls?.default?.http?.[0] || EXPECTED_RPC_URL;
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rawReq),
      });
      if (!res.ok) {
        rawCodeProbeStatus = `HTTP_${res.status}`;
        readErrors.push(`rawProbe: HTTP ${res.status}`);
      } else {
        const j = await res.json();
        if (j.error?.code === -32001) {
          rawCodeProbeStatus = 'EXPECTED_32001_NOT_FOUND';
        } else if (j.error) {
          rawCodeProbeStatus = `RPC_ERROR_${j.error.code}`;
          readErrors.push(`rawProbe: ${j.error.message}`);
        } else {
          rawCodeProbeStatus = (j.result && j.result !== '0x') ? 'CODE_PRESENT' : '0x_EMPTY';
        }
      }
    } catch (e) {
      rawCodeProbeStatus = `FETCH_ERROR: ${e.message}`;
      readErrors.push(`rawProbe: ${e.message}`);
    }

    const obs = {
      timestamp: new Date().toISOString(),
      iteration: i,
      totalCount: count,
      chainId,
      chainIdOk,
      blockNumber,
      creatorLatestNonce,
      creatorPendingNonce,
      candidateHashes: hashStatuses,
      candidateCode: codeResult,
      rawCodeProbeStatus,
      readsHealthy: readErrors.length === 0,
      readErrors: readErrors.length > 0 ? readErrors : null,
      disclaimer: 'Healthy read responses indicate RPC read endpoints respond. They do not prove database writes are healthy.',
    };

    observations.push(obs);

    console.log(`  Chain ID: ${chainId} (matches ${EXPECTED_CHAIN_ID}: ${chainIdOk}) | Block: ${blockNumber}`);
    console.log(`  Creator Nonces: latest=${creatorLatestNonce}, pending=${creatorPendingNonce}`);
    console.log(`  Hashes Status:`, JSON.stringify(hashStatuses));
    console.log(`  Candidate Code: ${codeResult} (gen_getContractCode: ${rawCodeProbeStatus})`);
    console.log(`  Reads Status: ${obs.readsHealthy ? 'HEALTHY' : 'DEGRADED/ERROR'}`);
    console.log(`  Notice: ${obs.disclaimer}\n`);

    if (!Array.isArray(evidence.monitorObservations)) {
      evidence.monitorObservations = [];
    }
    evidence.monitorObservations.push(obs);
    // Keep at most 10 recent observations to prevent file bloat
    if (evidence.monitorObservations.length > 10) {
      evidence.monitorObservations = evidence.monitorObservations.slice(-10);
    }
    if (options.saveEvidence !== false) {
      saveEvidence(evidence, options.filePath || EVIDENCE_FILE);
    }

    if (i < count && intervalSec > 0) {
      await new Promise(r => setTimeout(r, intervalSec * 1000));
    }
  }

  console.log(`================================================================`);
  console.log(`       MONITORING RUN COMPLETE: ${count} OBSERVATIONS LOGGED    `);
  console.log(`================================================================\n`);
  return observations;
}

async function main() {
  const args = process.argv.slice(2);
  const isMonitor = args.includes('--monitor');
  const isResume = args.includes('--resume');
  const isLifecycleOnly = args.includes('--lifecycle-only');
  const isDeploymentOnly = args.includes('--deploy-only');
  const isReconcileDeployment = args.includes('--reconcile-deployment');
  const isReconcileStage2 = args.includes('--reconcile-stage2');
  const selectedModes = [isMonitor, isResume, isLifecycleOnly, isDeploymentOnly, isReconcileDeployment, isReconcileStage2, args.includes('--probe')].filter(Boolean).length;
  if (selectedModes > 1) {
    throw new Error('Choose exactly one runner mode: --probe, --monitor, --reconcile-deployment, --reconcile-stage2, --deploy-only, --lifecycle-only, or --resume');
  }
  const writeMode = isResume ? 'resume' : isLifecycleOnly ? 'lifecycle-only' : isDeploymentOnly ? 'deploy-only' : null;
  if (writeMode) requireEvidenceCheckpointForWrites(writeMode);
  const isProbe = args.includes('--probe') || (!isMonitor && !isResume && !isLifecycleOnly && !isDeploymentOnly && !isReconcileDeployment && !isReconcileStage2);

  console.log('================================================================');
  if (isMonitor) {
    console.log('       CHARTERFLOW STUDIO NEXT HEALTH MONITOR (BOUNDED)         ');
  } else if (isReconcileDeployment) {
    console.log('       CHARTERFLOW DEPLOYMENT READBACK RECONCILIATION           ');
  } else if (isReconcileStage2) {
    console.log('       CHARTERFLOW STAGE 2 READ-ONLY RECONCILIATION             ');
  } else if (isDeploymentOnly) {
    console.log('       CHARTERFLOW DEPLOYMENT-ONLY (STAGE 1, ONE ATTEMPT)       ');
  } else if (isLifecycleOnly) {
    console.log('       CHARTERFLOW LIFECYCLE-ONLY (NO DEPLOYMENT PATH)          ');
  } else if (isResume) {
    console.log('       CHARTERFLOW CONTROLLED RESUME (ONE WRITE ATTEMPT MAX)    ');
  } else {
    console.log('       CHARTERFLOW READ-ONLY RECOVERY & HEALTH PROBE            ');
  }
  console.log('================================================================\n');

  // 1. Source Hash & Read-Only Checks
  const contractPath = path.resolve(__dirname, '../contracts/CharterFlowCore.py');
  const code = fs.readFileSync(contractPath, 'utf8');
  const actualSourceHash = crypto.createHash('sha256').update(code).digest('hex');

  console.log('Checking Contract Source Hash:');
  console.log(`  Actual:   ${actualSourceHash}`);
  console.log(`  Expected: ${EXPECTED_SOURCE_HASH}`);
  if (actualSourceHash !== EXPECTED_SOURCE_HASH) {
    process.exitCode = 1;
    throw new Error(`Contract source hash mismatch! Expected ${EXPECTED_SOURCE_HASH}, got ${actualSourceHash}`);
  }
  console.log('  Source hash verified! Matches expected source.\n');

  // Load existing evidence (Hard Stop if corrupt). Missing file is not a fresh pilot.
  const evidenceCheckpointPresent = fs.existsSync(EVIDENCE_FILE);
  const evidence = loadEvidence();
  if (!evidenceCheckpointPresent && !writeMode) {
    attachPublicPilotReadFacts(evidence);
    console.log('No local evidence checkpoint on disk. Using public recorded deployment/create_round facts for read-only modes only. Evidence writes will not create a new checkpoint.');
  }
  // Do not relabel prior deployment evidence after the contract source changes.
  // `source` remains the hash recorded by that historical attempt; the current
  // candidate is tracked separately for all new probes and future writes.
  evidence.currentCandidateSource = {
    file: 'contracts/CharterFlowCore.py',
    sha256: actualSourceHash,
  };

  // 2. Read-Only RPC Health & Chain ID
  console.log('Checking Studio Next RPC Health:');
  const tempClient = createClient({ chain: studioNext });
  let chainId;
  let blockNumber;
  try {
    chainId = await tempClient.getChainId();
    blockNumber = await tempClient.getBlockNumber();
  } catch (rpcErr) {
    recordFailure(evidence, 'rpcHealth', rpcErr);
    console.error('Studio Next RPC is unreachable or unhealthy.');
    process.exitCode = 1;
    return;
  }

  console.log(`  RPC: ${EXPECTED_RPC_URL}`);
  console.log(`  Chain ID: ${chainId} (matches ${EXPECTED_CHAIN_ID}: ${chainId === EXPECTED_CHAIN_ID})`);
  console.log(`  Block Number: ${blockNumber.toString()}`);
  if (chainId !== EXPECTED_CHAIN_ID) {
    process.exitCode = 1;
    throw new Error(`Chain ID mismatch! Expected ${EXPECTED_CHAIN_ID}, got ${chainId}`);
  }

  evidence.rpcHealth = {
    status: 'ONLINE',
    chainId,
    blockNumber: blockNumber.toString(),
    verifiedAt: new Date().toISOString(),
  };

  const creatorAddress = evidence.accounts?.creator?.address || EXPECTED_CREATOR_ADDRESS;
  let candidateHashes = gatherAttemptedDeploymentHashes(evidence);
  let candidateAddrs = gatherCandidateContractAddresses(evidence);
  if (candidateHashes.length === 0) candidateHashes = [EXPECTED_PILOT_DEPLOYMENT_TX];
  if (candidateAddrs.length === 0) candidateAddrs = [EXPECTED_PILOT_CONTRACT_ADDRESS];
  const primaryCandidateAddress = candidateAddrs[0] || EXPECTED_PILOT_CONTRACT_ADDRESS;
  const latestCandidateHash = getLatestAttemptedDeploymentHash(evidence) || EXPECTED_PILOT_DEPLOYMENT_TX;

  // --------------------------------------------------------------------------
  // MODE 1: BOUNDED READ-ONLY STUDIO HEALTH MONITOR
  // --------------------------------------------------------------------------
  if (isMonitor) {
    let count = 3;
    let intervalSec = 5;
    for (const arg of args) {
      if (arg.startsWith('--count=')) count = parseInt(arg.split('=')[1], 10) || 3;
      if (arg.startsWith('--interval=')) intervalSec = parseInt(arg.split('=')[1], 10) || 5;
    }
    await runStudioHealthMonitor(tempClient, evidence, {
      count,
      intervalSec,
      creatorAddress,
    });
    return;
  }

  // --------------------------------------------------------------------------
  // MODE 2: READ-ONLY RECOVERY & HEALTH PROBE (Default safe mode, NO writes)
  // --------------------------------------------------------------------------
  if (isProbe) {
    console.log('Gathering attempted deployment transaction hashes from evidence:');
    console.log(`  Tracked candidate hashes (${candidateHashes.length}):`, candidateHashes);
    console.log(`  Latest candidate hash: ${latestCandidateHash || 'none'}`);
    console.log(`  Candidate contract address: ${primaryCandidateAddress}`);
    console.log(`  Creator address: ${creatorAddress}`);

    const candidateCheck = await checkCandidateDeploymentSafety(
      tempClient,
      candidateHashes,
      candidateAddrs,
      creatorAddress
    );

    // Archive prior probe if timestamp is different
    if (evidence.candidateRecoveryProbe && evidence.candidateRecoveryProbe.timestamp !== candidateCheck.timestamp) {
      if (!Array.isArray(evidence.historicalProbes)) evidence.historicalProbes = [];
      const probeToArchive = { ...evidence.candidateRecoveryProbe };
      const alreadyArchived = evidence.historicalProbes.some(p => p.timestamp === probeToArchive.timestamp);
      if (!alreadyArchived) evidence.historicalProbes.push(probeToArchive);
    }

    const decisionResult = evaluateStage1RecoveryDecision(candidateCheck);

    evidence.candidateRecoveryProbe = {
      timestamp: candidateCheck.timestamp,
      probedAt: candidateCheck.timestamp,
      requestShape: candidateCheck.rawProbeRequest?.params ? JSON.stringify(candidateCheck.rawProbeRequest.params) : null,
      candidateTxHash: latestCandidateHash,
      candidateTxHashes: candidateHashes,
      candidateContractAddress: primaryCandidateAddress,
      candidateContractAddresses: candidateAddrs,
      candidateTransactionLookups: candidateCheck.hashesChecked,
      creatorLatestNonce: candidateCheck.creatorLatestNonce,
      creatorPendingNonce: candidateCheck.creatorPendingNonce,
      candidateCode: candidateCheck.hasExistingCode
        ? `CODE_FOUND (hash: ${candidateCheck.contractCodeHash})`
        : '0x (empty bytecode)',
      contractCodeHash: candidateCheck.contractCodeHash,
      contractCodeProbeStatus: candidateCheck.contractCodeProbeStatus,
      recoveryDecision: decisionResult.decision,
      recoveryReason: decisionResult.reason,
      adoptedContractAddress: decisionResult.adoptedDeployment?.contractAddress || null,
      rpcError: (candidateCheck.dbError || candidateCheck.ambiguityReason)
        ? sanitizeErrorText(candidateCheck.dbError || candidateCheck.ambiguityReason)
        : null,
      verdict: candidateCheck.hasExistingCode
        ? `Candidate address ${primaryCandidateAddress} already contains deployed contract code (codeHash: ${candidateCheck.contractCodeHash}). Hard-stop triggered: investigate existing contract and candidate transaction before any deployment retry.`
        : candidateCheck.dbError
        ? `Node/database probe returned RPC error: ${sanitizeErrorText(candidateCheck.dbError)}`
        : candidateCheck.ambiguityReason
        ? `Node/database query ambiguous: ${sanitizeErrorText(candidateCheck.ambiguityReason)}`
        : 'Candidate deployment was not found at the recorded probe time, with empty code and latest/pending nonce 0. Query result is -32001 (not found), which is an observation of undeployed state, not proof that writes are healthy.',
      blocksBroadcast: candidateCheck.blocksBroadcast,
      disclaimer: 'Healthy read responses indicate RPC read endpoints respond. They do not prove database writes are healthy.',
    };
    saveEvidence(evidence);

    console.log('\n================================================================');
    console.log('             READ-ONLY PROBE DIAGNOSTIC SUMMARY                 ');
    console.log('================================================================');
    console.log(`Probe Timestamp: ${candidateCheck.timestamp}`);
    console.log(`Creator Account: ${creatorAddress}`);
    console.log(`Creator Nonces: latest=${candidateCheck.creatorLatestNonce}, pending=${candidateCheck.creatorPendingNonce}`);
    console.log(`Candidate Contract Address: ${primaryCandidateAddress}`);
    console.log(`Candidate Contract Code: ${candidateCheck.hasExistingCode ? `NONEMPTY (hash: ${candidateCheck.contractCodeHash})` : '0x (empty bytecode)'}`);
    console.log(`SDK gen_getContractCode Probe: ${candidateCheck.contractCodeProbeStatus || 'N/A'}`);
    console.log('Candidate Deployment Hashes:');
    for (const h of candidateHashes) {
      const rec = candidateCheck.hashesChecked[h];
      console.log(`  - ${h}: status=${rec?.txStatus || 'UNKNOWN'}${rec?.txQueryError ? ` (error: ${sanitizeErrorText(rec.txQueryError).slice(0, 100)})` : ''}`);
    }

    if (decisionResult.decision === 'HALT') {
      console.log(`\nPROBE STATUS: HALT / BLOCKED (${decisionResult.reason})`);
      process.exitCode = 1;
    } else if (decisionResult.decision === 'ADOPT') {
      console.log(`\nPROBE STATUS: FINALIZED SUCCESSFUL DEPLOYMENT FOUND`);
      console.log(`Verified Contract Address: ${decisionResult.adoptedDeployment?.contractAddress}`);
    } else if (decisionResult.decision === 'MAY_DEPLOY') {
      console.log(`\nPROBE STATUS: CLEAN UNDEPLOYED (MAY DEPLOY)`);
      console.log(`All candidate hashes are cleanly not found in node DB, code is empty, and creator nonces are 0.`);
      console.log(`Notice: Healthy read responses indicate RPC read endpoints respond. They do not prove database writes are healthy.`);
    }

    console.log('\n================================================================');
    console.log('COMMANDS AVAILABLE FOR NEXT STEPS:');
    console.log('  1. Bounded Read-Only Health Monitor:');
    console.log('     node scripts/run_charterflow_pilot.js --monitor [--count=3] [--interval=5]');
    console.log('     (Conditions enforced: 100% read-only, observes chain/hashes/code/nonces, records observations, never writes)');
    console.log('  2. Deployment-only Stage 1 (ONE deployment attempt max, never creates a round):');
    console.log('     node scripts/run_charterflow_pilot.js --deploy-only');
    console.log('     (Conditions enforced: passes all recovery checks, queries every hash, fresh fee estimate, persists intent/hash immediately, independently verifies transaction/code/schema, stops before Stage 2)');
    console.log('  3. Read-only reconciliation of a recorded deployment attempt:');
    console.log('     node scripts/run_charterflow_pilot.js --reconcile-deployment');
    console.log('     (Conditions enforced: zero writes, verifies finalized receipt, exact source hash, deployed code, and deployed/source schemas)');
    console.log('  4. Full controlled lifecycle resume (may perform Stage 2+ writes):');
    console.log('     node scripts/run_charterflow_pilot.js --resume');
    console.log('================================================================\n');
    return;
  }

  if (isReconcileStage2) {
    console.log('Stage 2 one-pass independent read diagnostic using SDK read methods only.');
    try {
      const result = await diagnoseStage2StudioReads(tempClient, evidence, {
        updateSupportDraft: true,
        transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
        includeExtraView: true,
      });
      console.log('\n--- STAGE 2 DIAGNOSTIC RESULT ---');
      console.log(`Observed: ${result.observedAt}`);
      console.log(`Transaction: ${result.txHash}`);
      console.log(`Round: ${result.roundId}`);
      console.log(`Verdict: ${result.verdict}`);
      console.log(`Failure class: ${result.failureClass || 'none'}`);
      console.log(`Write calls: ${result.writeCalls}`);
      if (result.verdict === 'VERIFIED') {
        console.log('\n--- STAGE 2 READBACK VERIFIED ---');
        console.log(`Contract balance: ${result.verification.contractBalanceWei} wei`);
        console.log('No write method was called. Later lifecycle writes were not started.');
        return;
      }
      console.error('Stage 2 remains INCONCLUSIVE. Partial reads are not verification.');
      process.exitCode = 1;
      return;
    } catch (err) {
      console.error(`Stage 2 read-only diagnostic failed: ${sanitizeErrorText(err?.message || String(err))}`);
      process.exitCode = 1;
      return;
    }
  }

  // --------------------------------------------------------------------------
  // MODE 3: READ-ONLY RECONCILIATION OF A RECORDED DEPLOYMENT
  // --------------------------------------------------------------------------
  if (isReconcileDeployment) {
    console.log('Reconciling recorded deployment using read-only RPC methods only.');
    const candidateCheck = await checkCandidateDeploymentSafety(
      tempClient,
      candidateHashes,
      candidateAddrs,
      creatorAddress
    );
    const decisionResult = evaluateStage1RecoveryDecision(candidateCheck);
    evidence.deploymentReconciliation = {
      attemptedAt: new Date().toISOString(),
      mode: 'READ_ONLY',
      sourceHash: actualSourceHash,
      chainId,
      rpcUrl: EXPECTED_RPC_URL,
      decision: decisionResult.decision,
      reason: decisionResult.reason,
      creatorLatestNonce: candidateCheck.creatorLatestNonce,
      creatorPendingNonce: candidateCheck.creatorPendingNonce,
      candidateTransactionLookups: sanitizeRpcEvidence(candidateCheck.hashesChecked),
    };

    if (decisionResult.decision !== 'ADOPT' || !decisionResult.adoptedDeployment) {
      evidence.deploymentReconciliation.status = 'INCONCLUSIVE_OR_UNSAFE';
      const finalizedCandidate = candidateCheck.finalizedSuccessfulTx;
      if (finalizedCandidate) {
        const candidateContractAddress = resolveDeploymentContractAddress(finalizedCandidate);
        evidence.latestDeploymentAttempt = {
          ...evidence.latestDeploymentAttempt,
          status: 'FINALIZED_READBACK_UNCERTAIN',
          candidateContractAddress,
        };
        evidence.stages.deploy = {
          ...evidence.stages.deploy,
          candidateContractAddress,
          statusName: finalizedCandidate.statusName,
          txExecutionResultName: finalizedCandidate.txExecutionResultName,
        };
        try {
          evidence.deploymentReconciliation.transactionSourceSha256 =
            hashDeploymentSourceFromTransaction(finalizedCandidate);
        } catch (sourceErr) {
          evidence.deploymentReconciliation.transactionSourceError =
            sanitizeErrorText(sourceErr.message);
        }
        evidence.deploymentReconciliation.rawReadbackDiagnostics =
          await collectRawDeploymentReadbackDiagnostics(
            finalizedCandidate.hash || latestCandidateHash,
            candidateContractAddress
          );
      }
      saveEvidence(evidence);
      console.error(`Read-only deployment reconciliation halted: ${decisionResult.reason}`);
      process.exitCode = 1;
      return;
    }

    const adopted = decisionResult.adoptedDeployment;
    try {
      const readback = await verifyAndRecordDeploymentReadback({
        client: tempClient,
        evidence,
        txHash: adopted.txHash,
        contractAddress: adopted.contractAddress,
        sourceCode: code,
        saveEvidenceOption: false,
      });
      evidence.contractAddress = adopted.contractAddress;
      evidence.stages.deploy = {
        ...evidence.stages.deploy,
        txHash: adopted.txHash,
        sourceHash: actualSourceHash,
        chainId,
        rpcUrl: EXPECTED_RPC_URL,
        statusName: adopted.statusName,
        txExecutionResultName: adopted.txExecutionResultName,
        contractAddress: adopted.contractAddress,
        readback,
        readbackVerified: true,
        readbackVerifiedAt: readback.verifiedAt,
      };
      evidence.latestDeploymentAttempt = {
        ...evidence.latestDeploymentAttempt,
        status: 'FINALIZED_SUCCESS_READBACK_VERIFIED',
        candidateContractAddress: adopted.contractAddress,
        readbackVerifiedAt: readback.verifiedAt,
      };
      evidence.deploymentReconciliation = {
        ...evidence.deploymentReconciliation,
        status: 'VERIFIED',
        verifiedAt: readback.verifiedAt,
        txHash: adopted.txHash,
        contractAddress: adopted.contractAddress,
        transactionSourceSha256: readback.transactionSourceSha256,
        codeResponseSha256: readback.codeResponseSha256,
        schemaCanonicalSha256: readback.schemaCanonicalSha256,
        schemaMatchesExactSource: readback.schemaMatchesExactSource,
      };
      saveEvidence(evidence);
      console.log('\n--- READ-ONLY DEPLOYMENT RECONCILIATION VERIFIED ---');
      console.log(`Transaction: ${adopted.txHash}`);
      console.log(`Contract:    ${adopted.contractAddress}`);
      console.log(`Source SHA-256: ${readback.transactionSourceSha256}`);
      console.log(`Code response SHA-256: ${readback.codeResponseSha256}`);
      console.log(`Schema SHA-256: ${readback.schemaCanonicalSha256}`);
      console.log('No deployContract or Stage 2+ write method was called.');
      return;
    } catch (readbackErr) {
      const rawReadbackDiagnostics = await collectRawDeploymentReadbackDiagnostics(
        adopted.txHash,
        adopted.contractAddress
      );
      evidence.deploymentReconciliation = {
        ...evidence.deploymentReconciliation,
        status: 'READBACK_UNCERTAIN',
        error: sanitizeErrorText(readbackErr?.message || String(readbackErr)),
        rawReadbackDiagnostics,
      };
      evidence.latestDeploymentAttempt = {
        ...evidence.latestDeploymentAttempt,
        status: 'FINALIZED_READBACK_UNCERTAIN',
      };
      saveEvidence(evidence);
      console.error(`Read-only deployment readback failed: ${readbackErr.message}`);
      process.exitCode = 1;
      return;
    }
  }

  if (isLifecycleOnly) {
    const reconciliation = evidence.deploymentReconciliation;
    const verifiedMs = Date.parse(reconciliation?.verifiedAt || '');
    const ageMs = Date.now() - verifiedMs;
    const mismatch =
      reconciliation?.status !== 'VERIFIED' ||
      reconciliation?.chainId !== EXPECTED_CHAIN_ID ||
      reconciliation?.sourceHash !== EXPECTED_SOURCE_HASH ||
      reconciliation?.transactionSourceSha256 !== EXPECTED_SOURCE_HASH ||
      reconciliation?.contractAddress?.toLowerCase() !== EXPECTED_PILOT_CONTRACT_ADDRESS.toLowerCase() ||
      reconciliation?.txHash?.toLowerCase() !== EXPECTED_PILOT_DEPLOYMENT_TX.toLowerCase() ||
      !Number.isFinite(verifiedMs) || ageMs < 0 || ageMs > 15 * 60 * 1000;
    if (mismatch) {
      recordFailure(evidence, 'lifecycleDeploymentGate', new Error(
        'Lifecycle-only mode requires a matching read-only deployment reconciliation no more than 15 minutes old'
      ));
      process.exitCode = 1;
      return;
    }
    const stage2 = evidence.stages?.createRound;
    const stage2Verified = stage2?.writeIntent?.readbackStatus === 'VERIFIED' &&
      Array.isArray(stage2?.readbackVerifications) && stage2.readbackVerifications.some(v => v?.status === 'VERIFIED');
    if (getDurableWriteHash(stage2) && !stage2Verified) {
      recordFailure(evidence, 'lifecycleStage2Gate', new Error(
        'Lifecycle-only mode refuses to continue from an existing create_round hash until --reconcile-stage2 records a complete VERIFIED readback'
      ));
      process.exitCode = 1;
      return;
    }
  }

  // --------------------------------------------------------------------------
  // MODE 4/5/6: DEPLOYMENT-ONLY, LIFECYCLE-ONLY, OR FULL CONTROLLED RESUME
  // --------------------------------------------------------------------------
  console.log(isDeploymentOnly
    ? '\n--- LOADING DEPLOYER ACCOUNT FROM OS KEYCHAIN ---'
    : '\n--- LOADING 4 PILOT ACCOUNTS FROM OS KEYCHAIN ---');
  let creatorAcc, memberAAcc, memberBAcc, recipAcc;
  try {
    creatorAcc = await getAccount('cf-pilot-creator');
    if (!isDeploymentOnly) {
      memberAAcc = await getAccount('cf-pilot-member-a');
      memberBAcc = await getAccount('cf-pilot-member-b');
      recipAcc = await getAccount('cf-pilot-recipient');
    }
  } catch (accErr) {
    recordFailure(evidence, 'accountLoad', accErr);
    process.exitCode = 1;
    return;
  }

  const expectedCreatorAddress = evidence.accounts?.creator?.address;
  if (!expectedCreatorAddress || creatorAcc.address.toLowerCase() !== expectedCreatorAddress.toLowerCase()) {
    const identityErr = new Error(
      `Keychain creator identity mismatch: loaded ${creatorAcc.address}, expected ${expectedCreatorAddress || 'missing evidence address'}`
    );
    recordFailure(evidence, 'accountIdentity', identityErr);
    return;
  }

  console.log('Creator identity verified:', creatorAcc.address);
  if (!isDeploymentOnly) {
    for (const [label, account, recorded] of [
      ['memberA', memberAAcc, evidence.accounts?.memberA?.address],
      ['memberB', memberBAcc, evidence.accounts?.memberB?.address],
      ['recipient', recipAcc, evidence.accounts?.recipient?.address],
    ]) {
      if (!recorded || account.address.toLowerCase() !== recorded.toLowerCase()) {
        recordFailure(evidence, 'accountIdentity', new Error(
          `Keychain ${label} identity mismatch: loaded ${account.address}, expected ${recorded || 'missing evidence address'}`
        ));
        process.exitCode = 1;
        return;
      }
    }
    console.log('Member A:  ', memberAAcc.address);
    console.log('Member B:  ', memberBAcc.address);
    console.log('Recipient: ', recipAcc.address);
  }

  const creatorClient = createClient({ chain: studioNext, account: creatorAcc });
  const memberAClient = isDeploymentOnly ? null : createClient({ chain: studioNext, account: memberAAcc });
  const memberBClient = isDeploymentOnly ? null : createClient({ chain: studioNext, account: memberBAcc });
  const recipClient = isDeploymentOnly ? null : createClient({ chain: studioNext, account: recipAcc });

  const creatorBal = await creatorClient.getBalance({ address: creatorAcc.address });
  const memberABal = isDeploymentOnly ? null : await memberAClient.getBalance({ address: memberAAcc.address });
  const memberBBal = isDeploymentOnly ? null : await memberBClient.getBalance({ address: memberBAcc.address });
  const recipBal = isDeploymentOnly ? null : await recipClient.getBalance({ address: recipAcc.address });

  console.log('\nCurrent Account Balances:');
  console.log(`Creator:   ${(Number(creatorBal) / 1e18).toFixed(4)} GEN (${creatorBal} wei)`);
  if (!isDeploymentOnly) {
    console.log(`Member A:  ${(Number(memberABal) / 1e18).toFixed(4)} GEN (${memberABal} wei)`);
    console.log(`Member B:  ${(Number(memberBBal) / 1e18).toFixed(4)} GEN (${memberBBal} wei)`);
    console.log(`Recipient: ${(Number(recipBal) / 1e18).toFixed(4)} GEN (${recipBal} wei)`);
  }

  evidence.accounts.creator.currentBalanceWei = creatorBal.toString();
  evidence.accounts.creator.currentBalanceGen = (Number(creatorBal) / 1e18).toFixed(4);
  evidence.accounts.creator.identityVerifiedAt = new Date().toISOString();
  evidence.accounts.creator.keychainIdentityMatched = true;

  if (!isDeploymentOnly && creatorBal < 1100000000000000000n) {
    process.exitCode = 1;
    throw new Error(`Creator has insufficient balance (${(Number(creatorBal) / 1e18).toFixed(4)} GEN < 1.1 GEN).`);
  }

  const creatorNonce = await creatorClient.getTransactionCount({ address: creatorAcc.address });
  console.log(`Creator on-chain transaction count (nonce): ${creatorNonce}`);

  saveEvidence(evidence);

  // --------------------------------------------------------------------------
  // STAGE 1: Contract Deployment (Resumable with candidate verification)
  // --------------------------------------------------------------------------
  console.log('\n--- STAGE 1: CONTRACT DEPLOYMENT ---');
  let contractAddress = evidence.stages?.deploy?.contractAddress || evidence.contractAddress;
  let deployTxHash = evidence.stages?.deploy?.txHash;

  if (deployTxHash && contractAddress) {
    console.log(`Found existing verified deployment in evidence: ${contractAddress} (tx: ${deployTxHash})`);
    try {
      const deployTx = await verifyTxFinalizedAndSuccessful(creatorClient, deployTxHash, 'deploy');
      const receiptContractAddress = resolveDeploymentContractAddress(deployTx);
      if (!receiptContractAddress) {
        throw new Error(`Verified deployment receipt ${deployTxHash} is missing its contract address`);
      }
      if (contractAddress.toLowerCase() !== receiptContractAddress.toLowerCase()) {
        throw new Error(
          `Saved deployment address ${contractAddress} does not match receipt address ${receiptContractAddress}`
        );
      }
      contractAddress = receiptContractAddress;
      evidence.stages.deploy = {
        ...evidence.stages.deploy,
        txHash: deployTxHash,
        statusName: deployTx.statusName,
        txExecutionResultName: deployTx.txExecutionResultName,
        contractAddress,
      };
      evidence.contractAddress = contractAddress;
      saveEvidence(evidence);
      console.log(`Deployment re-verified successfully at address: ${contractAddress}`);
    } catch (err) {
      recordFailure(evidence, 'deploy', err, deployTxHash);
      process.exitCode = 1;
      return;
    }
  } else {
    if (isLifecycleOnly) {
      recordFailure(evidence, 'deploy', new Error('Lifecycle-only mode has no deployment path and found no complete recorded deployment'));
      process.exitCode = 1;
      return;
    }
    // Perform candidate deployment safety check across EVERY distinct candidate hash
    console.log(`Checking candidate deployment safety across ${candidateHashes.length} candidate hashes...`);
    const candidateCheck = await checkCandidateDeploymentSafety(
      creatorClient,
      candidateHashes,
      candidateAddrs,
      creatorAcc.address
    );

    // Archive prior probe if timestamp is different
    if (evidence.candidateRecoveryProbe && evidence.candidateRecoveryProbe.timestamp !== candidateCheck.timestamp) {
      if (!Array.isArray(evidence.historicalProbes)) evidence.historicalProbes = [];
      const probeToArchive = { ...evidence.candidateRecoveryProbe };
      const alreadyArchived = evidence.historicalProbes.some(p => p.timestamp === probeToArchive.timestamp);
      if (!alreadyArchived) evidence.historicalProbes.push(probeToArchive);
    }

    evidence.candidateRecoveryProbe = {
      timestamp: candidateCheck.timestamp || new Date().toISOString(),
      probedAt: candidateCheck.timestamp || new Date().toISOString(),
      requestShape: candidateCheck.rawProbeRequest?.params ? JSON.stringify(candidateCheck.rawProbeRequest.params) : null,
      candidateTxHash: latestCandidateHash,
      candidateTxHashes: candidateHashes,
      candidateContractAddress: primaryCandidateAddress,
      candidateContractAddresses: candidateAddrs,
      candidateTransactionLookups: candidateCheck.hashesChecked,
      creatorLatestNonce: candidateCheck.creatorLatestNonce,
      creatorPendingNonce: candidateCheck.creatorPendingNonce,
      candidateCode: candidateCheck.hasExistingCode
        ? `CODE_FOUND (hash: ${candidateCheck.contractCodeHash})`
        : '0x (empty bytecode)',
      contractCodeHash: candidateCheck.contractCodeHash,
      contractCodeProbeStatus: candidateCheck.contractCodeProbeStatus,
      rpcError: (candidateCheck.dbError || candidateCheck.ambiguityReason)
        ? sanitizeErrorText(candidateCheck.dbError || candidateCheck.ambiguityReason)
        : null,
      verdict: candidateCheck.hasExistingCode
        ? `Candidate address ${primaryCandidateAddress} already contains deployed contract code (codeHash: ${candidateCheck.contractCodeHash}). Hard-stop triggered: investigate existing contract and candidate transaction before any deployment retry.`
        : candidateCheck.dbError
        ? `Node/database probe returned RPC error: ${sanitizeErrorText(candidateCheck.dbError)}`
        : candidateCheck.ambiguityReason
        ? `Node/database query ambiguous: ${sanitizeErrorText(candidateCheck.ambiguityReason)}`
        : 'Candidate deployment was not found at the recorded probe time, with empty code and latest/pending nonce 0. Query result is -32001 (not found), which is an observation of undeployed state, not proof that writes are healthy.',
      blocksBroadcast: candidateCheck.blocksBroadcast,
      disclaimer: 'Healthy read responses indicate RPC read endpoints respond. They do not prove database writes are healthy.',
    };
    saveEvidence(evidence);

    const stage1Result = await executeStage1RecoveryStep({
      creatorClient,
      candidateCheck,
      code,
      evidence,
      creatorAddress: creatorAcc.address,
      creatorNonce,
      candidateHashes,
      candidateAddrs,
      primaryCandidateAddress,
      latestCandidateHash,
      deploymentOnly: isDeploymentOnly,
      creatorBalanceWei: creatorBal,
    });

    if (!stage1Result.contractAddress) {
      process.exitCode = 1;
      return;
    }
    contractAddress = stage1Result.contractAddress;
    deployTxHash = stage1Result.txHash || deployTxHash;
  }

  if (isDeploymentOnly) {
    if (!deployTxHash || !contractAddress) {
      recordFailure(
        evidence,
        'deployReadback',
        new Error('Deployment-only mode cannot verify readback without both transaction hash and contract address')
      );
      return;
    }
    try {
      const readback = await verifyAndRecordDeploymentReadback({
        client: creatorClient,
        evidence,
        txHash: deployTxHash,
        contractAddress,
        sourceCode: code,
      });
      console.log('\n--- DEPLOYMENT-ONLY READBACK VERIFIED ---');
      console.log(`Transaction: ${deployTxHash}`);
      console.log(`Contract:    ${contractAddress}`);
      console.log(`Code SHA-256: ${readback.codeResponseSha256}`);
      console.log(`Schema SHA-256: ${readback.schemaCanonicalSha256}`);
      console.log('Deployment-only mode complete. Stopping before Stage 2; no round or lifecycle writes were attempted.');
      return;
    } catch (readbackErr) {
      evidence.latestDeploymentAttempt = {
        ...evidence.latestDeploymentAttempt,
        status: 'FINALIZED_READBACK_UNCERTAIN',
        readbackError: sanitizeErrorText(readbackErr?.message || String(readbackErr)),
      };
      recordFailure(evidence, 'deployReadback', readbackErr, deployTxHash, {
        sourceHash: EXPECTED_SOURCE_HASH,
        contractAddress,
      });
      return;
    }
  }

  if (!contractAddress) {
    process.exitCode = 1;
    return;
  }

  // --------------------------------------------------------------------------
  // STAGE 2: Create Round (Resumable with explicit intent matching)
  // --------------------------------------------------------------------------
  console.log('\n--- STAGE 2: CREATE ROUND (1.0 GEN DEPOSIT) ---');
  const createRoundPlan = planDurableStageResume(evidence.stages?.createRound, 'createRound');
  let createRoundTxHash = createRoundPlan.txHash;

  // Persist intended round before any write call
  const intendedRound = evidence.stages?.createRound?.intendedRound || {
    roundId: `rnd-pilot-${Date.now().toString().slice(-6)}`,
    title: 'Pilot Grant Round',
    description: 'A controlled live pilot on Studio Next testing governance and payments.',
    charterText:
      "CharterFlow Directive 1: All proposals must produce open source software.\n" +
      "Directive 2: Deliverables must include clean documented code, test suites, and verifiable repositories.\n" +
      "Directive 3: Deliverables must provide public benefit and avoid closed proprietary licensing.",
    committee: [memberAAcc.address.toLowerCase(), memberBAcc.address.toLowerCase()],
    grantCapWei: '1000000000000000000', // 1.0 GEN
    depositWei: '1000000000000000000', // 1.0 GEN
    creatorAddress: creatorAcc.address.toLowerCase(),
    cutoffSecOffset: 7200,
    durationSec: 3600,
    roundEndSecOffset: 200000,
  };

  if (!evidence.stages.createRound) evidence.stages.createRound = {};
  evidence.stages.createRound.intendedRound = intendedRound;
  saveEvidence(evidence);

  let roundId = intendedRound.roundId;

  if (createRoundTxHash) {
    console.log(`Found existing create_round txHash: ${createRoundTxHash}`);
    try {
      const crTx = await verifyTxFinalizedAndSuccessful(creatorClient, createRoundTxHash, 'createRound');
      const onChainRound = await creatorClient.readContract({
        address: contractAddress,
        functionName: 'get_round',
        args: [roundId],
      });
      verifyRoundMatchesIntent(onChainRound, intendedRound);
      evidence.stages.createRound.statusName = crTx.statusName;
      evidence.stages.createRound.txExecutionResultName = crTx.txExecutionResultName;
      evidence.stages.createRound.roundId = roundId;
      saveEvidence(evidence);
      console.log(`Verified existing create_round on chain matching intended round ${roundId}`);
    } catch (err) {
      recordFailure(evidence, 'createRound', err, createRoundTxHash);
      process.exitCode = 1;
      return;
    }
  } else {
    // Check if intended round already exists on chain (exact ID and parameters)
    let existingMatchingRound = null;
    try {
      const r = await creatorClient.readContract({
        address: contractAddress,
        functionName: 'get_round',
        args: [roundId],
      });
      verifyRoundMatchesIntent(r, intendedRound);
      existingMatchingRound = r;
      console.log(`Found matching intended round ${roundId} already existing on chain.`);
      evidence.stages.createRound.roundId = roundId;
      evidence.stages.createRound.resumedFromExisting = true;
      saveEvidence(evidence);
    } catch (e) {
      const missingRound = isDefinitiveContractReadNotFound(e, 'ERR_ROUND_NOT_FOUND');
      if (!missingRound) {
        recordFailure(evidence, 'createRoundPreflightRead', e);
        process.exitCode = 1;
        return;
      }
    }

    if (!existingMatchingRound) {
      const nowSec = Math.floor(Date.now() / 1000);
      const cutoffSec = BigInt(nowSec + intendedRound.cutoffSecOffset);
      const durationSec = BigInt(intendedRound.durationSec);
      const roundEndSec = BigInt(nowSec + intendedRound.roundEndSecOffset);
      const depositWei = BigInt(intendedRound.depositWei);
      const grantCapWei = BigInt(intendedRound.grantCapWei);

      const createRoundArgs = [
        roundId,
        intendedRound.title,
        intendedRound.description,
        intendedRound.charterText,
        [memberAAcc.address, memberBAcc.address],
        grantCapWei,
        cutoffSec,
        durationSec,
        roundEndSec,
      ];

      try {
        console.log(`Estimating fees for create_round (${roundId})...`);
        const crFees = await creatorClient.estimateTransactionFees({
          address: contractAddress,
          functionName: 'create_round',
          args: createRoundArgs,
          value: depositWei,
          leaderOnly: false,
        });

        const creatorBalanceBefore = await creatorClient.getBalance({ address: creatorAcc.address });
        const creatorNonceBefore = await creatorClient.getTransactionCount({ address: creatorAcc.address, blockTag: 'pending' });
        const fundingGate = requireSufficientWriteBalance(creatorBalanceBefore, crFees, depositWei, 'create_round');
        evidence.stages.createRound.preBroadcast = { ...fundingGate, measuredAt: new Date().toISOString() };
        evidence.stages.createRound.feeEstimate = sanitizeRpcEvidence(crFees);
        saveEvidence(evidence);

        console.log('Submitting create_round transaction...');
        createRoundTxHash = await executeDurableStageWrite({
          evidence,
          stageName: 'createRound',
          request: { address: contractAddress, functionName: 'create_round', args: createRoundArgs, value: depositWei },
          feeEstimate: crFees,
          senderAddress: creatorAcc.address,
          senderNonce: creatorNonceBefore,
          submit: () => creatorClient.writeContract({
            address: contractAddress,
            functionName: 'create_round',
            args: createRoundArgs,
            value: depositWei,
            fees: crFees,
          }),
        });
        console.log(`create_round submitted: ${createRoundTxHash}`);

        // Persist immediately before waiting for finality
        evidence.stages.createRound.txHash = createRoundTxHash;
        evidence.stages.createRound.roundId = roundId;
        evidence.stages.createRound.depositWei = depositWei.toString();
        evidence.stages.createRound.submittedAt = new Date().toISOString();
        saveEvidence(evidence);

        console.log('Waiting for create_round finalization...');
        const crTx = await verifyTxFinalizedAndSuccessful(creatorClient, createRoundTxHash, 'createRound');
        markDurableStageWriteFinalized(evidence, 'createRound', crTx);
        evidence.stages.createRound.statusName = crTx.statusName;
        evidence.stages.createRound.txExecutionResultName = crTx.txExecutionResultName;
        saveEvidence(evidence);
      } catch (err) {
        recordFailure(evidence, 'createRound', err, createRoundTxHash);
        process.exitCode = 1;
        return;
      }
    }
  }

  // Read and verify round state and contract balance post-genesis
  let roundStateGenesis;
  let contractBalGenesis;
  try {
    roundStateGenesis = await creatorClient.readContract({
      address: contractAddress,
      functionName: 'get_round',
      args: [roundId],
    });
    contractBalGenesis = await creatorClient.getBalance({ address: contractAddress });
  } catch (err) {
    if (evidence.stages.createRound?.writeIntent) {
      evidence.stages.createRound.writeIntent.status = 'FINALIZED_SUCCESS_READBACK_UNCERTAIN';
      evidence.stages.createRound.writeIntent.readbackStatus = 'INCONCLUSIVE_RPC_DATABASE_ERROR';
      evidence.stages.createRound.writeIntent.readbackError = sanitizeErrorText(err?.message || String(err));
    }
    recordFailure(evidence, 'createRoundReadback', err, createRoundTxHash);
    process.exitCode = 1;
    return;
  }
  let genesisAccounting;
  try {
    verifyRoundMatchesIntent(roundStateGenesis, intendedRound);
    genesisAccounting = verifyRoundAccountingInvariant(roundStateGenesis, 'create_round');
    const beforeNomination = !getDurableWriteHash(evidence.stages?.nominate);
    if (BigInt(roundStateGenesis.initial_deposit) !== BigInt(intendedRound.depositWei) ||
        (beforeNomination && (BigInt(roundStateGenesis.available_wei) !== BigInt(intendedRound.depositWei) ||
        BigInt(roundStateGenesis.reserved_wei) !== 0n || BigInt(roundStateGenesis.approved_credits_wei) !== 0n))) {
      throw new Error('create_round ledger readback does not match the exact intended deposit and zero-allocation genesis state');
    }
  } catch (err) {
    recordFailure(evidence, 'createRoundReadback', err, createRoundTxHash);
    process.exitCode = 1;
    return;
  }
  console.log(`Round State: ${roundStateGenesis.state}`);
  console.log(`Round Available Wei: ${roundStateGenesis.available_wei}`);
  console.log(`Contract Balance: ${contractBalGenesis} wei (${(Number(contractBalGenesis) / 1e18).toFixed(4)} GEN)`);
  evidence.stages.createRound.roundState = roundStateGenesis;
  evidence.stages.createRound.contractBalanceWei = contractBalGenesis.toString();
  evidence.stages.createRound.accountingInvariant = genesisAccounting;
  saveEvidence(evidence);

  // --------------------------------------------------------------------------
  // STAGE 3: Nominate Proposal (Resumable with explicit intent matching)
  // --------------------------------------------------------------------------
  console.log('\n--- STAGE 3: NOMINATE CHARTER-COMPLIANT PROPOSAL ---');
  let nominateTxHash = getDurableWriteHash(evidence.stages?.nominate);

  // Persist intended proposal identity and parameters before any write call
  const intendedProposal = evidence.stages?.nominate?.intendedProposal || {
    roundId: roundId,
    recipient: recipAcc.address.toLowerCase(),
    title: 'Open Source GenVM Compliance Verifier',
    requestedAmountWei: '50000000000000000', // 0.05 GEN
    requestedCreditWei: '50000000000000000',
    deliverablesText:
      "We are delivering a fully open-source verification package for decentralized grants under the MIT license. " +
      "This deliverable includes a comprehensive unit test suite, automated coverage reports, public documentation, " +
      "and complete repository source code published openly on GitHub without any proprietary or closed dependencies.",
    proposer: memberAAcc.address.toLowerCase(),
    nominator: memberAAcc.address.toLowerCase(),
  };

  if (!evidence.stages.nominate) evidence.stages.nominate = {};
  evidence.stages.nominate.intendedProposal = intendedProposal;
  saveEvidence(evidence);

  let proposalId = evidence.stages?.nominate?.proposalId;

  if (nominateTxHash) {
    console.log(`Found existing nomination txHash: ${nominateTxHash}`);
    try {
      const nomTx = await verifyTxFinalizedAndSuccessful(memberAClient, nominateTxHash, 'nominate');
      proposalId = await correlateResumeProposalId({
        client: creatorClient,
        contractAddress,
        roundId,
        intendedProposal,
        savedProposalId: proposalId,
        nominateTxHash,
        preBroadcastSnapshot: evidence.stages?.nominate?.preBroadcastSnapshot || null,
        txReceipt: nomTx,
      });

      evidence.stages.nominate.proposalId = proposalId;
      evidence.stages.nominate.statusName = nomTx.statusName;
      evidence.stages.nominate.txExecutionResultName = nomTx.txExecutionResultName;
      saveEvidence(evidence);
      console.log(`Verified nomination tx and correlated proposal ID: ${proposalId}`);
    } catch (err) {
      recordFailure(evidence, 'nominate', err, nominateTxHash);
      process.exitCode = 1;
      return;
    }
  } else {
    // When there is no saved nomination txHash, never adopt an existing proposal merely because content matches.
    try {
      const windowCheck = await assertNominationWindowOpenOnChain(creatorClient, contractAddress, roundId);
      evidence.stages.nominate.nominationWindowCheck = {
        ...windowCheck,
        checkedAt: new Date().toISOString(),
      };
      saveEvidence(evidence);
    } catch (err) {
      recordFailure(evidence, 'nominateWindow', err, null);
      process.exitCode = 1;
      return;
    }

    // Persist pre-broadcast snapshot FIRST before broadcasting.
    const nominateArgs = [
      roundId,
      recipAcc.address,
      intendedProposal.title,
      BigInt(intendedProposal.requestedAmountWei || intendedProposal.requestedCreditWei),
      intendedProposal.deliverablesText,
    ];

    try {
      console.log('Snapshotting existing round proposal IDs before nomination...');
      const summariesBefore = await fetchAllRoundProposalSummaries(creatorClient, contractAddress, roundId);
      const preBroadcastSnapshot = summariesBefore.map(s => s.proposal_id);
      const idsBeforeSet = new Set(preBroadcastSnapshot);

      // Persist snapshot BEFORE broadcast so resume can prove delta if broadcast succeeds but correlation fails
      evidence.stages.nominate.preBroadcastSnapshot = preBroadcastSnapshot;
      saveEvidence(evidence);

      console.log('Estimating nominate_proposal fees...');
      const nomFees = await memberAClient.estimateTransactionFees({
        address: contractAddress,
        functionName: 'nominate_proposal',
        args: nominateArgs,
        leaderOnly: false,
      });

      const memberABalanceBefore = await memberAClient.getBalance({ address: memberAAcc.address });
      const memberANonceBefore = await memberAClient.getTransactionCount({ address: memberAAcc.address, blockTag: 'pending' });
      evidence.stages.nominate.preBroadcast = requireSufficientWriteBalance(memberABalanceBefore, nomFees, 0n, 'nominate_proposal');
      evidence.stages.nominate.feeEstimate = sanitizeRpcEvidence(nomFees);
      saveEvidence(evidence);

      console.log('Submitting nominate_proposal transaction...');
      nominateTxHash = await executeDurableStageWrite({
        evidence,
        stageName: 'nominate',
        request: { address: contractAddress, functionName: 'nominate_proposal', args: nominateArgs },
        feeEstimate: nomFees,
        senderAddress: memberAAcc.address,
        senderNonce: memberANonceBefore,
        submit: () => memberAClient.writeContract({
          address: contractAddress,
          functionName: 'nominate_proposal',
          args: nominateArgs,
          fees: nomFees,
        }),
      });
      console.log(`nominate_proposal submitted: ${nominateTxHash}`);

      // Persist immediately so txHash is preserved on failure
      evidence.stages.nominate.txHash = nominateTxHash;
      evidence.stages.nominate.submittedAt = new Date().toISOString();
      saveEvidence(evidence);

      console.log('Waiting for nomination finalization...');
      const nomTx = await verifyTxFinalizedAndSuccessful(memberAClient, nominateTxHash, 'nominate');
      markDurableStageWriteFinalized(evidence, 'nominate', nomTx);

      console.log('Correlating newly nominated proposal ID from transaction return or before/after set diff...');
      proposalId = await correlateNominatedProposalId({
        client: creatorClient,
        contractAddress,
        roundId,
        intendedProposal,
        idsBeforeSet,
        nominateTxHash,
        txReceipt: nomTx,
      });

      evidence.stages.nominate.proposalId = proposalId;
      evidence.stages.nominate.statusName = nomTx.statusName;
      evidence.stages.nominate.txExecutionResultName = nomTx.txExecutionResultName;
      saveEvidence(evidence);
      console.log(`Successfully correlated nominated proposal ID: ${proposalId}`);
    } catch (err) {
      recordFailure(evidence, 'nominate', err, nominateTxHash);
      process.exitCode = 1;
      return;
    }
  }

  const proposalStateNom = await creatorClient.readContract({
    address: contractAddress,
    functionName: 'get_proposal',
    args: [proposalId],
  });
  const roundStateNom = await creatorClient.readContract({
    address: contractAddress,
    functionName: 'get_round',
    args: [roundId],
  });
  let nominationAccounting;
  const requestedWei = BigInt(intendedProposal.requestedAmountWei || intendedProposal.requestedCreditWei);
  try {
    verifyProposalMatchesIntent(proposalStateNom, intendedProposal, proposalId);
    nominationAccounting = verifyRoundAccountingInvariant(roundStateNom, 'nominate_proposal');
    const beforeReview = !getDurableWriteHash(evidence.stages?.aiReview);
    if (beforeReview && (proposalStateNom.state !== 'SUBMITTED' || BigInt(roundStateNom.reserved_wei) !== requestedWei ||
        BigInt(roundStateNom.available_wei) !== BigInt(intendedRound.depositWei) - requestedWei)) {
      throw new Error('nominate_proposal readback does not prove the exact reserved/available ledger transition');
    }
  } catch (err) {
    recordFailure(evidence, 'nominateReadback', err, nominateTxHash);
    process.exitCode = 1;
    return;
  }
  console.log(`Proposal ID: ${proposalId}`);
  console.log(`Proposal State: ${proposalStateNom.state}`);
  console.log(`Round Reserved Wei: ${roundStateNom.reserved_wei}`);
  evidence.stages.nominate.proposalState = proposalStateNom;
  evidence.stages.nominate.roundState = roundStateNom;
  evidence.stages.nominate.accountingInvariant = nominationAccounting;
  saveEvidence(evidence);

  // --------------------------------------------------------------------------
  // STAGE 4: Real Studio AI Review (evaluate_charter_fit)
  // --------------------------------------------------------------------------
  console.log('\n--- STAGE 4: REAL STUDIO AI REVIEW (evaluate_charter_fit) ---');
  let reviewTxHash = getDurableWriteHash(evidence.stages?.aiReview);

  if (reviewTxHash) {
    console.log(`Found existing evaluate_charter_fit txHash: ${reviewTxHash}`);
    try {
      const revTx = await verifyTxFinalizedAndSuccessful(creatorClient, reviewTxHash, 'aiReview');
      evidence.stages.aiReview.statusName = revTx.statusName;
      evidence.stages.aiReview.txExecutionResultName = revTx.txExecutionResultName;
      saveEvidence(evidence);
    } catch (err) {
      recordFailure(evidence, 'aiReview', err, reviewTxHash);
      process.exitCode = 1;
      return;
    }
  } else {
    if (proposalStateNom.state !== 'SUBMITTED') {
      console.log(`Proposal already reviewed or advanced! Current state: ${proposalStateNom.state}`);
    } else {
      try {
        console.log('Estimating evaluate_charter_fit fees...');
        const reviewFees = await creatorClient.estimateTransactionFees({
          address: contractAddress,
          functionName: 'evaluate_charter_fit',
          args: [proposalId],
          leaderOnly: false,
        });

        const reviewBalance = await creatorClient.getBalance({ address: creatorAcc.address });
        const reviewNonce = await creatorClient.getTransactionCount({ address: creatorAcc.address, blockTag: 'pending' });
        if (!evidence.stages.aiReview) evidence.stages.aiReview = {};
        evidence.stages.aiReview.preBroadcast = requireSufficientWriteBalance(reviewBalance, reviewFees, 0n, 'evaluate_charter_fit');
        evidence.stages.aiReview.feeEstimate = sanitizeRpcEvidence(reviewFees);
        saveEvidence(evidence);

        console.log('Submitting evaluate_charter_fit transaction...');
        reviewTxHash = await executeDurableStageWrite({
          evidence,
          stageName: 'aiReview',
          request: { address: contractAddress, functionName: 'evaluate_charter_fit', args: [proposalId] },
          feeEstimate: reviewFees,
          senderAddress: creatorAcc.address,
          senderNonce: reviewNonce,
          submit: () => creatorClient.writeContract({
            address: contractAddress,
            functionName: 'evaluate_charter_fit',
            args: [proposalId],
            fees: reviewFees,
          }),
        });
        console.log(`evaluate_charter_fit submitted: ${reviewTxHash}`);

        evidence.stages.aiReview.submittedAt = new Date().toISOString();
        saveEvidence(evidence);

        console.log('Waiting for multi-validator AI consensus finalization...');
        const revTx = await verifyTxFinalizedAndSuccessful(creatorClient, reviewTxHash, 'aiReview');
        markDurableStageWriteFinalized(evidence, 'aiReview', revTx);
        evidence.stages.aiReview.statusName = revTx.statusName;
        evidence.stages.aiReview.txExecutionResultName = revTx.txExecutionResultName;
        saveEvidence(evidence);
      } catch (err) {
        recordFailure(evidence, 'aiReview', err, reviewTxHash);
        process.exitCode = 1;
        return;
      }
    }
  }

  const proposalStateRev = await creatorClient.readContract({
    address: contractAddress,
    functionName: 'get_proposal',
    args: [proposalId],
  });
  console.log(`AI Review Verdict: ${proposalStateRev.review_verdict}`);
  console.log(`AI Review Reason:  ${proposalStateRev.review_reason}`);
  console.log(`Proposal State:    ${proposalStateRev.state}`);

  evidence.stages.aiReview = {
    ...evidence.stages.aiReview,
    verdict: proposalStateRev.review_verdict,
    reason: proposalStateRev.review_reason,
    proposalState: proposalStateRev,
    rationaleTrustDisclosure: 'The stored reason is deterministic text derived from the consensus-verified categorical verdict; it is not a model-authored semantic rationale verified by validators.',
  };
  saveEvidence(evidence);

  if (proposalStateRev.state !== 'ELIGIBLE') {
    console.log(`\n[STOPPING WORKFLOW: AI REVIEW OUTCOME WAS ${proposalStateRev.state}]`);
    console.log('Reporting actual outcome without forcing green result.');
    process.exitCode = 1;
    return;
  }

  // --------------------------------------------------------------------------
  // STAGE 5: Committee Governance Voting (2/3 Threshold)
  // --------------------------------------------------------------------------
  console.log('\n--- STAGE 5: COMMITTEE GOVERNANCE VOTING ---');
  let vote1TxHash = getDurableWriteHash(evidence.stages?.voting, 'vote1Intent', 'vote1TxHash');
  let vote2TxHash = getDurableWriteHash(evidence.stages?.voting, 'vote2Intent', 'vote2TxHash');

  // Vote 1: Member A
  if (vote1TxHash) {
    console.log(`Found existing Vote 1 txHash: ${vote1TxHash}`);
    try {
      const v1Tx = await verifyTxFinalizedAndSuccessful(memberAClient, vote1TxHash, 'vote1');
      if (!evidence.stages.voting) evidence.stages.voting = {};
      evidence.stages.voting.vote1StatusName = v1Tx.statusName;
      evidence.stages.voting.vote1ResultName = v1Tx.txExecutionResultName;
      saveEvidence(evidence);
    } catch (err) {
      recordFailure(evidence, 'vote1', err, vote1TxHash);
      process.exitCode = 1;
      return;
    }
  } else {
    try {
      console.log('Member A casting vote (YES)...');
      const v1Fees = await memberAClient.estimateTransactionFees({
        address: contractAddress,
        functionName: 'cast_vote',
        args: [proposalId, 'YES'],
        leaderOnly: false,
      });
      const v1Balance = await memberAClient.getBalance({ address: memberAAcc.address });
      const v1Nonce = await memberAClient.getTransactionCount({ address: memberAAcc.address, blockTag: 'pending' });
      if (!evidence.stages.voting) evidence.stages.voting = {};
      evidence.stages.voting.vote1PreBroadcast = requireSufficientWriteBalance(v1Balance, v1Fees, 0n, 'cast_vote member A');
      evidence.stages.voting.vote1FeeEstimate = sanitizeRpcEvidence(v1Fees);
      saveEvidence(evidence);
      vote1TxHash = await executeDurableStageWrite({
        evidence,
        stageName: 'voting',
        intentKey: 'vote1Intent',
        txHashField: 'vote1TxHash',
        request: { address: contractAddress, functionName: 'cast_vote', args: [proposalId, 'YES'] },
        feeEstimate: v1Fees,
        senderAddress: memberAAcc.address,
        senderNonce: v1Nonce,
        submit: () => memberAClient.writeContract({
          address: contractAddress,
          functionName: 'cast_vote',
          args: [proposalId, 'YES'],
          fees: v1Fees,
        }),
      });
      console.log(`Vote 1 submitted: ${vote1TxHash}`);
      if (!evidence.stages.voting) evidence.stages.voting = {};
      evidence.stages.voting.vote1TxHash = vote1TxHash;
      saveEvidence(evidence);

      const v1Tx = await verifyTxFinalizedAndSuccessful(memberAClient, vote1TxHash, 'vote1');
      markDurableStageWriteFinalized(evidence, 'voting', v1Tx, 'vote1Intent');
      evidence.stages.voting.vote1StatusName = v1Tx.statusName;
      evidence.stages.voting.vote1ResultName = v1Tx.txExecutionResultName;
      saveEvidence(evidence);
    } catch (err) {
      recordFailure(evidence, 'vote1', err, vote1TxHash);
      process.exitCode = 1;
      return;
    }
  }

  // Vote 2: Member B
  if (vote2TxHash) {
    console.log(`Found existing Vote 2 txHash: ${vote2TxHash}`);
    try {
      const v2Tx = await verifyTxFinalizedAndSuccessful(memberBClient, vote2TxHash, 'vote2');
      evidence.stages.voting.vote2StatusName = v2Tx.statusName;
      evidence.stages.voting.vote2ResultName = v2Tx.txExecutionResultName;
      saveEvidence(evidence);
    } catch (err) {
      recordFailure(evidence, 'vote2', err, vote2TxHash);
      process.exitCode = 1;
      return;
    }
  } else {
    try {
      console.log('Member B casting vote (YES)...');
      const v2Fees = await memberBClient.estimateTransactionFees({
        address: contractAddress,
        functionName: 'cast_vote',
        args: [proposalId, 'YES'],
        leaderOnly: false,
      });
      const v2Balance = await memberBClient.getBalance({ address: memberBAcc.address });
      const v2Nonce = await memberBClient.getTransactionCount({ address: memberBAcc.address, blockTag: 'pending' });
      evidence.stages.voting.vote2PreBroadcast = requireSufficientWriteBalance(v2Balance, v2Fees, 0n, 'cast_vote member B');
      evidence.stages.voting.vote2FeeEstimate = sanitizeRpcEvidence(v2Fees);
      saveEvidence(evidence);
      vote2TxHash = await executeDurableStageWrite({
        evidence,
        stageName: 'voting',
        intentKey: 'vote2Intent',
        txHashField: 'vote2TxHash',
        request: { address: contractAddress, functionName: 'cast_vote', args: [proposalId, 'YES'] },
        feeEstimate: v2Fees,
        senderAddress: memberBAcc.address,
        senderNonce: v2Nonce,
        submit: () => memberBClient.writeContract({
          address: contractAddress,
          functionName: 'cast_vote',
          args: [proposalId, 'YES'],
          fees: v2Fees,
        }),
      });
      console.log(`Vote 2 submitted: ${vote2TxHash}`);
      evidence.stages.voting.vote2TxHash = vote2TxHash;
      saveEvidence(evidence);

      const v2Tx = await verifyTxFinalizedAndSuccessful(memberBClient, vote2TxHash, 'vote2');
      markDurableStageWriteFinalized(evidence, 'voting', v2Tx, 'vote2Intent');
      evidence.stages.voting.vote2StatusName = v2Tx.statusName;
      evidence.stages.voting.vote2ResultName = v2Tx.txExecutionResultName;
      saveEvidence(evidence);
    } catch (err) {
      recordFailure(evidence, 'vote2', err, vote2TxHash);
      process.exitCode = 1;
      return;
    }
  }

  const proposalStateVote = await creatorClient.readContract({
    address: contractAddress,
    functionName: 'get_proposal',
    args: [proposalId],
  });
  const roundStateVote = await creatorClient.readContract({
    address: contractAddress,
    functionName: 'get_round',
    args: [roundId],
  });
  const votingAccounting = verifyRoundAccountingInvariant(roundStateVote, 'committee voting');

  console.log(`Votes Yes: ${proposalStateVote.votes_yes}, Votes No: ${proposalStateVote.votes_no}`);
  console.log(`Proposal State post-voting: ${proposalStateVote.state}`);
  console.log(`Approved Credits Wei: ${roundStateVote.approved_credits_wei}`);

  evidence.stages.voting.proposalState = proposalStateVote;
  evidence.stages.voting.roundState = roundStateVote;
  evidence.stages.voting.accountingInvariant = votingAccounting;
  saveEvidence(evidence);

  if (proposalStateVote.state !== 'APPROVED') {
    const msg = `Proposal did not reach APPROVED state: ${proposalStateVote.state}`;
    recordFailure(evidence, 'voting', new Error(msg));
    process.exitCode = 1;
    return;
  }
  const beforeWithdrawal = !getDurableWriteHash(evidence.stages?.withdrawal);
  if (beforeWithdrawal && (BigInt(proposalStateVote.votes_yes) !== 2n || BigInt(proposalStateVote.votes_no) !== 0n ||
      BigInt(roundStateVote.reserved_wei) !== 0n || BigInt(roundStateVote.approved_credits_wei) !== requestedWei)) {
    recordFailure(evidence, 'voting', new Error('Voting readback does not prove 2-0 approval and exact reserved-to-approved movement'));
    process.exitCode = 1;
    return;
  }

  // --------------------------------------------------------------------------
  // STAGE 6: Unauthorized Withdrawal Rejection Test (Negative Test)
  // --------------------------------------------------------------------------
  const unauthTestResult = await executeNegativeWithdrawalTest({
    client: creatorClient,
    readClient: creatorClient,
    contractAddress,
    proposalId,
    roundId,
    expectedErrorReason: 'ERR_CALLER_NOT_RECIPIENT',
    testName: 'Unauthorized Withdrawal Rejection (Creator calling withdraw_credit)',
    evidence,
    stageName: 'unauthorizedWithdrawal',
    senderAddress: creatorAcc.address,
  });

  console.log(`Unauthorized withdrawal test outcome: ${unauthTestResult.outcome}`);
  console.log(`Detail: ${unauthTestResult.reason}`);
  evidence.stages.unauthorizedWithdrawal = { ...evidence.stages.unauthorizedWithdrawal, ...unauthTestResult };
  saveEvidence(evidence);

  if (unauthTestResult.outcome !== 'PASS') {
    console.error(`Unauthorized withdrawal test did not PASS (result=${unauthTestResult.outcome}). Halting runner.`);
    process.exitCode = 1;
    return;
  }

  // --------------------------------------------------------------------------
  // STAGE 7: Authorized Recipient Withdrawal via emit_transfer
  // --------------------------------------------------------------------------
  console.log('\n--- STAGE 7: AUTHORIZED RECIPIENT WITHDRAWAL ---');
  let withdrawTxHash = getDurableWriteHash(evidence.stages?.withdrawal);

  const recipBalBefore = await recipClient.getBalance({ address: recipAcc.address });
  const contractBalBefore = await creatorClient.getBalance({ address: contractAddress });

  if (withdrawTxHash) {
    console.log(`Found existing withdraw_credit txHash: ${withdrawTxHash}`);
    try {
      const wTx = await verifyTxFinalizedAndSuccessful(recipClient, withdrawTxHash, 'withdrawal');
      evidence.stages.withdrawal.statusName = wTx.statusName;
      evidence.stages.withdrawal.txExecutionResultName = wTx.txExecutionResultName;
      evidence.stages.withdrawal.emittedMessages = wTx.messages || [];
      saveEvidence(evidence);
    } catch (err) {
      recordFailure(evidence, 'withdrawal', err, withdrawTxHash);
      process.exitCode = 1;
      return;
    }
  } else {
    try {
      console.log('Estimating withdraw_credit fees for recipient...');
      const wFees = await recipClient.estimateTransactionFees({
        address: contractAddress,
        functionName: 'withdraw_credit',
        args: [proposalId],
        leaderOnly: false,
      });

      const messageFeeWei = requireExplicitMessageFee(wFees, 'withdraw_credit');
      const withdrawalBalance = await recipClient.getBalance({ address: recipAcc.address });
      const withdrawalNonce = await recipClient.getTransactionCount({ address: recipAcc.address, blockTag: 'pending' });
      if (!evidence.stages.withdrawal) evidence.stages.withdrawal = {};
      evidence.stages.withdrawal.preBroadcast = {
        ...requireSufficientWriteBalance(withdrawalBalance, wFees, 0n, 'withdraw_credit'),
        messageFeeWei: messageFeeWei.toString(),
        measuredAt: new Date().toISOString(),
      };
      evidence.stages.withdrawal.feeEstimate = sanitizeRpcEvidence(wFees);
      saveEvidence(evidence);

      console.log('Submitting withdraw_credit transaction...');
      withdrawTxHash = await executeDurableStageWrite({
        evidence,
        stageName: 'withdrawal',
        request: { address: contractAddress, functionName: 'withdraw_credit', args: [proposalId] },
        feeEstimate: wFees,
        senderAddress: recipAcc.address,
        senderNonce: withdrawalNonce,
        submit: () => recipClient.writeContract({
          address: contractAddress,
          functionName: 'withdraw_credit',
          args: [proposalId],
          fees: wFees,
        }),
      });
      console.log(`withdraw_credit submitted: ${withdrawTxHash}`);

      evidence.stages.withdrawal.submittedAt = new Date().toISOString();
      saveEvidence(evidence);

      console.log('Waiting for withdrawal finalization...');
      const wTx = await verifyTxFinalizedAndSuccessful(recipClient, withdrawTxHash, 'withdrawal');
      markDurableStageWriteFinalized(evidence, 'withdrawal', wTx);
      evidence.stages.withdrawal.statusName = wTx.statusName;
      evidence.stages.withdrawal.txExecutionResultName = wTx.txExecutionResultName;
      evidence.stages.withdrawal.emittedMessages = wTx.messages || [];
      saveEvidence(evidence);
    } catch (err) {
      recordFailure(evidence, 'withdrawal', err, withdrawTxHash);
      process.exitCode = 1;
      return;
    }
  }

  const pAfterWithdraw = await creatorClient.readContract({
    address: contractAddress,
    functionName: 'get_proposal',
    args: [proposalId],
  });
  const rAfterWithdraw = await creatorClient.readContract({
    address: contractAddress,
    functionName: 'get_round',
    args: [roundId],
  });
  const contractBalAfter = await creatorClient.getBalance({ address: contractAddress });
  const recipBalAfter = await recipClient.getBalance({ address: recipAcc.address });
  const withdrawalAccounting = verifyRoundAccountingInvariant(rAfterWithdraw, 'withdraw_credit');

  console.log(`Proposal State post-withdrawal: ${pAfterWithdraw.state}`);
  console.log(`Credit Withdrawn Flag:          ${pAfterWithdraw.credit_withdrawn}`);
  console.log(`Round Payouts Emitted Wei:      ${rAfterWithdraw.payouts_emitted_wei}`);
  console.log(`Contract Balance Delta:         ${contractBalBefore.toString()} -> ${contractBalAfter.toString()} wei`);
  console.log(`Recipient Balance Delta:        ${recipBalBefore.toString()} -> ${recipBalAfter.toString()} wei`);

  if (!pAfterWithdraw.credit_withdrawn) {
    const msg = 'Credit was not marked withdrawn in proposal state after authorized withdrawal!';
    recordFailure(evidence, 'withdrawal', new Error(msg), withdrawTxHash);
    process.exitCode = 1;
    return;
  }
  if (pAfterWithdraw.state !== 'PAYOUT_EMITTED' || BigInt(rAfterWithdraw.approved_credits_wei) !== 0n ||
      BigInt(rAfterWithdraw.payouts_emitted_wei) !== requestedWei) {
    recordFailure(evidence, 'withdrawal', new Error('Withdrawal readback does not prove the exact PAYOUT_EMITTED ledger transition'), withdrawTxHash);
    process.exitCode = 1;
    return;
  }

  evidence.stages.withdrawal = {
    ...evidence.stages.withdrawal,
    contractBalanceBeforeWei: contractBalBefore.toString(),
    contractBalanceAfterWei: contractBalAfter.toString(),
    recipientBalanceBeforeWei: recipBalBefore.toString(),
    recipientBalanceAfterWei: recipBalAfter.toString(),
    proposalState: pAfterWithdraw,
    roundState: rAfterWithdraw,
    accountingInvariant: withdrawalAccounting,
    deliveryConclusion: 'PAYOUT_EMITTED; recipient delivery is only independently proven if balance/message readback establishes it.',
  };
  saveEvidence(evidence);

  // --------------------------------------------------------------------------
  // STAGE 8: Duplicate Withdrawal Rejection Test (Negative Test)
  // --------------------------------------------------------------------------
  const duplicateTestResult = await executeNegativeWithdrawalTest({
    client: recipClient,
    readClient: creatorClient,
    contractAddress,
    proposalId,
    roundId,
    expectedErrorReason: 'ERR_CREDIT_ALREADY_WITHDRAWN',
    testName: 'Duplicate Withdrawal Rejection (Recipient calling withdraw_credit second time)',
    evidence,
    stageName: 'duplicateWithdrawal',
    senderAddress: recipAcc.address,
  });

  console.log(`Duplicate withdrawal test outcome: ${duplicateTestResult.outcome}`);
  console.log(`Detail: ${duplicateTestResult.reason}`);
  evidence.stages.duplicateWithdrawal = { ...evidence.stages.duplicateWithdrawal, ...duplicateTestResult };
  saveEvidence(evidence);

  if (duplicateTestResult.outcome !== 'PASS') {
    console.error(`Duplicate withdrawal test did not PASS (result=${duplicateTestResult.outcome}). Halting runner.`);
    process.exitCode = 1;
    return;
  }

  // --------------------------------------------------------------------------
  // STAGE 9: Round Closure Status
  // --------------------------------------------------------------------------
  console.log('\n--- STAGE 9: ROUND CLOSURE / REFUND STATUS ---');
  console.log('Contract round closure enforces now >= round_end.');
  console.log('Status: PENDING future deadline. Cannot close round prematurely.');
  evidence.stages.closure = { status: 'PENDING_FUTURE_DEADLINE' };
  saveEvidence(evidence);

  console.log('\n================================================================');
  console.log('          PILOT STAGES COMPLETED & RECORDED                     ');
  console.log('================================================================');
}

if (require.main === module) {
  main().catch(err => {
    console.error('\n*** PILOT EXECUTION HALTED ***');
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED_SOURCE_HASH,
  EXPECTED_CHAIN_ID,
  EXPECTED_RPC_URL,
  EXPECTED_PILOT_CONTRACT_ADDRESS,
  EXPECTED_PILOT_DEPLOYMENT_TX,
  EXPECTED_CREATE_ROUND_TX,
  EXPECTED_ROUND_ID,
  EXPECTED_CREATOR_ADDRESS,
  loadEvidence,
  saveEvidence,
  requireEvidenceCheckpointForWrites,
  attachPublicPilotReadFacts,
  getDurableWriteHash,
  planDurableStageResume,
  assertNoUnresolvedWrite,
  executeDurableStageWrite,
  markDurableStageWriteFinalized,
  requireSufficientWriteBalance,
  requireExplicitMessageFee,
  isDefinitiveContractReadNotFound,
  verifyStage2GenesisReadback,
  assertNominationWindowOpen,
  readLatestChainTimeSeconds,
  assertNominationWindowOpenOnChain,
  runStage2ReadOnlyReconciliation,
  diagnoseStage2StudioReads,
  TransactionHashVariant,
  sanitizeErrorText,
  extractCandidateParams,
  gatherAttemptedDeploymentHashes,
  getLatestAttemptedDeploymentHash,
  gatherCandidateContractAddresses,
  recordFailure,
  verifyTxFinalizedAndSuccessful,
  verifyRoundMatchesIntent,
  verifyProposalMatchesIntent,
  executeNegativeWithdrawalTest,
  checkCandidateDeploymentSafety,
  resolveDeploymentContractAddress,
  readDeployedContractCode,
  hashDeploymentSourceFromTransaction,
  verifyAndRecordDeploymentReadback,
  runStudioHealthMonitor,
  evaluateStage1RecoveryDecision,
  executeStage1RecoveryStep,
  fetchAllRoundProposalSummaries,
  matchesFullProposalIntent,
  correlateNominatedProposalId,
  correlateResumeProposalId,
};
