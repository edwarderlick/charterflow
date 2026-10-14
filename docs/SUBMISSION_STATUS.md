# CharterFlow submission evidence status

**As of:** 2026-10-14  
**Network:** GenLayer Studio Next, chain ID `61997`  
**Portal status:** Not submitted; not portal-ready. Public-safe local git packaging is complete after one local initial commit on `master`. No remote and no push.  
**Stage 2:** **INCONCLUSIVE** — round `rnd-pilot-354517` and its 1 GEN genesis ledger remain unverified.

## Verified

- Contract `0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21` was deployed by transaction `0xc5c220571c8d890c04715ce65cfd23ae92a0d49e696c596979591f771ab734e4`.
- Local source, transaction source, and deployed code share SHA-256 `34ea0e374cfe68788067838cebf4ca0c226e139c713aca6e7345716b35aad5ee`.
- Deployment receipt, code, chain, and schema were independently reconciled.
- The intended Stage 2 `create_round` transaction `0x1476320746c0efda5f97d2db6256c571c6da7adff7c494af33031bf9adfb0bdc` is `FINALIZED` with `FINISHED_WITH_RETURN` and value `1000000000000000000` wei.
- PaymentSpike control at `0xD30E2Da70f4fD27B25c8aC65E67e30AC5a1fb513` is independently confirmed on the same RPC (deploy tx, code, `get_state` ABI). Its `get_state` view **fails** `gen_call` with `-32603` on both `latest-final` and `latest-nonfinal`. Classification: **control fails**. See unsent `docs/GENLAYER_SUPPORT_DRAFT.md`.

## Not yet proven

- `rnd-pilot-354517` has not passed complete `get_round`, registry, genesis-ledger, and contract-balance reconciliation. A receipt alone is insufficient. Exact `verifyStage2GenesisReadback` has not been applied on successful real-chain views.
- No nomination, AI charter verdict, vote, approval, unauthorized-withdraw rejection, authorized withdrawal, payout emission, recipient delivery, duplicate-withdraw rejection, round closure, or creator refund has been proven for this deployment.
- The live browser workflow has not been proven end to end. Design-preview fixtures are not chain evidence.
- Public GitHub URL, hosted frontend URL, and portal submission are absent.

## Required before a portal-ready claim

1. Resolve the Studio Next JSON-RPC `-32603` rollback-state error and independently reconcile Stage 2 with the exact genesis verifier.
2. Complete the fail-closed funded lifecycle using fresh per-write fees and one-attempt intents.
3. For withdrawal, establish a positive native-message fee estimate and distinguish `PAYOUT_EMITTED` from independently proven delivery.
4. Exercise the live frontend read/write workflow against the reconciled deployment without treating network errors as empty state.
5. Publish a public-safe git repository and a hosted frontend URL; then submit Builder Portal evidence URLs. Checklist: `docs/PORTAL_SUBMISSION_CHECKLIST.md`. Copy: `docs/PROJECT_COPY.md`.
6. Preserve exact receipts, state snapshots, ledger equations, balances, timestamps, and sanitized screenshots.
