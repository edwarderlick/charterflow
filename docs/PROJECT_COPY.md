# CharterFlow project copy (truthful, unsent)

Use this text for README and a future portal description. Live form length limits are **unverified**. It is **not** a claim that the live pilot finished.

## Short description

CharterFlow is a GenLayer intelligent contract for charter-bound grant rounds. A creator deposits native GEN into an isolated round treasury, freezes a natural-language charter, and names a committee. Proposals are nominated against that charter. Independent validators return a categorical fit verdict (`APPROVE` / `REJECT` / `NEEDS_CLARITY`); only the verdict is equivalence-checked, and stored reasons state that semantic rationale was not verified. Eligible committee members vote with recipient recusal and a 2/3 ceiling quorum. Approved credits are pull-based: the recipient calls `withdraw_credit()`, which emits a native `emit_transfer`. After round end, remaining liquid funds can be closed and claimed by the creator. Local unit tests and a fail-closed runner cover this machine. Studio Next holds a verified CharterFlowCore deployment, and a finalized `create_round` transaction exists, but contract views currently fail JSON-RPC `-32603`, so the funded round and 1 GEN genesis ledger are unverified. No end-to-end live lifecycle has been proven.

## What the protocol does

1. **Charter review.** Each round stores a frozen charter. `evaluate_charter_fit` asks validators for a categorical verdict through `gl.vm.run_nondet`. Invalid JSON or schema fails closed to `NEEDS_CLARITY` only when the validators agree on that verdict, and then releases reserved funds. A disagreement does not release funds. The contract does not claim consensus on free-text rationale.
2. **Committee governance.** Voting uses integer 2/3 supermajority: `(N * 2 + 2) // 3`. If the proposal recipient sits on the committee, that member is recused and quorum is computed over `N-1` eligible voters.
3. **Payout flow.** Approval creates a permanent recipient credit. The recipient pulls via `withdraw_credit()`, which emits `_Recipient(address).emit_transfer(value=...)`. The truthful on-chain state is `PAYOUT_EMITTED`. Parent finality plus an emitted message is not treated as independently proven recipient delivery on Studio Next. Creator leftovers use `close_round_and_refund` then `claim_creator_refund()`.

## Evidence classes (do not mix)

| Class | What is proven | What is not proven |
|---|---|---|
| Local tests | 18 pytest contract tests; 70 runner safety tests; frontend read/write unit tests in-repo | Live chain behavior |
| Deployed contract proof | Address `0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21`, deploy tx `0xc5c220571c8d890c04715ce65cfd23ae92a0d49e696c596979591f771ab734e4`, source SHA-256 `34ea0e374cfe68788067838cebf4ca0c226e139c713aca6e7345716b35aad5ee` | That the funded round exists as specified |
| Blocked live lifecycle | `create_round` tx `0x1476320746c0efda5f97d2db6256c571c6da7adff7c494af33031bf9adfb0bdc` is `FINALIZED` / `FINISHED_WITH_RETURN` with value `1e18` wei; `eth_*` reads succeed | `get_round`, registry, genesis ledger, accounting equation, nominations, votes, payouts, refunds |

## Claims to avoid

- End-to-end working pilot
- Stage 2 VERIFIED
- Consensus-verified semantic rationale
- Native-token delivery proven from parent receipt alone
- Public GitHub or hosted demo (neither exists yet)
