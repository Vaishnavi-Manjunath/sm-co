#!/usr/bin/env python3
# Build backend/data/scoped_import.json — a SCOPED, ADDITIVE import:
#   - purchase + sales bills within [FROM, TO] only
#   - each party referenced by its legacy CODE (resolved via the legacy `party` table's
#     pname -> code map) so the server matches existing parties exactly by code
#   - per-party CLOSING balance (from the `master` running ledger) to overwrite outstanding
# No party creation, no products, no wipe. Pure read-only. Run with the open-tamil venv.
import subprocess, csv, json, re, sys
from collections import defaultdict
from datetime import datetime
from tamil import txt2unicode

MDB  = sys.argv[1]
OUT  = sys.argv[2]
FROM = sys.argv[3] if len(sys.argv) > 3 else "2026-06-16"
TO   = sys.argv[4] if len(sys.argv) > 4 else datetime.now().strftime("%Y-%m-%d")

def rows(t):
    o = subprocess.run(["mdb-export", MDB, t], capture_output=True).stdout.decode("utf-8", "replace")
    return list(csv.DictReader(o.splitlines()))
def ts(s):
    try: return txt2unicode.tscii2unicode((s or "").encode("latin-1", "ignore").decode("latin-1"))
    except Exception: return s or ""
def norm_ta(s):
    s = ts(s); s = re.sub(r'[¡¢£§]', '', s); return re.sub(r'\s+', ' ', s).strip()
def D(s):
    for fmt in ("%m/%d/%y %H:%M:%S", "%m/%d/%y"):
        try: return datetime.strptime((s or "").strip(), fmt).strftime("%Y-%m-%d")
        except Exception: pass
    return None
def f(x):
    try: return float(x or 0)
    except Exception: return 0.0

# legacy party table: raw pname -> code, and code -> tamil name (for the unmatched report)
party = rows("party")
code_by_pname = {}
name_by_code  = {}
for p in party:
    code = (p.get("code") or "").strip()
    if p.get("pname") and code:
        code_by_pname.setdefault(p["pname"], code)
        name_by_code.setdefault(code, norm_ta(p.get("pname")))

prod_codes = {(p.get("pcode") or "").strip() for p in rows("product")}

def party_ref(raw_name):
    """legacy code for a bill's party name (via the party table); name_ta for reporting."""
    code = code_by_pname.get(raw_name) or code_by_pname.get((raw_name or "").strip())
    return code, norm_ta(raw_name)

unmatched_names = {}   # name_ta -> raw (parties whose code we could not resolve)

# ---------- PURCHASE bills (farmer) ----------
pg = defaultdict(list)
for r in rows("purchase"):
    d = D(r.get("date"))
    if d and FROM <= d <= TO: pg[(d, r.get("refno"))].append(r)
purchases = []
for (d, refno), items in pg.items():
    h = items[0]
    code, nta = party_ref(h.get("formar", ""))
    its = []; sw = sa = tc = tco = tsu = trent = tadv = 0.0
    for r in items:
        pc = (r.get("pcode") or "").strip()
        if pc not in prod_codes: continue
        gross = f(r.get("amt")); comm = f(r.get("commission")); cooly = f(r.get("cooly"))
        sungam = f(r.get("sungam")); rent = f(r.get("rent")); adv = f(r.get("pattru"))
        wt = f(r.get("kgs")); bags = f(r.get("pack"))
        net = round(gross - comm - cooly - sungam - rent - adv, 2)
        its.append({"pcode": pc, "billed_weight": wt, "no_of_bags": bags, "purchase_rate": f(r.get("rate")),
                    "gross_amount": gross, "commission_amt": comm, "cooly_amt": cooly, "sungam_amt": sungam,
                    "advance_amt": adv, "net_amount": net})
        sw += wt; sa += gross; tc += comm; tco += cooly; tsu += sungam; trent += rent; tadv += adv
    if not its: continue
    if not code: unmatched_names[nta] = h.get("formar", "")
    purchases.append({
        "bill_no": "IMP-P" + d.replace("-", "") + "-" + str(refno),
        "bill_date": d, "party_code": code or "", "party_name_ta": nta, "party_type": "FARMER",
        "reference": re.sub(r'\(.*?\)', '', ts(h.get("formar", ""))).strip(),
        "subtotal_weight": round(sw, 2), "subtotal_amount": round(sa, 2),
        "total_commission": round(tc, 2), "total_cooly_amt": round(tco, 2),
        "total_sungam_amt": round(tsu, 2), "lorry_freight": round(trent, 2),
        "total_advance": round(tadv, 2),
        "net_payable": round(sa - tc - tco - tsu - trent - tadv, 2), "items": its,
    })

# ---------- SALES bills (vendor/customer) ----------
sg = defaultdict(list)
for r in rows("sales"):
    d = D(r.get("date"))
    if d and FROM <= d <= TO: sg[(d, r.get("bno"))].append(r)
sales = []
for (d, bno), items in sg.items():
    h = items[0]
    code, nta = party_ref(h.get("businessmen", ""))
    its = []; sw = sa = tdisc = tco = 0.0
    for r in items:
        pc = (r.get("staff") or "").strip()   # sales product code lives in `staff`
        if pc not in prod_codes: continue
        gross = f(r.get("amt")); disc = f(r.get("discount")); cooly = f(r.get("cooly"))
        wt = f(r.get("kgs")); bags = f(r.get("pack"))
        net = round(gross - disc - cooly, 2)
        its.append({"pcode": pc, "vendor_weight": wt, "no_of_bags": bags, "sale_rate": f(r.get("rate")),
                    "gross_amount": gross, "discount_amt": disc, "cooly_amt": cooly, "net_amount": net})
        sw += wt; sa += gross; tdisc += disc; tco += cooly
    if not its: continue
    if not code: unmatched_names[nta] = h.get("businessmen", "")
    sales.append({
        "bill_no": "IMP-S" + d.replace("-", "") + "-" + str(bno),
        "bill_date": d, "party_code": code or "", "party_name_ta": nta,
        "place": ts(h.get("st1", "")) or ts(h.get("city", "")),
        "subtotal_weight": round(sw, 2), "subtotal_amount": round(sa, 2),
        "discount_amt": round(tdisc, 2), "total_cooly_amt": round(tco, 2),
        "net_amount": round(sa - tdisc - tco, 2), "items": its,
    })

# ---------- CLOSING balance per party (full master ledger, current dues) ----------
bal = defaultdict(lambda: [0.0, 0.0])
for r in rows("master"):
    bal[r.get("particulars", "")][0] += f(r.get("debit"))
    bal[r.get("particulars", "")][1] += f(r.get("credit"))
closings = []
for raw, (dr, cr) in bal.items():
    code = code_by_pname.get(raw)
    c = round(dr - cr, 2)
    if not code or abs(c) < 0.005: continue
    closings.append({"code": code, "name_ta": name_by_code.get(code, norm_ta(raw)), "balance": c})

data = {"source": MDB.split("/")[-1], "from": FROM, "to": TO,
        "purchases": purchases, "sales": sales, "closings": closings}
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(data, fh, ensure_ascii=False)

print(f"=== scoped_import.json  [{FROM} .. {TO}] ===")
print(f"PURCHASE bills: {len(purchases)}  (unresolved code: {sum(1 for b in purchases if not b['party_code'])})")
print(f"SALES    bills: {len(sales)}  (unresolved code: {sum(1 for b in sales if not b['party_code'])})")
print(f"CLOSINGS: {len(closings)}  sum={round(sum(c['balance'] for c in closings),2)}")
print(f"Parties with no legacy code (will be in unmatched report): {len(unmatched_names)}")
for nta in list(unmatched_names)[:15]: print("   ·", nta)
