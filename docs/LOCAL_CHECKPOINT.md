# Local evidence checkpoint (not in the public tree)

`scripts/pilot_evidence.json` is the operator-held append-only checkpoint for the funded Studio Next pilot. It contains full receipts and `signed_rollup_transaction` blobs. Those are **not** private keys, and they are **not** safe to publish. The file is gitignored and must stay on the operator machine.

`scripts/probe_results.json` and `spike/payment_evidence.json` are also local.

## What a public checkout does

- `npm install`, local tests, and `npm run build:frontend` do **not** need the checkpoint.
- Read-only runner modes (`--probe`, `--monitor`, `--reconcile-deployment`, `--reconcile-stage2`) use the public recorded hashes in `docs/PUBLIC_EVIDENCE.md` when the file is absent. They will **not** create a new `pilot_evidence.json`.
- Write modes (`--deploy-only`, `--lifecycle-only`, `--resume`) **halt** if the checkpoint file is missing. They will not start or replay the funded pilot.

## How to supply the checkpoint safely

1. Copy the existing operator file to `scripts/pilot_evidence.json`, or set `CHARTERFLOW_EVIDENCE_FILE` to that existing path.
2. Do not invent a new JSON file with empty `stages` and then run write modes.
3. Do not set `CHARTERFLOW_ALLOW_EVIDENCE_CREATE=1` unless you are deliberately creating a **new**, unrelated experiment. That switch must not be used to reset this funded pilot.
4. Keep keytar / OS credential-manager keys off disk. Never place private keys in the checkpoint or in `.env`.
