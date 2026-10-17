# CharterFlow submission evidence status

**Last updated:** 2026-10-17  
**Network:** GenLayer Studio development preview, chain ID `61997` (`0xf22d`)  
**Portal status:** Not submitted. Portal acceptance of chain `61997` depends on specific mission rules.

---

## 1. Current verified pilot (Chain ID 61997)

The active verified pilot runs on GenLayer Studio development preview (chain `61997`, RPC `https://studio-next.genlayer.com/api`, explorer `https://explorer-studio-dev.genlayer.com`).

- **Contract address:** [`0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8`](https://explorer-studio-dev.genlayer.com/address/0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8)
  - Deployed in transaction [`0x700b462e4620bf849b873af0e515357d08e905aa03a3682d5abb06d58f80da6c`](https://explorer-studio-dev.genlayer.com/tx/0x700b462e4620bf849b873af0e515357d08e905aa03a3682d5abb06d58f80da6c) (`FINALIZED` / `FINISHED_WITH_RETURN`).
  - Source SHA-256: `4b146292c840cf16e0dcfd7b8d488492092d73c2c3160dda366f922642eaee78` (`contracts/CharterFlowCore.py`, served at `frontend/public/CharterFlowCore.py`).
- **Public GitHub repository:** [https://github.com/edwarderlick/charterflow](https://github.com/edwarderlick/charterflow)
- **Public hosted demo:** [https://charterflow-coral.vercel.app/](https://charterflow-coral.vercel.app/)
- **Detailed JSON evidence snapshot:** [`docs/evidence/verified-flow.json`](evidence/verified-flow.json) (read captured at `2026-10-16T21:58:07.162Z`).
- **Evidenced on-chain lifecycle:**
  1. **Deploy:** Contract deployed and finalized at `0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8` (tx [`0x700b…da6c`](https://explorer-studio-dev.genlayer.com/tx/0x700b462e4620bf849b873af0e515357d08e905aa03a3682d5abb06d58f80da6c)).
  2. **Create round:** Round `round-open-source-rpc--mvb7nltc` created with 1 GEN deposit (`1000000000000000000` wei) from creator `0xb3F7518df619ef485f7a1568ED3705bB6f5B0407` (tx [`0x753a…d8d0`](https://explorer-studio-dev.genlayer.com/tx/0x753a915e0a882d403d0338a04ae4c9569e34eeb04afbd7b275b09c28128dd8d0)).
  3. **Nominate proposal:** Proposal `prp-round-open-source-rpc--mvb7nltc-1` nominated for 0.05 GEN (`50000000000000000` wei) to recipient `0x31e14df3b4f47F2428F3B78E7279691A78f70a05` (tx [`0x220c…e482`](https://explorer-studio-dev.genlayer.com/tx/0x220c4ef78af5f055e11bf1d00cdafbc1bd17dd16943c214713a6643d53c4e482)).
  4. **Categorical AI review:** Two finalized transactions calling `evaluate_charter_fit` (tx [`0x1213…62c3`](https://explorer-studio-dev.genlayer.com/tx/0x121377a431bc73fde4595abbe22108fe07070ebcffe48ab5fb899cf6dde362c3) and [`0x06e6…11bc`](https://explorer-studio-dev.genlayer.com/tx/0x06e6aad2a144b0dc139817cf9aecfd184ceb3d05c75c67a098d7cf2c56b811bc)). Validators agreed on a single stored categorical verdict: `ELIGIBLE` with reason `VALIDATOR_AGREED_VERDICT_ELIGIBLE; SEMANTIC_RATIONALE_NOT_VERIFIED`. The second transaction is not a separate required stage.
  5. **Committee vote:** Creator YES ballot cast (tx [`0x899a…4526`](https://explorer-studio-dev.genlayer.com/tx/0x899a922020fde7f680e39812df9d344d04f1c5702f71099e9648d528f3684526)). Committee quorum reached under integer $2/3$ rule with recipient recusal. Proposal state became `APPROVED`.
  6. **Recipient withdrawal:** Recipient `0x31e14df3b4f47F2428F3B78E7279691A78f70a05` executed `withdraw_credit` (tx [`0x0f29…2c6a`](https://explorer-studio-dev.genlayer.com/tx/0x0f29c0f7523d74aa89d8e93cbb995c19d69191052ea8e1893de3656fec032c6a), `FINALIZED` / `FINISHED_WITH_RETURN`). Parent proposal state transitioned to `PAYOUT_EMITTED` and `credit_withdrawn` is true.
  7. **Finalized child transfer:** 0.05 GEN (`50000000000000000` wei) native transfer from contract to recipient (tx [`0x6e01…d6f0`](https://explorer-studio-dev.genlayer.com/tx/0x6e012d41c822b321271b194318121a240681d4568087d06a63ffb4e882b6d6f0)), `triggered_by` the withdrawal call, `status: FINALIZED`, execution result `NOT_VOTED` (standard for native transfer), `value_credited: true`.
  8. **Treasury reconciliation:** Initial deposit 1 GEN = Available 0.95 GEN (`950000000000000000` wei) + Emitted payouts 0.05 GEN (`50000000000000000` wei). Reserved, approved credits, refunds emitted, and creator claimable balances are all 0. Zero slippage.

---

## 2. Historical legacy and recovery contracts

The contracts below are earlier historical deployments. Their earlier readback problems and execution errors do **not** describe the verified pilot on `0x5643…25C8`:

1. **Legacy contract `0x9579A19c2aD0a2DBd0B806Abb85bE9a2E6391E48`:**
   - Deployed under transaction `0x9f23ec04bc3c29f325afc9b1026da6247395b11602c2c783473fe22e59364cfd` running bytecode SHA-256 `4ec11b1bee98122d3dad5ab86f5823d676797c1c0873133d386adeeba12b9b72`.
   - Cannot be patched. Holds two funded 1 GEN rounds (`round-studio-next-rpc--mvarlewq` and `round-studio-next-rpc--mvas9jju`), contract balance 2 GEN.
   - Encountered runner compatibility error when calling `evaluate_charter_fit` (tx `0x3e654164…` failed `FINISHED_WITH_ERROR` because `gl.vm` in the pinned runner lacked `run_nondet_unsafe`).
   - AI review and voting on this address are closed; funded rounds remain visible for historical audit and eventual recovery after round end.

2. **Recovery contract `0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21`:**
   - Deployed under transaction `0xc5c220571c8d890c04715ce65cfd23ae92a0d49e696c596979591f771ab734e4` running bytecode SHA-256 `34ea0e374cfe68788067838cebf4ca0c226e139c713aca6e7345716b35aad5ee`.
   - Created round `rnd-pilot-354517` via tx `0x1476320746c0efda5f97d2db6256c571c6da7adff7c494af33031bf9adfb0bdc` (`FINALIZED` / `FINISHED_WITH_RETURN`, value 1 GEN).
   - On 2026-10-14, contract views on this address failed with JSON-RPC `-32603` rollback-state errors (`all_contract_views` failure class; also confirmed on PaymentSpike control `0xD30E...`).
   - This round is an immutable, locked recovery case whose nomination window has expired. Do not nominate into it or reuse its round ID.

---

## 3. Remaining limits & open boundaries

1. **Creator close and refund have NOT been tested:**
   - Neither `close_round_and_refund` nor `claim_creator_refund` has been executed on the verified deployment.
   - There is no close transaction and no refund transaction. `refunds_emitted_wei` and `creator_claimable_wei` are both 0.
   - The verified round remains in `ACTIVE` state.
2. **Round end deadline:**
   - Round `round-open-source-rpc--mvb7nltc` end is `2026-10-27T16:53:52Z` (`1793120032`).
   - By contract invariant, `close_round_and_refund` can only be invoked by the creator after `round_end` has elapsed AND `reserved_wei == 0`.
   - `claim_creator_refund` is a subsequent creator action after round status becomes `CLOSED`.
   - The remaining 0.95 GEN in the treasury cannot be claimed or refunded before this timestamp and contract conditions are satisfied.
3. **Studio development preview stability:**
   - Chain `61997` is a development preview network. Node state, RPC availability, or chain history may reset without warning.
4. **Portal submission has NOT happened:**
   - No Builder Portal submission has been filed from this repository or wallet.
   - Authenticated portal form requirements, contribution categories, and point structures have not been submitted against.
5. **Portal network acceptance rules:**
   - Acceptance of chain `61997` (Studio development preview) depends entirely on the specific GenLayer Builder Portal mission rules. Reviewers and submitters must verify whether a mission requires Asimov testnet (chain `4221`) or accepts Studio Next (`61997`) before submitting.
6. **Failed-child settlement is not proven:**
   - The pilot's EOA withdrawal has a separately finalized and credited 0.05 GEN child transfer. That is the delivery proof for this one payout.
   - `withdraw_credit` sets `PAYOUT_EMITTED` and marks the credit withdrawn when it emits the child message. The deployed contract has no demonstrated retry or recredit method for a child transfer that later fails. Do not present the parent state or direct-mode tests as proof that every recipient or failed child can be paid or recovered.
   - The proof-by-case index and this limit are in [README.md](../README.md#steward-proof-map).

