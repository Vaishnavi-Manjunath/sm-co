# IDNUK — Operations Runbook (for non-coders)

This is your "what to do if something breaks" guide. You do **not** need to know coding to
use it. Keep this file; print the first two pages if you like.

> Fill in the blanks marked `<...>` once (they don't change): your website address, your
> Namecheap login, and your phone contacts.

---

## 1. What this system is (in plain words)

- **The app** people use in the browser = a website hosted on **Namecheap** (cPanel shared hosting).
- **The data** (farmers, vendors, bills, payments) lives in a **MySQL database** on that same server.
- **The code** lives on **GitHub** (private repo: `smandco-odc/idnuk`).
- When code is changed and saved to GitHub's `main` branch, it **deploys automatically** to the
  live website in ~1 minute (via "GitHub Actions").

Key facts to record once:
- Live website: `https://<YOUR-DOMAIN>`
- Namecheap login: `https://www.namecheap.com` → account `<your-namecheap-email>`
- cPanel: from Namecheap dashboard → Hosting → **Manage** → cPanel
- GitHub: `https://github.com/smandco-odc/idnuk`

---

## 2. Is it up? (health check)

Open this in any browser: `https://<YOUR-DOMAIN>/api/health.php`

- You should see `{"success":true,"status":"ok","db":"ok"}` → **everything is fine.**
- `status:"down"` or it doesn't load → the **database or server has a problem** (see §5).

---

## 3. Take a backup (do this weekly, and before any big change)

1. Log into the app as **admin**.
2. Go to **Users & Permissions** (bottom-left).
3. Under **💾 Database backup**, click **Download backup now**.
4. A `.sql` file downloads. **Save it to Google Drive or email it to yourself.** Done.

> A backup is a complete copy of all your data at that moment. With it, nothing is ever truly lost.

---

## 3b. Regenerate `schema.sql` (the database map — after structure changes)

`schema.sql` in the project root is a readable map of every table and column (no data).
Refresh it whenever the database structure changes (new fields/tables). It's safe to share —
it contains **no customer data**.

1. Log into the app as **admin** → **Users & Permissions**.
2. Under **🗺️ Database map (schema only)**, click **Download schema.sql**.
3. Save the downloaded `schema.sql` into the **project root folder** (replacing the old one).
4. Commit it:  `git add schema.sql && git commit -m "Update schema.sql" && git push`

> This is documentation only — committing it never touches the live site or its data.
> (The `AUTO_INCREMENT` counters are stripped out, so re-downloading without structure
> changes produces an identical file.)

---

## 4. Restore data from a backup (if data is lost/corrupted)

> Only do this if data is genuinely broken and you have a backup `.sql` file.

1. cPanel → **phpMyAdmin**.
2. On the left, click the database (name starts with `smanwefl_`).
3. Top menu → **Import** → **Choose File** → pick your backup `.sql` → **Go**.
4. Wait for the green success message. Reload the app.

If you're unsure, **stop and call your developer** (§11) — restoring overwrites current data.

---

## 5. Common problems & fixes

### "The website won't open / shows an error"
1. Check the health URL (§2).
2. cPanel → **Errors** (or "Error Log") to see the latest message.
3. Most common cause after a change = a bad deploy. **Roll it back** (§6).
4. If health shows `db:error` → cPanel → **MySQL Databases** is the database there? Is the host
   account suspended (billing)? Check Namecheap billing/email.

### "Login says 'Too many failed attempts'"
- This is the **brute-force protection** working. Wait **15 minutes** and try again with the
  correct password. (It locks after 8 wrong tries from one location.)

### "Tamil names show ????"
- A table wasn't set to the right character set. This auto-fixes on use, but if a specific name
  shows `????`, open that farmer/vendor/product and **re-save** it. (Deeper fix: developer.)

### "It's slow"
1. First load of a big list (all farmers) is the slowest — after that it's cached for a few minutes.
2. cPanel → **Metrics → Resource Usage**: if you're hitting CPU/RAM limits often, you've outgrown
   shared hosting (see §8).

### "A number looks wrong (outstanding/profit)"
- Take a backup first (§3). Then check the specific bill/payment. Don't bulk-delete. Call developer.

### "I need to undo the legacy data import / start fresh"
- Users & Permissions → **Danger zone**. This **erases everything** and reloads the master data.
  **Take a backup first.** Only use if you really mean it.

---

## 6. Roll back a bad deploy (undo the last code change)

Every successful deploy is now auto-tagged (`release-YYYYMMDD-HHMM-<id>`), so you can redeploy
an older version directly — **one click, no code** (also in `ROLLBACK.md`):

1. GitHub repo → **Actions** tab → **Deploy to Namecheap** → **Run workflow**.
2. In the **ref** box, type a previous tag (see the repo's **Tags**, e.g.
   `release-20260620-1340-ee4bf6c`) → **Run workflow**.
3. Wait for green (~1–2 min) and re-check the health URL. The live site is back on that version.

A rollback run does **not** create a new tag, so your history stays clean; `main` still holds the
latest code for when you're ready to fix forward. ("Deploys never delete files" is configured, so a
rollback simply re-uploads the good version.)

---

## 7. Monitoring & alerts — get told *before* a customer notices

Set up a free uptime monitor (5 minutes, no coding):
1. Go to **https://uptimerobot.com** → create a free account.
2. **Add New Monitor** → Type: **HTTP(s)** → URL: `https://<YOUR-DOMAIN>/api/health.php`
   → Keyword: `ok` → Interval: 5 minutes.
3. Add your **email** and **phone/WhatsApp** as alert contacts.
4. Now if the site goes down, **you get a message within 5 minutes**, 24/7.

### Crash alerts via Sentry (emails you the exact error) — ON

Sentry is **wired in and live** (front-end via the loader script in `index.html`; back-end via the
PHP DSN baked into `backend/helpers/sentry.php`). Whenever the app crashes — in someone's browser
or on the server — it's reported to your Sentry project and Sentry **emails you within seconds**
with the exact error and where it happened.

- Your dashboard: **https://sentry.io** → log in → project under org `o4511495729577984`.
- Make sure **Alerts** email you on new issues (on by default).
- **To change the project** (new DSN): edit the loader `src` in `frontend/index.html` and the
  default DSN in `backend/helpers/sentry.php` (or define `SENTRY_DSN_PHP` in `config/database.php`).
- **To disable**: remove the `<script src="...sentry-cdn...">` line from `index.html`, and set
  `define('SENTRY_DSN_PHP','');` in `config/database.php`.

Code is also scanned for security issues automatically every week (GitHub → **Actions** →
"Security scan (Semgrep)" → open the latest run to read findings).

---

## 8. Keeping it fast & able to take load

- Already done: database indexes, slim data loads, and caching of big lists.
- Shared hosting is fine for a single shop with a handful of users at once.
- **If you grow** (many users at once, or resource-limit warnings in cPanel), the upgrade path is a
  **VPS** (e.g. Namecheap VPS, DigitalOcean, or AWS Lightsail). That gives more power, real
  automatic backups, and better uptime — but needs a developer to set up (a few hours, monthly cost).

---

## 9. Security checklist (ask your developer to do these once)

- [ ] **Rotate the database password** and remove the old `pilot_backup/config/database.php`
      from git history (a password was committed there earlier — repo is private, but rotate anyway).
- [ ] Confirm the site **forces HTTPS** (cPanel → Domains → "Force HTTPS Redirect" ON).
- [ ] Set a strong **admin password** in the app; give staff their own limited logins (not shared).
- [ ] Turn on **cPanel automatic backups** (cPanel → "Backup" / "Backup Wizard"), or set the nightly
      cron described in `backend/api/backup.php`.
- [ ] Review the weekly **Security scan** results in GitHub Actions.

---

## 10. Contingency & disaster recovery (read before go-live)

This covers the two big "what if" worries: **(A) the owner is unavailable and something needs
fixing**, and **(B) Namecheap itself goes down.** The good news up front:

> **Your app is just three independent things: the CODE (on GitHub), the DATA (a `.sql` backup),
> and any host that runs PHP + MySQL.** Nothing is uniquely trapped on one laptop or one host. If
> you can reach GitHub and have a recent backup, the whole system can be rebuilt anywhere.

### 10.1 Make sure more than one person can get in (do this BEFORE go-live)

Right now everything is tied to one person's accounts — that's the real risk, not the laptop.
Fix it once:

- [ ] **Give your computer engineer access to the code.** GitHub → repo → **Settings →
      Collaborators → Add people** → their GitHub username → role **Admin**. They can now fix and
      deploy **without your laptop** (even by editing a file on github.com).
- [ ] *(Better, optional)* Move the repo into a **GitHub Organisation with two owners** (you + the
      engineer) so no single locked account can shut everyone out.
- [ ] Turn on **2-factor authentication** on the GitHub account and **save the recovery codes** in
      the shared vault below.
- [ ] Put **every login in a shared password manager** (Bitwarden is free): GitHub, Namecheap,
      cPanel, FTP, database, domain registrar, Sentry, UptimeRobot. Repo access alone can't fix a
      *hosting/DB/DNS* problem — these are needed too.
- Where the auto-deploy keys live: GitHub → repo → **Settings → Secrets and variables → Actions**
  (`FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`). Keep a copy of these in the vault as well.

### 10.2 Scenario A — the owner is unavailable and the code needs a fix

For the engineer (needs the GitHub access from §10.1 — that's the only prerequisite):

1. Open `https://github.com/smandco-odc/idnuk`.
2. **Small fix:** click the file → pencil (✏️) icon → make the change → **Commit to `main`**. The
   site **auto-deploys in ~1 minute**. No laptop or FTP password needed.
3. **Bigger fix:** `git clone` the repo on any computer, change, then `git push origin main`.
4. If a change makes things worse → **revert** the bad commit (§6). Deploys never delete files, so
   rollback just re-uploads the last good version.
5. Confirm it worked on the **health URL** (§2).

### 10.3 Scenario B — Namecheap is down or the data is lost (full rebuild)

1. **Confirm what's wrong:** health URL (§2) fails; check namecheap.com status and your billing
   email. If it's a **billing/suspension** issue, pay/resolve it and the site comes back — stop here.
2. If the hosting is genuinely gone, **rebuild on a new host:**
   a. Get the **latest `.sql` backup** (from your off-site copies — see §10.4).
   b. Sign up for replacement hosting that runs **PHP 8 + MySQL** (another cPanel host, or a small
      VPS like DigitalOcean / Lightsail / Namecheap VPS).
   c. Create a **MySQL database + user**, then **import** the `.sql` (phpMyAdmin → Import).
   d. Put the new database host/name/user/password into **`backend/config/database.php` on the new
      server** (this file is deliberately NOT in GitHub, so it must be recreated by hand).
   e. Update the **GitHub Actions FTP secrets** (§10.1) to the new server's FTP details, then push
      any commit to `main` → the whole app deploys itself to the new server.
   f. **Repoint the domain** to the new server's IP address (your registrar / DNS → **A record**).
      Allow up to a few hours to spread worldwide — *much* faster if Cloudflare is in front.
   g. Check the **health URL** on the new server.

> Realistic downtime: a few hours, mostly DNS. **The off-site backup is what makes this possible —
> without it, any data since the last backup is gone.** That's why §10.4 matters.

### 10.4 Backups — automatic and off-site (the safety net for §10.3)

- Manual weekly backups (§3) are the bare minimum. **Before go-live, set up automatic *daily*
  off-site backups** so a crash loses at most one day of bills (your developer can add a scheduled
  job that pulls a nightly copy off the server).
- Always keep the **last 7 daily backups somewhere that is NOT Namecheap** (Google Drive, email,
  or a second cloud). If the backups only live on the server, a server crash takes them too.
- **Test a restore at least once** (§4) — a backup you've never restored is not yet proven.

---

## 11. Who to call

- **Developer / maintainer:** `<name>` — `<phone/email>`
- **Namecheap support:** live chat at namecheap.com (have your account email ready)
- **This repo:** `https://github.com/smandco-odc/idnuk`

> Golden rule when unsure: **take a backup first (§3), then change one thing at a time.**
