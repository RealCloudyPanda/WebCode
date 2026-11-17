# Webcode

Webcode is a free, browser-based collaborative code editor. Open a project, edit files together with other people in real time (live cursors, shared undo), and run Node projects right in the tab: the code executes inside a WebContainer, with real terminals, a test runner and a live preview. Sign in with GitHub, share a project by link, or try the demo as a guest.

Live demo: `https://<app>.fly.dev`

<!-- TODO: record the two-cursor collab demo with Playwright (from collab.spec.ts) into apps/web/public/landing-demo.webp and embed it here and on the landing page. -->

## Features

- Real-time collaborative editing (Monaco + Yjs) with presence and per-user undo
- In-browser Node runtime (WebContainers), xterm.js terminals, run/test, preview panel
- GitHub sign-in (full-page redirect, scope `read:user`) plus guest access for demos and shared links
- Templates (blank, React app, Node API, TypeScript library) and project import
- Share links with viewer/editor access
- Everything bundled locally: no CDN assets, cross-origin isolated (COOP/COEP)

## How it works

```
Browser (React SPA)                          Webcode server (one Node process)
 ├─ Monaco + y-monaco  ──┐                    ├─ HTTP API (auth, projects, sharing, import)
 ├─ Yjs doc + awareness ─┼── WebSocket ─────► ├─ Hocuspocus (Yjs sync + presence)
 ├─ WebContainer (Node)  │                    ├─ serves the built SPA (same origin)
 ├─ xterm.js terminals   │                    └─ Neon Postgres (users, projects, Yjs state)
 └─ preview iframe ◄─────┘ (WebContainer preview URL, separate origin)
```

One Node process serves the SPA, the API and the collaboration WebSocket on the same origin, so cookies stay simple and every response carries the cross-origin isolation headers WebContainers require. The server runs migrations on boot.

## Local development

Requirements: Node 22, pnpm 10.14, a local Postgres.

```sh
createdb webcode            # and webcode_test for the tests
pnpm install
# create .env with the keys below
pnpm dev                    # server + Vite
```

`.env` keys:

| Key | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string, e.g. `postgres://localhost:5432/webcode` |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret |
| `SESSION_SECRET` | Long random string used to sign cookies |
| `PUBLIC_URL` | Public origin, e.g. `http://localhost:5173` (callback: `$PUBLIC_URL/auth/github/callback`) |

Optional: `PORT` (default 8080), `WEB_DIST_DIR`, `TEMPLATES_DIR`. In production all five keys above are required.

Tests: `export DATABASE_URL_TEST=postgres://localhost:5432/webcode_test && pnpm test`. Also `pnpm typecheck`, `pnpm build`.

## Deploying (Fly.io + Neon)

The image runs the TypeScript server through `tsx` (the shared package is consumed as TS source, so a plain `tsc` build would need a bundler; `pnpm build` in the server is a typecheck).

1. GitHub: Settings, Developer settings, OAuth Apps, New. Callback URL `https://<app>.fly.dev/auth/github/callback`. Note the client ID and secret.
2. Neon: create a project and copy the pooled connection string.
3. Fly:

```sh
fly launch --no-deploy --copy-config      # pick your app name, keep fly.toml
fly secrets set \
  DATABASE_URL='postgres://...neon.tech/...?sslmode=require' \
  GITHUB_CLIENT_ID=... \
  GITHUB_CLIENT_SECRET=... \
  SESSION_SECRET="$(openssl rand -hex 32)" \
  PUBLIC_URL=https://<app>.fly.dev
fly deploy --ha=false                     # one machine only: collaboration state is in-process
fly scale count 1
curl -sI https://<app>.fly.dev/ | grep -i cross-origin
```

The expected result is both `cross-origin-opener-policy: same-origin` and `cross-origin-embedder-policy: require-corp`.

## Limits

2,000 files and 1 MB per file per project; 10 MB stored state per project; 20 projects per user; 10 creates/imports/copies per user per hour; 400 MB site-wide storage ("Webcode is full right now"); 20 simultaneous connections per project. Demo: one live copy per guest, 5 new copies per IP per hour, 300 live copies, deleted after 24 h idle. `node_modules`, `.git`, build output and binary files are never synced.

## WebContainers licence

Webcode uses StackBlitz WebContainers (`@webcontainer/api`). It is free for personal and portfolio use; commercial use needs a StackBlitz licence. See https://webcontainers.io/enterprise. WebContainers need a Chromium-based or recent Firefox/Safari browser with cross-origin isolation.
