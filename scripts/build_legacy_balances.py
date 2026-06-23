#!/usr/bin/env python3
# Parse the "BALANCE LIST" Excel into backend/data/legacy_balances.json:
#   each party's code (Particulars) + signed balance (Total, "Dr" = +, "Cr" = -).
# Used by admin?action=set-legacy-balances to set opening balances as of a cutoff date.
import openpyxl, json, re, sys

XLSX = sys.argv[1] if len(sys.argv) > 1 else "/Users/manjunathsekar/Downloads/LegacyBook1.xlsx"
OUT  = sys.argv[2] if len(sys.argv) > 2 else "/Users/manjunathsekar/Documents/IDNUK/backend/data/legacy_balances.json"
ASOF = sys.argv[3] if len(sys.argv) > 3 else "2026-06-19"

def parse_bal(s):
    if s is None: return None
    s = str(s).strip()
    m = re.match(r'^([\d,]+(?:\.\d+)?)\s*(Dr|Cr)?$', s, re.I)
    if not m: return None
    v = float(m.group(1).replace(',', ''))
    return -v if (m.group(2) or '').lower() == 'cr' else v

wb = openpyxl.load_workbook(XLSX, data_only=True)
ws = wb["Sheet1"]
rows = []
for r in ws.iter_rows(min_row=6, values_only=True):
    sno, code, opening, debit, credit, total = (list(r) + [None] * 6)[:6]
    code = (str(code).strip() if code is not None else "")
    if not code or code.lower() == "total":   # skip blanks + footer total
        continue
    bal = parse_bal(total if total not in (None, "", " ") else opening)
    if bal is None:
        continue
    rows.append({"code": code, "balance": round(bal, 2)})

data = {"source": XLSX.split("/")[-1], "as_of": ASOF, "balances": rows}
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(data, fh, ensure_ascii=False)
print(f"=== legacy_balances.json  (as of {ASOF}) ===")
print(f"customers: {len(rows)}   total: {round(sum(r['balance'] for r in rows), 2)}")
print(f"debit(owe us): {sum(1 for r in rows if r['balance'] > 0)}   credit(advance): {sum(1 for r in rows if r['balance'] < 0)}")
