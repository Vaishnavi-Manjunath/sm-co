import { useState, useEffect, useMemo } from "react";
import { api, apiCached, SearchableSelect, fmt, getWorkingDate } from "../App.jsx";

// Shared "View Bills" screen for Purchase & Sales. Date-range + party + product
// (+ reference for purchase) filters, sortable columns, serial numbers, a totals
// row, and a printed/not-printed indicator (flags reprints that could be cashed twice).
const todayStr = () => new Date().toISOString().split("T")[0];

export default function BillsViewer({ kind, onEdit, onPrintIds, reloadSignal }) {
  const isPur = kind === "purchase";
  // Remember the chosen filters per module for this session, so leaving (e.g. to edit a
  // bill) and coming back keeps the date/party/product you were looking at instead of
  // resetting to today. Defaults to the working/business date on a fresh session.
  const SKEY = `bv_${kind}`;
  const saved = () => { try { return JSON.parse(sessionStorage.getItem(SKEY) || "{}"); } catch { return {}; } };
  const [from, setFrom] = useState(() => saved().from || getWorkingDate());
  const [to, setTo]     = useState(() => saved().to || getWorkingDate());
  const [partyId, setPartyId]     = useState(() => saved().partyId || "");
  const [productId, setProductId] = useState(() => saved().productId || "");
  const [ref, setRef]   = useState(() => saved().ref || "");
  useEffect(() => {
    try { sessionStorage.setItem(SKEY, JSON.stringify({ from, to, partyId, productId, ref })); } catch {}
  }, [from, to, partyId, productId, ref]);
  const [bills, setBills]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel]   = useState([]);
  const [sortKey, setSortKey] = useState("bill_no");
  const [sortDir, setSortDir] = useState("asc");
  const [parties, setParties]   = useState([]);
  const [products, setProducts] = useState([]);
  const [trucks, setTrucks]     = useState([]);

  // Filter option lists
  useEffect(() => {
    const cats = isPur ? ["FARMER", "SUPPLIER", "MARKET_SUPPLIER"] : ["CUSTOMER", "OVERFLOW", "MARKET_VENDOR"];
    Promise.all(cats.map(c => apiCached(`parties?action=list&category=${c}&cols=lite`).catch(() => ({ data: [] }))))
      .then(rs => { const seen = new Set(); setParties(rs.flatMap(r => r.data || []).filter(x => !seen.has(x.id) && seen.add(x.id))); });
    apiCached("products?action=list").then(r => setProducts(r.data || [])).catch(() => {});
    if (isPur) apiCached("parties?action=list&category=TRUCK&cols=lite").then(r => setTrucks(r.data || [])).catch(() => {});
  }, [kind]);

  const load = () => {
    setLoading(true); setSel([]);
    let url = `${kind}?action=list&from=${from}&to=${to}`;
    if (partyId)   url += `&party_id=${partyId}`;
    if (productId) url += `&product_id=${productId}`;
    if (isPur && ref) url += `&ref=${encodeURIComponent(ref)}`;
    api(url).then(r => setBills(r.data || [])).catch(() => setBills([])).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [from, to, partyId, productId, ref, reloadSignal]);

  // Column config: [key, label, type, totalKey?] — built dynamically so the filtered
  // product's rate/weight columns appear only when a product filter is active.
  const cols = [];
  cols.push(["bill_date", "Date", "date"]);
  cols.push(["bill_no", "Bill No", "text"]);
  cols.push(["party_name", isPur ? "Farmer" : "Vendor", "text"]);
  if (productId) {
    cols.push(["f_rates", "Prod Rate ₹", "prate"]);
    cols.push(["f_weight", "Prod Wt", "kg"]);
  }
  if (isPur) {
    cols.push(["reference_name", "Reference", "ref"]);
    cols.push(["subtotal_weight", "Bill Wt", "kg"]);
    cols.push(["subtotal_amount", "Gross ₹", "money", "gross"]);
    cols.push(["total_commission", "Commission ₹", "money", "commission"]);
    cols.push(["net_payable", "Net ₹", "money", "net"]);
  } else {
    cols.push(["subtotal_amount", "Gross ₹", "money", "gross"]);
    cols.push(["net_amount", "Net ₹", "money", "net"]);
    cols.push(["balance_due", "Balance ₹", "money"]);
    cols.push(["payment_status", "Status", "status"]);
  }
  cols.push(["print_count", "Printed", "print"]);

  const setSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const sorted = useMemo(() => {
    const arr = [...bills];
    arr.sort((a, b) => {
      let x = a[sortKey], y = b[sortKey];
      const nx = parseFloat(x), ny = parseFloat(y);
      const numeric = !isNaN(nx) && !isNaN(ny) && String(x).trim() !== "" && String(y).trim() !== "";
      if (numeric) { x = nx; y = ny; } else { x = String(x ?? "").toLowerCase(); y = String(y ?? "").toLowerCase(); }
      if (x < y) return sortDir === "asc" ? -1 : 1;
      if (x > y) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [bills, sortKey, sortDir]);

  const totals = useMemo(() => {
    const t = { gross: 0, commission: 0, net: 0 };
    bills.forEach(b => {
      t.gross += parseFloat(b.subtotal_amount || 0);
      t.commission += parseFloat(b.total_commission || 0);
      t.net += parseFloat(isPur ? b.net_payable || 0 : b.net_amount || 0);
    });
    return t;
  }, [bills, isPur]);

  const toggle = (id) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const allSel = sorted.length > 0 && sorted.every(b => sel.includes(b.id));
  const toggleAll = () => setSel(allSel ? [] : sorted.map(b => b.id));

  // Send the bill to the party's WhatsApp (Tamil summary + tokenized view link)
  const share = async (b) => {
    try {
      const r = await api(`${kind}?action=share`, { method: "POST", body: JSON.stringify({ id: b.id }) });
      const d = r.data;
      if (d.wa_url) window.open(d.wa_url, "_blank");
      else {
        try { await navigator.clipboard.writeText(d.message); } catch {}
        alert(`No phone number saved for ${b.party_name}.\n\nThe bill message was copied — paste it into WhatsApp yourself, or add their number in Parties.`);
      }
    } catch (e) { alert("Error: " + e.message); }
  };

  const del = async (b) => {
    const amt = isPur ? b.net_payable : b.net_amount;
    if (!window.confirm(`⚠️ Delete bill ${b.bill_no}?\n\n${isPur ? "Farmer" : "Vendor"}: ${b.party_name}\nNet: ${fmt.currency(amt)}\n\nThis removes it from reports and reverses its entries. It cannot be undone.`)) return;
    try { await api(`${kind}?action=cancel`, { method: "POST", body: JSON.stringify({ id: b.id, reason: "Deleted from View Bills" }) }); load(); }
    catch (e) { alert("Error deleting bill: " + e.message); }
  };

  const cell = (b, key, type) => {
    const v = b[key];
    if (type === "date")   return v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—";
    if (type === "money")  return fmt.currency(v);
    if (type === "kg")     return `${parseFloat(v || 0).toFixed(1)} kg`;
    if (type === "prate") {
      const parts = String(v ?? "").split(",").map(s => s.trim()).filter(Boolean);
      if (!parts.length) return "—";
      const multi = parts.length > 1;
      const disp = parts.map(p => { const n = parseFloat(p); return "₹" + (n % 1 === 0 ? n.toFixed(0) : n); }).join(" / ");
      return <span title={multi ? "Different rates on the same bill — check!" : ""}
        style={{ fontWeight: 700, color: multi ? "#dc2626" : "#1a7a45" }}>{disp}{multi ? " ⚠️" : ""}</span>;
    }
    if (type === "ref")    return v
      ? <span style={{ background: "#eff6ff", color: "#2563eb", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>🚛 {v}</span>
      : <span style={{ color: "#9ca3af", fontSize: 11 }}>DIRECT</span>;
    if (type === "status") return <span style={{ padding: "2px 10px", borderRadius: 10, fontSize: 11, fontWeight: 600,
        background: v === "paid" ? "#dcfce7" : "#fef9c3", color: v === "paid" ? "#16a34a" : "#ca8a04" }}>{v}</span>;
    if (type === "print") {
      const n = parseInt(v || 0);
      if (!n) return <span style={{ color: "#9ca3af", fontSize: 11 }}>—  not printed</span>;
      const dup = n > 1;
      return <span title={b.last_printed_at ? `Last printed ${b.last_printed_at}` : ""}
        style={{ padding: "2px 9px", borderRadius: 10, fontSize: 11, fontWeight: 700,
          background: dup ? "#fef2f2" : "#dcfce7", color: dup ? "#dc2626" : "#16a34a" }}>
        {dup ? "⚠️ " : "🖨️ "}{n}×</span>;
    }
    return v ?? "—";
  };

  const th = (label, key, align) => (
    <th onClick={() => setSort(key)} style={{ padding: "10px 12px", textAlign: align || "left", fontSize: 12, fontWeight: 600,
      color: "#6b7280", borderBottom: "1px solid #e5e7eb", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}>
      {label}{sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );
  const selInp = { padding: "7px 10px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13 };
  const accent = isPur ? "#1a7a45" : "#2563eb";

  return (
    <div>
      {/* Filter bar */}
      <div style={{ background: "white", borderRadius: 12, padding: 14, marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
        display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div><label style={lbl}>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={selInp} /></div>
        <div><label style={lbl}>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} style={selInp} /></div>
        {[["Today", 0], ["7 days", 6], ["15 days", 14], ["This month", "month"]].map(([l, d]) => (
          <button key={l} onClick={() => {
            const t = new Date();
            if (d === "month") { setFrom(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-01`); setTo(todayStr()); }
            else { const f = new Date(); f.setDate(f.getDate() - d); setFrom(f.toISOString().split("T")[0]); setTo(todayStr()); }
          }} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #d1d5db", background: "#f9fafb", fontSize: 12, cursor: "pointer" }}>{l}</button>
        ))}
        <div style={{ minWidth: 200 }}>
          <label style={lbl}>{isPur ? "Farmer" : "Vendor"}</label>
          <SearchableSelect value={partyId} options={parties.map(p => ({ id: p.id, label: `${p.name_en}${p.name_ta ? " / " + p.name_ta : ""}` }))}
            onChange={setPartyId} placeholder={`All ${isPur ? "farmers" : "vendors"}`} style={{ ...selInp, width: "100%" }} />
        </div>
        <div>
          <label style={lbl}>Product</label>
          <select value={productId} onChange={e => setProductId(e.target.value)} style={{ ...selInp, maxWidth: 170 }}>
            <option value="">All products</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name_en}{p.name_ta ? ` / ${p.name_ta}` : ""}</option>)}
          </select>
        </div>
        {isPur && (
          <div>
            <label style={lbl}>Reference</label>
            <select value={ref} onChange={e => setRef(e.target.value)} style={{ ...selInp, maxWidth: 150 }}>
              <option value="">All</option>
              <option value="DIRECT">DIRECT (no truck)</option>
              {trucks.map(t => <option key={t.id} value={t.name_en}>{t.name_en}</option>)}
            </select>
          </div>
        )}
        {(partyId || productId || ref) && (
          <button onClick={() => { setPartyId(""); setProductId(""); setRef(""); }}
            style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #fca5a5", background: "white", color: "#dc2626", fontSize: 12, cursor: "pointer" }}>✕ Clear</button>
        )}
      </div>

      {/* Bulk + count */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "#6b7280" }}>{loading ? "Loading…" : `${bills.length} bill${bills.length === 1 ? "" : "s"}`} · {sel.length} selected</span>
        <button onClick={() => sel.length && onPrintIds(sel)} disabled={sel.length === 0}
          style={{ padding: "7px 16px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 600,
            cursor: sel.length === 0 ? "not-allowed" : "pointer", background: sel.length === 0 ? "#e5e7eb" : accent, color: sel.length === 0 ? "#9ca3af" : "white" }}>
          🖨️ Print Selected{sel.length > 0 ? ` (${sel.length})` : ""}
        </button>
      </div>

      <div style={{ background: "white", borderRadius: 12, overflow: "auto", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              <th style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb", width: 32 }}>
                <input type="checkbox" checked={allSel} onChange={toggleAll} />
              </th>
              {th("#", "id", "left")}
              {cols.map(([key, label, type]) => th(label, key, ["money", "kg", "prate"].includes(type) ? "right" : "left"))}
              <th style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb" }}></th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={cols.length + 3} style={{ padding: 30, textAlign: "center", color: "#666" }}>{loading ? "Loading…" : "No bills match these filters"}</td></tr>
            ) : sorted.map((b, i) => (
              <tr key={b.id} style={{ background: sel.includes(b.id) ? "#eff6ff" : (i % 2 === 0 ? "white" : "#fafafa") }}>
                <td style={{ padding: "9px 12px", textAlign: "center" }}>
                  <input type="checkbox" checked={sel.includes(b.id)} onChange={() => toggle(b.id)} />
                </td>
                <td style={{ padding: "9px 12px", fontSize: 12, color: "#9ca3af" }}>{i + 1}</td>
                {cols.map(([key, , type]) => (
                  <td key={key} style={{ padding: "9px 12px", fontSize: 12.5,
                    textAlign: ["money", "kg", "prate"].includes(type) ? "right" : "left",
                    fontWeight: key === "bill_no" || key === "net_payable" || key === "net_amount" ? 700 : 400,
                    color: key === "bill_no" ? accent : (key === "total_commission" ? "#7c3aed" : (key === "balance_due" ? "#dc2626" : "#374151")) }}>
                    {cell(b, key, type)}
                  </td>
                ))}
                <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                  <button onClick={() => onEdit(b)} style={actBtn("#eff6ff", "#bfdbfe", "#2563eb")}>✏️</button>
                  <button onClick={() => onPrintIds([b.id])} style={actBtn("#f3f4f6", "transparent", "#374151")}>🖨️</button>
                  <button onClick={() => share(b)} title="Send on WhatsApp" style={actBtn("#f0fdf4", "#bbf7d0", "#16a34a")}>📲</button>
                  <button onClick={() => del(b)} style={actBtn("#fef2f2", "#fecaca", "#dc2626")}>🗑️</button>
                </td>
              </tr>
            ))}
          </tbody>
          {bills.length > 0 && (() => {
            // Generic totals row: label spans up to the first money-total column, then each
            // total column shows its sum (handles the optional product columns automatically).
            const firstTotal = cols.findIndex(c => c[3]);
            if (firstTotal < 0) return null;
            return (
              <tfoot>
                <tr style={{ background: "#f0fdf4", fontWeight: 800, borderTop: "2px solid " + accent }}>
                  <td colSpan={2 + firstTotal} style={{ padding: "11px 12px", textAlign: "right", fontSize: 13 }}>TOTAL ({bills.length}) :</td>
                  {cols.slice(firstTotal).map(([key, , , totKey]) => (
                    <td key={key} style={{ padding: "11px 12px", textAlign: "right",
                      fontSize: totKey === "net" ? 14 : 13,
                      color: totKey === "commission" ? "#7c3aed" : (totKey === "net" ? accent : "#374151") }}>
                      {totKey ? fmt.currency(totals[totKey]) : ""}
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            );
          })()}
        </table>
      </div>
    </div>
  );
}

const lbl = { display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4 };
const actBtn = (bg, border, color) => ({ padding: "4px 9px", background: bg, border: `1px solid ${border}`, borderRadius: 6, color, cursor: "pointer", fontSize: 12, fontWeight: 600, marginRight: 5 });
