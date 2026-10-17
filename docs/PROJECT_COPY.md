# CharterFlow project copy (truthful, for steward review)

Use this copy for submission descriptions and steward review. Live portal form length limits are unverified. It is **not** a claim that creator close/refund has been executed or that portal mission rules accept chain 61997.

## Short description

CharterFlow is a GenLayer intelligent contract for charter-bound grant rounds. A creator deposits native GEN into an isolated round treasury, freezes a natural-language charter, and names a committee. Proposals are nominated against that charter. Independent validators return a categorical fit verdict (`ELIGIBLE` / `INELIGIBLE` / `NEEDS_CLARITY`); only the verdict is equivalence-checked, and stored reasons state that semantic rationale was not verified. Eligible committee members vote with recipient recusal and an integer 2/3 supermajority quorum. Approved credits are pull-based: the recipient calls `withdraw_credit()`, which emits a native child transfer to the recipient's address. The verified pilot on GenLayer Studio development preview (chain 61997, contract `0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8`) evidenced the complete path from round creation through proposal nomination, validator AI review, committee vote, recipient withdrawal, and finalized 0.05 GEN child transfer.

## What the protocol does

1. **Charter review.** Each round stores an immutable charter. `evaluate_charter_fit` asks validators for a categorical verdict through `gl.vm.run_nondet`. Invalid JSON or schema fails closed to `NEEDS_CLARITY` only when validators agree on that verdict, and then releases reserved funds. A disagreement leaves the proposal unmoved. The contract stores the agreed categorical verdict and records that semantic rationale was not verified.
2. **Committee governance.** Voting uses integer 2/3 supermajority: `(N * 2 + 2) // 3`. If the proposal recipient sits on the committee, that member is recused and quorum is computed over `N - 1` eligible voters.
3. **Payout flow.** Approval creates a permanent recipient credit. The recipient pulls via `withdraw_credit()`, which emits `_Recipient(address).emit_transfer(value=...)`. The parent transaction moves proposal state to `PAYOUT_EMITTED`, and native GEN delivery is evidenced by the finalized child transfer transaction.
4. **Treasury close & refund.** After round end (`now >= round_end`) and provided no funds are reserved (`reserved_wei == 0`), the round creator can call `close_round_and_refund`, moving available treasury to `creator_claimable_wei`, followed by `claim_creator_refund()`. This step remains untested on the live pilot as the round is active until `2026-10-27T16:53:52Z`.

## Evidence classes (do not mix)

| Class | What is proven | What is not proven |
|---|---|---|
| Local test suites | Contract unit tests, runner safety tests (71/71 passed), frontend build & typecheck (0 errors) | Live multi-validator consensus across future runtime upgrades |
| Verified pilot deployment | Contract `0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8`, source SHA-256 `4b146292c840cf16e0dcfd7b8d488492092d73c2c3160dda366f922642eaee78`, deploy tx `0x700b…da6c` | Automatic acceptance by portal missions without mission rule verification |
| Evidenced live lifecycle | Create round (`1 GEN`), nominate (`0.05 GEN`), 2 review transactions producing 1 stored `ELIGIBLE` verdict, committee vote (1 YES quorum met), recipient withdrawal, finalized 0.05 GEN native child transfer (`0x6e01…d6f0`), reconciled 0.95 GEN balance | Creator close/refund (round ends `2026-10-27T16:53:52Z`) |
| Historical legacy contracts | Legacy `0x9579A19c2aD0a2DBd0B806Abb85bE9a2E6391E48` and recovery `0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21` preserved with their earlier errors | They do not describe or diminish the verified pilot on `0x5643` |

## Claims to avoid

- Do not claim creator close or refund has occurred (the round is `ACTIVE` until `2026-10-27T16:53:52Z`).
- Do not claim consensus-verified semantic rationale (only categorical verdict agreement is verified).
- Do not claim Builder Portal eligibility or point awards are guaranteed (acceptance of chain `61997` depends on mission rules; portal submission has not happened).

