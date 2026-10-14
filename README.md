# CharterFlow

CharterFlow is a charter-bound grant coordination protocol for the GenLayer Intelligent VM (Studio Next, chain ID `61997`). A creator deposits native GEN into an isolated round, freezes a natural-language charter, and names a committee. Independent validators return a categorical charter-fit verdict. Eligible members vote with recipient recusal and a 2/3 ceiling quorum. Recipients pull approved credits; the contract emits a native transfer. Creator leftovers close through a refund claim.

This repository is **not** an end-to-end working on-chain pilot. Stage 2 readback is **INCONCLUSIVE**. See `docs/PUBLIC_EVIDENCE.md` and `docs/PROJECT_COPY.md`.

## Current blocked state

- **Contract source:** `contracts/CharterFlowCore.py` SHA-256 `34ea0e374cfe68788067838cebf4ca0c226e139c713aca6e7345716b35aad5ee` (must stay byte-identical with the deployed source).
- **Deployed contract:** `0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21` (tx `0xc5c220571c8d890c04715ce65cfd23ae92a0d49e696c596979591f771ab734e4`).
- **Finalized `create_round`:** `0x1476320746c0efda5f97d2db6256c571c6da7adff7c494af33031bf9adfb0bdc` is `FINALIZED` / `FINISHED_WITH_RETURN` with value `1e18` wei. Intended round `rnd-pilot-354517` and its 1 GEN genesis ledger are **unverified**.
- **Studio Next `gen_call`:** contract views fail JSON-RPC `-32603` rollback on both CharterFlow and an independently confirmed PaymentSpike control. `eth_*` reads succeed.
- **No Stage 3+ writes** have been sent. Do not redeploy, resend `create_round`, or fund accounts from a public checkout.
- **Builder Portal:** not submitted. `docs/PORTAL_SUBMISSION_CHECKLIST.md`.

## Network

| Item | Value |
|---|---|
| Network | GenLayer Studio Next |
| Chain ID | `61997` (`0xf22d`) |
| RPC | `https://studio-next.genlayer.com/api` |
| Explorer base | `https://explorer-studio-dev.genlayer.com/` |

## Architecture and safety limits

1. One multi-round contract with isolated ledgers (`available_wei`, `reserved_wei`, `approved_credits_wei`, `creator_claimable_wei`, `payouts_emitted_wei`, `refunds_emitted_wei`).
2. Charter review uses `gl.vm.run_nondet_unsafe` on a categorical verdict only. Stored reasons state that semantic rationale was not verified. Invalid JSON fails closed to `NEEDS_CLARITY`.
3. Voting quorum is `(N * 2 + 2) // 3`. Recipients on the committee are recused.
4. Payouts are pull-based `withdraw_credit()` → `_Recipient(address).emit_transfer(value=...)`. Truthful state is `PAYOUT_EMITTED`, not independently proven delivery.
5. The runner is fail-closed: a receipt, nonce, registry row, or balance change alone is not Stage 2 proof. Write modes require the operator-held local checkpoint (`docs/LOCAL_CHECKPOINT.md`). A missing checkpoint does **not** start a new funded pilot.

## Fresh checkout

Node 18+ and npm. Python 3.12+ plus GenLayer `gltest` **v0.6.0-rc8** are required only for contract unit tests.

```bash
npm ci
npm --prefix frontend ci
npm run test:safety
npm run test:frontend-reads
npm run test:frontend-writes
npm run build:frontend
npm run lint:frontend
pytest tests/test_charterflow_core.py
```

Root `.env.example` and `frontend/.env.example` contain public RPC/chain/contract values only. Copy them if you need local env files. Credentials stay in the OS credential manager via `keytar`. Never commit `.env`, keystores, or `scripts/pilot_evidence.json`.

Frontend defaults (overridable with `VITE_*`):

- `VITE_RPC_URL=https://studio-next.genlayer.com/api`
- `VITE_EXPLORER_URL=https://explorer-studio-dev.genlayer.com`
- `VITE_CONTRACT_ADDRESS=0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21`

```bash
cd frontend
npm run dev
```

Static-host plan (not deployed): `docs/FRONTEND_STATIC_HOSTING.md`. Live mode must show RPC errors honestly; design preview stays explicitly labeled.

### Read-only chain commands

```bash
node scripts/run_charterflow_pilot.js --probe
node scripts/run_charterflow_pilot.js --reconcile-deployment
node scripts/run_charterflow_pilot.js --reconcile-stage2 --count=1 --interval=0
```

These make no writes. Without `scripts/pilot_evidence.json` they use the public recorded hashes and will not create a new checkpoint. `--deploy-only`, `--lifecycle-only`, and `--resume` halt unless that local file (or `CHARTERFLOW_EVIDENCE_FILE`) already exists.

## Local tests vs chain proof

| Class | Status |
|---|---|
| Pytest contract tests | 18 tests in `tests/test_charterflow_core.py` |
| Runner safety suite | `npm run test:safety` |
| Frontend unit tests | `npm run test:frontend-reads` / `test:frontend-writes` |
| Deployed source | Verified at the address and hash above |
| Live round lifecycle | Blocked; Stage 2 INCONCLUSIVE |

PaymentSpike (`spike/PaymentSpike.py`) is a retired control contract. It does not validate CharterFlowCore. Operator-only helpers `scripts/fund_pilot_accounts.js` and `spike/run_payment_test.js` load keys from the OS credential manager via `keytar`. Do not run them from a public checkout.
