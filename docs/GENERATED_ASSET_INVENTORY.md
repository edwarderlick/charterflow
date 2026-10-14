# Generated and design-source inventory

This is an inventory only. Nothing listed here was deleted. Visual design sources and chain evidence are retained even when they are not part of the production bundle.

| Path | Current role | Disposition |
|---|---|---|
| `charterflow_create_round/` | Stitch/source reference for create-round screen | Retain as design source |
| `charterflow_explore_rounds/` | Stitch/source reference for explore screen | Retain as design source |
| `charterflow_how_it_works/` | Stitch/source reference for protocol explainer | Retain as design source |
| `charterflow_industrial_intelligence/` | Stitch/source reference assets | Retain pending provenance review |
| `charterflow_landing_page/` | Stitch/source reference for landing page | Retain as design source |
| `charterflow_my_activity/` | Stitch/source reference for activity screen | Retain as design source |
| `charterflow_nominate_proposal/` | Stitch/source reference for nomination screen | Retain as design source |
| `charterflow_proposal_detail_094_01/` | Stitch/source reference for proposal detail | Retain as design source |
| `charterflow_round_detail_094_sdk/` | Stitch/source reference for round detail | Retain as design source |
| `charterflow_transaction_network_states/` | Stitch/source reference for network states | Retain as design source |
| `frontend/dist/` | Generated Vite production output | Regenerable; do not use as source of truth |
| `frontend/review_screenshots/` | Prior visual-review captures | Retain as review evidence |
| `artifacts/` | Currently empty generated-artifact location | Review later; no deletion in this pass |
| `.uv-cache-run/`, `.pytest_cache/` | Local test caches | Regenerable; no deletion in this pass |

`scripts/pilot_evidence.json` is evidence, not disposable generated output. Historical `DiskFull` records and later Stage 2 observations must remain append-only history. It is gitignored and must not be in the first public commit (`docs/LOCAL_CHECKPOINT.md`). `scripts/probe_results.json` and `spike/payment_evidence.json` are also gitignored. Stitch folders and `frontend/review_screenshots/` are retained on disk and also gitignored for the first public commit.
