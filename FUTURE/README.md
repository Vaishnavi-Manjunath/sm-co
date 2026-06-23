# IDNUK → SaaS — Future Plan

This folder holds the strategic plan to turn IDNUK (today: a single-tenant
mandi-management app running for *Sri Murugan & Co*) into a **self-service,
multi-tenant SaaS** sold at **idnuk.com**.

## What's here

| File | What it is |
|------|------------|
| **IDNUK-SaaS-Plan.html** | The presentation deck (open in a browser → Print → Save as PDF for the "ppt"). 21 slides: scope, options, architecture, hosting, costing, timeline, readiness, risks, decisions. |
| **IDNUK-SaaS-Plan.pdf** | Pre-rendered PDF of the deck (A4 landscape). |
| **architecture.md** | The engineering deep-dive: database-per-tenant model, the tenant resolver, control-plane schema, provisioning script, and exactly how the *current* data model stays untouched. |
| **costing-and-timeline.md** | Money + calendar: hosting cost at 1 / 50 / 200 tenants, unit economics, and the P0–P5 rollout schedule. |

## The recommendation in one paragraph

**Don't rewrite. Do move off shared hosting.** Adopt **database-per-tenant**
multi-tenancy: every customer gets their own clone of the *exact* schema you run
today, so the data model is preserved verbatim. The only code that changes is
*which* database name the app connects to — a hardcoded constant becomes a
per-tenant lookup. Add a thin **control plane** (signup, 14-day trial, Razorpay
subscription, tenant provisioning) in front. Host on a managed cloud (managed
MySQL + a small app server + Cloudflare) in an India region. Customisation is
**config/flags per tenant**, never code forks. Target **99.9% uptime**.
Timeline **~13–16 weeks** to GA; the pilot becomes **Tenant #1**.

## The four questions you asked, answered

1. **Rewrite the whole thing for scale?** → **No.** The app is fine; isolation
   and hosting are the gaps. A rewrite burns months and risks the working pilot.
2. **Change hosting location?** → **Yes.** Shared cPanel can't give you 99.9%,
   managed backups, or horizontal scale. Move to managed cloud.
3. **What model lets each customer have their own data/modules?** →
   **Database-per-tenant**, the cleanest fit for "don't touch my data model."
4. **How long?** → **~13–16 weeks** across 6 phases (P0–P5).

## Decisions needed from you (see last slide)

- Approve **Option B** (database-per-tenant) + the hosting move?
- Launch price — **₹799 / ₹999 / ₹1,499** per tenant/month?
- Build team — **1 senior + a part-timer**, or an agency?
- Cloud preference (**Hetzner / DigitalOcean / AWS**) and India region OK?
- Green-light **P0 (cloud foundation)** to start now?
