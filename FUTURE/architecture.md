# Architecture — Database-per-Tenant SaaS

> Goal: multi-tenant SaaS **without touching the current data model**.
> This document shows exactly how that promise is kept.

---

## 1. The core idea

Today the app connects to **one** database, named by a constant:

```php
// config/database.php  (today)
define('DB_NAME', 'smanwefl_idnuk');
```

Every customer's data lives in **its own database** that is a clone of the
*identical* schema you run now (`sales_bills`, `purchase`/`sales_items`,
`parties`, `products`, `ledger`, `payments_received`, `user_sessions`, the views,
all ~35 objects). Nothing inside those tables changes.

The **only** structural change: `DB_NAME` stops being a constant and becomes a
value resolved per request, from the logged-in tenant.

```php
// config/database.php  (after)
$DB_NAME = resolveTenantDb();   // looked up from the control plane, see §3
```

Because your migrations already run **per database** (`migrateOnce(key, ver, fn)`
executes DDL against whatever DB is connected), onboarding a new tenant is
near-free: create the DB, run the same migrations, done.

---

## 2. Two planes

```
                       ┌────────────────────────────────────────┐
   Browser  ─────────► │  CONTROL PLANE  (new, small)           │
   idnuk.com           │  • signup / login / tenant routing      │
                       │  • 14-day trial + Razorpay subscription │
                       │  • provisioning (create tenant DB)      │
                       │  • plan / feature flags per tenant      │
                       │  control DB: idnuk_control              │
                       └───────────────┬────────────────────────┘
                                       │ resolves tenant → db name
                                       ▼
                       ┌────────────────────────────────────────┐
   app.idnuk.com  ───► │  DATA PLANE  (your app, ~unchanged)     │
   (per-tenant)        │  backend/api/*.php  +  React SPA        │
                       │  connects to tenant_<id> database       │
                       └───────────────┬────────────────────────┘
                                       ▼
        ┌────────────┬────────────┬────────────┬────────────┐
        │ tenant_001 │ tenant_002 │ tenant_003 │   …200…     │   (one DB each,
        │  (Sri      │            │            │            │    identical schema)
        │  Murugan)  │            │            │            │
        └────────────┴────────────┴────────────┴────────────┘
```

- **Control plane** = the new SaaS bits. Small, isolated, owns billing + who's who.
- **Data plane** = today's IDNUK, essentially as-is, just told which DB to use.

---

## 3. Control-plane schema (new `idnuk_control` DB)

```sql
CREATE TABLE tenants (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  slug          VARCHAR(40)  UNIQUE,         -- e.g. 'srimurugan'  → srimurugan.idnuk.com
  company_name  VARCHAR(200),
  db_name       VARCHAR(64)  UNIQUE,         -- e.g. 'idnuk_t_001'
  status        ENUM('trial','active','past_due','suspended','cancelled') DEFAULT 'trial',
  trial_ends_at DATETIME,                    -- now()+14 days at signup
  plan          VARCHAR(40)  DEFAULT 'standard',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tenant_users (              -- who can log in, maps email → tenant
  id          INT PRIMARY KEY AUTO_INCREMENT,
  tenant_id   INT,
  email       VARCHAR(190) UNIQUE,
  password_hash VARCHAR(255),
  role        ENUM('owner','staff') DEFAULT 'owner',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant (tenant_id)
);

CREATE TABLE subscriptions (             -- mirror of Razorpay state
  id              INT PRIMARY KEY AUTO_INCREMENT,
  tenant_id       INT,
  rzp_customer_id VARCHAR(64),
  rzp_sub_id      VARCHAR(64),
  status          VARCHAR(40),           -- created/authenticated/active/halted/cancelled
  current_end     DATETIME,
  amount_paise    INT,
  updated_at      DATETIME,
  INDEX idx_tenant (tenant_id)
);

CREATE TABLE tenant_features (           -- per-customer customisation (config, not forks)
  tenant_id   INT,
  feature_key VARCHAR(60),               -- e.g. 'module.yard', 'print.thermal', 'lang.tamil_first'
  value       VARCHAR(255),
  PRIMARY KEY (tenant_id, feature_key)
);
```

---

## 4. The tenant resolver

The login token already lives in `sessionStorage` and is validated by
`requireAuth()`. We extend the session to carry the **tenant**, and resolve the
DB once per request — cached in-process.

```php
// helpers/tenant.php  (new)
function resolveTenantDb(): string {
    // 1. Custom domain or subdomain  → slug
    $host = $_SERVER['HTTP_HOST'];                  // srimurugan.idnuk.com
    $slug = explode('.', $host)[0];

    // 2. Or the auth token already pins a tenant (preferred, tamper-proof)
    $tenantId = currentTenantIdFromSession();       // from tenant_users via token

    $ctrl = controlDb();
    $row = $ctrl->prepare(
      'SELECT db_name, status, trial_ends_at FROM tenants WHERE id = ? OR slug = ? LIMIT 1');
    $row->execute([$tenantId, $slug]);
    $t = $row->fetch();

    if (!$t)                                  httpFail(404, 'Unknown workspace');
    if ($t['status'] === 'suspended')         httpFail(402, 'Subscription inactive');
    if ($t['status'] === 'trial'
        && strtotime($t['trial_ends_at']) < time())
                                              httpFail(402, 'Trial ended — please subscribe');

    return $t['db_name'];                      // e.g. 'idnuk_t_001'
}
```

`getDb()` then connects to `$DB_NAME = resolveTenantDb()`. Every existing query in
`backend/api/*.php` runs unchanged against the right tenant DB. **Isolation is
physical** — a bug in tenant A's query literally cannot read tenant B's tables.

---

## 5. Provisioning a new tenant (self-service signup)

```
signup(email, company, password)
  ├─ create row in tenants     (status=trial, trial_ends_at = now+14d, db_name = idnuk_t_<id>)
  ├─ create row in tenant_users (owner, password_hash)
  ├─ CREATE DATABASE idnuk_t_<id>
  ├─ run schema.sql  (one canonical dump of today's structure, no data)
  ├─ run migrateOnce() chain   (brings DB to current version)
  ├─ seed: admin user, default products/units, sample categories
  └─ redirect → app, logged in, day 1 of trial
```

Sketch:

```php
// control/provision.php
function provisionTenant(int $id): void {
    $db = "idnuk_t_" . str_pad($id, 3, '0', STR_PAD_LEFT);
    $root = rootDb();                                   // a provisioning-only MySQL user
    $root->exec("CREATE DATABASE `$db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    $root->exec("USE `$db`");
    foreach (loadSchemaStatements('schema.sql') as $stmt) $root->exec($stmt);
    runAllMigrations($db);                              // existing migrateOnce chain
    seedDefaults($db);
    controlDb()->prepare('UPDATE tenants SET db_name=? WHERE id=?')->execute([$db, $id]);
}
```

`schema.sql` is produced **once** from the current production DB:

```bash
mysqldump --no-data --routines smanwefl_idnuk > schema.sql
```

That single file is the contract that guarantees every tenant is structurally
identical to the pilot.

---

## 6. Customisation without forking

Each customer can differ — modules on/off, print style, Tamil-first names,
discount rules — driven entirely by `tenant_features` rows read at login and
exposed to the React app as a `features` object:

```js
if (features['module.yard'])        showYardTab();
if (features['lang.tamil_first'])   nameOrder = 'ta-first';
```

No customer ever gets a separate code branch. One codebase, deployed once,
behaves per-tenant by config. This is what keeps 200 customers maintainable.

---

## 7. Migrations across 200 tenants

A schema change (new column, new table) ships as a new `migrateOnce` step. A tiny
runner loops every tenant DB and applies pending migrations:

```php
foreach (allTenantDbNames() as $db) { connect($db); runAllMigrations($db); }
```

Because `migrateOnce` is idempotent and keyed, this is safe to run repeatedly and
on every deploy. Run it as a post-deploy job (and lazily on first request as a
safety net).

---

## 8. What changes vs what doesn't

| Stays the same (untouched) | New / changed |
|---|---|
| All ~35 tables, views, columns | `idnuk_control` DB (4 small tables) |
| Every `backend/api/*.php` query | `helpers/tenant.php` resolver |
| React SPA screens & flows | Signup / billing / provisioning pages |
| `migrateOnce` pattern | `DB_NAME` constant → resolver call |
| Business logic, reports, prints | Per-tenant `features` config layer |

> Net: ~1 new helper + ~4 control tables + a billing/signup surface. The product
> you've built is reused wholesale.

---

## 9. Security & data protection notes

- **Physical isolation** between tenants (separate DBs) is the strongest tenancy
  boundary — easy to reason about, easy to back up/restore per customer.
- Per-tenant **backups** (managed MySQL automated snapshots + logical dumps).
- **DPDP Act 2023** (India): you're a data processor for each mandi's data —
  keep data in an India region, document retention, support deletion on cancel.
- Rotate the leaked pilot DB password **before** any of this goes live; the new
  provisioning user must never be exposed to tenant app code.
- Keep `public.php` / `billview.php` as the only unauthenticated endpoints; the
  control plane's signup/login are the only *new* public surfaces.

See **costing-and-timeline.md** for the money and the calendar.
