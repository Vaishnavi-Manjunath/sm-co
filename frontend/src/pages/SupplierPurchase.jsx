// ============================================================
//  SUPPLIER PURCHASE — our own-account capital buys from out-of-town
//  suppliers. Unlike Farmer Purchase (which DEDUCTS commission), here
//  freight / market charges / middleman commission are ADDED on top of
//  the goods value to get the landed cost we owe the supplier.
// ============================================================
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { api, apiCached, fmt, SearchableSelect, getPrintTemplate, getWorkingDate } from "../App.jsx";

const inp = { width: "100%", padding: "9px 10px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box" };
const lbl = { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4 };
const num = v => parseFloat(v || 0) || 0;

function newItem() { return { product_id: "", product_name: "", unit_type: "KG", no_of_bags: "", weight: "", rate: "" }; }
function newBill() {
  return { party_id: "", party_name: "", city: "", items: [newItem()], freight: "", market_charges: "", middleman_comm: "", other_charges: "", paid_amount: "", notes: "" };
}

function itemQty(it) { return (it.unit_type || "KG").toUpperCase() === "BAG" ? num(it.no_of_bags) : num(it.weight); }
function itemAmt(it) { return Math.round(itemQty(it) * num(it.rate) * 100) / 100; }

// Enter / Tab → focus the next cell in the same row (keyboard-driven entry, like Farmer Purchase).
function advance(e, rowSel, nextSel) {
  if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
    e.preventDefault();
    e.target.closest(rowSel)?.querySelector(nextSel)?.focus();
  }
}

export default function SupplierPurchasePage() {
  const [date, setDate]       = useState(getWorkingDate());
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts]   = useState([]);
  const [bill, setBill]       = useState(newBill());
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving]   = useState(false);
  const [bills, setBills]     = useState([]);
  const [printBill, setPrintBill] = useState(null);
  const [view, setView]       = useState("form");   // form | list | pending
  const [staged, setStaged]   = useState([]);        // pending lines from Orders procurement
  const [stagedIds, setStagedIds] = useState([]);    // staged ids being billed in the current form

  useEffect(() => {
    const h = (e) => setDate(e.detail);
    window.addEventListener("rsm-working-date", h);
    return () => window.removeEventListener("rsm-working-date", h);
  }, []);

  // Land the cursor on the supplier box when the form opens.
  useEffect(() => { if (view === "form") setTimeout(() => document.querySelector(".supplier-sel")?.focus(), 120); }, [view]);

  useEffect(() => {
    Promise.all([
      apiCached("parties?action=list&category=SUPPLIER&cols=lite"),
      apiCached("parties?action=list&category=MARKET_SUPPLIER&cols=lite"),
      api(`products?action=rates&date=${date}`),
    ]).then(([su, ms, pr]) => {
      const seen = new Set();
      setSuppliers([...su.data, ...ms.data].filter(x => !seen.has(x.id) && seen.add(x.id)));
      setProducts(pr.data);
    }).catch(() => {});
    loadBills();
    loadStaged();
  }, [date]);

  const loadBills = () => api(`supplier?action=list&from=${date}&to=${date}`).then(r => setBills(r.data || [])).catch(() => {});
  // All unbilled pending lines (from Orders → Procurement), across dates.
  const loadStaged = () => api("supplier?action=staged&billed=0").then(r => setStaged(r.data || [])).catch(() => {});

  // Group pending lines into one draft bill per source party.
  const pendingByParty = (() => {
    const m = {};
    staged.forEach(s => { (m[s.party_id] = m[s.party_id] || { party_id: s.party_id, party_name: s.party_name, items: [] }).items.push(s); });
    return Object.values(m).sort((a, b) => (a.party_name || "").localeCompare(b.party_name || ""));
  })();

  // Load a party's pending lines into the bill form (rate stays editable; blank where unknown).
  const billFromPending = (g) => {
    setEditingId(null);
    setStagedIds(g.items.map(it => it.id));
    setBill({
      party_id: g.party_id, party_name: g.party_name, city: "",
      items: g.items.map(it => ({ product_id: it.product_id, product_name: it.product_name,
        unit_type: (it.unit_type || "KG").toUpperCase(),
        no_of_bags: num(it.no_of_bags) || "", weight: num(it.weight) || "", rate: it.rate == null ? "" : (num(it.rate) || "") })),
      freight: "", market_charges: "", middleman_comm: "", other_charges: "", paid_amount: "", notes: "",
    });
    // The source is a Customer / Market vendor, not in the supplier dropdown — add it so it shows.
    setSuppliers(prev => prev.some(s => String(s.id) === String(g.party_id)) ? prev : [...prev, { id: g.party_id, name_en: g.party_name, city: "" }]);
    setView("form");
    window.scrollTo(0, 0);
  };

  const deletePending = async (it) => {
    if (!window.confirm(`Remove pending "${it.product_name}" (${num(it.no_of_bags)} bags) from ${it.party_name}?`)) return;
    try { await api("supplier?action=delete-staged", { method: "POST", body: JSON.stringify({ id: it.id }) }); loadStaged(); }
    catch (e) { alert(e.message); }
  };

  const goods = bill.items.reduce((a, it) => a + itemAmt(it), 0);
  const charges = num(bill.freight) + num(bill.market_charges) + num(bill.middleman_comm) + num(bill.other_charges);
  const total = Math.round((goods + charges) * 100) / 100;

  const setItem = (i, patch) => setBill(b => ({ ...b, items: b.items.map((it, j) => j === i ? { ...it, ...patch } : it) }));
  const pickProduct = (i, id, opt) => {
    const p = products.find(x => String(x.product_id) === String(id));
    setItem(i, { product_id: id, product_name: opt?.label || p?.name_en || "", unit_type: p?.unit_type || "KG",
                 rate: p?.market_rate || "" });
  };
  const addRow = () => setBill(b => ({ ...b, items: [...b.items, newItem()] }));
  const delRow = (i) => setBill(b => ({ ...b, items: b.items.length > 1 ? b.items.filter((_, j) => j !== i) : b.items }));

  const reset = () => { setBill(newBill()); setEditingId(null); setStagedIds([]); };

  const save = async (printAfter) => {
    if (!bill.party_id) { alert("Select a supplier"); return; }
    const rows = bill.items.filter(it => it.product_id && (num(it.no_of_bags) || num(it.weight)) && num(it.rate));
    if (!rows.length) { alert("Add at least one product with quantity and rate"); return; }
    setSaving(true);
    const payload = {
      id: editingId || undefined, bill_date: date, party_id: bill.party_id,
      items: rows.map(it => ({ product_id: it.product_id, unit_type: it.unit_type,
        no_of_bags: num(it.no_of_bags), weight: num(it.weight), rate: num(it.rate) })),
      freight: num(bill.freight), market_charges: num(bill.market_charges),
      middleman_comm: num(bill.middleman_comm), other_charges: num(bill.other_charges),
      paid_amount: num(bill.paid_amount), notes: bill.notes || null,
      staged_ids: (!editingId && stagedIds.length) ? stagedIds : undefined,
    };
    try {
      const r = await api(`supplier?action=${editingId ? "update" : "save"}`, { method: "POST", body: JSON.stringify(payload) });
      const d = r.data || r;   // respond() wraps the result in { success, data }
      const supplier = suppliers.find(s => String(s.id) === String(bill.party_id));
      if (printAfter) setPrintBill({ ...payload, bill_no: d.bill_no, total_cost: d.total_cost, balance_due: d.balance_due,
        goods_amount: goods, party_name: supplier?.name_en, party_name_ta: supplier?.name_ta, city: supplier?.city,
        rows: rows.map(it => ({ ...it, amount: itemAmt(it), product_name: it.product_name })) });
      reset();
      loadBills();
      loadStaged();
    } catch (e) { alert(e.message || "Save failed"); }
    finally { setSaving(false); }
  };

  const editBill = async (id) => {
    try {
      const r = await api(`supplier?action=get&id=${id}`);
      const d = r.data;
      setEditingId(id);
      setBill({ party_id: d.party_id, party_name: d.party_name,
        city: d.city || suppliers.find(s => String(s.id) === String(d.party_id))?.city || "",
        items: d.items.map(it => ({ product_id: it.product_id, product_name: it.product_name, unit_type: it.unit_type,
          no_of_bags: it.unit_type === "BAG" ? it.no_of_bags : "", weight: it.weight, rate: it.rate })),
        freight: d.freight, market_charges: d.market_charges, middleman_comm: d.middleman_comm,
        other_charges: d.other_charges, paid_amount: d.paid_amount, notes: d.notes || "" });
      setView("form");
      window.scrollTo(0, 0);
    } catch (e) { alert(e.message); }
  };

  const cancelBill = async (id, no) => {
    if (!window.confirm(`Cancel supplier bill ${no}? This removes it from the supplier's ledger.`)) return;
    try { await api("supplier?action=cancel", { method: "POST", body: JSON.stringify({ id }) }); loadBills(); }
    catch (e) { alert(e.message); }
  };

  const supplierOpts = suppliers.map(s => ({ id: s.id, label: s.name_en + (s.city ? ` · ${s.city}` : "") }));
  const productOpts = products.map(p => ({ id: p.product_id, label: p.name_en }));

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>🚚 Supplier Purchase</h1>
        <span style={{ fontSize: 12, color: "#888" }}>Own-account buys · charges added to cost</span>
        <div style={{ flex: 1 }} />
        <div><label style={lbl}>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inp, width: 160 }} /></div>
        <div style={{ display: "flex", gap: 6, alignSelf: "flex-end" }}>
          <button onClick={() => setView("form")} style={tabBtn(view === "form")}>New / Edit</button>
          <button onClick={() => setView("pending")} style={tabBtn(view === "pending")}>📦 Pending ({staged.length})</button>
          <button onClick={() => setView("list")} style={tabBtn(view === "list")}>Today's bills ({bills.length})</button>
        </div>
      </div>

      {view === "form" && (
        <div style={{ background: "white", border: "1px solid #eef2f7", borderRadius: 12, padding: 20 }}>
          {editingId && <div style={{ marginBottom: 12, padding: "8px 12px", background: "#fef9c3", borderRadius: 8, fontSize: 13, color: "#92400e" }}>✏️ Editing an existing bill — saving keeps the same bill number.</div>}
          {!editingId && stagedIds.length > 0 && <div style={{ marginBottom: 12, padding: "8px 12px", background: "#f3e8ff", borderRadius: 8, fontSize: 13, color: "#6b21a8" }}>📦 Billing {stagedIds.length} pending line{stagedIds.length === 1 ? "" : "s"} from Orders — set the rates, then Save bill to confirm. They'll clear from Pending.</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 12, marginBottom: 16, maxWidth: 640 }}>
            <div>
              <label style={lbl}>Supplier</label>
              <SearchableSelect className="supplier-sel" value={bill.party_id} options={supplierOpts} placeholder="Type supplier name…"
                onChange={(id, opt) => {
                  const s = suppliers.find(x => String(x.id) === String(id));
                  setBill(b => ({ ...b, party_id: id, party_name: s?.name_en || opt?.label || "", city: s?.city || "" }));
                }}
                onAdvance={() => document.querySelector(".sup-prod")?.focus()} style={inp} />
              <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>Not listed? Add them under Parties → Supplier first.</div>
            </div>
            <div>
              <label style={lbl}>City / Town</label>
              <input value={bill.city || ""} readOnly placeholder="— auto from supplier —"
                style={{ ...inp, background: "#f9fafb", color: "#555" }} />
            </div>
          </div>

          {/* Item lines — Enter/Tab walks Product → Bags → Weight → Rate → next row */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(170px,1fr) 60px 84px 100px 100px 120px 34px", gap: 8, padding: "0 2px 6px", borderBottom: "1px solid #eef2f7" }}>
              {["Product", "Unit", "Bags", "Weight (kg)", "Rate ₹", "Amount ₹", ""].map((h, i) =>
                <span key={i} style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: i >= 2 && i <= 5 ? "right" : (i === 1 ? "center" : "left") }}>{h}</span>)}
            </div>
            {bill.items.map((it, i) => (
              <div key={i} className="sup-row" style={{ display: "grid", gridTemplateColumns: "minmax(170px,1fr) 60px 84px 100px 100px 120px 34px", gap: 8, alignItems: "center", padding: "6px 2px" }}>
                <SearchableSelect className="sup-prod" value={it.product_id} options={productOpts} placeholder="Product…"
                  onChange={(id, opt) => pickProduct(i, id, opt)}
                  onAdvance={(el) => el.closest(".sup-row")?.querySelector(".sup-bag")?.focus()}
                  style={{ ...inp, padding: "7px 8px", fontSize: 13 }} />
                <span style={{ fontSize: 12, color: "#666", textAlign: "center" }}>{it.unit_type}</span>
                <input className="sup-bag" type="number" value={it.no_of_bags} onChange={e => setItem(i, { no_of_bags: e.target.value })}
                  onKeyDown={e => advance(e, ".sup-row", ".sup-wt")}
                  style={{ ...inp, textAlign: "right", padding: "7px 8px" }} />
                <input className="sup-wt" type="number" value={it.weight} onChange={e => setItem(i, { weight: e.target.value })}
                  onKeyDown={e => advance(e, ".sup-row", ".sup-rate")}
                  style={{ ...inp, textAlign: "right", padding: "7px 8px" }} />
                <input className="sup-rate" type="number" value={it.rate} onChange={e => setItem(i, { rate: e.target.value })}
                  onKeyDown={e => {
                    if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                      e.preventDefault();
                      const next = document.querySelectorAll(".sup-prod")[i + 1];
                      if (next) { next.focus(); return; }
                      addRow();
                      setTimeout(() => { const s = document.querySelectorAll(".sup-prod"); s[s.length - 1]?.focus(); }, 40);
                    }
                  }}
                  style={{ ...inp, textAlign: "right", padding: "7px 8px" }} />
                <span style={{ textAlign: "right", fontWeight: 600 }}>{fmt.currency(itemAmt(it))}</span>
                <button onClick={() => delRow(i)} style={{ background: "#fee2e2", border: "none", borderRadius: 6, color: "#dc2626", padding: "6px 9px", cursor: "pointer" }}>✕</button>
              </div>
            ))}
          </div>
          <button onClick={addRow} style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, color: "#16a34a", fontWeight: 600, padding: "8px 14px", cursor: "pointer", fontSize: 13, marginBottom: 18 }}>+ Add product</button>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#b45309" }}>Charges (added to cost)</div>
              {[["freight", "Freight / lorry"], ["market_charges", "Market charges"], ["middleman_comm", "Middleman commission"], ["other_charges", "Other charges"]].map(([k, label]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <label style={{ ...lbl, marginBottom: 0, flex: 1 }}>{label}</label>
                  <input type="number" value={bill[k]} onChange={e => setBill(b => ({ ...b, [k]: e.target.value }))} style={{ ...inp, textAlign: "right", width: 140 }} />
                </div>
              ))}
              <div style={{ marginTop: 12 }}>
                <label style={lbl}>Notes</label>
                <input value={bill.notes} onChange={e => setBill(b => ({ ...b, notes: e.target.value }))} style={inp} placeholder="optional" />
              </div>
            </div>
            <div style={{ background: "#f9fafb", borderRadius: 10, padding: 16, border: "1px solid #eef2f7" }}>
              <Row label="Goods value" value={goods} />
              <Row label="+ Freight" value={num(bill.freight)} dim />
              <Row label="+ Market charges" value={num(bill.market_charges)} dim />
              <Row label="+ Middleman commission" value={num(bill.middleman_comm)} dim />
              <Row label="+ Other charges" value={num(bill.other_charges)} dim />
              <div style={{ borderTop: "2px solid #1a7a45", marginTop: 8, paddingTop: 8 }}>
                <Row label="Total cost (payable to supplier)" value={total} big />
              </div>
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ ...lbl, marginBottom: 0, flex: 1 }}>Paid now (optional)</label>
                <input type="number" value={bill.paid_amount} onChange={e => setBill(b => ({ ...b, paid_amount: e.target.value }))} style={{ ...inp, textAlign: "right", width: 140 }} />
              </div>
              <Row label="Balance due" value={Math.round((total - num(bill.paid_amount)) * 100) / 100} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button disabled={saving} onClick={() => save(false)} style={primaryBtn}>{saving ? "Saving…" : editingId ? "Update bill" : "Save bill"}</button>
            <button disabled={saving} onClick={() => save(true)} style={{ ...primaryBtn, background: "#0f4c2a" }}>{saving ? "…" : "Save & print"}</button>
            {(editingId || bill.party_id) && <button onClick={reset} style={{ background: "white", border: "1px solid #d1d5db", borderRadius: 8, padding: "11px 18px", cursor: "pointer" }}>Clear</button>}
          </div>
        </div>
      )}

      {view === "list" && (
        <div style={{ background: "white", border: "1px solid #eef2f7", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#f9fafb" }}>{["Bill", "Supplier", "Goods", "Charges", "Total cost", "Balance", ""].map((h, i) =>
              <th key={i} style={{ textAlign: i >= 2 && i <= 5 ? "right" : "left", fontSize: 11, color: "#888", fontWeight: 600, padding: "10px 12px" }}>{h}</th>)}</tr></thead>
            <tbody>
              {bills.length === 0 ? <tr><td colSpan={7} style={{ padding: 28, textAlign: "center", color: "#999" }}>No supplier bills for this date.</td></tr> :
               bills.map(b => (
                <tr key={b.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600 }}>{b.bill_no}</td>
                  <td style={{ padding: "10px 12px" }}>{b.party_name}{b.city ? <span style={{ color: "#888", fontSize: 12 }}> · {b.city}</span> : null}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>{fmt.currency(b.goods_amount)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: "#b45309" }}>{fmt.currency(num(b.freight) + num(b.market_charges) + num(b.middleman_comm) + num(b.other_charges))}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700 }}>{fmt.currency(b.total_cost)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: num(b.balance_due) > 0 ? "#dc2626" : "#16a34a" }}>{fmt.currency(b.balance_due)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                    <button onClick={() => editBill(b.id)} style={{ padding: "5px 11px", marginRight: 6, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, color: "#2563eb", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Edit</button>
                    <button onClick={() => cancelBill(b.id, b.bill_no)} style={{ padding: "5px 9px", background: "#fee2e2", border: "none", borderRadius: 6, color: "#dc2626", fontSize: 12, cursor: "pointer" }}>Cancel</button>
                  </td>
                </tr>
               ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "pending" && (
        <div>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>Pending supplier-purchase lines from <b>Orders → Procurement</b>. Bill a party to turn its lines into a supplier purchase (set rates first). Held until billed.</div>
          {pendingByParty.length === 0 ? (
            <div style={{ background: "white", border: "1px solid #eef2f7", borderRadius: 12, padding: 30, textAlign: "center", color: "#999" }}>
              No pending lines. Allocate orders in the Orders → Procurement tab and they show up here.
            </div>
          ) : pendingByParty.map(g => (
            <div key={g.party_id} style={{ background: "white", border: "1px solid #eef2f7", borderRadius: 12, marginBottom: 14, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "#faf5ff", borderBottom: "1px solid #f3e8ff" }}>
                <div style={{ fontWeight: 700 }}>{g.party_name} <span style={{ color: "#888", fontWeight: 400, fontSize: 12 }}>· {g.items.length} item{g.items.length === 1 ? "" : "s"}</span></div>
                <button onClick={() => billFromPending(g)} style={{ padding: "7px 16px", background: "#1a7a45", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>🧾 Bill this party →</button>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: "#f9fafb" }}>{["Product", "Bags", "Weight", "Rate", "Date", ""].map((h, i) =>
                  <th key={i} style={{ textAlign: i >= 1 && i <= 3 ? "right" : "left", fontSize: 11, color: "#888", fontWeight: 600, padding: "8px 12px" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {g.items.map(it => (
                    <tr key={it.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 600 }}>{it.product_name}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right" }}>{num(it.no_of_bags) || "—"}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right" }}>{num(it.weight) ? num(it.weight).toFixed(1) : "—"}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: it.rate == null ? "#dc2626" : "#111" }}>{it.rate == null ? "set" : fmt.currency(it.rate)}</td>
                      <td style={{ padding: "8px 12px", color: "#888", fontSize: 12 }}>{fmt.date(it.order_date)}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right" }}>
                        <button onClick={() => deletePending(it)} style={{ padding: "4px 9px", background: "#fee2e2", border: "none", borderRadius: 6, color: "#dc2626", fontSize: 12, cursor: "pointer" }}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {printBill && <PrintSupplierBill bill={printBill} date={date} onClose={() => setPrintBill(null)} />}
    </div>
  );
}

function Row({ label, value, big, dim }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: big ? 16 : 13, fontWeight: big ? 800 : 500, color: dim ? "#92400e" : "#222" }}>
      <span>{label}</span><span>{fmt.currency(value)}</span>
    </div>
  );
}

const tabBtn = (active) => ({ padding: "8px 14px", borderRadius: 8, border: "1px solid " + (active ? "#1a7a45" : "#d1d5db"), background: active ? "#1a7a45" : "white", color: active ? "white" : "#374151", fontWeight: 600, cursor: "pointer", fontSize: 13 });
const primaryBtn = { background: "#1a7a45", border: "none", borderRadius: 8, color: "white", fontWeight: 700, padding: "11px 22px", cursor: "pointer", fontSize: 14 };

// A5 supplier-purchase bill — same letterhead/table pattern as the Farmer Purchase
// print, but the company name is RED (not green) so the two are easy to tell apart,
// and charges are ADDED in the totals block. Money values laid out in the table.
const RED = "#b91c1c";
function PrintSupplierBill({ bill, date, onClose }) {
  const [tpl, setTpl] = useState(null);
  const [tplReady, setTplReady] = useState(false);
  useEffect(() => { getPrintTemplate().then(setTpl).finally(() => setTplReady(true)); }, []);
  useEffect(() => { if (!tplReady) return; const t = setTimeout(() => window.print(), 350); return () => clearTimeout(t); }, [tplReady]);

  const t = tpl || {};
  const rows = bill.rows || [];
  const money = (n) => num(n).toLocaleString("en-IN", { minimumFractionDigits: 2 });
  const charges = [["Freight", bill.freight], ["Market charges", bill.market_charges],
                   ["Middleman commission", bill.middleman_comm], ["Other charges", bill.other_charges]].filter(([, v]) => num(v) > 0);

  return createPortal(
    <div className="sup-print-portal">
      <style>{`
        .sup-print-portal { position: fixed; inset: 0; background: #f3f4f6; overflow: auto; z-index: 2000; font-family: 'Noto Sans Tamil',Inter, 'Segoe UI', system-ui, sans-serif; }
        .sup-bill { width: 148mm; margin: 0 auto 16px; box-sizing: border-box; background: #fff; padding: 7mm; }
        .sup-bill table { width: 100%; border-collapse: collapse; }
        .sup-bill td, .sup-bill th { border: 1px solid ${RED}; padding: 4px 7px; font-size: 11.5px; }
        .sup-bill th { background: #fdecec; font-weight: 700; font-size: 10.5px; }
        @media screen { .sup-bill { box-shadow: 0 1px 10px rgba(0,0,0,0.18); } }
        @media print {
          .no-print { display: none !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body > *:not(.sup-print-portal) { display: none !important; }
          .sup-print-portal { position: static; overflow: visible; background: #fff; }
          .sup-bill { margin: 0; box-shadow: none; }
          @page { size: A5 portrait; margin: 0; }
        }
      `}</style>

      <div className="no-print" style={{ padding: "16px 20px", display: "flex", gap: 10, alignItems: "center", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
        <button onClick={() => window.print()} style={{ ...primaryBtn, background: RED }}>🖨️ Print</button>
        <button onClick={onClose} style={{ background: "white", border: "1px solid #d1d5db", borderRadius: 8, padding: "10px 18px", cursor: "pointer" }}>Close</button>
      </div>

      <div className="sup-bill">
        {/* Letterhead */}
        <table style={{ marginBottom: 0 }}><tbody><tr>
          <td style={{ border: `2px solid ${RED}`, textAlign: "center", padding: "8px 12px" }}>
            {t.logo ? <img src={t.logo} alt="" style={{ maxHeight: 54, marginBottom: 4 }} /> : null}
            <div style={{ fontSize: 22, fontWeight: 900, color: RED, fontFamily: "'Noto Sans Tamil',sans-serif" }}>{t.company_ta || "ஸ்ரீ முருகன் அன் கோ.,"}</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: RED }}>{t.company_en || "SRI MURUGAN & Co.,"}</div>
            {t.subtitle_ta && <div style={{ fontSize: 12, color: "#333", fontFamily: "'Noto Sans Tamil',sans-serif" }}>{t.subtitle_ta}</div>}
            {t.address && <div style={{ fontSize: 11, color: "#333" }}>{t.address}</div>}
            <div style={{ fontSize: 13, fontWeight: 700 }}>{t.phone || "Cell : 94433 34663, 73733 99999"}</div>
            <div style={{ fontSize: 12, fontWeight: 800, marginTop: 3, letterSpacing: 1, color: RED }}>SUPPLIER PURCHASE</div>
          </td>
        </tr></tbody></table>

        {/* Party + bill meta */}
        <table style={{ borderTop: "none", marginBottom: 0 }}><tbody><tr>
          <td style={{ border: `1px solid ${RED}`, width: "60%", padding: "6px 10px" }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>
              {bill.party_name_ta && <span style={{ fontFamily: "'Noto Sans Tamil',sans-serif", marginRight: 6 }}>{bill.party_name_ta}</span>}
              {bill.party_name}
            </div>
            <div style={{ fontSize: 12, marginTop: 2 }}>ஊர் / City : <strong>{bill.city || "—"}</strong></div>
          </td>
          <td style={{ border: `1px solid ${RED}`, textAlign: "center", padding: "6px 10px", background: "#fdecec" }}>
            <div style={{ fontWeight: 700, fontSize: 12 }}>PURCHASE BILL</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>No : <strong>{bill.bill_no}</strong></div>
            <div style={{ fontSize: 12, marginTop: 2 }}>Date : <strong>{new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "2-digit" })}</strong></div>
          </td>
        </tr></tbody></table>

        {/* Items + totals */}
        <table style={{ borderTop: "none", marginBottom: 0 }}>
          <thead><tr>
            <th style={{ textAlign: "left" }}>விபரம் / Description</th>
            <th style={{ width: 72, textAlign: "center" }}>எடை / Qty</th>
            <th style={{ width: 64, textAlign: "right" }}>ரேட் / Rate</th>
            <th style={{ width: 95, textAlign: "right" }}>தொகை / Amount</th>
          </tr></thead>
          <tbody>
            {rows.map((it, i) => (
              <tr key={i}>
                <td style={{ fontFamily: "'Noto Sans Tamil',sans-serif", fontWeight: 600 }}>{it.product_name}</td>
                <td style={{ textAlign: "center" }}>{(it.unit_type || "KG").toUpperCase() === "BAG" ? `${num(it.no_of_bags)} bags` : `${num(it.weight)} kg`}</td>
                <td style={{ textAlign: "right" }}>{num(it.rate).toFixed(2)}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{money(it.amount)}</td>
              </tr>
            ))}
            {Array.from({ length: Math.max(0, 4 - rows.length) }).map((_, i) => (
              <tr key={`e${i}`}><td>&nbsp;</td><td></td><td></td><td></td></tr>
            ))}
            <tr>
              <td colSpan={3} style={{ textAlign: "right", fontWeight: 700 }}>Goods value</td>
              <td style={{ textAlign: "right", fontWeight: 700 }}>{money(bill.goods_amount)}</td>
            </tr>
            {charges.map(([label, v]) => (
              <tr key={label}>
                <td colSpan={3} style={{ textAlign: "right" }}>+ {label}</td>
                <td style={{ textAlign: "right" }}>{money(v)}</td>
              </tr>
            ))}
            <tr style={{ background: "#fdf2f2" }}>
              <td colSpan={3} style={{ textAlign: "right", fontWeight: 900, fontSize: 13 }}>Total cost</td>
              <td style={{ textAlign: "right", fontWeight: 900, fontSize: 14 }}>{money(bill.total_cost)}</td>
            </tr>
            {num(bill.paid_amount) > 0 && (<>
              <tr><td colSpan={3} style={{ textAlign: "right" }}>Paid</td><td style={{ textAlign: "right" }}>{money(bill.paid_amount)}</td></tr>
              <tr><td colSpan={3} style={{ textAlign: "right", fontWeight: 700 }}>Balance due</td><td style={{ textAlign: "right", fontWeight: 700 }}>{money(bill.balance_due)}</td></tr>
            </>)}
          </tbody>
        </table>
      </div>
    </div>,
    document.body
  );
}
