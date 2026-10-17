# Static host for the Vite frontend

Public demo: [https://charterflow-coral.vercel.app/](https://charterflow-coral.vercel.app/). This repository does not deploy itself. Vercel builds the connected `frontend` directory.

## Build-time public settings

Vite inlines `VITE_*` at build time. Defaults in `frontend/src/config/network.ts` already match Studio Next and the verified contract. Override only with public values:

| Variable | Default |
|---|---|
| `VITE_RPC_URL` | `https://studio-next.genlayer.com/api` |
| `VITE_EXPLORER_URL` | `https://explorer-studio-dev.genlayer.com` |
| `VITE_CONTRACT_ADDRESS` | `0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8` |

Never put private keys in `VITE_*`. Copy `frontend/.env.example` to `frontend/.env` locally if needed.

Build from the repo root:

```bash
npm --prefix frontend ci
npm run build:frontend
```

Output: `frontend/dist/` (gitignored).

## SPA route fallback

The app uses `BrowserRouter` with routes such as `/rounds/:id` and `/proposals/:id`. The static host must serve `index.html` for unknown paths.

- Netlify: `frontend/public/_redirects` contains `/*    /index.html   200` and is copied into `dist/`.
- Vercel: `frontend/vercel.json` rewrites `/(.*)` to `/index.html`. Set the Vercel **Root Directory** to `frontend`. Install `npm ci`, build `npm run build`, output `dist`. Public env (optional; the source defaults already match):
  - `VITE_RPC_URL=https://studio-next.genlayer.com/api`
  - `VITE_EXPLORER_URL=https://explorer-studio-dev.genlayer.com`
  - `VITE_CONTRACT_ADDRESS=0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8`
- Cloudflare Pages / nginx: equivalent SPA fallback to `index.html`.
- GitHub Pages project sites also need Vite `base` set to the repo subpath.

These settings are what a Git-connected Vercel project needs. This repository does not deploy itself.

## Honest live errors and preview isolation

The hosted app must keep default **live** mode. Failed Studio Next `gen_call` reads must show the RPC error (including `-32603` rollback). They must not render as an empty chain or as verified rounds. Design-preview fixtures stay behind an explicit **PREVIEW DATA** toggle and `DESIGN PREVIEW` / `PREVIEW RECORD` labels (`frontend/src/components/DesignPreviewBanner.tsx`, `docs/BROWSER_SMOKE_2026-10-14.md`).

`VERIFIED_DEPLOYMENT.stage2ReadbackVerified` is still `false` in source and is not what the README uses as evidence. The verified round is documented in `docs/evidence/verified-flow.json`.
