// ============================================================
//  IDNUK SOFTWARE - Purchase Bill Entry Page
//  Buying from Farmers / Suppliers
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { api, apiCached, fmt } from "../App.jsx";

const EMPTY_ITEM = {
  product_id: "", product_name: "", product_name_ta: "",
  unit_type: "KG", no_of_bags: 1,
  actual_weight: "", bag_deduction: 3, billed_weight: 0,
  purchase_rate: "", gross_amount: 0,
  commission_pct: 10, commission_amt: 0,
  sakku_qty: 0, sakku_rate: 0, sakku_amt: 0,
  cooly_amt: 0, sungam_amt: 0, net_amount: 0,
  notes: "",
};

export default function PurchasePage() {
  const [view, setView] = useState("list"); // list | new | detail
  const [selectedId, setSelectedId] = useState(null);
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split("T")[0]);
  const [refFilter, setRefFilter] = useState("");
  const [trucks, setTrucks] = useState([]);

  useEffect(() => {
    apiCached("parties?action=list&category=TRUCK&cols=lite").then(r => setTrucks(r.data)).catch(() => {});
  }, []);

  const loadBills = useCallback(() => {
    setLoading(true);
    const refParam = refFilter ? `&ref=${encodeURIComponent(refFilter)}` : "";
    api(`purchase?action=list&from=${dateFilter}&to=${dateFilter}${refParam}`)
      .then(r => setBills(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [dateFilter, refFilter]);

  useEffect(() => { loadBills(); }, [loadBills]);

  if (view === "new") return <PurchaseForm onDone={() => { setView("list"); loadBills(); }} />;
  if (view === "detail") return <PurchaseDetail id={selectedId} onBack={() => setView("list")} />;

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>🛒 Purchase Bills <span style={{ fontSize: 13, color: "#666" }}>கொள்முதல் பில்</span></h1>
          <p style={{ margin: "4px 0 0", color: "#666", fontSize: 13 }}>Buying from farmers and suppliers</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13 }} />
          <select value={refFilter} onChange={e => setRefFilter(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13 }}>
            <option value="">All References</option>
            <option value="DIRECT">DIRECT (No Truck)</option>
            {trucks.map(t => <option key={t.id} value={t.name_en}>{t.name_en}</option>)}
          </select>
          <Btn onClick={() => setView("new")} color="#1a7a45">+ New Purchase Bill</Btn>
        </div>
      </div>

      {/* Summary bar */}
      <DailySummary date={dateFilter} type="purchase" />

      {/* Bills table */}
      <div style={{ background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              {["Bill No", "Farmer / Supplier", "Reference", "Party Type", "Bags", "Weight (KG)", "Gross ₹", "Commission ₹", "Net Paid ₹", "Mode", ""].map(h => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ padding: 40, textAlign: "center", color: "#666" }}>Loading...</td></tr>
            ) : bills.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: 40, textAlign: "center", color: "#666" }}>
                No purchase bills for this date. <span style={{ color: "#1a7a45", cursor: "pointer" }} onClick={() => setView("new")}>Create one →</span>
              </td></tr>
            ) : bills.map((b, i) => (
              <tr key={b.id} style={{ background: i % 2 === 0 ? "white" : "#fafafa", cursor: "pointer" }}
                onClick={() => { setSelectedId(b.id); setView("detail"); }}>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontWeight: 600, color: "#1a7a45", fontSize: 13 }}>{b.bill_no}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{b.party_name}</div>
                  {b.party_name_ta && <div style={{ fontSize: 11, color: "#888" }}>{b.party_name_ta}</div>}
                </td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>
                  {b.reference_name
                    ? <span style={{ background: "#eff6ff", color: "#2563eb", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>🚛 {b.reference_name}</span>
                    : <span style={{ color: "#9ca3af", fontSize: 11 }}>DIRECT</span>}
                </td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6" }}>
                  <PartyTypeBadge type={b.party_type} />
                </td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>{b.lorry_no || "-"}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>{fmt.weight(b.subtotal_weight)}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>{fmt.currency(b.subtotal_amount)}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 13, color: "#7c3aed" }}>{fmt.currency(b.total_commission)}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontWeight: 700, fontSize: 13, color: "#1a7a45" }}>{fmt.currency(b.net_payable)}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6" }}>
                  <span style={{ fontSize: 11, background: "#f3f4f6", padding: "2px 8px", borderRadius: 10 }}>{b.payment_mode?.toUpperCase()}</span>
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

// ---- Purchase Bill Form ----
function PurchaseForm({ onDone, initialData }) {
  const today = new Date().toISOString().split("T")[0];
  const [header, setHeader] = useState({
    bill_date: today, party_id: "", party_type: "FARMER",
    lorry_party_id: "", lorry_no: "", lorry_freight: 0,
    commission_pct: 10, payment_mode: "cash", payment_ref: "",
    total_advance: 0, notes: "",
  });
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [farmers, setFarmers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [rates, setRates] = useState({});
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    Promise.all([
      apiCached("parties?action=list&category=FARMER&cols=lite"),
      apiCached("parties?action=list&category=MARKET_SUPPLIER&cols=lite"),
      api(`products?action=rates&date=${today}`),
    ]).then(([f, s, r]) => {
      setFarmers(f.data);
      setSuppliers(s.data);
      setProducts(r.data);
      const rmap = {};
      r.data.forEach(p => { if (p.market_rate) rmap[p.product_id] = p.market_rate; });
      setRates(rmap);
    }).catch(() => {});
  }, [today]);

  const allParties = header.party_type === "FARMER" ? farmers : suppliers;

  const calcItem = (item) => {
    const actual = parseFloat(item.actual_weight) || 0;
    const deduct = parseFloat(item.bag_deduction) || 0;
    const billed = Math.max(0, actual - deduct);
    const rate   = parseFloat(item.purchase_rate) || 0;
    const gross  = parseFloat((billed * rate).toFixed(2));
    const comm   = parseFloat((gross * (parseFloat(item.commission_pct) || 0) / 100).toFixed(2));
    const sakku  = parseFloat(((parseFloat(item.sakku_qty) || 0) * (parseFloat(item.sakku_rate) || 0)).toFixed(2));
    const cooly  = parseFloat(item.cooly_amt) || 0;
    const sungam = parseFloat(item.sungam_amt) || 0;
    const net    = parseFloat((gross - comm - sakku - cooly - sungam).toFixed(2));
    return { ...item, billed_weight: billed, gross_amount: gross, commission_amt: comm, sakku_amt: sakku, net_amount: net };
  };

  const updateItem = (idx, field, value) => {
    setItems(prev => {
      const updated = [...prev];
      let item = { ...updated[idx], [field]: value };
      // Auto-fill rate from today's rates
      if (field === "product_id") {
        const prod = products.find(p => String(p.product_id) === String(value));
        if (prod) {
          item.product_name    = prod.name_en;
          item.product_name_ta = prod.name_ta;
          item.unit_type       = prod.unit_type;
          item.bag_deduction   = prod.bag_deduction_kg || 3;
          item.purchase_rate   = rates[value] || "";
        }
      }
      updated[idx] = calcItem(item);
      return updated;
    });
  };

  const addItem = () => setItems(prev => [...prev, { ...EMPTY_ITEM, commission_pct: header.commission_pct }]);
  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));

  // Totals
  const totals = items.reduce((acc, item) => ({
    billed_weight: acc.billed_weight + (item.billed_weight || 0),
    gross_amount:  acc.gross_amount  + (item.gross_amount  || 0),
    commission:    acc.commission    + (item.commission_amt || 0),
    sakku:         acc.sakku         + (item.sakku_amt      || 0),
    cooly:         acc.cooly         + (item.cooly_amt      || 0),
    sungam:        acc.sungam        + (item.sungam_amt     || 0),
    net_amount:    acc.net_amount    + (item.net_amount     || 0),
  }), { billed_weight: 0, gross_amount: 0, commission: 0, sakku: 0, cooly: 0, sungam: 0, net_amount: 0 });

  const finalPayable = Math.max(0, totals.net_amount - parseFloat(header.total_advance || 0));

  const handleSave = async () => {
    const errs = {};
    if (!header.party_id) errs.party_id = "Select farmer/supplier";
    if (items.some(i => !i.product_id)) errs.items = "Select product for all rows";
    if (items.some(i => !i.actual_weight)) errs.items = "Enter weight for all rows";
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSaving(true);
    try {
      const result = await api("purchase?action=save", {
        method: "POST",
        body: JSON.stringify({ ...header, items }),
      });
      alert(`✅ Purchase Bill ${result.data.bill_no} created!\nNet Payable to Farmer: ${fmt.currency(result.data.net_payable)}`);
      onDone();
    } catch (e) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <button onClick={onDone} style={{ background: "none", border: "none", color: "#1a7a45", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 4 }}>← Back to list</button>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>🛒 New Purchase Bill <span style={{ fontSize: 13, color: "#666" }}>புதிய கொள்முதல் பில்</span></h1>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn onClick={onDone} color="#6b7280">Cancel</Btn>
          <Btn onClick={handleSave} color="#1a7a45" disabled={saving}>{saving ? "Saving..." : "Save & Print"}</Btn>
        </div>
      </div>

      {/* Bill Header */}
      <div style={{ background: "white", borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 14, color: "#374151" }}>Bill Details</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          <Field label="Date / தேதி">
            <input type="date" value={header.bill_date}
              onChange={e => setHeader(p => ({ ...p, bill_date: e.target.value }))}
              style={inputStyle} />
          </Field>
          <Field label="Party Type">
            <select value={header.party_type}
              onChange={e => setHeader(p => ({ ...p, party_type: e.target.value, party_id: "" }))}
              style={inputStyle}>
              <option value="FARMER">Farmer / விவசாயி</option>
              <option value="MARKET_SUPPLIER">Market Supplier</option>
            </select>
          </Field>
          <Field label="Farmer / Supplier *" error={errors.party_id}>
            <select value={header.party_id}
              onChange={e => setHeader(p => ({ ...p, party_id: e.target.value }))}
              style={{ ...inputStyle, borderColor: errors.party_id ? "#ef4444" : "#d1d5db" }}>
              <option value="">-- Select --</option>
              {allParties.map(p => (
                <option key={p.id} value={p.id}>{p.name_en} {p.name_ta ? `/ ${p.name_ta}` : ""}</option>
              ))}
            </select>
          </Field>
          <Field label="Commission %">
            <input type="number" step="0.5" value={header.commission_pct}
              onChange={e => { setHeader(p => ({ ...p, commission_pct: e.target.value })); setItems(prev => prev.map(i => calcItem({ ...i, commission_pct: e.target.value }))); }}
              style={inputStyle} />
          </Field>
          <Field label="Lorry No">
            <input value={header.lorry_no} onChange={e => setHeader(p => ({ ...p, lorry_no: e.target.value }))}
              placeholder="Vehicle number" style={inputStyle} />
          </Field>
          <Field label="Lorry Freight ₹">
            <input type="number" value={header.lorry_freight}
              onChange={e => setHeader(p => ({ ...p, lorry_freight: e.target.value }))}
              style={inputStyle} />
          </Field>
          <Field label="Advance Deduction ₹">
            <input type="number" value={header.total_advance}
              onChange={e => setHeader(p => ({ ...p, total_advance: e.target.value }))}
              style={inputStyle} />
          </Field>
          <Field label="Payment Mode">
            <select value={header.payment_mode}
              onChange={e => setHeader(p => ({ ...p, payment_mode: e.target.value }))}
              style={inputStyle}>
              <option value="cash">Cash</option>
              <option value="bank">Bank Transfer</option>
              <option value="upi">UPI</option>
            </select>
          </Field>
        </div>
      </div>

      {/* Line Items */}
      <div style={{ background: "white", borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14, color: "#374151" }}>Items / பொருட்கள்</h3>
          <Btn onClick={addItem} color="#1a7a45" small>+ Add Row</Btn>
        </div>
        {errors.items && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 10 }}>⚠️ {errors.items}</div>}

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                {["Product", "Bags", "Scale KG", "Bag Deduct KG", "Billed KG", "Rate ₹/KG", "Gross ₹", "Comm ₹", "Sakku ₹", "Cooly ₹", "Sungam ₹", "Net ₹", ""].map(h => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx}>
                  <td style={{ padding: "6px 6px" }}>
                    <select value={item.product_id}
                      onChange={e => updateItem(idx, "product_id", e.target.value)}
                      style={{ ...inputStyle, width: 160, padding: "5px 8px" }}>
                      <option value="">-- Product --</option>
                      {products.map(p => <option key={p.product_id} value={p.product_id}>{p.name_en}</option>)}
                    </select>
                    {item.product_name_ta && <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{item.product_name_ta}</div>}
                  </td>
                  {[
                    ["no_of_bags", 50, "1"],
                    ["actual_weight", 80, "0.00"],
                    ["bag_deduction", 60, "3"],
                  ].map(([field, w, ph]) => (
                    <td key={field} style={{ padding: "6px 4px" }}>
                      <input type="number" step="0.5" min="0" placeholder={ph}
                        value={item[field]}
                        onChange={e => updateItem(idx, field, e.target.value)}
                        style={{ ...inputStyle, width: w, padding: "5px 6px" }} />
                    </td>
                  ))}
                  <td style={{ padding: "6px 8px", fontWeight: 600, color: "#1a7a45", fontSize: 13, whiteSpace: "nowrap" }}>
                    {item.billed_weight.toFixed(2)}
                  </td>
                  <td style={{ padding: "6px 4px" }}>
                    <input type="number" step="0.5" min="0" placeholder="Rate"
                      value={item.purchase_rate}
                      onChange={e => updateItem(idx, "purchase_rate", e.target.value)}
                      style={{ ...inputStyle, width: 75, padding: "5px 6px", background: item.purchase_rate ? "#f0fdf4" : "white" }} />
                  </td>
                  <td style={{ padding: "6px 8px", fontSize: 12, whiteSpace: "nowrap" }}>{fmt.currency(item.gross_amount)}</td>
                  <td style={{ padding: "6px 8px", fontSize: 12, color: "#7c3aed", whiteSpace: "nowrap" }}>{fmt.currency(item.commission_amt)}</td>
                  {[
                    ["sakku_qty", "sakku_rate"],
                  ].map(() => (
                    <td key="sakku" style={{ padding: "6px 4px" }}>
                      <div style={{ display: "flex", gap: 3 }}>
                        <input type="number" placeholder="Qty" min="0"
                          value={item.sakku_qty}
                          onChange={e => updateItem(idx, "sakku_qty", e.target.value)}
                          style={{ ...inputStyle, width: 42, padding: "5px 4px", fontSize: 11 }} />
                        <input type="number" placeholder="Rate" min="0" step="0.5"
                          value={item.sakku_rate}
                          onChange={e => updateItem(idx, "sakku_rate", e.target.value)}
                          style={{ ...inputStyle, width: 52, padding: "5px 4px", fontSize: 11 }} />
                      </div>
                      <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{fmt.currency(item.sakku_amt)}</div>
                    </td>
                  ))}
                  <td style={{ padding: "6px 4px" }}>
                    <input type="number" step="1" min="0" placeholder="0"
                      value={item.cooly_amt}
                      onChange={e => updateItem(idx, "cooly_amt", e.target.value)}
                      style={{ ...inputStyle, width: 65, padding: "5px 6px" }} />
                  </td>
                  <td style={{ padding: "6px 4px" }}>
                    <input type="number" step="1" min="0" placeholder="0"
                      value={item.sungam_amt}
                      onChange={e => updateItem(idx, "sungam_amt", e.target.value)}
                      style={{ ...inputStyle, width: 65, padding: "5px 6px" }} />
                  </td>
                  <td style={{ padding: "6px 8px", fontWeight: 700, color: "#1a7a45", fontSize: 13, whiteSpace: "nowrap" }}>{fmt.currency(item.net_amount)}</td>
                  <td style={{ padding: "6px 4px" }}>
                    {items.length > 1 && (
                      <button onClick={() => removeItem(idx)}
                        style={{ background: "#fee2e2", border: "none", color: "#dc2626", borderRadius: 4, padding: "4px 8px", cursor: "pointer", fontSize: 12 }}>✕</button>
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div>
            <Field label="Notes">
              <textarea value={header.notes} onChange={e => setHeader(p => ({ ...p, notes: e.target.value }))}
                placeholder="Any notes for this bill..."
                style={{ ...inputStyle, height: 70, resize: "vertical" }} />
            </Field>
          </div>
          <div style={{ background: "#f9fafb", borderRadius: 10, padding: 16 }}>
            <SummaryRow label="Total Billed Weight" value={`${totals.billed_weight.toFixed(2)} KG`} />
            <SummaryRow label="Gross Amount" value={fmt.currency(totals.gross_amount)} />
            <SummaryRow label="Commission" value={fmt.currency(totals.commission)} color="#7c3aed" />
            <SummaryRow label="Sakku Charges" value={fmt.currency(totals.sakku)} />
            <SummaryRow label="Cooly / Labour" value={fmt.currency(totals.cooly)} />
            <SummaryRow label="Sungam / Market Tax" value={fmt.currency(totals.sungam)} />
            {parseFloat(header.total_advance) > 0 && (
              <SummaryRow label="Advance Deduction" value={fmt.currency(header.total_advance)} />
            )}
            <div style={{ borderTop: "2px solid #1a7a45", paddingTop: 10, marginTop: 10 }}>
              <SummaryRow label="Net Payable to Farmer" value={fmt.currency(finalPayable)} bold color="#1a7a45" big />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Purchase Bill Detail View ----
function PurchaseDetail({ id, onBack }) {
  const [bill, setBill] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api(`purchase?action=get&id=${id}`).then(r => setBill(r.data)).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}>Loading...</div>;
  if (!bill) return <div style={{ padding: 40 }}>Bill not found</div>;

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "#1a7a45", cursor: "pointer", fontSize: 13, marginBottom: 12 }}>← Back to list</button>

      <div style={{ background: "white", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ margin: "0 0 4px", color: "#1a7a45" }}>{bill.bill_no}</h2>
            <p style={{ margin: 0, color: "#666", fontSize: 13 }}>{fmt.date(bill.bill_date)} · {bill.party_name} {bill.party_name_ta ? `/ ${bill.party_name_ta}` : ""}</p>
            {bill.phone1 && <p style={{ margin: "4px 0 0", color: "#888", fontSize: 12 }}>📞 {bill.phone1}</p>}
          </div>
          <PartyTypeBadge type={bill.party_type} />
        </div>
      </div>

      <div style={{ background: "white", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", marginBottom: 16, overflowX: "auto" }}>
        <h3 style={{ margin: "0 0 14px", fontSize: 14 }}>Items</h3>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              {["Product", "Bags", "Scale KG", "Bag Deduct", "Billed KG", "Rate ₹", "Gross ₹", "Comm ₹", "Net ₹"].map(h => (
                <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bill.items?.map((item, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#fafafa" }}>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ fontWeight: 500 }}>{item.product_name}</div>
                  <div style={{ fontSize: 11, color: "#888" }}>{item.product_name_ta}</div>
                </td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>{item.no_of_bags}</td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>{item.actual_weight}</td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6", fontSize: 13, color: "#dc2626" }}>-{item.bag_deduction}</td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6", fontSize: 13, fontWeight: 600 }}>{item.billed_weight}</td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>₹{item.purchase_rate}</td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>{fmt.currency(item.gross_amount)}</td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6", fontSize: 13, color: "#7c3aed" }}>{fmt.currency(item.commission_amt)}</td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6", fontWeight: 700, color: "#1a7a45" }}>{fmt.currency(item.net_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ background: "white", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <div style={{ maxWidth: 300, marginLeft: "auto" }}>
          <SummaryRow label="Gross Amount" value={fmt.currency(bill.subtotal_amount)} />
          <SummaryRow label="Commission" value={fmt.currency(bill.total_commission)} color="#7c3aed" />
          <SummaryRow label="Sakku" value={fmt.currency(bill.total_sakku_amt)} />
          <SummaryRow label="Cooly" value={fmt.currency(bill.total_cooly_amt)} />
          <SummaryRow label="Sungam" value={fmt.currency(bill.total_sungam_amt)} />
          {bill.total_advance > 0 && <SummaryRow label="Advance" value={fmt.currency(bill.total_advance)} />}
          <div style={{ borderTop: "2px solid #1a7a45", paddingTop: 10, marginTop: 10 }}>
            <SummaryRow label="Net Paid to Farmer" value={fmt.currency(bill.net_payable)} bold color="#1a7a45" big />
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: "#666" }}>
            Payment: <strong>{bill.payment_mode?.toUpperCase()}</strong>
            {bill.payment_ref && ` · ${bill.payment_ref}`}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Daily Summary Bar ----
function DailySummary({ date, type }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`${type}?action=summary&date=${date}`).then(r => setData(r.data)).catch(() => {});
  }, [date, type]);

  if (!data) return null;

  const items = type === "purchase"
    ? [
        { label: "Bills", value: data.bill_count },
        { label: "Total KG", value: `${parseFloat(data.total_weight || 0).toFixed(1)} kg` },
        { label: "Gross Amount", value: fmt.currency(data.gross_amount) },
        { label: "Commission Earned", value: fmt.currency(data.total_commission), color: "#7c3aed" },
        { label: "Paid to Farmers", value: fmt.currency(data.total_paid_to_farmers), color: "#1a7a45" },
      ]
    : [
        { label: "Bills", value: data.bill_count },
        { label: "Total KG", value: `${parseFloat(data.total_weight || 0).toFixed(1)} kg` },
        { label: "Gross Sales", value: fmt.currency(data.gross_sales) },
        { label: "Discounts", value: fmt.currency(data.total_discounts), color: "#dc2626" },
        { label: "Net Sales", value: fmt.currency(data.net_sales), color: "#1a7a45" },
      ];

  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
      {items.map((item, i) => (
        <div key={i} style={{ background: "white", borderRadius: 8, padding: "10px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize: 11, color: "#666" }}>{item.label}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: item.color || "#111" }}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

// ---- Shared UI Helpers ----
const inputStyle = {
  width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db",
  fontSize: 13, boxSizing: "border-box", outline: "none", fontFamily: "inherit",
};

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
    <button onClick={onClick} disabled={disabled} style={{
      padding: small ? "6px 14px" : "9px 20px", borderRadius: 8, border: "none",
      background: disabled ? "#9ca3af" : color, color: "white",
      fontSize: small ? 12 : 13, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer"
    }}>{children}</button>
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

function PartyTypeBadge({ type }) {
  const styles = {
    FARMER:          { bg: "#dcfce7", color: "#16a34a", label: "Farmer" },
    MARKET_SUPPLIER: { bg: "#dbeafe", color: "#2563eb", label: "Supplier" },
  };
  const s = styles[type] || styles.FARMER;
  return <span style={{ background: s.bg, color: s.color, padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600 }}>{s.label}</span>;
}
