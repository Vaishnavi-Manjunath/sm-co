# Staging environment — one-time setup (plain English)

Goal: a private copy of the app at **`staging.smand.co`** running on a **cloned database**,
so you can test changes safely before they reach the live `smand.co`. The code is identical;
only the web address and the database differ.

**How it works once set up:** you push code to the **`staging` branch** → it deploys to
`staging.smand.co` only. You push to **`main`** → it deploys to the live site only. The two
never touch each other.

The code side is already done (the `Deploy to Staging` workflow + Sentry skips staging). The
rest is cPanel/GitHub clicking — do these once, in order.

---

## Part A — cPanel (about 30–40 minutes)

### 1. Create the subdomain
cPanel → **Domains** (or **Subdomains**) → **Create**:
- Subdomain: `staging`  ·  Domain: `smand.co`
- Document Root: accept the default (usually `staging.smand.co/` or `public_html/staging`).
  **Write this path down** — you'll need it twice below.
- After it's created, secure it with HTTPS — see **step 1b** below.

### 1b. Get an SSL certificate for the subdomain

You need a valid cert so browsers trust `https://staging.smand.co` (and so the installable
app / service worker works). **Do not buy a DigiCert cert for staging — it's paid and
unnecessary.** Try these in order:

**Option 1 — Free AutoSSL (best; auto-renews).** cPanel → **SSL/TLS Status** → tick
`staging.smand.co` → **Run AutoSSL**, then read the message next to the domain.
- It usually "fails" only because the new subdomain's DNS hasn't propagated yet, or the
  validation file was being swallowed by the app's URL rules. The `.htaccess` in step 4 now
  serves `/.well-known/` files directly, which fixes the second cause.
- If the message says DNS/validation can't be reached: wait for DNS to propagate (30 min – a
  few hours after creating the subdomain), then **Run AutoSSL** again. Confirm propagation by
  checking that `staging.smand.co` resolves to the **same server IP** as `smand.co`.

**Option 2 — Free 90-day cert (ZeroSSL / Let's Encrypt), installed in cPanel.** Use this if
AutoSSL still won't issue after DNS has propagated:
1. cPanel → **SSL/TLS** → **Certificate Signing Requests (CSR)** → **Generate** a CSR for
   `staging.smand.co` (this also creates the private key and stores it in cPanel).
2. Go to **zerossl.com** (free account) → **New Certificate** → domain `staging.smand.co` →
   90-day free → paste the CSR from step 1.
3. **Validate**: pick **HTTP File Upload** → download the small `.txt` file → put it at
   `staging-docroot/.well-known/pki-validation/<that-file>.txt` (the `.htaccess` rule makes it
   reachable) → ZeroSSL verifies. *(Or pick DNS (CNAME) validation and add the record at your
   DNS provider — either works.)*
4. Download the issued **certificate** + **CA bundle**.
5. cPanel → **SSL/TLS** → **Install and Manage SSL for your site (HTTPS)** → select
   `staging.smand.co` → the **Private Key** auto-fills (from step 1) → paste the **Certificate**
   and the **CA Bundle** → **Install**.
6. A ZeroSSL/Let's Encrypt cert lasts **90 days** — set a calendar reminder to repeat, or ask
   me to set up `acme.sh` for automatic renewal once it's working.

> The staging cert is independent of the live cert; fixing staging won't touch `smand.co`.

### 2. Clone the database
cPanel → **phpMyAdmin**:
1. Left list → click the live database (`smanwefl_idnuk`).
2. Top menu → **Operations** → under **"Copy database to"**, type a new name, e.g.
   `smanwefl_idnuk_stg`, choose **Structure and data**, tick **CREATE DATABASE**, click **Go**.
   *(If "Copy database to" isn't available: use **Export** on the live DB → then create the new DB
   under cPanel → MySQL Databases → and **Import** the file into it.)*
3. cPanel → **MySQL Databases** → create a DB user (e.g. `smanwefl_stg`) with a **new strong
   password** → **Add user to database** `smanwefl_idnuk_stg` → grant **All Privileges**.

> Use a SEPARATE database and user for staging. Never point staging at the live database.

### 3. Put the database config in the staging docroot
The staging site needs its own `config/database.php` (it is never deployed — it lives only on the
server, just like the live one). Using cPanel → **File Manager**:
1. Go to the staging **Document Root** from step 1.
2. Create a folder named `config`.
3. Inside it, create `database.php` with exactly this (fill in your step-2 values):

```php
<?php
defined('DB_HOST')    || define('DB_HOST', 'localhost');
defined('DB_NAME')    || define('DB_NAME', 'smanwefl_idnuk_stg');   // the CLONED db
defined('DB_USER')    || define('DB_USER', 'smanwefl_stg');         // the staging user
defined('DB_PASS')    || define('DB_PASS', 'YOUR-STAGING-PASSWORD');
defined('DB_CHARSET') || define('DB_CHARSET', 'utf8mb4');

function getDB(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=" . DB_CHARSET;
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    }
    return $pdo;
}
```

> This is a copy of the live `config/database.php` with the **staging** database name, user and
> password. Double-check `DB_NAME` is the **cloned** one — this is the single most important line.

### 4. Add the routing file
The app needs the same URL rules as live. In the staging Document Root, create a file named
`.htaccess` with the contents of `public_html.htaccess` from this project (File Manager →
+ File → `.htaccess`, then paste). *(The deploy uploads the app files, but `.htaccess` is placed
once by hand, like on live.)*

### 5. Create an FTP account for staging
cPanel → **FTP Accounts** → **Add FTP Account**:
- Log in name: e.g. `staging@smand.co`
- **Directory: set it to the staging Document Root** from step 1 (so the account's "home" is the
  staging folder — this lets the deploy upload to `/` safely without reaching the live site).
- Set a strong password. **Note the FTP username, password, and the FTP server/host.**

---

## Part B — GitHub (about 5 minutes)

Repo → **Settings → Secrets and variables → Actions → New repository secret**. Add three:

| Secret name | Value |
|---|---|
| `FTP_SERVER_STAGING` | your FTP host (same host as the live one is fine, e.g. `ftp.smand.co`) |
| `FTP_USERNAME_STAGING` | the staging FTP username from A-5 (e.g. `staging@smand.co`) |
| `FTP_PASSWORD_STAGING` | the staging FTP password from A-5 |

---

## Part C — First deploy & test

1. Create and push the `staging` branch (tell me and I'll do this, or run):
   `git checkout -b staging && git push -u origin staging`
2. GitHub → **Actions** → **Deploy to Staging** should run green.
3. Open `https://staging.smand.co/app/` and log in (same usernames/passwords as live, since the DB
   was cloned). Make a test bill — it lands in the **staging** database, not the live one.

### Your new everyday workflow
- **Test a change:** I commit it to the `staging` branch → you try it on `staging.smand.co`.
- **Happy with it:** merge `staging` → `main` (`git checkout main && git merge staging && git push`)
  → it deploys to the live site and auto-tags the release.

### Keeping staging fresh (optional, monthly)
Re-clone the live DB into the staging DB (repeat A-2's copy) whenever you want staging to mirror
current real data. Staging data is disposable — overwrite it freely.

---

## Notes
- **Sentry:** staging is auto-excluded from crash reporting, so test errors won't pollute your live
  Sentry feed (handled in code).
- **Costs nothing extra:** same hosting plan, same GitHub Actions minutes.
- If anything in Part A is unclear in your cPanel, screenshot it and I'll point at the exact button.
