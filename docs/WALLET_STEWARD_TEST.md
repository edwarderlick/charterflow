# Public wallet and steward testing — 2026-10-14

Local origin: `http://127.0.0.1:5173/` (Vite 8.3.4, PID previously 28704, HTTP 200).  
Public origin: **none**. No Vercel URL exists. Wallet-free and connect/network checks were not repeated on a public host.  
Portal: not submitted. `contracts/CharterFlowCore.py` SHA-256 `34ea0e374cfe68788067838cebf4ca0c226e139c713aca6e7345716b35aad5ee` (unchanged).

## Wallet types actually tested

| Type | How | Result |
|---|---|---|
| No injected wallet | Headless Chrome, default page | `NO WALLET` header + banner. Explore/round reads still run. |
| One injected EIP-1193 wallet | Puppeteer mock (`eth_requestAccounts`, chain `0xf22d`) | Connect CTA; account `0x1111…1111` after click. |
| Two injected wallets (EIP-6963 + `ethereum.providers`) | Puppeteer mocks A (reject 4001) and B (chain `0x1`) | Picker `Use Mock Wallet A/B`. Rejection copy. Wrong-chain switch/add after B. |
| MetaMask / Rabby / WalletConnect live extensions | Not present in this agent environment | Not claimed. App supports standard injected EIP-1193 / EIP-6963 only. |
| Distinct addresses | Unit mocks `0x1111…` (creator/committee) and `0x2222…` (committee) plus recipient `0x3333…` and visitor `0x4444…` | Account change, chain change, role change. |

No seed phrase or private key was requested or stored. Session flag is `localStorage cf_wallet_session_v1`. CLEAR SESSION does not silent-reconnect.

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
| `npm run test:wallet-steward` | 49 / 49 |
| `npm run test:frontend-reads` | 91 / 91 |
| `npm run test:frontend-writes` | 117 / 117 (includes expectedEffect + positive `messageFees` unblock) |
| `npm run test:safety` | 71 / 71 |
| `npm --prefix frontend run lint` | 0 errors (existing oxlint warnings) |
| `npm --prefix frontend run build` | `tsc -b && vite build` OK, 6.9–9.6s |

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
