#!/usr/bin/env python3
# Build backend/data/bills_import.json from the legacy rsmarketdata.MDB:
#  - historical purchase + sales bills (Apr 1 - May 31 2026) with exact date/name/product/rate/amount
#  - the 31-May CLOSING balance per party (from the legacy running ledger `master`)
#  - any farmer/vendor names missing from the current party list (to auto-create)
# Pure read-only. Writes one JSON file. Run with the open-tamil venv python.
import subprocess, csv, json, re, sys, os
from collections import defaultdict
from datetime import datetime
from tamil import txt2unicode

MDB = sys.argv[1] if len(sys.argv) > 1 else "/Users/manjunathsekar/Documents/SM&CO/LEGACY DATA/31may/rsmarketdata.MDB"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/Users/manjunathsekar/Documents/IDNUK/backend/data/bills_import.json"
MASTER = "/Users/manjunathsekar/Documents/IDNUK/backend/data/import_master.json"

def rows(t):
    out = subprocess.run(["mdb-export", MDB, t], capture_output=True).stdout.decode("utf-8", "replace")
    return list(csv.DictReader(out.splitlines()))
def ts(s):
    if not s: return ""
    try: return txt2unicode.tscii2unicode(s.encode("latin-1", "ignore").decode("latin-1"))
    except Exception: return s
def norm_ta(s):
    s = ts(s); s = re.sub(r'\(.*?\)', '', s)
    s = re.sub(r'[¡¢£§;.\-\s]+$', '', s); s = re.sub(r'^[¡¢£§;.\-\s]+', '', s)
    s = re.sub(r'[¡¢£§]', '', s); return re.sub(r'\s+', ' ', s).strip()
def stripagent(s): return re.sub(r'\(.*?\)', '', s or '').strip().rstrip('-').strip()
def D(s):
    try: return datetime.strptime((s or '').strip(), "%m/%d/%y %H:%M:%S").strftime("%Y-%m-%d")
    except Exception:
        try: return datetime.strptime((s or '').strip(), "%m/%d/%y").strftime("%Y-%m-%d")
        except Exception: return None
def f(x):
    try: return float(x or 0)
    except Exception: return 0.0

cur = json.load(open(MASTER))
# current parties: normalized name_ta -> code (first wins)
code_by_nta = {}
cur_codes = set()
for p in cur["parties"]:
    cur_codes.add(p["code"])
    k = norm_ta(p["name_ta"]) if p["name_ta"] else ""
    # name_ta already unicode in master; normalize lightly
    k2 = re.sub(r'[¡¢£§;.\-\s]+$', '', p["name_ta"] or ''); k2 = re.sub(r'[¡¢£§]', '', k2); k2 = re.sub(r'\s+', ' ', k2).strip()
    for kk in {k2}:
        if kk and kk not in code_by_nta: code_by_nta[kk] = p["code"]
prod_codes = {p["code"] for p in cur["products"]}

# legacy party table: raw pname -> code (for closing-balance mapping), and norm name -> code
leg = rows("party")
code_by_rawpname = {}
for p in leg:
    if p.get("pname"): code_by_rawpname.setdefault(p["pname"], (p.get("code") or "").strip())

DATE_MIN, DATE_MAX = "2026-04-01", "2026-06-30"   # wide window; as_of is the latest bill date found
new_parties = {}   # code -> {...}
def resolve_party(name_ta_norm, category, billbook=None, city=""):
    """Return a current/created party code for a bill's party name."""
    if name_ta_norm in code_by_nta:
        return code_by_nta[name_ta_norm]
    # build a stable new code
    base = stripagent(billbook).upper() if billbook else ""
    base = re.sub(r'[^A-Z0-9 .&\-]', '', base).strip()
    if not base:
        base = ("LGF" if category == "FARMER" else "LGV")
    code = base
    i = 1
    while code in cur_codes or (code in new_parties and new_parties[code]["name_ta"] != name_ta_norm):
        i += 1; code = f"{base}-{i}"
    if code not in new_parties:
        new_parties[code] = {"code": code, "name_en": base or code, "name_ta": name_ta_norm,
                             "category": category, "city": city}
        cur_codes.add(code)
    code_by_nta[name_ta_norm] = code
    return code

# ---------- PURCHASE bills ----------
pur = rows("purchase")
pg = defaultdict(list)
for r in pur:
    d = D(r["date"])
    if not d or not (DATE_MIN <= d <= DATE_MAX): continue
    pg[(d, r["refno"])].append(r)
purchases = []
pur_skip_prod = 0
for (d, refno), items in pg.items():
    h = items[0]
    pcode = resolve_party(norm_ta(h.get("formar", "")), "FARMER", h.get("billbook"), ts(h.get("outlet", "")))
    its = []; sw = sa = tc = tco = tsa = tsu = trent = 0.0
    bad = False
    for r in items:
        pc = (r.get("pcode") or "").strip()
        if pc not in prod_codes: bad = True; continue
        gross = f(r["amt"]); comm = f(r["commission"]); cooly = f(r["cooly"]); sungam = f(r["sungam"])
        rent = f(r["rent"]); sakku = f(r["sakkuamt"]); wt = f(r["kgs"]); bags = f(r["pack"])
        net = round(gross - comm - cooly - sungam - rent - sakku, 2)
        its.append({"pcode": pc, "billed_weight": wt, "no_of_bags": bags, "purchase_rate": f(r["rate"]),
                    "gross_amount": gross, "commission_amt": comm, "cooly_amt": cooly, "sungam_amt": sungam,
                    "sakku_qty": f(r["sakkuqty"]), "sakku_rate": f(r["sakkurate"]), "sakku_amt": sakku, "net_amount": net})
        sw += wt; sa += gross; tc += comm; tco += cooly; tsa += sakku; tsu += sungam; trent += rent
    if not its: 
        if bad: pur_skip_prod += 1
        continue
    net_pay = round(sa - tc - tco - tsa - tsu - trent, 2)
    purchases.append({
        "bill_no": "LP" + d.replace("-", "") + "-" + str(refno),
        "bill_date": d, "party_code": pcode, "party_type": "FARMER",
        "reference": stripagent(ts(h.get("formar", ""))) or "",
        "subtotal_weight": round(sw, 2), "subtotal_amount": round(sa, 2),
        "total_commission": round(tc, 2), "total_cooly_amt": round(tco, 2),
        "total_sakku_amt": round(tsa, 2), "total_sungam_amt": round(tsu, 2),
        "lorry_freight": round(trent, 2), "net_payable": net_pay, "items": its,
    })

# ---------- SALES bills ----------
sal = rows("sales")
sg = defaultdict(list)
for r in sal:
    d = D(r["date"])
    if not d or not (DATE_MIN <= d <= DATE_MAX): continue
    sg[(d, r["bno"])].append(r)
sales = []
for (d, bno), items in sg.items():
    h = items[0]
    pcode = resolve_party(norm_ta(h.get("businessmen", "")), "CUSTOMER", None, ts(h.get("city", "")))
    its = []; sw = sa = tdisc = tco = tsa = 0.0
    for r in items:
        pc = (r.get("staff") or "").strip()   # sales stores the English product code in `staff`
        if pc not in prod_codes: continue
        gross = f(r["amt"]); disc = f(r["discount"]); cooly = f(r["cooly"]); sakku = f(r["sakkuamt"])
        wt = f(r["kgs"]); bags = f(r["pack"])
        net = round(gross - disc - cooly - sakku, 2)
        its.append({"pcode": pc, "vendor_weight": wt, "no_of_bags": bags, "sale_rate": f(r["rate"]),
                    "gross_amount": gross, "discount_amt": disc, "cooly_amt": cooly,
                    "sakku_qty": f(r["sakkuqty"]), "sakku_rate": f(r["sakkurate"]), "sakku_amt": sakku, "net_amount": net})
        sw += wt; sa += gross; tdisc += disc; tco += cooly; tsa += sakku
    if not its: continue
    net_amt = round(sa - tdisc - tsa - tco, 2)
    sales.append({
        "bill_no": "LS" + d.replace("-", "") + "-" + str(bno),
        "bill_date": d, "party_code": pcode, "place": ts(h.get("st1", "")) or ts(h.get("city", "")),
        "subtotal_weight": round(sw, 2), "subtotal_amount": round(sa, 2),
        "discount_amt": round(tdisc, 2), "total_sakku_amt": round(tsa, 2), "total_cooly_amt": round(tco, 2),
        "net_amount": net_amt, "items": its,
    })

# ---------- CLOSING balance per party (from master ledger) ----------
m = rows("master")
bal = defaultdict(lambda: [0.0, 0.0])  # particulars -> [debit, credit]
for r in m:
    bal[r.get("particulars", "")][0] += f(r.get("debit"))
    bal[r.get("particulars", "")][1] += f(r.get("credit"))
closings = []
unmapped_close = 0; unmapped_total = 0.0
for raw, (dr, cr) in bal.items():
    code = code_by_rawpname.get(raw)
    closing = round(dr - cr, 2)
    if abs(closing) < 0.005: continue
    if code and code in {p["code"] for p in cur["parties"]}:
        closings.append({"code": code, "balance": closing})
    else:
        unmapped_close += 1; unmapped_total += closing

as_of = max([b["bill_date"] for b in purchases] + [b["bill_date"] for b in sales] + [DATE_MIN])
data = {
    "source": os.path.basename(MDB), "as_of": as_of,
    "range": [DATE_MIN, as_of],
    "new_parties": list(new_parties.values()),
    "purchases": purchases, "sales": sales, "closings": closings,
}
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(data, fh, ensure_ascii=False)

# ---------- STATS ----------
def tot(bs, k): return round(sum(b[k] for b in bs), 2)
print("=== bills_import.json written ===")
print("PURCHASE bills:", len(purchases), " lines:", sum(len(b["items"]) for b in purchases),
      " gross:", tot(purchases, "subtotal_amount"), " net_payable:", tot(purchases, "net_payable"))
print("SALES    bills:", len(sales), " lines:", sum(len(b["items"]) for b in sales),
      " gross:", tot(sales, "subtotal_amount"), " net:", tot(sales, "net_amount"))
print("NEW parties to create:", len(new_parties),
      " (farmers:", sum(1 for p in new_parties.values() if p['category']=='FARMER'),
      " vendors:", sum(1 for p in new_parties.values() if p['category']=='CUSTOMER'), ")")
print("CLOSINGS mapped:", len(closings), " sum:", round(sum(c['balance'] for c in closings), 2),
      " | unmapped:", unmapped_close, "sum", round(unmapped_total, 2))
print("purchase bills skipped (no known product):", pur_skip_prod)
