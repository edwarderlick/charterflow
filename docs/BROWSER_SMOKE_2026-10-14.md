# Read-only browser smoke observations — 2026-10-14

**Target:** local Vite frontend configured for Studio Next chain `61997` and contract `0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21`  
**Safety:** No wallet connection, signing, transaction modal confirmation, faucet use, or write control was invoked.

| Surface | Observation |
|---|---|
| Landing | Shows the deployed-contract banner and, after the live query, an explicit Studio Next rollback-state read error. It does not render sample rounds or claim an empty chain. |
| Explore | Shows the same explicit read error. Aggregate values now render as unknown (`--`) during failed/unresolved reads instead of misleading zeroes. Live mode no longer shows simulated round activity in the consensus monitor. |
| Round detail | Direct navigation to `rnd-pilot-354517` renders `[READ ERROR] FAILED TO QUERY ROUND` with the `-32603` rollback diagnostic; it is not converted into a 404 or a verified round. |
| Proposal detail | A live proposal query renders `[READ ERROR] FAILED TO QUERY PROPOSAL`; it is not converted into a 404 or preview record. |
| Wallet/network | Header and network page show `NO WALLET` / `CLIENT_STATUS: DISCONNECTED`, target chain `61997`, and the configured Studio Next RPC. The lifecycle matrix is explicitly labeled as a simulated design preview. No wallet action was taken. |
| Preview toggle | Switching preview on shows global and record-level `DESIGN PREVIEW`, `PREVIEW RECORD`, and `NON-AUTHORITATIVE` labels. Fixture round and proposal details remain visually distinct from live mode. Switching back restores live reads and the RPC error state. |

## Frontend faults corrected during smoke testing

- Removed stale footer text implying that no contract had yet been committed.
- Replaced unconditional `NOMINAL`, `RUNTIME ACTIVE`, and validator-health claims with states derived from the actual live query or clearly marked preview data.
- Prevented failed Explore reads from displaying `0` round/capital metrics.
- Replaced simulated live-mode activity cards with deployment, Stage 2 readback, and safety-gate status cards.

The smoke test proves truthful rendering of the present error and preview isolation. It does not prove a successful live read, wallet connection, or write workflow.
