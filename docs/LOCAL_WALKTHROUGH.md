# Local Vite walkthrough (before publish)

Dev server: **http://localhost:5173/** (also bound as `http://127.0.0.1:5173/`)

Keep **DESIGN PREVIEW** off unless you are checking fixture labels. Live mode must show Studio Next RPC errors honestly. Do not treat preview records as chain evidence. Do not connect a wallet or sign if you only want to inspect reads.

Pinned live target: chain `61997`, contract `0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21`, Transaction Kit `0.1.0-rc.2`, genlayer-js `2.0.0-rc.1`.

## Checklist

1. `/` Landing — deployed contract `0x408D…ba21`, chain 61997. After the live query, expect `[READ ERROR]` / `-32603` rollback, not “0 rounds” and not sample grants.
2. `/rounds` Explore — same read error; aggregate metrics `—`, tab counts `--`, not fabricated zeroes.
3. `/rounds/rnd-pilot-354517` — `[READ ERROR] FAILED TO QUERY ROUND` with rollback diagnostic. Not a 404, not a verified round. This ID is a locked recovery case; do not nominate into it.
4. `/rounds/new` Create round — form renders. Submitting would need a wallet on 61997. Do not submit until `gen_call` reads work. Nomination window is at least 24 hours.
5. `/rounds/round-094-sdk/nominate` in live mode — `[READ ERROR]`, not a preview proposal and not an infinite spinner. Toggle preview only to confirm `DESIGN PREVIEW` / `PREVIEW RECORD` labels, then turn it off.
6. `/proposals/does-not-exist` — live query error or 404, not a preview record.
7. `/activity` — `NO WALLET CONNECTED` / disconnected. No sample addresses substituted.
8. `/network` — chain 61997, Studio Next RPC, disconnected. Lifecycle matrix labeled as design preview.
9. Toggle **DESIGN PREVIEW** on, confirm banners, then off — live error state returns.

## Agent walkthrough recorded 2026-10-14 (headless Chrome against live Vite)

Server: `http://127.0.0.1:5173/` (Vite 8.3.4). Preview off unless noted. No wallet connected. No write. Screenshots stayed local under `frontend/review_screenshots/walkthrough_live/` (gitignored).

| Route | Result |
|---|---|
| `/` | Banner `DEPLOYED CONTRACT CONFIGURED // 0x408DcC...96ba21 · Chain 61997`. Live query `[READ ERROR] ON-CHAIN QUERY FAILED` with SQLAlchemy rollback / `viem@2.57.5`. Footer `DEPLOYED / READBACK BLOCKED`. |
| `/rounds` | Metrics `ACTIVE ROUNDS: --` / `TOTAL LOCKED: --`. Tabs `ALL ROUNDS (--)`. `[READ ERROR] ON-CHAIN QUERY FAILED`. Consensus monitor: deployment configured, Stage 2 unverified, no later write authorized. |
| `/rounds/rnd-pilot-354517` | `[READ ERROR] FAILED TO QUERY ROUND FROM ON-CHAIN RUNTIME`. Diagnostic rollback. Not 404. |
| `/rounds/rnd-pilot-354517/nominate` | Same round read error. Form not shown. |
| `/rounds/round-094-sdk/nominate` | Same round read error after a loading state. Infinite spinner was a defect; it now surfaces the RPC error. |
| `/rounds/new` | Genesis wizard local draft. Chain 61997. No submit. |
| `/proposals/does-not-exist` | `[READ ERROR] FAILED TO QUERY PROPOSAL`. Not a preview record. |
| `/activity` | `NO WALLET CONNECTED` / `SESSION: DISCONNECTED`. Zeroes are disconnected-wallet placeholders, not a live ledger. |
| `/network` | Target `#61997`, RPC `studio-next.genlayer.com/api`, `CLIENT_STATUS: DISCONNECTED`. Lifecycle matrix labeled `[DESIGN PREVIEW // SIMULATED]`. |
| `/this-route-does-not-exist` | `[SYSTEM_FAULT 404]`. |
| Preview on `/` | `PREVIEW DATA: ON` + `DESIGN PREVIEW` fixture banner. Toggle off restores live contract banner. |
| Mobile 390px | `/`, `/rounds`, `/rounds/new`, `/activity` render; explore still shows the live read error. |

This walkthrough proves honest live-mode errors and preview isolation. It does **not** prove a successful live round read, wallet connection, or write.

## Blocked live writes

Studio Next `gen_call` still returns JSON-RPC `-32603`. No new funded round will be created until that read path is restored. A localhost walkthrough of writes cannot produce a live transaction today.

## After you test

Reply with what you saw. Do not push GitHub or deploy Vercel until that report.
