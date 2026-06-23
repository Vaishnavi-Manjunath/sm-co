# Sri Murugan & Co — Mandi Management System ("IDNUK Software")

*Project overview & requirements — last updated June 2026*

This document describes the application's business context, what it does, how it is
built, and a history of what has been delivered. It is written from the actual code,
git history, and data model.

---

## 1. Application context (the business)

**Sri Murugan & Co** is a **vegetable commission agent (mandi / aratiya) and order
supplier** operating inside **Gandhi Market, Oddanchatram** (Dindigul district, Tamil
Nadu) — one of Tamil Nadu's largest round-the-clock vegetable markets. The motto printed
on its bills is *வாணிபமே கோயில், வாடிக்கையாளரே தெய்வம்* ("Business is the temple, the
customer is God").

The business sits **between farmers and buyers**:

- **Farmers** (and the trucks / agents that bring their produce — *வண்டி / vandi*) deliver
  vegetables to the yard. The firm sells the produce on their behalf and pays them the
  proceeds **minus deductions** — commission, loading coolie, market tax (sungam), lorry
  freight, and any cash advances.
- **Vendors / customers** buy the produce, usually in bulk and often on running credit, and
  settle their dues over time.

The firm earns its living from the **commission** plus small service charges. Everything is
**bilingual (Tamil + English)** because the farmers, the staff, and the printed bills are
all in Tamil.

The software replaces a legacy **MS Access (`.mdb`)** desktop system; it is the modern,
multi-user, networked replacement and is currently in **pilot**.

---

## 2. Purpose & goals

- Enter **hundreds of purchase & sales bills per day** quickly — keyboard-driven, minimal mouse.
- Track **farmer payables**, **vendor receivables**, the daily **cash position (Day Book)**,
  commission income, and profit.
- Print bills in the exact traditional Tamil format the market expects.
- Keep an accurate, auditable ledger — explicitly **no hiding of profit / income** (a stated
  integrity boundary of the project).
- Run a small **public website** to attract new vegetable customers.

---

## 3. Technology stack & architecture

| Layer | Technology |
|---|---|
| **Frontend** | **React 18** single-page app, built with **Vite 4**, plain JavaScript (JSX), no UI framework — inline styles throughout. |
| **Backend** | **PHP** (procedural, no framework). One file per module under `/api`, each returns JSON. |
| **Database** | **MySQL** on the shared host (localhost-only — not reachable from the internet). |
| **Hosting** | **Namecheap** shared **cPanel** hosting. |
| **Auth** | Custom bearer-token sessions, bcrypt password hashing. |
| **Deploy** | **GitHub Actions** builds the frontend, then **LFTP** mirrors files (upload-only, never deletes) to cPanel over FTP. Push to `main` = deploy. |
| **Repo** | Private GitHub repo `smandco-odc/idnuk`. |

**Request flow:** Browser (React) → `/api/*.php` → MySQL → JSON back. The React build
(`frontend/dist`) is served as static files from the web root; the PHP APIs live in `/api`.

**Key shared modules:**

- `frontend/src/App.jsx` — app shell, routing, sidebar navigation, the auth gate, and shared
  exports: `api()`, `apiCached()`, `SearchableSelect`, `fmt`, the print-template loader, brand
  logo, the working-date store, and the public gate.
- `backend/helpers/api.php` — helpers used by every endpoint: `requireAuth()`, `getDB()`,
  `respond()` / `respondError()` / `respondList()`, `getBody()` / `getParam()`, `auditLog()`,
  `nextBillNo()`, the day-lock guards, and CORS + security headers.

---

## 4. Security & access model

- **Login** with username / password (bcrypt). Sessions are server-side rows in
  `user_sessions` keyed by a bearer token (sent as `Authorization: Bearer …`).
- **Brute-force lockout** via `login_attempts` (failed attempts tracked per IP).
- **Roles:** `admin` (sees everything) and `staff` (sees only their **permitted modules** — a
  per-user JSON list of module ids).
- **Public boundary:** exactly **one** unauthenticated endpoint, `public.php`, which only reads
  published daily rates and writes website enquiries (with a honeypot + per-IP rate limiting).
  It can never touch bills / parties / ledger.
- Security headers; DB credentials in a git-ignored `backend/config/database.php`; an automated
  **Semgrep** scan on every push.

---

## 5. Data model (core tables)

- **Parties** (`parties`, `party_categories`) — farmers, suppliers, customers / vendors, market
  vendors, trucks. Name (English + Tamil), village / city, opening balance, commission %.
- **Products** (`products`, `product_categories`) — vegetables; English code + Tamil name; unit
  type (KG or BAG).
- **Yard** (`yard_entries`, `yard_allocations`) — produce arrivals before billing.
- **Purchase** (`purchase_bills`, `purchase_items`) — farmer bills (what we owe farmers).
- **Sales** (`sales_bills`, `sales_items`, `sales_staged_items`) — vendor bills (what vendors owe us).
- **Money** (`ledger`, `payments_received`, `payment_allocations`, `farmer_payouts`, `daily_expenses`).
- **Market trading** (`market_purchases`, `market_settlements`) — buying from other agents to fill orders.
- **Settings / ops** (`app_settings`, `bill_sequences`, `day_locks`, `audit_log`, `users`,
  `user_sessions`, `login_attempts`, `cities`, `daily_rates`, `enquiries`).
- **Reporting views** — `vw_vendor_outstanding`, `vw_daily_pnl`, `vw_product_profit`.

---

## 6. Functional modules

1. **Yard Entry** — log produce arrivals per truck / reference before billing.
2. **Purchase Bills (farmers)** — fast keyboard entry: farmer → product → per-bag weights →
   rate. Auto-computes **coolie** (₹5 if bag-priced, ₹3 for 1–30 kg, ₹5 for 31 kg+) and
   **commission %**; supports **cash advance (sakku)**, **freight (lorry rent)**, **sungam
   (market tax)**, and a damage deduction. **Net payable = gross − commission − coolie −
   sakku − freight.** Prints in the traditional Tamil format.
3. **Sales Bills (vendors)** — two modes: *Bill by Vendor* (one vendor, many products) and
   *Bill by Product* (one product staged across many vendors, then combined into one bill per
   vendor per day). Carries the vendor's **previous outstanding**. Pending queue draws from yard
   + staged items.
4. **Payments** — record collections from vendors (allocated oldest-first) and payouts to farmers.
5. **Day Book** (formerly "Tally") — daily cash journal: opening → collections / payouts /
   expenses / market → closing (cash & bank). Quick entries: Collect, Pay Farmer, **Pay Old
   Farmer Bills** (temporary pilot helper), Add Expense.
6. **Market** — buy from other agents to fulfil orders; weekly settlement / netting.
7. **Parties / Products** — masters with Tamil names, villages, trucks, categories.
8. **Expenses** — categorised petty-cash / running expenses.
9. **Reports** — Tally Sheet (purchases vs sales / P&L), product profit, vendor outstanding with
   aging, party ledger, and a **Tally ERP XML export**.
10. **Print Center** — editable letterhead / template; **three print formats: Full letterhead
    A5 (portrait), Pre-printed A5 stationery (values-only overlay), and 80 mm Thermal**; find &
    reprint bills; party ledger.
11. **View Bills (purchase & sales)** — date-range + party + product + reference filters,
    sortable columns, serial numbers, a totals row (gross / commission / net), a **printed-count
    flag** (⚠️ on reprints, to deter double-cashing), and per-bill **product rate & weight when
    filtered by a product**.
12. **Website (public)** — bilingual marketing homepage (immersive, motion-driven design) plus an
    admin page to publish daily rates and read enquiries.
13. **Admin / Danger Zone** — users & permissions, brand logo, backups, day-lock, audit log, and
    the legacy-data import tools.

---

## 7. Key business rules & safeguards

- **Day Lock** — a "working / business date" plus the ability to **freeze a finished day**; every
  dated write is guarded (`assertDateUnlocked`, HTTP 423). Admins can unlock to back-date
  corrections.
- **Bilingual everything** — Tamil names stored alongside English; bills print in Tamil.
- **Audit log** on every create / update / delete.
- **Integrity boundary** — the system is built for **accurate** reporting. (A request to hide
  ~50% of profit from auditors was declined.)

---

## 8. Legacy data migration

The old `.mdb` data (Tamil stored in **TSCII** encoding, converted via the `open-tamil` library)
was imported in two parts:

- **Masters + opening balances** — parties (with real farmer villages taken from the legacy
  `st1` field) and products.
- **Historical bills (Apr 1 – Jun 8 2026)** — ~5,180 purchase + ~1,921 sales bills loaded as
  fully-settled history, plus each vendor's **true closing balance** computed from the legacy
  running ledger. A **"clean restore"** wipes and re-imports from the latest `.mdb`. The import is
  reversible and idempotent.

Generator scripts live in `scripts/` (`build_import.py`, `build_bills_import.py`); the import
endpoints live in `backend/api/admin.php`.

---

## 9. Operations

- **Backups** — admin one-click `.sql` download; nightly backups documented in `RUNBOOK.md`.
- **Health check**, login lockout, security headers, and Semgrep scanning.
- **Shared-hosting constraints** — MySQL is localhost-only; the LFTP deploy is upload-only (it
  never deletes server files, so obsolete files are removed with explicit `rm -f` lines in the
  workflow). Cloudflare is planned later at the DNS layer for DDoS protection once SEO / marketing
  begins.

---

## 10. Delivery history (this engagement)

Legacy `.mdb` import → farmer-city fix → ops hardening (backups / health / lockout / RUNBOOK) →
**Day Lock** → brand logo + banner trim → sales-delete / purchase keyboard flow / dropdown
scroll-into-view → **public marketing site** + immersive homepage redesign → **print options
(A5 / pre-printed / thermal)** → Day Book rename + "Pay Old Farmer Bills" + expense-category fix →
**historical bills import + closing-balance correction** + 09-June clean restore → **View Bills**
(totals, serial #, sort, party / product / reference filters, print tracking, product rate /
weight) → fix for imported bills' commission %.
