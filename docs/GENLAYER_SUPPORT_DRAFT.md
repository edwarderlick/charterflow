# DRAFT — GenLayer Studio Next Stage 2 readback error

**Status:** Draft only; not sent  
**Latest observation:** 2026-10-14T08:10:22.504Z  
**Read variant this pass:** `latest-final`  
**Previous preserved observation:** 2026-10-14T02:17:57.367Z  
**Network:** Studio Next, chain ID `61997`

Hello GenLayer support,

CharterFlow remains blocked on independently reproducible Studio Next reads after a finalized contract call:

- Contract: `0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21`
- Deployed source SHA-256: `34ea0e374cfe68788067838cebf4ca0c226e139c713aca6e7345716b35aad5ee`
- `create_round` transaction: `0x1476320746c0efda5f97d2db6256c571c6da7adff7c494af33031bf9adfb0bdc`
- Intended round ID: `rnd-pilot-354517`

## Latest diagnostic (one bounded read-only pass)

Failure class: **all_contract_views**

Contract gen_call views failed while transaction, balance, and nonce endpoints responded.

Stage 2 verdict: **INCONCLUSIVE**. A partial set of successful reads is not Stage 2 verification.

### Cross-checks attempted
- Transaction status/result/sender/nonce/value via SDK getTransaction (0x1476320746c0efda5f97d2db6256c571c6da7adff7c494af33031bf9adfb0bdc)
- Contract view get_round(rnd-pilot-354517) via SDK readContract → gen_call type=read, transactionHashVariant=latest-final
- Contract views get_round_ids_count and get_round_ids(0,50) via separate gen_call reads with transactionHashVariant=latest-final
- Contract eth_getBalance and creator eth_getTransactionCount latest/pending (0x6201f71e4501ad61ee6c7d92eb41a47e85dae066)
- Extra harmless view get_all_proposal_ids_count to distinguish a general gen_call failure from get_round-specific failure

### Cross-checks blocked
- Exact Stage 2 verifier was not run because the required read set was incomplete
- Complete round parameters, genesis ledger, and accounting equation could not be checked
- Round registry count/ids could not be fully cross-checked

### Per-call capture (no keys, signed txs, source payloads, or full receipts)
- **transaction** @ 2026-10-14T08:10:22.504Z
  - SDK: `getTransaction`
  - RPC method: `eth_getTransactionByHash`
  - Sanitized params: `{"hash":"0x1476320746c0efda5f97d2db6256c571c6da7adff7c494af33031bf9adfb0bdc"}`
  - HTTP status: `n/a`
  - JSON-RPC code: `none`
  - Result: ok — {"hash":"0x1476320746c0efda5f97d2db6256c571c6da7adff7c494af33031bf9adfb0bdc","statusName":"FINALIZED","txExecutionResultName":"FINISHED_WITH_RETURN","sender":"0x6201f71E4501aD61EE6C7d92EB41A47E85Dae066","nonce":"1","valueWei":"1000000000000000000"}
- **get_round** @ 2026-10-14T08:10:23.535Z
  - SDK: `readContract`
  - RPC method: `gen_call`
  - Sanitized params: `{"type":"read","to":"0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21","functionName":"get_round","args":["rnd-pilot-354517"],"transactionHashVariant":"latest-final","transaction_hash_variant":"latest-final"}`
  - HTTP status: `n/a`
  - JSON-RPC code: `-32603`
  - Result: failed — "Can't reconnect until invalid transaction is rolled back.  Please rollback() fully before proceeding (Background on this error at: https://sqlalche.me/e/20/8s2b)"
- **get_round_ids_count** @ 2026-10-14T08:10:24.842Z
  - SDK: `readContract`
  - RPC method: `gen_call`
  - Sanitized params: `{"type":"read","to":"0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21","functionName":"get_round_ids_count","args":[],"transactionHashVariant":"latest-final","transaction_hash_variant":"latest-final"}`
  - HTTP status: `n/a`
  - JSON-RPC code: `-32603`
  - Result: failed — "Can't reconnect until invalid transaction is rolled back.  Please rollback() fully before proceeding (Background on this error at: https://sqlalche.me/e/20/8s2b)"
- **get_round_ids** @ 2026-10-14T08:10:25.182Z
  - SDK: `readContract`
  - RPC method: `gen_call`
  - Sanitized params: `{"type":"read","to":"0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21","functionName":"get_round_ids","args":["0","50"],"transactionHashVariant":"latest-final","transaction_hash_variant":"latest-final"}`
  - HTTP status: `n/a`
  - JSON-RPC code: `-32603`
  - Result: failed — "Can't reconnect until invalid transaction is rolled back.  Please rollback() fully before proceeding (Background on this error at: https://sqlalche.me/e/20/8s2b)"
- **contract_balance** @ 2026-10-14T08:10:25.522Z
  - SDK: `getBalance`
  - RPC method: `eth_getBalance`
  - Sanitized params: `{"address":"0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21"}`
  - HTTP status: `n/a`
  - JSON-RPC code: `none`
  - Result: ok — "1000000000000000000"
- **creator_latest_nonce** @ 2026-10-14T08:10:25.865Z
  - SDK: `getTransactionCount`
  - RPC method: `eth_getTransactionCount`
  - Sanitized params: `{"address":"0x6201f71e4501ad61ee6c7d92eb41a47e85dae066","blockTag":"latest"}`
  - HTTP status: `n/a`
  - JSON-RPC code: `none`
  - Result: ok — "2"
- **creator_pending_nonce** @ 2026-10-14T08:10:26.208Z
  - SDK: `getTransactionCount`
  - RPC method: `eth_getTransactionCount`
  - Sanitized params: `{"address":"0x6201f71e4501ad61ee6c7d92eb41a47e85dae066","blockTag":"pending"}`
  - HTTP status: `n/a`
  - JSON-RPC code: `none`
  - Result: ok — "2"
- **get_all_proposal_ids_count** @ 2026-10-14T08:10:26.555Z
  - SDK: `readContract`
  - RPC method: `gen_call`
  - Sanitized params: `{"type":"read","to":"0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21","functionName":"get_all_proposal_ids_count","args":[],"transactionHashVariant":"latest-final","transaction_hash_variant":"latest-final"}`
  - HTTP status: `n/a`
  - JSON-RPC code: `-32603`
  - Result: failed — "Can't reconnect until invalid transaction is rolled back.  Please rollback() fully before proceeding (Background on this error at: https://sqlalche.me/e/20/8s2b)"

## Prior observation (preserved)

Observed 2026-10-14T02:17:57.367Z: the create-round transaction was `FINALIZED` / `FINISHED_WITH_RETURN`, then an immediate `get_round` via Studio Next `gen_call` failed with JSON-RPC `-32603`:

> Can't reconnect until invalid transaction is rolled back. Please rollback() fully before proceeding.

A later independent diagnostic at 2026-10-14T06:20:21.083Z used the SDK default `transactionHashVariant = latest-nonfinal` (`TransactionHashVariant.LATEST_NONFINAL`). All four contract views (`get_round`, `get_round_ids_count`, `get_round_ids`, extra `get_all_proposal_ids_count`) failed with JSON-RPC `-32603` rollback, while `eth_getTransactionByHash`, `eth_getBalance`, and `eth_getTransactionCount` succeeded. That classified the default path as an all-contract-view / `gen_call` latest-nonfinal failure.

A later `latest-final` pass at `2026-10-14T06:29:27.444Z` and this pass at `2026-10-14T08:10:22.504Z` failed the same four contract views with JSON-RPC `-32603`. Transaction, balance, and nonce endpoints still succeeded. Classification: **all_contract_views**. Both `latest-nonfinal` and `latest-final` fail.

## Control diagnostic (PaymentSpike `get_state`) — **control fails**

One bounded, read-only control against a previously deployed contract whose address and ABI were confirmed from local spike evidence (`spike/payment_evidence.json`, `spike/PaymentSpike.py` `@gl.public.view def get_state`). Zero write RPC attempts.

- Address: `0xD30E2Da70f4fD27B25c8aC65E67e30AC5a1fb513`
- Deploy tx (local evidence): `0xb27210ff8f5b5f9771ee17ae85892c2e4cb4c21a867d1cb06c9550a531f1c5be`
- Method: `get_state()`
- Independent confirmation on Studio Next `https://studio-next.genlayer.com/api`, chain `61997`: deploy tx `FINALIZED` / `FINISHED_WITH_RETURN`, code includes public `get_state`, balance `0` wei
- `get_state` `latest-final` `2026-10-14T06:40:51.295Z` and `latest-nonfinal` `2026-10-14T06:40:51.643Z` both failed JSON-RPC `-32603` rollback

Write-call count: `0`. Classification: **control fails**. `eth_*` reads on the same RPC succeeded. This is not treated as a total RPC outage.

This is distinct from older, preserved deployment attempts for a historical `dd04779...` source, which failed during writes with PostgreSQL `DiskFull`. The present CharterFlow deployment is verified; the current issue is Studio Next `gen_call` readback after the finalized Stage 2 transaction, for both `latest-nonfinal` and `latest-final`, on two independently confirmed contracts.

Could you please investigate the Studio Next database/session state behind `gen_call` for these independently confirmed contracts? No private key, signed transaction, full source payload, or unrelated account data is included here.

**This file remains a draft and has not been sent.**
