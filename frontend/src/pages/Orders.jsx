// ============================================================
//  Orders module — the daily order book.
//   Tab 1 "Take Orders": phone orders from Order Suppliers (sales parties sold to
//     at a fixed rate). Pick city -> order supplier -> products/bags/weight/notes
//     (rate optional). A live summary aggregates demand per product. (PENDING — will
//     later be wired to Sales bills.)
//   Tab 2 "Procurement": against that demand, allocate where each product is bought
//     (e.g. 15 bags chillies = 3 @ SM + 4 @ TM + 8 @ AK). (PENDING — will later be
//     wired to Supplier purchase bills.)
// ============================================================
import { useState, useEffect, useRef } from "react";
import { api, apiCached, fmt, SearchableSelect, getWorkingDate } from "../App.jsx";

const num = v => parseFloat(v || 0) || 0;

// Print just the given element (uses the app's global print CSS — Save as PDF works too).
function printArea(el) {
  if (!el) return;
  el.classList.add("report-printing");
  document.body.classList.add("printing-report");
  const done = () => { el.classList.remove("report-printing"); document.body.classList.remove("printing-report"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  window.print();
}
// Build + download a CSV (BOM for Excel/Tamil).
function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
// Small export toolbar (hidden when printing).
function ExportBar({ onCSV, onPrint }) {
  return (
    <div className="no-print" style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 10 }}>
      <button onClick={onCSV} style={{ padding: "8px 14px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, color: "#16a34a", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>⬇️ CSV</button>
      <button onClick={onPrint} style={{ padding: "8px 14px", background: PINK, border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>🖨️ Print / PDF</button>
    </div>
  );
}
const newItem  = () => ({ product_id: "", product_name: "", unit_type: "KG", no_of_bags: "", weight: "", rate: "", notes: "" });
const newAlloc = () => ({ source_party_id: "", source_name: "", no_of_bags: "", weight: "", rate: "", notes: "" });

// Enter/Tab → next cell in the same row.
function advance(e, rowSel, nextSel) {
  if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
    e.preventDefault();
    e.target.closest(rowSel)?.querySelector(nextSel)?.focus();
  }
}

const card  = { background: "white", borderRadius: 12, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", marginBottom: 14 };
const label = { display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" };
const input = { width: "100%", padding: "8px 11px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14, boxSizing: "border-box", outline: "none", fontFamily: "inherit" };
const btn   = (bg) => ({ padding: "9px 18px", background: bg, border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 14 });
const th    = { textAlign: "left", padding: "8px 10px", fontSize: 11, color: "#6b7280", textTransform: "uppercase", borderBottom: "2px solid #eef2f7", whiteSpace: "nowrap" };
const td    = { padding: "8px 10px", fontSize: 13, borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" };
const PINK  = "#db2777";

export default function OrdersPage() {
  const [tab, setTab]   = useState("take");
  const [date, setDate] = useState(getWorkingDate());
  useEffect(() => {
    const h = (e) => setDate(e.detail);
    window.addEventListener("rsm-working-date", h);
    return () => window.removeEventListener("rsm-working-date", h);
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>📞 Orders <span style={{ fontSize: 13, color: "#666" }}>ஆர்டர்கள்</span></h1>
        <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb" }}>
          {[{ id: "take", label: "Take Orders" }, { id: "procure", label: "Procurement" }, { id: "table", label: "Table" }].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "7px 16px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
              background: tab === t.id ? PINK : "white", color: tab === t.id ? "white" : "#374151" }}>{t.label}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div>
          <label style={{ ...label, display: "inline", marginRight: 8 }}>Order date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...input, width: "auto" }} />
        </div>
      </div>
      {tab === "take" ? <TakeOrders date={date} /> : tab === "procure" ? <Procurement date={date} /> : <OrderTable date={date} />}
    </div>
  );
}

// ---------------- Tab 1: Take Orders ----------------
function TakeOrders({ date }) {
  const [cities, setCities]       = useState([]);
  const [cityId, setCityId]       = useState("");
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [products, setProducts]   = useState([]);
  const [items, setItems]         = useState([newItem()]);
  const [notes, setNotes]         = useState("");
  const [editId, setEditId]       = useState(null);
  const [saving, setSaving]       = useState(false);
  const [orders, setOrders]       = useState([]);
  const [summary, setSummary]     = useState([]);

  useEffect(() => {
    api("parties?action=list-cities").then(r => setCities(r.data || [])).catch(() => {});
    apiCached("products?action=list").then(r => setProducts(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!cityId) { setSuppliers([]); return; }
    api(`orders?action=suppliers&city_id=${cityId}`).then(r => setSuppliers(r.data || [])).catch(() => setSuppliers([]));
  }, [cityId]);

  const loadOrders  = () => api(`orders?action=orders&date=${date}`).then(r => setOrders(r.data || [])).catch(() => setOrders([]));
  const loadSummary = () => api(`orders?action=summary&date=${date}`).then(r => setSummary(r.data || [])).catch(() => setSummary([]));
  useEffect(() => { loadOrders(); loadSummary(); }, [date]);

  // Cursor starts in the City field when the module opens.
  useEffect(() => { setTimeout(() => document.querySelector(".ord-city")?.focus(), 80); }, []);
  // Enter on bags/weight skips rate & notes and lands on the next product row (adding one if needed).
  const toNextProductRow = (i) => {
    const next = document.querySelectorAll(".ord-prod")[i + 1];
    if (next) { next.focus(); return; }
    addRow();
    setTimeout(() => { const s = document.querySelectorAll(".ord-prod"); s[s.length - 1]?.focus(); }, 40);
  };

  const sheetRef = useRef();
  const cityOpts     = cities.map(c => ({ id: c.id, label: c.name_en + (c.name_ta ? ` / ${c.name_ta}` : "") }));
  const supplierOpts = suppliers.map(s => ({ id: s.id, label: s.name_en + (s.name_ta ? ` / ${s.name_ta}` : "") }));
  const productOpts  = products.map(p => ({ id: p.id, label: p.name_en }));

  const setItem = (i, patch) => setItems(its => its.map((it, j) => j === i ? { ...it, ...patch } : it));
  const pickProduct = (i, id, opt) => {
    const p = products.find(x => String(x.id) === String(id));
    setItem(i, { product_id: id, product_name: opt?.label || p?.name_en || "", unit_type: p?.unit_type || "KG" });
  };
  const addRow = () => setItems(its => [...its, newItem()]);
  const delRow = (i) => setItems(its => its.length > 1 ? its.filter((_, j) => j !== i) : its);

  const reset = () => { setSupplierId(""); setItems([newItem()]); setNotes(""); setEditId(null); };

  const save = async () => {
    if (!supplierId) { alert("Pick an order supplier"); return; }
    const rows = items.filter(it => it.product_id && (num(it.no_of_bags) || num(it.weight)));
    if (!rows.length) { alert("Add at least one product with bags or weight"); return; }
    setSaving(true);
    try {
      await api("orders?action=save-order", { method: "POST", body: JSON.stringify({
        id: editId || undefined, order_date: date, supplier_id: supplierId, notes: notes || null,
        items: rows.map(it => ({ product_id: it.product_id, unit_type: it.unit_type, no_of_bags: num(it.no_of_bags),
          weight: num(it.weight), rate: it.rate === "" ? null : num(it.rate), notes: it.notes || null })),
      }) });
      reset(); loadOrders(); loadSummary();
      setTimeout(() => document.querySelector(".ord-supplier")?.focus(), 60);
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const edit = (o) => {
    setEditId(o.id);
    setCityId(o.city_id || "");
    setSupplierId(o.supplier_id);
    setNotes(o.notes || "");
    const fi = (o.items || []).map(it => ({
      product_id: it.product_id, product_name: it.product_name || "", unit_type: (it.unit_type || "KG").toUpperCase(),
      no_of_bags: num(it.no_of_bags) ? String(num(it.no_of_bags)) : "",
      weight: num(it.weight) ? String(num(it.weight)) : "",
      rate: it.rate == null ? "" : (num(it.rate) ? String(num(it.rate)) : ""),
      notes: it.notes || "",
    }));
    setItems(fi.length ? fi : [newItem()]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const del = async (o) => {
    if (!window.confirm(`Delete ${o.supplier_name}'s order?`)) return;
    try { await api("orders?action=delete-order", { method: "POST", body: JSON.stringify({ id: o.id }) }); loadOrders(); loadSummary(); }
    catch (e) { alert(e.message); }
  };

  const itemsLabel = (o) => (o.items || []).map(it =>
    `${it.product_name} ${num(it.no_of_bags) ? num(it.no_of_bags) + "bag" : ""}${num(it.weight) ? " " + num(it.weight) + "kg" : ""}`.trim()).join(", ");

  const csv = () => downloadCSV(`orders_${date}.csv`, [
    [`Orders — ${date}`],
    [],
    ["Order summary (total demand)"],
    ["Product", "Total Bags", "Total Weight", "Suppliers"],
    ...summary.map(r => [r.product_name, num(r.bags), num(r.weight), r.suppliers]),
    [],
    ["Orders detail"],
    ["Supplier", "City", "Product", "Bags", "Weight", "Rate", "Notes"],
    ...orders.flatMap(o => (o.items || []).map(it =>
      [o.supplier_name, o.city_name || "", it.product_name, num(it.no_of_bags), num(it.weight), it.rate == null ? "" : num(it.rate), it.notes || o.notes || ""])),
  ]);

  return (
    <div>
      {/* Entry */}
      <div style={{ ...card, padding: 18, ...(editId ? { border: "1.5px solid #f59e0b" } : {}) }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{editId ? "✏️ Edit order" : "Take an order"}</div>
          {editId && <button onClick={reset} style={{ background: "#f3f4f6", border: "none", borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#374151" }}>✕ Cancel edit</button>}
        </div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>Pick a city, then an order supplier, then fill the products. Rate is optional. Held pending — to be billed in Sales.</div>

        <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ minWidth: 200 }}>
            <label style={label}>1 · City</label>
            <SearchableSelect className="ord-city" value={cityId} options={cityOpts}
              onChange={(id) => { setCityId(id); setSupplierId(""); }}
              onAdvance={() => document.querySelector(".ord-supplier")?.focus()}
              placeholder="🔍 Select city..." style={input} />
          </div>
          <div style={{ minWidth: 240, flex: 1 }}>
            <label style={label}>2 · Order supplier {cityId && suppliers.length === 0 ? <span style={{ color: PINK, textTransform: "none", fontWeight: 400 }}>— none in this city</span> : ""}</label>
            <SearchableSelect className="ord-supplier" value={supplierId} options={supplierOpts}
              onChange={(id) => setSupplierId(id)}
              onAdvance={() => document.querySelector(".ord-prod")?.focus()}
              placeholder={cityId ? "🔍 Select order supplier..." : "Pick a city first"} style={input} />
          </div>
        </div>

        {/* Item grid: Product → Bags → Weight → Rate → Notes */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(160px,1.4fr) 60px 80px 96px 96px minmax(120px,1fr) 34px", gap: 8, padding: "0 2px 6px", borderBottom: "1px solid #eef2f7" }}>
            {["Product", "Unit", "Bags", "Weight", "Rate ₹ (opt)", "Notes", ""].map((h, i) =>
              <span key={i} style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: i >= 2 && i <= 4 ? "right" : (i === 1 ? "center" : "left") }}>{h}</span>)}
          </div>
          {items.map((it, i) => (
            <div key={i} className="ord-row" style={{ display: "grid", gridTemplateColumns: "minmax(160px,1.4fr) 60px 80px 96px 96px minmax(120px,1fr) 34px", gap: 8, alignItems: "center", padding: "6px 2px" }}>
              <SearchableSelect className="ord-prod" value={it.product_id} options={productOpts} placeholder="Product…"
                onChange={(id, opt) => pickProduct(i, id, opt)}
                onAdvance={(el) => el.closest(".ord-row")?.querySelector(".ord-bag")?.focus()}
                onEmptyEnter={save}
                onEscape={() => document.querySelector(".ord-save")?.focus()}
                style={{ ...input, padding: "7px 8px", fontSize: 13 }} />
              <span style={{ fontSize: 12, color: "#666", textAlign: "center" }}>{it.unit_type}</span>
              <input className="ord-bag" type="number" value={it.no_of_bags} onChange={e => setItem(i, { no_of_bags: e.target.value })}
                onKeyDown={e => advance(e, ".ord-row", ".ord-wt")} style={{ ...input, textAlign: "right", padding: "7px 8px" }} />
              <input className="ord-wt" type="number" value={it.weight} onChange={e => setItem(i, { weight: e.target.value })}
                onKeyDown={e => { if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); toNextProductRow(i); } }} style={{ ...input, textAlign: "right", padding: "7px 8px" }} />
              <input className="ord-rate" type="number" value={it.rate} onChange={e => setItem(i, { rate: e.target.value })}
                onKeyDown={e => advance(e, ".ord-row", ".ord-note")} style={{ ...input, textAlign: "right", padding: "7px 8px" }} />
              <input className="ord-note" value={it.notes} onChange={e => setItem(i, { notes: e.target.value })} placeholder="comment"
                onKeyDown={e => { if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); toNextProductRow(i); } }}
                style={{ ...input, padding: "7px 8px" }} />
              <button onClick={() => delRow(i)} style={{ background: "#fee2e2", border: "none", borderRadius: 6, color: "#dc2626", padding: "6px 9px", cursor: "pointer" }}>✕</button>
            </div>
          ))}
        </div>
        <button onClick={addRow} style={{ background: "#fdf2f8", border: "1px solid #fbcfe8", borderRadius: 8, color: PINK, fontWeight: 600, padding: "8px 14px", cursor: "pointer", fontSize: 13, marginBottom: 14 }}>+ Add product</button>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={label}>Order note (optional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. deliver by evening" style={input} />
          </div>
          <button className="ord-save" onClick={save} disabled={saving} style={btn(saving ? "#9ca3af" : (editId ? "#d97706" : PINK))}>{editId ? "💾 Update order" : "✅ Save order"}</button>
        </div>
      </div>

      <ExportBar onCSV={csv} onPrint={() => printArea(sheetRef.current)} />
      <div ref={sheetRef}>
      {/* Today's orders */}
      <div style={card}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Orders on {fmt.date(date)} <span style={{ color: "#888", fontWeight: 400 }}>({orders.length})</span></div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Supplier</th><th style={th}>City</th><th style={th}>Items</th><th style={th}></th></tr></thead>
            <tbody>
              {orders.length === 0 ? <tr><td style={{ ...td, color: "#999", textAlign: "center" }} colSpan={4}>No orders yet for this date</td></tr> :
              orders.map(o => (
                <tr key={o.id}>
                  <td style={{ ...td, fontWeight: 600 }}>{o.supplier_name}</td>
                  <td style={{ ...td, color: "#666" }}>{o.city_name || "—"}</td>
                  <td style={{ ...td, whiteSpace: "normal", maxWidth: 360 }}>{itemsLabel(o)}{o.notes ? <span style={{ color: "#888" }}> · {o.notes}</span> : null}</td>
                  <td style={td}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => edit(o)} title="Edit order" style={{ padding: "4px 10px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, color: "#b45309", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>✏️ Edit</button>
                      <button onClick={() => del(o)} title="Delete order" style={{ padding: "4px 10px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🗑️ Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Aggregated demand summary */}
      <div style={{ ...card, border: `1.5px solid #fbcfe8` }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, color: PINK }}>📋 Order summary — total demand</div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>Combined across all order suppliers for {fmt.date(date)}. Use this in the Procurement tab to plan buying.</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Product</th><th style={{ ...th, textAlign: "right" }}>Total Bags</th><th style={{ ...th, textAlign: "right" }}>Total Weight</th><th style={{ ...th, textAlign: "right" }}>Suppliers</th></tr></thead>
            <tbody>
              {summary.length === 0 ? <tr><td style={{ ...td, color: "#999", textAlign: "center" }} colSpan={4}>No demand yet</td></tr> :
              summary.map(r => (
                <tr key={r.product_id}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.product_name}{r.product_name_ta ? <span style={{ color: PINK, marginLeft: 6, fontSize: 12 }}>{r.product_name_ta}</span> : null}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{num(r.bags)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{num(r.weight).toFixed(1)} kg</td>
                  <td style={{ ...td, textAlign: "right", color: "#888" }}>{r.suppliers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </div>
  );
}

// ---------------- Tab 2: Procurement ----------------
function Procurement({ date }) {
  const [summary, setSummary] = useState([]);
  const [procs, setProcs]     = useState([]);
  const [parties, setParties] = useState([]);
  const [editProduct, setEditProduct] = useState(null);
  const [allocs, setAllocs]   = useState([newAlloc()]);
  const [saving, setSaving]   = useState(false);

  const loadSummary = () => api(`orders?action=summary&date=${date}`).then(r => setSummary(r.data || [])).catch(() => setSummary([]));
  const loadProcs   = () => api(`orders?action=procurements&date=${date}`).then(r => setProcs(r.data || [])).catch(() => setProcs([]));
  useEffect(() => { loadSummary(); loadProcs(); setEditProduct(null); }, [date]);
  useEffect(() => { api("orders?action=procure-parties").then(r => setParties(r.data || [])).catch(() => {}); }, []);

  const partyOpts = parties.map(p => ({ id: p.id, label: p.name_en + (p.city_name ? ` · ${p.city_name}` : "") }));
  const procsByProduct = procs.reduce((m, r) => { (m[r.product_id] = m[r.product_id] || []).push(r); return m; }, {});

  const allocSum = (rows, k) => (rows || []).reduce((n, r) => n + num(r[k]), 0);

  const openEditor = (prod) => {
    setEditProduct(prod);
    const existing = procsByProduct[prod.product_id] || [];
    setAllocs(existing.length
      ? existing.map(r => ({ source_party_id: r.source_party_id, source_name: r.source_name || "",
          no_of_bags: num(r.no_of_bags) ? String(num(r.no_of_bags)) : "", weight: num(r.weight) ? String(num(r.weight)) : "",
          rate: r.rate == null ? "" : (num(r.rate) ? String(num(r.rate)) : ""), notes: r.notes || "" }))
      : [newAlloc()]);
  };

  const setAlloc = (i, patch) => setAllocs(a => a.map((row, j) => j === i ? { ...row, ...patch } : row));
  const addAlloc = () => setAllocs(a => [...a, newAlloc()]);
  const delAlloc = (i) => setAllocs(a => a.length > 1 ? a.filter((_, j) => j !== i) : a);

  // Cursor jumps to the first source when the editor opens.
  useEffect(() => { if (editProduct) setTimeout(() => document.querySelector(".alc-src")?.focus(), 80); }, [editProduct]);
  // Enter on weight/rate/notes drops to the next source row (adding one if needed).
  const toNextAllocRow = (i) => {
    const next = document.querySelectorAll(".alc-src")[i + 1];
    if (next) { next.focus(); return; }
    addAlloc();
    setTimeout(() => { const s = document.querySelectorAll(".alc-src"); s[s.length - 1]?.focus(); }, 40);
  };

  // Who we've bought from across all products (the procurement summary).
  const bySource = procs.reduce((m, r) => {
    const k = r.source_party_id;
    if (!m[k]) m[k] = { id: r.source_party_id, name: r.source_name, bags: 0, weight: 0, lines: [] };
    m[k].bags += num(r.no_of_bags); m[k].weight += num(r.weight);
    m[k].lines.push(`${r.product_name} ${num(r.no_of_bags) ? num(r.no_of_bags) + "bag" : num(r.weight) + "kg"}`);
    return m;
  }, {});
  const sourceRows = Object.values(bySource).sort((a, b) => b.bags - a.bags);

  const clearSource = async (s) => {
    if (!window.confirm(`Remove all of ${s.name}'s allocations for ${fmt.date(date)}? This also removes the matching pending supplier-purchase lines.`)) return;
    try { await api("orders?action=clear-procurement-source", { method: "POST", body: JSON.stringify({ order_date: date, source_party_id: s.id }) }); loadProcs(); }
    catch (e) { alert(e.message); }
  };

  const saveAlloc = async () => {
    const rows = allocs.filter(a => a.source_party_id && (num(a.no_of_bags) || num(a.weight)));
    setSaving(true);
    try {
      await api("orders?action=save-procurement", { method: "POST", body: JSON.stringify({
        order_date: date, product_id: editProduct.product_id,
        allocations: rows.map(a => ({ source_party_id: a.source_party_id, no_of_bags: num(a.no_of_bags),
          weight: num(a.weight), rate: a.rate === "" ? null : num(a.rate), notes: a.notes || null })),
      }) });
      setEditProduct(null); loadProcs();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const sheetRef = useRef();
  const csv = () => downloadCSV(`procurement_${date}.csv`, [
    [`Procurement — ${date}`],
    [],
    ["Plan"],
    ["Product", "Ordered Bags", "Ordered Weight", "Allocated Bags", "Allocated Weight", "Remaining Bags", "Remaining Weight"],
    ...summary.map(prod => {
      const rows = procsByProduct[prod.product_id] || [];
      const aB = allocSum(rows, "no_of_bags"), aW = allocSum(rows, "weight");
      return [prod.product_name, num(prod.bags), num(prod.weight), aB, aW.toFixed(1), (num(prod.bags) - aB), (num(prod.weight) - aW).toFixed(1)];
    }),
    [],
    ["Allocations detail"],
    ["Product", "Source vendor", "Bags", "Weight", "Rate", "Notes"],
    ...procs.map(r => [r.product_name, r.source_name, num(r.no_of_bags), num(r.weight), r.rate == null ? "" : num(r.rate), r.notes || ""]),
    [],
    ["Purchased from — vendor summary"],
    ["Vendor", "Total Bags", "Total Weight"],
    ...sourceRows.map(s => [s.name, s.bags, s.weight.toFixed(1)]),
  ]);

  return (
    <div>
      <ExportBar onCSV={csv} onPrint={() => printArea(sheetRef.current)} />
      <div ref={sheetRef}>
      <div style={{ ...card }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Procurement plan — where to buy</div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>For each product ordered on {fmt.date(date)}, allocate how many bags/weight to buy from each source. Held pending — to be billed as Supplier purchases.</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Product</th>
              <th style={{ ...th, textAlign: "right" }}>Ordered (bags / kg)</th>
              <th style={{ ...th, textAlign: "right" }}>Allocated</th>
              <th style={{ ...th, textAlign: "right" }}>Remaining</th>
              <th style={th}>Sources</th>
              <th style={th}></th>
            </tr></thead>
            <tbody>
              {summary.length === 0 ? <tr><td style={{ ...td, color: "#999", textAlign: "center" }} colSpan={6}>No orders to procure for this date</td></tr> :
              summary.map(prod => {
                const rows = procsByProduct[prod.product_id] || [];
                const aB = allocSum(rows, "no_of_bags"), aW = allocSum(rows, "weight");
                const rB = num(prod.bags) - aB, rW = num(prod.weight) - aW;
                const done = rB <= 0.001 && rW <= 0.001;
                return (
                  <tr key={prod.product_id}>
                    <td style={{ ...td, fontWeight: 600 }}>{prod.product_name}</td>
                    <td style={{ ...td, textAlign: "right" }}>{num(prod.bags)} / {num(prod.weight).toFixed(1)}</td>
                    <td style={{ ...td, textAlign: "right", color: "#16a34a" }}>{aB} / {aW.toFixed(1)}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: done ? "#16a34a" : "#dc2626" }}>{done ? "✓ done" : `${rB} / ${rW.toFixed(1)}`}</td>
                    <td style={{ ...td, whiteSpace: "normal", maxWidth: 320, fontSize: 12, color: "#555" }}>
                      {rows.length ? rows.map(r => `${r.source_name} ${num(r.no_of_bags) ? num(r.no_of_bags) + "bag" : num(r.weight) + "kg"}`).join(", ") : <span style={{ color: "#bbb" }}>—</span>}
                    </td>
                    <td style={td}>
                      <button onClick={() => openEditor(prod)} style={{ padding: "5px 12px", background: PINK, border: "none", borderRadius: 7, color: "white", fontWeight: 600, cursor: "pointer", fontSize: 12 }}>Allocate</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Allocation editor */}
      {editProduct && (
        <div className="no-print" style={{ ...card, border: `1.5px solid ${PINK}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Allocate <span style={{ color: PINK }}>{editProduct.product_name}</span>
              <span style={{ fontSize: 12, color: "#888", fontWeight: 400 }}> — ordered {num(editProduct.bags)} bags / {num(editProduct.weight).toFixed(1)} kg</span></div>
            <button onClick={() => setEditProduct(null)} style={{ background: "#f3f4f6", border: "none", borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>✕ Close</button>
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,1.4fr) 80px 96px 96px minmax(120px,1fr) 34px", gap: 8, padding: "0 2px 6px", borderBottom: "1px solid #eef2f7" }}>
              {["Source (buy from)", "Bags", "Weight", "Rate ₹ (opt)", "Notes", ""].map((h, i) =>
                <span key={i} style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: i >= 1 && i <= 3 ? "right" : "left" }}>{h}</span>)}
            </div>
            {allocs.map((a, i) => (
              <div key={i} className="alc-row" style={{ display: "grid", gridTemplateColumns: "minmax(180px,1.4fr) 80px 96px 96px minmax(120px,1fr) 34px", gap: 8, alignItems: "center", padding: "6px 2px" }}>
                <SearchableSelect className="alc-src" value={a.source_party_id} options={partyOpts} placeholder="Customer / Market vendor…"
                  onChange={(id, opt) => setAlloc(i, { source_party_id: id, source_name: opt?.label || "" })}
                  onAdvance={(el) => el.closest(".alc-row")?.querySelector(".alc-bag")?.focus()}
                  onEmptyEnter={saveAlloc}
                  onEscape={() => document.querySelector(".alc-save")?.focus()}
                  style={{ ...input, padding: "7px 8px", fontSize: 13 }} />
                <input className="alc-bag" type="number" value={a.no_of_bags} onChange={e => setAlloc(i, { no_of_bags: e.target.value })}
                  onKeyDown={e => advance(e, ".alc-row", ".alc-wt")} style={{ ...input, textAlign: "right", padding: "7px 8px" }} />
                <input className="alc-wt" type="number" value={a.weight} onChange={e => setAlloc(i, { weight: e.target.value })}
                  onKeyDown={e => advance(e, ".alc-row", ".alc-rate")} style={{ ...input, textAlign: "right", padding: "7px 8px" }} />
                <input className="alc-rate" type="number" value={a.rate} onChange={e => setAlloc(i, { rate: e.target.value })}
                  onKeyDown={e => advance(e, ".alc-row", ".alc-note")} style={{ ...input, textAlign: "right", padding: "7px 8px" }} />
                <input className="alc-note" value={a.notes} onChange={e => setAlloc(i, { notes: e.target.value })} placeholder="comment"
                  onKeyDown={e => { if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); toNextAllocRow(i); } }}
                  style={{ ...input, padding: "7px 8px" }} />
                <button onClick={() => delAlloc(i)} style={{ background: "#fee2e2", border: "none", borderRadius: 6, color: "#dc2626", padding: "6px 9px", cursor: "pointer" }}>✕</button>
              </div>
            ))}
          </div>
          {(() => {
            const aB = allocs.reduce((n, a) => n + num(a.no_of_bags), 0), aW = allocs.reduce((n, a) => n + num(a.weight), 0);
            const rB = num(editProduct.bags) - aB, rW = num(editProduct.weight) - aW;
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 4 }}>
                <button onClick={addAlloc} style={{ background: "#fdf2f8", border: "1px solid #fbcfe8", borderRadius: 8, color: PINK, fontWeight: 600, padding: "8px 14px", cursor: "pointer", fontSize: 13 }}>+ Add source</button>
                <div style={{ fontSize: 13, color: "#555" }}>Allocated <b>{aB}</b> bags / <b>{aW.toFixed(1)}</b> kg ·
                  <span style={{ color: (rB <= 0.001 && rW <= 0.001) ? "#16a34a" : "#dc2626", fontWeight: 700 }}> remaining {rB} / {rW.toFixed(1)}</span>
                </div>
                <div style={{ flex: 1 }} />
                <button className="alc-save" onClick={saveAlloc} disabled={saving} style={btn(saving ? "#9ca3af" : PINK)}>💾 Save allocation</button>
              </div>
            );
          })()}
        </div>
      )}

      {/* Purchased-from summary — which vendors we bought the order stock from */}
      <div style={{ ...card, border: "1.5px solid #fbcfe8" }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, color: PINK }}>🧾 Purchased from — vendor summary</div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>Totals allocated to each customer / market vendor on {fmt.date(date)}.</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Vendor</th><th style={{ ...th, textAlign: "right" }}>Total Bags</th><th style={{ ...th, textAlign: "right" }}>Total Weight</th><th style={th}>Items</th><th style={th}></th></tr></thead>
            <tbody>
              {sourceRows.length === 0 ? <tr><td style={{ ...td, color: "#999", textAlign: "center" }} colSpan={5}>No allocations yet</td></tr> :
              sourceRows.map((s, i) => (
                <tr key={i}>
                  <td style={{ ...td, fontWeight: 600 }}>{s.name}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{s.bags}</td>
                  <td style={{ ...td, textAlign: "right" }}>{s.weight.toFixed(1)} kg</td>
                  <td style={{ ...td, whiteSpace: "normal", maxWidth: 360, fontSize: 12, color: "#555" }}>{s.lines.join(", ")}</td>
                  <td className="no-print" style={td}><button onClick={() => clearSource(s)} title="Remove this vendor's allocations" style={{ padding: "4px 10px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🗑️ Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </div>
  );
}

// ---------------- Tab 3: Table (read-only matrix) ----------------
// Products (rows) × Order suppliers (columns) = ordered bags, with the total demand
// and how much is fulfilled (procured) — a quick way to confirm requirements are met.
function OrderTable({ date }) {
  const [orders, setOrders] = useState([]);
  const [procs, setProcs]   = useState([]);
  useEffect(() => {
    api(`orders?action=orders&date=${date}`).then(r => setOrders(r.data || [])).catch(() => setOrders([]));
    api(`orders?action=procurements&date=${date}`).then(r => setProcs(r.data || [])).catch(() => setProcs([]));
  }, [date]);

  // Columns = order suppliers who ordered today (in order seen).
  const suppliers = []; const supSeen = {};
  orders.forEach(o => { if (!supSeen[o.supplier_id]) { supSeen[o.supplier_id] = true; suppliers.push({ id: o.supplier_id, name: o.supplier_name }); } });

  // Rows = products; cells = that supplier's ordered bags/weight for the product.
  const prodMap = {};
  orders.forEach(o => (o.items || []).forEach(it => {
    const p = prodMap[it.product_id] || (prodMap[it.product_id] = { id: it.product_id, name: it.product_name, cells: {}, bags: 0, weight: 0 });
    const c = p.cells[o.supplier_id] || (p.cells[o.supplier_id] = { bags: 0, weight: 0 });
    c.bags += num(it.no_of_bags); c.weight += num(it.weight);
    p.bags += num(it.no_of_bags); p.weight += num(it.weight);
  }));
  const products = Object.values(prodMap).sort((a, b) => a.name.localeCompare(b.name));

  // Fulfilled (allocated in Procurement) per product.
  const fulfilled = {};
  procs.forEach(r => { const f = fulfilled[r.product_id] || (fulfilled[r.product_id] = { bags: 0, weight: 0 }); f.bags += num(r.no_of_bags); f.weight += num(r.weight); });

  const cellTxt = (c) => c && (c.bags || c.weight) ? (c.bags ? `${c.bags}` : `${c.weight}kg`) : <span style={{ color: "#d1d5db" }}>·</span>;
  const colTotal = (sid) => products.reduce((n, p) => n + num(p.cells[sid]?.bags), 0);

  const sheetRef = useRef();
  const csv = () => downloadCSV(`order_table_${date}.csv`, [
    [`Order table — ${date}`],
    ["Product", ...suppliers.map(s => s.name), "Total Bags", "Fulfilled Bags"],
    ...products.map(p => {
      const f = fulfilled[p.id] || { bags: 0, weight: 0 };
      return [p.name, ...suppliers.map(s => num(p.cells[s.id]?.bags) || ""), p.bags, f.bags];
    }),
    ["TOTAL", ...suppliers.map(s => colTotal(s.id)), products.reduce((n, p) => n + p.bags, 0), Object.values(fulfilled).reduce((n, f) => n + f.bags, 0)],
  ]);

  return (
    <div>
      <ExportBar onCSV={csv} onPrint={() => printArea(sheetRef.current)} />
      <div ref={sheetRef} style={card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>📊 Order table <span style={{ fontWeight: 400, color: "#888", fontSize: 13 }}>— {fmt.date(date)}</span></div>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>Each order supplier's bags per product, the total demand, and how much is fulfilled (procured). Read-only.</div>
      {products.length === 0 ? <div style={{ padding: 24, textAlign: "center", color: "#999" }}>No orders for this date.</div> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
            <thead>
              <tr>
                <th style={{ ...th, position: "sticky", left: 0, background: "white" }}>Product</th>
                {suppliers.map(s => <th key={s.id} style={{ ...th, textAlign: "right" }}>{s.name}</th>)}
                <th style={{ ...th, textAlign: "right", background: "#fdf2f8" }}>Total</th>
                <th style={{ ...th, textAlign: "right", background: "#fdf2f8" }}>Fulfilled</th>
                <th style={{ ...th, textAlign: "center" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => {
                const f = fulfilled[p.id] || { bags: 0, weight: 0 };
                const done = f.bags + 0.001 >= p.bags && f.weight + 0.001 >= p.weight;
                return (
                  <tr key={p.id}>
                    <td style={{ ...td, fontWeight: 600, position: "sticky", left: 0, background: "white" }}>{p.name}</td>
                    {suppliers.map(s => <td key={s.id} style={{ ...td, textAlign: "right" }}>{cellTxt(p.cells[s.id])}</td>)}
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, background: "#fdf2f8" }}>{p.bags}{p.weight ? ` / ${p.weight.toFixed(1)}kg` : ""}</td>
                    <td style={{ ...td, textAlign: "right", color: "#16a34a", background: "#fdf2f8" }}>{f.bags}{f.weight ? ` / ${f.weight.toFixed(1)}kg` : ""}</td>
                    <td style={{ ...td, textAlign: "center" }}>{done ? <span style={{ color: "#16a34a", fontWeight: 700 }}>✓</span> : <span style={{ color: "#dc2626", fontWeight: 700 }}>{(p.bags - f.bags).toFixed(0)} left</span>}</td>
                  </tr>
                );
              })}
              <tr style={{ background: "#f9fafb", borderTop: "2px solid #e5e7eb" }}>
                <td style={{ ...td, fontWeight: 800, position: "sticky", left: 0, background: "#f9fafb" }}>TOTAL bags</td>
                {suppliers.map(s => <td key={s.id} style={{ ...td, textAlign: "right", fontWeight: 700 }}>{colTotal(s.id)}</td>)}
                <td style={{ ...td, textAlign: "right", fontWeight: 800, background: "#fce7f3" }}>{products.reduce((n, p) => n + p.bags, 0)}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 800, background: "#fce7f3", color: "#16a34a" }}>{Object.values(fulfilled).reduce((n, f) => n + f.bags, 0)}</td>
                <td style={td}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      </div>
    </div>
  );
}
