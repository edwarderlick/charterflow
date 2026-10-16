const { createClient } = require('genlayer-js');
const { studioDevnet } = require('genlayer-js/chains');
const { TransactionHashVariant } = require('genlayer-js/types');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LIVE_UNPATCHABLE_DEPLOY_TX = '0x9f23ec04bc3c29f325afc9b1026da6247395b11602c2c783473fe22e59364cfd';
const LIVE_UNPATCHABLE_SOURCE_HASH = '4ec11b1bee98122d3dad5ab86f5823d676797c1c0873133d386adeeba12b9b72';
const CANDIDATE_SOURCE_HASH = '4b146292c840cf16e0dcfd7b8d488492092d73c2c3160dda366f922642eaee78';
const EXPECTED_METHODS = [
  'cast_vote',
  'claim_creator_refund',
  'close_round_and_refund',
  'create_round',
  'evaluate_charter_fit',
  'get_all_proposal_ids',
  'get_all_proposal_ids_count',
  'get_proposal',
  'get_round',
  'get_round_ids',
  'get_round_ids_count',
  'get_round_proposals',
  'get_round_proposals_count',
  'get_round_proposals_summary',
  'nominate_proposal',
  'settle_expired_proposal',
  'settle_expired_proposals_batch',
  'withdraw_credit',
];
const RPC_URL = 'https://studio-next.genlayer.com/api';
const RESULT_FILE = path.resolve(__dirname, '../artifacts/corrected_deploy_verification.json');
const SUBMIT_FILE = path.resolve(__dirname, '../artifacts/corrected_deploy_result.json');
const SOURCE_FILE = path.resolve(__dirname, '../contracts/CharterFlowCore.py');

function resolveDeploymentContractAddress(tx) {
  if (!tx || typeof tx !== 'object') return null;
  return (
    tx.contractAddress ||
    tx.data?.contract_address ||
    tx.data?.contractAddress ||
    tx.to_address ||
    tx.toAddress ||
    null
  );
}

function hashDeploymentSourceFromTransaction(tx) {
  const encodedSource = tx?.data?.contract_code || tx?.data?.contractCode || null;
  if (typeof encodedSource !== 'string' || encodedSource.length === 0) {
    throw new Error('Deployment transaction is missing data.contract_code');
  }
  const sourceBytes = Buffer.from(encodedSource, 'base64');
  if (sourceBytes.length === 0) {
    throw new Error('Deployment transaction contract_code decoded to empty bytes');
  }
  return crypto.createHash('sha256').update(sourceBytes).digest('hex');
}

function methodNames(schema) {
  return Object.keys(schema?.methods || {}).sort();
}

async function main() {
  const txHash = process.argv[2] || (fs.existsSync(SUBMIT_FILE) ? JSON.parse(fs.readFileSync(SUBMIT_FILE, 'utf8')).genlayerTxId : null);
  if (!txHash) {
    throw new Error('No deploy tx hash. Pass it as argv[2] or write artifacts/corrected_deploy_result.json');
  }

  if (txHash.toLowerCase() === LIVE_UNPATCHABLE_DEPLOY_TX.toLowerCase()) {
    throw new Error(
      `Deploy ${LIVE_UNPATCHABLE_DEPLOY_TX} is the unpatchable contract at source ${LIVE_UNPATCHABLE_SOURCE_HASH}. Do not re-check it as an empty candidate deploy.`
    );
  }

  const localSource = fs.readFileSync(SOURCE_FILE);
  const localHash = crypto.createHash('sha256').update(localSource).digest('hex');
  if (localHash !== CANDIDATE_SOURCE_HASH) {
    throw new Error(`Local source hash ${localHash} != candidate ${CANDIDATE_SOURCE_HASH}`);
  }

  const client = createClient({
    chain: {
      ...studioDevnet,
      id: 61997,
      rpcUrls: { default: { http: [RPC_URL] } },
    },
    endpoint: RPC_URL,
  });

  let tx = await client.getTransaction({ hash: txHash });
  if (!tx || tx.statusName !== 'FINALIZED') {
    await client.waitForFinalization({ hash: txHash, retries: 80, interval: 3000 });
    tx = await client.getTransaction({ hash: txHash });
  }

  if (tx.statusName !== 'FINALIZED') {
    throw new Error(`Deploy status ${tx.statusName}, expected FINALIZED`);
  }
  if (tx.txExecutionResultName !== 'FINISHED_WITH_RETURN') {
    throw new Error(`Deploy result ${tx.txExecutionResultName}, expected FINISHED_WITH_RETURN`);
  }

  const contractAddress = resolveDeploymentContractAddress(tx);
  if (!contractAddress || !contractAddress.startsWith('0x') || contractAddress.length !== 42) {
    throw new Error(`Could not resolve contract address from deploy receipt ${txHash}`);
  }

  const transactionSourceSha256 = hashDeploymentSourceFromTransaction(tx);
  if (transactionSourceSha256 !== CANDIDATE_SOURCE_HASH) {
    throw new Error(`Deployed source SHA-256 ${transactionSourceSha256} != candidate ${CANDIDATE_SOURCE_HASH}`);
  }

  const code = await client.getContractCode(contractAddress);
  if (!code || code === '0x' || code === '0x0') {
    throw new Error(`Empty contract code at ${contractAddress}`);
  }

  const deployedSchema = await client.getContractSchema(contractAddress);
  const sourceSchema = await client.getContractSchemaForCode(localSource.toString('utf8'));
  const deployedMethods = methodNames(deployedSchema);
  const sourceMethods = methodNames(sourceSchema);
  if (deployedMethods.length !== 18 || sourceMethods.length !== 18) {
    throw new Error(`Schema method count deployed=${deployedMethods.length} source=${sourceMethods.length}, expected 18`);
  }
  if (JSON.stringify(deployedMethods) !== JSON.stringify(EXPECTED_METHODS)) {
    throw new Error(`Deployed methods mismatch: ${deployedMethods.join(',')}`);
  }
  if (JSON.stringify(deployedMethods) !== JSON.stringify(sourceMethods)) {
    throw new Error('Deployed schema methods do not match source schema methods');
  }

  const roundCount = await client.readContract({
    address: contractAddress,
    functionName: 'get_round_ids_count',
    args: [],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  const count = Number(roundCount);
  if (!Number.isFinite(count) || count < 0) {
    throw new Error(`get_round_ids_count was not a count: ${roundCount}`);
  }

  const verification = {
    verifiedAt: new Date().toISOString(),
    chainId: 61997,
    rpcUrl: RPC_URL,
    txHash,
    contractAddress,
    statusName: tx.statusName,
    txExecutionResultName: tx.txExecutionResultName,
    sourceSha256: transactionSourceSha256,
    methodCount: deployedMethods.length,
    methods: deployedMethods,
    roundIdsCount: count,
    registryNote:
      count === 0
        ? 'Registry is empty, matching the deploy-time read.'
        : 'Deploy-time get_round_ids_count was 0. Later rounds do not change the deployed source hash.',
    from: tx.from_address || tx.fromAddress || tx.from || null,
  };
  fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
  fs.writeFileSync(RESULT_FILE, JSON.stringify(verification, null, 2));
  console.log(JSON.stringify(verification, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
