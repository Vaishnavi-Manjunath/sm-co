// ============================================================
//  Market Vendor Settlement
//  Market vendors both sell to us (purchases) and buy from us (sales).
//  Tab 1 — Purchases: log what we buy from them during the week (+ bill photo).
//  Tab 2 — Weekly Settlement: net their sales dues, apply their discount,
//          pay the balance. Everything posts to the shared ledger (Tally).
// ============================================================
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { api, apiCached, fmt, SearchableSelect, getWorkingDate } from "../App.jsx";

const yesterday = () => new Date(Date.now() - 86400000).toISOString().split("T")[0];
const today     = () => new Date().toISOString().split("T")[0];

const num = v => parseFloat(v || 0) || 0;
function newItem() { return { product_id: "", product_name: "", unit_type: "KG", no_of_bags: "", weight: "", rate: "" }; }
function itemQty(it) { return (it.unit_type || "KG").toUpperCase() === "BAG" ? num(it.no_of_bags) : num(it.weight); }
function itemAmt(it) { return Math.round(itemQty(it) * num(it.rate) * 100) / 100; }
// Enter / Tab → focus the next cell in the same row (keyboard-driven entry, like Supplier Purchase).
function advance(e, rowSel, nextSel) {
  if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
    e.preventDefault();
    e.target.closest(rowSel)?.querySelector(nextSel)?.focus();
  }
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

const card   = { background: "white", borderRadius: 12, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", marginBottom: 14 };
const label  = { display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" };
const input  = { width: "100%", padding: "8px 11px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14, boxSizing: "border-box", outline: "none", fontFamily: "inherit" };
const btn    = (bg) => ({ padding: "9px 18px", background: bg, border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 14 });
const th     = { textAlign: "left", padding: "8px 10px", fontSize: 11, color: "#6b7280", textTransform: "uppercase", borderBottom: "2px solid #eef2f7", whiteSpace: "nowrap" };
const td     = { padding: "8px 10px", fontSize: 13, borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" };

export default function MarketPage() {
  const [tab, setTab] = useState("purchases");
  const [vendors, setVendors] = useState([]);

  const loadVendors = () => api("market?action=vendors").then(r => setVendors(r.data || [])).catch(() => {});
  useEffect(() => { loadVendors(); }, []);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>🏪 Market Purchase <span style={{ fontSize: 13, color: "#666" }}>சந்தை கொள்முதல்</span></h1>
        <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb" }}>
          {[{ id: "purchases", label: "Purchases" }, { id: "viewbills", label: "View Bills" }, { id: "settlement", label: "Weekly Settlement" }].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "7px 16px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
              background: tab === t.id ? "#1a7a45" : "white", color: tab === t.id ? "white" : "#374151" }}>{t.label}</button>
          ))}
        </div>
      </div>
      {tab === "purchases" ? <PurchasesTab vendors={vendors} onChange={loadVendors} />
      : tab === "viewbills" ? <ViewBillsTab vendors={vendors} />
      : <SettlementTab vendors={vendors} onChange={loadVendors} />}
    </div>
  );
}

// ---------------- Purchases ----------------
function PurchasesTab({ vendors, onChange }) {
  const [purchaseDate, setPurchaseDate] = useState(getWorkingDate());
  const [vendorId, setVendorId] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState([newItem()]);
  const [editId, setEditId] = useState(null);   // null = new entry; otherwise the purchase being edited
  const [products, setProducts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [list, setList] = useState([]);
  const [from, setFrom] = useState(new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0]);
  const [to, setTo] = useState(today());

  // Keep the entry date in step with the working day.
  useEffect(() => {
    const h = (e) => setPurchaseDate(e.detail);
    window.addEventListener("rsm-working-date", h);
    return () => window.removeEventListener("rsm-working-date", h);
  }, []);

  // Products carry the market rate, which pre-fills the rate cell on pick.
  useEffect(() => {
    api(`products?action=rates&date=${purchaseDate}`).then(r => setProducts(r.data || [])).catch(() => {});
  }, [purchaseDate]);

  const load = () => api(`market?action=purchases&from=${from}&to=${to}`).then(r => setList(r.data || [])).catch(() => setList([]));
  useEffect(() => { load(); }, [from, to]);

  const vOpts = vendors.map(v => ({ id: v.id, label: v.name_en + (v.name_ta ? ` / ${v.name_ta}` : "") }));
  const selVendor = vendors.find(v => String(v.id) === String(vendorId));
  const productOpts = products.map(p => ({ id: p.product_id, label: p.name_en }));

  const setItem = (i, patch) => setItems(its => its.map((it, j) => j === i ? { ...it, ...patch } : it));
  const pickProduct = (i, id, opt) => {
    const p = products.find(x => String(x.product_id) === String(id));
    setItem(i, { product_id: id, product_name: opt?.label || p?.name_en || "", unit_type: p?.unit_type || "KG", rate: p?.market_rate || "" });
  };
  const addRow = () => setItems(its => [...its, newItem()]);
  const delRow = (i) => setItems(its => its.length > 1 ? its.filter((_, j) => j !== i) : its);

  const total = items.reduce((a, it) => a + itemAmt(it), 0);

  const reset = () => { setVendorId(""); setNote(""); setItems([newItem()]); setEditId(null); };

  const save = async () => {
    if (!vendorId) { alert("Pick a market vendor"); return; }
    const rows = items.filter(it => it.product_id && (num(it.no_of_bags) || num(it.weight)) && num(it.rate));
    if (!rows.length) { alert("Add at least one product with quantity and rate"); return; }
    setSaving(true);
    try {
      const action = editId ? "update-purchase" : "add-purchase";
      await api(`market?action=${action}`, { method: "POST", body: JSON.stringify({
        id: editId || undefined,
        vendor_id: vendorId, purchase_date: purchaseDate, note: note || null,
        items: rows.map(it => ({ product_id: it.product_id, unit_type: it.unit_type,
          no_of_bags: num(it.no_of_bags), weight: num(it.weight), rate: num(it.rate) })),
      }) });
      reset();
      load(); onChange();
      // Straight to the next vendor search for fast back-to-back entry.
      setTimeout(() => document.querySelector(".mkt-vendor")?.focus(), 60);
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  // Load an existing (unsettled) purchase into the form for editing.
  const edit = (row) => {
    setEditId(row.id);
    setVendorId(row.vendor_id);
    setPurchaseDate(row.purchase_date);
    setNote(row.note || "");
    const formItems = (row.items || []).map(it => ({
      product_id: it.product_id, product_name: it.product_name || "",
      unit_type: (it.unit_type || "KG").toUpperCase(),
      no_of_bags: num(it.no_of_bags) ? String(num(it.no_of_bags)) : "",
      weight: num(it.weight) ? String(num(it.weight)) : "",
      rate: num(it.rate) ? String(num(it.rate)) : "",
    }));
    setItems(formItems.length ? formItems : [newItem()]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const del = async (row) => {
    if (!window.confirm(`Delete this ${fmt.currency(row.amount)} purchase from ${row.vendor_name}?`)) return;
    try { await api("market?action=delete-purchase", { method: "POST", body: JSON.stringify({ id: row.id }) }); load(); onChange(); }
    catch (e) { alert(e.message); }
  };

  const itemsLabel = (r) => (r.items && r.items.length)
    ? r.items.map(it => `${it.product_name} ${(it.unit_type || "KG").toUpperCase() === "BAG" ? num(it.no_of_bags) + "bag" : num(it.weight) + "kg"}`).join(", ")
    : (r.note || "");

  const [printing, setPrinting] = useState(false);
  const listTotal = list.reduce((a, r) => a + num(r.amount), 0);
  const exportCSV = () => downloadCSV(`market_purchases_${from}_${to}.csv`, [
    ["Date", "Vendor", "Items", "Amount", "Status"],
    ...list.map(r => [r.purchase_date, r.vendor_name, itemsLabel(r), r.amount, r.is_settled == 1 ? "settled" : "open"]),
    [], ["", "", "TOTAL", listTotal, ""],
  ]);

  return (
    <div>
      {/* Entry */}
      <div style={{ ...card, padding: 18, ...(editId ? { border: "1.5px solid #f59e0b" } : {}) }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{editId ? "✏️ Edit market purchase" : "Record a market purchase"}</div>
          {editId && <button onClick={reset} style={{ background: "#f3f4f6", border: "none", borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#374151" }}>✕ Cancel edit</button>}
        </div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>What we bought from a market vendor — itemised by product. Date defaults to the working day.</div>
        <div style={{ fontSize: 11, color: "#92400e", background: "#fffbeb", border: "1px dashed #f59e0b", borderRadius: 7, padding: "7px 9px", marginBottom: 14 }}>
          ⏳ Held pending — these post to the vendor's ledger only when you run <strong>Weekly Settlement</strong> (Adjust/Settle), netted against their sales.
        </div>
        <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label style={label}>Vendor</label>
            <SearchableSelect className="mkt-vendor" value={vendorId} options={vOpts}
              onChange={(id) => setVendorId(id)}
              onAdvance={() => document.querySelector(".mkt-prod")?.focus()}
              placeholder="🔍 Search market vendor..." style={input} />
          </div>
          <div style={{ width: 160 }}>
            <label style={label}>Date (working day)</label>
            <input type="date" value={purchaseDate} readOnly style={{ ...input, background: "#f9fafb", color: "#374151" }} />
          </div>
          {selVendor && (() => {
            const sd = num(selVendor.sales_due), po = num(selVendor.purchases_owed), net = num(selVendor.net_owed);
            return (
              <div style={{ minWidth: 210, background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, padding: "6px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>Balance before this bill</div>
                <div style={{ display: "flex", gap: 16, marginTop: 3 }}>
                  <div><div style={{ fontSize: 10, color: "#888" }}>They owe us</div><div style={{ fontWeight: 700, color: "#16a34a" }}>{fmt.currency(sd)}</div></div>
                  <div><div style={{ fontSize: 10, color: "#888" }}>We owe (pending)</div><div style={{ fontWeight: 700, color: "#7c3aed" }}>{fmt.currency(po)}</div></div>
                </div>
                <div style={{ marginTop: 4, fontSize: 12, fontWeight: 700, color: net >= 0 ? "#7c3aed" : "#16a34a" }}>
                  Net: {net >= 0 ? "we owe" : "they owe"} {fmt.currency(Math.abs(net))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Item lines — Enter/Tab walks Product → Bags → Weight → Rate → next row */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(170px,1fr) 60px 84px 100px 100px 120px 34px", gap: 8, padding: "0 2px 6px", borderBottom: "1px solid #eef2f7" }}>
            {["Product", "Unit", "Bags", "Weight (kg)", "Rate ₹", "Amount ₹", ""].map((h, i) =>
              <span key={i} style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: i >= 2 && i <= 5 ? "right" : (i === 1 ? "center" : "left") }}>{h}</span>)}
          </div>
          {items.map((it, i) => (
            <div key={i} className="mkt-row" style={{ display: "grid", gridTemplateColumns: "minmax(170px,1fr) 60px 84px 100px 100px 120px 34px", gap: 8, alignItems: "center", padding: "6px 2px" }}>
              <SearchableSelect className="mkt-prod" value={it.product_id} options={productOpts} placeholder="Product…"
                onChange={(id, opt) => pickProduct(i, id, opt)}
                onAdvance={(el) => el.closest(".mkt-row")?.querySelector(".mkt-bag")?.focus()}
                onEmptyEnter={() => document.querySelector(".mkt-save")?.focus()}
                onEscape={() => document.querySelector(".mkt-save")?.focus()}
                style={{ ...input, padding: "7px 8px", fontSize: 13 }} />
              <span style={{ fontSize: 12, color: "#666", textAlign: "center" }}>{it.unit_type}</span>
              <input className="mkt-bag" type="number" value={it.no_of_bags} onChange={e => setItem(i, { no_of_bags: e.target.value })}
                onKeyDown={e => advance(e, ".mkt-row", ".mkt-wt")} style={{ ...input, textAlign: "right", padding: "7px 8px" }} />
              <input className="mkt-wt" type="number" value={it.weight} onChange={e => setItem(i, { weight: e.target.value })}
                onKeyDown={e => advance(e, ".mkt-row", ".mkt-rate")} style={{ ...input, textAlign: "right", padding: "7px 8px" }} />
              <input className="mkt-rate" type="number" value={it.rate} onChange={e => setItem(i, { rate: e.target.value })}
                onKeyDown={e => {
                  if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                    e.preventDefault();
                    const next = document.querySelectorAll(".mkt-prod")[i + 1];
                    if (next) { next.focus(); return; }
                    addRow();
                    setTimeout(() => { const s = document.querySelectorAll(".mkt-prod"); s[s.length - 1]?.focus(); }, 40);
                  }
                }}
                style={{ ...input, textAlign: "right", padding: "7px 8px" }} />
              <span style={{ textAlign: "right", fontWeight: 600 }}>{fmt.currency(itemAmt(it))}</span>
              <button onClick={() => delRow(i)} style={{ background: "#fee2e2", border: "none", borderRadius: 6, color: "#dc2626", padding: "6px 9px", cursor: "pointer" }}>✕</button>
            </div>
          ))}
        </div>
        <button onClick={addRow} style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, color: "#16a34a", fontWeight: 600, padding: "8px 14px", cursor: "pointer", fontSize: 13, marginBottom: 14 }}>+ Add product</button>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={label}>Note (optional)</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. lorry no., remarks" style={input} />
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, color: "#888" }}>Total</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#1a7a45" }}>{fmt.currency(total)}</div>
          </div>
          <button className="mkt-save" onClick={save} disabled={saving} style={btn(saving ? "#9ca3af" : (editId ? "#d97706" : "#1a7a45"))}>{editId ? "💾 Update purchase" : "✅ Save purchase"}</button>
        </div>
      </div>

      {/* List */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Purchases</div>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...input, width: "auto" }} />
          <span style={{ color: "#888" }}>→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...input, width: "auto" }} />
          <div style={{ flex: 1 }} />
          <button onClick={exportCSV} disabled={!list.length} style={{ padding: "8px 14px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, color: "#16a34a", fontWeight: 600, cursor: list.length ? "pointer" : "default", fontSize: 13, opacity: list.length ? 1 : 0.5 }}>⬇️ Export</button>
          <button onClick={() => setPrinting(true)} disabled={!list.length} style={{ padding: "8px 14px", background: "#1a7a45", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: list.length ? "pointer" : "default", fontSize: 13, opacity: list.length ? 1 : 0.5 }}>🖨️ Print</button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Bill No</th><th style={th}>Date</th><th style={th}>Vendor</th><th style={th}>Items</th><th style={{ ...th, textAlign: "right" }}>Amount</th><th style={th}>Status</th><th style={th}></th></tr></thead>
            <tbody>
              {list.length === 0 ? <tr><td style={{ ...td, color: "#999", textAlign: "center" }} colSpan={7}>No purchases in this range</td></tr> :
              list.map(r => (
                <tr key={r.id} style={editId === r.id ? { background: "#fffbeb" } : undefined}>
                  <td style={{ ...td, fontWeight: 600, color: "#2563eb", whiteSpace: "nowrap" }}>{r.bill_no || `#${r.id}`}</td>
                  <td style={td}>{r.purchase_date}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{r.vendor_name}</td>
                  <td style={{ ...td, whiteSpace: "normal", maxWidth: 320 }}>{itemsLabel(r)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmt.currency(r.amount)}</td>
                  <td style={td}>{r.is_settled == 1 ? <span style={{ color: "#16a34a" }}>settled</span> : <span style={{ color: "#ca8a04" }}>open</span>}</td>
                  <td style={td}>{r.is_settled == 1 ? "" : (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => edit(r)} title="Edit" style={{ padding: "4px 8px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, color: "#b45309", cursor: "pointer" }}>✏️</button>
                      <button onClick={() => del(r)} title="Delete" style={{ padding: "4px 8px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", cursor: "pointer" }}>🗑️</button>
                    </div>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {printing && <PrintPurchaseList list={list} total={listTotal} from={from} to={to} itemsLabel={itemsLabel} onClose={() => setPrinting(false)} />}
    </div>
  );
}

// Clean printable list of market purchases for a date range (A4 portrait).
function PrintPurchaseList({ list, total, from, to, itemsLabel, onClose }) {
  useEffect(() => { const t = setTimeout(() => window.print(), 300); return () => clearTimeout(t); }, []);
  const d = (s) => new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "2-digit" });
  return createPortal(
    <div className="mkt-print-portal">
      <style>{`
        .mkt-print-portal { position: fixed; inset: 0; background: #f3f4f6; overflow: auto; z-index: 2000; font-family: 'Noto Sans Tamil',Inter, 'Segoe UI', system-ui, sans-serif; }
        .mkt-sheet { width: 190mm; margin: 0 auto 16px; box-sizing: border-box; background: #fff; padding: 12mm; }
        .mkt-sheet table { width: 100%; border-collapse: collapse; }
        .mkt-sheet td, .mkt-sheet th { border: 1px solid #1a7a45; padding: 5px 8px; font-size: 12px; }
        .mkt-sheet th { background: #eafaf0; font-weight: 700; }
        @media screen { .mkt-sheet { box-shadow: 0 1px 10px rgba(0,0,0,0.18); margin-top: 16px; } }
        @media print {
          .no-print { display: none !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body > *:not(.mkt-print-portal) { display: none !important; }
          .mkt-print-portal { position: static; overflow: visible; background: #fff; }
          .mkt-sheet { margin: 0; box-shadow: none; width: auto; padding: 8mm; }
          @page { size: A4 portrait; margin: 8mm; }
        }
      `}</style>
      <div className="no-print" style={{ padding: "16px 20px", display: "flex", gap: 10, alignItems: "center", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
        <button onClick={() => window.print()} style={btn("#1a7a45")}>🖨️ Print</button>
        <button onClick={onClose} style={{ background: "white", border: "1px solid #d1d5db", borderRadius: 8, padding: "10px 18px", cursor: "pointer" }}>Close</button>
      </div>
      <div className="mkt-sheet">
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#1a7a45" }}>Market Purchases</div>
          <div style={{ fontSize: 12, color: "#444" }}>{d(from)} — {d(to)}</div>
        </div>
        <table>
          <thead><tr>
            <th style={{ textAlign: "left", width: 70 }}>Date</th>
            <th style={{ textAlign: "left" }}>Vendor</th>
            <th style={{ textAlign: "left" }}>Items</th>
            <th style={{ textAlign: "right", width: 90 }}>Amount ₹</th>
            <th style={{ textAlign: "center", width: 56 }}>Status</th>
          </tr></thead>
          <tbody>
            {list.map(r => (
              <tr key={r.id}>
                <td>{d(r.purchase_date)}</td>
                <td style={{ fontWeight: 600 }}>{r.vendor_name}</td>
                <td>{itemsLabel(r)}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{num(r.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                <td style={{ textAlign: "center" }}>{r.is_settled == 1 ? "settled" : "open"}</td>
              </tr>
            ))}
            <tr style={{ background: "#eafaf0" }}>
              <td colSpan={3} style={{ textAlign: "right", fontWeight: 800 }}>Total</td>
              <td style={{ textAlign: "right", fontWeight: 800 }}>{num(total).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>,
    document.body
  );
}

// Saved discount % per vendor (used as the default at settlement). Saves on its own.
function VendorDiscounts({ vendors, onChange }) {
  const [open, setOpen] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const save = async (id, val, prev) => {
    if (parseFloat(val || 0) === parseFloat(prev || 0)) return;
    setSavingId(id);
    try { await api("market?action=set-discount", { method: "POST", body: JSON.stringify({ vendor_id: id, pct: parseFloat(val) || 0 }) }); onChange(); }
    catch (e) { alert(e.message); }
    finally { setSavingId(null); }
  };
  return (
    <div style={card}>
      <button onClick={() => setOpen(o => !o)} style={{ background: "none", border: "none", fontWeight: 700, fontSize: 15, cursor: "pointer", padding: 0 }}>
        {open ? "▾" : "▸"} Vendor discount % <span style={{ fontWeight: 400, fontSize: 12, color: "#888" }}>(saved per vendor — auto-applies at settlement)</span>
      </button>
      {open && (
        vendors.length === 0 ? <div style={{ color: "#999", fontSize: 13, marginTop: 12 }}>No market vendors yet. Tag a party as a Market Vendor in Parties first.</div> :
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 10, marginTop: 12 }}>
          {vendors.map(v => (
            <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid #eef2f7", borderRadius: 8, padding: "6px 10px" }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name_en}</span>
              <input type="number" step="0.5" min="0" defaultValue={v.market_discount_pct}
                onBlur={e => save(v.id, e.target.value, v.market_discount_pct)}
                onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                style={{ ...input, width: 68, textAlign: "right", padding: "4px 6px" }} />
              <span style={{ fontSize: 12, color: "#888" }}>{savingId === v.id ? "…" : "%"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- View Bills ----------------
function ViewBillsTab({ vendors }) {
  const workingDate = getWorkingDate();
  const weekAgo = new Date(new Date(workingDate).getTime() - 6 * 86400000).toISOString().split("T")[0];
  const [from, setFrom]           = useState(weekAgo);
  const [to, setTo]               = useState(workingDate);
  const [vendorFilter, setVendorFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [list, setList]           = useState([]);
  const [loading, setLoading]     = useState(false);

  const load = () => {
    setLoading(true);
    api(`market?action=purchases&from=${from}&to=${to}`)
      .then(r => setList(r.data || []))
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [from, to]);

  // Collect unique products across all loaded bills
  const allProducts = [];
  const seenProd = new Set();
  list.forEach(r => (r.items || []).forEach(it => {
    if (!seenProd.has(it.product_id)) { seenProd.add(it.product_id); allProducts.push({ id: it.product_id, name: it.product_name }); }
  }));

  // Apply filters
  const vq = vendorFilter.trim().toLowerCase();
  const filtered = list.filter(r => {
    const vendorMatch = !vq || (r.vendor_name || "").toLowerCase().includes(vq);
    const productMatch = !productFilter || (r.items || []).some(it => String(it.product_id) === String(productFilter));
    return vendorMatch && productMatch;
  });

  // Bill-level totals
  const totalAmt = filtered.reduce((s, r) => s + num(r.amount), 0);

  // Product-level aggregates (only when product filter active)
  let prodWeight = 0, prodAmt = 0;
  if (productFilter) {
    filtered.forEach(r => (r.items || []).filter(it => String(it.product_id) === String(productFilter)).forEach(it => {
      prodWeight += num(it.weight) || num(it.no_of_bags);
      prodAmt    += num(it.amount);
    }));
  }

  const d = s => s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "";

  return (
    <div style={card}>
      {/* Filters */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
        <div>
          <label style={label}>From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...input, width: "auto" }} />
        </div>
        <div>
          <label style={label}>To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...input, width: "auto" }} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label style={label}>Search vendor</label>
          <input value={vendorFilter} onChange={e => setVendorFilter(e.target.value)} placeholder="Vendor name…" style={input} />
        </div>
        <div style={{ minWidth: 180 }}>
          <label style={label}>Filter by product</label>
          <select value={productFilter} onChange={e => setProductFilter(e.target.value)} style={input}>
            <option value="">All products</option>
            {allProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <button onClick={load} style={{ padding: "9px 16px", background: "#1a7a45", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>🔄 Refresh</button>
      </div>

      {/* Table */}
      {loading ? <div style={{ padding: 20, textAlign: "center", color: "#888" }}>Loading…</div> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["S.No", "Bill No", "Date", "Vendor Name", "Bill Amount", "Status"].map((h, i) => (
                  <th key={h} style={{ ...th, textAlign: i >= 4 ? "right" : "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan={6} style={{ ...td, textAlign: "center", color: "#999" }}>No bills found</td></tr>
                : filtered.map((r, i) => (
                  <tr key={r.id}>
                    <td style={{ ...td, color: "#888" }}>{i + 1}</td>
                    <td style={{ ...td, fontWeight: 600, color: "#2563eb", whiteSpace: "nowrap" }}>{r.bill_no || `#${r.id}`}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{d(r.purchase_date)}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{r.vendor_name}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmt.currency(r.amount)}</td>
                    <td style={td}>
                      {r.is_settled == 1
                        ? <span style={{ color: "#16a34a", fontWeight: 600 }}>Settled</span>
                        : <span style={{ color: "#ca8a04", fontWeight: 600 }}>Open</span>}
                    </td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      )}

      {/* Totals footer */}
      {filtered.length > 0 && (
        <div style={{ marginTop: 14, padding: "12px 14px", background: "#f0fdf4", borderRadius: 8, border: "1px solid #bbf7d0" }}>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <span style={{ fontSize: 12, color: "#166534" }}>{filtered.length} bill{filtered.length > 1 ? "s" : ""}</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: "#15803d", marginLeft: 10 }}>Total: {fmt.currency(totalAmt)}</span>
            </div>
            {productFilter && (
              <>
                <div style={{ fontSize: 12, color: "#166534" }}>
                  Product weight: <strong>{prodWeight.toFixed(2)} kg</strong>
                </div>
                <div style={{ fontSize: 12, color: "#166534" }}>
                  Product amount: <strong>{fmt.currency(prodAmt)}</strong>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Weekly Settlement ----------------
function SettlementTab({ vendors, onChange }) {
  const [upTo, setUpTo] = useState(today());
  const [rows, setRows] = useState([]);     // preview rows, each with editable net_sales / amount_paid / discount_pct
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);
  const [histFrom, setHistFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0]);
  const [histTo, setHistTo] = useState(today());

  const loadPreview = () => {
    setLoading(true);
    api(`market?action=settlement-preview&up_to=${upTo}`)
      .then(r => setRows((r.data || []).map(v => ({ ...v, pay: v.net_owed, net_sales_edit: v.net_sales, disc_edit: v.discount_pct }))))
      .catch(() => setRows([])).finally(() => setLoading(false));
  };
  const loadHistory = () => api(`market?action=settlements&from=${histFrom}&to=${histTo}`).then(r => setHistory(r.data || [])).catch(() => setHistory([]));
  useEffect(() => { loadPreview(); }, [upTo, vendors]);   // re-default discounts when a vendor % is saved
  useEffect(() => { loadHistory(); }, [histFrom, histTo]);

  const reverse = async (h) => {
    if (!window.confirm(`Delete this settlement for ${h.vendor_name} (${h.settle_date})?\n\nThis re-opens the ${fmt.currency(h.purchases_total)} of purchases, restores the ${fmt.currency(h.sales_netted)} netted against their sales bills, and removes the ledger entries.`)) return;
    setBusy(true);
    try {
      await api("market?action=delete-settlement", { method: "POST", body: JSON.stringify({ id: h.id }) });
      loadPreview(); loadHistory(); onChange();
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const recompute = (row) => {
    const P = parseFloat(row.purchases_total) || 0;
    const D = Math.round(P * (parseFloat(row.disc_edit) || 0)) / 100;
    const S = Math.min(parseFloat(row.net_sales_edit) || 0, parseFloat(row.sales_due) || 0, Math.max(0, P - D));
    const net = Math.round((P - D - S) * 100) / 100;
    return { D: Math.round(D * 100) / 100, S, net };
  };

  const settle = async (row) => {
    const { D, S, net } = recompute(row);
    const pay = parseFloat(row.pay) || 0;
    const carry = Math.round((net - pay) * 100) / 100;
    if (!window.confirm(`Settle ${row.name_en}?\n\nWe owe: ${fmt.currency(row.purchases_total)}\nDiscount: ${fmt.currency(D)}\nNetted vs their dues: ${fmt.currency(S)}\nPay now: ${fmt.currency(pay)}\nCarried forward: ${fmt.currency(carry)}`)) return;
    setBusy(true);
    try {
      await api("market?action=settle", { method: "POST", body: JSON.stringify({
        vendor_id: row.id, up_to: upTo, discount_pct: parseFloat(row.disc_edit) || 0, discount_amt: D,
        net_sales: S, amount_paid: pay, payment_mode: "cash" }) });
      loadPreview(); loadHistory(); onChange();
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const totOwe = rows.reduce((s, r) => s + recompute(r).net, 0);

  return (
    <div>
      <VendorDiscounts vendors={vendors} onChange={onChange} />
      <div style={{ ...card, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div><label style={label}>Settle purchases up to</label>
          <input type="date" value={upTo} onChange={e => setUpTo(e.target.value)} style={{ ...input, width: "auto" }} /></div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: 12, color: "#888" }}>Net we owe these vendors</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#dc2626" }}>{fmt.currency(totOwe)}</div>
        </div>
        <button onClick={() => window.print()} style={{ ...btn("#374151"), padding: "8px 14px" }}>🖨️ Print</button>
      </div>

      <div style={card}>
        {loading ? <div style={{ padding: 20, textAlign: "center", color: "#666" }}>Loading…</div> :
        rows.length === 0 ? <div style={{ padding: 24, textAlign: "center", color: "#999" }}>No vendors with unsettled purchases up to this date.</div> :
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
            <thead><tr>
              <th style={th}>Vendor</th>
              <th style={{ ...th, textAlign: "right" }}>We owe</th>
              <th style={{ ...th, textAlign: "right" }}>Disc %</th>
              <th style={{ ...th, textAlign: "right" }}>Discount</th>
              <th style={{ ...th, textAlign: "right" }}>Their dues</th>
              <th style={{ ...th, textAlign: "right" }}>Net off</th>
              <th style={{ ...th, textAlign: "right" }}>Net owed</th>
              <th style={{ ...th, textAlign: "right" }}>Pay now</th>
              <th style={{ ...th, textAlign: "right" }}>Carry</th>
              <th style={th}></th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const { D, S, net } = recompute(r);
                const pay = parseFloat(r.pay) || 0;
                const carry = Math.round((net - pay) * 100) / 100;
                const upd = (k, v) => setRows(p => p.map((x, j) => j === i ? { ...x, [k]: v } : x));
                return (
                  <tr key={r.id}>
                    <td style={{ ...td, fontWeight: 600 }}>{r.name_en}{r.name_ta ? <span style={{ color: "#888", fontWeight: 400 }}> / {r.name_ta}</span> : ""}</td>
                    <td style={{ ...td, textAlign: "right" }}>{fmt.currency(r.purchases_total)}</td>
                    <td style={{ ...td, textAlign: "right" }}><input type="number" step="0.5" value={r.disc_edit} onChange={e => upd("disc_edit", e.target.value)} style={{ ...input, width: 62, textAlign: "right", padding: "4px 6px" }} /></td>
                    <td style={{ ...td, textAlign: "right", color: "#ea580c" }}>{fmt.currency(D)}</td>
                    <td style={{ ...td, textAlign: "right" }}>{fmt.currency(r.sales_due)}</td>
                    <td style={{ ...td, textAlign: "right" }}><input type="number" value={r.net_sales_edit} onChange={e => upd("net_sales_edit", e.target.value)} style={{ ...input, width: 90, textAlign: "right", padding: "4px 6px" }} /></td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmt.currency(net)}</td>
                    <td style={{ ...td, textAlign: "right" }}><input type="number" value={r.pay} onChange={e => upd("pay", e.target.value)} style={{ ...input, width: 100, textAlign: "right", padding: "4px 6px" }} /></td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 600, color: carry > 0 ? "#dc2626" : "#16a34a" }}>{fmt.currency(carry)}</td>
                    <td style={td}><button disabled={busy} onClick={() => settle(r)} style={{ ...btn("#1a7a45"), padding: "6px 12px", fontSize: 13 }}>Settle</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: "#888", marginTop: 10 }}>
            "Net off" = how much of their dues to you we cancel against what we owe them (their sales bills get marked paid). "Carry" stays as a running balance for next week. All postings show in Tally / Party Ledger.
          </div>
        </div>}
      </div>

      {/* History */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Recent settlements</div>
          <input type="date" value={histFrom} onChange={e => setHistFrom(e.target.value)} style={{ ...input, width: "auto" }} />
          <span style={{ color: "#888" }}>→</span>
          <input type="date" value={histTo} onChange={e => setHistTo(e.target.value)} style={{ ...input, width: "auto" }} />
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Date</th><th style={th}>Vendor</th>
              <th style={{ ...th, textAlign: "right" }}>Outstanding</th>
              <th style={{ ...th, textAlign: "right" }}>Purchases</th>
              <th style={{ ...th, textAlign: "right" }}>Discount</th>
              <th style={{ ...th, textAlign: "right" }}>Netted</th>
              <th style={{ ...th, textAlign: "right" }}>Paid</th>
              <th style={{ ...th, textAlign: "right" }}>Carried</th>
              <th style={th}></th>
            </tr></thead>
            <tbody>
              {history.length === 0 ? <tr><td style={{ ...td, color: "#999", textAlign: "center" }} colSpan={9}>No settlements in this range</td></tr> :
              history.map(h => {
                const outstanding = Math.round((num(h.purchases_total) - num(h.discount_amt) - num(h.sales_netted)) * 100) / 100;
                return (
                <tr key={h.id}>
                  <td style={td}>{h.settle_date}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{h.vendor_name}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{fmt.currency(outstanding)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{fmt.currency(h.purchases_total)}</td>
                  <td style={{ ...td, textAlign: "right", color: "#ea580c" }}>{fmt.currency(h.discount_amt)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{fmt.currency(h.sales_netted)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{fmt.currency(h.amount_paid)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 600, color: num(h.carry_balance) > 0 ? "#dc2626" : "#16a34a" }}>{fmt.currency(h.carry_balance)}</td>
                  <td style={td}><button disabled={busy} onClick={() => reverse(h)} title="Delete / reverse settlement"
                    style={{ padding: "4px 8px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", cursor: busy ? "default" : "pointer" }}>🗑️</button></td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
