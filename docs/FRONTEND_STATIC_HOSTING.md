# Static-host plan for the Vite frontend (not deployed)

Do not deploy in this pass. This is the packaging plan for a later public host.

## Build-time public settings

Vite inlines `VITE_*` at build time. Defaults in `frontend/src/config/network.ts` already match Studio Next and the verified contract. Override only with public values:

| Variable | Default |
|---|---|
| `VITE_RPC_URL` | `https://studio-next.genlayer.com/api` |
| `VITE_EXPLORER_URL` | `https://explorer-studio-dev.genlayer.com` |
| `VITE_CONTRACT_ADDRESS` | `0x408DcCc27fC7b4455E82ffe78C824cda4A96ba21` |

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
- Vercel: `rewrites` `[{ "source": "/(.*)", "destination": "/index.html" }]`.
- Cloudflare Pages / nginx: equivalent SPA fallback to `index.html`.
- GitHub Pages project sites also need Vite `base` set to the repo subpath.

## Honest live errors and preview isolation

The hosted app must keep default **live** mode. Failed Studio Next `gen_call` reads must show the RPC error (including `-32603` rollback). They must not render as an empty chain or as verified rounds. Design-preview fixtures stay behind an explicit **PREVIEW DATA** toggle and `DESIGN PREVIEW` / `PREVIEW RECORD` labels (`frontend/src/components/DesignPreviewBanner.tsx`, `docs/BROWSER_SMOKE_2026-10-14.md`).

`VERIFIED_DEPLOYMENT.stage2ReadbackVerified` remains `false` until the exact genesis verifier passes on real chain reads.
