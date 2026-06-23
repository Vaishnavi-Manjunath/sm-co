# Project Overview — Sri Murugan & Co Mandi Software ("IDNUK")

*A plain-English guide for the business owner. Written from the actual code in this
repository, not from assumptions. Every claim points at the file where it happens, so
a developer can verify it and you can ask precise questions.*

*Last written: June 2026. There is also an older business-focused `project-overview.md`
(lowercase) in the repo root — that one explains the trade and the data model; **this**
one explains the technology and how it all fits together.*

---

## 0. The 30-second mental model

You run **two small websites that share one address (`smand.co`) and one database**:

1. **A public homepage** at `smand.co/` — a brochure showing today's vegetable rates and
   an enquiry form. Anyone can see it.
2. **The staff app** at `smand.co/app/` — the real mandi software (purchases, sales,
   payments, reports). You must log in.

Both are built on your laptop into plain files, pushed to GitHub, and **GitHub
automatically copies them onto your Namecheap shared-hosting server**. The "brain"
(business logic) is a set of PHP files on that server that talk to a MySQL database.
There is no separate app server, no cloud platform, no container — it is a classic,
inexpensive **shared-hosting** setup, which is exactly why it is cheap and simple to run.

```
  Your laptop  ──push to GitHub──▶  GitHub Actions  ──FTP upload──▶  Namecheap server
   (write code)                     (builds + deploys)               (runs the live site)
```

---

## 1. Full inventory — every language, framework, library & service

### 1a. Languages

| Language | Where | What it does |
|---|---|---|
| **JavaScript (React/JSX)** | `frontend/src/**` | Everything you see and click in the browser — the staff app and the homepage. |
| **PHP 8** | `backend/api/**`, `backend/helpers/**`, `backend/config/**` | The server "brain": checks logins, reads/writes the database, calculates bills, returns data. |
| **SQL (MySQL dialect)** | embedded inside the PHP files | The actual database commands (create tables, insert bills, run reports). There is no separate `.sql` schema file for the live database — see §6. |
| **HTML** | `frontend/index.html`, `frontend/app.html` | The two "shells" the browser loads first; React fills in the rest. |
| **Python** | `scripts/build_import.py`, `scripts/build_bills_import.py` | One-off tools that converted your **old MS Access (`.mdb`) data** into the import files in `backend/data/`. Not part of the running site. |
| **Bash/YAML** | `.github/workflows/*.yml` | The deployment and monitoring automation (see §4). |

### 1b. Frameworks & build tools (the frontend)

| Thing | Version | File | What it does | 
|---|---|---|---|
| **React** | 18.2 | `frontend/package.json` | The library that builds the user interface out of reusable "components". |
| **React DOM** | 18.2 | `frontend/src/main.jsx`, `home.jsx` | Renders React into the actual web page. |
| **Vite** | 4.4 | `frontend/vite.config.js`, `vite.home.config.js` | The build tool. It turns the human-readable `src/` code into a few small, fast files for the browser. Also runs the local dev server. |
| **@vitejs/plugin-react** | 4.x | `frontend/package.json` | Lets Vite understand React's JSX syntax. |

**Notably absent (by deliberate choice):** there is **no CSS framework** (Tailwind/Bootstrap),
**no UI component library** (Material/Ant), **no router library**, and **no state-management
library** (Redux). All styling is written inline in the components; navigation is a simple
`page` variable in `frontend/src/App.jsx`; data is fetched with the browser's built-in
`fetch`. This keeps the dependency list to **two** runtime packages (React + React DOM),
which is rare and very low-maintenance.

### 1c. Backend (the server)

| Thing | File | What it does |
|---|---|---|
| **PHP, plain/procedural** | `backend/api/*.php` (19 files) | One file per area of the business (sales, purchase, parties…). No framework — each file handles its own URL. |
| **PDO (PHP's database driver)** | `backend/config/database.php` | The single, reusable connection to MySQL. Uses prepared statements (safe against SQL injection). |
| **Shared helper library** | `backend/helpers/api.php` | The shared rules every endpoint uses: login checks, permissions, the audit log, the Day Lock, bill numbering, JSON responses. The most important backend file. |

### 1d. Database

- **MySQL / MariaDB** on cPanel, database name `smanwefl_idnuk`, character set `utf8mb4`
  (so Tamil text stores correctly). Connection details live in `backend/config/database.php`.
- **~35 tables** (users, sessions, parties, products, sales_bills, sales_items, purchases,
  payments, audit_log, day_locks, app_settings, bill_sequences, and so on). The database is
  reachable **only from the server itself** (`localhost`) — it is not exposed to the internet.

### 1e. Third-party services

| Service | Where it's wired | What it does | If it's down |
|---|---|---|---|
| **Namecheap shared hosting (cPanel)** | the live server | Runs PHP + MySQL, serves the site. | The whole site is down. |
| **GitHub + GitHub Actions** | `.github/workflows/` | Stores the code and auto-deploys it. | You can't deploy, but the live site keeps running. |
| **Google Fonts** | `frontend/app.html` (Inter), `App.jsx` (Noto Sans Tamil), `PublicHome.jsx` (Space Grotesk) | Provides the on-screen fonts. | Text falls back to a system font; site still works. |
| **Sentry (error reporting)** | browser: script tag in `index.html`/`app.html`; server: `backend/helpers/sentry.php`, served by `backend/api/config.php` | Captures crashes so you can see what broke. **Currently inert** unless a Sentry key (DSN) is configured. | No effect on users. |
| **Google Input Tools** | allowed in the page's security policy (`app.html`) | Tamil typing assistance in some fields. | Tamil transliteration helper is unavailable. |

---

## 2. Architecture — how the pieces connect

```
        ┌──────────────────────────── THE BROWSER (staff laptop / phone) ───────────────────────────┐
        │                                                                                            │
        │   smand.co/            smand.co/app/              Service Worker (frontend/public/sw.js)    │
        │   Public homepage      Staff app (React)          caches the app so it loads instantly /    │
        │   (React, separate     - login, bills, reports    works offline; cache name "smco-v37"      │
        │    bundle)             - calls the API with fetch()                                         │
        └───────────────┬───────────────────────────┬────────────────────────────────────────────────┘
                        │ HTTPS                       │ HTTPS, every request carries a
                        │ (public pages)              │ "Authorization: Bearer <token>" header
                        ▼                             ▼
        ┌──────────────────────────── NAMECHEAP SERVER (cPanel shared hosting) ──────────────────────┐
        │                                                                                            │
        │   .htaccess (public_html.htaccess)  ── routes the URL:                                      │
        │     • a real file?  → serve it (the React files, images)                                    │
        │     • ends in .php?  → run it                                                               │
        │     • anything else → hand to React's index.html (so the app's own pages work)              │
        │                                                                                            │
        │   /api/*.php  (backend/api)         /helpers/api.php  (shared rules)                         │
        │     sales.php, purchase.php,   ───▶   requireAuth(), permissions, audit log,                 │
        │     reports.php, parties.php…         Day Lock, bill numbers, JSON replies                   │
        │                    │                                                                         │
        │                    ▼                                                                         │
        │   /config/database.php  ──▶  getDB()  ──▶   MySQL database  (smanwefl_idnuk, localhost only) │
        │   (holds the DB password; NOT in GitHub, lives only on the server — see §6)                 │
        └────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Key connection facts (verifiable):**

- The browser talks to the server **only** through `/api/...` URLs. The frontend helper that
  does this is `api()` in `frontend/src/App.jsx` (around line 501). It turns a short name like
  `"sales?action=save"` into the real URL `/api/sales.php?action=save` and attaches your login
  token.
- Every protected PHP endpoint starts the same way: `require_once .../helpers/api.php;` then
  `requireAuth();` (e.g. top of `backend/api/sales.php`). That single shared file enforces
  login, permissions, security headers, audit logging, and Day Lock for all of them.
- The database connection is a **singleton** — opened once per request and reused
  (`getDB()` in `backend/config/database.php`).
- The two frontends are **completely separate bundles** (two Vite configs). The homepage cannot
  break the staff app and vice-versa; "Staff Login" on the homepage is just a plain link to
  `/app/` (`frontend/src/home.jsx`).

---

## 3. One real request, click to response

Two traces: logging in, then saving a sales bill. These are the actual code paths.

### 3a. Logging in

1. **You type** username + password on the login screen and press Enter. React calls
   `api("auth?action=login", { method: "POST", body: ... })` — `frontend/src/App.jsx`
   (login handling around line 635).
2. **The browser** sends `POST https://smand.co/api/auth.php?action=login` with the username
   and password in the body.
3. **The server** runs `backend/api/auth.php`. It first checks for brute-force abuse: if there
   have been **8+ failed attempts in 15 minutes** from this IP or username (`login_attempts`
   table), it refuses with "Too many failed attempts" (HTTP 429).
4. It looks up the user and verifies the password with PHP's `password_verify` against the
   stored **bcrypt hash** (passwords are never stored in plain text).
5. On success it creates a **random 64-character token**, stores it in the `user_sessions`
   table with an **8-hour expiry**, and returns `{ token, user }`.
6. **The browser** saves the token in `sessionStorage` and remembers who you are
   (`frontend/src/App.jsx` ~line 635). Right after login it quietly pre-loads the heaviest
   screens (`warmUpAfterLogin()`, ~line 578) so the first click feels instant.

### 3b. Saving a sales bill

1. **You fill in** a sales bill and press Save. React calls
   `api("sales?action=save", { method: "POST", body: <the bill> })`.
2. **The browser** attaches your token (`Authorization: Bearer <token>`) and sends
   `POST /api/sales.php?action=save`.
3. **`backend/api/sales.php`** loads the shared helper and calls `requireAuth()`
   (`backend/helpers/api.php`). That one call:
   - validates your token against `user_sessions` (rejects with 401 if expired);
   - **slides your session forward** 8 hours so active users aren't logged out mid-shift;
   - checks **module permissions** — `enforceModuleWrite()` confirms your account is allowed
     to write through `sales.php` (admins bypass; staff need the `sales`/`payments`/`tally`
     module). If not, it returns 403.
   - ensures the audit and Day Lock tables exist.
4. The endpoint runs any **one-time schema migrations** (`migrateOnce('sales', 4, …)`) — it
   adds new columns/tables the first time a new version is deployed, then never again.
5. It checks the **Day Lock**: `assertDateUnlocked(<bill date>)`. If that business day has been
   closed/frozen, the save is rejected with HTTP 423 "Day is locked".
6. It generates the next **bill number** for the Indian financial year using `nextBillNo()`
   — an atomic counter in `bill_sequences` so two clerks saving at the same instant can never
   get the same number.
7. It writes the bill inside a **database transaction** (the bill header + each line item),
   records the change in the **audit log** (`auditLog()`), and commits.
8. It replies with `{ success: true, data: { ...the saved bill... } }`.
9. **The browser** shows the saved bill / print view and clears its cached lists so totals
   refresh (`clearApiCache()` in `App.jsx`).

If anything fails server-side, `respondServerError()` logs the real error (and sends it to
Sentry if configured) but returns only a **generic, safe message** to the screen — internal
details are never leaked to the user (`backend/helpers/api.php`).

---

## 4. Build & deployment — from your laptop to live

### 4a. What "build" means

Your `frontend/src` code is human-friendly but not browser-ready. **Vite** compiles it into a
handful of small, fingerprinted files. There are **two builds**, run in order by the
`build` script in `frontend/package.json`:

```
vite build -c vite.home.config.js   # 1) the public homepage  → frontend/dist/
vite build -c vite.config.js        # 2) the staff app        → frontend/dist/app/
node -e "...renameSync('dist/app/app.html','dist/app/index.html')"   # 3) rename so /app/ loads
```

The homepage build runs **first** because it clears `dist/`; the app build then adds the
`dist/app/` subfolder. The final rename makes the app load at `/app/`.

### 4b. The automatic pipeline (the normal way you ship)

Defined in **`.github/workflows/deploy.yml`**. The moment you **push to the `main` branch**:

1. GitHub spins up a fresh Linux machine.
2. Installs Node 20, runs `npm install` then `npm run build` in `frontend/`.
3. Installs **LFTP** and uploads over **encrypted FTPS** to the Namecheap server using three
   secrets stored in GitHub (`FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`):
   - `frontend/dist/` → web root `/`
   - `backend/api/` → `/api/`
   - `backend/helpers/` → `/helpers/`
   - `backend/data/` → `/data/`
4. Deletes a few known-obsolete files (`/api/upload.php`, test files, stray error logs).

**Important detail:** the upload is **"mirror, upload-only, never delete"**. New/changed files
are pushed; files that no longer exist locally are **left on the server**. This is safe for the
hashed JavaScript bundles but means truly removed files linger (see §6).

**What is NOT deployed:** `backend/config/database.php` is **not** uploaded (it's gitignored).
The live database password therefore lives **only on the server** (placed once by hand) and on
your laptop. The `frontend/dist/` folder is also gitignored — only the **source** is committed;
GitHub rebuilds it every time.

### 4c. How a URL finds the right file on the server

`public_html.htaccess` (Apache rules): if the URL is a real file or folder, serve it; if it
ends in `.php`, run it; otherwise hand it to React's `index.html` so the app's internal pages
(which aren't real files) still work. The staff app has its own `index.html` under `/app/`.

### 4d. The Service Worker (offline + instant loading)

`frontend/public/sw.js` caches the app shell in the browser. Its cache is named
`smco-v37`. **This version number must be bumped on every frontend change** or returning users
keep seeing the old version. The current discipline is to increment it (v35 → v36 → v37 …) with
each UI change — this is a manual step and a common foot-gun (see §6).

### 4e. Safety nets that run automatically

| Workflow | File | What it does |
|---|---|---|
| **Homepage monitor** | `.github/workflows/monitor.yml` | Every 30 min, loads `smand.co/` and `/app/` in a real headless Chrome (`scripts/smoke.mjs`) and emails you if either shows a white screen — catches crashes a simple "is it up?" check would miss. |
| **Security scan** | `.github/workflows/security-scan.yml` | Runs **Semgrep** static analysis on every push and weekly; reports possible vulnerabilities in the Actions log. Never blocks a deploy. |
| **Health check** | `backend/api/health.php` | A public URL that returns "ok" only if the database is reachable — point an uptime monitor here. |
| **Backups** | `backend/api/backup.php` | An admin (or a cPanel cron job with a secret key) can download/store a full database dump; keeps the most recent 14. |

---

## 5. Why each major technology was likely chosen — and the trade-offs

| Choice | Why it fits this business | The trade-off you accept |
|---|---|---|
| **Shared hosting + PHP + MySQL** (not a cloud platform) | Cheapest possible to run (a few dollars/month), no servers to manage, PHP/MySQL is ubiquitous and easy to hire for. Perfect for one shop. | No autoscaling, no separate staging server, the database is single and local. Harder to grow to many customers without the rework already planned (the separate "ODC-MARKET" multi-tenant project). |
| **React + Vite, only 2 dependencies** | A fast, modern, keyboard-driven interface (essential for entering hundreds of bills/day) with an extremely small dependency list — almost nothing can rot or introduce security holes. | You write more by hand (no ready-made UI kit). The app is one large JavaScript bundle (~640 KB) rather than code-split. |
| **Inline styles, no CSS framework** | Zero styling dependencies; every component is self-contained. | No global "theme" — changing a color everywhere means many edits. (This is why screen-wide changes like the recent text-size feature use a single CSS `zoom` lever instead.) |
| **Plain PHP, one file per area, no framework** | Dead-simple to read and debug; any PHP developer can follow it; works on any host. | No framework conveniences (routing, ORM, migrations) — those patterns are hand-built (e.g. `migrateOnce`). Logic is spread across large files. |
| **Token in a database table (not JWT)** | Simple, revocable (delete the row to log someone out), with sliding 8-hour sessions and brute-force lockout. | Every request does a small database lookup (negligible at this scale). |
| **Schema built in code via `migrateOnce`** | No manual database setup; deploy the code and the tables update themselves on first use. | There is **no single canonical schema file** for the live DB — the structure is scattered across endpoints (see §6). |
| **GitHub Actions → FTPS deploy** | Free, automatic, and matches what shared hosting offers (FTP). Push to `main` and it's live. | FTP "upload-only" leaves deleted files behind; secrets must be guarded; no automatic rollback (you redeploy a previous commit). |
| **Bilingual Tamil/English, financial-year bill numbers, Day Lock** | Matches exactly how a Tamil Nadu mandi actually operates and how auditors expect books to close. | More business logic to maintain; date handling must be precise. |

---

## 6. What you must understand to maintain it — and the fragile parts

### 6a. The handful of things that matter most

- **`backend/helpers/api.php` is the spine.** Login, permissions, audit log, Day Lock, bill
  numbering, and safe error handling all live here. A mistake in this one file affects every
  screen. Treat changes to it with extra care.
- **`backend/config/database.php` is the single key to the data.** It holds the database
  password in plain text, it is **not in GitHub**, and it is **not part of any deploy**. It
  exists only (a) on your laptop and (b) on the live server, where it was placed once by hand.
  **If the server copy is lost** (host migration, accidental delete), the site cannot reach the
  database until you recreate this file. Keep a secure copy of its contents somewhere safe.
- **Money is stored as exact decimals** in the database and computed in PHP. Never let bill or
  payment math drift into floating-point — keep using the `DECIMAL` columns and integer/decimal
  handling already in place.
- **The database self-heals its structure** via `migrateOnce(...)` calls at the top of each
  endpoint. To add a column or table, you add it inside that block and bump the small version
  number — the change applies on the next request after deploy.

### 6b. The fragile spots (where things break in practice)

1. **Forgetting to bump the Service Worker cache** (`frontend/public/sw.js`, `smco-vNN`).
   If you ship a frontend change without incrementing the number, returning staff keep seeing
   the **old app** until they hard-refresh. This is the #1 recurring gotcha.
2. **The "upload-only, never delete" deploy** (`deploy.yml`). Renamed or removed files **stay on
   the server**. Hashed bundle names make this mostly harmless, but if you rename a PHP endpoint
   the old one keeps working server-side and can cause confusion. Occasionally clean the server
   by hand.
3. **No central schema file for the live database.** The structure is assembled from
   `migrateOnce` blocks spread across `backend/api/*.php`. There is no one `schema.sql` to read
   to understand the whole database, and a migration that fails silently retries on the next
   request (logged, not surfaced). Rely on the **backups** (`backup.php`) as your real schema
   snapshot.
4. **Single database, single environment.** There is no separate test/staging database — changes
   are effectively validated against live data. The **Day Lock** (`day_locks` + `assertDateUnlocked`,
   HTTP 423) is your main guard against accidentally changing closed days; respect it.
5. **The build's final rename step** (`node -e "renameSync('dist/app/app.html', 'dist/app/index.html')"`
   in `package.json`). It's a small, order-dependent trick; if the homepage build stops emptying
   `dist/` or the file names change, this can fail and the app won't load at `/app/`.
6. **Secrets you must protect:** the GitHub Actions FTP secrets (`FTP_SERVER/USERNAME/PASSWORD`)
   and the contents of `config/database.php`. Anyone with these has full access to the site or
   the data. The login token expires in 8 hours; staff sessions live in `user_sessions` and can
   be revoked by deleting rows.
7. **Inline styling means no global theme.** App-wide visual changes can't be made in one CSS
   file; they're done either component-by-component or with a single shared lever (e.g. the
   `zoom`-based text-size control on the app shell). Budget accordingly for "change it
   everywhere" requests.

### 6c. Your routine maintenance checklist

- **To ship a change:** edit `frontend/src` and/or `backend/api`, **bump `sw.js`**, commit, push
  to `main`, watch the Actions tab go green. That's a deploy.
- **To add/disable a staff member:** Users/Admin screen (writes via `auth.php`); permissions are
  per-module and enforced on the server too.
- **To recover from a bad deploy:** re-push (or revert to) the previous commit — Actions
  redeploys it. There is no one-click rollback.
- **To protect the data:** keep automatic backups running (`backup.php` via cPanel cron),
  and keep a safe, offline copy of `config/database.php`'s contents.
- **If the site is white-screening:** check the Actions "Homepage monitor" email, hit
  `/api/health.php` to see if the database is the problem, and confirm the latest deploy
  succeeded.

---

*Where to look first, by question:* "How does login work?" → `backend/api/auth.php` +
`requireAuth()` in `helpers/api.php`. "How is a bill saved?" → `backend/api/sales.php` /
`purchase.php`. "How does it get deployed?" → `.github/workflows/deploy.yml`. "What does the
browser call the server with?" → `api()` in `frontend/src/App.jsx`. "Where are the database
credentials?" → `backend/config/database.php` (server + laptop only).
