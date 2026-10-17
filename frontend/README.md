# CharterFlow // Industrial Intelligence Governance Frontend

CharterFlow is a grant-treasury frontend for **GenLayer Studio development preview (chain ID 61997)**. The repo README is the steward guide. This directory is the Vercel root. Live mode reads contract `0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8`. Design-preview fixtures stay behind an explicit toggle. Creator close and refund have not been run.

---

## Quick Start & Setup

### Prerequisites
- Node.js 18+ / 20+
- npm or pnpm

### Development
```bash
cd frontend
npm install
npm run dev
```
The application will launch on `http://localhost:5173/`.

### Production Build & Typecheck
```bash
npm run build
npm run lint
```

---

## Route & Interface Map

| Route | View Component | Description |
|---|---|---|
| `/` | `LandingPage` | Industrial intelligence governance overview, technical specifications, and protocol entry points. |
| `/how-it-works` | `HowItWorksPage` | Protocol mechanics, separation of powers, 5-stage lifecycle state machine, and validator consensus rules. |
| `/rounds` | `ExploreRoundsPage` | Searchable directory of grant rounds with status tabs, sorting, whitelisted committee filter, and local draft recovery. |
| `/rounds/new` | `CreateRoundPage` | 4-step genesis wizard: metadata, charter rules & exclusions, case-insensitive member roster validation, and deposit allocation. |
| `/rounds/:id` | `RoundDetailPage` | Detailed round dashboard: frozen charter rules, committee roster, 5-part reconciled treasury ledger, and proposal list. |
| `/rounds/:id/nominate` | `NominateProposalPage` | 3-step proposal nomination wizard: recipient verification, directive validation, treasury bound checks, and draft saving. |
| `/proposals/:id` | `ProposalDetailPage` | Proposal specification, deliverable criteria, AI validator compliance audit, quorum tracker, and derived member voting / withdrawal controls. |
| `/activity` | `MyActivityPage` | Wallet-authenticated dashboard: active nominations, claimable allocations, committee voter credentials, and voting history. |
| `/network` | `TransactionNetworkStatesPage` | Chain ID 61997 network monitor, RPC configuration, chain mismatch detection, and lifecycle state transition screens. |
| `*` | `NotFoundPage` | Dedicated 404 page for unmatched routes and invalid resource identifiers. |

---

## Truthful Mode vs. Design Preview Mode

### Truthful Live Mode (Default: Active)
- By default, CharterFlow opens in **Truthful Live Mode** (`isDesignPreview = false`).
- In this mode, no hardcoded sample records or fake round proposals are injected.
- The public configuration targets the verified deployment at `0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8`. RPC failures display explicit errors; they are never presented as an empty chain. Funded rounds on `0x9579A19c2aD0a2DBd0B806Abb85bE9a2E6391E48` stay visible and labeled legacy. AI review and voting are closed on that address. Funded rounds on `0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21` remain a separate recovery case.

### Design Preview Mode (Optional User Choice)
- Users can explicitly toggle **DESIGN PREVIEW** on the navigation banner.
- When enabled, every page visibly displays a `[DESIGN PREVIEW // PREVIEW RECORD]` notice.
- Fixtures adhere to strict internal reconciliation:
  - Total Pool: 50,000 test GEN
  - Available: 30,000 GEN (60%)
  - Reserved: 10,000 GEN (20%)
  - Approved: 5,000 GEN (10%)
  - Paid/Withdrawn: 5,000 GEN (10%)
  - Committee: 12 members, 8 required votes (66.7% quorum threshold), 12 total registered voters.

### Distinct State Labels
1. `LOCAL DRAFT`: Uncommitted form state preserved in browser `localStorage`. Not submitted on-chain or displayed as nominated/reserved.
2. `PREVIEW RECORD`: Simulated sample fixture displayed for visual layout validation.
3. `ON-CHAIN STATE`: Authenticated contract state read from GenLayer Studio Next.

---

## Wallet Identity & Provider Constraints

1. **No Identity Substitution**: Sample addresses (e.g., `0x71c5...`) are never substituted for disconnected users in My Activity, eligibility filters, nomination, or voting.
2. **Disconnected Views**: Disconnected states cleanly display "NO WALLET CONNECTED" or "Connect wallet".
3. **Session Clearing vs. Provider Disconnect**: The user menu button is honestly labeled "CLEAR SESSION". Standard Web3 providers (MetaMask, Rabby, etc.) cannot be forcefully disconnected by client-side JavaScript; the button clears local session state and cached addresses.
4. **Network Verification**: Balances are only displayed as test GEN upon confirming Chain ID `61997`. Small nonzero balances are formatted with full precision (`< 0.0001 GEN`) to prevent misleading `0.00` representations.

---

## Current Architecture Limitations

- **Verified round**: `round-open-source-rpc--mvb7nltc` on `0x5643…25C8` has 0.95 GEN available and 0.05 GEN withdrawn. Creator close and refund have not been tested. The older Stage 2 round `rnd-pilot-354517` on `0x408D…` remains a separate inconclusive recovery case.
- **Network Error Truthfulness**: The current Studio Next `-32603` rollback-state error is rendered as a read failure, not as proof that no rounds exist.
- **Preview Isolation**: Design-preview records remain clearly labeled fixtures and are never evidence about the deployed contract.
- **Native Message Limitation**: A parent withdrawal receipt plus `PAYOUT_EMITTED` proves message emission, not recipient delivery, unless independent downstream evidence is available.
