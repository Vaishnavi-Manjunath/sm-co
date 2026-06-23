// ============================================================
//  IDNUK SOFTWARE - Sales Bill Entry Page
//  Selling to Vendors / Customers
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { api, apiCached, fmt, getWorkingDate } from "../App.jsx";

const EMPTY_ITEM = {
  product_id: "", product_name: "", product_name_ta: "",
  unit_type: "KG", no_of_bags: 1,
  purchase_weight: 0, vendor_weight: "", weight_profit: 1,
  purchase_rate: 0, sale_rate: "",
  gross_amount: 0, discount_pct: 0, discount_amt: 0,
  sakku_qty: 0, sakku_rate: 0, sakku_amt: 0,
  cooly_amt: 0, net_amount: 0, margin_amount: 0,
};

export default function SalesPage() {
  const [view, setView] = useState("list");
  const [selectedId, setSelectedId] = useState(null);
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split("T")[0]);
  const [statusFilter, setStatusFilter] = useState("");

  const loadBills = useCallback(() => {
    setLoading(true);
    const statusParam = statusFilter ? `&status=${statusFilter}` : "";
    api(`sales?action=list&from=${dateFilter}&to=${dateFilter}${statusParam}`)
      .then(r => setBills(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [dateFilter, statusFilter]);

  useEffect(() => { loadBills(); }, [loadBills]);

  if (view === "new")    return <SalesForm onDone={() => { setView("list"); loadBills(); }} />;
  if (view === "detail") return <SalesDetail id={selectedId} onBack={() => setView("list")} onRefresh={loadBills} />;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>🧾 Sales Bills <span style={{ fontSize: 13, color: "#666" }}>விற்பனை பில்</span></h1>
          <p style={{ margin: "4px 0 0", color: "#666", fontSize: 13 }}>Selling to vendors and customers</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}
            style={inputStyle2} />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={inputStyle2}>
            <option value="">All Status</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Partial</option>
            <option value="overdue">Overdue</option>
            <option value="paid">Paid</option>
          </select>
          <Btn onClick={() => setView("new")} color="#2563eb">+ New Sales Bill</Btn>
        </div>
      </div>

      <DailySalesSummary date={dateFilter} />

      <div style={{ background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              {["Bill No", "Vendor", "Date", "Due Date", "KG", "Net Amount ₹", "Paid ₹", "Balance ₹", "Status", ""].map(h => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 40, textAlign: "center", color: "#666" }}>Loading...</td></tr>
            ) : bills.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 40, textAlign: "center", color: "#666" }}>
                No bills found. <span style={{ color: "#2563eb", cursor: "pointer" }} onClick={() => setView("new")}>Create one →</span>
              </td></tr>
            ) : bills.map((b, i) => (
              <tr key={b.id} style={{ background: i % 2 === 0 ? "white" : "#fafafa", cursor: "pointer" }}
                onClick={() => { setSelectedId(b.id); setView("detail"); }}>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontWeight: 600, color: "#2563eb", fontSize: 13 }}>{b.bill_no}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{b.party_name}</div>
                  {b.party_name_ta && <div style={{ fontSize: 11, color: "#888" }}>{b.party_name_ta}</div>}
                </td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>{fmt.date(b.bill_date)}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 12, color: b.payment_status === "overdue" ? "#dc2626" : "#374151" }}>
                  {fmt.date(b.due_date)}
                  {b.payment_status === "overdue" && <div style={{ fontSize: 10, color: "#dc2626" }}>OVERDUE</div>}
                </td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>{fmt.weight(b.subtotal_weight)}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontWeight: 600, fontSize: 13 }}>{fmt.currency(b.net_amount)}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 13, color: "#16a34a" }}>{fmt.currency(b.paid_amount)}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontWeight: 700, fontSize: 13, color: b.balance_due > 0 ? "#dc2626" : "#16a34a" }}>
                  {fmt.currency(b.balance_due)}
                </td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6" }}>
                  <StatusBadge status={b.payment_status} />
                </td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 18 }}>›</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Sales Form ----
function SalesForm({ onDone }) {
  const today = new Date().toISOString().split("T")[0];
  const [header, setHeader] = useState({
    bill_date: today, party_id: "", credit_days: 14, discount_pct: 0, notes: "",
  });
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const [rates, setRates] = useState({});
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    Promise.all([
      apiCached("parties?action=list&category=CUSTOMER&cols=lite"),
      api(`products?action=rates&date=${today}`),
    ]).then(([v, r]) => {
      setVendors(v.data);
      setProducts(r.data);
      const rmap = {};
      r.data.forEach(p => {
        if (p.market_rate) rmap[p.product_id] = {
          market_rate: p.market_rate,
          bag_deduction: p.bag_deduction_kg || 3,
          vendor_short: p.vendor_short_kg || 1,
        };
      });
      setRates(rmap);
    }).catch(() => {});
  }, [today]);

  const calcItem = (item) => {
    const vendorWt = parseFloat(item.vendor_weight) || 0;
    const purWt    = parseFloat(item.purchase_weight) || 0;
    const wtProfit = parseFloat((vendorWt - purWt).toFixed(2));
    const saleRate = parseFloat(item.sale_rate) || 0;
    const purRate  = parseFloat(item.purchase_rate) || 0;
    const gross    = parseFloat((vendorWt * saleRate).toFixed(2));
    const discPct  = parseFloat(item.discount_pct) || 0;
    const discAmt  = parseFloat((gross * discPct / 100).toFixed(2));
    const sakku    = parseFloat(((parseFloat(item.sakku_qty) || 0) * (parseFloat(item.sakku_rate) || 0)).toFixed(2));
    const cooly    = parseFloat(item.cooly_amt) || 0;
    const net      = parseFloat((gross - discAmt - sakku - cooly).toFixed(2));
    const rateMargin = parseFloat(((saleRate - purRate) * vendorWt).toFixed(2));
    const wtMargin   = parseFloat((wtProfit * purRate).toFixed(2));
    const margin     = parseFloat((rateMargin + wtMargin - discAmt).toFixed(2));
    return { ...item, weight_profit: wtProfit, gross_amount: gross, discount_amt: discAmt, sakku_amt: sakku, net_amount: net, margin_amount: margin };
  };

  const updateItem = (idx, field, value) => {
    setItems(prev => {
      const updated = [...prev];
      let item = { ...updated[idx], [field]: value };
      if (field === "product_id") {
        const prod = products.find(p => String(p.product_id) === String(value));
        const r    = rates[value];
        if (prod) {
          item.product_name    = prod.name_en;
          item.product_name_ta = prod.name_ta;
          item.unit_type       = prod.unit_type;
          item.purchase_rate   = r?.market_rate || 0;
          item.sale_rate       = r ? parseFloat(r.market_rate) + 1 : "";
          item.vendor_weight   = "";
          item.purchase_weight = 0;
        }
      }
      if (field === "no_of_bags") {
        const prod = products.find(p => String(p.product_id) === String(item.product_id));
        const r    = rates[item.product_id];
        if (r) {
          const bags = parseInt(value) || 1;
          item.purchase_weight = 0;
          item.vendor_weight   = "";
        }
      }
      updated[idx] = calcItem(item);
      return updated;
    });
  };

  const addItem = () => setItems(prev => [...prev, { ...EMPTY_ITEM }]);
  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));

  const totals = items.reduce((acc, i) => ({
    vendor_weight: acc.vendor_weight + (parseFloat(i.vendor_weight) || 0),
    gross_amount:  acc.gross_amount  + (i.gross_amount  || 0),
    discount_amt:  acc.discount_amt  + (i.discount_amt  || 0),
    sakku:         acc.sakku         + (i.sakku_amt     || 0),
    cooly:         acc.cooly         + (i.cooly_amt     || 0),
    net_amount:    acc.net_amount    + (i.net_amount    || 0),
    margin:        acc.margin        + (i.margin_amount || 0),
  }), { vendor_weight: 0, gross_amount: 0, discount_amt: 0, sakku: 0, cooly: 0, net_amount: 0, margin: 0 });

  const dueDate = new Date(new Date(header.bill_date).getTime() + header.credit_days * 86400000).toISOString().split("T")[0];

  const handleSave = async () => {
    const errs = {};
    if (!header.party_id) errs.party_id = "Select vendor";
    if (items.some(i => !i.product_id || !i.vendor_weight || !i.sale_rate)) errs.items = "Fill all product rows";
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    try {
      const result = await api("sales?action=save", {
        method: "POST",
        body: JSON.stringify({ ...header, items }),
      });
      alert(`✅ Sales Bill ${result.data.bill_no} created!\nNet Amount: ${fmt.currency(result.data.net_amount)}\nDue Date: ${fmt.date(result.data.due_date)}\nProfit: ${fmt.currency(result.data.total_margin)}`);
      onDone();
    } catch (e) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <button onClick={onDone} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 4 }}>← Back to list</button>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>🧾 New Sales Bill <span style={{ fontSize: 13, color: "#666" }}>புதிய விற்பனை பில்</span></h1>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn onClick={onDone} color="#6b7280">Cancel</Btn>
          <Btn onClick={handleSave} color="#2563eb" disabled={saving}>{saving ? "Saving..." : "Save Bill"}</Btn>
        </div>
      </div>

      {/* Header */}
      <div style={{ background: "white", borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <h3 style={{ margin: "0 0 14px", fontSize: 14 }}>Bill Details</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          <Field label="Date">
            <input type="date" value={header.bill_date}
              onChange={e => setHeader(p => ({ ...p, bill_date: e.target.value }))} style={inputStyle} />
          </Field>
          <Field label="Vendor / Customer *" error={errors.party_id}>
            <select value={header.party_id}
              onChange={e => { const v = vendors.find(x => x.id == e.target.value); setHeader(p => ({ ...p, party_id: e.target.value, credit_days: v?.credit_days || 14 })); }}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("s-credit")?.focus(); } }}
              style={{ ...inputStyle, borderColor: errors.party_id ? "#ef4444" : "#d1d5db" }}>
              <option value="">-- Select Vendor --</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name_en} {v.name_ta ? `/ ${v.name_ta}` : ""}</option>)}
            </select>
          </Field>
          <Field label="Credit Days">
            <input id="s-credit" type="number" value={header.credit_days}
              onChange={e => setHeader(p => ({ ...p, credit_days: parseInt(e.target.value) || 14 }))}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("s-disc")?.focus(); } }}
              style={inputStyle} />
          </Field>
          <Field label="Due Date">
            <input type="date" value={dueDate} readOnly
              style={{ ...inputStyle, background: "#f9fafb", color: "#666" }} />
          </Field>
          <Field label="Discount % (all items)">
            <input id="s-disc" type="number" step="0.5" min="0" max="100" value={header.discount_pct}
              onChange={e => setHeader(p => ({ ...p, discount_pct: e.target.value }))}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); document.querySelector(".s-product-sel")?.focus(); } }}
              style={inputStyle} />
          </Field>
          <Field label="Notes">
            <input value={header.notes} onChange={e => setHeader(p => ({ ...p, notes: e.target.value }))}
              placeholder="Optional" style={inputStyle} />
          </Field>
        </div>
      </div>

      {/* Items */}
      <div style={{ background: "white", borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Items / பொருட்கள்</h3>
          <Btn onClick={addItem} color="#2563eb" small>+ Add Row</Btn>
        </div>
        {errors.items && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 10 }}>⚠️ {errors.items}</div>}

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                {["Product", "Bags", "Purchase KG", "Vendor KG (+1 profit)", "Buy Rate ₹", "Sale Rate ₹", "Gross ₹", "Disc %", "Net ₹", "Margin ₹", ""].map(h => (
                  <th key={h} style={{ padding: "8px 8px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx}>
                  <td style={{ padding: "6px 4px" }}>
                    <select value={item.product_id}
                      className="s-product-sel"
                      onChange={e => updateItem(idx, "product_id", e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.target.closest("tr").querySelector(".s-bags")?.focus(); } }}
                      style={{ ...inputStyle, width: 150, padding: "5px 6px", fontSize: 12 }}>
                      <option value="">-- Product --</option>
                      {products.map(p => <option key={p.product_id} value={p.product_id}>{p.name_en}</option>)}
                    </select>
                    {item.product_name_ta && <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{item.product_name_ta}</div>}
                  </td>
                  <td style={{ padding: "6px 4px" }}>
                    <input className="s-bags" type="number" min="1" value={item.no_of_bags}
                      onChange={e => updateItem(idx, "no_of_bags", e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.target.closest("tr").querySelector(".s-purwt")?.focus(); } }}
                      style={{ ...inputStyle, width: 50, padding: "5px 6px" }} />
                  </td>
                  <td style={{ padding: "6px 4px" }}>
                    <input className="s-purwt" type="number" step="0.5" min="0" placeholder="From purchase"
                      value={item.purchase_weight}
                      onChange={e => updateItem(idx, "purchase_weight", e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.target.closest("tr").querySelector(".s-venwt")?.focus(); } }}
                      style={{ ...inputStyle, width: 90, padding: "5px 6px" }} />
                  </td>
                  <td style={{ padding: "6px 4px" }}>
                    <input className="s-venwt" type="number" step="0.5" min="0" placeholder="Bill to vendor"
                      value={item.vendor_weight}
                      onChange={e => updateItem(idx, "vendor_weight", e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.target.closest("tr").querySelector(".s-rate")?.focus(); } }}
                      style={{ ...inputStyle, width: 100, padding: "5px 6px", background: item.vendor_weight ? "#eff6ff" : "white" }} />
                    {item.weight_profit > 0 && <div style={{ fontSize: 10, color: "#16a34a" }}>+{item.weight_profit} kg profit</div>}
                  </td>
                  <td style={{ padding: "6px 4px" }}>
                    <input type="number" step="0.5" value={item.purchase_rate}
                      onChange={e => updateItem(idx, "purchase_rate", e.target.value)}
                      style={{ ...inputStyle, width: 70, padding: "5px 6px" }} />
                  </td>
                  <td style={{ padding: "6px 4px" }}>
                    <input className="s-rate" type="number" step="0.5" value={item.sale_rate}
                      onChange={e => updateItem(idx, "sale_rate", e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); const rows = document.querySelectorAll(".s-product-sel"); if (idx < rows.length - 1) rows[idx+1].focus(); else { addItem(); setTimeout(() => document.querySelectorAll(".s-product-sel")[idx+1]?.focus(), 50); } } }}
                      style={{ ...inputStyle, width: 70, padding: "5px 6px", background: item.sale_rate ? "#eff6ff" : "white" }} />
                  </td>
                  <td style={{ padding: "6px 8px", fontSize: 12, whiteSpace: "nowrap" }}>{fmt.currency(item.gross_amount)}</td>
                  <td style={{ padding: "6px 4px" }}>
                    <input type="number" step="0.5" min="0" max="100" value={item.discount_pct}
                      onChange={e => updateItem(idx, "discount_pct", e.target.value)}
                      style={{ ...inputStyle, width: 55, padding: "5px 6px" }} />
                    {item.discount_amt > 0 && <div style={{ fontSize: 10, color: "#dc2626" }}>-{fmt.currency(item.discount_amt)}</div>}
                  </td>
                  <td style={{ padding: "6px 8px", fontWeight: 700, color: "#2563eb", fontSize: 13, whiteSpace: "nowrap" }}>{fmt.currency(item.net_amount)}</td>
                  <td style={{ padding: "6px 8px", fontSize: 12, color: item.margin_amount >= 0 ? "#16a34a" : "#dc2626", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {fmt.currency(item.margin_amount)}
                  </td>
                  <td style={{ padding: "6px 4px" }}>
                    {items.length > 1 && (
                      <button onClick={() => removeItem(idx)} style={{ background: "#fee2e2", border: "none", color: "#dc2626", borderRadius: 4, padding: "4px 8px", cursor: "pointer", fontSize: 12 }}>✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary */}
      <div style={{ background: "white", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <div style={{ maxWidth: 320, marginLeft: "auto" }}>
          <SummaryRow label="Total KG (Vendor)" value={`${totals.vendor_weight.toFixed(2)} kg`} />
          <SummaryRow label="Gross Sales" value={fmt.currency(totals.gross_amount)} />
          {totals.discount_amt > 0 && <SummaryRow label="Total Discount" value={fmt.currency(totals.discount_amt)} color="#dc2626" />}
          {totals.sakku > 0 && <SummaryRow label="Sakku" value={fmt.currency(totals.sakku)} />}
          {totals.cooly > 0 && <SummaryRow label="Cooly" value={fmt.currency(totals.cooly)} />}
          <div style={{ borderTop: "2px solid #2563eb", paddingTop: 10, marginTop: 10 }}>
            <SummaryRow label="Net Amount (Vendor Owes)" value={fmt.currency(totals.net_amount)} bold color="#2563eb" big />
          </div>
          <div style={{ marginTop: 10, padding: "10px", background: "#f0fdf4", borderRadius: 8, border: "1px solid #bbf7d0" }}>
            <SummaryRow label="💰 Your Profit (This Bill)" value={fmt.currency(totals.margin)} bold color="#16a34a" />
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
            📅 Due Date: <strong>{fmt.date(dueDate)}</strong> ({header.credit_days} days credit)
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Sales Bill Detail + Payment ----
function SalesDetail({ id, onBack, onRefresh }) {
  const [bill, setBill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPayment, setShowPayment] = useState(false);
  const [payment, setPayment] = useState({ amount: "", payment_mode: "cash", payment_ref: "", notes: "" });
  const [payingSaving, setPayingSaving] = useState(false);

  const loadBill = useCallback(() => {
    api(`sales?action=get&id=${id}`).then(r => setBill(r.data)).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { loadBill(); }, [loadBill]);

  const handlePayment = async () => {
    if (!payment.amount || parseFloat(payment.amount) <= 0) { alert("Enter a valid amount"); return; }
    setPayingSaving(true);
    try {
      const result = await api("sales?action=payment", {
        method: "POST",
        body: JSON.stringify({ party_id: bill.party_id, receipt_date: getWorkingDate(), ...payment }),
      });
      alert(`✅ Payment of ${fmt.currency(payment.amount)} recorded!\nReceipt: ${result.data.receipt_no}`);
      setShowPayment(false);
      loadBill();
      onRefresh();
    } catch (e) { alert("Error: " + e.message); }
    finally { setPayingSaving(false); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}>Loading...</div>;
  if (!bill) return <div style={{ padding: 40 }}>Bill not found</div>;

  return (
    <div style={{ padding: 24, maxWidth: 950 }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "center" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 13 }}>← Back to list</button>
      {bill && <button onClick={() => window.print()}
        style={{ padding: "6px 16px", background: "#2563eb", border: "none", borderRadius: 8, color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer", marginLeft: "auto" }}>
        🖨️ Print Bill
      </button>}
    </div>

      {/* Bill header info */}
      <div style={{ background: "white", borderRadius: 12, padding: 24, marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#2563eb", marginBottom: 4 }}>#{bill.bill_no}</div>
            <p style={{ margin: 0, color: "#374151", fontSize: 14, fontWeight: 500 }}>{bill.party_name} {bill.party_name_ta ? `/ ${bill.party_name_ta}` : ""}</p>
            <p style={{ margin: "4px 0 0", color: "#666", fontSize: 12 }}>
              {fmt.date(bill.bill_date)} · Due: {fmt.date(bill.due_date)} · {bill.credit_days} days credit
            </p>
            {bill.phone1 && <p style={{ margin: "4px 0 0", fontSize: 12, color: "#888" }}>📞 {bill.phone1}</p>}
          </div>
          <div style={{ textAlign: "right" }}>
            <StatusBadge status={bill.payment_status} />
            {bill.balance_due > 0 && (
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#dc2626", marginTop: 8 }}>{fmt.currency(bill.balance_due)}</div>
                <div style={{ fontSize: 11, color: "#888" }}>Balance Due</div>
                {!showPayment && (
                  <button onClick={() => { setShowPayment(true); setPayment(p => ({ ...p, amount: bill.balance_due })); }}
                    style={{ marginTop: 10, padding: "8px 16px", background: "#16a34a", border: "none", borderRadius: 8, color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    💰 Record Payment
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Payment form */}
        {showPayment && (
          <div style={{ marginTop: 20, padding: 16, background: "#f0fdf4", borderRadius: 10, border: "1px solid #bbf7d0" }}>
            <h4 style={{ margin: "0 0 12px", color: "#16a34a" }}>💰 Record Payment from {bill.party_name}</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              <Field label="Amount ₹">
                <input type="number" value={payment.amount}
                  onChange={e => setPayment(p => ({ ...p, amount: e.target.value }))} style={inputStyle} />
              </Field>
              <Field label="Mode">
                <select value={payment.payment_mode}
                  onChange={e => setPayment(p => ({ ...p, payment_mode: e.target.value }))} style={inputStyle}>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                  <option value="upi">UPI</option>
                  <option value="cheque">Cheque</option>
                </select>
              </Field>
              <Field label="Reference No">
                <input value={payment.payment_ref}
                  onChange={e => setPayment(p => ({ ...p, payment_ref: e.target.value }))}
                  placeholder="UPI/Cheque ref" style={inputStyle} />
              </Field>
              <Field label="Notes">
                <input value={payment.notes}
                  onChange={e => setPayment(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Optional" style={inputStyle} />
              </Field>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <Btn onClick={handlePayment} color="#16a34a" disabled={payingSaving}>{payingSaving ? "Saving..." : "✅ Save Payment"}</Btn>
              <Btn onClick={() => setShowPayment(false)} color="#6b7280">Cancel</Btn>
            </div>
          </div>
        )}
      </div>

      {/* Items table */}
      <div style={{ background: "white", borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", overflowX: "auto" }}>
        <h3 style={{ margin: "0 0 14px", fontSize: 14 }}>Items</h3>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              {["Product", "Bags", "Pur KG", "Vendor KG", "Wt Profit", "Pur Rate ₹", "Sale Rate ₹", "Gross ₹", "Disc ₹", "Net ₹", "Margin ₹"].map(h => (
                <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bill.items?.map((item, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#fafafa" }}>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{item.product_name}</div>
                  <div style={{ fontSize: 11, color: "#888" }}>{item.product_name_ta}</div>
                </td>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>{item.no_of_bags}</td>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>{item.purchase_weight}</td>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f3f4f6", fontSize: 12, fontWeight: 600 }}>{item.vendor_weight}</td>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f3f4f6", fontSize: 12, color: "#16a34a" }}>+{item.weight_profit}</td>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>₹{item.purchase_rate}</td>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f3f4f6", fontSize: 12, fontWeight: 600 }}>₹{item.sale_rate}</td>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>{fmt.currency(item.gross_amount)}</td>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f3f4f6", fontSize: 12, color: "#dc2626" }}>{fmt.currency(item.discount_amt)}</td>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f3f4f6", fontWeight: 700, color: "#2563eb", fontSize: 13 }}>{fmt.currency(item.net_amount)}</td>
                <td style={{ padding: "10px 10px", borderBottom: "1px solid #f3f4f6", fontWeight: 600, color: item.margin_amount >= 0 ? "#16a34a" : "#dc2626", fontSize: 13 }}>{fmt.currency(item.margin_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Payments received */}
      {bill.payments?.length > 0 && (
        <div style={{ background: "white", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 14, color: "#16a34a" }}>💰 Payments Received</h3>
          {bill.payments.map((p, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{p.receipt_no}</div>
                <div style={{ fontSize: 11, color: "#666" }}>{fmt.date(p.receipt_date)} · {p.payment_mode?.toUpperCase()} {p.payment_ref ? `· ${p.payment_ref}` : ""}</div>
              </div>
              <div style={{ fontWeight: 700, color: "#16a34a", fontSize: 14 }}>{fmt.currency(p.allocated_amt)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Daily summary for sales ----
function DailySalesSummary({ date }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`sales?action=summary&date=${date}`).then(r => setData(r.data)).catch(() => {});
  }, [date]);
  if (!data) return null;
  const items = [
    { label: "Bills", value: data.bill_count },
    { label: "Total KG", value: `${parseFloat(data.total_weight || 0).toFixed(1)} kg` },
    { label: "Gross Sales", value: fmt.currency(data.gross_sales) },
    { label: "Discounts", value: fmt.currency(data.total_discounts), color: "#dc2626" },
    { label: "Net Sales", value: fmt.currency(data.net_sales), color: "#2563eb" },
  ];
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
      {items.map((item, i) => (
        <div key={i} style={{ background: "white", borderRadius: 8, padding: "10px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize: 11, color: "#666" }}>{item.label}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: item.color || "#111" }}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

// ---- Shared helpers ----
const inputStyle = { width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13, boxSizing: "border-box", outline: "none", fontFamily: "inherit" };
const inputStyle2 = { padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13 };

function Field({ label, children, error }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 5, textTransform: "uppercase" }}>{label}</label>
      {children}
      {error && <div style={{ color: "#ef4444", fontSize: 11, marginTop: 3 }}>⚠️ {error}</div>}
    </div>
  );
}

function Btn({ onClick, children, color = "#1a7a45", disabled, small }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ padding: small ? "6px 14px" : "9px 20px", borderRadius: 8, border: "none", background: disabled ? "#9ca3af" : color, color: "white", fontSize: small ? 12 : 13, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer" }}>{children}</button>
  );
}

function SummaryRow({ label, value, bold, color, big }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #f3f4f6" }}>
      <span style={{ fontSize: big ? 14 : 13, color: "#4b5563", fontWeight: bold ? 600 : 400 }}>{label}</span>
      <span style={{ fontSize: big ? 16 : 13, fontWeight: bold ? 700 : 600, color: color || "#111" }}>{value}</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const s = { paid: { bg: "#dcfce7", color: "#16a34a", label: "Paid" }, unpaid: { bg: "#fef9c3", color: "#ca8a04", label: "Unpaid" }, partial: { bg: "#dbeafe", color: "#2563eb", label: "Partial" }, overdue: { bg: "#fee2e2", color: "#dc2626", label: "Overdue" } }[status] || { bg: "#f3f4f6", color: "#6b7280", label: status };
  return <span style={{ background: s.bg, color: s.color, padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600 }}>{s.label}</span>;
}
