const { createClient } = require('genlayer-js');
const { studioDevnet } = require('genlayer-js/chains');
const fs = require('fs');

async function main() {
  const client = createClient({ chain: studioDevnet });
  const code = fs.readFileSync(require('path').join(__dirname, 'PaymentSpike.py'), 'utf8');

  console.log('Contract Code length:', code.length);
  console.log('First line:', code.split('\n')[0]);

  try {
    const schema = await client.getContractSchemaForCode(code);
    console.log('=== SCHEMA EXTRACTION SUCCEEDED! ===');
    console.log('Contract Schema:', JSON.stringify(schema, null, 2));
  } catch (err) {
    console.error('=== SCHEMA EXTRACTION FAILED ===');
    console.error(err);
  }
}

main();
