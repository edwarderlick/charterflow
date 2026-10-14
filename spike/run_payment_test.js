const { createClient, createAccount, isSuccessful } = require('genlayer-js');
const { studioDevnet } = require('genlayer-js/chains');
const keytar = require('keytar');
const fs = require('fs');

const CONTRACT_ADDRESS = '0xD30E2Da70f4fD27B25c8aC65E67e30AC5a1fb513';
const DEPOSIT_AMOUNT_WEI = 5000000000000000n; // 0.005 GEN

async function main() {
  console.log('=== GENLAYER PAYMENT VALIDATION: DEPOSIT & PAYOUT ===');
  console.log('Target Contract Address:', CONTRACT_ADDRESS);
  console.log('Chain ID:', studioDevnet.id);

  // Load test accounts securely from local OS Keychain
  const ownerKey = await keytar.getPassword('genlayer-cli', 'account:spike-fresh-owner');
  const recipKey = await keytar.getPassword('genlayer-cli', 'account:spike-fresh-recip');

  if (!ownerKey || !recipKey) {
    throw new Error('Failed to retrieve fresh test accounts from local OS keychain.');
  }

  const ownerAccount = createAccount(ownerKey);
  const recipAccount = createAccount(recipKey);

  console.log('Owner Account:', ownerAccount.address);
  console.log('Recipient Account:', recipAccount.address);

  const ownerClient = createClient({
    chain: studioDevnet,
    account: ownerAccount,
  });

  const recipClient = createClient({
    chain: studioDevnet,
    account: recipAccount,
  });

  const evidence = {
    contractAddress: CONTRACT_ADDRESS,
    chainId: studioDevnet.id,
    deployTxId: '0xb27210ff8f5b5f9771ee17ae85892c2e4cb4c21a867d1cb06c9550a531f1c5be',
    ownerAddress: ownerAccount.address,
    recipientAddress: recipAccount.address,
    depositAmountWei: DEPOSIT_AMOUNT_WEI.toString(),
  };

  // 1. Initial State & Balances
  const ownerBalInitial = await ownerClient.getBalance({ address: ownerAccount.address });
  const recipBalInitial = await recipClient.getBalance({ address: recipAccount.address });
  const contractBalInitial = await ownerClient.getBalance({ address: CONTRACT_ADDRESS });
  const initialState = await ownerClient.readContract({
    address: CONTRACT_ADDRESS,
    functionName: 'get_state',
    args: [],
  });

  console.log('\n--- INITIAL BALANCES & STATE ---');
  console.log('Owner initial balance:', ownerBalInitial.toString(), 'wei');
  console.log('Recipient initial balance:', recipBalInitial.toString(), 'wei');
  console.log('Contract initial balance:', contractBalInitial.toString(), 'wei');
  console.log('Initial contract state:', initialState);

  evidence.initial = {
    ownerBalanceWei: ownerBalInitial.toString(),
    recipientBalanceWei: recipBalInitial.toString(),
    contractBalanceWei: contractBalInitial.toString(),
    contractState: initialState,
  };

  // 2. Execute Deposit
  console.log('\n--- STAGE 1: CALLING DEPOSIT (0.005 GEN) ---');
  const depositFees = await ownerClient.estimateTransactionFees({
    address: CONTRACT_ADDRESS,
    functionName: 'deposit',
    args: [],
    value: DEPOSIT_AMOUNT_WEI,
    leaderOnly: false,
  });
  console.log('Estimated deposit feeValue:', depositFees.feeValue.toString(), 'wei');

  const depositTxHash = await ownerClient.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: 'deposit',
    args: [],
    value: DEPOSIT_AMOUNT_WEI,
    fees: depositFees,
  });
  console.log('Deposit tx submitted:', depositTxHash);
  console.log('Waiting for deposit finalization...');

  const depositReceipt = await ownerClient.waitForTransactionReceipt({
    hash: depositTxHash,
    retries: 100,
    interval: 5000,
    waitUntil: 'decided',
    fullTransaction: true,
  });

  const depositTx = await ownerClient.getTransaction({ hash: depositTxHash });
  console.log('Deposit finalized! statusName:', depositTx.statusName, 'txExecutionResultName:', depositTx.txExecutionResultName);

  if (depositTx.statusName !== 'FINALIZED' || depositTx.txExecutionResultName !== 'FINISHED_WITH_RETURN') {
    throw new Error(`Deposit did not finalize with FINISHED_WITH_RETURN. Status: ${depositTx.statusName}, Result: ${depositTx.txExecutionResultName}`);
  }

  const stateAfterDeposit = await ownerClient.readContract({
    address: CONTRACT_ADDRESS,
    functionName: 'get_state',
    args: [],
  });
  const contractBalAfterDeposit = await ownerClient.getBalance({ address: CONTRACT_ADDRESS });
  console.log('Contract state after deposit:', stateAfterDeposit);
  console.log('Contract balance after deposit:', contractBalAfterDeposit.toString(), 'wei');

  evidence.deposit = {
    txHash: depositTxHash,
    statusName: depositTx.statusName,
    txExecutionResultName: depositTx.txExecutionResultName,
    feeValueWei: depositFees.feeValue.toString(),
    contractBalanceAfterWei: contractBalAfterDeposit.toString(),
    contractStateAfter: stateAfterDeposit,
  };

  // 3. Execute Payout
  console.log('\n--- STAGE 2: CALLING PAYOUT AS RECIPIENT ---');
  const payoutFees = await recipClient.estimateTransactionFees({
    address: CONTRACT_ADDRESS,
    functionName: 'payout',
    args: [],
    leaderOnly: false,
  });
  console.log('Estimated payout feeValue:', payoutFees.feeValue.toString(), 'wei');

  const payoutTxHash = await recipClient.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: 'payout',
    args: [],
    fees: payoutFees,
  });
  console.log('Payout tx submitted:', payoutTxHash);
  console.log('Waiting for payout finalization...');
  await recipClient.waitForFinalization({ hash: payoutTxHash });

  const payoutTx = await recipClient.getTransaction({ hash: payoutTxHash });
  console.log('Payout finalized! statusName:', payoutTx.statusName, 'txExecutionResultName:', payoutTx.txExecutionResultName);

  if (payoutTx.statusName !== 'FINALIZED' || payoutTx.txExecutionResultName !== 'FINISHED_WITH_RETURN') {
    throw new Error(`Payout did not finalize with FINISHED_WITH_RETURN. Status: ${payoutTx.statusName}, Result: ${payoutTx.txExecutionResultName}`);
  }

  // 4. Verification & Outcome
  const ownerBalFinal = await ownerClient.getBalance({ address: ownerAccount.address });
  const recipBalFinal = await recipClient.getBalance({ address: recipAccount.address });
  const contractBalFinal = await ownerClient.getBalance({ address: CONTRACT_ADDRESS });
  const finalState = await ownerClient.readContract({
    address: CONTRACT_ADDRESS,
    functionName: 'get_state',
    args: [],
  });

  let triggeredTxIds = [];
  try {
    triggeredTxIds = await recipClient.getTriggeredTransactionIds({ hash: payoutTxHash });
  } catch (e) {
    console.log('Triggered tx query:', e.message);
  }

  console.log('\n--- FINAL OUTCOME & TRANSFER EVIDENCE ---');
  console.log('Contract state final:', finalState);
  console.log('Contract final balance:', contractBalFinal.toString(), 'wei');
  console.log('Recipient initial balance:', recipBalInitial.toString(), 'wei');
  console.log('Recipient final balance:  ', recipBalFinal.toString(), 'wei');
  const recipDiff = recipBalFinal - recipBalInitial;
  console.log('Recipient net balance change:', recipDiff.toString(), 'wei');
  console.log('Triggered transaction IDs:', triggeredTxIds);
  console.log('Payout tx messages count:', payoutTx.messages ? payoutTx.messages.length : 0);

  evidence.payout = {
    txHash: payoutTxHash,
    statusName: payoutTx.statusName,
    txExecutionResultName: payoutTx.txExecutionResultName,
    feeValueWei: payoutFees.feeValue.toString(),
    contractBalanceAfterWei: contractBalFinal.toString(),
    contractStateAfter: finalState,
    triggeredTransactionIds: triggeredTxIds,
    payoutMessages: payoutTx.messages || [],
  };

  evidence.final = {
    ownerBalanceWei: ownerBalFinal.toString(),
    recipientBalanceWei: recipBalFinal.toString(),
    contractBalanceWei: contractBalFinal.toString(),
    recipientNetDeltaWei: recipDiff.toString(),
    contractState: finalState,
  };

  fs.writeFileSync(require('path').join(__dirname, 'payment_evidence.json'), JSON.stringify(evidence, null, 2));
  console.log('\n=== EVIDENCE SAVED TO spike/payment_evidence.json (local, not for public commit) ===');
}

main().catch(err => {
  console.error('\n*** SPIKE TEST FAILED ***');
  console.error(err);
  process.exit(1);
});
