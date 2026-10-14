const { createClient } = require('genlayer-js');
const { studioDevnet } = require('genlayer-js/chains');

const studioNext = {
  ...studioDevnet,
  id: 61997,
  name: 'GenLayer Studio Next',
  rpcUrls: {
    default: { http: ['https://studio-next.genlayer.com/api'] },
  },
};

const client = createClient({ chain: studioNext });

const CANDIDATE_TX_HASH = '0x369b10380005539281380222624e0b8cd66463e338f63aefae41fd45f59d0370';
const CANDIDATE_CONTRACT_ADDRESS = '0x602Af787CaCE5Be3FE8d3cfF22bCf3e6AB835290';
const CREATOR_ADDRESS = '0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066';

async function probe() {
  console.log('=== CANDIDATE DEPLOYMENT RECOVERY PROBE ===');
  console.log('Network:', studioNext.rpcUrls.default.http[0], 'Chain ID:', studioNext.id);

  const results = {
    candidateTxHash: CANDIDATE_TX_HASH,
    candidateContractAddress: CANDIDATE_CONTRACT_ADDRESS,
    creatorAddress: CREATOR_ADDRESS,
  };

  // 1. Query Candidate Transaction Hash
  console.log(`\n1. Querying Candidate Transaction Hash: ${CANDIDATE_TX_HASH}`);
  try {
    const tx = await client.getTransaction({ hash: CANDIDATE_TX_HASH });
    console.log('Transaction found:');
    console.log(`  status: ${tx.status}, statusName: ${tx.statusName}`);
    console.log(`  txExecutionResultName: ${tx.txExecutionResultName}`);
    console.log(`  contractAddress: ${tx.contractAddress}`);
    results.txQuery = {
      found: true,
      status: tx.status,
      statusName: tx.statusName,
      txExecutionResultName: tx.txExecutionResultName,
      contractAddress: tx.contractAddress,
    };
  } catch (err) {
    console.log(`Transaction query error: ${err.message}`);
    if (err.details) console.log(`  Details: ${err.details}`);
    results.txQuery = {
      found: false,
      error: err.message,
      details: err.details || null,
      shortMessage: err.shortMessage || null,
      code: err.code || null,
    };
  }

  // 2. Query Candidate Contract Address (Code / Bytecode / Schema / State)
  console.log(`\n2. Querying Candidate Contract Address: ${CANDIDATE_CONTRACT_ADDRESS}`);
  results.contractQuery = {};

  try {
    const bytecode = await client.getBytecode({ address: CANDIDATE_CONTRACT_ADDRESS });
    console.log(`  getBytecode: ${bytecode ? bytecode : 'null / undefined'}`);
    results.contractQuery.bytecode = bytecode;
  } catch (err) {
    console.log(`  getBytecode error: ${err.message}`);
    results.contractQuery.bytecodeError = err.message;
  }

  try {
    const code = await client.getCode({ address: CANDIDATE_CONTRACT_ADDRESS });
    console.log(`  getCode: ${code ? code : 'null / undefined'}`);
    results.contractQuery.code = code;
  } catch (err) {
    console.log(`  getCode error: ${err.message}`);
    results.contractQuery.codeError = err.message;
  }

  try {
    // Attempt contract call or schema read if supported
    const count = await client.readContract({
      address: CANDIDATE_CONTRACT_ADDRESS,
      functionName: 'get_round_ids_count',
      args: [],
    });
    console.log(`  readContract(get_round_ids_count): ${count}`);
    results.contractQuery.readContractResult = count ? count.toString() : '0';
  } catch (err) {
    console.log(`  readContract error: ${err.message}`);
    results.contractQuery.readContractError = err.message;
  }

  // 3. Query Creator Nonces (Latest & Pending)
  console.log(`\n3. Querying Creator Nonce: ${CREATOR_ADDRESS}`);
  results.creatorNonce = {};

  try {
    const latestNonce = await client.getTransactionCount({
      address: CREATOR_ADDRESS,
      blockTag: 'latest',
    });
    console.log(`  Latest Nonce: ${latestNonce}`);
    results.creatorNonce.latest = Number(latestNonce);
  } catch (err) {
    console.log(`  Latest Nonce error: ${err.message}`);
    results.creatorNonce.latestError = err.message;
  }

  try {
    const pendingNonce = await client.getTransactionCount({
      address: CREATOR_ADDRESS,
      blockTag: 'pending',
    });
    console.log(`  Pending Nonce: ${pendingNonce}`);
    results.creatorNonce.pending = Number(pendingNonce);
  } catch (err) {
    console.log(`  Pending Nonce error: ${err.message}`);
    results.creatorNonce.pendingError = err.message;
  }

  // Also query earlier candidate deployment hashes seen in earlier attempts
  const earlierHashes = [
    '0x7ad6ff65e252816161dee783c2f724f024de015286e49c3115d38b5cfdf7fc81',
    '0x0039fa7eeee7ad64801791c8b80c76d650d3f83c2e5e6896b7677dab66c21698',
    '0x63ca8788c7d2e5ecd8cb5424d83394dd83eabbaf8c0839e608eaab6a729fcaae',
  ];
  results.earlierHashes = {};
  console.log('\n4. Checking Earlier Candidate Hashes:');
  for (const h of earlierHashes) {
    try {
      const tx = await client.getTransaction({ hash: h });
      console.log(`  ${h}: FOUND status=${tx.statusName}`);
      results.earlierHashes[h] = { found: true, status: tx.statusName };
    } catch (err) {
      console.log(`  ${h}: NOT FOUND (${err.message})`);
      results.earlierHashes[h] = { found: false, error: err.message };
    }
  }

  console.log('\n=== PROBE COMPLETE ===');
  return results;
}

probe().then(r => {
  const fs = require('fs');
  fs.writeFileSync(require('path').join(__dirname, 'probe_results.json'), JSON.stringify(r, null, 2));
}).catch(console.error);
