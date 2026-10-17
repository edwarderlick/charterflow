# GenLayer Builder Portal submission checklist

**Originally drafted:** 2026-10-14  
**Last updated:** 2026-10-17  
**Submission status:** **NOT SUBMITTED**. Public git repository and hosted frontend are live, but portal submission has not been performed. Acceptance of chain `61997` depends on specific mission rules. This document does not promise points or invent acceptance criteria.

## What was actually inspected

| Source | What it is | Use in this checklist |
|---|---|---|
| `https://portal.genlayer.foundation/` and `/builders` | Live GenLayer Foundation portal (unauthenticated) | **Verified:** the builders area exists; **Connect Wallet** is required; public copy says connect to unlock builder tasks, points, and a first contribution. Live submit-form fields were **not** visible. |
| `https://portal.genlayer.foundation/agent-tank/hackathon` | Live Agent Tank page | **Verified:** that hackathon window is closed. It is not this Builder Portal package. |
| `https://docs.genlayer.com` | Official developer documentation | **Verified:** Studio/Intelligent Contract docs exist. No Builder Portal form schema is published there. |
| `https://talks.genlayer.foundation/t/introducing-genlayers-incentivized-builders-program/20` | Official GenLayer Talks post | **Provisional context:** wallet sign-in and steward review are described. Field-level requirements are not treated as live-form verified. |
| `https://mintlify.wiki/genlayer-foundation/points/...` | Unauthenticated documentation mirror | **Provisional only.** It is not an authenticated live portal form. Do not treat its field list, point ranges, or evidence rules as verified portal requirements. |

## Public links & deliverables

| Item | Status | Value |
|---|---|---|
| Git repository URL | **PUBLIC** | [https://github.com/edwarderlick/charterflow](https://github.com/edwarderlick/charterflow) |
| Hosted frontend URL | **LIVE** | [https://charterflow-coral.vercel.app/](https://charterflow-coral.vercel.app/) |
| Contract address | **VERIFIED** | [`0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8`](https://explorer-studio-dev.genlayer.com/address/0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8) |
| Explorer address page | **LIVE** | [`https://explorer-studio-dev.genlayer.com/address/0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8`](https://explorer-studio-dev.genlayer.com/address/0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8) |
| Lifecycle evidence | **RECORDED** | [`docs/evidence/verified-flow.json`](evidence/verified-flow.json), [README.md](../README.md), [`docs/SUBMISSION_STATUS.md`](SUBMISSION_STATUS.md) |
| Project copy | Prepared | [`docs/PROJECT_COPY.md`](PROJECT_COPY.md) |

## Live portal fields (unauthenticated view)

| Field | Status |
|---|---|
| Wallet connection | **VERIFIED** required (live unauthenticated pages show Connect Wallet) |
| Authenticated profile fields | **UNVERIFIED** until wallet-authenticated inspection |
| Contribution type selector | **UNVERIFIED** (mirror lists types; live form not inspected) |
| Date / notes / evidence URL slots / reCAPTCHA | **UNVERIFIED** |
| GitHub OAuth | **UNVERIFIED** |
| Point ranges or multipliers | **UNVERIFIED** — do not promise points |
| Submit action | **NOT SUBMITTED** |

## Remaining requirements before portal submission

1. **Verify target mission chain rules:** Check whether the specific GenLayer Builder Portal mission accepts Studio development preview (`61997`) or strictly mandates Asimov testnet (`4221`).
2. **Authenticated portal form inspection:** Connect wallet to `https://portal.genlayer.foundation/builders` to inspect the exact live form schema, required contribution type, character limits, and attachment fields.
3. **Submit via portal:** Fill and submit the form with public repository URL, live Vercel URL, contract address, and evidence summary.

