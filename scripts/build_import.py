import sys, csv, json, subprocess, re
from tamil import txt2unicode

F = sys.argv[1]
OUT = sys.argv[2]

def rows(t):
    out = subprocess.run(["mdb-export", F, t], capture_output=True).stdout.decode("utf-8", "replace")
    return list(csv.DictReader(out.splitlines()))

def tscii(s):
    if not s:
        return ""
    # mdb gave us UTF-8 of the original single bytes; recover bytes then TSCII->Unicode
    try:
        raw = s.encode("latin-1", "ignore")
    except Exception:
        raw = s.encode("utf-8", "ignore")
    try:
        u = txt2unicode.tscii2unicode(raw.decode("latin-1"))
    except Exception:
        u = s
    return u

def clean(s):
    s = (s or "").strip()
    s = re.sub(r'^[.\s;]+|[.\s;]+$', '', s)   # strip placeholder dots/semicolons
    s = re.sub(r'\s+', ' ', s)
    return s

CAT = {"FORMER": "FARMER", "CUSTOMER": "CUSTOMER", "MARKET FORMER": "MARKET_VENDOR"}
UNIT = {"KGS": "KG", "PACK": "BAG", "ALL": "KG"}

parties = []
for r in rows("party"):
    cat = r.get("category", "")
    if cat not in CAT:
        continue
    code = (r.get("code") or "").strip()
    name_ta = clean(tscii(r.get("pname", "")))
    # Farmers' real village is in st1 (city is a branch default = Oddanchatram); vendors use city.
    city_default = clean(tscii(r.get("city", "")))
    st1 = clean(tscii(r.get("st1", "")))
    city = (st1 or city_default) if CAT[cat] == "FARMER" else city_default
    opdebit = float(r.get("opdebit") or 0)
    parties.append({
        "code": code,
        "name_en": code,                 # legacy English code = our name_en (unique)
        "name_ta": name_ta,
        "category": CAT[cat],
        "city": city,
        "is_active": 1 if (r.get("active") or "1") not in ("0", "") else 0,
        "opening": round(opdebit, 2),    # vendor owes us (debit)
    })

products = []
for r in rows("product"):
    pcode = clean(r.get("pcode", ""))
    if not pcode:
        continue
    products.append({
        "code": pcode,
        "name_en": pcode,
        "name_ta": clean(tscii(r.get("pname", ""))),
        "unit_type": UNIT.get((r.get("category") or "").strip().upper(), "KG"),
    })

data = {
    "source": "rsmarketdata.MDB 31may",
    "parties": parties,
    "products": products,
    "stats": {
        "parties": len(parties),
        "vendors_with_opening": sum(1 for p in parties if p["opening"] > 0),
        "opening_total": round(sum(p["opening"] for p in parties), 2),
        "products": len(products),
    },
}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=1)
print(json.dumps(data["stats"], indent=2))
