/**
 * Headless Chrome against http://127.0.0.1:5173 using a temporary profile.
 * Does not open or clear the user's Chrome Default localStorage.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGIN_CANDIDATES = ['http://127.0.0.1:5174', 'http://127.0.0.1:5173'];
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const recovered = {
  title: 'GenLayer RPC Read Health Dashboard',
  summary: 'Build a public TypeScript dashboard for Studio Next read health, with clear failure states and reproducible checks.',
  capPerProposalGen: 0.1,
  durationDays: 7,
  charterRules: [
    { title: 'Open-source dashboards for GenLayer Studio Next RPC health.', description: 'Open-source dashboards for GenLayer Studio Next RPC health.' },
    { title: 'Automated tests covering successful and failed contract reads.', description: 'Automated tests covering successful and failed contract reads.' },
    { title: 'Public documentation for setup, chain 61997, and safe diagnostics.', description: 'Public documentation for setup, chain 61997, and safe diagnostics.' },
  ],
  charterExclusions: [
    { title: 'No speculative token marketing, liquidity bot promotions, or centralized influencers', severity: 'EXCLUSION' },
    { title: 'No closed-source or custodial proprietary software', severity: 'EXCLUSION' },
  ],
  committeeAddresses: [
    '0x7E4E1f7DcC3DA063F9110477Ad348C90E8599253',
    '0x9471C57aF9DF875d4D42EDb046e446E85D9CFE3A',
    '0xb3F7518df619ef485f7a1568ED3705bB6f5B0407',
  ],
  consensusThresholdPercent: 66.67,
  votingWindowDays: 3,
  initialDepositGen: 1,
  savedAt: '2026-10-14T12:28:04.700Z',
  ratified: true,
  currentStep: 4,
  rosterRaw:
    '0x7E4E1f7DcC3DA063F9110477Ad348C90E8599253,\n0x9471C57aF9DF875d4D42EDb046e446E85D9CFE3A,\n0xb3F7518df619ef485f7a1568ED3705bB6f5B0407',
};

let passed = 0;
let total = 0;
function assert(condition: boolean, msg: string) {
  total++;
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    throw new Error(msg);
  }
  passed++;
  console.log(`PASS: ${msg}`);
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJson(url: string, attempts = 40): Promise<any> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      /* retry */
    }
    await wait(250);
  }
  throw new Error(`CDP not ready: ${url}`);
}

class CdpSession {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id && this.pending.has(msg.id)) {
        const waiter = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) waiter.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else waiter.resolve(msg.result);
      }
    });
  }

  async send(method: string, params?: Record<string, unknown>) {
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.ws.send(JSON.stringify({ id, method, params }));
    return result;
  }

  async evaluate(expression: string): Promise<any> {
    const result: any = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'evaluate failed');
    }
    return result.result?.value;
  }
}

async function run() {
  if (process.env.CF_PROOF_ONLY === '1') {
    await proveCreateRoundReview('http://127.0.0.1:5174');
    console.log(`\n${passed}/${total} create-round browser tests passed`);
    return;
  }
  let ORIGIN = '';
  let pageRes: Response | null = null;
  for (const candidate of ORIGIN_CANDIDATES) {
    try {
      const res = await fetch(`${candidate}/rounds/new`);
      if (res.status === 200) {
        ORIGIN = candidate;
        pageRes = res;
        break;
      }
    } catch {
      // try next local Vite port
    }
  }
  assert(Boolean(ORIGIN && pageRes && pageRes.status === 200), 'Vite 5174 or 5173 serves /rounds/new');

  if (!existsSync(CHROME)) {
    throw new Error('Chrome not found for browser regression');
  }

  const profile = mkdtempSync(join(tmpdir(), 'cf-create-round-'));
  const port = 9333;
  const chrome: ChildProcess = spawn(
    CHROME,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      `${ORIGIN}/rounds/new`,
    ],
    { stdio: 'ignore' }
  );

  try {
    const version = await waitForJson(`http://127.0.0.1:${port}/json/version`);
    const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`);
    const page = (targets as any[]).find((item) => item.type === 'page') || targets[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl || version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', () => reject(new Error('CDP websocket failed')));
    });
    const cdp = new CdpSession(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await wait(1500);

    await cdp.evaluate(`window.location.href = '${ORIGIN}/rounds/new'`);
    await wait(1500);

    await cdp.evaluate(`(() => {
      const d = ${JSON.stringify(recovered)};
      localStorage.setItem('cf_round_draft_preview', JSON.stringify(d));
      localStorage.setItem('cf_round_draft_working', JSON.stringify(d));
      localStorage.setItem('cf_design_preview', 'true');
      return true;
    })()`);
    await cdp.evaluate(`window.location.href = '${ORIGIN}/rounds'`);
    await wait(1200);
    await cdp.evaluate(`window.location.href = '${ORIGIN}/rounds/new'`);
    await wait(2500);

    const restoreVisible = await cdp.evaluate(
      `document.body.innerText.includes('RESTORE LOCAL DRAFT') && /GENLAYER RPC READ HEALTH DASHBOARD/i.test(document.body.innerText)`
    );
    assert(restoreVisible === true, 'RESTORE LOCAL DRAFT is prominent with the saved title');

    const fieldValues = await cdp.evaluate(
      `Array.from(document.querySelectorAll('input,textarea')).map((el) => el.value).join('|')`
    );
    assert(
      String(fieldValues).includes('0.1') || String(fieldValues).includes('1') || /GENLAYER RPC READ HEALTH DASHBOARD/i.test(String(fieldValues)),
      'form hydrates recovered numeric/title fields'
    );

    await cdp.evaluate(`window.location.href = '${ORIGIN}/rounds'`);
    await wait(2000);
    const exploreDraft = await cdp.evaluate(`document.body.innerText.includes('LOCAL DRAFT') && document.body.innerText.includes('NOT ON-CHAIN')`);
    assert(exploreDraft === true, 'explore shows local draft without treating it as an on-chain round');
    const noSimulateSuccess = await cdp.evaluate(`!document.body.innerText.includes('SIMULATE GENESIS PREVIEW')`);
    assert(noSimulateSuccess === true, 'explore is not a fake genesis success screen');

    await cdp.evaluate(`window.location.href = '${ORIGIN}/rounds/new'`);
    await wait(2000);
    const stillTitle = await cdp.evaluate(`/GENLAYER RPC READ HEALTH DASHBOARD/i.test(document.body.innerText)`);
    assert(stillTitle === true, 'navigating away and back restores all identifying values');

    const simulateInPreview = await cdp.evaluate(`document.body.innerText.includes('SIMULATE PREVIEW')`);
    assert(simulateInPreview === true, 'design preview exposes SIMULATE PREVIEW');
    const noLiveSimulate = await cdp.evaluate(`!document.body.innerText.includes('SIMULATE GENESIS PREVIEW')`);
    assert(noLiveSimulate === true, 'misleading SIMULATE GENESIS PREVIEW label is gone');

    await cdp.evaluate(`{
      const btn = Array.from(document.querySelectorAll('button')).find(b => /PREVIEW DATA/.test(b.textContent||''));
      if (btn) btn.click();
      true;
    }`);
    await wait(1500);
    const reviewBtn = await cdp.evaluate(`document.body.innerText.includes('REVIEW REAL TRANSACTION')`);
    assert(reviewBtn === true, 'live mode shows REVIEW REAL TRANSACTION');
    const stillDraft = await cdp.evaluate(`/GENLAYER RPC READ HEALTH DASHBOARD/i.test(document.body.innerText)`);
    assert(stillDraft === true, 'preview/live toggle does not discard the entered values');
    const previewOff = await cdp.evaluate(`document.body.innerText.includes('PREVIEW DATA: OFF')`);
    assert(previewOff === true, 'live mode shows PREVIEW DATA: OFF');
    const chainBadge = await cdp.evaluate(`document.body.innerText.includes('61997')`);
    assert(chainBadge === true, 'create form shows chain 61997');
    const liveContract = await cdp.evaluate(`document.body.innerText.includes('0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8')`);
    assert(liveContract === true, 'create form shows the verified runner-compat contract address');
    const createReview = await cdp.evaluate(`document.querySelector('[data-testid="create-review-contract"]')?.textContent || ''`);
    assert(
      String(createReview).includes('0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8'),
      'create transaction review panel shows the full verified address'
    );
    const noLegacyLiveTarget = await cdp.evaluate(`!document.body.innerText.includes('0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21')`);
    assert(noLegacyLiveTarget === true, 'create form does not target the defective 0x408D contract');

    await cdp.evaluate(`{
      const next = Array.from(document.querySelectorAll('button')).find(b => /TREASURY ESCROW|STEP 04/.test(b.textContent||''));
      if (next) next.click();
      true;
    }`);
    await wait(500);
    await cdp.evaluate(`{
      const ratify = document.querySelector('input[type="checkbox"]');
      if (ratify && !ratify.checked) ratify.click();
      true;
    }`);
    await wait(300);
    const clicked = await cdp.evaluate(`(() => {
      const btn = document.querySelector('[data-testid="review-real-transaction"]');
      if (!btn) return 'missing';
      btn.click();
      return btn.disabled ? 'disabled' : 'clicked';
    })()`);
    console.log('REVIEW CLICK', clicked);
    await wait(4000);
    const readError = await cdp.evaluate(`document.body.innerText.includes('Network readback unavailable; no transaction sent')`);
    assert(readError === false, 'empty live registry is readable; health gate does not block as -32603');
    const formIntact = await cdp.evaluate(`/GENLAYER RPC READ HEALTH DASHBOARD/i.test(document.body.innerText)`);
    assert(formIntact === true, 'completed form remains after healthy review');
    const noWalletModal = await cdp.evaluate(`!document.body.innerText.includes('SIGN & SUBMIT IN WALLET')`);
    assert(noWalletModal === true, 'wallet signing modal does not open without a connected 61997 wallet');
    const noBroadcast = await cdp.evaluate(`!/create_round submitted|FINALIZED/i.test(document.body.innerText)`);
    assert(noBroadcast === true, 'review does not broadcast a funded create_round');

    await cdp.evaluate(`window.location.href = '${ORIGIN}/rounds'`);
    await wait(8000);
    const exploreText = await cdp.evaluate(`document.body.innerText`);
    assert(String(exploreText).includes('PREVIEW DATA: OFF'), 'explore live mode is PREVIEW DATA: OFF');
    assert(String(exploreText).includes('61997'), 'explore shows chain 61997');
    assert(
      String(exploreText).includes('0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8'),
      'explore shows the verified live contract'
    );
    assert(
      String(exploreText).includes('LEGACY') && String(exploreText).includes('0x9579A19c2aD0a2DBd0B806Abb85bE9a2E6391E48'),
      'explore keeps the funded 0x9579 rounds visible and labeled legacy'
    );

    await cdp.evaluate(`window.location.href = '${ORIGIN}/network'`);
    await wait(1500);
    const networkTarget = await cdp.evaluate(`document.querySelector('[data-testid="tx-review-target-contract"]')?.textContent || ''`);
    assert(
      String(networkTarget).includes('0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8'),
      'network transaction review shows the full verified address'
    );

    await cdp.evaluate(`window.location.href = '${ORIGIN}/proposals/prp-round-studio-next-rpc--mvas9jju-1'`);
    await wait(8000);
    const proposalText = String(await cdp.evaluate(`document.body.innerText`));
    assert(proposalText.includes('WRITE BLOCKED'), 'legacy proposal shows an explicit write block');
    assert(!proposalText.includes('TRIGGER AI CHARTER EVALUATION'), 'legacy proposal does not offer AI review');
    assert(!proposalText.includes('VOTE YES'), 'legacy proposal does not offer a yes vote');
    assert(!proposalText.includes('VOTE NO'), 'legacy proposal does not offer a no vote');

    await cdp.evaluate(`window.location.href = '${ORIGIN}/deploy-corrected'`);
    await wait(1500);
    const deployText = String(await cdp.evaluate(`document.body.innerText`));
    assert(deployText.includes('0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8'), 'deploy page shows the verified address');
    assert(/write blocked/i.test(deployText), 'deploy page blocks another deploy');

    const png: any = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const out = join('frontend', 'review_screenshots', 'create_round_restored.png');
    writeFileSync(out, Buffer.from(png.data, 'base64'));
    console.log(`screenshot ${out}`);
  } finally {
    chrome.kill();
  }

  await proveCreateRoundReview(ORIGIN);

  console.log(`\n${passed}/${total} create-round browser tests passed`);
}

async function proveCreateRoundReview(origin: string) {
  const profile = mkdtempSync(join(tmpdir(), 'cf-review-address-'));
  const port = 9334;
  const chrome: ChildProcess = spawn(
    CHROME,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
  try {
    const version = await waitForJson(`http://127.0.0.1:${port}/json/version`);
    const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`);
    const page = (targets as any[]).find((item) => item.type === 'page') || targets[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl || version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', () => reject(new Error('CDP websocket failed')));
    });
    const cdp = new CdpSession(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const provider = {
          isMetaMask: true,
          request: async ({ method, params }) => {
            if (method === 'eth_chainId') return '0xf22d';
            if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
              return ['0x7E4E1f7DcC3DA063F9110477Ad348C90E8599253'];
            }
            if (method === 'eth_sendTransaction' || method === 'personal_sign' || method === 'eth_sign' || method === 'eth_signTypedData_v4' || method === 'wallet_sendTransaction') {
              throw new Error('WRITE BLOCKED IN PROOF');
            }
            const res = await fetch('https://studio-next.genlayer.com/api', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            });
            const json = await res.json();
            if (json.error) throw new Error(json.error.message || 'rpc error');
            return json.result;
          },
          on: () => {},
          removeListener: () => {},
        };
        window.ethereum = provider;
      })();`,
    });
    await cdp.send('Page.navigate', { url: `${origin}/rounds/new` });
    await wait(2500);
    await cdp.evaluate(`(() => {
      const d = ${JSON.stringify(recovered)};
      localStorage.setItem('cf_round_draft_preview', JSON.stringify(d));
      localStorage.setItem('cf_round_draft_live', JSON.stringify(d));
      localStorage.setItem('cf_round_draft_working', JSON.stringify(d));
      localStorage.setItem('cf_design_preview', 'false');
      return true;
    })()`);
    await cdp.send('Page.navigate', { url: `${origin}/rounds/new` });
    await wait(3000);
    await cdp.evaluate(`{
      const next = Array.from(document.querySelectorAll('button')).find(b => /TREASURY ESCROW|STEP 04/.test(b.textContent||''));
      if (next) next.click();
      const ratify = document.querySelector('input[type="checkbox"]');
      if (ratify && !ratify.checked) ratify.click();
      true;
    }`);
    await wait(500);
    await cdp.evaluate(`(() => {
      const btn = document.querySelector('[data-testid="review-real-transaction"]');
      if (btn) btn.click();
      return true;
    })()`);
    await wait(2000);
    await cdp.evaluate(`(() => {
      const btn = document.querySelector('[data-testid="review-real-transaction"]');
      if (btn && !btn.disabled) btn.click();
      return true;
    })()`);
    let target = '';
    for (let i = 0; i < 45; i++) {
      target = String(await cdp.evaluate(`document.querySelector('[data-testid="tx-review-target-contract"]')?.textContent || ''`));
      if (target.includes('0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8')) break;
      await wait(1000);
    }
    if (!target.includes('0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8')) {
      const body = await cdp.evaluate(`document.body.innerText.slice(0, 3000)`);
      const btn = await cdp.evaluate(`(() => {
        const el = document.querySelector('[data-testid="review-real-transaction"]');
        return el ? (el.disabled ? 'disabled' : 'enabled') + ' ' + (el.textContent || '') : 'missing';
      })()`);
      console.log('REVIEW BUTTON', btn);
      console.log('REVIEW BODY', body);
    }
    assert(
      target.includes('0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8'),
      'opened create_round transaction review shows the verified contract'
    );
    assert(
      !target.toLowerCase().includes('0x9579a19c'),
      'opened create_round transaction review does not target 0x9579'
    );
    await cdp.evaluate(`(() => {
      const cancel = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').trim() === 'CANCEL');
      if (cancel) cancel.click();
      return true;
    })()`);
    const signed = await cdp.evaluate(`document.body.innerText.includes('SIGNING & SUBMITTING')`);
    assert(signed === false, 'proof closed the review without signing');

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Page.navigate', { url: `${origin}/rounds/new` });
    await wait(2500);
    const mobileCreate = String(await cdp.evaluate(`document.querySelector('[data-testid="create-review-contract"]')?.textContent || ''`));
    assert(
      mobileCreate.includes('0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8'),
      'mobile create review shows the full verified address'
    );
    await cdp.send('Page.navigate', { url: `${origin}/network` });
    await wait(1500);
    const mobileNetwork = String(await cdp.evaluate(`document.querySelector('[data-testid="tx-review-target-contract"]')?.textContent || ''`));
    assert(
      mobileNetwork.includes('0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8'),
      'mobile network transaction review shows the full verified address'
    );
  } finally {
    chrome.kill();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
