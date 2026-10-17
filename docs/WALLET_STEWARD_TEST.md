# Public wallet and steward testing — 2026-10-14

> [!NOTE]
> **Historical 2026-10-14 Walkthrough Note:**  
> This document is a preserved historical record of the local steward and wallet walkthrough conducted on **2026-10-14** against local Vite (`http://127.0.0.1:5173/`).  
> Statements below such as “Public origin: none”, historical test suite counts, and observed JSON-RPC `-32603` read errors are historical observations from that pass, **not current status**.  
> The current verified deployment on chain `61997` is [`0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8`](https://explorer-studio-dev.genlayer.com/address/0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8), with live public demo at [https://charterflow-coral.vercel.app/](https://charterflow-coral.vercel.app/), full verified lifecycle evidence in [`docs/evidence/verified-flow.json`](evidence/verified-flow.json), and current status documented in [README.md](../README.md) and [`docs/SUBMISSION_STATUS.md`](SUBMISSION_STATUS.md).  
> The test results, matrix, and findings below are preserved unchanged as historical evidence and have not been rewritten.

Local origin: `http://127.0.0.1:5173/` (Vite 8.3.4, node PID **28704**, command `vite.js --host 127.0.0.1`, HTTP 200). Port 5174 is not listening; no duplicate CharterFlow Vite process was found this run.  
Public origin: **none** *(historical 2026-10-14 observation; see current Vercel demo above)*. Wallet-free and connect/network checks were not repeated on a public host during this pass.  
Portal: not submitted. This note is the 2026-10-14 walkthrough. Current source SHA-256 is `4b146292c840cf16e0dcfd7b8d488492092d73c2c3160dda366f922642eaee78` at `0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8`. The recovery source `34ea0e374cfe68788067838cebf4ca0c226e139c713aca6e7345716b35aad5ee` remains on `0x408D…` only.

## Wallet types actually tested

| Type | How | Result |
|---|---|---|
| No injected wallet | Headless Chrome, default page | `NO WALLET` header + banner. Explore/round reads still run. |
| One injected EIP-1193 wallet | Puppeteer mock (`eth_requestAccounts`, chain `0xf22d`) | Connect CTA; account `0x1111…1111` after click. |
| Two injected wallets (EIP-6963 + `ethereum.providers`) | Puppeteer mocks A (reject 4001) and B (chain `0x1`) | Picker `Use Mock Wallet A/B`. Rejection copy. Wrong-chain switch/add after B. |
| MetaMask / Rabby / WalletConnect live extensions | Not present in this agent environment | Not claimed. App supports standard injected EIP-1193 / EIP-6963 only. |
| Distinct addresses | Unit mocks `0x1111…` (creator/committee) and `0x2222…` (committee) plus recipient `0x3333…` and visitor `0x4444…` | Account change, chain change, role change. |

No seed phrase or private key was requested or stored. Session flag is `localStorage cf_wallet_session_v1`. CLEAR SESSION does not silent-reconnect.

## Async wallet-session gate (delayed RPC race)

Startup restore (`eth_chainId` → `eth_accounts`), CONNECT (`eth_requestAccounts`), and balance reads snapshot an `AsyncWalletGate` (`epoch`, live session status, selected `rdns`, selected provider). After every await, the response is adopted only if the session is still the same connected provider.

- CLEAR SESSION bumps `sessionEpochRef` and writes `status: 'cleared'`. A delayed `eth_accounts` cannot call `setAccount`.
- CLEAR SESSION during in-flight CONNECT drops `eth_requestAccounts`. CONNECT snapshots `requireConnected: false` (status is still cleared until success); the epoch bump is what invalidates the promise.
- Switching injected providers bumps epoch and selected provider identity. Provider A’s late CONNECT is dropped; provider B’s is adopted.
- Restore and balance use `requireConnected: true`, so a cleared session cannot apply account or GEN balance.
- `accountsChanged` / `chainChanged` ignore events whose provider is no longer the selected one.

Helpers: `shouldAdoptAsyncWalletResult`, `adoptSettledWalletAccounts`, `firstAccountFromProviderAccounts` in `frontend/src/services/eip1193.ts`. Wired in `frontend/src/context/WalletContext.tsx`.

## Role / action matrix (UI guidance; contract is authoritative)

| Action | Allowed for | Blocked for |
|---|---|---|
| `create_round` | Funded wallet on 61997 (1 GEN min + fees/roster/deadlines) | Disconnected, wrong chain, `0.00` GEN |
| `nominate_proposal` | Listed committee member before cutoff | Visitor, recovery round `rnd-pilot-354517`, expired cutoff |
| `evaluate_charter_fit` | Anyone, paid, while SUBMITTED | Other proposal states |
| `cast_vote` | Listed committee member | Visitor; recipient recusal; duplicate ballot |
| `withdraw_credit` | Named recipient after APPROVED | Any other address |
| `close_round_and_refund` | Round creator after `round_end` | Non-creator; still-open round |
| `claim_creator_refund` | Round creator after CLOSED | Non-creator |
| `settle_expired_proposal` | Anyone, paid, only when deadline actually passed | Hidden otherwise |

## Automated tests

| Suite | Result |
|---|---|
| `npm run test:wallet-steward` | **66 / 66** (includes delayed-promise CLEAR-before-`eth_accounts`, CLEAR-during-CONNECT, provider switch A→B, undisturbed CONNECT, delayed balance after CLEAR) |
| `npm run test:frontend-reads` | 91 / 91 |
| `npm run test:frontend-writes` | 117 / 117 (includes expectedEffect + positive `messageFees` unblock) |
| `npm run test:safety` | 71 / 71 (not re-run this pass) |
| `npm --prefix frontend run lint` | 21 warnings, **0 errors** |
| `npm --prefix frontend run build` | `tsc -b && vite build` OK; bundle `dist/assets/index-DDv2FxNP.js` 1,275.03 kB |

## Localhost browser walkthrough

Headless Chrome against `http://127.0.0.1:5173/`. Screenshots (gitignored): `frontend/review_screenshots/walkthrough_steward/`. **20 / 20** scripted checks passed.

Desktop: `/`, `/test`, `/test#faucet`, `/rounds`, `/rounds/rnd-pilot-354517`, `/network`, `/activity`.  
Mobile 390px: `/test`, `/`.  
Injected mocks: one-wallet connect; two-wallet picker, 4001 reject, wrong chain.

Live `gen_call` still surfaces `[READ ERROR]` / `-32603`. Explore does not show `ALL ROUNDS (0)`. Recovery round is a read error, not a 404. `/network` shows CONNECT while disconnected (no auto-switch).

## What a steward still cannot verify

- Live round ledger, nomination, vote, withdraw, close, or refund on chain 61997 while `gen_call` returns `-32603`.
- Stage 2 genesis readback for `rnd-pilot-354517` (INCONCLUSIVE). A finalized create_round receipt is not round-state proof.
- Public-origin (Vercel) wallet-free and connect/network behavior — no URL yet.
- A real MetaMask/Rabby session in this agent run (injected mocks + unit providers only).
- Native-message fee quotes against the live kit/RPC (unit test unblocks when `messageFees > 0`; live quote may still be `0n` and correctly block withdraw/claim).
- Spending test GEN is unnecessary to inspect the project and is not required by this task.
