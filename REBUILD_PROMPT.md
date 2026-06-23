# MASTER BUILD PROMPT — "IDNUK Software" Mandi Management System

> A single, self-contained specification that any capable AI coding agent can use to
> rebuild this application from zero. Copy everything below the line and hand it to the agent.

---

## ROLE & GOAL

You are building a complete, production-ready **vegetable commission-agent (mandi / aratiya) management system** for a real business — **Sri Murugan & Co**, a wholesale vegetable commission agent operating inside Gandhi Market, Oddanchatram (Dindigul district, Tamil Nadu, India). The app brand name shown to users is **"IDNUK Software"** with the tagline *"Powered for Oddanchatram Market by IDNUK Software"*.

The software replaces a legacy MS Access (`.mdb`) desktop system. It must be **multi-user, networked, keyboard-driven, and bilingual (Tamil + English)**. Build the entire thing: database, backend API, frontend SPA, public marketing site, deployment pipeline, and operational docs.

## BUSINESS CONTEXT (read carefully — every rule flows from this)

The firm sits **between farmers and buyers**:

- **Farmers** (and the *vandi* / trucks / agents who bring their produce) deliver vegetables to the yard. The firm sells the produce on their behalf and pays them the proceeds **minus deductions**: commission, loading coolie, market tax (*sungam*), lorry freight, and any cash advances (*sakku*). → these are **Purchase Bills** (money we owe farmers).
- **Vendors / customers** buy the produce, usually in bulk and often on running credit, and settle dues over time. → these are **Sales Bills** (money vendors owe us).

The firm earns from **commission (~10%)** plus small service charges. The motto printed on bills: *வாணிபமே கோயில், வாடிக்கையாளரே தெய்வம்* ("Business is the temple, the customer is God").

**Integrity boundary (hard requirement):** The system must produce **accurate, complete, auditable** financial reporting. Do NOT build any feature to hide income/profit, run dual books, or falsify figures. Build honest reporting only.

## TECHNOLOGY STACK (use exactly this — it targets cheap shared cPanel hosting)

| Layer | Technology |
|---|---|
| **Frontend** | **React 18** SPA built with **Vite 4**, plain JavaScript (JSX), **no UI framework**, inline styles throughout. |
| **Backend** | **PHP 8** (procedural, no framework). One file per module under `/api`, each returns JSON. PDO + MySQL. |
| **Database** | **MySQL** (utf8mb4), localhost-only (not internet-reachable). |
| **Hosting** | Namecheap shared cPanel. |
| **Auth** | Custom bearer-token sessions, bcrypt password hashing. |
| **Deploy** | GitHub Actions: build the frontend, then **LFTP mirror (upload-only, never delete)** over FTPS to cPanel. Push to `main` = deploy. |
| **PWA** | Installable (Add to Home Screen) with a service worker + manifest. |

**Request flow:** Browser (React) → `/api/*.php` → MySQL → JSON. The React build is served as static files from web root; PHP APIs live in `/api`, shared helpers in `/helpers`, seed/import data in `/data`.

**Two separate frontend bundles:**
1. The **public marketing homepage** → built into the dist **root** (`/`).
2. The **staff app SPA** → built with `base: '/app/'` into `/app/` (separate bundle, served at `/app/`).
Configure Vite with two config files so a single `npm run build` produces both; rename the app's `app.html` output to `index.html`.

## CONVENTIONS (follow throughout)

- **Bilingual data:** every party and product stores both an English name/code and a Tamil name. Bills print in Tamil. Use a Google-transliteration helper on master-data forms so staff can type Tamil phonetically.
- **API response shape:** success → `{"success":true,"data":...}` (lists add `"total"`); error → `{"success":false,"error":"message"}` with proper HTTP status.
- **Keyboard-first billing:** Enter/Tab move between cells and add the next line; minimal mouse. Type-to-filter searchable dropdowns that scroll the focused option into view. Highlight the focused cell. Warn on navigating away with unsaved changes.
- **Currency:** Indian Rupees. Round commission and net payable to **whole rupees, half-up**.
- **Money never silently lost:** every payment/discount/adjustment is reversible via an explicit **void/delete** that writes to the audit log.

---

## DATABASE — CORE TABLES

Build these (utf8mb4 / `utf8mb4_unicode_ci`). Endpoints may self-create tables on first use via a versioned `migrateOnce(key, version, fn)` pattern that records `schemav_<key>` in `app_settings` and skips the DDL once applied (so DDL doesn't run on every request).

**Masters**
- `party_categories` — farmer, supplier, customer/vendor, market vendor, truck.
- `parties` — id, category_id, name_en, name_ta, village/city, phone, opening_balance, commission_pct, truck linkage. (`party_truck_links` maps farmers↔trucks; support bulk-mapping farmers to a truck.)
- `cities` — master list of towns/villages.
- `product_categories`, `products` — id, code_en, name_ta, category_id, **unit_type ENUM('KG','BAG')**, default rate.

**Yard → Purchase → Sales pipeline**
- `yard_entries` — produce arrivals per truck/reference before billing; per-farmer freight (auto = net weight × `freight_per_kg`, default 0.5, or manual).
- `yard_allocations` — staging of yard produce sold to a vendor (no auto weight deduction).
- `purchase_bills` (farmer bills) + `purchase_items`.
- `sales_bills` (vendor bills) + `sales_items` + `sales_staged_items` (for Bill-by-Product staging).

**Money**
- `ledger` — running ledger entries.
- `payments_received` + `payment_allocations` (collections from vendors, allocated oldest-first).
- `farmer_payouts` — payouts to farmers (with pay mode + reference).
- `daily_expenses` — categorised petty-cash/running expenses.

**Market trading**
- `market_purchases` — buying from other agents to fill customer orders.
- `market_settlements` — weekly settlement/netting; per-vendor discount %.

**Settings / ops / auth**
- `app_settings` (skey PK, sval MEDIUMTEXT) — holds `business_date`, `business_rules` (JSON), `print_template` (JSON), brand logo, schema versions.
- `bill_sequences` (seq_key PK, last_no) — atomic bill numbering.
- `day_locks` (lock_date PK, locked_by, locked_at, note).
- `audit_log` — append-only: ts, user_id, username, action, entity, entity_id, label, details(JSON), ip; indexed by ts/entity/user.
- `users` (username, bcrypt password_hash, full_name, role ENUM('admin','staff'), permissions JSON array of module ids, is_active).
- `user_sessions` (token PK/unique, user_id, expires_at).
- `login_attempts` — per-IP failed-login tracking for lockout.
- `daily_rates`, `enquiries` — for the public site.

**Reporting views** — `vw_vendor_outstanding`, `vw_daily_pnl`, `vw_product_profit`.

---

## BACKEND — SHARED HELPERS (`/helpers/api.php`)

Every endpoint `require_once`s this. Implement:

- **CORS:** echo `Access-Control-Allow-Origin` back **only** when the request Origin host equals our own host (or localhost in dev). Handle `OPTIONS` preflight.
- **Security headers:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security: max-age=31536000`.
- **Response helpers:** `respond(data, code)`, `respondError(msg, code)`, `respondList(rows, total)`, `respondServerError(context, e)` (logs real exception + Sentry, returns a generic message — never leak internals).
- **`getBody()` / `getParam()`** input helpers.
- **`requireAuth()`** — validate `Authorization: Bearer <token>` against `user_sessions` JOIN `users` (active, unexpired). **Sliding session:** roll `expires_at` forward to NOW()+8h, but only write when <7h45m remains (≤1 cheap UPDATE per 15 min). Decode permissions JSON; stash user for auditing; ensure audit + day-lock tables; enforce module permissions.
- **`enforceModuleWrite(user)`** — admins bypass. For staff, **writes (POST/PUT/DELETE)** require the user to hold one of the modules mapped to that endpoint file (e.g. `purchase.php` → `['purchase','payments','tally','yard']`). Reads stay open to any logged-in user (billing screens cross-load reference data). So permissions are enforced server-side, not just in the sidebar.
- **`auditLog(action, entity, id, label, details)`** — append to `audit_log`; never throws (logging must never break the operation); write ts from PHP for timezone consistency.
- **Day lock:** `isDayLocked(date)` (cached), `assertDateUnlocked(...dates)` → rejects with **HTTP 423** if any date is locked. Call it at **every dated write** (create/edit/delete of bills, payments, expenses, etc.).
- **`businessDate()`** — the working/business date new entries default to (from `app_settings.business_date`, fallback today).
- **`businessRules()`** with `defaultBusinessRules()`:
  ```
  commission_pct   = 10    // default commission % on purchase bills
  credit_days      = 14    // default vendor credit days
  freight_per_kg   = 0.5   // yard auto freight = net weight × this
  coolie_bag_zero  = 5     // coolie ₹/bag for bag-priced items (no weighing)
  coolie_bag_small = 3     // coolie ₹/bag up to coolie_small_max kg
  coolie_bag_large = 5     // coolie ₹/bag above coolie_small_max kg
  coolie_small_max = 30    // slab boundary (kg)
  ```
  Admin-configurable (stored as JSON in `app_settings.business_rules`).
- **`nextBillNo(prefix, date)`** — bill numbers on the **Indian financial year (Apr 1 – Mar 31)**, restart at 1 each April 1, FY derived from the **bill's date** not today (matters for back-dating). Format `PUR-2026-27-00001`. Make it **atomic** using `INSERT ... ON DUPLICATE KEY UPDATE last_no = LAST_INSERT_ID(last_no+1)` so simultaneous clerks never collide. Seed FY sequence from the prior calendar-year sequence on first switch.
- **`waPhone()`** (normalise Indian numbers to `91` + last 10 digits for wa.me links), **`companyTpl()`** (letterhead values from editable print template with fallbacks), **`baseUrl()`**.
- **Sentry** (`/helpers/sentry.php`) — inert unless `SENTRY_DSN_PHP` configured.

**DB config** lives in a **git-ignored** `backend/config/database.php` returning a PDO connection (utf8mb4). Never commit credentials.

---

## BACKEND — API ENDPOINTS (one PHP file per module under `/api`)

- `auth.php` — login (bcrypt verify), logout, session check; **brute-force lockout** via `login_attempts` per IP.
- `parties.php` — CRUD parties + categories + cities + trucks; bulk farmer→truck mapping; party ledger.
- `products.php` — CRUD products + categories; Tamil veg-name dictionary; unit_type.
- `yard.php` — yard entries + per-farmer freight + allocations (sell-to-vendor staging, no auto deduction).
- `purchase.php` — create/edit/delete purchase (farmer) bills, items, coolie/commission calc, cash advance, freight, sungam, damage; print payload.
- `sales.php` — sales (vendor) bills in **two modes** (Bill by Vendor / Bill by Product staging); pending queue from yard + staged; carry vendor's previous outstanding; respect product `unit_type`.
- `market.php` — market purchases + settlements + vendor discount %.
- `tally.php` — Day Book (daily cash journal): opening → collections/payouts/expenses/market → closing (cash & bank); quick entries.
- `reports.php` — Tally Sheet (purchases vs sales / P&L), product profit, vendor outstanding with aging, party ledger, **Tally ERP XML export**; expenses.
- `billview.php` — View Bills: date-range + party + product + reference filters, sortable, serial #, totals row (gross/commission/net), printed-count flag, per-bill product rate & weight when filtered by product.
- `settings.php` — editable print template, business rules, working date.
- `daylock.php` — set working date; freeze/unfreeze (admin-only) business days.
- `audit.php` — read audit trail (who changed what, when, old→new values).
- `backup.php` — admin one-click `.sql` download.
- `health.php` — health check.
- `admin.php` — users & permissions, brand logo upload, **legacy .mdb import / clean-restore** (idempotent, reversible), opening-balance imports.
- `marketing.php` — admin: publish daily rates, read enquiries.
- `public.php` — **the only unauthenticated endpoint.** Reads published daily rates + writes website enquiries only (honeypot + per-IP rate limiting). It must **never** touch bills/parties/ledger.

---

## CORE BUSINESS RULES (implement precisely)

**Purchase bill (farmer), keyboard flow:** farmer → product → per-bag weights → rate.
- **Coolie** (loading charge): ₹`coolie_bag_zero` per bag if bag-priced (no weighing); else ₹`coolie_bag_small` per bag for 1–`coolie_small_max` kg, ₹`coolie_bag_large` per bag above that.
- **Commission %** defaults from business rules / party; applied to gross.
- Support **cash advance (sakku)**, **freight (lorry rent)**, **sungam (market tax)**, and a **damage** deduction (damaged weight is **subtracted from billed weight**, not billed separately; print shows "Damage = N kg" and individual bag weights under the product).
- **Net payable = gross − commission − coolie − sakku − freight.** Round commission and net payable to whole rupees, half-up.

**Sales bill (vendor):** two modes —
1. *Bill by Vendor* — one vendor, many products.
2. *Bill by Product* — one product staged across many vendors, then combined into one bill per vendor per day.
- Respect product `unit_type`: **BAG → bags × rate; KG → weight × rate.**
- Carry the vendor's **previous outstanding** onto the bill.
- Warn when a vendor's product is entered via **both** Yard allocation and Bill-by-Product (double-entry guard).

**Payments:** collections from vendors allocated **oldest-first**; payouts to farmers carry pay mode + reference. Both reversible (void writes to audit + reverses ledger).

**Day Book (Tally):** opening → collections / payouts / expenses / market → closing (cash & bank). Quick entries: Collect, Pay Farmer, **Pay Old Farmer Bills** (ad-hoc no-bill payout for reconciliation), Add Expense. Supports back-dated entries (subject to day lock).

**Day Lock:** a working/business date the app defaults new entries to, plus the ability to **freeze a finished day**. Every dated write guarded (HTTP 423). Admin-only unlock for back-dated corrections.

---

## FRONTEND — STAFF APP (`/app/`)

`src/App.jsx` is the shell: routing, sidebar nav, **auth gate**, and shared exports used everywhere: `api()` (fetch wrapper that attaches the bearer token, handles 401→logout and 423→day-locked toast), `apiCached()` (client-side cache for reference lists), `SearchableSelect` (type-to-filter dropdown with scroll-into-view), `fmt` (rupee/number formatting), print-template loader, brand logo, **working-date store** (a "Day bar" to set/lock the business date), and the public gate.

**Modules (sidebar):**
1. **Yard Entry** — log arrivals per truck/reference; per-farmer freight.
2. **Purchase Bills** — fast keyboard entry (see rules above); 3 print formats.
3. **Sales Bills** — Bill-by-Vendor + Bill-by-Product; pending queue.
4. **Payments** — vendor collections (oldest-first) + farmer payouts; search both sides; invoice peek.
5. **Day Book** — daily cash journal + quick entries.
6. **Market** — buy from agents + settlement/netting.
7. **Parties / Products** — masters with Tamil names (Google transliteration), villages, trucks, categories; delete buttons.
8. **Expenses** — categorised.
9. **Reports** — Tally Sheet (P&L, rate-matched profit + cash-reality projection), product profit, vendor outstanding (4-col + aging + **WhatsApp click-to-send payment reminders**), party ledger (split Vendors/Farmers, show opening balance), **Tally ERP XML export**, **Audit Pack** for annual filing.
10. **Print Center** — editable letterhead/template with adjustable alignment margins; **three formats: Full-letterhead A5 portrait, Pre-printed A5 stationery (values-only overlay), 80 mm Thermal**; find & reprint; party ledger. Track printed count and show a ⚠️ on reprints (deter double-cashing).
11. **View Bills (purchase & sales)** — filters, sortable columns, serial #, totals row, printed-count flag, product rate/weight when filtered.
12. **Admin / Danger Zone** — users & permissions (per-user module list), brand logo, backups, day-lock, audit log, legacy import / clean-restore.

**UX requirements:** mobile-responsive; idle/session security (auto-logout); roles/permissions reflected in sidebar AND enforced by API; PWA installable; Tamil renders correctly everywhere (utf8mb4 end-to-end, `JSON_UNESCAPED_UNICODE`).

## FRONTEND — PUBLIC MARKETING SITE (dist root, `/`)

Bilingual (Tamil + English) immersive, motion-driven editorial homepage telling the town/market story, market-day info, produce showcase — fast-loading. Includes an enquiry form (honeypot, rate-limited) and shows **published daily rates**. Pulls only from `public.php`. An admin "Website" page publishes the rates and reads the leads.

---

## DEPLOYMENT & OPS

**GitHub Actions `deploy.yml`** (push to `main`):
1. Node 20, `cd frontend && npm install && npm run build` (builds both bundles).
2. Install LFTP; mirror over **FTPS** (`ssl-force`, `ssl-protect-data`) **upload-only** (`mirror --reverse`, never `--delete`):
   - `frontend/dist/` → `/`
   - `backend/api/` → `/api/`
   - `backend/helpers/` → `/helpers/`
   - `backend/data/` → `/data/`
3. Because mirror never deletes, **explicitly `rm -f`** any obsolete server files (e.g. old/removed endpoints) in the workflow.
- FTP creds in GitHub Secrets (`FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`).

**Also build:** `security-scan.yml` (Semgrep on every push) and a `monitor.yml` (health-check ping).

**Ops:** nightly/one-click `.sql` backups; login lockout; security headers; a `RUNBOOK.md` (operations + contingency / disaster recovery); shared-hosting constraints noted (MySQL localhost-only; Cloudflare planned later at DNS layer for DDoS once SEO begins). Service worker must be **versioned** (cache name bump on each release) so fixes reach installed PWAs.

## LEGACY DATA MIGRATION (build the tooling)

The old `.mdb` data stores Tamil in **TSCII** encoding — convert via the `open-tamil` Python library. Provide generator scripts in `scripts/` (`build_import.py`, `build_bills_import.py`) that emit JSON into `backend/data/`, and **admin import endpoints** that load:
1. **Masters + opening balances** — parties (real farmer villages from the legacy `st1`/village field) and products.
2. **Historical bills** loaded as fully-settled history, plus each vendor's **true closing balance** computed from the legacy running ledger.
The import must be **idempotent and reversible**; a "clean restore" wipes and re-imports from the latest `.mdb`. Imported purchase bills must store the correct commission % (not 0).

## ACCEPTANCE CRITERIA

- A clerk can enter a purchase bill and a sales bill end-to-end **with the keyboard only**, and the printed Tamil bill matches the traditional A5 format.
- Commission, coolie, net payable, vendor outstanding (with aging), and Day Book closing all compute correctly per the rules above.
- Bill numbers are unique, atomic, and reset each Indian FY.
- Day Lock blocks dated writes (HTTP 423) until an admin unlocks.
- Staff see only permitted modules **and** the API rejects unpermitted writes (403).
- The only unauthenticated endpoint is `public.php`; it cannot reach private data.
- Every create/update/delete appears in the audit log.
- `npm run build` produces both the public site (`/`) and the staff app (`/app/`); push to `main` deploys via upload-only FTPS.
- Reporting is accurate and complete — no profit-hiding features.

---

> **End of build prompt.**
