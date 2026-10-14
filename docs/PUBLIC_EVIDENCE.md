# Public evidence summary

This is the only chain evidence intended for the first public commit. Full historical receipts, signed rollup blobs, and operator checkpoints remain local (see `docs/LOCAL_CHECKPOINT.md`).

**Stage 2 is INCONCLUSIVE. This is not an end-to-end working pilot.**

## Verified deployment (Stage 1)

| Fact | Value |
|---|---|
| Network | GenLayer Studio Next |
| Chain ID | `61997` |
| RPC | `https://studio-next.genlayer.com/api` |
| Contract | `0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21` |
| Deploy transaction | `0xc5c220571c8d890c04715ce65cfd23ae92a0d49e696c596979591f771ab734e4` |
| Source SHA-256 | `34ea0e374cfe68788067838cebf4ca0c226e139c713aca6e7345716b35aad5ee` |

Local source, transaction source, and deployed code were independently reconciled to that hash. `contracts/CharterFlowCore.py` must remain byte-identical.

## Finalized `create_round` receipt (not round verification)

| Fact | Value |
|---|---|
| Transaction | `0x1476320746c0efda5f97d2db6256c571c6da7adff7c494af33031bf9adfb0bdc` |
| Status / result | `FINALIZED` / `FINISHED_WITH_RETURN` |
| Sender | `0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066` |
| Nonce | `1` |
| Value | `1000000000000000000` wei (1 GEN) |
| Intended round ID | `rnd-pilot-354517` |
| Contract `eth_getBalance` (diagnostic) | `1000000000000000000` wei |
| Creator nonce latest/pending (diagnostic) | `2` / `2` |

A receipt, nonce change, or contract balance is not proof that the round, registry, genesis ledger, or accounting equation exist as specified.

## Unresolved Stage 2 readback

Required views `get_round(rnd-pilot-354517)`, `get_round_ids_count`, `get_round_ids(0,50)`, and extra `get_all_proposal_ids_count` failed on Studio Next `gen_call` with JSON-RPC `-32603` rollback for `TransactionHashVariant.LATEST_NONFINAL` (`2026-10-14T06:20:21.083Z`) and `LATEST_FINAL` (`2026-10-14T06:29:27.444Z`, `2026-10-14T07:51:05.846Z`, and `2026-10-14T08:10:22.504Z`). Exact `verifyStage2GenesisReadback` was not applied. The 1 GEN genesis ledger remains **unverified**. No Stage 3+ write was sent. Chain ID `61997`, contract `0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21`, create_round `0x1476320746c0efda5f97d2db6256c571c6da7adff7c494af33031bf9adfb0bdc` `FINALIZED`/`FINISHED_WITH_RETURN`, contract `eth_getBalance` `1e18` wei, creator nonce `2`/`2`, write calls `0`.

`rnd-pilot-354517` is a **locked recovery/refund case**. Its nomination cutoff has passed. Its 1 GEN stays locked until `round_end`. Do not nominate into it, reuse its ID, or treat it as a completed lifecycle.

Sanitized error:

> Can't reconnect until invalid transaction is rolled back. Please rollback() fully before proceeding.

## Two-contract `gen_call` diagnosis

Control contract PaymentSpike `0xD30E2Da70f4fD27B25c8aC65E67e30AC5a1fb513` (deploy tx `0xb27210ff8f5b5f9771ee17ae85892c2e4cb4c21a867d1cb06c9550a531f1c5be`) was independently confirmed on the same RPC (transaction, code, `get_state` ABI). `readContract` / `gen_call` `get_state` failed `-32603` on both `latest-final` (`2026-10-14T06:40:51.295Z`) and `latest-nonfinal` (`2026-10-14T06:40:51.643Z`). Classification: **control fails**. `eth_*` reads succeeded. This is not treated as a total RPC outage.

Unsent support draft: `docs/GENLAYER_SUPPORT_DRAFT.md`.
