# Software Requirements Specification (SRS)
## Sri Murugan & Co — Mandi Management System ("IDNUK Software")

| | |
|---|---|
| **Document** | Software Requirements Specification (IEEE-830 style) |
| **Product** | IDNUK Software |
| **Version** | 1.0 |
| **Date** | June 2026 |
| **Status** | Live pilot |
| **Companion** | `BRD.md` (business intent), `PROJECT_OVERVIEW.md` (system internals) |

---

## 1. Introduction

### 1.1 Purpose
This SRS specifies the functional and non-functional requirements of the IDNUK mandi
management system. It is the engineering reference for what the software must do and the
qualities it must meet. Requirements are grounded in the implemented system; file references
are given where they aid verification.

### 1.2 Scope
A bilingual (Tamil/English), multi-user, installable web application for a vegetable
commission agent: master data, purchase/sales/market/order billing, payments, expenses, a
daily Day Book with day-locking, reporting, printing (incl. pre-printed stationery), and
administration (users/permissions, audit, backups, public rates site). Out of scope: payment
gateways, multi-company within this app, native mobile apps, automated GST e-invoicing.

### 1.3 Definitions
- **Mandi / aratiya** — commission agent between farmers and buyers.
- **Party** — any external entity: Farmer, Supplier, Market Supplier/Vendor, Customer,
  Overflow vendor, Order Supplier, or Truck (reference).
- **Day Book / Tally** — the day's cash & bank movement summary.
- **Day Lock** — freezing a finished business date against changes.
- **Pre-print** — printing values only onto pre-printed paper stationery.
- **PWA** — Progressive Web App (installable, offline-tolerant).
- **FY** — Indian financial year (Apr 1 – Mar 31).

### 1.4 References
`BRD.md`, `PROJECT_OVERVIEW.md`, `RUNBOOK.md`, `ROLLBACK.md`, `STAGING-SETUP.md`.

---

## 2. Overall description

### 2.1 Product perspective
A two-surface web system on shared hosting:
- **Public homepage** (`/`) — marketing + published daily rates + enquiry form.
- **Staff app** (`/app/`) — the authenticated application (this SRS's focus).

Architecture: **React 18 + Vite** single-page app (browser) calling a **plain PHP 8** JSON API
backed by **MySQL/MariaDB** (utf8mb4). Two independent frontend bundles; a shared backend helper
(`backend/helpers/api.php`) enforces auth, permissions, audit, day-lock, and bill numbering for
every endpoint. See `PROJECT_OVERVIEW.md` for the full architecture.

### 2.2 User classes
| Class | Access |
|---|---|
| **Admin** (owner) | All modules + administration (users, audit, website, backups, day unlock) |
| **Staff** | Only modules granted to them (per-user module permissions), enforced client- and server-side |
| **Public visitor** | Homepage only: view published rates, submit an enquiry (no login, no private data) |

### 2.3 Operating environment
Modern browsers (Chrome/Edge/Safari) on Windows, macOS, Android, iOS; installable PWA; server is
cPanel shared hosting (Apache + PHP 8 + MySQL); database reachable only from the server.

### 2.4 Design & implementation constraints
- Shared hosting (no shell daemons, no Composer assumed); native-PHP implementations only.
- DB credentials in a per-docroot `config/database.php` that is **not** version-controlled or deployed.
- Money stored and computed as exact `DECIMAL`; Tamil stored as utf8mb4.
- Bills must fit existing pre-printed stationery (A5 sales, 6×6 farmer purchase).

### 2.5 Assumptions & dependencies
Reliable-enough internet (offline app shell tolerates brief drops); Google Fonts (Inter, Noto
Sans Tamil); Sentry (crash reporting); GitHub Actions (build/deploy); LFTP/FTPS to host.

---

## 3. Functional requirements

> Convention: **FR-<module>-<n>**. Each endpoint lives at `backend/api/<file>.php`; the SPA calls
> it via the `api()` client. Writes require a valid session **and** module permission.

### 3.1 Authentication & session (auth.php)
- **FR-AUTH-1** The system shall authenticate a user by username + password, verifying a bcrypt
  hash; on success it issues a random 64-char bearer token stored server-side with an 8-hour expiry.
- **FR-AUTH-2** The system shall slide an active session's expiry forward on use, so active users
  are not logged out mid-shift; it shall auto-logout after 60 minutes of inactivity (client).
- **FR-AUTH-3** The system shall lock out login after 8 failed attempts within 15 minutes, counted
  per IP **or** per username (HTTP 429).
- **FR-AUTH-4** The system shall support logout (token revocation) and a token-validated "me" check.

### 3.2 Users & permissions (auth.php — admin)
- **FR-USER-1** An admin shall create, edit, activate/deactivate staff users and set role
  (admin/staff).
- **FR-USER-2** An admin shall assign per-user **module permissions** (e.g. sales, purchase,
  payments, reports…).
- **FR-USER-3** The system shall enforce permissions on **writes server-side** (not only by hiding
  sidebar items); reads of reference data remain available to any logged-in user.

### 3.3 Parties / master data (parties.php)
- **FR-PARTY-1** The system shall manage parties across categories: Farmer, Supplier, Market
  Supplier, Market Vendor, Customer, Overflow, Order Supplier, Truck.
- **FR-PARTY-2** Parties shall carry bilingual name, city, phone, credit/commission attributes as
  relevant to their type; trucks may be linked to farmers.
- **FR-PARTY-3** The Parties screen shall filter the list by type and search by name/phone/code,
  with server-side pagination.
- **FR-PARTY-4** The system shall support **bulk re-typing** — selecting multiple parties and
  changing their category in one action — preserving names, balances and ledger history.
- **FR-PARTY-5** The system shall provide a party **ledger** and **outstanding** view (filterable
  by category and city).
- **FR-PARTY-6** Deactivating a party shall hide it from dropdowns while retaining history.

### 3.4 Products & rates (products.php)
- **FR-PROD-1** The system shall manage products (bilingual name, unit type, bag deductions) and
  product categories, with enable/disable.
- **FR-PROD-2** The system shall record **daily rates** per product and provide rate history.
- **FR-PROD-3** Published rates shall be curatable for the public homepage (see FR-WEB).

### 3.5 Yard entry (yard.php)
- **FR-YARD-1** The system shall record produce intake (party/truck, product, bags, weight) before
  billing, and mark entries as billed when converted.

### 3.6 Farmer Purchase (purchase.php)
- **FR-PUR-1** The system shall create a Farmer Purchase bill computing gross from line items and
  **subtracting** commission (default 10%), coolie (slab-based), freight (≈₹0.50/kg), sungam and
  cash advances to yield the farmer's **net payable**.
- **FR-PUR-2** Bills shall be editable subject to Day Lock, and printable (incl. 6×6 pre-print).
- **FR-PUR-3** Farmer payouts and advances shall post to payments/Day Book.

### 3.7 Supplier Purchase (supplier.php)
- **FR-SUP-1** The system shall create a Supplier Purchase (own-account) where freight, market
  charges, middleman commission and other charges are **added** to goods value to get landed cost
  owed to the supplier.
- **FR-SUP-2** Allocated order procurements shall be able to flow in as pending supplier bills.

### 3.8 Market Purchase & settlement (market.php)
- **FR-MKT-1** The system shall record market purchases (what the firm buys from market vendors),
  held pending until settlement.
- **FR-MKT-2** At Adjust/Settle, market-vendor purchases shall post as a consolidated credit note,
  netting against that vendor's sales so the two-way balance reconciles.
- **FR-MKT-3** The system shall support editing market purchases and a Market Outstanding report.

### 3.9 Sales (sales.php)
- **FR-SAL-1** The system shall create sales bills (cash or credit) per vendor, or stage line items
  "by product" and consolidate them into one vendor bill later.
- **FR-SAL-2** The system shall record **receipts/collections** (with optional discount) reducing a
  buyer's outstanding, and provide payment aging.
- **FR-SAL-3** Bills shall be printable (incl. A5 pre-print) and shareable via an unguessable
  per-bill token link (see FR-BILLVIEW).
- **FR-SAL-4** The system shall track print counts (guard against double-cash on reprints).

### 3.10 Orders (orders.php)
- **FR-ORD-1** The system shall take daily phone orders from order suppliers (city → supplier →
  product/bags/weight/notes), aggregating demand per product.
- **FR-ORD-2** The system shall allocate (procure) demand across sources (customers/market vendors),
  with a read-only Products×Suppliers fulfilment matrix.
- **FR-ORD-3** Taken orders shall flow to pending Sales bills; allocations to pending Supplier
  purchases. Orders shall be editable/deletable and exportable (CSV/print/PDF).

### 3.11 Payments & expenses (purchase.php / sales.php / reports.php)
- **FR-PAY-1** The system shall record farmer payouts/advances (debit) and buyer receipts (credit)
  with payment mode (cash/bank).
- **FR-EXP-1** The system shall record running expenses against standard categories.

### 3.12 Day Book / Tally & Day Lock (tally.php, daylock.php)
- **FR-DAY-1** The system shall present a daily Day Book: opening (cash+bank carried forward),
  collections, farmer payouts, expenses, closing balance, and memos.
- **FR-DAY-2** The system shall maintain a settable **working/business date** new entries default to.
- **FR-DAY-3** The system shall **lock** a date so any create/edit/delete dated to it is rejected
  (HTTP 423); only an admin may **unlock**, and unlocks are audited.
- **FR-DAY-4** Tally/source segregation reports shall distinguish Farmer/Supplier/Market origins.

### 3.13 Reports (reports.php, tally.php)
- **FR-RPT-1** Dashboard summary; **Outstanding** (payables & receivables, filter by category/city);
  **P&L**; **product-wise profit**; **payment aging**; **tally/day-book export**; **market
  outstanding**; expense reports. Reports shall be printable and exportable.

### 3.14 Printing & pre-print (settings.php + client)
- **FR-PRT-1** The system shall provide an editable bill template (company letterhead, Tamil/English).
- **FR-PRT-2** The system shall provide **Find & Print** for party ledgers.
- **FR-PRT-3** The system shall provide a **visual Pre-print alignment editor** — drag-to-position,
  per-column rename/width/align, whole-sheet font/row settings — for **A5 sales** and **6×6 farmer
  purchase** stationery, saved per paper and applied to printing, guaranteeing one fixed page with
  no carry-forward.

### 3.15 Public bill view (billview.php)
- **FR-BILLVIEW-1** A bill shall be viewable without login only via its unguessable 32-hex share
  token (generated when "WhatsApp"/share is used); no listing or enumeration of other data.

### 3.16 Public site & website admin (public.php, marketing.php)
- **FR-WEB-1** The public homepage shall show only **published** rates + contact and accept an
  enquiry; it shall never expose bills, customers or ledgers (enforced as the public boundary).
- **FR-WEB-2** An admin shall curate published rates and read incoming enquiries.

### 3.17 Administration: audit, backup, schema (audit.php, backup.php, admin.php)
- **FR-ADM-1** The system shall maintain an **append-only audit log** (who/what/when/where) with no
  edit/delete; admins may filter and view it.
- **FR-ADM-2** An admin shall download a full database **backup** (.sql); automated keyed backups
  (cron) shall retain the most recent 14.
- **FR-ADM-3** An admin shall download a structure-only **schema** (`schema.sql`) as a committable
  database map (no data, stable across regenerations).
- **FR-ADM-4** Admin data tools (e.g. counts; guarded legacy reset/import) shall be admin-only and
  require explicit confirmation.

---

## 4. External interface requirements

### 4.1 User interface
- **UI-1** Bilingual Tamil/English throughout; keyboard-driven billing (Enter to advance fields,
  double-Enter/Escape to save) for speed.
- **UI-2** Collapsible sidebar; always-visible Day bar (working date, lock state, **per-device text
  size** control for readability on small/old monitors).
- **UI-3** Installable PWA with offline app shell; responsive for phone and desktop.

### 4.2 Software interfaces
- **SI-1** REST-ish JSON API under `/api/*.php`; responses `{success, data|error}`; bearer-token
  `Authorization` header.
- **SI-2** MySQL via PDO prepared statements; schema self-migrates via `migrateOnce` keyed in
  `app_settings`.
- **SI-3** External: Google Fonts; Sentry (crash reporting, production only); GitHub Actions +
  FTPS for deployment.

### 4.3 Communications
- **CI-1** All traffic over HTTPS (HSTS); CSP restricts script/style/font/connect origins.

---

## 5. Non-functional requirements

### 5.1 Performance
- **NFR-PERF-1** Common billing screens shall feel instant on a normal connection; heavy lists
  (parties/products) are cached and paginated; first screens are pre-warmed after login.

### 5.2 Security
- **NFR-SEC-1** Passwords stored as bcrypt; sessions are server-side, revocable, 8-hour sliding.
- **NFR-SEC-2** Brute-force lockout (FR-AUTH-3); writes gated by per-module permission server-side.
- **NFR-SEC-3** Security headers: `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, HSTS; CORS echoed only to same host/localhost.
- **NFR-SEC-4** All SQL via parameterised statements; 500-level errors are logged (server + Sentry)
  but never leak internals to the client.
- **NFR-SEC-5** The public boundary (`public.php`) may only read published rates and write enquiries.

### 5.3 Reliability & availability
- **NFR-REL-1** A `/api/health.php` endpoint reports DB reachability for uptime monitoring.
- **NFR-REL-2** A headless render check runs every 30 min and alerts on white-screen failures.
- **NFR-REL-3** Offline app shell keeps the UI loadable during brief network loss.

### 5.4 Backup & recoverability
- **NFR-BAK-1** On-demand + scheduled backups; 14 most-recent retained; documented restore.
- **NFR-BAK-2** Releases are auto-tagged; a previous release can be redeployed in one click
  (rollback).

### 5.5 Maintainability & deployability
- **NFR-MNT-1** Push to `main` builds and deploys automatically (FTPS, upload-only); a separate
  `staging` branch deploys to `staging.smand.co` against a cloned DB.
- **NFR-MNT-2** The service-worker cache version is stamped automatically at build time (no manual
  bumping).
- **NFR-MNT-3** Static analysis (Semgrep) runs on every push and weekly.

### 5.6 Integrity & auditability
- **NFR-INT-1** Money is exact decimal; bill numbers are atomic, gap-controlled, FY-scoped.
- **NFR-INT-2** Locked days are immutable except by audited admin unlock; the audit log is
  append-only.

### 5.7 Usability & accessibility
- **NFR-USE-1** Per-device adjustable text size (90–160%) without breaking layout or print.
- **NFR-USE-2** Tamil rendering must never corrupt (utf8mb4 end-to-end).

### 5.8 Localisation
- **NFR-LOC-1** Tamil + English for UI and bills; Indian FY and ₹ conventions.

---

## 6. Data requirements (logical)

Core entities (MySQL): `users`, `user_sessions`, `login_attempts`; `parties`, `party_categories`,
`party_truck_links`, `cities`; `products`, `product_categories`, daily rates; `sales_bills` /
`sales_items` / `sales_staged_items`, `payments_received` / `payment_allocations`;
`purchase_bills` / `purchase_items`, `farmer_payouts`; market & order tables; `ledger`;
`bill_sequences`; `app_settings` (working date, business rules, print/pre-print templates, schema
versions); `audit_log`; `day_locks`. See `schema.sql` (regenerable) for the authoritative map.

**Retention:** financial and audit data are retained indefinitely; deactivation hides parties
without deleting history; backups retain 14 recent dumps.

---

## 7. Acceptance criteria (representative)

| ID | Given / When / Then |
|---|---|
| AC-1 | Given valid credentials, when a user logs in, then a session is issued and the dashboard loads. |
| AC-2 | Given 8 wrong passwords in 15 min, when a 9th is tried, then login is refused for 15 minutes. |
| AC-3 | Given a Farmer Purchase, when saved, then net payable = gross − commission − coolie − freight − sungam − advances, and a FY bill number is assigned. |
| AC-4 | Given a locked date, when any bill dated to it is created/edited, then the action is rejected (HTTP 423). |
| AC-5 | Given staff without the `sales` permission, when they POST to sales, then it is refused (403). |
| AC-6 | Given two parties in Customers, when bulk-retyped to Market Vendor, then both move with history intact and the change is audited. |
| AC-7 | Given a configured pre-print layout, when a bill prints, then all values land in their boxes on one page with no carry-forward. |
| AC-8 | Given a deploy to `main`, when it succeeds, then a `release-*` tag is created and the live site updates. |
| AC-9 | Given the admin Backup panel, when "Download schema.sql" is used, then a structure-only, data-free SQL map downloads. |

---

## 8. Future / deferred
Online payments, GST e-invoicing/e-way automation, Tally ERP sync, multi-company within this app
(covered separately by the multi-tenant "ODC-MARKET" product), native mobile apps, code-splitting
of the JS bundle.
