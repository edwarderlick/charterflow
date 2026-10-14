# CharterFlow Corrected Contract Audit

**Audit date:** 2026-10-13  
**Network target:** Studio Next, chain ID `61997`  
**Current candidate source:** `contracts/CharterFlowCore.py`  
**Current candidate SHA-256:** `34ea0e374cfe68788067838cebf4ca0c226e139c713aca6e7345716b35aad5ee`

This matrix is based on the current contract, tests, frontend transaction service, runner gates, and preserved historical evidence. It does not treat the earlier audit or the historical PaymentSpike as proof about the current CharterFlowCore candidate.

## Corrected finding matrix

| ID | Category | Corrected finding | Concrete evidence | Disposition |
|---|---|---|---|---|
| CF-01 | Contract defect | The old implementation stored the leader's free-text reason even though validators checked only the verdict. Contradictory rationales could therefore pass. | `evaluate_charter_fit` now returns and validates only `{"verdict": ...}` through equivalence and stores `VALIDATOR_AGREED_VERDICT_*; SEMANTIC_RATIONALE_NOT_VERIFIED`. Unit tests show contradictory rationales can agree on verdict while the model text is discarded. | Fixed locally. Semantic rationale verification remains deliberately unsolved and is disclosed. |
| CF-02 | Exposure / hypothesis | Delimiter-style prompt injection is plausible, but no actual model or adversarial Studio test currently proves a verdict change. Replacing markdown fences is formatting hardening, not a complete defense. | `_build_charter_review_prompt` marks inputs untrusted and replaces backticks only. No model-backed adversarial evidence exists in this repository. | Open exposure; do not claim exploit or remediation. |
| CF-03 | Recoverability tradeoff | Permissionless proposal settlement can clear `reserved_wei`, but it cannot close a round or claim a refund after creator-key loss. Both refund steps require the creator. | `close_round_and_refund` and `claim_creator_refund` check `gl.message.sender_address == r.creator`. | Intended v1 authorization rule with a material key-loss tradeoff; not a recovery solution. |
| CF-04 | Corrected non-defect | Approved credits do **not** prevent `close_round_and_refund`; only `reserved_wei > 0` blocks closure after `round_end`. Approved credits remain owed after closure. | Contract checks only `r.reserved_wei > 0`. `test_approved_credits_do_not_block_closure_or_emit_refund` closes with `approved_credits_wei == 2e18`, moves only available funds to `creator_claimable_wei`, and emits no refund. | Prior finding corrected. Behavior matches the product specification. |
| CF-05 | Intended governance rule | Approved credits are permanent, recipient-authorized pull claims. Creator closure does not claw them back. | `withdraw_credit` requires `APPROVED`, recipient caller, and unused credit; closure leaves `approved_credits_wei` untouched. | Intended rule, not a closure defect. |
| CF-06 | Transfer semantics | Grant payouts and creator refunds use native chain-token `emit_transfer(value=...)` messages, not ERC-20 transfers. | `_Recipient(address).emit_transfer(value=amount)` in both claim methods. States remain truthfully named `PAYOUT_EMITTED` / `REFUND_EMITTED`. | Documentation corrected. |
| CF-07 | Network receipt limitation | Parent finality plus an emitted transfer message does not independently prove recipient delivery when Studio Next exposes no child receipt. | Preserved PaymentSpike evidence observed `getTriggeredTransactionIds(...) == []` for that historical transfer only. | Keep emitted-state language; never infer `PAID` or fabricate a child transaction ID. |
| CF-08 | Frontend defect | Same-target calls could both pass the duplicate check while awaiting provider chain/account reads. | A synchronous in-memory reservation and durable `intent-prepared` record now exist before the first await. A delayed-provider concurrency test asserts `kit.submit` is called at most once. | Fixed locally; post-submit uncertainty still blocks for manual reconciliation. |

## Rationale-verification limitation

The smallest workable improvement is to trust only the categorical verdict agreement and to store a deterministic limitation notice instead of a model-authored rationale. Exact rationale matching would be brittle under nondeterministic generation. Comparing directive-number arrays would show only syntactic equality, not semantic agreement. CharterFlow therefore does not claim consensus-verified reasoning.

## Fee and message implications

The contract change alters parsing and the stored review-reason string only. It does not add a contract call, external message, native transfer, or payable value. Claim methods still emit one native transfer message each. The source hash changed, so a fresh schema extraction, fee estimate, and deployment transaction are required for this candidate. The frontend continues to block claim submissions until the live message-fee budget is measured; no fee value is invented locally.

## Current deployment and remaining pilot blockers

1. The exact candidate is deployed on Studio Next at `0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21`. Deployment transaction `0xc5c220571c8d890c04715ce65cfd23ae92a0d49e696c596979591f771ab734e4`, deployed code, schema, and source SHA-256 `34ea0e374cfe68788067838cebf4ca0c226e139c713aca6e7345716b35aad5ee` were independently reconciled.
2. The intended Stage 2 transaction `0x1476320746c0efda5f97d2db6256c571c6da7adff7c494af33031bf9adfb0bdc` is `FINALIZED` with `FINISHED_WITH_RETURN`, but `rnd-pilot-354517` remains unverified. Studio Next `get_round` reads return JSON-RPC `-32603`: `Can't reconnect until invalid transaction is rolled back.` A successful receipt, nonce change, registry entry, or balance change alone is insufficient. A 2026-10-14 PaymentSpike `get_state` control on independently confirmed address `0xD30E2Da70f4fD27B25c8aC65E67e30AC5a1fb513` also failed `gen_call` with `-32603` on both `latest-final` and `latest-nonfinal` (`control fails`). Stage 2 stays **INCONCLUSIVE**.
3. No nomination, AI review, vote, withdrawal, payout emission, or refund has been tested against this deployment. Stage 3+ writes remain blocked until complete round, registry, genesis-ledger, and contract-balance reconciliation succeeds.
4. A fresh network fee quote is required for every future write. Claims remain blocked until a reliable positive native-message fee estimate is measured; no fee value is invented locally.
5. Verdict-only agreement does not provide a consensus-verified semantic rationale, and prompt-injection behavior has not been adversarially demonstrated on the target validator/model configuration.
6. Historical `dd04779...` deployment attempts failed with `DiskFull`; that evidence is preserved separately and must not be conflated with the current rollback-state read error.

## Verification recorded in this pass

- Contract direct-mode tests: `18/18` passed.
- Frontend read tests: `91/91` passed (includes verified-address default when `VITE_CONTRACT_ADDRESS` is blank, plus explicit zero-address unconfigured behavior).
- Frontend write tests: `108/108` passed, including the delayed-provider concurrent-submit regression.
- Runner safety tests: `70/70` passed on 2026-10-14 (`npm run test:safety`), including write-mode halt without a local checkpoint and public read-fact attachment without `writeIntent`.
- Remote schema extraction: passed with `18` methods for the current source.
- Frontend lint: completed with pre-existing warnings and no errors.
- Frontend production build: passed.
- Read-only Studio Next probe at `2026-10-13T14:52:06.172Z`: chain `61997`, both historical deployment hashes not found, candidate address empty, creator nonce latest/pending `0/0`, decision `MAY_DEPLOY`. This proves a clean read-time recovery state, not database write health.

## Pilot verdict

**NO-GO for Stage 3+ writes while Stage 2 readback is unresolved.** The deployed source is identified exactly, but the funded round is not independently verified. This is also a NO-GO for portal submission or any claim of a proven live lifecycle, consensus-verified rationale, or native-token delivery.

