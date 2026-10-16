# Next deploy plan

The runner-compat source is deployed. Do not send another deploy. Do not create a round or call `evaluate_charter_fit` from this plan.

Verified at `2026-10-16T12:05:10.821Z` from tx `0x700b462e4620bf849b873af0e515357d08e905aa03a3682d5abb06d58f80da6c`: status `FINALIZED` (`7`), execution `FINISHED_WITH_RETURN` (`1`), contract `0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8`, sender `0x7E4E1f7DcC3DA063F9110477Ad348C90E8599253`, nonce `249`, user value `0`. Transaction source SHA-256 and deployed code SHA-256 are both `4b146292c840cf16e0dcfd7b8d488492092d73c2c3160dda366f922642eaee78` (`35106` bytes). Schema is the 18 expected methods. `get_round_ids_count` was `0`. Evidence: `artifacts/corrected_deploy_verification.json`. The charged network fee was not present in that receipt extract, so it is not stated here.

`VITE_CONTRACT_ADDRESS` points at `0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8`. `0x9579A19c2aD0a2DBd0B806Abb85bE9a2E6391E48` cannot be patched. Its two funded rounds stay visible and labeled legacy. AI review and voting are closed on that address. It stays separate from `0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21`.

Historical preflight at `2026-10-16T11:35:27.908Z`, before this receipt was reconciled: chain `61997`, creator balance `62188422246749715342` wei, fresh `estimateTransactionFees` `feeValue` `100000000000010352` wei, user value `0`. That quote is not the fee charged on `0x700b`.

Read-only confirmation at `2026-10-16T10:55:02.945Z`: contract balance `2000000000000000000` wei (2 GEN). Creator `0x31e14df3b4f47F2428F3B78E7279691A78f70a05` balance `62188422246749715342` wei (62.188422246749715342 GEN). Proposal `prp-round-studio-next-rpc--mvas9jju-1` is still `SUBMITTED` / `PENDING`, reserved `50000000000000000` wei, available on that round `950000000000000000` wei. The other round still has reserved `0` and available `1000000000000000000` wei.

## Corrected source

| Item | Value |
|---|---|
| Verified SHA-256 | `4b146292c840cf16e0dcfd7b8d488492092d73c2c3160dda366f922642eaee78` at `0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8` |
| Files | `contracts/CharterFlowCore.py` and `frontend/public/CharterFlowCore.py` (byte-identical) |
| Legacy bytecode SHA-256 | `4ec11b1bee98122d3dad5ab86f5823d676797c1c0873133d386adeeba12b9b72` at `0x9579…` |
| Recovery bytecode SHA-256 | `34ea0e374cfe68788067838cebf4ca0c226e139c713aca6e7345716b35aad5ee` at `0x408D…` |
| Pinned runner | `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` |
| Pinned stdlib | `py-lib-genlayer-std:kzr02ndm9et4qkmbqpq5djjt5sme2yt76n7sz1qbzax0knt6mam0` |
| New contract address | `0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8`. Do not deploy again. |

`gl.vm.run_nondet(leader_fn, validator_fn)` is the API that returns the leader value only when the validator returns true. `run_nondet_unsafe` is absent from that stdlib and from the live runner (`AttributeError` on tx `0x3e654164…`). `run_nondet_default` is present but is not a replacement: it sandboxes the validator and can accept matching `UserError` or `VMError` pairs through `compare_user_errors` / `compare_vm_errors` without the categorical-verdict boolean.

Local execution of that path is CPython 3.12 with the pinned SDK and a host that runs both cloudpickled functions. It is not WASM GenVM. Docker, Podman, and nerdctl are not installed here, and `http://127.0.0.1:4000/api` is not a running executor. Studio Next was not asked to evaluate again.

## Settlement, still unsent

`evaluate_charter_fit` on the legacy `0x9579` bytecode hits the missing API until `2026-10-17T10:16:14.000Z`. The app does not offer that call. After that timestamp the same method's timeout branch can mark the proposal `EXPIRED` and move 0.05 GEN from reserved to available without the model. `settle_expired_proposal("round-studio-next-rpc--mvas9jju", "prp-round-studio-next-rpc--mvas9jju-1")` can do that release once the deadline has passed. Do not send either call before the deadline, and do not send `evaluate_charter_fit` again on `0x9579`.

`close_round_and_refund` is creator-only, requires `now >= round_end`, and reverts while `reserved_wei > 0`. It does not transfer. `claim_creator_refund` comes after `CLOSED` and still needs a measured positive native-message fee.

| Round | Close is eligible only when |
|---|---|
| `round-studio-next-rpc--mvas9jju` | The 0.05 GEN reservation has been released by a post-deadline settlement, and `now >= 2026-10-27T09:46:33.000Z` |
| `round-studio-next-rpc--mvarlewq` | `reserved_wei` is still 0 after nomination closes (`2026-10-23T09:27:50.000Z` is the cutoff; a nomination before then can reserve again), and `now >= 2026-10-27T09:27:50.000Z` |

Do not claim those funds recovered until a close receipt, a claim receipt, and balance readbacks say so.

## Costs

These are settled historical receipts, not a quote for the candidate bytecode. Each one deposited fee `175000000000112794` wei and refunded almost all of it. `primary_fee_spent` is the net figure from `fee_accounting`.

| Transaction | User value | Execution consumed | Storage fee used | primary_fee_spent |
|---|---|---|---|---|
| Deploy `0x9f23…` nonce 272 | 0 | `78900750000000` | `272750000000` | `78900750000823` |
| create `0x923d…` nonce 276 | 1 GEN | `78644000000000` | `16000000000` | `78644000000823` |
| create `0xd29b…` nonce 277 | 1 GEN | `78644250000000` | `16250000000` | `78644250000823` |
| failed evaluate `0x3e65…` nonce 248 | 0 | `78628000000000` | `0` | `78628000000823` |

The next deploy's payable user value is 0. Its network fee must be a fresh quote taken immediately before the wallet prompt. A later pilot round, on the new contract only, is a separate explicit 1 GEN `create_round` plus its own fresh fee quote. Neither quote was taken in this pass. The creator balance above can pay a fee on the order of the historical deploy net, but that is not an authorization to spend it.

## Controlled on-chain step

1. Leave `0x9579`, both of its rounds, and `0x408D` untouched. Do not send `evaluate_charter_fit` or `cast_vote` to `0x9579`.
2. The fee-only deploy already finalized. Do not send another. `cf_corrected_deploy_v1` keeps the previous `0x9579` deploy and is not cleared.
3. The frontend target is `0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8`. A funded round is a later, separate, wallet-approved `create_round` on that address after the health gate passes. Same-title drafts that are already committed to the legacy rounds are not offered again. Do not broadcast a second create while one is in flight.

## Duplicate-create safeguards already in the app

`commitMatchingRoundDrafts` and `commitDraftsForVerifiedRounds` mark only the matching title and keep other drafts. `firstUncommittedRoundDraft` skips committed drafts. `cf_active_txs_rc2` is not cleared by that path. `submitCorrectedDeploy` will not submit the candidate twice and will not submit the hash already running at `0x9579`.
