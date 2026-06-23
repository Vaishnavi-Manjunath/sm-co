# Costing & Timeline

> Figures are planning estimates (mid-2026, INR ≈ ₹83/USD). Treat as ranges,
> not quotes. They're sized for **first wave = 200 tenants**.

---

## 1. Monthly infrastructure cost

Database-per-tenant is cheap to host because 200 small mandi databases share a
single managed MySQL instance and one or two small app servers. The cost driver
is the *instance tier*, not the tenant count.

| Component | 1 tenant (pilot) | ~50 tenants | ~200 tenants |
|---|---|---|---|
| App server(s) | 1× small ($12–24) | 1× medium ($24–48) | 2× medium (HA) ($60–100) |
| Managed MySQL | shared small ($15–30) | medium ($40–80) | HA medium/large ($120–200) |
| Object storage (backups) | ~$2 | ~$5 | ~$10–20 |
| Cloudflare (CDN/WAF) | Free–$20 | $20 | $20–60 |
| Email/SMS/WhatsApp (txn) | ~$5 | ~$15 | ~$40 |
| Monitoring/logs/Sentry | Free–$10 | $20 | $30–60 |
| **Total / month** | **~$45–90** | **~$125–210** | **~$280–480** |

At 200 tenants the infra is **~$280–480/mo (~₹23k–40k)** — i.e. roughly **₹120–200
per tenant per month** in raw infra, falling as you fill the instances.

**Cloud options:** Hetzner (cheapest, EU; has no India region — latency tradeoff),
DigitalOcean / Linode (mid, has Bengaluru region — good fit), AWS Mumbai
(priciest, most enterprise-credible, India region). Recommendation:
**DigitalOcean Bengaluru** for the India region + managed MySQL + low ops
overhead; AWS Mumbai if a customer ever demands it.

---

## 2. Unit economics (illustrative)

Assume a blended **₹999 / tenant / month** (mix of ₹799 and ₹1,499 plans).

| | Per tenant / mo |
|---|---|
| Revenue | ₹999 |
| Less 18% GST (you remit) | −₹152 (₹847 net) |
| Less payment gateway (~2%) | −₹17 |
| Less infra (at 200 scale) | −₹150 |
| Less support/ops (amortised) | −₹120 |
| **Contribution** | **~₹560 (~66%)** |

At **200 tenants**: ~₹2.0L/mo gross, ~₹1.1L/mo contribution after the above —
before your own salary/build payback. Margins improve as instances fill and
support gets templated. (Earlier 83% figure was infra-only gross margin; the
~66% here is after GST + gateway + support, which is the number to plan on.)

> ⚠️ **GST reminder:** vegetable produce is GST-exempt, but **SaaS software is
> taxable at 18%**. Price *inclusive* or *plus GST* explicitly, register for GST,
> and remit. This is separate from your mandi customers' own tax position.

**Break-even on build:** if build cost is ~₹8–12L (see §4), payback at ~₹560
contribution/tenant is roughly **200 tenants × ~7–11 months**, or fewer tenants
over a longer ramp. Comfortable for a first wave of 200.

---

## 3. Timeline — P0 to P5 (~13–16 weeks to GA)

| Phase | Weeks | What ships |
|---|---|---|
| **P0 — Cloud foundation** | 1–2 | Managed cloud account, managed MySQL, app server, CI/CD to new host, Cloudflare, domains (idnuk.com, app/*.idnuk.com), HTTPS, monitoring. |
| **P1 — Multi-tenancy** | 3–5 | `idnuk_control` DB, `tenant.php` resolver, `DB_NAME`→resolver, `schema.sql` + provisioning script, migration runner across tenant DBs. Pilot runs as **Tenant #1** on new infra. |
| **P2 — Billing** | 6–7 | Razorpay subscriptions, 14-day trial logic, trial-end gate (HTTP 402), webhooks → `subscriptions` table, dunning for `past_due`. GST-correct invoicing. |
| **P3 — Self-service** | 8–10 | Public signup at idnuk.com, auto-provision on signup, onboarding wizard (company, products seed, first user), `tenant_features` config UI. |
| **P4 — Hardening** | 11–13 | Per-tenant backups + restore drills, load test to 200 tenants, security review (isolation, secrets, DPDP), SLA instrumentation, status page, runbooks. |
| **P5 — Beta → GA** | 14–16 | 5–10 design-partner mandis, fix, then open GA. Support process + docs. |

Phases overlap in practice; **~13–16 weeks** end-to-end with 1 senior engineer
(+ part-time help in P3/P4). An agency could compress P0–P2 but costs more.

---

## 4. Build cost (one-time)

| Path | Cost (one-time) | Notes |
|---|---|---|
| **1 senior eng (3–4 mo) + part-timer** | **~₹8–12L** | Recommended. You retain knowledge; cheapest steady state. |
| Agency / studio | ~₹15–30L | Faster start, less control, ongoing dependency. |
| You + 1 junior | ~₹4–7L | Cheapest, slowest, highest risk to the live pilot. |

---

## 5. SLA tiers

| Tier | Uptime | Downtime/mo | What it needs |
|---|---|---|---|
| Shared cPanel (today) | ~"best effort" | hours | nothing — but can't promise customers |
| **99.0%** | 99.0% | ~7.2 hrs | single app server + managed DB + monitoring |
| **99.9% (recommended)** | 99.9% | ~43 min | 2 app servers behind LB, managed DB w/ failover, Cloudflare, on-call + status page |

You asked for **99% uptime** as the floor; the recommended target is **99.9%**,
which is the credible "commercial SaaS" number and only modestly more infra
(the HA row in §1). Publish a status page either way.

---

## 6. Cost summary

- **One-time build:** ~₹8–12L (recommended path).
- **Run-rate at 200 tenants:** ~₹23k–40k/mo infra.
- **Revenue at 200 tenants @ ₹999:** ~₹2.0L/mo gross.
- **Net contribution:** ~₹1.1L/mo after GST, gateway, infra, support.
- **Payback:** comfortably inside the first wave.

See **architecture.md** for *how*, and **IDNUK-SaaS-Plan.html** for the full deck.
