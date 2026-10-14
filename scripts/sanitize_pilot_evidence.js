const fs = require('fs');
const path = require('path');

const evidencePath = path.resolve(__dirname, 'pilot_evidence.json');
const data = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));

// Explicit candidate details
data.deploymentAttempt.candidateTxHash = '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370';
data.deploymentAttempt.candidateContractAddress = '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290';

function sanitize(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/"contract_code":\s*"[^"]+"/g, '"contract_code": "[TRUNCATED_CONTRACT_SOURCE_PAYLOAD]"')
    .replace(/'contract_code':\s*'[^']+'/g, "'contract_code': '[TRUNCATED_CONTRACT_SOURCE_PAYLOAD]'")
    .replace(/"signed_rollup_transaction":\s*"[^"]+"/g, '"signed_rollup_transaction": "[TRUNCATED_SIGNED_ROLLUP_TX]"')
    .replace(/'signed_rollup_transaction':\s*'[^']+'/g, "'signed_rollup_transaction': '[TRUNCATED_SIGNED_ROLLUP_TX]'");
}

if (data.lastFailure) {
  data.lastFailure.candidateTxHash = '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370';
  data.lastFailure.candidateContractAddress = '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290';
  data.lastFailure.errorMessage = sanitize(data.lastFailure.errorMessage);
  data.lastFailure.errorDetails = sanitize(data.lastFailure.errorDetails);
  data.lastFailure.rawErrorStack = sanitize(data.lastFailure.rawErrorStack);
}

if (data.stages?.deploy?.failure) {
  data.stages.deploy.failure.candidateTxHash = '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370';
  data.stages.deploy.failure.candidateContractAddress = '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290';
  data.stages.deploy.failure.errorMessage = sanitize(data.stages.deploy.failure.errorMessage);
  data.stages.deploy.failure.errorDetails = sanitize(data.stages.deploy.failure.errorDetails);
  data.stages.deploy.failure.rawErrorStack = sanitize(data.stages.deploy.failure.rawErrorStack);
}

// Add candidateRecoveryProbe section documenting the exact read-only queries
data.candidateRecoveryProbe = {
  probedAt: new Date().toISOString(),
  candidateTxHash: '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370',
  txStatus: 'NOT_FOUND',
  txRpcResponse: 'Transaction 0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370 not found (code: -32001)',
  candidateContractAddress: '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290',
  contractCodeResult: '0x (empty bytecode)',
  contractBytecodeResult: null,
  contractSchemaResult: 'Contract 0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290 not found (code: -32001)',
  creatorLatestNonce: 0,
  creatorPendingNonce: 0,
  freshDatabaseObservation: 'FATAL: could not write init file: No space left on device (studio-dev.c6tg442y8xke.us-east-1.rds.amazonaws.com)',
  verdict: 'CANDIDATE_DEPLOYMENT_REJECTED_BEFORE_LEDGER_COMMIT_AND_RDS_REMAINS_DISK_FULL'
};

const tmpFile = evidencePath + '.tmp';
fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
fs.renameSync(tmpFile, evidencePath);
console.log('Sanitized pilot_evidence.json atomically! New file size:', fs.statSync(evidencePath).size);
