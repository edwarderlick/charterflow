# DRAFT — GenLayer Studio Next Stage 2 readback error

**Status:** Draft only; not sent  
**Latest observation:** 2026-10-14T06:40:51.295Z (PaymentSpike control `get_state`, `LATEST_FINAL`)  
**Prior CharterFlow `latest-final` observation:** 2026-10-14T06:29:27.444Z  
**Prior CharterFlow `latest-nonfinal` observation:** 2026-10-14T06:20:21.083Z  
**Earlier sequential observation:** 2026-10-14T02:17:57.367Z  
**Network:** Studio Next, chain ID `61997`  
**CharterFlow round / 1 GEN genesis ledger:** **unverified**. Stage 2 remains **INCONCLUSIVE**.

Hello GenLayer support,

CharterFlow remains blocked on independently reproducible Studio Next contract reads after a finalized contract call:

- Contract: `0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21`
- Deployed source SHA-256: `34ea0e374cfe68788067838cebf4ca0c226e139c713aca6e7345716b35aad5ee`
- `create_round` transaction: `0x1476320746c0efda5f97d2db6256c571c6da7adff7c494af33031bf9adfb0bdc`
- Transaction status / result: `FINALIZED` / `FINISHED_WITH_RETURN`
- Intended round ID: `rnd-pilot-354517`
- SDK: genlayer-js `2.0.0-rc.1` `readContract({ transactionHashVariant })` → `gen_call` `{ type: "read", transaction_hash_variant }`
- RPC: `https://studio-next.genlayer.com/api`

Stage 2 verdict: **INCONCLUSIVE**. Required round/registry views did not succeed, so the exact genesis verifier was not applied. The intended round `rnd-pilot-354517` and its 1 GEN genesis ledger remain **unverified**. This pass did not re-probe the CharterFlow round.

## Control diagnostic (PaymentSpike `get_state`) — **control fails**

One bounded, read-only control against a previously deployed contract whose address and ABI were confirmed from local spike evidence (`spike/payment_evidence.json`, `spike/PaymentSpike.py` `@gl.public.view def get_state`). Zero write RPC attempts. CharterFlow round views were not called.

Local confirmation before the RPC:

- Address: `0xD30E2Da70f4fD27B25c8aC65E67e30AC5a1fb513`
- Deploy tx (local evidence): `0xb27210ff8f5b5f9771ee17ae85892c2e4cb4c21a867d1cb06c9550a531f1c5be`
- Method: `get_state()` → `{owner, authorized_recipient, entitled_amount, paid, balance}`
- Historical spike RPC recorded as `https://studio-dev.genlayer.com/api`; this control used Studio Next `https://studio-next.genlayer.com/api`, chain `61997`

Independent on-chain confirmation of that control deployment (same RPC, same chain):

| Call | Timestamp (UTC) | SDK / RPC | Parameters | Result |
|---|---|---|---|---|
| `getChainId` | 2026-10-14T06:40:48.206Z | `getChainId` | `{}` | ok `61997` |
| deploy tx | 2026-10-14T06:40:49.671Z | `getTransaction` / `eth_getTransactionByHash` | hash `0xb27210ff8f5b5f9771ee17ae85892c2e4cb4c21a867d1cb06c9550a531f1c5be` | ok: `to_address` `0xD30E2Da70f4fD27B25c8aC65E67e30AC5a1fb513`, status `7` / `FINALIZED`, `FINISHED_WITH_RETURN` |
| contract code | 2026-10-14T06:40:50.585Z | `getContractCode` | address `0xD30E2Da70f4fD27B25c8aC65E67e30AC5a1fb513` | ok: deployed source includes public `get_state` |
| contract balance | 2026-10-14T06:40:50.949Z | `getBalance` / `eth_getBalance` | address `0xD30E2Da70f4fD27B25c8aC65E67e30AC5a1fb513` | ok `0` wei |
| `get_state` | 2026-10-14T06:40:51.295Z | `readContract` / `gen_call` `{type:"read"}` | address `0xD30E2…`, `functionName:"get_state"`, `args:[]`, `transactionHashVariant:"latest-final"` (`TransactionHashVariant.LATEST_FINAL`) | **failed** JSON-RPC `-32603` rollback |
| `get_state` | 2026-10-14T06:40:51.643Z | `readContract` / `gen_call` `{type:"read"}` | same, `transactionHashVariant:"latest-nonfinal"` (`TransactionHashVariant.LATEST_NONFINAL`) | **failed** JSON-RPC `-32603` rollback |

Sanitized `gen_call` error on both variants:

> Can't reconnect until invalid transaction is rolled back. Please rollback() fully before proceeding (Background on this error at: https://sqlalche.me/e/20/8s2b)

Write-call count: `0`. Classification: **control fails**. Deployment address, deploy transaction, and `get_state` method were independently confirmed; the view still failed. This is a confirmed `gen_call` view failure on a second contract. `eth_*` reads on the same RPC succeeded, so this is not treated as a total RPC outage.

## Variant comparison

Both variants were requested through the installed SDK API. This is now a general `gen_call` contract-view failure: **both** `latest-nonfinal` and `latest-final` failed the same views with JSON-RPC `-32603`. Transaction, balance, and nonce endpoints on the same RPC succeeded in both passes.

| Call | `latest-nonfinal` (2026-10-14T06:20:21.083Z) | `latest-final` (2026-10-14T06:29:27.444Z) |
|---|---|---|
| `getTransaction` create-round tx | ok: FINALIZED / FINISHED_WITH_RETURN, sender `0x6201f71E…Dae066`, nonce `1`, value `1e18` wei | ok: same |
| `get_round(rnd-pilot-354517)` | failed `-32603` rollback | failed `-32603` rollback |
| `get_round_ids_count` | failed `-32603` rollback | failed `-32603` rollback |
| `get_round_ids(0,50)` | failed `-32603` rollback | failed `-32603` rollback |
| `get_all_proposal_ids_count` | failed `-32603` rollback | failed `-32603` rollback |
| `eth_getBalance` contract | ok `1000000000000000000` wei | ok `1000000000000000000` wei |
| creator `eth_getTransactionCount` latest/pending | ok `2` / `2` | ok `2` / `2` |

Rollback detail on every failed `gen_call`:

> Can't reconnect until invalid transaction is rolled back. Please rollback() fully before proceeding (Background on this error at: https://sqlalche.me/e/20/8s2b)

Every failed view returned JSON-RPC `-32603` rollback. No round payload and no `ERR_ROUND_NOT_FOUND` were received.

## Latest pass (`latest-final`) per-call capture

SDK `readContract` was called with `transactionHashVariant: TransactionHashVariant.LATEST_FINAL` (`"latest-final"`). Write-call count: `0`. HTTP status was not exposed on the SDK error object.

- **transaction** @ 2026-10-14T06:29:27.444Z — `getTransaction` / `eth_getTransactionByHash` — ok — FINALIZED / FINISHED_WITH_RETURN, sender `0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066`, nonce `1`, valueWei `1000000000000000000`
- **get_round** @ 2026-10-14T06:29:28.430Z — `readContract` / `gen_call` type=read, variant=`latest-final` — `-32603` rollback
- **get_round_ids_count** @ 2026-10-14T06:29:28.762Z — `readContract` / `gen_call` type=read, variant=`latest-final` — `-32603` rollback
- **get_round_ids** @ 2026-10-14T06:29:29.504Z — `readContract` / `gen_call` type=read, variant=`latest-final` — `-32603` rollback
- **contract_balance** @ 2026-10-14T06:29:30.965Z — `getBalance` / `eth_getBalance` — ok `1000000000000000000`
- **creator_latest_nonce** @ 2026-10-14T06:29:31.337Z — `getTransactionCount` latest — ok `2`
- **creator_pending_nonce** @ 2026-10-14T06:29:31.699Z — `getTransactionCount` pending — ok `2`
- **get_all_proposal_ids_count** @ 2026-10-14T06:29:32.109Z — `readContract` / `gen_call` type=read, variant=`latest-final` — `-32603` rollback

### Cross-checks attempted
- Finalized create-round transaction status, execution result, sender, nonce, and 1 GEN value
- `get_round(rnd-pilot-354517)` with `TransactionHashVariant.LATEST_FINAL`
- `get_round_ids_count` and `get_round_ids(0,50)` with `LATEST_FINAL`
- Extra view `get_all_proposal_ids_count` with `LATEST_FINAL`
- Contract `eth_getBalance` and creator latest/pending nonce

### Cross-checks blocked
- Exact Stage 2 genesis verifier (required views incomplete)
- Round ID, creator, parameters, committee roster, zero-allocation ledger, and accounting equation
- Round registry identity `[rnd-pilot-354517]`

## Prior `latest-nonfinal` observation (preserved)

Observed 2026-10-14T06:20:21.083Z using the SDK default `transactionHashVariant = latest-nonfinal`. Same four contract views failed with `-32603` rollback. Same transaction/balance/nonce endpoints succeeded. Sequential 2026-10-14T02:17:57.367Z `get_round` after the finalized receipt also failed `-32603` and stopped before independent registry/balance classification.

This is distinct from older, preserved deployment attempts for a historical `dd04779...` source, which failed during writes with PostgreSQL `DiskFull`. The present CharterFlow deployment is verified; the current issue is Studio Next `gen_call` readback after the finalized Stage 2 transaction, for both `latest-nonfinal` and `latest-final`. The PaymentSpike control above independently confirms that `gen_call` views also fail for a second, previously deployed contract on the same RPC while `eth_*` reads succeed.

Could you please investigate the Studio Next database/session state behind `gen_call` for these independently confirmed contracts? No private key, signed transaction, full source payload, or unrelated account data is included here.

**This file remains a draft and has not been sent.**
