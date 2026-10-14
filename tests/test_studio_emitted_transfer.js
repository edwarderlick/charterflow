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

async function main() {
  console.log('=== HISTORICAL PAYMENT SPIKE EVIDENCE: EMITTED TRANSFERS & RECEIPT BOUNDS ===');
  console.log('Note: This tests an earlier PaymentSpike deployment (0xD30E...). It does NOT validate CharterFlowCore.');
  const client = createClient({ chain: studioNext });

  const payoutTxHash = '0x72fd18ba0e93257954178591cb06261972b45eee6f2b96648dee8f284ddafe8c';
  const contractAddress = '0xD30E2Da70f4fD27B25c8aC65E67e30AC5a1fb513';
  const expectedRecipient = '0x5219C6bAd60f57E3C95632AAC2B722683C482ed3';
  const expectedValueWei = 5000000000000000n; // 0.005 GEN

  console.log(`Querying parent payout transaction: ${payoutTxHash}`);
  const tx = await client.getTransaction({ hash: payoutTxHash });

  // 1. Parent Transaction Finalization
  console.log('\n1. Parent Transaction Status:');
  console.log(`   statusName: ${tx.statusName}`);
  console.log(`   txExecutionResultName: ${tx.txExecutionResultName}`);
  if (tx.statusName !== 'FINALIZED' || tx.txExecutionResultName !== 'FINISHED_WITH_RETURN') {
    throw new Error(`Unexpected transaction status: ${tx.statusName} / ${tx.txExecutionResultName}`);
  }

  // 2. Emitted External Transfer Message
  console.log('\n2. Emitted Transfer Message Inspection:');
  const messages = tx.messages || [];
  console.log(`   Emitted messages count: ${messages.length}`);
  if (messages.length === 0) {
    throw new Error('No emitted messages found in transaction payload.');
  }

  const em = messages[0];
  console.log(`   Emitted message recipient: ${em.recipient}`);
  console.log(`   Emitted message value (wei): ${em.value}`);
  console.log(`   Emitted message data: "${em.data}"`);

  if (em.recipient.toLowerCase() !== expectedRecipient.toLowerCase()) {
    throw new Error(`Emitted recipient mismatch: expected ${expectedRecipient}, got ${em.recipient}`);
  }
  if (BigInt(em.value) !== expectedValueWei) {
    throw new Error(`Emitted value mismatch: expected ${expectedValueWei}, got ${em.value}`);
  }

  // 3. Contract Balance Movement
  console.log('\n3. Contract Balance Movement Inspection:');
  const contractBalance = await client.getBalance({ address: contractAddress });
  console.log(`   Current contract balance: ${contractBalance.toString()} wei`);
  // All 0.005 GEN exited contract balance upon emit_transfer
  if (contractBalance !== 0n) {
    throw new Error(`Expected zero contract balance post-payout, got ${contractBalance}`);
  }

  // 4. Studio Devnet Receipt Limitation Check
  console.log('\n4. Studio Next EOA Transfer Receipt Limitation:');
  let triggeredTxIds = [];
  try {
    triggeredTxIds = await client.getTriggeredTransactionIds({ hash: payoutTxHash });
  } catch (err) {
    console.log(`   getTriggeredTransactionIds threw: ${err.message}`);
  }

  console.log(`   Triggered Transaction IDs returned by Studio: ${JSON.stringify(triggeredTxIds)}`);
  const hasChildReceipt = Array.isArray(triggeredTxIds) && triggeredTxIds.length > 0;

  console.log('\n=== INTEGRATION TEST SUMMARY ===');
  console.log('✓ Parent transaction finalized: YES');
  console.log('✓ Emitted transfer message verified on chain: YES');
  console.log('✓ Shared contract balance deducted: YES');
  console.log(`✓ Independent child EOA receipt available in Studio: ${hasChildReceipt ? 'YES' : 'NO (Expected)'}`);
  
  if (!hasChildReceipt) {
    console.log('\n[HISTORICAL SPIKE FINDING - PAYMENT SPIKE ONLY]');
    console.log('In this specific PaymentSpike EOA transfer test on Studio Next, client.getTriggeredTransactionIds returned an empty array ([]).');
    console.log('This observation is specific to that spike test and does not constitute a universal Studio guarantee, nor does it validate CharterFlowCore.');
    console.log('Therefore:');
    console.log('1. On-chain state must remain at EMITTED (PAYOUT_EMITTED / REFUND_EMITTED).');
    console.log('2. The protocol and frontend must NEVER claim delivery is PAID solely based on parent transaction finalization.');
    console.log('3. Claims are strictly single-use and irreversible once EMITTED.');
  }

  console.log('\n=== TEST PASSED SUCCESSFULLY ===');
}

main().catch((err) => {
  console.error('\n*** INTEGRATION TEST FAILED ***');
  console.error(err);
  process.exit(1);
});
