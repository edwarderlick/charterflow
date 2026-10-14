const { createClient } = require('genlayer-js');
const { studioDevnet } = require('genlayer-js/chains');
const fs = require('fs');
const path = require('path');

async function main() {
  const client = createClient({ chain: studioDevnet });
  const contractPath = path.resolve(__dirname, '../contracts/CharterFlowCore.py');
  const code = fs.readFileSync(contractPath, 'utf8');

  console.log('Validating contract runner header:');
  console.log(code.split('\n')[0]);

  try {
    const schema = await client.getContractSchemaForCode(code);
    console.log('\n=== SCHEMA EXTRACTION SUCCESSFUL ===');
    const methods = Object.keys(schema.methods || {});
    console.log(`Extracted methods count: ${methods.length}`);
    console.log('Methods:');
    methods.forEach((m) => {
      const type = schema.methods[m].type || 'method';
      console.log(`  - [${type}] ${m}`);
    });
  } catch (err) {
    console.error('\n=== SCHEMA EXTRACTION FAILED ===');
    console.error(err);
    process.exit(1);
  }
}

main();
