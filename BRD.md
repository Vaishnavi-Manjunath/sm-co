# Business Requirements Document (BRD)
## Sri Murugan & Co — Mandi Management System ("IDNUK Software")

| | |
|---|---|
| **Document** | Business Requirements Document |
| **Product** | IDNUK Software — Mandi (commission-agent) management system |
| **Client** | Sri Murugan & Co, Gandhi Market, Oddanchatram, Dindigul District, Tamil Nadu |
| **Status** | Live pilot |
| **Version** | 1.0 |
| **Date** | June 2026 |
| **Author** | Engineering (with the business owner) |

---

## 1. Purpose of this document

This BRD states **what the business needs and why** — the problems, the people, the
processes, and the rules the software must honour. It is deliberately non-technical; the
*how* (architecture, screens, data) is covered in the companion **SRS** (`SRS.md`). Where the
two overlap, the BRD defines the business intent and the SRS defines the implementation.

---

## 2. Business background & context

**Sri Murugan & Co** is a **vegetable commission agent (mandi / aratiya) and order supplier**
operating inside Gandhi Market, Oddanchatram — one of Tamil Nadu's largest round-the-clock
wholesale vegetable markets. The firm sits **between farmers and buyers**:

- **Farmers** (and the trucks/agents — *vandi* — that bring their produce) deliver vegetables
  to the yard. The firm sells the produce on their behalf and pays them the proceeds **minus
  deductions** — commission, loading coolie, market tax (sungam), lorry freight, and any cash
  advances.
- **Buyers** (customers, overflow vendors, market vendors, order suppliers) take the produce,
  usually in bulk and often on running credit, and settle their dues over time.

The firm earns from **commission** plus small service charges. Everything is **bilingual
(Tamil + English)** because farmers, staff, and printed bills are all in Tamil.

The software **replaces a legacy single-user MS Access (`.mdb`) desktop system** with a modern,
multi-user, networked, installable web application used on the owner's and staff's devices.

---

## 3. Business problem statement

The legacy system was single-user, fragile, offline, English-only in places, and offered no
audit trail, no access control, no remote/mobile use, and no safe way to close a day's books.
Manual bill writing was slow and error-prone at the volume the firm handles (hundreds of bills
per day). Outstanding balances (what farmers are owed, what buyers owe) were hard to track in
real time, and there was no defence against accidental edits to finished days or against data
loss.

---

## 4. Business objectives & success criteria

| # | Objective | Success measure |
|---|---|---|
| BO-1 | Enter purchase & sales bills fast, with minimal mouse use | A clerk can complete a typical bill keyboard-only; hundreds/day are handled without backlog |
| BO-2 | Always know who owes what | Farmer payables and buyer receivables are correct and current at any moment |
| BO-3 | Know the day's cash position | A daily Day Book shows opening, collections, payouts, expenses, and closing balance |
| BO-4 | Protect finished days | Once a day is locked, its bills/money cannot be changed except by an admin |
| BO-5 | Bilingual, mandi-accurate bills | Printed bills match the firm's existing pre-printed stationery and Tamil conventions |
| BO-6 | Multi-user with accountability | Staff have scoped access; every change is recorded in an audit trail |
| BO-7 | Safe, recoverable, monitored | Backups exist, crashes are reported, the site is monitored, and a bad release can be rolled back |
| BO-8 | Reachable anywhere | Works on the owner's and staff phones/PCs, installable, usable on slow connections |

---

## 5. Stakeholders

| Stakeholder | Interest / role |
|---|---|
| **Owner / proprietor** | Primary user & decision-maker; cash, profit, outstanding, daily oversight; admin |
| **Accountant / billing clerks** | Daily purchase, sales, payment and expense entry; printing bills |
| **Farmers** | Receive accurate payout statements (Tamil); paid net of deductions |
| **Buyers (customers, vendors, order suppliers)** | Receive bills; run credit; settle balances |
| **Auditor / books** | Expect financial-year numbering, locked days, and a clean audit trail |
| **Engineering (solo, with AI assistance)** | Builds, deploys, supports the system |

---

## 6. Scope

### 6.1 In scope
- Master data: parties (farmers, suppliers, market suppliers/vendors, customers, overflow,
  order suppliers, trucks), products & daily rates, cities, business rules.
- Yard intake and **Farmer Purchase** billing (commission/coolie/freight/sungam deductions, payouts/advances).
- **Supplier Purchase** (own-account capital buys; charges added to landed cost).
- **Market Purchase** and two-way **market vendor settlement**.
- **Sales** billing (cash & credit), receipts/collections, and the daily **Order book** (take orders → procure).
- **Payments** (farmer payouts, buyer receipts), **Expenses**, **Day Book (Tally)** and **Day Lock**.
- **Reports**: dashboard, outstanding (payables/receivables), P&L, product-wise profit, aging,
  tally/day-book export, market outstanding.
- **Printing**: bill templates, find-&-print ledgers, and a visual **pre-print alignment** editor
  for pre-printed A5 (sales) and 6×6 (farmer purchase) stationery.
- **Administration**: users & module permissions, audit log, backup/schema export, public
  marketing homepage with published rates + enquiries.
- Bilingual (Tamil/English) UI and bills; installable PWA; per-device text scaling.

### 6.2 Out of scope (current)
- Online payment collection / payment-gateway integration.
- Multi-branch or multi-company operation in this app (a separate multi-tenant product,
  "ODC-MARKET", exists for that and is tracked independently).
- Inventory/stock valuation beyond what billing implies; GST e-invoicing/e-way bill automation;
  third-party accounting (Tally ERP) sync; mobile native apps.

---

## 7. Key business processes (as the firm works)

1. **Intake → Farmer Purchase:** produce arrives (often via a truck/agent); a yard entry records
   it; a Farmer Purchase bill computes the farmer's gross, subtracts commission, coolie, freight,
   sungam and advances, yielding the **net payable** to the farmer.
2. **Supplier Purchase:** the firm buys its own stock from an out-of-town supplier; freight,
   market charges and middleman commission are **added** to goods value to get the landed cost
   owed to the supplier.
3. **Sales:** produce is sold to buyers (cash or credit). Bills can be raised per vendor or staged
   "by product" and consolidated. Receipts reduce the buyer's outstanding.
4. **Market vendor settlement:** market vendors both buy from and sell to the firm; their two-way
   balance nets and reconciles at settlement.
5. **Orders:** phone orders are taken from order suppliers by city/product; aggregated demand is
   procured (allocated across sources) and flows into pending sales/supplier bills.
6. **Money & day close:** payouts, receipts and expenses post to the Day Book; at day end the
   owner **locks the day**, freezing it; an admin can unlock to correct.

---

## 8. Business rules (authoritative defaults; admin-configurable)

| Rule | Default | Notes |
|---|---|---|
| Commission on purchase bills | 10% | Firm's standard agent commission |
| Buyer credit period | 14 days | Default on credit sales |
| Yard auto-freight | ₹0.50 / kg net weight | Lorry freight estimate |
| Coolie (bag-priced, no weighing) | ₹5 / bag | |
| Coolie (weighed, ≤ 30 kg) | ₹3 / bag | Slab boundary 30 kg |
| Coolie (weighed, > 30 kg) | ₹5 / bag | |
| Bill numbering | Indian Financial Year (Apr 1–Mar 31) | e.g. `PUR-2026-27-00001`; restarts every Apr 1; derived from the **bill's** date |
| Day lock | Per calendar date | Locked days reject any dated create/edit/delete until admin unlock |
| Tamil text storage | UTF-8 (utf8mb4) | Tamil names/bills must never corrupt |

---

## 9. Business constraints & assumptions

- **Constraints:** runs on inexpensive shared hosting (PHP + MySQL); the database is only
  reachable from the server; the team is small and largely non-technical; bills must fit the
  firm's existing pre-printed stationery; Tamil is mandatory.
- **Assumptions:** reliable-enough internet at the shop (with offline-tolerant app shell);
  staff are trained on keyboard-driven entry; one engineer maintains the system.

---

## 10. High-level risks

| Risk | Impact | Mitigation |
|---|---|---|
| Data loss / server failure | Severe | On-server backups + off-site copies; schema export; documented restore |
| Accidental edits to closed books | High | Day Lock (admin-only unlock) + audit trail |
| Wrong financial figures | High | Exact decimal money math; commission/coolie/freight rules centralised |
| Bad release breaks the live site | Medium | Auto-tagged releases + one-click rollback; staging environment |
| Unauthorised access | High | Token login, lockout on brute force, per-module permissions, HTTPS/security headers |
| Tamil corruption | Medium | utf8mb4 throughout; bilingual fonts |

---

## 11. Success definition

The pilot is successful when the firm runs a full business day end-to-end on the system —
intake, purchase, sales, payments, expenses, day close — with correct outstanding and cash
figures, printed bills accepted by farmers and buyers, no data loss, and the owner able to
oversee it from a phone. Detailed, testable requirements are specified in `SRS.md`.
