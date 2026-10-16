# CharterFlow

CharterFlow is a grant round on a GenLayer intelligent contract. A creator locks a natural-language charter and a GEN deposit. A committee nominates work. GenLayer validators return one categorical charter-fit verdict. Eligible members vote, with the recipient recused. The recipient withdraws an approved credit, and the contract emits the native transfer.

The charter check matters because the verdict is produced inside the contract, not pasted in from an off-chain review. The leader and validators must agree on the category. The stored reason records that agreement and states that a free-text rationale was not verified. A disagreement leaves the proposal unmoved.

**Public demo:** not deployed. Connect this repository to Vercel, then replace this sentence with that deployment URL.

**Contract:** [`0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8`](https://explorer-studio-dev.genlayer.com/address/0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8)

**Network:** GenLayer Studio development preview, chain ID `61997` (`0xf22d`). RPC `https://studio-next.genlayer.com/api`. Explorer `https://explorer-studio-dev.genlayer.com`. Source SHA-256 `4b146292c840cf16e0dcfd7b8d488492092d73c2c3160dda366f922642eaee78` (`contracts/CharterFlowCore.py`, also served at `frontend/public/CharterFlowCore.py`).

This network is a development preview. Its state can be reset. This repository does not claim that a GenLayer Portal mission accepts chain `61997`. Check that mission's rules before submitting. Builder Portal is not submitted from here.

A fresh read at `2026-10-16T21:58:07.162Z` is summarized in [`docs/evidence/verified-flow.json`](docs/evidence/verified-flow.json).

## Verified flow

Round `round-open-source-rpc--mvb7nltc`. Proposal `prp-round-open-source-rpc--mvb7nltc-1`. The round started with 1 GEN. It paid 0.05 GEN. At the read above, the contract balance was `950000000000000000` wei (0.95 GEN).

| Step | What it shows | Transaction |
|---|---|---|
| Deploy | Contract created, `FINALIZED` / `FINISHED_WITH_RETURN` | [`0x700b…da6c`](https://explorer-studio-dev.genlayer.com/tx/0x700b462e4620bf849b873af0e515357d08e905aa03a3682d5abb06d58f80da6c) |
| Create round | 1 GEN deposit from the creator | [`0x753a…d8d0`](https://explorer-studio-dev.genlayer.com/tx/0x753a915e0a882d403d0338a04ae4c9569e34eeb04afbd7b275b09c28128dd8d0) |
| Nominate | 0.05 GEN proposal for the recipient | [`0x220c…e482`](https://explorer-studio-dev.genlayer.com/tx/0x220c4ef78af5f055e11bf1d00cdafbc1bd17dd16943c214713a6643d53c4e482) |
| AI review | Two finalized calls of the same method. One stored verdict: `ELIGIBLE` | [`0x1213…62c3`](https://explorer-studio-dev.genlayer.com/tx/0x121377a431bc73fde4595abbe22108fe07070ebcffe48ab5fb899cf6dde362c3), [`0x06e6…11bc`](https://explorer-studio-dev.genlayer.com/tx/0x06e6aad2a144b0dc139817cf9aecfd184ceb3d05c75c67a098d7cf2c56b811bc) |
| YES vote | Creator vote. Not a withdrawal | [`0x899a…4526`](https://explorer-studio-dev.genlayer.com/tx/0x899a922020fde7f680e39812df9d344d04f1c5702f71099e9648d528f3684526) |
| Withdraw | Recipient `withdraw_credit`, `FINALIZED` / `FINISHED_WITH_RETURN` | [`0x0f29…2c6a`](https://explorer-studio-dev.genlayer.com/tx/0x0f29c0f7523d74aa89d8e93cbb995c19d69191052ea8e1893de3656fec032c6a) |
| Child transfer | 0.05 GEN from the contract to `0x31e14df3b4f47F2428F3B78E7279691A78f70a05`, `triggered_by` the withdraw | [`0x6e01…d6f0`](https://explorer-studio-dev.genlayer.com/tx/0x6e012d41c822b321271b194318121a240681d4568087d06a63ffb4e882b6d6f0) |

The two review hashes are both `evaluate_charter_fit` for this proposal from `0xb3F7518df619ef485f7a1568ED3705bB6f5B0407` (nonces 13 and 14). Both are `FINALIZED` / `FINISHED_WITH_RETURN`. The contract keeps one verdict, `ELIGIBLE`, with reason `VALIDATOR_AGREED_VERDICT_ELIGIBLE; SEMANTIC_RATIONALE_NOT_VERIFIED`. The second call is not a second required review stage.

The child transfer is `FINALIZED` with execution result `NOT_VOTED`. That label fits a native transfer rather than a voted contract call. `value_credited` was true, value `50000000000000000` wei, sender the contract, recipient `0x31e14df3b4f47F2428F3B78E7279691A78f70a05`, and `triggered_by` the withdraw hash.

## How a round works

1. **Immutable charter.** `create_round` stores the charter with the deposit, the committee, the grant cap, and the deadlines. Later calls do not edit that text.
2. **Committee and recusal.** Only a roster address may nominate or vote. A recipient who is also on the roster cannot vote on their own proposal. This round's roster is the creator `0xb3F7518df619ef485f7a1568ED3705bB6f5B0407` and the recipient `0x31e14df3b4f47F2428F3B78E7279691A78f70a05`. After recusal, one YES from the creator met the quorum. The recorded vote list contains only the creator.
3. **Nomination.** A committee member names the recipient, title, deliverables, and an amount within the grant cap. This proposal asked for `50000000000000000` wei (0.05 GEN).
4. **AI eligibility review.** `evaluate_charter_fit` asks the GenLayer validators for one categorical verdict. The stored result is `ELIGIBLE`.
5. **Vote.** `cast_vote` records YES or NO. The YES hash above is the creator's ballot.
6. **Escrow.** The round began with `1000000000000000000` wei available. At the read, `payouts_emitted_wei` was `50000000000000000`, `available_wei` was `950000000000000000`, and reserved, approved, refunded, and creator-claimable balances were 0. The contract balance matched the 0.95 GEN still in the round.
7. **Recipient withdrawal.** The recipient calls `withdraw_credit`. The parent transaction is the contract call. Delivery is the separate child transfer above. The proposal state at the read was `PAYOUT_EMITTED` and `credit_withdrawn` was true.

## Not done: close and refund

Creator close and creator refund have not happened. There is no close hash and no refund hash. `refunds_emitted_wei` and `creator_claimable_wei` were 0. The round state was still `ACTIVE`.

Round end is `2026-10-27T16:53:52Z` (`1793120032`). `close_round_and_refund` can be tested only when the contract's own conditions are met after that time, including `reserved_wei` of 0. `claim_creator_refund` comes after a successful close. Do not treat the paid 0.05 GEN, or the remaining 0.95 GEN, as recovered by the creator.

## Local setup

Node.js 22 and npm. Python 3.12 and GenLayer `gltest` are needed only for `npm run test:contracts`.

```bash
npm ci
npm --prefix frontend ci
cd frontend
npm run dev
```

The dev server prints its URL, usually `http://127.0.0.1:5173/`. Another app may already own that port. CharterFlow has also been run with `npx vite --host 127.0.0.1 --port 5174 --strictPort` from `frontend/`.

Copy `.env.example` and `frontend/.env.example` only if you want local env files. They contain public RPC and contract values. Do not commit a `.env`. The app never asks for a seed phrase or private key. Operator scripts that use `keytar` are not part of the public demo path.

Wallet: any injected EIP-1193 wallet on chain `61997`. The app will not switch networks or sign by itself. Studio development preview test GEN comes from the Studio faucet, not from the Asimov faucet on chain `4221`.

Leave **PREVIEW DATA** off when you are checking live state.

## Tests and build

From the repository root:

```bash
npm test
npm run test:frontend-reads
npm run test:frontend-writes
npm run test:wallet-steward
npm run test:create-round-flow
npm run test:contracts
npm run build:frontend
npm run lint:frontend
```

`npm test` is the runner safety suite. Contract tests write only under `.pytest-artifacts/`, which is gitignored. `node scripts/verify_corrected_deploy.js` re-reads the deploy transaction and the deployed schema. It no longer requires the round registry to be empty.

## Vercel

Do not treat this repository as already deployed.

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Framework | Vite |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node.js | 22 |

`frontend/vercel.json` rewrites `/(.*)` to `/index.html` so routes such as `/rounds/:id` and `/proposals/:id` load the SPA. Vite copies `frontend/public` into `dist`, including the contract source and `frontend/public/_redirects`.

Environment variables are optional. The source defaults are already the public network. Set them only to override:

| Variable | Value |
|---|---|
| `VITE_RPC_URL` | `https://studio-next.genlayer.com/api` |
| `VITE_EXPLORER_URL` | `https://explorer-studio-dev.genlayer.com` |
| `VITE_CONTRACT_ADDRESS` | `0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8` |

Never put a private key in a `VITE_` variable. Those values are compiled into the browser bundle.

## Older contracts

These addresses are not the verified flow above.

- Legacy `0x9579A19c2aD0a2DBd0B806Abb85bE9a2E6391E48` still runs source `4ec11b1bee98122d3dad5ab86f5823d676797c1c0873133d386adeeba12b9b72`. AI review and voting are closed. Its funded rounds stay visible for recovery.
- Recovery `0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21` still holds `rnd-pilot-354517` and `round-studio-next-rpc--mv9pwatt`. Do not nominate into them.

History and diagnostics: [`docs/PUBLIC_EVIDENCE.md`](docs/PUBLIC_EVIDENCE.md), [`docs/CONTRACT_SPEC.md`](docs/CONTRACT_SPEC.md), [`docs/FRONTEND_STATIC_HOSTING.md`](docs/FRONTEND_STATIC_HOSTING.md), [`docs/LOCAL_WALKTHROUGH.md`](docs/LOCAL_WALKTHROUGH.md).
