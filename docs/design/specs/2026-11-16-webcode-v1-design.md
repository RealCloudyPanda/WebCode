# Webcode v1: design

Date: 2026-11-16
Status: reviewed by a builder check; awaiting owner approval
Repo: `RealCloudyPanda/WebCode` (empty at time of writing)

## 1. What this is and why

Webcode is "Google Docs for coding". You open a real software project in the browser, work on it alone, or send someone a link so you can code together. Nobody installs an editor to join.

**Why it exists:** it is a **portfolio piece**. That sets the priorities:

- Someone (a recruiter, a friend) clicks a link and is inside a working project within seconds. No install, no sign-up wall for people you share with.
- It costs close to nothing to keep online, and it is always on (no "server is waking up" screens during a demo).
- Strangers clicking links cannot use it to run code on the owner's servers.
- It looks polished: a **dark-theme take on the Google Docs interface**, with Webcode's own name and logo.

## 2. Goals, non-goals, anti-goals

### Goals (v1)

1. **Code solo:** sign in with GitHub, create a project from a template or import a public GitHub repo, edit it, come back later and find it as you left it.
2. **Share a link:** a Docs-style Share dialog sets link access (restricted, anyone with the link can view, anyone with the link can edit).
3. **Code together:** several people edit the same file at once. Edits, cursors, and selections appear in real time. Everyone navigates the project independently (own open tabs, own scroll position).
4. **Run it:** install dependencies, run the app, and run the tests from the browser. Code runs in each visitor's own browser.

### Non-goals (v1; may come later)

- Coding agents working together (the "Agents" feature). No Agents menu in v1.
- Code battles.
- Comments, suggestions mode, version history.
- Languages other than JavaScript/TypeScript on Node (the runtime only supports Node).
- Private GitHub repos, pushing back to GitHub, git inside Webcode.
- Inviting specific people by name/email (sharing is link-based only).
- Mobile and tablet layouts. Desktop browsers only.
- A shared terminal (each person has their own; see §5.4).
- Binary files (images, fonts) in projects.

### Anti-goals (would make v1 a failure even if it technically works)

- A demo link that is broken, asleep, or slow to start when someone clicks it.
- Anyone with a link being able to run code on Webcode's servers.
- Looking like a Google clone: no Google name, logos, or product icons. The *layout and feel* follow Docs; the brand is Webcode's.

## 3. Approaches considered

Live co-editing is the same in every option: Monaco editor + Yjs (CRDT) + a small sync server. The options differ in **where project code runs**.

| Approach | Trade-offs |
|---|---|
| **A. In each visitor's browser (WebContainers)** — chosen | Near-free hosting, no server-side code execution risk, instant start, impressive demo. Limited to JS/TS on Node; each person has their own terminal; best in Chromium browsers; free for personal/portfolio use, commercial use needs a StackBlitz licence (`configureAPIKey`). |
| B. Containers on Webcode's server (Docker on e.g. Fly.io) | Any language, one shared terminal. Costs money per running project, cold starts of several seconds, and must be hardened because anyone with a link runs code on the owner's machine. |
| C. Rented sandboxes (E2B, CodeSandbox SDK) | Any language without managing servers. Free tiers run out, so the demo could break under use; dependency on a third party. |

**Owner picked A** because it is the only option that is free to keep online, safe against strangers, and instant for whoever clicks the link. JS/TS-only is acceptable scope for v1.

**Sign-in, owner picked "GitHub + guests"** over "no accounts": owners sign in with GitHub so projects follow them across devices and "Import from GitHub" works; people opening a shared link can join as a guest with only a display name.

**Database, owner picked Neon** (hosted Postgres).

## 4. What the user sees

Approved mockups: [`assets/2026-11-16-webcode-mockups.html`](assets/2026-11-16-webcode-mockups.html). Section 1 is the home screen; **layout A ("Docs-faithful") is the chosen workspace**. Layout B in the same file was rejected.

### 4.1 Visual language

- Dark theme throughout. Palette (from the mockups): page `#1b1b1d`, surfaces `#26272a` / `#2f3034`, borders `#3a3b3f`, text `#e3e3e3`, muted text `#a6a8ab`, accent blue `#8ab4f8` with dark ink `#0b2a5c` on blue buttons, success green `#81c995`.
- Docs-like shapes: pill-shaped search bar and toolbar, rounded-pill blue **Share** button, circular avatars, card grid on the home page.
- Logo: a light-blue document shape containing `</>`, next to the word "Webcode".
- Collaborator colours: each person in a project gets a distinct colour used for their avatar ring, cursor, name flag, selection highlight, and the dot next to the file they are in.

### 4.2 Home screen (`/`) — signed in

Top bar: menu icon, logo + "Webcode", centred pill search ("Search projects", filters the list by title), the user's avatar (menu: sign out).

**Start a new project** band, five tiles: Blank, React app (Vite + TypeScript), Node API (Express), TS library (with Vitest tests), Import (from GitHub). Clicking a template creates the project and opens it. Import asks for a public repo URL (`owner/repo` or full URL, optional branch).

**Recent projects** grid: one card per project the user owns or has opened via a link. Card = code preview (first lines of the project's README or main file), title, and either "● N here now" (green, live count of people currently connected) or the last-opened date, plus a "Shared" marker for projects owned by someone else. Filter: Owned by anyone / Owned by me / Shared with me. Sort: last opened (default) or title. Card menu (⋮): Rename, Remove (owner: delete project after a confirm; non-owner: remove from my list), Open in new tab.

### 4.2a Home screen (`/`) — signed out, and the demo

This is what the README's "live demo" link opens, so it is the first thing a recruiter sees.

- Same dark top bar (logo + "Webcode"), with "Sign in with GitHub" on the right.
- A short hero: one line on what Webcode is ("Google Docs for coding: open a project, share a link, edit and run it together"), a screenshot or looping GIF of two cursors editing, and two buttons: **Try the demo** (primary, blue pill) and **Sign in with GitHub**.
- A footer line linking the GitHub repo.

**Try the demo** *(owner's choice: a fresh copy per visitor)*:

1. If the visitor has no guest identity yet, ask for a display name (same dialog as §4.5, pre-filled if known).
2. Create a **demo copy** of the demo project for this guest and open it. The demo project is a small, fast-installing TS app with a visible UI and passing tests (builder picks the content; e.g. the todo app from the mockups).
3. The guest owns the copy: they can edit, run, and open Share to send a link to a friend (default link access for demo copies: Editor, so the friend can type immediately).
4. A slim banner in the workspace: "This is your demo copy. It's deleted after 24 hours of inactivity. **Sign in with GitHub to keep it.**" Signing in from the banner transfers ownership of the copy to the new account and removes the expiry.
5. A guest who clicks "Try the demo" again while their copy still exists is sent back to that copy instead of getting another one. A "Start over" item in the banner makes a fresh copy and deletes the old one.

Nobody can damage anyone else's demo, because every visitor gets their own.

### 4.3 Workspace (`/p/:projectId`) — layout A

**Title row:** logo (links home), editable project title (owner/editors), ☆ star (adds to starred, shown first on home), sync status ("Saving…", "Saved", "Offline – changes will sync when you reconnect"), live avatars of everyone connected (hover shows name; clicking jumps to the file they are in), the blue **Share** button, and the user's own avatar (or "Sign in" for guests).

**Menu row:** File, Edit, View, Run, Terminal, Help.

- File: New file, New folder, Rename, Delete, Make a copy (signed-in users only; copies into their projects), Download as .zip, Share.
- Edit: Undo, Redo, Find, Replace, Find in files.
- View: Toggle file explorer, Toggle terminal, Toggle preview, Show/hide others' cursors.
- Run: Run app, Run tests, Stop, Reinstall dependencies.
- Terminal: New terminal, Clear.
- Help: Keyboard shortcuts, About Webcode (links to the GitHub repo).

**Toolbar (rounded pill):** Undo, Redo | ▶ Run, ✓ Test | Format, language indicator | Search | mode dropdown on the right ("Editing" / "Viewing"; viewers see only "Viewing").

**Body:**

- Left: file explorer tree. A coloured dot next to a file shows who is in it.
- Centre: editor tabs (per user, not shared) and the Monaco editor. Other people's cursors show as a coloured caret with a name flag; their selections as a translucent highlight in their colour.
- Bottom: terminal panel (xterm.js) with tabs: "Shell", plus "Run" / "Test" tabs created by the buttons. A label reads "Terminal · runs in your browser".
- Right (hidden until needed): preview panel. Opens automatically when the running app starts a server; shows the app in an iframe with a URL bar and an "open in new tab" button. Closable; reopen from View.

### 4.4 Share dialog

Modelled on the Docs share dialog:

- Title "Share "<project title>"".
- **General access:** "Restricted — only you can open this link" / "Anyone with the link" with a role dropdown: **Viewer** or **Editor**.
- **People with access:** the owner, plus signed-in people who have opened the project via the link (name, avatar, role badge), plus a line like "and 3 guests". The list is informational only: access comes from the link setting, so there is no per-person remove in v1. To cut people off, the owner sets access to Restricted. *(Builder-check call: per-person removal would be cosmetic without per-person roles, so it was dropped.)*
- "Copy link" button and "Done".
- Only the owner can change access. Others see the dialog read-only with "Copy link".

### 4.5 Opening a shared link

- Signed in: opens straight away; the project is added to their "Shared with me" list.
- Signed out: a small dark dialog over a blurred workspace: "Join as guest" with a name field (pre-filled from the last name used on this browser), or "Sign in with GitHub". Guests get a random collaborator colour.
- Link restricted (or no access): "You need access" page with a "Sign in with a different account" option. No request-access flow in v1.

## 5. How it works

### 5.1 Architecture

```
Browser (React SPA)                          Webcode server (one Node process)
 ├─ Monaco + y-monaco  ──┐                    ├─ HTTP API (auth, projects, sharing, import)
 ├─ Yjs doc + awareness ─┼── WebSocket ─────► ├─ Hocuspocus (Yjs sync + presence)
 ├─ WebContainer (Node)  │                    ├─ serves the built SPA (same origin)
 ├─ xterm.js terminals   │                    └─ Neon Postgres (users, projects, Yjs state)
 └─ preview iframe ◄─────┘ (WebContainer preview URL, separate origin)
```

- **Frontend:** React + Vite + TypeScript SPA. Monaco bundled locally (no CDN), `y-monaco` binding, `@hocuspocus/provider`, `@webcontainer/api`, `xterm.js`.
- **Server:** one Node process serving the SPA, the HTTP API, and Hocuspocus on the same origin. Same origin keeps cookies simple and keeps every subresource covered by the cross-origin isolation headers (§5.5).
- **Database:** Neon Postgres.
- **Hosting:** one small always-on container (no sleeping free tier). Target ≤ ~$5/month total.

### 5.2 Project data in Yjs

One Yjs document per project, named by project ID:

- `files: Y.Map<path, Y.Text>` — every text file, keyed by its POSIX path from the project root (`src/todos.ts`).
- `dirs: Y.Map<path, true>` — explicit folders, so empty folders survive.
- `meta: Y.Map` — project title (so renames show live).

Create / delete / rename are map operations. Rename = copy content to the new key and delete the old one (a concurrent edit to the old path during a rename can be lost; acceptable for v1).

**Awareness (presence)** per connection: `{ user: { id, name, color, kind: 'github' | 'guest' }, file, cursor, selection }`. Drives avatars, explorer dots, cursors, and the "here now" count.

**Undo/redo** is per user (Yjs `UndoManager` scoped to the local client's changes).

### 5.3 Running code: WebContainer ↔ Yjs sync

Each browser boots one WebContainer (only one instance per page is allowed) and mounts the project files into it. Nothing in `node_modules` is ever stored or synced: each browser installs its own.

- **Yjs → container:** any change to a file in Yjs (from anyone) is written to the container's file system, debounced ~150 ms per file. Deletes and renames are applied too.
- **Container → Yjs:** a recursive file watcher on the container picks up files changed by commands (e.g. `npm install lodash` edits `package.json`; a code generator writes files). Changes are pushed back into Yjs **only for users with edit access**, applied as a minimal text diff. Echo suppression: remember the last content written per path, and ignore watcher events that match it.
- **Never synced (local only):** `node_modules/`, `.git/`, `dist/`, `build/`, `coverage/`, `.next/`, `.cache/`, `.vite/`, any file over 1 MB, and binary files.
- **Lockfiles** (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`) are synced, but container → Yjs replaces the whole content instead of diffing, so two people installing at once cannot interleave into a broken lockfile (last writer wins).
- **Viewers** can still run the app and tests in their own browser. Their container changes stay local, and a banner says so.

**Run / Test buttons:**

- As soon as a project opens, the browser boots the container and starts `npm install` in the background (shown in the "Run" terminal tab, with a small "Installing dependencies…" indicator on the toolbar). Run or Test pressed before it finishes waits for it. Goal: the editor is usable within a couple of seconds, and Run/Test are ready shortly after. Templates keep dependencies small so this is fast.
- Run = `npm run dev` if the script exists, else `npm start`. Test = `npm test`. Missing script → a clear message in the terminal.
- Stop kills the running process. Run again restarts it.
- When a process opens a server (WebContainer `server-ready` event), the preview panel opens on that URL.

**Unsupported browsers:** if WebContainer fails to boot (e.g. Safari without the needed features), editing and collaboration still work; Run/Test/terminal show "Running code needs a Chromium-based browser (Chrome, Edge, Arc, Brave) or Firefox".

### 5.4 Terminal

Each person gets their own `jsh` shell in their own container. Terminals are **not** shared: Alice running `npm test` does not show in Bob's terminal. The panel label says "runs in your browser" so this is expected.

### 5.5 Cross-origin isolation (required by WebContainers)

Every page response sets:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Consequences the builder must handle:

- Every subresource must be same-origin or send CORP/CORS headers: bundle Monaco, fonts, and icons into the build. Do not load from CDNs.
- GitHub avatars come from another origin: proxy them through the server (`/api/avatar/:userId`, cached) rather than hot-linking.
- GitHub OAuth uses a full-page redirect, not a popup (COOP would break popup communication).

### 5.6 Accounts, guests, and access

- **GitHub OAuth App**, minimal scope (`read:user`). On first sign-in, create a `users` row (GitHub id, login, display name, avatar URL).
- **Session:** random session ID in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie, backed by a `sessions` table. 30-day expiry, renewed on use.
- **Guests:** joining as a guest sets a signed guest cookie (random guest ID + display name). The only thing a guest can create is their single demo copy (§4.2a). They cannot create, copy, or import other projects, and have no home page (visiting `/` shows the signed-out page).
- **Project IDs** are long random strings (≥ 128 bits), so a link cannot be guessed. Access to `/p/:id` and its WebSocket is decided by: owner → full; else link access = Editor → edit; Viewer → view; Restricted → denied. Switching to Restricted cuts off everyone else, including people already connected (server closes their connections).
- **WebSocket auth:** Hocuspocus `onAuthenticate` reads the session or guest cookie from the upgrade request, checks access, and sets the connection read-only for viewers (the server then rejects their updates).
- **State-changing HTTP endpoints** check the `Origin` header and require JSON bodies (CSRF protection on top of SameSite).

### 5.7 Data model (Neon Postgres)

- `users` (id, github_id unique, login, name, avatar_url, created_at)
- `sessions` (id, user_id, expires_at)
- `projects` (id, owner_id nullable, owner_guest_id nullable — exactly one is set, title, link_access: `restricted` | `viewer` | `editor`, template, is_demo_copy, expires_at nullable, last_active_at, preview_text, created_at, updated_at)
- `project_members` (project_id, user_id, last_opened_at, starred) — drives Recent, Shared with me, star, and the share dialog's people list. Owners get a row too.
- `project_docs` (project_id, yjs_state bytea, updated_at) — written by the Hocuspocus Database extension (debounced; e.g. 2 s, max 10 s).

`preview_text` (for home cards) is refreshed when the doc is stored.

### 5.8 Templates and import

- Templates are stored as file trees in the server repo and copied into a new Yjs doc on create. Each must run with `npm install && npm run dev` / `npm test` inside a WebContainer, and the TS library template ships with passing tests.
- **Import from GitHub (public repos):** the server downloads the repo tarball through the GitHub API, drops ignored and binary paths, enforces limits, and seeds the Yjs doc. Errors are shown plainly: not found / private, too large, no text files.

### 5.9 Limits (abuse and cost)

Sign-in is open to any GitHub user. Limits keep storage inside Neon's free plan:

- Per project: ≤ 2,000 files, ≤ 1 MB per file, ≤ 10 MB stored size (the encoded Yjs state, which is what goes in `project_docs`).
- Per user: ≤ 20 projects; ≤ 10 creates/imports per hour.
- Site-wide: when total stored size passes 400 MB, new projects, copies, and imports are refused with "Webcode is full right now"; existing projects keep working.
- Per project: ≤ 20 simultaneous connections.
- Demo copies: one live copy per guest; ≤ 5 new demo copies per IP address per hour; ≤ 300 live demo copies site-wide (beyond that, "Try the demo" shows "The demo is busy, try again in a few minutes"). A cleanup job runs at least hourly and deletes demo copies whose `last_active_at` is over 24 hours old and that nobody has claimed by signing in. `last_active_at` is updated when anyone connects or edits.
- Apart from demo copies, guests cannot create anything, so the only way to add data is to be a signed-in GitHub user or an editor on someone's project.

Where limits are checked *(builder-check call)*:

- Create, copy, and import check file count, file size, and project size up front.
- Live edits: the editor and the container → Yjs sync refuse to put a file over 1 MB into Yjs (the user sees a toast). The server measures the stored size each time it saves; if a project goes over 10 MB, the server makes every connection read-only except the owner's and shows a banner ("This project is over its size limit. The owner needs to delete files."). Changes are never refused after a client has applied them, so copies never fall out of step.
- Yjs garbage collection stays on (the default), so deleted text does not keep growing the stored state. Undo history lives only in each browser and is not stored.

## 6. Error and edge cases

- **Offline / reconnect:** edits keep working locally and sync on reconnect (Yjs handles merging). The status reads "Offline – changes will sync when you reconnect".
- **Project deleted while open:** connected users see "This project was deleted" and are sent home.
- **Access revoked while open:** "You no longer have access" and the editor locks.
- **Viewer types:** editor is read-only; a toast says "You have view access".
- **Server restart:** clients reconnect automatically; at most the last debounce window of unsaved state is replayed from connected clients (Yjs re-sync).
- **Two people create the same file path at once:** last write to the map key wins; acceptable for v1.

## 7. Testing

- Unit tests (Vitest) for: path/ignore rules, the container ↔ Yjs sync (including echo suppression and lockfile replace), access decisions, limits, import filtering.
- Server tests against a real Postgres (Neon branch or local Postgres in CI).
- End-to-end (Playwright, Chromium): two browser contexts open the same project; one types and the other sees the text and the cursor; viewer cannot edit; Run Test passes on the TS library template; share access changes take effect live.
- Manual check before calling v1 done: the four templates run in Chrome; the link flow works for a guest in a private window.

## 8. Deployment

- Single Docker image: builds the SPA, runs the Node server.
- Environment: `DATABASE_URL` (Neon), `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`, `PUBLIC_URL`.
- Hosting: an always-on container on a small paid instance. **Builder's call between Fly.io, Railway, or similar**, within ~$5/month and no sleep.
- Database: Neon's free plan (not part of the $5). Its compute suspends after a few idle minutes and the first query afterwards is slower; that is accepted *(builder-check call)*. To keep it from showing: the server keeps open projects in memory (Hocuspocus does this while anyone is connected), and the page shell and editor render before project data arrives. No keep-alive pings. Check Neon's current free-plan storage and suspend rules before launch.
- Database migrations run on deploy.

## 9. Repo conventions

- Commits are authored by **RealCloudyPanda** only.
- README explains what Webcode is, links the live demo, and shows a screenshot or GIF of two people editing.

## 10. Left to the builder

- Monorepo layout and package manager.
- HTTP framework for the API.
- Exact Monaco theme colours beyond the palette in §4.1, icon set, font choice (self-hosted).
- Hosting provider within §8's constraints.
- Exact debounce values, as long as the behaviour in §5.3 and §5.7 holds.
