# CharterFlow v1: Frontend to Smart Contract Interface Map

**Document Version:** 1.3.0-LIVE-READS-ALIGNED  
**Purpose:** Precise mapping between frontend UI components, the implemented GenLayer Python Intelligent Contract (`contracts/CharterFlowCore.py`), and the frontend live reads adapter (`TruthfulLiveDataAccessAdapter`).  
**Status:** Live read adapter configured for verified deployment `0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21`; Stage 2 round readback is unresolved and later writes remain blocked

---

## 1. Architectural Three-Tier State Distinction

To guarantee strict truthfulness in the user interface, all application state is categorized into three distinct tiers:

1. **Tier 1: Current Preview UI (Mock / Client-Only)**
   - Local drafts stored in browser `localStorage`.
   - Sample preview rounds and proposals (`sampleData.ts`).
   - Mock simulated event stream and telemetry logs.
   - Client-side filtering and sorting.
2. **Tier 2: Implemented Contract API (`contracts/CharterFlowCore.py`)**
   - The concrete Python Intelligent Contract interface implemented in `contracts/CharterFlowCore.py` and validated by 18 unit tests in `tests/test_charterflow_core.py`.
   - Native value transfers via `_Recipient(Address(...)).emit_transfer(...)`.
   - AI review equivalence executed via `gl.vm.run_nondet_unsafe(...)` with categorical verdict agreement.
   - Deterministic UTC timestamps via `datetime.datetime.now(datetime.timezone.utc).timestamp()`.
   - Paginated views with bounded limits (max 50 for IDs/summaries, max 20 for full proposals).
3. **Tier 3: Verified Deployed Behavior on GenLayer Studio Next (Chain ID 61997)**
   - Exact contract source SHA-256 `34ea0e374cfe68788067838cebf4ca0c226e139c713aca6e7345716b35aad5ee` is deployed on GenLayer Studio Next (Chain ID 61997).
   - Requires status `ACCEPTED` or `FINALIZED` **AND** execution result `FINISHED_WITH_RETURN`.
   - The intended Stage 2 round is not treated as verified until full round, registry, genesis-ledger, and balance readback agree. RPC/database errors are shown as errors, never as an empty chain.
   - External child message finalization must be confirmed before claiming delivery; the contract state remains truthfully named `PAYOUT_EMITTED` or `REFUND_EMITTED` when only message emission is proven.

---

## 2. Route & Screen Mapping Table

### 2.1 Route `/` — Landing Page (`LandingPage.tsx`)

| UI Element | Tier 1: Current Preview UI | Tier 2: Implemented Contract API | Tier 3: Verified Deployed Requirement |
| :--- | :--- | :--- | :--- |
| Network Badge | Shows "STUDIO NEXT #61997" | Provider chain check (`chainId === 61997`) | Connected to live Studio Next RPC (`studio-next.genlayer.com/api`) |
| Active Capital Pool | Static mock `128,450 GEN` | Read: Sum of `round.initial_deposit` across `get_round_ids()` | Aggregated from deployed `CharterFlowCore` |
| Settled Rounds | Static mock `14` | Read: Count of rounds where `now > round_end` | Verified on-chain round timestamps |
| Round Cards Grid | Sample preview items | Read: `get_round_ids_count()` + `get_round_ids(0, 3)` + `get_round(id)` | Paginated contract view call; RPC failures show an explicit error and never substitute sample rounds or imply an empty chain |

---

### 2.2 Route `/rounds` — Explore Rounds (`ExploreRoundsPage.tsx`)

| UI Element | Tier 1: Current Preview UI | Tier 2: Implemented Contract API | Tier 3: Verified Deployed Requirement |
| :--- | :--- | :--- | :--- |
| Connection Status | "CONTRACT ADDRESS NOT CONFIGURED" / Configured deployed address | Read: `isContractConfigured()` via `NETWORK_CONFIG.contractAddress` | Verified bytecode deployed at configured address; successful reads are a separate status |
| Available Pool | Sum of preview items | Read: Sum of `round.available_wei` | Matches contract balance accounting |
| Filter Tabs | Client-side array filtering | Client-side filtering over contract reads | Filtered client state |
| Round Progress Bar | `(reserved + approved) / initial` | `(round.reserved_wei + round.approved_credits_wei) / round.initial_deposit` | Exact integer calculation |
| Empty State | "No Matching Rounds Located" | Explicit "Contract Address Not Configured" or "0 Live Rounds On-Chain" only after a successful empty read | Never converts an RPC error into an empty state or substitutes sample data in live mode |

---

### 2.3 Route `/rounds/create` — Create Round Wizard (`CreateRoundPage.tsx`)
*(Intentional Aliases: `/rounds/new`, `/create-round`)*

| UI Element / Field | Tier 1: Current Preview UI | Tier 2: Implemented Contract API | Tier 3: Verified Deployed Requirement |
| :--- | :--- | :--- | :--- |
| Member Roster Input | Validates EVM hex & duplicates | Parameter: `committee_roster: list[Address]` | Contract enforces min 2, max 50, no 0x0, no duplicates |
| Consensus Threshold | Displays fixed exact 2/3 | Fixed in contract: `(N * 2 + 2) // 3` | Verified integer ceiling consensus |
| Preview Quorum Count | Displays `(N*2+2)//3` with note | Preview baseline calculation | Note: baseline assumes no recipient recusal |
| Initial Escrow Deposit | Number in GEN | Sent via payable: `gl.message.value` (wei) | Must be `>= 1e18 wei` |
| Per-Proposal Cap | Number in GEN | Parameter: `grant_cap_wei: u256` | Enforces `0 < cap <= initial_deposit` |
| Nomination Cutoff | Date picker | Parameter: `nomination_cutoff: u64` | Enforces `now + 3600 <= cutoff` |
| Round End Date | Date picker | Parameter: `round_end: u64` | Enforces `cutoff + 86400 + voting_duration <= round_end` |
| "SAVE LOCAL DRAFT" | Saved to browser `localStorage` | **Preview/Client Only** (No on-chain call) | Stores uncommitted draft in browser |
| "DEPLOY & FREEZE" | Opens genesis confirmation | Write: `@gl.public.write.payable def create_round(...)` | Disabled in live reads pass; requires explicit broadcast authorization |

---

### 2.4 Route `/rounds/:roundId` — Round Detail (`RoundDetailPage.tsx`)

| UI Element | Tier 1: Current Preview UI | Tier 2: Implemented Contract API | Tier 3: Verified Deployed Requirement |
| :--- | :--- | :--- | :--- |
| Contract Address | `[DESIGN PREVIEW] 0x...` | Read: `NETWORK_CONFIG.contractAddress` | Live deployed contract address |
| Total Escrow | e.g. `50,000.00 GEN` | Read: `get_round(round_id)["initial_deposit"]` | Reconciles with initial `msg.value` |
| Available Pool | e.g. `45,000.00 GEN` | Read: `get_round(round_id)["available_wei"]` | Unreserved liquid treasury |
| Reserved Pool | e.g. `5,000.00 GEN` | Read: `get_round(round_id)["reserved_wei"]` | Locked in active proposals |
| Approved Credits | e.g. `0.00 GEN` | Read: `get_round(round_id)["approved_credits_wei"]` | Permanent credits awaiting pull-withdrawal |
| Proposal List | Sample proposals for round | Read: `get_round_proposals_count(round_id)` + `get_round_proposals_summary(round_id, offset, limit)` | Paginated contract read (max 50 per page) |
| "CLOSE ROUND" | Creator modal | Write: `close_round_and_refund(round_id)` | Caller must be creator, `now >= round_end`, and `reserved_wei == 0`. Unallocated funds move to `creator_claimable_wei`. Disabled during reads pass. |

---

### 2.5 Route `/proposals/nominate/:roundId` — Nominate Proposal (`NominateProposalPage.tsx`)
*(Intentional Alias: `/rounds/:id/nominate`)*

| UI Element / Field | Tier 1: Current Preview UI | Tier 2: Implemented Contract API | Tier 3: Verified Deployed Requirement |
| :--- | :--- | :--- | :--- |
| Recipient Address | Validates EVM format | Parameter: `recipient: Address` | Must be valid non-zero EVM address |
| Proposal Title | Text input (5-120 chars) | Parameter: `title: str` | Enforces `5 <= len(title) <= 120` |
| Requested Allocation | Validates `<= cap` & available | Parameter: `requested_amount_wei: u256` | Atomically transitions funds from `available_wei` to `reserved_wei` |
| Deliverables Text | Text area (20-8192 chars) | Parameter: `deliverables_text: str` | Inputs to AI review prompt; sanitizes markdown fences |
| "REVIEW LOCAL DRAFT" | Form submit | Stores uncommitted local draft | Clearly marked as local draft; on-chain writes disabled during live reads pass |

---

### 2.6 Route `/proposals/:proposalId` — Proposal Detail (`ProposalDetailPage.tsx`)

| UI Element | Tier 1: Current Preview UI | Tier 2: Implemented Contract API | Tier 3: Verified Deployed Requirement |
| :--- | :--- | :--- | :--- |
| Status Ribbon | `PREVIEW-ONLY VOTING STATE` | Read: `get_proposal(proposal_id)["state"]` | States: `SUBMITTED`, `ELIGIBLE`, `INELIGIBLE`, `NEEDS_CLARITY`, `VOTING`, `APPROVED`, `REJECTED`, `EXPIRED`, `PAYOUT_EMITTED` |
| Voting Deadline | "NO ON-CHAIN DEADLINE" | Read: `get_proposal(proposal_id)["voting_deadline"]` | Set on-chain when AI review yields `ELIGIBLE` (`now + voting_duration`) |
| Quorum Calculation | Recalculated if recipient on roster | Read: `(N_eligible * 2 + 2) // 3` | Dynamic formula with recipient recusal check ($N-1$ if recipient on committee roster) |
| Recusal Notice Banner | Displays if recipient on roster | Read: `isRecipientOnCommittee` | Warns that recipient is recused from voting |
| AI Decision | `ELIGIBLE` / `NEEDS_CLARITY` badge | Read: `review_verdict` & `review_reason` | Verdict-only validator agreement; `review_reason` explicitly says semantic rationale was not verified |
| "CAST VOTE" Buttons | Local preview modal | Write: `cast_vote(proposal_id, vote_type)` | Caller must be committee member, non-recipient, unvoted. Disabled during live reads pass. |
| "WITHDRAW CREDIT" | Local withdrawal notice | Write: `withdraw_credit(proposal_id)` | Caller must be `proposal.recipient` and state must be `APPROVED`. Emits transfer. Disabled during live reads pass. |
| Payout Status | Shows payout emitted state | Contract state: `PAYOUT_EMITTED` | Distinctly labeled `PAYOUT_EMITTED`; never independently labeled as `PAID` without child transfer receipt verification. |

---

### 2.7 Route `/activity` — My Activity (`MyActivityPage.tsx`)

| UI Element | Tier 1: Current Preview UI | Tier 2: Implemented Contract API | Tier 3: Verified Deployed Requirement |
| :--- | :--- | :--- | :--- |
| Connected Wallet | Connected address / No wallet | Provider check (`account`) | Live connected wallet session |
| Total Votes Cast | Count of preview votes | Read: Iterates `all_proposal_ids` checking `voted_addresses` | Verified on-chain ballot count |
| Available Grants | Sum of approved grants | Read: Approved proposals where `recipient == user` and `!credit_withdrawn` | Permanent claim via `withdraw_credit(proposal_id)` |
| Nominated Proposals | Preview nominations | Read: Proposals where `proposer == user` | Verified on-chain proposals |
| Rounds Deployed | Preview rounds | Read: Rounds where `creator == user` | Verified on-chain deployed rounds |

---

### 2.8 Route `/network` — Network & Diagnostic States (`TransactionNetworkStatesPage.tsx`)

| UI Element | Tier 1: Current Preview UI | Tier 2: Implemented Contract API | Tier 3: Verified Deployed Requirement |
| :--- | :--- | :--- | :--- |
| Target Chain | `CHAIN ID 61997` | Provider check (`chainId === 61997`) | Matched provider network |
| Target RPC | `studio-next.genlayer.com/api` | `NETWORK_CONFIG.rpcUrl` | Live JSON-RPC endpoint |
| Contract Address | Configured address or empty | `NETWORK_CONFIG.contractAddress` | Bytecode verification |
| Diagnostic Matrix | 4-Stage visual cards | Contract states: `SUBMITTED`, `ELIGIBLE`, `VOTING`, `PAYOUT_EMITTED` | Visual state demonstration |

---

## 3. UI Controls Unsupported by Proposed Contract v1

| UI Control / Feature | Presence in Frontend | Reason Unsupported in Contract v1 | Truthful Treatment |
| :--- | :--- | :--- | :--- |
| **Off-Chain Delivery Verification** | Deliverables text input | Contract v1 evaluates proposed deliverables against the charter before voting; it does not inspect off-chain GitHub/code delivery. | Labeled "PROPOSED DELIVERABLES"; note explains delivery occurs post-settlement. |
| **Configurable Quorum Slider** | Removed from Create Round | Contract v1 enforces fixed canonical 2/3 supermajority math `(N * 2 + 2) // 3`. | Display shows fixed exact 2/3 rule. |
| **Top-Up Deposits After Genesis** | Mention of secondary funding | Contract v1 prohibits deposits after genesis. | Only genesis initial deposit is accepted. |
| **Automated Push Disbursements** | "Autonomously withdraw" text | Native transfers require gas; contracts cannot push funds without a transaction trigger. | Wording specifies "Beneficiary pulls funds via withdraw_credit()." |
| **Sub-second Validator Latency Telemetry** | 14ms / 28ms node pings | Validator network latencies are internal consensus metrics not exposed on-chain. | Labeled `[DESIGN PREVIEW // SIMULATED LIFECYCLE STATES]`. |
| **Wallet Extension Disconnection** | Navbar "DISCONNECT" button | Browser extensions do not permit dApps to sever the user's extension connection. | Honestly labeled "CLEAR LOCAL STATE". |
