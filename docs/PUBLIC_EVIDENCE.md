# Public evidence summary

The live contract is `0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8` on Studio development preview, chain `61997`. Source SHA-256 `4b146292c840cf16e0dcfd7b8d488492092d73c2c3160dda366f922642eaee78` is deployed. The verified round flow, including the 0.05 GEN child transfer, is in the README and in [`evidence/verified-flow.json`](evidence/verified-flow.json). That read was taken at `2026-10-16T21:58:07.162Z`. Creator close and refund have not happened.

Sections below that name `0x9579A19c2aD0a2DBd0B806Abb85bE9a2E6391E48` or `0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21` are earlier contracts. They are not the verified deployment. Full receipts and operator checkpoints stay local (`docs/LOCAL_CHECKPOINT.md`).

The earlier rounds `round-studio-next-rpc--mvarlewq` and `round-studio-next-rpc--mvas9jju` are each separate 1 GEN rounds on the legacy contract. Legacy Stage 2 on `0x408D…` remains separate.

## Live corrected deployment

| Fact | Value |
|---|---|
| Network | GenLayer Studio Next |
| Chain ID | `61997` |
| RPC | `https://studio-next.genlayer.com/api` |
| Contract | `0x9579A19c2aD0a2DBd0B806Abb85bE9a2E6391E48` |
| Deploy transaction | `0x9f23ec04bc3c29f325afc9b1026da6247395b11602c2c783473fe22e59364cfd` |
| Status / result | `FINALIZED` / `FINISHED_WITH_RETURN` |
| Deployer | `0x31e14df3b4f47F2428F3B78E7279691A78f70a05` |
| Source SHA-256 | `4ec11b1bee98122d3dad5ab86f5823d676797c1c0873133d386adeeba12b9b72` |
| Schema | 18 methods |
| Round registry | `get_round_ids_count` = `2` (`round-studio-next-rpc--mvarlewq`, `round-studio-next-rpc--mvas9jju`) |
| Contract balance | `2000000000000000000` wei (2 GEN), the sum of the two round ledgers |

The deploy transaction's `data.contract_code` matches source SHA-256 `4ec11b1bee98122d3dad5ab86f5823d676797c1c0873133d386adeeba12b9b72`. That is the bytecode at `0x9579A19c2aD0a2DBd0B806Abb85bE9a2E6391E48`. It cannot be patched. The working tree and `frontend/public/CharterFlowCore.py` are SHA-256 `4b146292c840cf16e0dcfd7b8d488492092d73c2c3160dda366f922642eaee78`, which is deployed at `0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8`, not at this legacy address.

## Verified `create_round` on the corrected contract

Verdict: **VERIFIED**. Read-only retry after a temporary "all 8 execution slots occupied" error. No replacement transaction was sent.

| Fact | Value |
|---|---|
| Transaction | `0x923d91ad011a7415530096b5ba35300231a4b6041211f15c5453dbb5040336b7` |
| Status / result | `FINALIZED` / `FINISHED_WITH_RETURN` |
| Sender / creator | `0x31e14df3b4f47F2428F3B78E7279691A78f70a05` |
| Contract | `0x9579A19c2aD0a2DBd0B806Abb85bE9a2E6391E48` |
| Value | `1000000000000000000` wei (1 GEN) |
| Round ID | `round-studio-next-rpc--mvarlewq` |
| Title | Studio Next RPC Health Dashboard Pilot |
| State | `ACTIVE` |
| Grant cap | `100000000000000000` wei (0.1 GEN) |
| Nomination cutoff | `1792747670` (`2026-10-23T09:27:50.000Z`) |
| Voting duration | `259200` seconds (3 days) |
| Round end | `1793093270` (`2026-10-27T09:27:50.000Z`) |
| Committee, in order | `0x7E4E1f7DcC3DA063F9110477Ad348C90E8599253`, `0x9471C57aF9DF875d4D42EDb046e446E85D9CFE3A`, `0xb3F7518df619ef485f7a1568ED3705bB6f5B0407` |
| Available / reserved / approved / paid / refunded | `1e18` / `0` / `0` / `0` / `0` wei |
| Proposal count | `0` |
| Contract balance at this verification | `0xde0b6b3a7640000` (1 GEN) |
| Registry at this verification | count `1`, only this round ID |

The creator address is not on the committee. Nomination is open until the cutoff for those three committee wallets only.

## Second verified `create_round` on the same contract

Verdict: **VERIFIED**. Read-only. No replacement, refund, or new write was sent. This round is not `round-studio-next-rpc--mvarlewq`.

| Fact | Value |
|---|---|
| Transaction | `0xd29b3820cc1f45c2328c3c1e38f09fbef1c539689261311292afd3dd7f91ac2c` |
| Status / result | `FINALIZED` / `FINISHED_WITH_RETURN` |
| Sender / creator | `0x31e14df3b4f47F2428F3B78E7279691A78f70a05` |
| Contract | `0x9579A19c2aD0a2DBd0B806Abb85bE9a2E6391E48` |
| Nonce | `277` |
| Value | `1000000000000000000` wei (1 GEN), credited |
| Round ID | `round-studio-next-rpc--mvas9jju` |
| Title | Studio Next RPC Health Dashboard Pilot |
| State | `ACTIVE` |
| Created | `1792144014` (`2026-10-16T09:46:54.000Z`) |
| Grant cap | `100000000000000000` wei (0.1 GEN) |
| Nomination cutoff | `1792748793` (`2026-10-23T09:46:33.000Z`) |
| Voting duration | `259200` seconds (3 days) |
| Round end | `1793094393` (`2026-10-27T09:46:33.000Z`) |
| Committee, in order | `0x7E4E1f7DcC3DA063F9110477Ad348C90E8599253`, `0x9471C57aF9DF875d4D42EDb046e446E85D9CFE3A`, `0xb3F7518df619ef485f7a1568ED3705bB6f5B0407` |
| Available / reserved / approved / paid / refunded / creator claimable | `1e18` / `0` / `0` / `0` / `0` / `0` wei |
| Proposal count | `0` |
| Registry | count `2`; this ID is second and newer |
| Contract balance across both rounds | `0x1bc16d674ec80000` (2 GEN) |

The calldata names this round ID and does not name the pilot round. The creator is not on the committee, so that wallet cannot nominate. Nomination for this round is open to the three committee addresses until `2026-10-23T09:46:33.000Z`.

## Failed `evaluate_charter_fit` on `round-studio-next-rpc--mvas9jju`

Verdict: **contract compatibility defect**. This is not a Studio outage. No replacement, settlement, close, or refund was sent. Funds are not recovered.

| Fact | Value |
|---|---|
| Transaction | `0x3e6541640c119ca4c1120349f3b7771c8ad5d4d712d663aee2c3ef6bce6bb1bc` |
| Status / result | `FINALIZED` / `FINISHED_WITH_ERROR` |
| Sender | `0x7E4E1f7DcC3DA063F9110477Ad348C90E8599253` |
| Contract | `0x9579A19c2aD0a2DBd0B806Abb85bE9a2E6391E48` |
| Value | `0` |
| Error | `genlayer.vm` has no `run_nondet_unsafe` at the deployed `CharterFlowCore.py` line 454 |
| Proposal | `prp-round-studio-next-rpc--mvas9jju-1` |
| Proposal state after the receipt | `SUBMITTED` |
| Review verdict / reason | `PENDING` / empty |
| Requested and reserved | `50000000000000000` wei (0.05 GEN) |
| Round available | `950000000000000000` wei (0.95 GEN) |
| Round state | `ACTIVE` |
| Submission | `1792145774` (`2026-10-16T10:16:14.000Z`) |
| Review deadline | `1792232174` (`2026-10-17T10:16:14.000Z`) |
| Voting deadline | `0` |
| Contract balance after the receipt | `2000000000000000000` wei (2 GEN) |

The receipt alone is not the state proof. `get_proposal` and `get_round` were read after the receipt. The failed execution did not credit value and did not change the proposal out of `SUBMITTED`. The 0.05 GEN reservation came from the earlier nomination, not from this failed review.

On this unpatched bytecode, `evaluate_charter_fit` reaches the missing API until `2026-10-17T10:16:14.000Z`. After that timestamp the same method can take the timeout branch, set `EXPIRED`, and move the 0.05 GEN from reserved back to available, without calling the model. `settle_expired_proposal` can do the same release once that deadline has passed. Neither call has been sent.

`round-studio-next-rpc--mvarlewq` has reserved `0`, available `1e18`, proposal nonce `0`, and state `ACTIVE`. Nomination stays open until `2026-10-23T09:27:50.000Z`, so a later nomination can reserve funds again. `close_round_and_refund` requires `round_end` and `reserved_wei == 0`. That round's end is `2026-10-27T09:27:50.000Z`. The evaluated round's end is `2026-10-27T09:46:33.000Z`, and close stays blocked while 0.05 GEN is reserved. `claim_creator_refund` is a later creator call after `CLOSED` and still needs a positive native-message fee. No close or claim receipt exists.

## Recovery deployment (defective Address storage)

| Fact | Value |
|---|---|
| Contract | `0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21` |
| Deploy transaction | `0xc5c220571c8d890c04715ce65cfd23ae92a0d49e696c596979591f771ab734e4` |
| Source SHA-256 | `34ea0e374cfe68788067838cebf4ca0c226e139c713aca6e7345716b35aad5ee` |

That contract stays a recovery case. Do not send new live writes to it. Do not resend failed nomination `0x56c7d6d56cb4434bf341a2ab56f42c9db2ee8cef468f87c199c0b120475080f5`.

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
