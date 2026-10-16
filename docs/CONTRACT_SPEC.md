# CharterFlow v1: Smart Contract Architectural Specification

**Document Version:** 1.3.0-CORRECTED-AUDIT  
**Runtime:** GenLayer Intelligent VM (Chain ID: 61997)  
**Contract Paradigm:** GenLayer Python Intelligent Contract (`from genlayer import *`)  
**Status:** Exact source deployed on Studio Next at `0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21`; Stage 2 funded-round state remains unverified because independent reads return JSON-RPC `-32603`

---

## 1. Executive Summary & Protocol Scope

CharterFlow is a decentralized, charter-bound grant coordination protocol running on GenLayer.

### 1.1 Protocol Scope Mandate
CharterFlow v1 coordinates:
1. **Round Genesis & Capital Custody**: Initial native test GEN deposits locked at round creation with immutable charters and committee rosters.
2. **Proposal Nomination & Treasury Reservation**: Committee-authorized nominations that reserve funds from the round's liquid pool.
3. **AI Validator Charter Review**: GenLayer validator execution compares the categorical charter verdict. Free-text rationale is not semantically verified.
4. **Committee Governance Voting**: Strict rational $2/3$ supermajority voting by non-conflicted committee members.
5. **Grant Credit Authorization & Recipient Pull-Payout**: Transition from reserved pool to permanent approved beneficiary credit, followed by asynchronous native GEN transfer.

### 1.2 Protocol Exclusions (Out of Scope for v1)
- **No post-approval off-chain delivery auditing**: Funds are credited upon governance ratification; v1 does not verify subsequent GitHub code delivery.
- **No multi-tranche milestone unlocking**: Each proposal requests a single lump-sum grant allocation.
- **No subjective dispute escrow or creator clawback**: Approved credits are permanent.

---

## 2. Core Architecture: Single Multi-Round Contract (`CharterFlowCore`)

GenLayer child contract deployment (`gl.deploy_contract(...)`) is an asynchronous operation emitted `on='finalized'`, creating separate ghost contracts and consensus state.

**CharterFlow v1 selects the Single Multi-Round Contract Architecture (`CharterFlowCore`):**
- A single deployed contract instance manages multiple isolated rounds keyed by `round_id: str`.
- **State & Balance Isolation**: Each round maintains its own isolated accounting ledger (`initial_deposit`, `available_wei`, `reserved_wei`, `approved_credits_wei`, `creator_claimable_wei`, `payouts_emitted_wei`, `refunds_emitted_wei`), charter, and committee roster. Funds deposited for Round A can never be reserved or withdrawn by Round B.

### 2.1 Total Treasury Conservation Invariant & Exact State Equations
Across all lifecycle states, the contract strictly guarantees zero phantom money movement:

$$\text{initial\_deposit} = \text{available\_wei} + \text{reserved\_wei} + \text{approved\_credits\_wei} + \text{creator\_claimable\_wei} + \text{payouts\_emitted\_wei} + \text{refunds\_emitted\_wei}$$

| Round State | Available ($\text{wei}$) | Reserved ($\text{wei}$) | Approved Credits ($\text{wei}$) | Creator Claimable ($\text{wei}$) | Payouts Emitted ($\text{wei}$) | Refunds Emitted ($\text{wei}$) | Exact Ledger Equation |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **ACTIVE (Genesis)** | $= \text{deposit}$ | $0$ | $0$ | $0$ | $0$ | $0$ | $\text{deposit} = \text{available}$ |
| **ACTIVE (Nominated)** | $\text{deposit} - \sum \text{req}$ | $\sum \text{req}$ | $0$ | $0$ | $0$ | $0$ | $\text{deposit} = \text{available} + \text{reserved}$ |
| **ACTIVE (Approved)** | $\text{deposit} - \sum \text{req}$ | $\text{active\_req}$ | $\sum \text{appr}$ | $0$ | $0$ | $0$ | $\text{deposit} = \text{available} + \text{reserved} + \text{approved}$ |
| **CLOSED (Closure)** | $0$ | $0$ | $\sum \text{appr}$ | $\text{remaining}$ | $0$ | $0$ | $\text{deposit} = \text{creator\_claimable} + \text{approved}$ |
| **PAYOUT_EMITTED**| $0$ | $0$ | $\sum \text{appr} - P$ | $\text{remaining}$ | $P$ | $0$ | $\text{deposit} = \text{approved} + \text{payouts} + \text{claimable}$ |
| **REFUND_EMITTED**| $0$ | $0$ | $\sum \text{appr}$ | $0$ | $0$ | $R$ | $\text{deposit} = \text{approved} + \text{refunds}$ |

*Prior to claims, `payouts_emitted_wei == 0` and `refunds_emitted_wei == 0`. Round closure moves unallocated liquid funds strictly to `creator_claimable_wei` with state `CLOSED`. Single-use claims (`withdraw_credit` and `claim_creator_refund`) use the Checks-Effects-Interactions pattern, updating storage before emitting external transfers.*

---

## 3. Round Creation & Genesis Parameters

Rounds are created by calling `@gl.public.write.payable def create_round(...)`.

### 3.1 Genesis Parameters & Input Bounds

| Parameter | Type | Valid Range / Bounds | Description |
| :--- | :--- | :--- | :--- |
| `round_id` | `str` | Non-empty unique string | Validated collision-free in `self.rounds` |
| `title` | `str` | `5 <= len <= 120` chars | Human-readable title |
| `description` | `str` | `10 <= len <= 2,000` chars | Summary of round mandate |
| `charter_text` | `str` | `100 <= len <= 16,384` chars | Markdown numbered directives |
| `committee_roster`| `list[Address]`| `2 <= len <= 50` unique | Registered committee members |
| `initial_deposit` | `u256` | `>= 1e18` (1 test GEN) | Supplied via `gl.message.value` |
| `grant_cap_wei` | `u256` | `0 < cap <= initial_deposit`| Max allocation per single proposal |
| `nomination_cutoff`| `u64` | `now + 3600 <= t < round_end - buffer` | Timestamp ending nomination window |
| `voting_duration` | `u64` | `3600 <= t <= 1,209,600` (1h..14d) | Voting duration per eligible proposal |
| `round_end` | `u64` | `>= cutoff + 86400 + voting_duration` | Milestone after which round may close |

### 3.2 Genesis Validation Rules
1. `gl.message.value >= u256(10**18)`: Must provide initial native test GEN deposit.
2. `len(committee_roster) >= 2`: **Minimum 2 members required** (ensures at least 1 non-conflicted voter if a member is named as recipient).
3. `len(committee_roster) <= 50`: Maximum 50 members to bound vote iterations and gas.
4. **Duplicate & Zero Address Rejection**:
   - `Address("0x0000000000000000000000000000000000000000")` is strictly prohibited.
   - All addresses normalized lowercase. Any duplicate raises `gl.vm.UserError("ERR_DUPLICATE_ROSTER_ENTRY")`.
5. **No Top-Ups After Genesis**: `initial_deposit_wei` is set once and remains immutable.
6. **Time Sequence Invariant**:
   $$\text{tx\_time} + 3600 \le \text{nomination\_cutoff} \le \text{round\_end} - (86400 + \text{voting\_duration})$$
   Where $\text{tx\_time} = \text{int(time.time())}$.

---

## 4. Deterministic Timestamps & Collision-Free Identifiers

### 4.1 Deterministic Timestamp API
GenVM execution metadata does **NOT** expose `gl.message.timestamp`. Instead, time inside the GenVM is deterministic and pinned to the transaction datetime via standard library hooks:
```python
import time
from datetime import datetime, timezone

# Canonical deterministic Unix timestamp:
tx_timestamp: int = int(time.time())
# or:
tx_timestamp: int = int(datetime.now(timezone.utc).timestamp())
```

### 4.2 Unique IDs & Collision Protection
- **Round ID**: User-specified slug or derived `rnd-{nonce}-{time}`. The contract enforces:
  ```python
  if round_id in self.rounds:
      raise gl.vm.UserError("ERR_ROUND_ID_COLLISION")
  ```
- **Proposal ID**: Deterministically derived per round using a strictly monotonic counter:
  ```python
  round.proposal_nonce += 1
  proposal_id = f"prp-{round_id}-{round.proposal_nonce}"
  ```
  Guarantees zero identifier collisions across concurrent transactions.

---

## 5. Governance & Exact Rational 2/3 Threshold Math

### 5.1 Fixed Canonical 2/3 Supermajority
CharterFlow v1 hardcodes the **canonical rational 2/3 supermajority** (`NUMERATOR = 2, DENOMINATOR = 3`).

$$V_{\text{req}} = \left\lceil \frac{N_{\text{eligible}} \times 2}{3} \right\rceil = \left\lfloor \frac{N_{\text{eligible}} \times 2 + 2}{3} \right\rfloor = (N_{\text{eligible}} \times 2 + 2) // 3$$

### 5.2 Recipient Recusal (Anti-Self-Dealing Invariant)
- If `proposal.recipient` matches an address on `round.committee_roster`, that member is **strictly recused** from voting on their own proposal.
- Total eligible voters for that proposal:
  $$N_{\text{eligible}} = |Roster| - 1$$
- If recipient is not on the roster:
  $$N_{\text{eligible}} = |Roster|$$
- Because `MIN_ROSTER_SIZE >= 2`, $N_{\text{eligible}}$ is guaranteed to be $\ge 1$.

---

## 6. Proposal Lifecycle, Review Races & Liveness

### 6.0 Validator agreement, stored reason, and prompt-injection limit

`evaluate_charter_fit` uses `gl.vm.run_nondet(leader_exec, validator_check)`. The pinned py-genlayer stdlib `kzr02ndm9et4qkmbqpq5djjt5sme2yt76n7sz1qbzax0knt6mam0` exposes `run_nondet` and `run_nondet_default` and does not expose `run_nondet_unsafe`. `run_nondet` returns the leader value only when `validator_check` returns true. `run_nondet_default` sandboxes the validator and can treat matching `UserError` or `VMError` pairs as agreement, so it is not the categorical-verdict API. The leader and each validator independently execute the same prompt and the validator accepts only when its strictly parsed categorical verdict equals the leader verdict. This is real verdict-only agreement; it does **not** establish semantic agreement between explanations. Equal directive-number arrays would likewise prove only array equality, not that the directives were interpreted or applied consistently. A false validator result is a disagreement: the transaction does not commit the review, and reserved funds stay reserved.

The contract therefore does not store the leader's free-text explanation as a trusted rationale. It stores a deterministic disclosure such as `VALIDATOR_AGREED_VERDICT_ELIGIBLE; SEMANTIC_RATIONALE_NOT_VERIFIED`. This keeps validator behavior workable while making the evidentiary limit explicit. It intentionally does not claim rationale consensus.

Model output must be a JSON object with exactly `verdict` and `reason`; malformed JSON, extra keys, invalid verdicts, and missing or non-string reasons fail closed to `NEEDS_CLARITY`. The reason field is still requested to support model deliberation, but its text is discarded before trusted state is written.

The prompt labels charter and deliverables as untrusted and replaces markdown fences for formatting stability. A delimiter-like injection inside user text remains an **exposure/hypothesis** until an actual model or adversarial Studio test demonstrates a verdict change. Escaping specific punctuation or delimiters is not a complete prompt-injection defense.

```
                          ┌──────────────────────────┐
                          │        SUBMITTED         │
                          │  (Treasury Reserved)     │
                          └─────────────┬────────────┘
                                        │
                         [gl.vm.run_nondet (Pattern 1 Equivalence)]
                                        │
             ┌──────────────────────────┼──────────────────────────┐
             ▼                          ▼                          ▼
     ┌──────────────┐           ┌──────────────┐           ┌──────────────┐
     │  INELIGIBLE  │           │NEEDS_CLARITY │           │   ELIGIBLE   │
     │(Funds Refund)│           │(Funds Refund)│           │ (Vote Window)│
     └───────┬──────┘           └──────┬───────┘           └──────┬───────┘
             │                         │                          │
             ▼                         ▼                          ▼
     ┌──────────────┐           ┌──────────────┐           ┌──────────────┐
     │   TERMINAL   │           │   TERMINAL   │           │    VOTING    │
     └──────────────┘           └──────────────┘           └──────┬───────┘
                                                                  │
                                            ┌─────────────────────┴─────────────────────┐
                                            ▼                                           ▼
                                    ┌──────────────┐                            ┌──────────────┐
                                    │   REJECTED   │                            │   APPROVED   │
                                    │(Funds Refund)│                            │(Credit Made) │
                                    └───────┬──────┘                            └──────┬───────┘
                                            │                                          │
                                            ▼                              [withdraw_credit()]
                                    ┌──────────────┐                                   │
                                    │   TERMINAL   │                                   ▼
                                    └──────────────┘                            ┌──────────────┐
                                                                                │PAYOUT_EMITTED│
                                                                                │ (External Tx)│
                                                                                └──────────────┘
```

### 6.1 Review Race Resolution (`evaluate_charter_fit` vs `expire_review`)
`evaluate_charter_fit` and `expire_review` interact under strict race resolution rules to ensure ledger integrity and prevent state rollback:

1. **State Precondition**:
   Both methods require `proposal.state == ProposalState.SUBMITTED`. If the proposal has already transitioned to `EXPIRED` (or any terminal state), subsequent calls safely return or exit early without double de-reserving.
2. **Deterministic Timeout Boundary**:
   The timeout threshold is strictly defined as:
   $$t_{\text{timeout}} = \text{proposal.submission\_timestamp} + 86400$$
   - When $\text{now} < t_{\text{timeout}}$: The proposal remains within its review window. If review succeeds and sufficient time remains before round end, it transitions to `ELIGIBLE` and opens the voting window.
   - When $\text{now} \ge t_{\text{timeout}}$: The review window has expired.
3. **Late AI Review State Transition (No Error Rollback)**:
   In GenLayer Python Intelligent Contracts, raising an unhandled exception (`raise gl.vm.UserError(...)`) aborts transaction execution and **rolls back all state mutations**.
   - If AI evaluation executes late ($\text{now} \ge t_{\text{timeout}}$), the contract **MUST NOT raise an error**.
   - Instead, it explicitly mutates state:
     ```python
     proposal.state = ProposalState.EXPIRED
     proposal.review_result = {
         "verdict": "EXPIRED",
         "reason": "AI_REVIEW_TIMEOUT_EXCEEDED"
     }
     # De-reserve funds cleanly
     round.reserved_wei -= proposal.requested_amount_wei
     round.available_wei += proposal.requested_amount_wei
     ```
   - The method completes with a successful return (`FINISHED_WITH_RETURN`), safely persisting the `EXPIRED` state and restored liquid balance.
4. **Voting Window Guarantee Before Round End**:
   When `evaluate_charter_fit` yields `ELIGIBLE`, the contract verifies:
   $$\text{now} + \text{round.voting\_duration} \le \text{round.round\_end}$$
   If insufficient time remains before round closure, the proposal cannot safely be voted on. It mutates state to `EXPIRED`, de-reserves funds back to `available_wei`, records `reason: "INSUFFICIENT_TIME_BEFORE_ROUND_END"`, and returns cleanly **without raising an error**.

### 6.2 Test Matrix: Timeout Boundary & Expiry Races

| Test ID | Scenario | Pre-State | Execution Order | Expected Outcome & Invariants |
| :--- | :--- | :--- | :--- | :--- |
| **TEST-EXP-01** | **Strict Timeout Boundary ($\text{now} = t_{\text{timeout}} - 1$)** | `SUBMITTED`, reserved $= X$ | `evaluate_charter_fit()` at $86,399\text{s}$ | Review accepted. If charter compliant $\rightarrow$ state becomes `ELIGIBLE`, voting deadline set, funds remain reserved. |
| **TEST-EXP-02** | **Strict Timeout Boundary ($\text{now} = t_{\text{timeout}}$)** | `SUBMITTED`, reserved $= X$ | `evaluate_charter_fit()` at $86,400\text{s}$ | Boundary inclusive of expiry. State mutates to `EXPIRED`. Funds de-reserved (`reserved -= X, available += X`). No exception raised. |
| **TEST-EXP-03** | **Race: `expire_review()` precedes late AI review** | `SUBMITTED`, reserved $= X$ | 1. `expire_review()` at $86,500\text{s}$<br>2. `evaluate_charter_fit()` at $86,510\text{s}$ | Step 1 sets state to `EXPIRED` and de-reserves $X$. Step 2 detects `proposal.state != SUBMITTED` and exits as a no-op. Zero double-counting. |
| **TEST-EXP-04** | **Race: Late AI review precedes `expire_review()`** | `SUBMITTED`, reserved $= X$ | 1. `evaluate_charter_fit()` at $86,500\text{s}$<br>2. `expire_review()` at $86,510\text{s}$ | Step 1 de-reserves $X$ and sets `EXPIRED` with clean return. Step 2 detects `proposal.state != SUBMITTED` and exits cleanly. |
| **TEST-EXP-05** | **Insufficient Voting Buffer Before Round End** | `SUBMITTED`, reserved $= X$ | `evaluate_charter_fit()` with $\text{now} + \text{voting\_duration} > \text{round\_end}$ | State mutates to `EXPIRED`. $X$ de-reserved to `available_wei`. No error raised; ledger balanced. |

---

## 7. Bounded Round Closure Specification: `close_round_and_refund(round_id)`

### 7.1 Bounded Settlement Invariant
In GenLayer, looping unboundedly over all proposals inside a single transaction risks hitting VM gas limits or execution time budgets. Therefore, round closure is strictly bounded:

1. **Permissionless Proposal Settlement**:
   Any network participant may call `settle_expired_proposal(round_id, proposal_id)` or `settle_expired_proposals_batch(round_id, proposal_ids: list[str])` (bounded up to $K=20$ proposals per call).
   - An unreviewed proposal past its review deadline is settled to `EXPIRED`.
   - A proposal whose voting window passed without achieving quorum is settled to `REJECTED`.
   - Both actions de-reserve funds back to `available_wei` individually.
2. **Closure Precondition**:
   The round creator may call `close_round_and_refund(round_id)` strictly when:
   $$\text{now} \ge \text{round.round\_end} \quad \text{AND} \quad \text{round.reserved\_wei} == 0$$
   If `round.reserved_wei > 0`, the transaction reverts with `gl.vm.UserError("ERR_UNSETTLED_PROPOSALS_EXIST_RESERVED_FUNDS_REMAIN")`.
   `approved_credits_wei > 0` does **not** block closure. Approved credits remain separately owed and claimable after the round moves to `CLOSED`.
3. **Behavior if Creator Never Calls Closure**:
   - **Approved Grants Permanent**: All approved grants (`approved_credits_wei`) remain permanently locked and claimable by approved recipients via `withdraw_credit()`. They never expire and cannot be clawed back.
   - **Liquid Funds Safe**: Unallocated funds in `available_wei` remain isolated in the contract balance; they cannot be accessed, transferred, or drained by any other round or caller.
   - **Community Settlement**: Since proposal settlement is permissionless, committee members or observers can clear active proposal reservations even if the creator becomes inactive. This only makes `reserved_wei == 0`; it cannot close the round or recover the creator refund.
   - **Lost Creator Key**: Both `close_round_and_refund` and `claim_creator_refund` require the original creator. If that key is lost, permissionless settlement cannot recover the unallocated refund. This is a v1 recoverability tradeoff, not a permissionless recovery mechanism.

### 7.2 Round Closure & Pending-Refund Ledger (`creator_claimable_wei`)
When round closure is executed, the contract does **NOT** emit an immediate external transfer. Instead, closure marks the round closed and transitions unallocated liquid funds to `creator_claimable_wei`, keeping approved credits permanent:

```python
# State Mutation on Closure
claimable_refund = round.available_wei
round.available_wei = u256(0)
round.creator_claimable_wei += claimable_refund
round.state = "CLOSED"
# Note: round.refunds_emitted_wei remains 0; no transfer has been emitted yet!
# Approved credits (round.approved_credits_wei) remain untouched and permanent!
```

### 7.3 Review of Integration Gate & Protocol Invariant Claim Architecture

Following rigorous architectural review, the initial design featuring an immutable locked integration gate (`integration_gate_locked = True`) has been **eliminated**:
1. **Flaw of Locked Gate**: An immutable locked gate made payouts impossible when deployed.
2. **Flaw of Owner Switch**: Adding an owner-controlled gate/pause switch would violate decentralized governance by introducing an arbitrary admin key capable of halting or censoring earned credits.
3. **Reviewable Final Design**: Claims (`withdraw_credit` and `claim_creator_refund`) are fully executable upon deployment, governed strictly and immutably by protocol invariants:
   - **Recipient Authorization**: Only the designated `p.recipient` can call `withdraw_credit(pid)`.
   - **Creator Authorization**: Only the designated `r.creator` can call `claim_creator_refund(round_id)`.
   - **Approved Status Precondition**: `p.state == "APPROVED"`.
   - **Closed Round Precondition**: `r.state in ("CLOSED", "REFUND_EMITTED")`.
   - **Checks-Effects-Interactions (CEI)**: Storage (`credit_withdrawn = True`, `creator_claimable_wei = 0`, state updates, and accounting buckets) is modified *before* emitting external transfers.
   - **Single-Use Invariant**: `credit_withdrawn` and zeroed `creator_claimable_wei` prevent any duplicate claim.
   - **Shared Balance Invariant**: `self.balance >= amount` prevents drawing on other rounds' obligations.
   - **Truthful Status**: Payouts and refunds transition to `PAYOUT_EMITTED` and `REFUND_EMITTED`, never marked `PAID` from parent transaction finalization alone.

```
[ACTIVE] ──(now >= round_end && reserved_wei == 0)──> [CLOSED]
                                                          │  (creator_claimable_wei custodied)
                                                          │  (approved_credits_wei permanent)
                                                          ▼
                                             [claim_creator_refund()]
                                                          │
                                                          ▼
                                              [emit_transfer to Creator]
                                                          │
                                                          ▼
                                                   [REFUND_EMITTED]
```

1. **`CLOSED`**:
   The round end passed and all proposals were settled. The creator called `close_round_and_refund()`. Liquid funds transitioned to `creator_claimable_wei`. **Zero transfers are emitted**, and `refunds_emitted_wei == 0`.
2. **Pull Claims via `emit_transfer()`**:
   - `withdraw_credit(pid)` emits a native chain-token transfer to `p.recipient`. Proposal state becomes `PAYOUT_EMITTED`.
   - `claim_creator_refund(round_id)` emits a native chain-token transfer to `r.creator`. Round state becomes `REFUND_EMITTED`.
   - These are `_Recipient(address).emit_transfer(value=...)` messages, **not ERC-20 token transfers**.
3. **Studio Next Limits & Truthful Status**:
   - In the specific PaymentSpike EOA transfer test on Studio Next, `client.getTriggeredTransactionIds({ hash })` returned an empty array (`[]`). While observed for that specific EOA transfer test, this single observation is not treated as a universal Studio guarantee; child transaction IDs are never fabricated.
   - Without an independent execution receipt from the RPC, state truthfully reflects `PAYOUT_EMITTED` / `REFUND_EMITTED`. A finalized parent transaction and an emitted transfer message do not independently prove recipient delivery.
4. **Delivery Failure Handling**:
   If a transfer receipt reports execution failure or the chain layer transaction reverts, contract state remains `PAYOUT_EMITTED` / `REFUND_EMITTED`, and the UI displays **`DELIVERY_FAILED (CHAIN TRANSACTION REVERTED)`**. Funds are explicitly documented as pending resolution rather than misreported as successfully received.

---

## 8. Value Transfers & Destination Enforceability

### 8.1 Reality of EOA Enforceability
- **GenLayer Intelligent Contracts CANNOT deterministically verify whether a destination address is an EOA or an EVM contract.** GenVM exposes no bytecode introspection of chain layer addresses.
- If a proposal recipient or round creator is an EVM contract that lacks a payable receive function or reverts in fallback, the child message emitted on finalization will revert on the chain layer.
- **Value is NOT automatically returned**: When `emit_transfer()` is called, value is deducted from `self.balance` into the message. If the child message reverts on the chain layer, the value remains trapped at the chain layer.

### 8.2 Verifiable Grant Payout States & Receipt Limits
1. `CREDIT_AUTHORIZED`: Proposal approved by 2/3 supermajority. `approved_credits_wei > 0`.
2. `PAYOUT_EMITTED`: Recipient called `withdraw_credit()`. Parent transaction succeeded with `FINISHED_WITH_RETURN`, and an external message (`messageType: 0`) was emitted with the designated value.
3. `PAID` vs `PAYOUT_EMITTED`:
   - Exact delivery **CANNOT** be described as independently verified without a concrete transfer execution receipt.
   - In the specific PaymentSpike EOA transfer test on Studio Next, `client.getTriggeredTransactionIds({ hash })` returned an empty array (`[]`); no separate child transaction ID was returned. Do **NOT** invent a synthetic child transaction ID or treat that single observation as a universal network guarantee.
   - When no independent receipt is returned by the RPC, the state must be truthfully displayed as **`PAYOUT_EMITTED (PARENT TX FINALIZED, TRANSFER EMITTED)`**. A finalized parent transaction and emitted transfer message do not independently prove recipient delivery.
4. **Delivery Failure Handling**: If the chain layer indicates failure or reverts, contract state remains `PAYOUT_EMITTED`, and the UI displays **`DELIVERY_FAILED (CHAIN TRANSACTION REVERTED)`**.

---

## 9. Historical Spike Evidence & Studio Next Protocol Analysis (PaymentSpike)

A focused payment validation spike (`PaymentSpike`) was previously executed on Chain ID `61997` (`studio-dev.genlayer.com/api` and `studio-next.genlayer.com/api`).
*Note: This section documents historical spike evidence from that early experiment. It does NOT validate CharterFlowCore, which has not yet been deployed or exercised on Studio Next.*

1. **Toolchain & Fee Profile Alignment**:
   - The globally installed GenLayer CLI (`v0.39.2`) is obsolete and incompatible with Consensus v0.6 RC; calling fee estimation throws `TypeError: client.estimateTransactionFees is not a function`.
   - Consensus v0.6 RC enforces active protocol fee policies (`fee_policy.enabled == true`). Zero-fee submissions revert at ConsensusMain (`0xb7278A61aa25c888815aFC32Ad3cC52fF24fE575`) with `FeeValueMustBeNonZero(1)`.
   - Using `genlayer-js@2.0.0-rc.1` with `estimateTransactionFees()` successfully resolves the required v0.6 `FeesDistribution` and `feeValue` (~0.1 GEN), enabling valid signed envelope broadcasts.
2. **Diagnosis of Deployment Failure & Runner Pinning**:
   - The GenVM runtime strictly requires the first line of an Intelligent Contract to declare its runner dependency comment (e.g. `# { "Depends": "py-genlayer:test" }` or pinned hash `# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }`). Without this line, the GenVM runner loader fails immediately with `invalid_contract runner absent`.
   - Verified that contract classes must inherit from `gl.contract.Contract`. Pre-deployment schema extraction via `client.getContractSchemaForCode()` confirmed valid AST and runner loading.
3. **Execution Results & Studio Next Transfer Receipt Limits**:
   - Deployment, deposit, and payout parent transactions achieved consensus finality (`FINALIZED`, status 7) and execution success (`FINISHED_WITH_RETURN`).
   - The payout parent transaction emitted an internal transfer message (`recipient: 0x5219...2ed3`, `value: 5000000000000000 wei`, `messageType: 0`).
   - **Limits of Studio's Transfer Receipts in Historical Spike**: In that specific PaymentSpike EOA transfer test on Studio Next, calling `client.getTriggeredTransactionIds({ hash })` returned an empty array (`[]`), and no child transaction receipt was returned by the RPC for that transfer. This observation reflects that specific historical test execution only, rather than a universal network guarantee. Child transaction IDs must never be fabricated, and parent finalization alone must not be described as verified delivery.
   - **Spike Vulnerability & Retirement Note**: In `PaymentSpike`, `deposit()` remained callable even after `paid == True`, which would trap new funds. `PaymentSpike` is retired and must never be deposited into or reused. The transactions and tests in `tests/test_studio_emitted_transfer.js` constitute historical spike evidence solely regarding that early spike; they do NOT validate `CharterFlowCore`. `CharterFlowCore` strictly enforces single initial deposits at round genesis, prevents post-genesis top-ups, and executes claims strictly via protocol invariants (Checks-Effects-Interactions, single-use flags, and caller authorization).


---

## 10. Comprehensive Money-Flow Table

The following table documents the exact accounting equation, ledger movement, contract balance, and external message emissions across all lifecycle states of CharterFlowCore:

| Stage / Action | Method Called | Caller Auth | Proposal State | Round State | Round Accounting Ledger ($	ext{Wei}$) | Contract Balance Movement ($\Delta 	ext{Balance}$) | Emitted External Transfer |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Round Genesis** | `create_round()` | Creator | N/A | `ACTIVE` | $	ext{available} = D$<br>$	ext{reserved} = 0$<br>$	ext{approved} = 0$<br>$	ext{claimable} = 0$<br>$	ext{payouts} = 0$<br>$	ext{refunds} = 0$ | $+D$ (Tx Value deposited) | None |
| **2. Nomination** | `nominate_proposal()` | Committee Member | `SUBMITTED` | `ACTIVE` | $	ext{available} = D - A$<br>$	ext{reserved} = A$<br>$	ext{approved} = 0$ | $0$ (Internal reallocation) | None |
| **3a. AI Non-Compliant** | `evaluate_charter_fit()` | Anyone | `INELIGIBLE` or `NEEDS_CLARITY` | `ACTIVE` | $	ext{available} = D$<br>$	ext{reserved} = 0$<br>$	ext{approved} = 0$ | $0$ (De-reserved to liquid pool) | None |
| **3b. AI Compliant** | `evaluate_charter_fit()` | Anyone | `ELIGIBLE` | `ACTIVE` | $	ext{available} = D - A$<br>$	ext{reserved} = A$<br>$	ext{approved} = 0$ | $0$ (Reserved for voting) | None |
| **4a. Committee Rejection / Expiry** | `cast_vote()` or `settle_expired_proposal()` | Committee / Anyone | `REJECTED` | `ACTIVE` | $	ext{available} = D$<br>$	ext{reserved} = 0$<br>$	ext{approved} = 0$ | $0$ (De-reserved to liquid pool) | None |
| **4b. Committee Approval (2/3)** | `cast_vote()` | Committee Member | `APPROVED` | `ACTIVE` | $	ext{available} = D - A$<br>$	ext{reserved} = 0$<br>$	ext{approved} = A$ | $0$ (Permanent credit allocated) | None |
| **5. Recipient Pull-Payout** | `withdraw_credit()` | Authorized Recipient Only | `PAYOUT_EMITTED` (`credit_withdrawn = True`) | `ACTIVE` or `CLOSED` | $	ext{approved} = 0$<br>$	ext{payouts} = A$ | $-A$ (Deducted from shared contract balance) | `_Recipient(recipient).emit_transfer(value=A)` |
| **6. Round Closure** | `close_round_and_refund()` | Creator Only | Proposals Terminal | `CLOSED` | $	ext{available} = 0$<br>$	ext{claimable} = D - A$<br>$	ext{refunds} = 0$ | $0$ (Liquid pool locked into claimable) | None (Zero phantom transfer) |
| **7. Creator Pull-Refund** | `claim_creator_refund()` | Creator Only | Proposals Terminal | `REFUND_EMITTED` | $	ext{claimable} = 0$<br>$	ext{refunds} = D - A$ | $-(D - A)$ (Deducted from shared contract balance) | `_Recipient(creator).emit_transfer(value=D - A)` |

### Strict Ledger Conservation Invariant
At every block and state transition:
$$	ext{initial\_deposit} \equiv 	ext{available\_wei} + 	ext{reserved\_wei} + 	ext{approved\_credits\_wei} + 	ext{creator\_claimable\_wei} + 	ext{payouts\_emitted\_wei} + 	ext{refunds\_emitted\_wei}$$
$$	ext{contract.balance} \equiv 	ext{available\_wei} + 	ext{reserved\_wei} + 	ext{approved\_credits\_wei} + 	ext{creator\_claimable\_wei}$$
$$	ext{contract.balance} + 	ext{payouts\_emitted\_wei} + 	ext{refunds\_emitted\_wei} \equiv 	ext{initial\_deposit}$$

---

## 11. Bounded Public Reads & Deterministic Transaction Clock

### 11.1 Bounded Public Reads & Compact Summaries
To prevent excessive gas consumption and RPC payload bloat (e.g. 50 full proposals containing 8KB markdown deliverables and voter arrays causing ~450KB responses):
1. **Full Proposal Queries (`get_round_proposals`)**:
   - Strictly capped at `MAX_FULL_PAGE_LIMIT = 20`.
   - Supplying `limit > 20` immediately reverts with `ERR_INVALID_PAGE_LIMIT`.
2. **Compact Proposal Summaries (`get_round_proposals_summary`)**:
   - Supports pagination up to `MAX_PAGE_LIMIT = 50`.
   - Excludes full deliverables text and voter arrays; returns a lightweight `deliverables_preview` (truncated to 120 chars) and essential status fields.
   - Reduces a 50-proposal page from ~450KB down to ~12KB.
3. **List Queries (`get_round_ids`, `get_all_proposal_ids`)**:
   - Capped at `MAX_PAGE_LIMIT = 50`.
   - Supplying `limit > 50` or `limit == 0` immediately reverts with `ERR_INVALID_PAGE_LIMIT`.
4. **Batch Settlement (`settle_expired_proposals_batch`)**:
   - Bounded between 1 and 20 proposals per transaction.
   - Batch size > 20 reverts with `ERR_BATCH_SIZE_EXCEEDS_MAXIMUM_20`.

### 11.2 Deterministic Transaction Clock Runtime
- The contract accesses time deterministically via `_current_timestamp()`, calling `datetime.datetime.now(datetime.timezone.utc).timestamp()`.
- Official GenLayer transaction-context documentation confirms that `datetime.now(timezone.utc)` and `time.time()` are pinned to the deterministic transaction timestamp in GenVM.
- Verified in direct unit tests via `vm.warp(future_iso)`, ensuring clean deadline settlement without nondeterministic clock drifts.
