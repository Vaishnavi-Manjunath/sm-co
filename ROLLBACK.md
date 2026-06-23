# How to roll back the live site (plain English)

Every successful deploy is auto-tagged on GitHub as `release-YYYYMMDD-HHMM-<id>`.
To put the live site back to a previous version:

1. Open the repo on GitHub → **Actions** tab → **Deploy to Namecheap** → **Run workflow**.
2. In the **ref** box, type the previous release tag (see **Tags** in the repo, e.g.
   `release-20260620-1450-ab12cd3`) and click **Run workflow**.
3. Wait for the run to go green — the live site is now back on that version.

That's it. (A rollback run does **not** create a new tag, so your release history stays clean.
The very latest code is still on the `main` branch whenever you're ready to fix forward.)
