/**
 * Runner-compat deploy intent.
 * The BROADCASTING record is synchronous and bound to source hash, account, and chain.
 * Delayed provider reads, duplicate clicks, reload, and post-submit exceptions must not
 * send a second deploy. Historical cf_corrected_deploy_v1 is never erased.
 */

const mockStore = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => mockStore.get(key) ?? null,
  setItem: (key: string, val: string) => {
    mockStore.set(key, String(val));
  },
  removeItem: (key: string) => {
    mockStore.delete(key);
  },
  clear: () => mockStore.clear(),
  key: (idx: number) => Array.from(mockStore.keys())[idx] ?? null,
  get length() {
    return mockStore.size;
  },
};

import type { PolicyQuote } from '@genlayer/transaction-kit';
import { LEGACY_UNPATCHABLE_CONTRACT, VERIFIED_DEPLOYMENT } from '../frontend/src/config/network';
import {
  CORRECTED_SOURCE_SHA256,
  DEPLOY_INTENT_KEY,
  DEPLOY_RESULT_KEY,
  HISTORICAL_DEPLOY_RESULT_KEY,
  clearDeployMemoryLockForTests,
  readDeployIntent,
  reconcileDeployIntentReadOnly,
  respectDeployIntentAfterReload,
  submitCorrectedDeploy,
  type CorrectedDeployQuote,
} from '../frontend/src/services/deployCorrectedCore';
import { setTransactionKitFactoryForTesting } from '../frontend/src/services/transactionService';

const ACCOUNT = '0x31e14df3b4f47f2428f3b78e7279691a78f70a05';
const HISTORICAL_TX = '0x9f23ec04bc3c29f325afc9b1026da6247395b11602c2c783473fe22e59364cfd';
const HISTORICAL_RAW = JSON.stringify({
  genlayerTxId: HISTORICAL_TX,
  sourceSha256: LEGACY_UNPATCHABLE_CONTRACT.sourceSha256,
  account: ACCOUNT,
  submittedAt: '2026-10-16T09:00:00.000Z',
});

let passed = 0;
let total = 0;
let submitCalls = 0;

function assert(condition: boolean, msg: string) {
  total++;
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    throw new Error(msg);
  }
  passed++;
  console.log(`PASS: ${msg}`);
}

function assertHistoricalUntouched(msg: string) {
  assert(mockStore.get(HISTORICAL_DEPLOY_RESULT_KEY) === HISTORICAL_RAW, msg);
}

function resetStorage() {
  process.env.CF_ALLOW_DEPLOY_INTENT_TESTS = '1';
  mockStore.clear();
  mockStore.set(HISTORICAL_DEPLOY_RESULT_KEY, HISTORICAL_RAW);
  clearDeployMemoryLockForTests();
  submitCalls = 0;
}

function quote(): CorrectedDeployQuote {
  return {
    quote: { feeValue: 175000000000000000n, userValue: 0n } as PolicyQuote,
    code: '# runner-compat candidate\n',
    sourceSha256: CORRECTED_SOURCE_SHA256,
    account: ACCOUNT,
    chainId: 61997,
    feeValueWei: 175000000000000000n,
    userValueWei: 0n,
    quotedAt: Date.now(),
  };
}

function provider(chainHex = '0xf22d') {
  return {
    request: async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return chainHex;
      if (method === 'eth_accounts') return [ACCOUNT];
      throw new Error(`unexpected provider method ${method}`);
    },
  };
}

function installKit(submit: () => Promise<{ genlayerTxId?: `0x${string}`; evmTxHash?: `0x${string}` }>) {
  setTransactionKitFactoryForTesting(() => ({
    estimate: async () => ({ feeValue: 1n, userValue: 0n }),
    submit: async () => {
      submitCalls++;
      return submit();
    },
    track: async () => {
      throw new Error('track is not part of the deploy intent test');
    },
  }) as any);
}

async function assertThrows(run: () => Promise<unknown>, pattern: RegExp, msg: string) {
  try {
    await run();
  } catch (err: any) {
    assert(pattern.test(String(err?.message || err)), `${msg} (got: ${err?.message || err})`);
    return;
  }
  assert(false, `${msg} (no error thrown)`);
}

async function testDelayedProviderAndDuplicateClicks() {
  resetStorage();
  let releaseProvider!: () => void;
  let holdProvider = true;
  const gate = new Promise<void>((resolve) => {
    releaseProvider = () => {
      holdProvider = false;
      resolve();
    };
  });
  let sawBoundIntent = false;
  const delayed = provider();
  const baseRequest = delayed.request.bind(delayed);
  delayed.request = async (args: { method: string }) => {
    if (!sawBoundIntent) {
      const stored = readDeployIntent();
      sawBoundIntent =
        stored?.status === 'BROADCASTING' &&
        stored.sourceSha256 === CORRECTED_SOURCE_SHA256 &&
        stored.account === ACCOUNT &&
        stored.chainId === 61997;
    }
    if (holdProvider) await gate;
    return baseRequest(args);
  };
  installKit(async () => ({ genlayerTxId: '0x1111111111111111111111111111111111111111111111111111111111111111' }));
  (globalThis as any).fetch = async () => {
    throw new Error('callback offline');
  };

  const first = submitCorrectedDeploy({ provider: delayed as any, account: ACCOUNT, prepared: quote() });
  const second = submitCorrectedDeploy({ provider: delayed as any, account: ACCOUNT, prepared: quote() });
  assert(sawBoundIntent, 'Delayed provider sees a source/account/chain BROADCASTING intent before it resolves');
  await assertThrows(() => second, /Resubmission blocked/, 'Duplicate click is rejected while the first provider read is still pending');
  assert(submitCalls === 0, 'Duplicate click does not call kit.submit before the first attempt reaches it');
  releaseProvider();
  const result = await first;
  assert(submitCalls === 1, 'Delayed provider plus a duplicate click calls kit.submit once');
  assert(
    result.genlayerTxId === '0x1111111111111111111111111111111111111111111111111111111111111111',
    'Returned deploy hash is the hash given to the caller'
  );
  const stored = readDeployIntent();
  assert(stored?.status === 'SUBMITTED' && stored.genlayerTxId === result.genlayerTxId, 'Returned hash is on the durable intent');
  assertHistoricalUntouched('Historical deploy record survives a successful candidate submit');
}

async function testReloadAndSecondTab() {
  resetStorage();
  const prior = {
    status: 'BROADCASTING',
    sourceSha256: CORRECTED_SOURCE_SHA256,
    account: ACCOUNT,
    chainId: 61997,
    intentId: 'deploy_reload_tab',
    startedAt: '2026-10-16T11:00:00.000Z',
    phase: 'before-provider',
  };
  mockStore.set(DEPLOY_INTENT_KEY, JSON.stringify(prior));
  clearDeployMemoryLockForTests();
  const respected = respectDeployIntentAfterReload();
  assert(respected?.status === 'OUTCOME_UNCERTAIN', 'Reload upgrades a hash-less BROADCASTING intent to OUTCOME_UNCERTAIN');
  assert(respected?.intentId === 'deploy_reload_tab', 'Reload keeps the same intent id');
  clearDeployMemoryLockForTests();
  const secondTab = respectDeployIntentAfterReload();
  assert(secondTab?.status === 'OUTCOME_UNCERTAIN', 'A second tab respects the durable uncertain intent');
  installKit(async () => ({ genlayerTxId: '0x2222222222222222222222222222222222222222222222222222222222222222' }));
  await assertThrows(
    () => submitCorrectedDeploy({ provider: provider() as any, account: ACCOUNT, prepared: quote() }),
    /Resubmission blocked/,
    'Reload blocks a new deploy without calling the wallet'
  );
  assert(submitCalls === 0, 'Reload path does not call kit.submit');
  assert(mockStore.get(DEPLOY_INTENT_KEY)?.includes('OUTCOME_UNCERTAIN'), 'Reload does not erase the intent');
  assertHistoricalUntouched('Historical deploy record survives reload');
}

async function testPostSubmitException() {
  resetStorage();
  installKit(async () => {
    throw new Error('provider disconnected after the wallet window closed');
  });
  await assertThrows(
    () => submitCorrectedDeploy({ provider: provider() as any, account: ACCOUNT, prepared: quote() }),
    /OUTCOME_UNCERTAIN/,
    'Post-submit exception stays OUTCOME_UNCERTAIN'
  );
  const intent = readDeployIntent();
  assert(intent?.status === 'OUTCOME_UNCERTAIN', 'Durable intent status is OUTCOME_UNCERTAIN');
  assert(!intent?.genlayerTxId, 'An exception without a returned hash does not invent a transaction id');
  assert(!mockStore.has(DEPLOY_RESULT_KEY), 'No deploy result is stored when the hash never returned');
  assert(submitCalls === 1, 'The failing attempt called kit.submit once');

  const unresolved = reconcileDeployIntentReadOnly({});
  assert(unresolved.resubmitBlocked === true, 'Read-only reconciliation without proof keeps the attempt blocked');
  assert(readDeployIntent()?.status === 'OUTCOME_UNCERTAIN', 'A lookup miss does not clear an uncertain deploy');

  clearDeployMemoryLockForTests();
  submitCalls = 0;
  installKit(async () => ({ genlayerTxId: '0x3333333333333333333333333333333333333333333333333333333333333333' }));
  await assertThrows(
    () => submitCorrectedDeploy({ provider: provider() as any, account: ACCOUNT, prepared: quote() }),
    /Resubmission blocked/,
    'A later click cannot send a second deploy after an uncertain submit'
  );
  assert(submitCalls === 0, 'The blocked retry does not call kit.submit');
  assertHistoricalUntouched('Historical deploy record survives a post-submit exception');
}

async function testWalletRejectionClearsOnlyTheIntent() {
  resetStorage();
  installKit(async () => {
    throw Object.assign(new Error('User rejected the request'), { code: 4001 });
  });
  await assertThrows(
    () => submitCorrectedDeploy({ provider: provider() as any, account: ACCOUNT, prepared: quote() }),
    /User rejected the request/,
    'A wallet rejection is reported to the caller'
  );
  assert(!mockStore.has(DEPLOY_INTENT_KEY), 'A demonstrable pre-broadcast wallet rejection clears the intent');
  assert(!mockStore.has(DEPLOY_RESULT_KEY), 'A wallet rejection does not write a deploy result');
  assertHistoricalUntouched('A wallet rejection does not erase the historical deploy record');
  assert(submitCalls === 1, 'The rejected attempt reached the wallet once');
}

async function testHashRecordedBeforeCallback() {
  resetStorage();
  let hashVisibleToCallback: string | undefined;
  let resultRawAtCallback = '';
  (globalThis as any).fetch = async () => {
    hashVisibleToCallback = readDeployIntent()?.genlayerTxId;
    resultRawAtCallback = mockStore.get(DEPLOY_RESULT_KEY) || '';
    throw new Error('callback offline');
  };
  installKit(async () => ({
    genlayerTxId: '0x4444444444444444444444444444444444444444444444444444444444444444',
    evmTxHash: '0x5555555555555555555555555555555555555555555555555555555555555555',
  }));
  const result = await submitCorrectedDeploy({ provider: provider() as any, account: ACCOUNT, prepared: quote() });
  assert(
    hashVisibleToCallback === result.genlayerTxId,
    'The returned hash is durable before the optional callback'
  );
  assert(
    resultRawAtCallback.includes(result.genlayerTxId),
    'Result hash is stored before the callback await'
  );
  assertHistoricalUntouched('Historical deploy record survives hash recording');
}

async function testVerifiedDeployRefusesAnotherSubmit() {
  resetStorage();
  delete process.env.CF_ALLOW_DEPLOY_INTENT_TESTS;
  let providerCalls = 0;
  const refusing = {
    request: async () => {
      providerCalls += 1;
      throw new Error('provider should not be called');
    },
  };
  installKit(async () => {
    submitCalls += 1;
    return { genlayerTxId: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
  });
  await assertThrows(
    () => submitCorrectedDeploy({ provider: refusing as any, account: ACCOUNT, prepared: quote() }),
    /WRITE BLOCKED/,
    'Verified source refuses another deploy'
  );
  assert(providerCalls === 0, 'Refused deploy does not call the provider');
  assert(submitCalls === 0, 'Refused deploy does not call kit.submit');
  assert(!mockStore.has(DEPLOY_INTENT_KEY), 'Refused deploy does not write a new intent');
  assert(
    VERIFIED_DEPLOYMENT.contractAddress === '0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8',
    'Verified deployment address is the receipt contract'
  );
  assert(
    VERIFIED_DEPLOYMENT.sourceSha256 === CORRECTED_SOURCE_SHA256,
    'Verified deployment source is the runner-compat hash'
  );
  assertHistoricalUntouched('Historical deploy record survives the write block');
  process.env.CF_ALLOW_DEPLOY_INTENT_TESTS = '1';
}

async function main() {
  await testVerifiedDeployRefusesAnotherSubmit();
  await testDelayedProviderAndDuplicateClicks();
  await testReloadAndSecondTab();
  await testPostSubmitException();
  await testWalletRejectionClearsOnlyTheIntent();
  await testHashRecordedBeforeCallback();
  setTransactionKitFactoryForTesting(null);
  console.log(`\n${passed}/${total} deploy intent checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
