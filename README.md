# CharterFlow

CharterFlow is a grant round on a GenLayer intelligent contract. A creator locks a natural-language charter and a GEN deposit. A committee nominates work. GenLayer validators return one categorical charter-fit verdict. Eligible members vote, with the recipient recused. The recipient withdraws an approved credit, and the contract emits the native transfer.

The charter check matters because the verdict is produced inside the contract, not pasted in from an off-chain review. The leader and validators must agree on the category. The stored reason records that agreement and states that a free-text rationale was not verified. A disagreement leaves the proposal unmoved.

**Public demo:** [https://charterflow-coral.vercel.app/](https://charterflow-coral.vercel.app/)

**Contract:** [`0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8`](https://explorer-studio-dev.genlayer.com/address/0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8)

**Network:** GenLayer Studio development preview, chain ID `61997` (`0xf22d`). RPC `https://studio-next.genlayer.com/api`. Explorer `https://explorer-studio-dev.genlayer.com`. Source SHA-256 `4b146292c840cf16e0dcfd7b8d488492092d73c2c3160dda366f922642eaee78` (`contracts/CharterFlowCore.py`, also served at `frontend/public/CharterFlowCore.py`).

This network is a development preview. Its state can be reset. This repository does not claim that a GenLayer Portal mission accepts chain `61997`. Check that mission's rules before submitting. Builder Portal is not submitted from here.

A read at `2026-10-16T21:58:07.162Z` is summarized in [`docs/evidence/verified-flow.json`](docs/evidence/verified-flow.json) and [`docs/SUBMISSION_STATUS.md`](docs/SUBMISSION_STATUS.md). Earlier readback records preserve the [deployment source and schema check](docs/evidence/deployment-readback.json) and [round creation and ledger reconciliation](docs/evidence/round-creation-readback.json). These are dated snapshots; the app's live reads show current state.

## Verified flow

Round `round-open-source-rpc--mvb7nltc`. Proposal `prp-round-open-source-rpc--mvb7nltc-1`. The round started with 1 GEN. It paid 0.05 GEN. At the read above, the contract balance was `950000000000000000` wei (0.95 GEN).

Steward entry points: [live round](https://charterflow-coral.vercel.app/rounds/round-open-source-rpc--mvb7nltc) and [paid proposal](https://charterflow-coral.vercel.app/proposals/prp-round-open-source-rpc--mvb7nltc-1). Keep **PREVIEW DATA** off; no wallet is required to inspect the live reads.

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

## Steward proof map

Each row separates a live transaction or readback from a local regression test. A passing local test is not a second live transaction.

| Review question | Public evidence and reproducible check | Limit |
|---|---|---|
| Is the submitted source the deployed contract? | [Deploy receipt](https://explorer-studio-dev.genlayer.com/tx/0x700b462e4620bf849b873af0e515357d08e905aa03a3682d5abb06d58f80da6c), [source/schema readback](docs/evidence/deployment-readback.json), [contract source](contracts/CharterFlowCore.py), and `node scripts/verify_corrected_deploy.js`. The transaction source, deployed code, and repository source have SHA-256 `4b146292c840cf16e0dcfd7b8d488492092d73c2c3160dda366f922642eaee78`; the deployed schema has 18 methods. | The readback is a dated snapshot on a development preview that can reset. |
| Did the funded round exist with the stated terms? | [Create receipt](https://explorer-studio-dev.genlayer.com/tx/0x753a915e0a882d403d0338a04ae4c9569e34eeb04afbd7b275b09c28128dd8d0) and [round/registry/balance readback](docs/evidence/round-creation-readback.json) match the ID, creator, roster, charter hash, 1 GEN deposit, 0.1 GEN cap, deadlines, and 1 GEN contract balance at creation. | This readback was captured at `2026-10-16T17:07:09.481Z`, before the payout. |
| Are proposal identity, reservations, roles, and quorum enforced? | [Nomination](https://explorer-studio-dev.genlayer.com/tx/0x220c4ef78af5f055e11bf1d00cdafbc1bd17dd16943c214713a6643d53c4e482), [YES vote](https://explorer-studio-dev.genlayer.com/tx/0x899a922020fde7f680e39812df9d344d04f1c5702f71099e9648d528f3684526), and the [post-payout state snapshot](docs/evidence/verified-flow.json) show the exact proposal, one vote from the creator, recipient recusal, and the ledger. [Direct contract tests](tests/test_charterflow_core.py) cover duplicate/zero addresses, cross-round isolation, recusal, thresholds, unauthorized calls, conservation, and pagination. [Runner safety tests](scripts/test_runner_safety.js) cover transaction-specific ID correlation and pagination beyond 50 entries. | Negative role and pagination cases are local tests, not live rejection receipts for this pilot. |
| Is AI review inside the contract and fail closed? | Two [review](https://explorer-studio-dev.genlayer.com/tx/0x121377a431bc73fde4595abbe22108fe07070ebcffe48ab5fb899cf6dde362c3) [transactions](https://explorer-studio-dev.genlayer.com/tx/0x06e6aad2a144b0dc139817cf9aecfd184ceb3d05c75c67a098d7cf2c56b811bc) led to one stored `ELIGIBLE` verdict. [Runner compatibility tests](tests/test_runner_compat.py) exercise the pinned `gl.vm.run_nondet` API. `test_ai_review_fail_closed_and_equivalence` in the [direct tests](tests/test_charterflow_core.py) covers malformed output, unknown verdicts, `INELIGIBLE`, and disagreement. | Only the categorical verdict is compared. Free-text semantic rationale and a live negative verdict are not proven. |
| Was the approved 0.05 GEN actually delivered? | [Recipient withdrawal parent](https://explorer-studio-dev.genlayer.com/tx/0x0f29c0f7523d74aa89d8e93cbb995c19d69191052ea8e1893de3656fec032c6a), [finalized credited child transfer](https://explorer-studio-dev.genlayer.com/tx/0x6e012d41c822b321271b194318121a240681d4568087d06a63ffb4e882b6d6f0), and [state/ledger snapshot](docs/evidence/verified-flow.json) show 0.05 GEN delivered and 0.95 GEN left. [Frontend write tests](scripts/test_frontend_writes.ts) reject a foreign vote hash, parent-only delivery claims, duplicate submission, stale quotes, and zero native-message fees. | A successful EOA child transfer is proven. A failed child transfer and recovery from that failure are not. |
| Can the creator close and claim remaining funds? | `test_bounded_settlement_and_closure`, `test_approved_credits_do_not_block_closure_or_emit_refund`, `test_unauthorized_claims`, and `test_claims_after_closure` in the [direct tests](tests/test_charterflow_core.py) exercise these contract branches locally. | **No live close or refund receipt exists.** The pilot round ends `2026-10-27T16:53:52Z`; the creator must also have `reserved_wei == 0`. |

The current contract marks an approved credit `PAYOUT_EMITTED` when it emits a native child transfer. It has **no demonstrated on-chain retry or recredit path if that child later fails**. This is a material settlement limit, not a proven recovery feature. The recipient payout claim above relies on the separate finalized, credited child transaction. GenLayer's [value-transfer documentation](https://docs.genlayer.com/developers/intelligent-contracts/features/value-transfers) also says a failed child does not automatically return value to the sender. Do not infer delivery from a parent receipt or `PAYOUT_EMITTED` alone.

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

Node.js 22 and npm. Python 3.12 is needed only for `npm run test:contracts`; its tested direct-mode dependencies are pinned in [`requirements-test.txt`](requirements-test.txt). The contract's `Depends` header separately pins the GenVM runner and standard library. The direct-mode test runner downloads that pinned artifact on first use, so its first run needs network access. These tests do not execute a full WASM GenVM or a live wallet transaction.

```bash
npm ci
npm --prefix frontend ci
cd frontend
npm run dev
```

For the Python contract suite, create a Python 3.12 virtual environment, install `requirements-test.txt` into it, then run `npm run test:contracts` with that environment active. On Windows:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements-test.txt
.\.venv\Scripts\Activate.ps1
npm run test:contracts
```

The dev server prints its URL, usually `http://127.0.0.1:5173/`. Another app may already own that port. CharterFlow has also been run with `npx vite --host 127.0.0.1 --port 5174 --strictPort` from `frontend/`.

Copy `.env.example` and `frontend/.env.example` only if you want local env files. They contain public RPC and contract values. Do not commit a `.env`. The app never asks for a seed phrase or private key. Operator scripts that use `keytar` are not part of the public demo path.

Wallet: any injected EIP-1193 wallet on chain `61997`. The app will not switch networks or sign by itself. Studio development preview test GEN comes from the Studio faucet, not from the Asimov faucet on chain `4221`.

Leave **PREVIEW DATA** off when you are checking live state.

## Tests and build

From the repository root, after installing the Node and pinned Python test dependencies above. The [public verification workflow](.github/workflows/verify.yml) runs the contract, safety, frontend, wallet, create-round, and production-build checks from a fresh checkout. Its GitHub run status is the public execution record; local test counts alone are not CI evidence.

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

The connected project is [https://charterflow-coral.vercel.app/](https://charterflow-coral.vercel.app/). These are the import settings. This repository does not deploy itself.

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

History, status, and diagnostics: [`docs/SUBMISSION_STATUS.md`](docs/SUBMISSION_STATUS.md), [`docs/PUBLIC_EVIDENCE.md`](docs/PUBLIC_EVIDENCE.md), [`docs/CONTRACT_SPEC.md`](docs/CONTRACT_SPEC.md), [`docs/FRONTEND_STATIC_HOSTING.md`](docs/FRONTEND_STATIC_HOSTING.md), [`docs/LOCAL_WALKTHROUGH.md`](docs/LOCAL_WALKTHROUGH.md).
