const { createClient, createAccount } = require('genlayer-js');
const { studioDevnet } = require('genlayer-js/chains');
const keytar = require('keytar');

const studioNext = {
  ...studioDevnet,
  id: 61997,
  name: 'GenLayer Studio Next',
  rpcUrls: {
    default: { http: ['https://studio-next.genlayer.com/api'] },
  },
};

const TARGETS = [
  { name: 'cf-pilot-creator', address: '0x6201f71e4501ad61ee6c7d92eb41a47e85dae066', amount: 1800000000000000000n }, // 1.8 GEN
  { name: 'cf-pilot-member-a', address: '0xf8cf75561dfdfebeb8928f3cfbf46d8051e5e8ff', amount: 500000000000000000n },  // 0.5 GEN
  { name: 'cf-pilot-member-b', address: '0x37ab01d9804f688e53df77ff5d5553890857e428', amount: 500000000000000000n },  // 0.5 GEN
  { name: 'cf-pilot-recipient', address: '0xe1e8fa243d0da2ac7a92f8dc29b45220cb238e1c', amount: 500000000000000000n }, // 0.5 GEN
];

async function main() {
  const pk = await keytar.getPassword('genlayer-cli', 'account:sybil-court-deploy');
  if (!pk) throw new Error('sybil-court-deploy key missing in keychain');
  const account = createAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
  const client = createClient({ chain: studioNext, account });

  const initialBal = await client.getBalance({ address: account.address });
  console.log(`Funder (sybil-court-deploy) balance: ${(Number(initialBal) / 1e18).toFixed(4)} GEN`);

  for (const target of TARGETS) {
    const currentBal = await client.getBalance({ address: target.address });
    console.log(`\nChecking ${target.name} (${target.address}). Current balance: ${(Number(currentBal) / 1e18).toFixed(4)} GEN`);
    if (currentBal >= target.amount) {
      console.log(`  Already sufficiently funded (${(Number(currentBal) / 1e18).toFixed(4)} GEN). Skipping.`);
      continue;
    }

    const needed = target.amount - currentBal;
    console.log(`  Sending ${(Number(needed) / 1e18).toFixed(4)} GEN to ${target.name}...`);
    const fees = await client.estimateTransactionFees({
      to: target.address,
      value: needed,
    });
    console.log(`  Estimated feeValue: ${(Number(fees.feeValue) / 1e18).toFixed(6)} GEN`);

    const txHash = await client.sendTransaction({
      to: target.address,
      value: needed,
      fees,
    });
    console.log(`  Submitted tx: ${txHash}. Waiting for finalization...`);
    await client.waitForFinalization({ hash: txHash });
    const receipt = await client.getTransaction({ hash: txHash });
    console.log(`  Confirmed! Status: ${receipt.statusName}, Result: ${receipt.txExecutionResultName}`);
    const newBal = await client.getBalance({ address: target.address });
    console.log(`  New balance: ${(Number(newBal) / 1e18).toFixed(4)} GEN`);
  }

  console.log('\nAll pilot accounts are funded and ready!');
}

main().catch(console.error);
