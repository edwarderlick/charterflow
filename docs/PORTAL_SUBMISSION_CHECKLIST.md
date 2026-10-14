# GenLayer Builder Portal submission checklist

**As of:** 2026-10-14  
**This package is local only.** No wallet was connected, no contribution was submitted, and no repository was pushed. This document does not promise points or invent acceptance criteria.

## What was actually inspected

| Source | What it is | Use in this checklist |
|---|---|---|
| `https://portal.genlayer.foundation/` and `/builders` | Live GenLayer Foundation portal (unauthenticated) | **Verified:** the builders area exists; **Connect Wallet** is required; public copy says connect to unlock builder tasks, points, and a first contribution. Live submit-form fields were **not** visible. |
| `https://portal.genlayer.foundation/agent-tank/hackathon` | Live Agent Tank page | **Verified:** that hackathon window is closed. It is not this Builder Portal package. |
| `https://docs.genlayer.com` | Official developer documentation | **Verified:** Studio/Intelligent Contract docs exist. No Builder Portal form schema is published there. |
| `https://talks.genlayer.foundation/t/introducing-genlayers-incentivized-builders-program/20` | Official GenLayer Talks post | **Provisional context:** wallet sign-in and steward review are described. Field-level requirements are not treated as live-form verified. |
| `https://mintlify.wiki/genlayer-foundation/points/...` | Unauthenticated documentation mirror | **Provisional only.** It is not an authenticated live portal form. Do not treat its field list, point ranges, or evidence rules as verified portal requirements. |

## Public links

| Item | Status | Value |
|---|---|---|
| Git repository URL | **MISSING** | No remote. Local commits on `master` only; nothing has been pushed. |
| Hosted frontend URL | **MISSING** | Local Vite `http://localhost:5173/`. Static-host plan: `docs/FRONTEND_STATIC_HOSTING.md`. Not deployed. |
| Contract address / txs | **VERIFIED** (on-chain facts we recorded) | See `docs/PUBLIC_EVIDENCE.md`. |
| Explorer HTML page | **UNVERIFIED** | Configured base `https://explorer-studio-dev.genlayer.com/`. Page contents were not confirmed this pass. |
| Demo evidence URL | **MISSING** | Local smoke notes exist; no public demo URL. |
| Project copy | Local draft | `docs/PROJECT_COPY.md` |

## Live portal fields

| Field | Status |
|---|---|
| Wallet connection | **VERIFIED** required (live unauthenticated pages show Connect Wallet) |
| Authenticated profile fields | **UNVERIFIED** until wallet-authenticated inspection |
| Contribution type selector | **UNVERIFIED** (mirror lists types; live form not inspected) |
| Date / notes / evidence URL slots / reCAPTCHA | **UNVERIFIED** |
| GitHub OAuth | **UNVERIFIED** |
| Point ranges or multipliers | **UNVERIFIED** — do not promise points |
| Submit | **BLOCKED** this pass |

## Remaining path

1. Restore Studio Next `gen_call` reads (`docs/GENLAYER_SUPPORT_DRAFT.md`, unsent).
2. Pass exact Stage 2 genesis verifier on real chain reads. Until then Stage 2 stays **INCONCLUSIVE**.
3. Complete the fail-closed funded lifecycle (still unsent).
4. Push a public-safe git remote and host the frontend. **Not done here.**
5. Wallet-authenticated inspection of the live submit form, then submit. **Blocked by this pass.**
