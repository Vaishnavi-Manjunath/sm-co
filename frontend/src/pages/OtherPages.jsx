// ============================================================
//  IDNUK SOFTWARE - Reports, Parties, Expenses, Payments Pages
// ============================================================
import { useState, useEffect, useRef, Fragment } from "react";
import { api, apiCached, clearApiCache, fmt, getPrintTemplate, clearPrintTemplateCache, SearchableSelect, setAppLogoCache, clearBusinessRulesCache, DEFAULT_RULES, getWorkingDate, takePrefetch, SkeletonRows, DEFAULT_PREPRINT, getPreprint, PreprintRender } from "../App.jsx";
import { PrintPurchaseBills, toPrintBill as purchaseToPrint } from "./QuickPurchase.jsx";
import { PrintSalesBills, toPrintBill as salesToPrint } from "./QuickSales.jsx";

// Send a payment receipt to the party's WhatsApp (Tamil text; copies to clipboard when no phone).
async function shareReceiptWA(id) {
  try {
    const r = await api("sales?action=share-receipt", { method: "POST", body: JSON.stringify({ id }) });
    if (r.data.wa_url) window.open(r.data.wa_url, "_blank");
    else {
      try { await navigator.clipboard.writeText(r.data.message); } catch {}
      alert("No phone number on this party — receipt message copied, paste it in WhatsApp.");
    }
  } catch (e) { alert("Error: " + e.message); }
}

// Common market vegetables → Tamil NAME (meaning, not phonetic). Used in the Products form.
const VEG_TA = {
  "tomato": "தக்காளி", "onion": "வெங்காயம்", "big onion": "பெரிய வெங்காயம்",
  "small onion": "சின்ன வெங்காயம்", "shallots": "சின்ன வெங்காயம்", "sambar onion": "சின்ன வெங்காயம்",
  "potato": "உருளைக்கிழங்கு", "brinjal": "கத்தரிக்காய்", "eggplant": "கத்தரிக்காய்",
  "carrot": "கேரட்", "beans": "பீன்ஸ்", "cluster beans": "கொத்தவரங்காய்", "broad beans": "அவரைக்காய்",
  "cabbage": "முட்டைக்கோஸ்", "cauliflower": "காலிஃபிளவர்", "beetroot": "பீட்ரூட்",
  "chilli": "மிளகாய்", "chillies": "மிளகாய்", "green chilli": "பச்சை மிளகாய்", "capsicum": "குடைமிளகாய்",
  "ladies finger": "வெண்டைக்காய்", "okra": "வெண்டைக்காய்", "drumstick": "முருங்கைக்காய்",
  "cucumber": "வெள்ளரிக்காய்", "pumpkin": "பூசணிக்காய்", "ash gourd": "நீர்ப்பூசணி",
  "bottle gourd": "சுரைக்காய்", "bitter gourd": "பாகற்காய்", "snake gourd": "புடலங்காய்",
  "ridge gourd": "பீர்க்கங்காய்", "radish": "முள்ளங்கி", "garlic": "பூண்டு", "ginger": "இஞ்சி",
  "coriander": "கொத்தமல்லி", "curry leaves": "கறிவேப்பிலை", "mint": "புதினா",
  "green peas": "பட்டாணி", "peas": "பட்டாணி", "corn": "சோளம்", "lemon": "எலுமிச்சை",
  "mango": "மாங்காய்", "banana": "வாழைப்பழம்", "raw banana": "வாழைக்காய்", "plantain": "வாழைக்காய்",
  "banana stem": "வாழைத்தண்டு", "tapioca": "மரவள்ளிக்கிழங்கு", "sweet potato": "சர்க்கரைவள்ளிக்கிழங்கு",
  "yam": "சேனைக்கிழங்கு", "colocasia": "சேப்பங்கிழங்கு", "turmeric": "மஞ்சள்",
  "spinach": "கீரை", "greens": "கீரை", "mango ginger": "மாஇஞ்சி", "ginger garlic": "இஞ்சி பூண்டு",
};

// ── Google Input Tools — Tamil transliteration ────────────────────────────────
async function googleTamil(text) {
  if (!text.trim()) return '';
  const words = text.trim().split(/\s+/);
  const parts = await Promise.all(words.map(async w => {
    try {
      const r = await fetch(
        `https://inputtools.google.com/request?text=${encodeURIComponent(w)}&itc=ta-t-i0-und&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8`
      );
      const d = await r.json();
      return (d[0] === 'SUCCESS' && d[1]?.[0]?.[1]?.[0]) ? d[1][0][1][0] : '';
    } catch { return ''; }
  }));
  return parts.filter(Boolean).join(' ');
}

// ── Party type configuration ──────────────────────────────────────────────────
const PT = {
  FARMER:          { label: 'Farmer',         labelTa: 'விவசாயி',        icon: '🌾', color: '#1a7a45', bg: '#dcfce7' },
  SUPPLIER:        { label: 'Supplier',        labelTa: 'சப்ளையர்',       icon: '📦', color: '#2563eb', bg: '#dbeafe' },
  MARKET_SUPPLIER: { label: 'Supplier',        labelTa: 'சப்ளையர்',       icon: '📦', color: '#2563eb', bg: '#dbeafe' },
  MARKET_VENDOR:   { label: 'Market Vendor',  labelTa: 'மார்க்கெட் கடை', icon: '🏪', color: '#7c3aed', bg: '#f3e8ff' },
  CUSTOMER:        { label: 'Customer',        labelTa: 'வாடிக்கையாளர்',  icon: '🛒', color: '#0284c7', bg: '#e0f2fe' },
  OVERFLOW:        { label: 'Overflow Vendor', labelTa: 'மிகுதி விற்பனை', icon: '🚚', color: '#ea580c', bg: '#ffedd5' },
  ORDER_SUPPLIER:  { label: 'Order Supplier',  labelTa: 'ஆர்டர் சப்ளையர்', icon: '📞', color: '#db2777', bg: '#fce7f3' },
};

// ============================================================
// REPORTS PAGE
// ============================================================
export function ReportsPage() {
  const [tab, setTab] = useState("purchase");
  const tabs = [
    { id: "purchase",    label: "Purchase",       icon: "🛒" },
    { id: "sales",       label: "Sales",          icon: "🛍️" },
    { id: "collections", label: "Collections",   icon: "💵" },
    { id: "ledger",      label: "Ledger",         icon: "📜" },
    { id: "tallysheet",  label: "Tally Sheet",    icon: "⚖️" },
    { id: "outstanding", label: "Outstanding",    icon: "💸" },
    { id: "mktoutstanding", label: "Market Outstanding", icon: "🏪" },
    { id: "advances",    label: "Farmer Advances", icon: "🌱" },
    { id: "reference",   label: "Reference",      icon: "🚛" },
    { id: "salesprod",   label: "Vendor Sales",   icon: "🧾" },
    { id: "productpnl",  label: "Product P&L",    icon: "🥬" },
    { id: "vendorpnl",   label: "Vendor P&L",     icon: "👤" },
    { id: "overflow",    label: "Overflow P&L",   icon: "🚚" },
    { id: "pnl",         label: "P&L",            icon: "📈" },
    { id: "daily",       label: "Daily",          icon: "📅" },
    { id: "auditpack",   label: "Audit Pack",     icon: "📑" },
    { id: "tallyxml",    label: "Tally XML",      icon: "📤" },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ margin: "0 0 20px", fontSize: 22, fontWeight: 700 }}>📈 Reports <span style={{ fontSize: 13, color: "#666" }}>அறிக்கைகள்</span></h1>
      <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer",
            background: tab === t.id ? "#1a7a45" : "white",
            color: tab === t.id ? "white" : "#374151",
            fontSize: 13, fontWeight: 600,
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
          }}>{t.icon} {t.label}</button>
        ))}
      </div>
      {tab === "purchase"    && <PurchaseReport />}
      {tab === "sales"       && <SalesReport />}
      {tab === "collections" && <CollectionsReport />}
      {tab === "ledger"      && <PartyLedgerReport />}
      {tab === "salesprod"   && <SalesByProductReport />}
      {tab === "tallysheet"  && <TallySheetReport />}
      {tab === "outstanding" && <OutstandingReport />}
      {tab === "mktoutstanding" && <MarketOutstandingReport />}
      {tab === "advances"    && <FarmerAdvancesReport />}
      {tab === "productpnl"  && <ProductPnLReport />}
      {tab === "vendorpnl"   && <VendorPnLReport />}
      {tab === "overflow"    && <OverflowPnLReport />}
      {tab === "reference"   && <ReferenceReport />}
      {tab === "pnl"         && <PnLReport />}
      {tab === "daily"       && <DailyStatement />}
      {tab === "auditpack"   && <AuditPackReport />}
      {tab === "tallyxml"    && <TallyExport />}
    </div>
  );
}

// ============================================================
// PURCHASE REPORT — by Product / Reference (truck) / Farmer-Supplier
// Date range + filter; per-mode columns; click a bill no to preview;
// CSV + A4 print (details only).
// ============================================================
const fmtRateList = (r) => {
  const parts = String(r ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (!parts.length) return "—";
  return "₹" + parts.map(p => { const n = parseFloat(p); return n % 1 === 0 ? n.toFixed(0) : n; }).join(" / ");
};

function PurchaseReport() {
  const wd = getWorkingDate();
  const [from, setFrom] = useState(wd);
  const [to, setTo]     = useState(wd);
  const [mode, setMode] = useState("product");      // product | reference | party
  const [productId, setProductId] = useState("");
  const [ref, setRef]   = useState("");
  const [partyId, setPartyId] = useState("");
  const [products, setProducts] = useState([]);
  const [trucks, setTrucks]     = useState([]);
  const [parties, setParties]   = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [peek, setPeek] = useState(null);
  const sheetRef = useRef();
  const num = v => parseFloat(v || 0);

  useEffect(() => {
    apiCached("products?action=list").then(r => setProducts(r.data || [])).catch(() => {});
    apiCached("parties?action=list&category=TRUCK&cols=lite").then(r => setTrucks(r.data || [])).catch(() => {});
    Promise.all([
      apiCached("parties?action=list&category=FARMER&cols=lite"),
      apiCached("parties?action=list&category=SUPPLIER&cols=lite"),
      apiCached("parties?action=list&category=MARKET_SUPPLIER&cols=lite"),
    ]).then(rs => { const seen = new Set(); setParties(rs.flatMap(r => r.data || []).filter(x => !seen.has(x.id) && seen.add(x.id))); }).catch(() => {});
  }, []);

  const sel   = mode === "product" ? productId : mode === "reference" ? ref : partyId;
  const isAll = sel === "ALL";
  const ready = !!sel;
  useEffect(() => {
    if (!ready) { setRows([]); return; }
    let url = `purchase?action=list&from=${from}&to=${to}`;
    if (!isAll) {
      if (mode === "product")        url += `&product_id=${productId}`;
      else if (mode === "reference") url += `&ref=${encodeURIComponent(ref)}`;
      else                           url += `&party_id=${partyId}`;
    }
    setLoading(true);
    api(url)
      .then(r => setRows((r.data || []).slice().sort((a, b) => (a.bill_date < b.bill_date ? -1 : a.bill_date > b.bill_date ? 1 : a.id - b.id))))
      .catch(() => setRows([])).finally(() => setLoading(false));
  }, [from, to, mode, productId, ref, partyId, ready, isAll]);

  const t = rows.reduce((s, b) => {
    s.gross += num(b.subtotal_amount); s.comm += num(b.total_commission); s.coolie += num(b.total_cooly_amt);
    s.freight += num(b.lorry_freight); s.net += num(b.net_payable);
    s.pweight += num(b.f_weight); s.pbags += num(b.f_bags); s.pamt += num(b.f_amount); s.bags += num(b.total_bags);
    s.weight += num(b.subtotal_weight);
    return s;
  }, { gross: 0, comm: 0, coolie: 0, freight: 0, net: 0, pweight: 0, pbags: 0, pamt: 0, bags: 0, weight: 0 });

  const modeCols = {
    product: [
      { h: "Date", v: b => fmt.date(b.bill_date), a: "left" },
      { h: "Bill No", v: b => b.bill_no, a: "left", click: true },
      { h: "Party", v: b => b.party_name, a: "left" },
      { h: "Rate ₹", v: b => fmtRateList(b.f_rates), a: "right" },
      { h: "Weight", v: b => num(b.f_weight).toFixed(1) + " kg", a: "right", tot: () => t.pweight.toFixed(1) + " kg" },
      { h: "Bags", v: b => Math.round(num(b.f_bags)), a: "right", tot: () => Math.round(t.pbags) },
      { h: "Total ₹", v: b => fmt.currency(b.f_amount), a: "right", tot: () => fmt.currency(t.pamt) },
      { h: "Net Paid ₹", v: b => fmt.currency(b.net_payable), a: "right", tot: () => fmt.currency(t.net), bold: true },
    ],
    party: [
      { h: "Date", v: b => fmt.date(b.bill_date), a: "left" },
      { h: "Bill No", v: b => b.bill_no, a: "left", click: true },
      { h: "Gross ₹", v: b => fmt.currency(b.subtotal_amount), a: "right", tot: () => fmt.currency(t.gross) },
      { h: "Commission ₹", v: b => fmt.currency(b.total_commission), a: "right", color: "#7c3aed", tot: () => fmt.currency(t.comm) },
      { h: "Coolie ₹", v: b => fmt.currency(b.total_cooly_amt), a: "right", tot: () => fmt.currency(t.coolie) },
      { h: "Freight ₹", v: b => fmt.currency(b.lorry_freight), a: "right", tot: () => fmt.currency(t.freight) },
      { h: "Net Payable ₹", v: b => fmt.currency(b.net_payable), a: "right", tot: () => fmt.currency(t.net), bold: true },
    ],
    reference: [
      { h: "S.No", v: (b, i) => i + 1, a: "right" },
      { h: "Date", v: b => fmt.date(b.bill_date), a: "left" },
      { h: "Bill No", v: b => b.bill_no, a: "left", click: true },
      { h: "Farmer/Supplier", v: b => b.party_name, a: "left" },
      { h: "Bags", v: b => Math.round(num(b.total_bags)), a: "right", tot: () => Math.round(t.bags) },
      { h: "Freight ₹", v: b => fmt.currency(b.lorry_freight), a: "right", tot: () => fmt.currency(t.freight) },
      { h: "Weight", v: b => num(b.subtotal_weight).toFixed(1) + " kg", a: "right", tot: () => num(t.weight).toFixed(1) + " kg" },
      { h: "Net Amount ₹", v: b => fmt.currency(b.net_payable), a: "right", tot: () => fmt.currency(t.net), bold: true },
    ],
  };
  // "All" view: every bill in the range, bill-level columns (product-specific rate/weight
  // columns don't apply when no single product is chosen).
  const allCols = [
    { h: "Date", v: b => fmt.date(b.bill_date), a: "left" },
    { h: "Bill No", v: b => b.bill_no, a: "left", click: true },
    { h: "Party", v: b => b.party_name, a: "left" },
    { h: "Bags", v: b => Math.round(num(b.total_bags)), a: "right", tot: () => Math.round(t.bags) },
    { h: "Gross ₹", v: b => fmt.currency(b.subtotal_amount), a: "right", tot: () => fmt.currency(t.gross) },
    { h: "Commission ₹", v: b => fmt.currency(b.total_commission), a: "right", color: "#7c3aed", tot: () => fmt.currency(t.comm) },
    { h: "Coolie ₹", v: b => fmt.currency(b.total_cooly_amt), a: "right", tot: () => fmt.currency(t.coolie) },
    { h: "Freight ₹", v: b => fmt.currency(b.lorry_freight), a: "right", tot: () => fmt.currency(t.freight) },
    { h: "Net Payable ₹", v: b => fmt.currency(b.net_payable), a: "right", tot: () => fmt.currency(t.net), bold: true },
  ];
  const cols = isAll ? allCols : modeCols[mode];
  const firstTot = cols.findIndex(c => c.tot);

  const subject = isAll ? (mode === "product" ? "All Products" : mode === "reference" ? "All References" : "All Farmers/Suppliers")
    : mode === "product" ? (products.find(p => String(p.id) === String(productId))?.name_en || "")
    : mode === "reference" ? (ref === "DIRECT" ? "DIRECT (no truck)" : ref)
    : (parties.find(p => String(p.id) === String(partyId))?.name_en || "");

  const csv = () => downloadCSV(`purchase_${mode}_${from}_${to}.csv`,
    [["Purchase report", `${mode}: ${subject}`, `${from} to ${to}`], cols.map(c => c.h),
     ...rows.map((b, i) => cols.map(c => String(c.v(b, i))))]);

  const selStyle = { ...inputSm, minWidth: 170 };
  return (
    <div>
      <ReportBar from={from} setFrom={setFrom} to={to} setTo={setTo}
        onPrint={() => printReport(sheetRef.current)} onCSV={rows.length ? csv : undefined}>
        <div>
          <label style={labelStyle}>Group by</label>
          <div style={{ display: "flex", border: "1px solid #d1d5db", borderRadius: 8, overflow: "hidden" }}>
            {[["product", "Product"], ["reference", "Reference"], ["party", "Farmer/Supplier"]].map(([id, lab]) => (
              <button key={id} onClick={() => setMode(id)} style={{ padding: "8px 12px", border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                borderLeft: id !== "product" ? "1px solid #e5e7eb" : "none",
                background: mode === id ? "#1a7a45" : "white", color: mode === id ? "white" : "#374151" }}>{lab}</button>
            ))}
          </div>
        </div>
        {mode === "product" && (
          <div><label style={labelStyle}>Product</label>
            <select value={productId} onChange={e => setProductId(e.target.value)} style={selStyle}>
              <option value="">— Select product —</option>
              <option value="ALL">★ All products</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name_en}{p.name_ta ? ` / ${p.name_ta}` : ""}</option>)}
            </select></div>
        )}
        {mode === "reference" && (
          <div><label style={labelStyle}>Reference / Truck</label>
            <select value={ref} onChange={e => setRef(e.target.value)} style={selStyle}>
              <option value="">— Select truck —</option>
              <option value="ALL">★ All references</option>
              <option value="DIRECT">DIRECT (no truck)</option>
              {trucks.map(tk => <option key={tk.id} value={tk.name_en}>{tk.name_en}</option>)}
            </select></div>
        )}
        {mode === "party" && (
          <div style={{ minWidth: 220 }}><label style={labelStyle}>Farmer / Supplier</label>
            <SearchableSelect value={partyId} options={[{ id: "ALL", label: "★ All farmers/suppliers" }, ...parties.map(p => ({ id: p.id, label: `${p.name_en}${p.name_ta ? " / " + p.name_ta : ""}` }))]}
              onChange={setPartyId} placeholder="🔍 Search…" style={{ ...selStyle, width: "100%" }} /></div>
        )}
      </ReportBar>

      <div ref={sheetRef} style={reportSheet}>
        <ReportTitle title={`Purchase Report${subject ? " — " + subject : ""}`} from={from} to={to} />
        {!ready ? (
          <div style={{ padding: 30, textAlign: "center", color: "#888" }}>Choose a {mode === "party" ? "farmer/supplier" : mode} above to see the report.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
            <thead><tr>{cols.map(c => <th key={c.h} style={{ ...rptH, textAlign: c.a }}>{c.h}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={cols.length} style={{ padding: 24, textAlign: "center", color: "#888" }}>{loading ? "Loading…" : "No purchase bills match"}</td></tr> :
               rows.map((b, i) => (
                <tr key={b.id} style={{ background: i % 2 ? "#fafafa" : "white" }}>
                  {cols.map(c => (
                    <td key={c.h} style={{ ...rptTd, textAlign: c.a, fontWeight: c.bold ? 700 : (c.click ? 600 : 400), color: c.color || (c.click ? "#1a7a45" : "#374151"),
                      cursor: c.click ? "pointer" : "default", textDecoration: c.click ? "underline" : "none" }}
                      onClick={c.click ? () => setPeek({ id: b.id }) : undefined}>{c.v(b, i)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr style={{ background: "#f0fdf4", fontWeight: 800, borderTop: "2px solid #1a7a45" }}>
                  <td colSpan={firstTot} style={{ ...rptTd, textAlign: "right", fontWeight: 800 }}>TOTAL ({rows.length})</td>
                  {cols.slice(firstTot).map(c => <td key={c.h} style={{ ...rptTd, textAlign: c.a, fontWeight: 800, color: c.color || "#1a7a45" }}>{c.tot ? c.tot() : ""}</td>)}
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
      {peek && <BillPeekModal id={peek.id} onClose={() => setPeek(null)} />}
    </div>
  );
}

// ============================================================
// SALES REPORT — by Product / Vendor. Mirrors the Purchase report.
// ============================================================
function SalesReport() {
  const wd = getWorkingDate();
  const [from, setFrom] = useState(wd);
  const [to, setTo]     = useState(wd);
  const [mode, setMode] = useState("product");      // product | vendor
  const [productId, setProductId] = useState("");
  const [partyId, setPartyId] = useState("");
  const [products, setProducts] = useState([]);
  const [vendors, setVendors]   = useState([]);
  const [orderVendors, setOrderVendors] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [peek, setPeek] = useState(null);
  const sheetRef = useRef();
  const num = v => parseFloat(v || 0);

  useEffect(() => {
    apiCached("products?action=list").then(r => setProducts(r.data || [])).catch(() => {});
    Promise.all([
      apiCached("parties?action=list&category=CUSTOMER&cols=lite"),
      apiCached("parties?action=list&category=OVERFLOW&cols=lite"),
      apiCached("parties?action=list&category=MARKET_VENDOR&cols=lite"),
    ]).then(rs => { const seen = new Set(); setVendors(rs.flatMap(r => r.data || []).filter(x => !seen.has(x.id) && seen.add(x.id))); }).catch(() => {});
    Promise.all([
      apiCached("parties?action=list&category=ORDER_SUPPLIER&cols=lite"),
      apiCached("parties?action=list&category=OVERFLOW&cols=lite"),
    ]).then(([a, b]) => { const seen = new Set(); setOrderVendors([...a.data || [], ...b.data || []].filter(x => !seen.has(x.id) && seen.add(x.id))); }).catch(() => {});
  }, []);

  const sel   = mode === "product" ? productId : partyId;
  const isAll = sel === "ALL";
  const ready = !!sel;
  useEffect(() => {
    if (!ready) { setRows([]); return; }
    let url = `sales?action=list&from=${from}&to=${to}`;
    if (!isAll) {
      if (mode === "product") url += `&product_id=${productId}`;
      else                    url += `&party_id=${partyId}`;
    }
    setLoading(true);
    api(url)
      .then(r => setRows((r.data || []).slice().sort((a, b) => (a.bill_date < b.bill_date ? -1 : a.bill_date > b.bill_date ? 1 : a.id - b.id))))
      .catch(() => setRows([])).finally(() => setLoading(false));
  }, [from, to, mode, productId, partyId, ready, isAll]);

  const t = rows.reduce((s, b) => {
    s.gross += num(b.subtotal_amount); s.disc += num(b.discount_amt); s.net += num(b.net_amount);
    s.bal += num(b.balance_due); s.pweight += num(b.f_weight); s.pbags += num(b.f_bags); s.pamt += num(b.f_amount);
    return s;
  }, { gross: 0, disc: 0, net: 0, bal: 0, pweight: 0, pbags: 0, pamt: 0 });

  const statusCell = (v) => <span style={{ padding: "1px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600,
    background: v === "paid" ? "#dcfce7" : "#fef9c3", color: v === "paid" ? "#16a34a" : "#ca8a04" }}>{v}</span>;

  const vendorBillCols = [
    { h: "Date", v: b => fmt.date(b.bill_date), a: "left" },
    { h: "Bill No", v: b => b.bill_no, a: "left", click: true },
    { h: "Gross ₹", v: b => fmt.currency(b.subtotal_amount), a: "right", tot: () => fmt.currency(t.gross) },
    { h: "Discount ₹", v: b => fmt.currency(b.discount_amt), a: "right", color: "#ea580c", tot: () => fmt.currency(t.disc) },
    { h: "Net ₹", v: b => fmt.currency(b.net_amount), a: "right", tot: () => fmt.currency(t.net), bold: true },
    { h: "Balance ₹", v: b => fmt.currency(b.balance_due), a: "right", color: "#dc2626", tot: () => fmt.currency(t.bal) },
    { h: "Status", v: b => statusCell(b.payment_status), a: "left", raw: b => b.payment_status },
  ];
  const modeCols = {
    product: [
      { h: "Date", v: b => fmt.date(b.bill_date), a: "left" },
      { h: "Bill No", v: b => b.bill_no, a: "left", click: true },
      { h: "Vendor", v: b => b.party_name, a: "left" },
      { h: "Rate ₹", v: b => fmtRateList(b.f_rates), a: "right" },
      { h: "Weight", v: b => num(b.f_weight).toFixed(1) + " kg", a: "right", tot: () => t.pweight.toFixed(1) + " kg" },
      { h: "Bags", v: b => Math.round(num(b.f_bags)), a: "right", tot: () => Math.round(t.pbags) },
      { h: "Total ₹", v: b => fmt.currency(b.f_amount), a: "right", tot: () => fmt.currency(t.pamt) },
      { h: "Net ₹", v: b => fmt.currency(b.net_amount), a: "right", tot: () => fmt.currency(t.net), bold: true },
    ],
    vendor: vendorBillCols,
    order: vendorBillCols,
  };
  // "All" view: every sales bill in the range (product-specific columns need a single product).
  const allCols = [
    { h: "Date", v: b => fmt.date(b.bill_date), a: "left" },
    { h: "Bill No", v: b => b.bill_no, a: "left", click: true },
    { h: "Vendor", v: b => b.party_name, a: "left" },
    { h: "Gross ₹", v: b => fmt.currency(b.subtotal_amount), a: "right", tot: () => fmt.currency(t.gross) },
    { h: "Discount ₹", v: b => fmt.currency(b.discount_amt), a: "right", color: "#ea580c", tot: () => fmt.currency(t.disc) },
    { h: "Net ₹", v: b => fmt.currency(b.net_amount), a: "right", tot: () => fmt.currency(t.net), bold: true },
    { h: "Balance ₹", v: b => fmt.currency(b.balance_due), a: "right", color: "#dc2626", tot: () => fmt.currency(t.bal) },
    { h: "Status", v: b => statusCell(b.payment_status), a: "left", raw: b => b.payment_status },
  ];
  const cols = isAll ? allCols : modeCols[mode];
  const firstTot = cols.findIndex(c => c.tot);

  const subject = isAll
    ? (mode === "product" ? "All Products" : mode === "order" ? "All Order Suppliers" : "All Vendors")
    : mode === "product" ? (products.find(p => String(p.id) === String(productId))?.name_en || "")
    : mode === "order" ? (orderVendors.find(p => String(p.id) === String(partyId))?.name_en || "")
    : (vendors.find(p => String(p.id) === String(partyId))?.name_en || "");

  const csv = () => downloadCSV(`sales_${mode}_${from}_${to}.csv`,
    [["Sales report", `${mode}: ${subject}`, `${from} to ${to}`], cols.map(c => c.h),
     ...rows.map(b => cols.map(c => String(c.raw ? c.raw(b) : c.v(b))))]);

  const selStyle = { ...inputSm, minWidth: 170 };
  return (
    <div>
      <ReportBar from={from} setFrom={setFrom} to={to} setTo={setTo}
        onPrint={() => printReport(sheetRef.current)} onCSV={rows.length ? csv : undefined}>
        <div>
          <label style={labelStyle}>Group by</label>
          <div style={{ display: "flex", border: "1px solid #d1d5db", borderRadius: 8, overflow: "hidden" }}>
            {[["product", "Product"], ["vendor", "Vendor"], ["order", "Order Suppliers"]].map(([id, lab]) => (
              <button key={id} onClick={() => { setMode(id); setPartyId(""); }} style={{ padding: "8px 14px", border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                borderLeft: id !== "product" ? "1px solid #e5e7eb" : "none",
                background: mode === id ? "#1a7a45" : "white", color: mode === id ? "white" : "#374151" }}>{lab}</button>
            ))}
          </div>
        </div>
        {mode === "product" ? (
          <div><label style={labelStyle}>Product</label>
            <select value={productId} onChange={e => setProductId(e.target.value)} style={selStyle}>
              <option value="">— Select product —</option>
              <option value="ALL">★ All products</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name_en}{p.name_ta ? ` / ${p.name_ta}` : ""}</option>)}
            </select></div>
        ) : mode === "order" ? (
          <div style={{ minWidth: 220 }}><label style={labelStyle}>Order Supplier / Overflow</label>
            <SearchableSelect value={partyId} options={[{ id: "ALL", label: "★ All order suppliers" }, ...orderVendors.map(p => ({ id: p.id, label: `${p.name_en}${p.name_ta ? " / " + p.name_ta : ""}` }))]}
              onChange={setPartyId} placeholder="🔍 Search order supplier…" style={{ ...selStyle, width: "100%" }} /></div>
        ) : (
          <div style={{ minWidth: 220 }}><label style={labelStyle}>Vendor</label>
            <SearchableSelect value={partyId} options={[{ id: "ALL", label: "★ All vendors" }, ...vendors.map(p => ({ id: p.id, label: `${p.name_en}${p.name_ta ? " / " + p.name_ta : ""}` }))]}
              onChange={setPartyId} placeholder="🔍 Search vendor…" style={{ ...selStyle, width: "100%" }} /></div>
        )}
      </ReportBar>

      <div ref={sheetRef} style={reportSheet}>
        <ReportTitle title={`Sales Report${subject ? " — " + subject : ""}`} from={from} to={to} />
        {!ready ? (
          <div style={{ padding: 30, textAlign: "center", color: "#888" }}>Choose a {mode === "order" ? "supplier" : mode} above to see the report.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
            <thead><tr>{cols.map(c => <th key={c.h} style={{ ...rptH, textAlign: c.a }}>{c.h}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={cols.length} style={{ padding: 24, textAlign: "center", color: "#888" }}>{loading ? "Loading…" : "No sales bills match"}</td></tr> :
               rows.map((b, i) => (
                <tr key={b.id} style={{ background: i % 2 ? "#fafafa" : "white" }}>
                  {cols.map(c => (
                    <td key={c.h} style={{ ...rptTd, textAlign: c.a, fontWeight: c.bold ? 700 : (c.click ? 600 : 400), color: c.color || (c.click ? "#2563eb" : "#374151"),
                      cursor: c.click ? "pointer" : "default", textDecoration: c.click ? "underline" : "none" }}
                      onClick={c.click ? () => setPeek({ id: b.id }) : undefined}>{c.v(b, i)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr style={{ background: "#eff6ff", fontWeight: 800, borderTop: "2px solid #2563eb" }}>
                  <td colSpan={firstTot} style={{ ...rptTd, textAlign: "right", fontWeight: 800 }}>TOTAL ({rows.length})</td>
                  {cols.slice(firstTot).map(c => <td key={c.h} style={{ ...rptTd, textAlign: c.a, fontWeight: 800, color: c.color || "#2563eb" }}>{c.tot ? c.tot() : ""}</td>)}
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
      {peek && <SalesBillPeekModal id={peek.id} onClose={() => setPeek(null)} />}
    </div>
  );
}

// Sales bill preview (mirrors BillPeekModal for purchase).
function SalesBillPeekModal({ id, onClose }) {
  const [bill, setBill] = useState(null);
  const [err, setErr]   = useState(null);
  useEffect(() => { api(`sales?action=get&id=${id}`).then(r => setBill(r.data)).catch(e => setErr(e.message)); }, [id]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 12, padding: 20, width: 560, maxWidth: "92vw", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
        {!bill && !err && <div style={{ padding: 20, textAlign: "center", color: "#666" }}>Loading bill...</div>}
        {err && <div style={{ padding: 20, color: "#dc2626" }}>Could not load bill: {err}</div>}
        {bill && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#2563eb" }}>{bill.bill_no}</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{bill.party_name}{bill.party_name_ta ? ` / ${bill.party_name_ta}` : ""}</div>
                <div style={{ fontSize: 12, color: "#666" }}>{fmt.date(bill.bill_date)}</div>
              </div>
              <button onClick={onClose} style={{ padding: "6px 12px", background: "#f3f4f6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>✕ Close</button>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ background: "#f9fafb" }}>
                {["Product", "Bags", "Weight", "Rate ₹", "Amount ₹"].map(h => (
                  <th key={h} style={{ padding: "6px 8px", textAlign: h === "Product" ? "left" : "right", borderBottom: "1px solid #e5e7eb", fontSize: 11, color: "#6b7280" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {(bill.items || []).map((it, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "6px 8px", fontWeight: 600 }}>{it.product_name}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{it.no_of_bags}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{parseFloat(it.vendor_weight || 0).toFixed(1)} kg</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{parseFloat(it.sale_rate || 0).toFixed(2)}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{fmt.currency(it.net_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 12, textAlign: "right", fontSize: 14 }}>
              Net: <b>{fmt.currency(bill.net_amount)}</b>
              {Number(bill.balance_due) > 0 && <span style={{ marginLeft: 14, color: "#dc2626" }}>Balance: <b>{fmt.currency(bill.balance_due)}</b></span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Shared report helpers ──────────────────────────────────────────────
function printReport(el) {
  if (!el) return;
  el.classList.add("report-printing");
  document.body.classList.add("printing-report");
  const done = () => {
    el.classList.remove("report-printing");
    document.body.classList.remove("printing-report");
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}

function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Report toolbar: date range + Print + CSV (hidden when printing)
function ReportBar({ from, setFrom, to, setTo, onPrint, onCSV, children }) {
  return (
    <div className="no-print" style={{ background: "white", borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
      {from !== undefined && <div><label style={labelStyle}>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputSm} /></div>}
      {to !== undefined && <div><label style={labelStyle}>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputSm} /></div>}
      {children}
      <div style={{ flex: 1 }} />
      {onCSV && <button onClick={onCSV} style={{ padding: "9px 16px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, color: "#16a34a", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>⬇️ CSV</button>}
      {onPrint && <button onClick={onPrint} style={{ padding: "9px 16px", background: "#1a7a45", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>🖨️ Print</button>}
    </div>
  );
}

const reportSheet = { background: "white", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" };
const rptH = { padding: "9px 12px", textAlign: "right", fontSize: 11, fontWeight: 700, color: "#6b7280", borderBottom: "2px solid #e5e7eb" };
const rptTd = { padding: "8px 12px", textAlign: "right", fontSize: 13, borderBottom: "1px solid #f3f4f6" };
const pendCell = { fontSize: 11, fontWeight: 700, color: "#b45309" };   // staged-but-unbilled marker (amber)

// Purchase sources for the product-wise tally breakdown — colour-coded so the
// Farmer vs Supplier vs Market split for each product is easy to read.
const PUR_SOURCES = [
  { key: "pf", label: "Farmer",   color: "#15803d" },   // green
  { key: "ps", label: "Supplier", color: "#2563eb" },   // blue (was teal — too close to farmer green)
  { key: "pm", label: "Market",   color: "#7c3aed" },   // purple
];
const srcBadge = (color) => ({ display: "inline-block", marginLeft: 8, fontSize: 10, fontWeight: 700, color, border: `1px solid ${color}`, borderRadius: 5, padding: "1px 6px", verticalAlign: "middle" });

// Bar chart (SVG, no library)
function BarChart({ data, height = 200 }) {
  if (!data || data.length === 0) return null;
  const W = 720, padL = 50, padR = 16, padT = 10, padB = 46;
  const max = Math.max(...data.map(d => Math.abs(d.value)), 1);
  const bw = (W - padL - padR) / data.length;
  const y0 = height - padB;
  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", minWidth: 420, height: "auto" }}>
        <line x1={padL} y1={y0} x2={W - padR} y2={y0} stroke="#e5e7eb" />
        {data.map((d, i) => {
          const h = (Math.abs(d.value) / max) * (height - padT - padB);
          const x = padL + i * bw + bw * 0.15;
          return (
            <g key={i}>
              <rect x={x} y={y0 - h} width={bw * 0.7} height={h} rx="3" fill={d.color || "#1a7a45"}>
                <title>{d.label}: {d.value}</title>
              </rect>
              <text x={x + bw * 0.35} y={height - 28} textAnchor="middle" fontSize="9" fill="#6b7280">{String(d.label).length > 10 ? String(d.label).slice(0, 9) + "…" : d.label}</text>
              <text x={x + bw * 0.35} y={y0 - h - 4} textAnchor="middle" fontSize="9" fill="#374151">{Math.round(d.value).toLocaleString("en-IN")}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ① Today's Collections (money received)
function CollectionsReport() {
  const [from, setFrom] = useState(getWorkingDate());
  const [to, setTo]     = useState(getWorkingDate());
  const [data, setData] = useState(null);
  const ref = useRef();
  useEffect(() => { api(`reports?action=collections&from=${from}&to=${to}`).then(setData).catch(() => {}); }, [from, to]);
  const rows = data?.data || [];
  const sum  = data?.summary || { total: 0, by_mode: {}, count: 0 };
  const csv = () => downloadCSV(`collections_${from}_${to}.csv`,
    [["Receipt", "Date", "Party", "City", "Mode", "Ref", "Discount", "Amount"], ...rows.map(r => [r.receipt_no, r.receipt_date, r.party_name, r.city, r.payment_mode, r.payment_ref, r.discount_amt || 0, r.amount])]);

  return (
    <div>
      <ReportBar from={from} setFrom={setFrom} to={to} setTo={setTo} onPrint={() => printReport(ref.current)} onCSV={csv} />
      <div ref={ref} style={reportSheet}>
        <ReportTitle title="Collections (Payments Received)" from={from} to={to} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 12, margin: "14px 0" }}>
          <StatCard label="Total Collected" value={fmt.currency(sum.total)} big />
          <StatCard label="Receipts" value={sum.count} />
          {(sum.discount_total || 0) > 0 && <StatCard label="Discount Given" value={fmt.currency(sum.discount_total)} color="#ea580c" />}
          {Object.entries(sum.by_mode).map(([m, v]) => <StatCard key={m} label={m.toUpperCase()} value={fmt.currency(v)} />)}
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{["Date", "Receipt", "Party", "City", "Mode", "Ref", "Discount ₹", "Amount ₹"].map((h, i) => <th key={h} style={{ ...rptH, textAlign: i < 6 ? "left" : "right" }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: "#888" }}>No collections in this period</td></tr> :
             rows.map((r, i) => (
              <tr key={i}>
                <td style={{ ...rptTd, textAlign: "left", color: "#666" }}>{fmt.date(r.receipt_date)}</td>
                <td style={{ ...rptTd, textAlign: "left", fontWeight: 600, color: "#2563eb" }}>{r.receipt_no}</td>
                <td style={{ ...rptTd, textAlign: "left" }}>{r.party_name}</td>
                <td style={{ ...rptTd, textAlign: "left", color: "#666" }}>{r.city || "—"}</td>
                <td style={{ ...rptTd, textAlign: "left" }}>{(r.payment_mode || "cash").toUpperCase()}</td>
                <td style={{ ...rptTd, textAlign: "left", color: "#666" }}>{r.payment_ref || "—"}</td>
                <td style={{ ...rptTd, color: (r.discount_amt > 0 ? "#ea580c" : "#9ca3af") }}>{(r.discount_amt > 0) ? fmt.currency(r.discount_amt) : "—"}</td>
                <td style={{ ...rptTd, fontWeight: 700 }}>{fmt.currency(r.amount)}</td>
              </tr>
             ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Farmer advances (crop-support money given before goods arrive) — tracked until recovered
function FarmerAdvancesReport() {
  const [from, setFrom] = useState(() => { const d = new Date(getWorkingDate()); d.setFullYear(d.getFullYear() - 1); return d.toISOString().split("T")[0]; });
  const [to, setTo]     = useState(getWorkingDate());
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [rows, setRows] = useState([]);
  const ref = useRef();

  const load = () => api(`purchase?action=advances&from=${from}&to=${to}${onlyOpen ? "&status=open" : ""}`)
    .then(r => setRows(r.data || [])).catch(() => {});
  useEffect(() => { load(); }, [from, to, onlyOpen]);

  const totAdv = rows.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
  const totOut = rows.reduce((s, r) => s + parseFloat(r.outstanding || 0), 0);

  const byFarmer = Object.values(rows.reduce((acc, r) => {
    const k = r.party_id || r.party_name;
    if (!acc[k]) acc[k] = { name: r.party_name, name_ta: r.party_name_ta, advanced: 0, outstanding: 0 };
    acc[k].advanced += parseFloat(r.amount || 0);
    acc[k].outstanding += parseFloat(r.outstanding || 0);
    return acc;
  }, {})).sort((a, b) => b.outstanding - a.outstanding);

  const settle = async (r) => {
    const max = parseFloat(r.outstanding || 0);
    const inp = window.prompt(`How much of ${r.party_name}'s advance is now recovered?\n(outstanding ${fmt.currency(max)})`, String(max));
    if (inp == null) return;
    const amt = parseFloat(inp);
    if (!(amt > 0)) return;
    try { await api("purchase?action=settle-advance", { method: "POST", body: JSON.stringify({ id: r.id, amount: amt }) }); load(); }
    catch (e) { alert(e.message); }
  };
  const del = async (r) => {
    if (!window.confirm(`Delete advance of ${fmt.currency(r.amount)} to ${r.party_name}?\nThis also removes its day-book cash-out.`)) return;
    try { await api("purchase?action=delete-advance", { method: "POST", body: JSON.stringify({ id: r.id }) }); load(); }
    catch (e) { alert(e.message); }
  };

  const csv = () => downloadCSV(`farmer_advances_${from}_${to}.csv`,
    [["Date", "Farmer", "City", "Mode", "Ref", "Advanced", "Recovered", "Outstanding", "Status"],
     ...rows.map(r => [r.advance_date, r.party_name, r.city || "", r.mode, r.payment_ref || "", r.amount, (parseFloat(r.amount) - parseFloat(r.outstanding)).toFixed(2), r.outstanding, r.status])]);

  return (
    <div>
      <ReportBar from={from} setFrom={setFrom} to={to} setTo={setTo} onPrint={() => printReport(ref.current)} onCSV={csv}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#374151", cursor: "pointer", paddingBottom: 8 }}>
          <input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} /> Outstanding only
        </label>
      </ReportBar>
      <div ref={ref} style={reportSheet}>
        <ReportTitle title="Farmer Advances — crop support" from={from} to={to} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, margin: "14px 0" }}>
          <StatCard label="Total Advanced" value={fmt.currency(totAdv)} big />
          <StatCard label="Recovered" value={fmt.currency(totAdv - totOut)} color="#16a34a" />
          <StatCard label="Outstanding" value={fmt.currency(totOut)} color="#7c3aed" big />
          <StatCard label="Entries" value={rows.length} />
        </div>

        {byFarmer.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#5b21b6", marginBottom: 6 }}>By farmer</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Farmer", "Advanced ₹", "Outstanding ₹"].map((h, i) => <th key={h} style={{ ...rptH, textAlign: i === 0 ? "left" : "right" }}>{h}</th>)}</tr></thead>
              <tbody>
                {byFarmer.map((f, i) => (
                  <tr key={i}>
                    <td style={{ ...rptTd, textAlign: "left", fontWeight: 600 }}>{f.name}{f.name_ta ? <span style={{ color: "#888", fontWeight: 400 }}> / {f.name_ta}</span> : null}</td>
                    <td style={rptTd}>{fmt.currency(f.advanced)}</td>
                    <td style={{ ...rptTd, fontWeight: 700, color: f.outstanding > 0 ? "#7c3aed" : "#9ca3af" }}>{fmt.currency(f.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{["Date", "Farmer", "Mode", "Ref", "Advanced ₹", "Outstanding ₹", "Status", ""].map((h, i) => <th key={i} style={{ ...rptH, textAlign: i < 4 ? "left" : "right" }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: "#888" }}>No advances in this period</td></tr> :
             rows.map((r, i) => (
              <tr key={i}>
                <td style={{ ...rptTd, textAlign: "left", color: "#666" }}>{fmt.date(r.advance_date)}</td>
                <td style={{ ...rptTd, textAlign: "left", fontWeight: 600 }}>{r.party_name}{r.notes ? <span style={{ display: "block", fontSize: 11, color: "#888", fontWeight: 400 }}>{r.notes}</span> : null}</td>
                <td style={{ ...rptTd, textAlign: "left" }}>{(r.mode || "cash").toUpperCase()}</td>
                <td style={{ ...rptTd, textAlign: "left", color: "#666" }}>{r.payment_ref || "—"}</td>
                <td style={rptTd}>{fmt.currency(r.amount)}</td>
                <td style={{ ...rptTd, fontWeight: 700, color: parseFloat(r.outstanding) > 0 ? "#7c3aed" : "#9ca3af" }}>{fmt.currency(r.outstanding)}</td>
                <td style={{ ...rptTd, textAlign: "right" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: r.status === "settled" ? "#dcfce7" : "#f3e8ff", color: r.status === "settled" ? "#16a34a" : "#7c3aed" }}>{r.status === "settled" ? "Settled" : "Open"}</span>
                </td>
                <td style={{ ...rptTd, textAlign: "right", whiteSpace: "nowrap" }} className="no-print">
                  {parseFloat(r.outstanding) > 0 && <button onClick={() => settle(r)} style={{ padding: "4px 9px", marginRight: 6, background: "#f3e8ff", border: "1px solid #ddd6fe", borderRadius: 6, color: "#7c3aed", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Recover</button>}
                  <button onClick={() => del(r)} title="Delete advance" style={{ padding: "4px 8px", background: "#fee2e2", border: "none", borderRadius: 6, color: "#dc2626", fontSize: 12, cursor: "pointer" }}>✕</button>
                </td>
              </tr>
             ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ② Vendor sales grouped by product
function SalesByProductReport() {
  const [from, setFrom] = useState(getWorkingDate());
  const [to, setTo]     = useState(getWorkingDate());
  const [vendors, setVendors] = useState([]);
  const [vid, setVid]   = useState("");        // "" = all vendors (by product)
  const [rows, setRows] = useState([]);
  const [daily, setDaily] = useState([]);
  const ref = useRef();

  useEffect(() => {
    Promise.all([
      apiCached("parties?action=list&category=CUSTOMER&cols=lite"), apiCached("parties?action=list&category=OVERFLOW&cols=lite"), apiCached("parties?action=list&category=MARKET_VENDOR&cols=lite"),
    ]).then(([a, b, c]) => { const seen = new Set(); setVendors([...a.data, ...b.data, ...c.data].filter(v => !seen.has(v.id) && seen.add(v.id))); }).catch(() => {});
  }, []);
  useEffect(() => {
    if (vid) api(`reports?action=vendor-daily&party_id=${vid}&from=${from}&to=${to}`).then(r => setDaily(r.data || [])).catch(() => {});
    else api(`reports?action=sales-by-product&from=${from}&to=${to}`).then(r => setRows(r.data || [])).catch(() => {});
  }, [from, to, vid]);

  const vendor = vendors.find(v => String(v.id) === String(vid));
  const totNet = rows.reduce((s, r) => s + parseFloat(r.net || 0), 0);
  const totMargin = rows.reduce((s, r) => s + parseFloat(r.margin || 0), 0);
  const dNet = daily.reduce((s, r) => s + parseFloat(r.net || 0), 0);

  const csv = () => vid
    ? downloadCSV(`vendor_sales_${vendor?.name_en}_${from}_${to}.csv`, [["Date", "Bills", "Bags", "Weight", "Net Sold", "Margin"], ...daily.map(r => [r.bill_date, r.bills, r.bags, r.weight, r.net, r.margin])])
    : downloadCSV(`vendor_sales_by_product_${from}_${to}.csv`, [["Product", "Bags", "Weight", "Gross", "Net Sold", "Margin", "Bills"], ...rows.map(r => [r.name_en, r.bags, r.weight, r.gross, r.net, r.margin, r.bills])]);

  return (
    <div>
      <ReportBar from={from} setFrom={setFrom} to={to} setTo={setTo} onPrint={() => printReport(ref.current)} onCSV={csv}>
        <div><label style={labelStyle}>Vendor</label>
          <select value={vid} onChange={e => setVid(e.target.value)} style={{ ...inputSm, width: 200 }}>
            <option value="">All vendors (by product)</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name_en}{v.city ? ` — ${v.city}` : ""}</option>)}
          </select>
        </div>
      </ReportBar>
      <div ref={ref} style={reportSheet}>
        {vid ? (
          <>
            <ReportTitle title={`Vendor Sales (per day) — ${vendor?.name_en || ""}`} from={from} to={to} />
            <div style={{ margin: "12px 0" }}><StatCard label="Total Sold" value={fmt.currency(dNet)} big /></div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Date", "Bills", "Bags", "Weight kg", "Net Sold ₹", "Margin ₹"].map((h, i) => <th key={h} style={{ ...rptH, textAlign: i === 0 ? "left" : "right" }}>{h}</th>)}</tr></thead>
              <tbody>
                {daily.length === 0 ? <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "#888" }}>No sales to this vendor</td></tr> :
                 daily.map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...rptTd, textAlign: "left", fontWeight: 600 }}>{fmt.date(r.bill_date)}</td>
                    <td style={rptTd}>{r.bills}</td><td style={rptTd}>{r.bags}</td>
                    <td style={rptTd}>{parseFloat(r.weight).toFixed(1)}</td>
                    <td style={{ ...rptTd, fontWeight: 700 }}>{fmt.currency(r.net)}</td>
                    <td style={{ ...rptTd, color: "#16a34a", fontWeight: 600 }}>{fmt.currency(r.margin)}</td>
                  </tr>
                 ))}
              </tbody>
            </table>
          </>
        ) : (
          <>
            <ReportTitle title="Vendor Sales by Product" from={from} to={to} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, margin: "14px 0" }}>
              <StatCard label="Total Sold" value={fmt.currency(totNet)} big />
              <StatCard label="Total Margin" value={fmt.currency(totMargin)} color="#16a34a" />
              <StatCard label="Products" value={rows.length} />
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Product", "Bags", "Weight kg", "Gross ₹", "Net Sold ₹", "Margin ₹", "Bills"].map((h, i) => <th key={h} style={{ ...rptH, textAlign: i === 0 ? "left" : "right" }}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "#888" }}>No sales in this period</td></tr> :
                 rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...rptTd, textAlign: "left", fontWeight: 600 }}>{r.name_en}{r.name_ta ? <span style={{ color: "#1a7a45", fontFamily: "'Noto Sans Tamil',sans-serif", marginLeft: 6, fontSize: 12 }}>{r.name_ta}</span> : null}</td>
                    <td style={rptTd}>{r.bags}</td>
                    <td style={rptTd}>{parseFloat(r.weight).toFixed(1)}</td>
                    <td style={rptTd}>{fmt.currency(r.gross)}</td>
                    <td style={{ ...rptTd, fontWeight: 700 }}>{fmt.currency(r.net)}</td>
                    <td style={{ ...rptTd, color: "#16a34a", fontWeight: 600 }}>{fmt.currency(r.margin)}</td>
                    <td style={rptTd}>{r.bills}</td>
                  </tr>
                 ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

// ③ Tally sheet — purchases vs sales reconciliation (profit/loss)
function TallySheetReport() {
  const [from, setFrom] = useState(getWorkingDate());
  const [to, setTo]     = useState(getWorkingDate());
  const [d, setD]       = useState(null);
  const [prod, setProd] = useState([]);
  const [discRate, setDiscRate] = useState(3.25);   // expected discount on not-yet-collected sales
  const [srcFilter, setSrcFilter] = useState({ pf: true, ps: true, pm: true });  // which purchase sources to show
  const ref = useRef();
  useEffect(() => { api(`reports?action=tally-sheet&from=${from}&to=${to}`).then(setD).catch(() => {}); }, [from, to]);
  useEffect(() => { api(`reports?action=tally-product&from=${from}&to=${to}`).then(r => setProd(r.data || [])).catch(() => {}); }, [from, to]);
  const p = d?.purchase || {}, s = d?.sales || {}, pr = d?.profit || {}, cash = d?.cash || {}, pend = d?.pending || {}, sup = d?.supplier || {}, mkt = d?.market || {};
  const hasPending = (pend.count || 0) > 0 || (pend.yard_count || 0) > 0;
  const hasSupplier = (sup.bills || 0) > 0;
  const hasMarket = (mkt.bills || 0) > 0;
  const hasExtraPur = hasSupplier || hasMarket;
  const projDisc = Math.round((parseFloat(cash.outstanding || 0) * (parseFloat(discRate) || 0) / 100));
  const projNet  = Math.round((parseFloat(pr.net_profit || 0)) - projDisc);
  const n = v => parseFloat(v || 0);
  // Purchase-source filter (checkboxes). When a subset is selected the breakdown shows
  // only those buying channels — purchased & profit are recomputed against the selection
  // so you can read the tally gap per channel. "All selected" === the full view.
  const activeKeys = PUR_SOURCES.filter(sc => srcFilter[sc.key]).map(sc => sc.key);
  const allSel = activeKeys.length === PUR_SOURCES.length;
  const selBags = x => activeKeys.reduce((s, k) => s + n(x[`${k}_bags`]), 0);
  const selWeight = x => activeKeys.reduce((s, k) => s + n(x[`${k}_weight`]), 0);
  const selAmount = x => activeKeys.reduce((s, k) => s + n(x[`${k}_amount`]), 0);
  const srcRowsOf = x => PUR_SOURCES.filter(sc => srcFilter[sc.key] && (n(x[`${sc.key}_bags`]) > 0 || n(x[`${sc.key}_weight`]) > 0 || n(x[`${sc.key}_amount`]) > 0));
  // A product is shown when it has a purchase in a selected source — and always when all
  // sources are selected (so sale-only products with no purchase still appear, as before).
  const isVisible = x => allSel || srcRowsOf(x).length > 0;
  const visProd = prod.filter(isVisible);
  const pt = visProd.reduce((a, x) => {
    const pW = selWeight(x), pA = selAmount(x);
    return {
      pb: a.pb + selBags(x), pw: a.pw + pW, pa: a.pa + pA,
      sb: a.sb + n(x.sal_bags), sw: a.sw + n(x.sal_weight), sa: a.sa + n(x.sal_amount),
      eb: a.eb + n(x.pend_bags), ew: a.ew + n(x.pend_weight), ea: a.ea + n(x.pend_amount),
      wp: a.wp + (n(x.sal_weight) - pW), ap: a.ap + (n(x.sal_amount) - pA),
    };
  }, { pb: 0, pw: 0, pa: 0, sb: 0, sw: 0, sa: 0, eb: 0, ew: 0, ea: 0, wp: 0, ap: 0 });
  const prodHasPending = pt.ea > 0 || pt.eb > 0 || pt.ew > 0;
  const prodHasMultiSrc = prod.some(x => srcRowsOf(x).length >= 2);
  // The 5 sold + profit cells, shared by a product's single-source row and its all-sources
  // total row. Sold stays the product's full figure (sales aren't tied to a buying source);
  // profit reconciles against the selected purchase (= original profit when all selected).
  const soldProfitCells = (x) => {
    const wp = n(x.sal_weight) - selWeight(x), ap = n(x.sal_amount) - selAmount(x);
    return (
      <>
        <td style={rptTd}>{x.sal_bags}{n(x.pend_bags) > 0 && <div style={pendCell}>+{x.pend_bags}</div>}</td>
        <td style={rptTd}>{parseFloat(x.sal_weight).toFixed(1)}{n(x.pend_weight) > 0 && <div style={pendCell}>+{parseFloat(x.pend_weight).toFixed(1)}</div>}</td>
        <td style={rptTd}>{fmt.currency(x.sal_amount)}{n(x.pend_amount) > 0 && <div style={pendCell}>+{fmt.currency(x.pend_amount)}</div>}</td>
        <td style={{ ...rptTd, fontWeight: 600, color: wp >= 0 ? "#16a34a" : "#dc2626" }}>{wp.toFixed(1)} kg</td>
        <td style={{ ...rptTd, fontWeight: 700, color: ap >= 0 ? "#16a34a" : "#dc2626" }}>{fmt.currency(ap)}</td>
      </>
    );
  };
  const nameTa = (ta) => ta ? <span style={{ color: "#1a7a45", fontFamily: "'Noto Sans Tamil',sans-serif", marginLeft: 6, fontSize: 12 }}>{ta}</span> : null;
  const csv = () => downloadCSV(`tally_sheet_${from}_${to}.csv`, [
    ["Product", "Pur Bags", "Pur Weight", "Pur Amount", "Farmer Bags", "Farmer Weight", "Farmer Amount", "Supplier Bags", "Supplier Weight", "Supplier Amount", "Market Bags", "Market Weight", "Market Amount", "Sold Bags", "Sold Weight", "Sold Amount", "Pending Bags", "Pending Weight", "Pending Amount", "Weight Profit", "Amount Profit"],
    ...prod.map(x => [x.name_en, x.pur_bags, x.pur_weight, x.pur_amount, x.pf_bags || 0, x.pf_weight || 0, x.pf_amount || 0, x.ps_bags || 0, x.ps_weight || 0, x.ps_amount || 0, x.pm_bags || 0, x.pm_weight || 0, x.pm_amount || 0, x.sal_bags, x.sal_weight, x.sal_amount, x.pend_bags || 0, x.pend_weight || 0, x.pend_amount || 0, x.weight_profit, x.amount_profit]),
    [], ["Purchases (paid to farmers)", p.bags, p.weight, p.paid],
    ...(hasSupplier ? [["Supplier purchases (own-account)", sup.bags, sup.weight, sup.cost]] : []),
    ...(hasMarket ? [["Market purchases (held pending)", mkt.bags, mkt.weight, mkt.cost]] : []),
    ...(hasExtraPur
      ? [["TOTAL Purchases", n(p.bags) + n(sup.bags) + n(mkt.bags), n(p.weight) + n(sup.weight) + n(mkt.weight), n(p.paid) + n(sup.cost) + n(mkt.cost)]]
      : [["TOTAL Purchases", p.bags, p.weight, p.paid]]),
    ["TOTAL Sales (billed)", s.bags, s.weight, s.net],
    ...(hasPending ? [
      ["Pending sales (staged, not billed)", pend.bags, pend.weight, pend.amount],
      ...(pend.yard_count > 0 ? [["Yard lots pending (no rate, not valued)", pend.yard_count, "", ""]] : []),
      ["Sales incl. pending", n(s.bags) + n(pend.bags), n(s.weight) + n(pend.weight), n(s.net) + n(pend.amount)],
    ] : []),
    [], ["Commission earned", pr.commission], ["Trading margin", pr.margin], ["Gross profit", pr.gross],
    ["Discounts given", pr.discounts], ["Net profit (booked)", pr.net_profit],
    [], ["Billed to vendors", cash.billed], ["Collected so far", cash.collected],
    ["Still to collect", cash.outstanding], [`Est. discount on outstanding (${discRate}%)`, projDisc],
    ["Projected net in hand", projNet],
  ]);

  return (
    <div>
      <ReportBar from={from} setFrom={setFrom} to={to} setTo={setTo} onPrint={() => printReport(ref.current)} onCSV={csv} />
      <div ref={ref} style={reportSheet}>
        <ReportTitle title="Tally Sheet — Purchases vs Sales" from={from} to={to} />
        {d && (
          <>
            <table style={{ width: "100%", borderCollapse: "collapse", margin: "10px 0 18px" }}>
              <thead><tr>{["", "Bills", "Bags", "Weight kg", "Gross ₹", "Net ₹"].map((h, i) => <th key={h} style={{ ...rptH, textAlign: i === 0 ? "left" : "right" }}>{h}</th>)}</tr></thead>
              <tbody>
                <tr>
                  <td style={{ ...rptTd, textAlign: "left", fontWeight: 700, color: "#1a7a45" }}>Purchases (paid to farmers)</td>
                  <td style={rptTd}>{p.bills}</td><td style={rptTd}>{p.bags}</td>
                  <td style={rptTd}>{parseFloat(p.weight || 0).toFixed(1)}</td>
                  <td style={rptTd}>{fmt.currency(p.gross)}</td>
                  <td style={{ ...rptTd, fontWeight: 700 }}>{fmt.currency(p.paid)}</td>
                </tr>
                {hasSupplier && (
                  <tr>
                    <td style={{ ...rptTd, textAlign: "left", fontWeight: 700, color: "#0d9488" }}>+ Supplier purchases (own-account)</td>
                    <td style={rptTd}>{sup.bills}</td><td style={rptTd}>{sup.bags}</td>
                    <td style={rptTd}>{parseFloat(sup.weight || 0).toFixed(1)}</td>
                    <td style={rptTd}>{fmt.currency(sup.goods)}</td>
                    <td style={{ ...rptTd, fontWeight: 700 }}>{fmt.currency(sup.cost)}</td>
                  </tr>
                )}
                {hasMarket && (
                  <tr>
                    <td style={{ ...rptTd, textAlign: "left", fontWeight: 700, color: "#7c3aed" }}>+ Market purchases <span style={{ fontWeight: 400, fontSize: 11, color: "#888" }}>(held pending — settles weekly)</span></td>
                    <td style={rptTd}>{mkt.bills}</td><td style={rptTd}>{mkt.bags}</td>
                    <td style={rptTd}>{parseFloat(mkt.weight || 0).toFixed(1)}</td>
                    <td style={rptTd}>{fmt.currency(mkt.cost)}</td>
                    <td style={{ ...rptTd, fontWeight: 700 }}>{fmt.currency(mkt.cost)}</td>
                  </tr>
                )}
                {hasExtraPur && (
                  <tr style={{ borderTop: "1px solid #e5e7eb", background: "#f0fdf4" }}>
                    <td style={{ ...rptTd, textAlign: "left", fontWeight: 800, color: "#15803d" }}>Total purchases</td>
                    <td style={{ ...rptTd, fontWeight: 700 }}>{n(p.bills) + n(sup.bills) + n(mkt.bills)}</td>
                    <td style={{ ...rptTd, fontWeight: 700 }}>{n(p.bags) + n(sup.bags) + n(mkt.bags)}</td>
                    <td style={{ ...rptTd, fontWeight: 700 }}>{(n(p.weight) + n(sup.weight) + n(mkt.weight)).toFixed(1)}</td>
                    <td style={{ ...rptTd, fontWeight: 700 }}>{fmt.currency(n(p.gross) + n(sup.goods) + n(mkt.cost))}</td>
                    <td style={{ ...rptTd, fontWeight: 800 }}>{fmt.currency(n(p.paid) + n(sup.cost) + n(mkt.cost))}</td>
                  </tr>
                )}
                <tr>
                  <td style={{ ...rptTd, textAlign: "left", fontWeight: 700, color: "#2563eb" }}>Sales (billed to vendors)</td>
                  <td style={rptTd}>{s.bills}</td><td style={rptTd}>{s.bags}</td>
                  <td style={rptTd}>{parseFloat(s.weight || 0).toFixed(1)}</td>
                  <td style={rptTd}>{fmt.currency(s.gross)}</td>
                  <td style={{ ...rptTd, fontWeight: 700 }}>{fmt.currency(s.net)}</td>
                </tr>
                {hasPending && (
                  <tr style={{ background: "#fffbeb" }}>
                    <td style={{ ...rptTd, textAlign: "left", fontWeight: 700, color: "#b45309" }}>
                      + Pending sales (staged, not yet billed)
                      {pend.yard_count > 0 && <span style={{ fontWeight: 400, fontSize: 11, color: "#92400e" }}> · {pend.yard_count} yard lot{pend.yard_count === 1 ? "" : "s"} not valued</span>}
                    </td>
                    <td style={rptTd}>—</td><td style={rptTd}>{pend.bags}</td>
                    <td style={rptTd}>{parseFloat(pend.weight || 0).toFixed(1)}</td>
                    <td style={rptTd}>—</td>
                    <td style={{ ...rptTd, fontWeight: 700, color: "#b45309" }}>{fmt.currency(pend.amount)}</td>
                  </tr>
                )}
                {hasPending && (
                  <tr style={{ borderTop: "1px solid #e5e7eb" }}>
                    <td style={{ ...rptTd, textAlign: "left", fontWeight: 800, color: "#1d4ed8" }}>Sales incl. pending</td>
                    <td style={rptTd}>—</td>
                    <td style={{ ...rptTd, fontWeight: 700 }}>{parseFloat(s.bags || 0) + parseFloat(pend.bags || 0)}</td>
                    <td style={{ ...rptTd, fontWeight: 700 }}>{(parseFloat(s.weight || 0) + parseFloat(pend.weight || 0)).toFixed(1)}</td>
                    <td style={rptTd}>—</td>
                    <td style={{ ...rptTd, fontWeight: 800 }}>{fmt.currency(parseFloat(s.net || 0) + parseFloat(pend.amount || 0))}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {hasPending && (
              <div style={{ fontSize: 11, color: "#92400e", margin: "-10px 0 18px", background: "#fffbeb", border: "1px dashed #f59e0b", borderRadius: 8, padding: "8px 12px" }}>
                ⚠️ <strong>{fmt.currency(pend.amount)}</strong> of sales are staged but not yet billed to vendors. Booked profit &amp; cash figures below count <strong>billed</strong> sales only — raise the pending vendor bills to fully reconcile against purchases.
              </div>
            )}

            {/* Product-wise breakdown — clean table with a totals row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, margin: "4px 0 8px" }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Product-wise breakdown</div>
              <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 12 }}>
                <span style={{ color: "#6b7280", fontWeight: 600 }}>Show:</span>
                {PUR_SOURCES.map(sc => (
                  <label key={sc.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", color: srcFilter[sc.key] ? sc.color : "#9ca3af", fontWeight: 600 }}>
                    <input type="checkbox" checked={srcFilter[sc.key]} onChange={e => setSrcFilter(f => ({ ...f, [sc.key]: e.target.checked }))} style={{ accentColor: sc.color, cursor: "pointer" }} />
                    {sc.label}
                  </label>
                ))}
                {!allSel && <button onClick={() => setSrcFilter({ pf: true, ps: true, pm: true })} style={{ background: "#f3f4f6", border: "none", borderRadius: 6, padding: "3px 9px", cursor: "pointer", fontSize: 11, color: "#374151" }}>All</button>}
              </div>
            </div>
            {!allSel && (
              <div style={{ fontSize: 11, color: "#6b7280", margin: "0 0 8px", background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: 6, padding: "5px 10px" }}>
                Showing <b>{activeKeys.map(k => PUR_SOURCES.find(s => s.key === k).label).join(" + ")}</b> only. Purchased &amp; profit reconcile against these channels — sold stays the product's full figure.
              </div>
            )}
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 22 }}>
              <thead>
                <tr>
                  <th rowSpan={2} style={{ ...rptH, textAlign: "left", verticalAlign: "bottom" }}>Product</th>
                  <th colSpan={3} style={{ ...rptH, textAlign: "center", background: "#f0fdf4", color: "#15803d" }}>Purchased</th>
                  <th colSpan={3} style={{ ...rptH, textAlign: "center", background: "#eff6ff", color: "#1d4ed8" }}>Sold</th>
                  <th colSpan={2} style={{ ...rptH, textAlign: "center" }}>Profit</th>
                </tr>
                <tr>
                  {["Bags", "Weight", "Amount ₹", "Bags", "Weight", "Amount ₹", "Weight", "Amount ₹"].map((h, i) => <th key={i} style={{ ...rptH }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {prod.length === 0 ? <tr><td colSpan={9} style={{ padding: 20, textAlign: "center", color: "#888" }}>No data</td></tr> :
                 visProd.length === 0 ? <tr><td colSpan={9} style={{ padding: 20, textAlign: "center", color: "#888" }}>No products purchased from the selected source(s).</td></tr> :
                 visProd.flatMap((x, i) => {
                  const bg = i % 2 ? "#fafafa" : "white";
                  const srcs = srcRowsOf(x);   // only the selected sources that have purchases
                  // Single source (or none): one row, tagged with a source badge so the tally gap is obvious.
                  if (srcs.length <= 1) {
                    const sc = srcs[0];
                    return [(
                      <tr key={i} style={{ background: bg }}>
                        <td style={{ ...rptTd, textAlign: "left", fontWeight: 600 }}>{x.name_en}{nameTa(x.name_ta)}{sc && <span style={srcBadge(sc.color)}>{sc.label}</span>}</td>
                        <td style={rptTd}>{selBags(x)}</td><td style={rptTd}>{selWeight(x).toFixed(1)}</td><td style={rptTd}>{fmt.currency(selAmount(x))}</td>
                        {soldProfitCells(x)}
                      </tr>
                    )];
                  }
                  // Multiple sources: one sub-row per selected source (purchase only), then a bold total carrying sold + profit.
                  const rows = srcs.map(sc => (
                    <tr key={`${i}-${sc.key}`} style={{ background: bg }}>
                      <td style={{ ...rptTd, textAlign: "left", paddingLeft: 24, fontWeight: 600, fontSize: 12, color: sc.color }}>↳ {x.name_en} <span style={srcBadge(sc.color)}>{sc.label}</span></td>
                      <td style={{ ...rptTd, color: sc.color }}>{x[`${sc.key}_bags`]}</td>
                      <td style={{ ...rptTd, color: sc.color }}>{parseFloat(x[`${sc.key}_weight`] || 0).toFixed(1)}</td>
                      <td style={{ ...rptTd, color: sc.color }}>{fmt.currency(x[`${sc.key}_amount`])}</td>
                      <td style={{ ...rptTd, color: "#cbd5e1" }} colSpan={5}>—</td>
                    </tr>
                  ));
                  rows.push(
                    <tr key={`${i}-tot`} style={{ background: bg, borderTop: "1px dashed #cbd5e1" }}>
                      <td style={{ ...rptTd, textAlign: "left", fontWeight: 700 }}>{x.name_en}{nameTa(x.name_ta)} <span style={{ fontSize: 11, fontWeight: 400, color: "#888" }}>({allSel ? "all sources" : "selected"})</span></td>
                      <td style={{ ...rptTd, fontWeight: 700 }}>{selBags(x)}</td><td style={{ ...rptTd, fontWeight: 700 }}>{selWeight(x).toFixed(1)}</td><td style={{ ...rptTd, fontWeight: 700 }}>{fmt.currency(selAmount(x))}</td>
                      {soldProfitCells(x)}
                    </tr>
                  );
                  return rows;
                 })}
              </tbody>
              {visProd.length > 0 && (
                <tfoot>
                  <tr style={{ background: "#f1f5f9", borderTop: "2px solid #cbd5e1" }}>
                    <td style={{ ...rptTd, textAlign: "left", fontWeight: 800 }}>TOTAL{!allSel && <span style={{ fontSize: 10, fontWeight: 400, color: "#6b7280" }}> ({activeKeys.map(k => PUR_SOURCES.find(s => s.key === k).label).join("+")})</span>}</td>
                    <td style={{ ...rptTd, fontWeight: 700 }}>{pt.pb}</td><td style={{ ...rptTd, fontWeight: 700 }}>{pt.pw.toFixed(1)}</td><td style={{ ...rptTd, fontWeight: 700 }}>{fmt.currency(pt.pa)}</td>
                    <td style={{ ...rptTd, fontWeight: 700 }}>{pt.sb}{pt.eb > 0 && <div style={pendCell}>+{pt.eb}</div>}</td>
                    <td style={{ ...rptTd, fontWeight: 700 }}>{pt.sw.toFixed(1)}{pt.ew > 0 && <div style={pendCell}>+{pt.ew.toFixed(1)}</div>}</td>
                    <td style={{ ...rptTd, fontWeight: 700 }}>{fmt.currency(pt.sa)}{pt.ea > 0 && <div style={pendCell}>+{fmt.currency(pt.ea)}</div>}</td>
                    <td style={{ ...rptTd, fontWeight: 800, color: pt.wp >= 0 ? "#16a34a" : "#dc2626" }}>{pt.wp.toFixed(1)} kg</td>
                    <td style={{ ...rptTd, fontWeight: 800, color: pt.ap >= 0 ? "#16a34a" : "#dc2626" }}>{fmt.currency(pt.ap)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
            {prodHasPending && (
              <div style={{ fontSize: 11, color: "#b45309", margin: "-14px 0 6px" }}>
                <span style={{ ...pendCell, display: "inline" }}>+amber</span> = staged sales not yet billed to vendors (counted separately, not in profit above).
              </div>
            )}
            <div style={{ fontSize: 11, color: "#555", margin: "-14px 0 4px", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
              <span style={{ fontWeight: 600 }}>Purchase source:</span>
              {PUR_SOURCES.map(sc => <span key={sc.key} style={srcBadge(sc.color)}>{sc.label}</span>)}
              {prodHasMultiSrc && <span style={{ color: "#888" }}>— products bought from more than one source are split into per-source rows (↳) with an all-sources total, so you can spot the tally gap between buying channels.</span>}
            </div>
            <div style={{ fontSize: 11, color: "#888", margin: "2px 0 18px" }}>Profit shown is sold − purchased (before commission). Weight profit = sold weight − purchased weight. Sold &amp; profit are shown once per product (sales aren't tied to a buying source).</div>

            {/* ── What you actually earn (matched by rate, independent of which day you sold) ── */}
            <div style={{ fontSize: 14, fontWeight: 700, margin: "4px 0 8px" }}>Profit earned <span style={{ fontSize: 11, fontWeight: 400, color: "#888" }}>(margin is sale-rate − buy-rate per lot, so holding goods a day or two doesn't distort it)</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 8 }}>
              <StatCard label="Commission (10%)" value={fmt.currency(pr.commission)} color="#7c3aed" />
              <StatCard label="Trading margin" value={fmt.currency(pr.margin)} color="#0ea5e9" />
              <StatCard label="Gross profit" value={fmt.currency(pr.gross)} color="#16a34a" />
              <StatCard label="− Discounts given" value={fmt.currency(pr.discounts)} color="#ea580c" />
              <StatCard label="Net profit (booked)" value={fmt.currency(pr.net_profit)} big color={(pr.net_profit || 0) >= 0 ? "#16a34a" : "#dc2626"} />
            </div>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 18 }}>Gross = commission + trading margin. Net booked = gross − discounts already given to vendors.</div>

            {/* ── Per-product profit breakdown: weight excess + rate margin ── */}
            {(() => {
              const weightProfit = visProd.reduce((sum, x) => {
                const sw = n(x.sal_weight), sa = n(x.sal_amount);
                const pw = selWeight(x);
                const sRate = sw > 0 ? sa / sw : 0;
                return sum + (sw - pw) * sRate;
              }, 0);
              const rateProfit = visProd.reduce((sum, x) => {
                const sw = n(x.sal_weight), sa = n(x.sal_amount);
                const pw = selWeight(x), pa = selAmount(x);
                const sRate = sw > 0 ? sa / sw : 0;
                const pRate = pw > 0 ? pa / pw : 0;
                return sum + pw * (sRate - pRate);
              }, 0);
              const totalTradingProfit = pt.ap;   // = weightProfit + rateProfit exactly
              return (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0369a1", margin: "0 0 8px", borderTop: "1px dashed #bae6fd", paddingTop: 12 }}>
                    How the trading profit breaks down
                    <span style={{ fontSize: 11, fontWeight: 400, color: "#888", marginLeft: 8 }}>(computed from product-wise averages above)</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 6 }}>
                    <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: "12px 16px" }}>
                      <div style={{ fontSize: 11, color: "#0369a1", fontWeight: 600, marginBottom: 4 }}>Commission (10%)</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: "#7c3aed" }}>{fmt.currency(pr.commission)}</div>
                      <div style={{ fontSize: 10, color: "#888", marginTop: 3 }}>10% of purchase billed to farmer</div>
                    </div>
                    <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: "12px 16px" }}>
                      <div style={{ fontSize: 11, color: "#0369a1", fontWeight: 600, marginBottom: 4 }}>Weight excess profit</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: weightProfit >= 0 ? "#0369a1" : "#dc2626" }}>{fmt.currency(Math.round(weightProfit))}</div>
                      <div style={{ fontSize: 10, color: "#888", marginTop: 3 }}>Extra kg sold × avg sale rate/kg</div>
                    </div>
                    <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: "12px 16px" }}>
                      <div style={{ fontSize: 11, color: "#0369a1", fontWeight: 600, marginBottom: 4 }}>Rate margin profit</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: rateProfit >= 0 ? "#0369a1" : "#dc2626" }}>{fmt.currency(Math.round(rateProfit))}</div>
                      <div style={{ fontSize: 10, color: "#888", marginTop: 3 }}>Same weight, sold at higher rate</div>
                    </div>
                  </div>
                  <div style={{ background: "#ecfdf5", border: "1px solid #6ee7b7", borderRadius: 10, padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 6 }}>
                    <div>
                      <div style={{ fontSize: 12, color: "#065f46", fontWeight: 600 }}>Total trading profit (product table sum)</div>
                      <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>Weight excess + Rate margin = last-column total in the breakdown above</div>
                    </div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: totalTradingProfit >= 0 ? "#16a34a" : "#dc2626", whiteSpace: "nowrap" }}>{fmt.currency(Math.round(totalTradingProfit))}</div>
                  </div>
                  <div style={{ background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: 10, padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 12, color: "#6b21a8", fontWeight: 600 }}>Grand total income</div>
                      <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>Commission + trading profit (before discounts)</div>
                    </div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: "#7c3aed", whiteSpace: "nowrap" }}>{fmt.currency(Math.round(n(pr.commission) + totalTradingProfit))}</div>
                  </div>
                </>
              );
            })()}

            {/* ── Cash reality: vendors pay in 14–21 days and take a discount ── */}
            <div style={{ fontSize: 14, fontWeight: 700, margin: "4px 0 8px" }}>Cash reality — what actually reaches your hand</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 8 }}>
              <StatCard label="Billed to vendors" value={fmt.currency(cash.billed)} />
              <StatCard label="Collected so far" value={fmt.currency(cash.collected)} color="#16a34a" />
              <StatCard label="Still to collect (14–21d)" value={fmt.currency(cash.outstanding)} color="#dc2626" />
              <StatCard label={`Est. discount to give (${discRate}%)`} value={fmt.currency(projDisc)} color="#ea580c" />
              <StatCard label="Projected net in hand" value={fmt.currency(projNet)} big color={projNet >= 0 ? "#16a34a" : "#dc2626"} />
            </div>
            <div className="no-print" style={{ fontSize: 12, color: "#555", marginBottom: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              Expected discount on the uncollected amount:
              <input type="number" step="0.25" value={discRate} onChange={e => setDiscRate(e.target.value)} style={{ ...inputSm, width: 70 }} /> %
            </div>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 18 }}>
              Projected net in hand = net profit booked − estimated discount on the {fmt.currency(cash.outstanding)} still to be collected.
              This is what you'll really keep once the vendors pay (after their 3–3.5% discount).
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ⑤ Product P&L over a season — single product or All products
function ProductPnLReport() {
  const [products, setProducts] = useState([]);
  const [pid, setPid] = useState("");     // "" = All products
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 7) + "-01");
  const [to, setTo]     = useState(new Date().toISOString().split("T")[0]);
  const [d, setD]       = useState(null);   // single product
  const [all, setAll]   = useState([]);     // all products
  const ref = useRef();
  useEffect(() => { api("products?action=list").then(r => setProducts(r.data || [])).catch(() => {}); }, []);
  useEffect(() => {
    if (pid) api(`reports?action=product-pnl&product_id=${pid}&from=${from}&to=${to}`).then(setD).catch(() => {});
    else api(`reports?action=tally-product&from=${from}&to=${to}`).then(r => setAll(r.data || [])).catch(() => {});
  }, [pid, from, to]);
  const p = d?.purchase || {}, s = d?.sales || {}, pr = d?.profit || {};
  const prod = products.find(x => String(x.id) === String(pid));
  const csv = () => pid
    ? downloadCSV(`product_pnl_${prod?.name_en || pid}_${from}_${to}.csv`, [["", "Bags", "Weight", "Amount"], ["Purchased", p.bags, p.weight, p.amount], ["Sold", s.bags, s.weight, s.amount], [], ["Sold − Paid", pr.sold_minus_paid], ["Margin", pr.margin]])
    : downloadCSV(`product_pnl_all_${from}_${to}.csv`, [["Product", "Pur Bags", "Pur Weight", "Pur Amount", "Sold Bags", "Sold Weight", "Sold Amount", "Weight Profit", "Amount Profit"], ...all.map(x => [x.name_en, x.pur_bags, x.pur_weight, x.pur_amount, x.sal_bags, x.sal_weight, x.sal_amount, x.weight_profit, x.amount_profit])]);

  return (
    <div>
      <ReportBar from={from} setFrom={setFrom} to={to} setTo={setTo} onPrint={() => printReport(ref.current)} onCSV={csv}>
        <div><label style={labelStyle}>Product</label>
          <select value={pid} onChange={e => setPid(e.target.value)} style={{ ...inputSm, width: 200 }}>
            <option value="">All products</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name_en}</option>)}
          </select>
        </div>
      </ReportBar>
      <div ref={ref} style={reportSheet}>
        {pid ? (
          <>
            <ReportTitle title={`Product P&L — ${prod?.name_en || ""}${prod?.name_ta ? " / " + prod.name_ta : ""}`} from={from} to={to} />
            {d && (
              <>
                <table style={{ width: "100%", borderCollapse: "collapse", margin: "10px 0 18px" }}>
                  <thead><tr>{["", "Bags", "Weight kg", "Amount ₹"].map((h, i) => <th key={h} style={{ ...rptH, textAlign: i === 0 ? "left" : "right" }}>{h}</th>)}</tr></thead>
                  <tbody>
                    <tr><td style={{ ...rptTd, textAlign: "left", fontWeight: 700, color: "#1a7a45" }}>Purchased</td><td style={rptTd}>{p.bags}</td><td style={rptTd}>{parseFloat(p.weight || 0).toFixed(1)}</td><td style={{ ...rptTd, fontWeight: 700 }}>{fmt.currency(p.amount)}</td></tr>
                    <tr><td style={{ ...rptTd, textAlign: "left", fontWeight: 700, color: "#2563eb" }}>Sold</td><td style={rptTd}>{s.bags}</td><td style={rptTd}>{parseFloat(s.weight || 0).toFixed(1)}</td><td style={{ ...rptTd, fontWeight: 700 }}>{fmt.currency(s.amount)}</td></tr>
                  </tbody>
                </table>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
                  <StatCard label="Sold − Paid" value={fmt.currency(pr.sold_minus_paid)} big color={pr.sold_minus_paid >= 0 ? "#16a34a" : "#dc2626"} />
                  <StatCard label="Sales Margin" value={fmt.currency(pr.margin)} color="#16a34a" />
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <ReportTitle title="Product P&L — All products" from={from} to={to} />
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
              <thead>
                <tr>
                  <th rowSpan={2} style={{ ...rptH, textAlign: "left", verticalAlign: "bottom" }}>Product</th>
                  <th colSpan={2} style={{ ...rptH, textAlign: "center", background: "#f0fdf4", color: "#15803d" }}>Purchased</th>
                  <th colSpan={2} style={{ ...rptH, textAlign: "center", background: "#eff6ff", color: "#1d4ed8" }}>Sold</th>
                  <th colSpan={2} style={{ ...rptH, textAlign: "center" }}>Profit</th>
                </tr>
                <tr>{["Weight", "Amount ₹", "Weight", "Amount ₹", "Weight", "Amount ₹"].map((h, i) => <th key={i} style={rptH}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {all.length === 0 ? <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: "#888" }}>No data</td></tr> :
                 all.map((x, i) => (
                  <tr key={i}>
                    <td style={{ ...rptTd, textAlign: "left", fontWeight: 600 }}>{x.name_en}</td>
                    <td style={rptTd}>{parseFloat(x.pur_weight).toFixed(1)}</td><td style={rptTd}>{fmt.currency(x.pur_amount)}</td>
                    <td style={rptTd}>{parseFloat(x.sal_weight).toFixed(1)}</td><td style={rptTd}>{fmt.currency(x.sal_amount)}</td>
                    <td style={{ ...rptTd, color: x.weight_profit >= 0 ? "#16a34a" : "#dc2626" }}>{parseFloat(x.weight_profit).toFixed(1)}</td>
                    <td style={{ ...rptTd, fontWeight: 700, color: x.amount_profit >= 0 ? "#16a34a" : "#dc2626" }}>{fmt.currency(x.amount_profit)}</td>
                  </tr>
                 ))}
              </tbody>
              {all.length > 0 && (() => {
                const T = all.reduce((a, x) => ({
                  pw: a.pw + parseFloat(x.pur_weight || 0), pa: a.pa + parseFloat(x.pur_amount || 0),
                  sw: a.sw + parseFloat(x.sal_weight || 0), sa: a.sa + parseFloat(x.sal_amount || 0),
                  ap: a.ap + parseFloat(x.amount_profit || 0),
                }), { pw: 0, pa: 0, sw: 0, sa: 0, ap: 0 });
                return (
                  <tfoot>
                    <tr style={{ background: "#f9fafb", borderTop: "2px solid #1a7a45" }}>
                      <td style={{ ...rptTd, textAlign: "left", fontWeight: 800 }}>TOTAL</td>
                      <td style={{ ...rptTd, fontWeight: 700 }}>{T.pw.toFixed(1)}</td>
                      <td style={{ ...rptTd, fontWeight: 800 }}>{fmt.currency(T.pa)}</td>
                      <td style={{ ...rptTd, fontWeight: 700 }}>{T.sw.toFixed(1)}</td>
                      <td style={{ ...rptTd, fontWeight: 800 }}>{fmt.currency(T.sa)}</td>
                      <td style={rptTd}>{(T.sw - T.pw).toFixed(1)}</td>
                      <td style={{ ...rptTd, fontWeight: 800, color: T.ap >= 0 ? "#16a34a" : "#dc2626" }}>{fmt.currency(T.ap)}</td>
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
          </>
        )}
      </div>
    </div>
  );
}

// ⑥ Vendor P&L over a season — single vendor or All vendors
function VendorPnLReport() {
  const [vendors, setVendors] = useState([]);
  const [vid, setVid] = useState("");        // "" = All vendors
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 7) + "-01");
  const [to, setTo]     = useState(new Date().toISOString().split("T")[0]);
  const [d, setD]       = useState(null);
  const [all, setAll]   = useState([]);
  const ref = useRef();
  useEffect(() => {
    Promise.all([
      apiCached("parties?action=list&category=CUSTOMER&cols=lite"),
      apiCached("parties?action=list&category=OVERFLOW&cols=lite"),
      apiCached("parties?action=list&category=MARKET_VENDOR&cols=lite"),
    ]).then(([a, b, c]) => {
      const seen = new Set();
      setVendors([...a.data, ...b.data, ...c.data].filter(v => !seen.has(v.id) && seen.add(v.id)));
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (vid) api(`reports?action=vendor-pnl&party_id=${vid}&from=${from}&to=${to}`).then(setD).catch(() => {});
    else api(`reports?action=sales-by-vendor&from=${from}&to=${to}`).then(r => setAll(r.data || [])).catch(() => {});
  }, [vid, from, to]);
  const t = d?.totals || {}, bp = d?.by_product || [];
  const vendor = vendors.find(x => String(x.id) === String(vid));
  const csv = () => vid
    ? downloadCSV(`vendor_pnl_${vendor?.name_en || vid}_${from}_${to}.csv`, [["Product", "Bags", "Weight", "Net Sold", "Margin"], ...bp.map(r => [r.name_en, r.bags, r.weight, r.net, r.margin])])
    : downloadCSV(`vendor_pnl_all_${from}_${to}.csv`, [["Vendor", "City", "Bills", "Weight", "Net Sold", "Margin"], ...all.map(r => [r.name_en, r.city, r.bills, r.weight, r.net, r.margin])]);

  return (
    <div>
      <ReportBar from={from} setFrom={setFrom} to={to} setTo={setTo} onPrint={() => printReport(ref.current)} onCSV={csv}>
        <div><label style={labelStyle}>Vendor</label>
          <select value={vid} onChange={e => setVid(e.target.value)} style={{ ...inputSm, width: 200 }}>
            <option value="">All vendors</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name_en}</option>)}
          </select>
        </div>
      </ReportBar>
      <div ref={ref} style={reportSheet}>
        {!vid ? (
          <>
            <ReportTitle title="Vendor P&L — All vendors" from={from} to={to} />
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Vendor", "City", "Bills", "Weight kg", "Net Sold ₹", "Margin ₹"].map((h, i) => <th key={h} style={{ ...rptH, textAlign: i < 2 ? "left" : "right" }}>{h}</th>)}</tr></thead>
              <tbody>
                {all.length === 0 ? <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "#888" }}>No sales in this period</td></tr> :
                 all.map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...rptTd, textAlign: "left", fontWeight: 600 }}>{r.name_en}</td>
                    <td style={{ ...rptTd, textAlign: "left", color: "#666" }}>{r.city || "—"}</td>
                    <td style={rptTd}>{r.bills}</td>
                    <td style={rptTd}>{parseFloat(r.weight).toFixed(1)}</td>
                    <td style={{ ...rptTd, fontWeight: 700 }}>{fmt.currency(r.net)}</td>
                    <td style={{ ...rptTd, color: "#16a34a", fontWeight: 600 }}>{fmt.currency(r.margin)}</td>
                  </tr>
                 ))}
              </tbody>
            </table>
          </>
        ) : (
        <>
        <ReportTitle title={`Vendor P&L — ${vendor?.name_en || ""}`} from={from} to={to} />
        {d && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, margin: "10px 0 18px" }}>
              <StatCard label="Bills" value={t.bills || 0} />
              <StatCard label="Total Sold" value={fmt.currency(t.net)} big />
              <StatCard label="Margin Earned" value={fmt.currency(t.margin)} color="#16a34a" />
              {(t.discounts || 0) > 0 && <StatCard label="Discounts Given" value={fmt.currency(t.discounts)} color="#ea580c" />}
              {(t.discounts || 0) > 0 && <StatCard label="Net Margin" value={fmt.currency(t.net_margin)} color={(t.net_margin || 0) >= 0 ? "#16a34a" : "#dc2626"} />}
              <StatCard label="Weight" value={`${parseFloat(t.weight || 0).toFixed(0)} kg`} />
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Product", "Bags", "Weight kg", "Net Sold ₹", "Margin ₹"].map((h, i) => <th key={h} style={{ ...rptH, textAlign: i === 0 ? "left" : "right" }}>{h}</th>)}</tr></thead>
              <tbody>
                {bp.length === 0 ? <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: "#888" }}>No sales to this vendor in this period</td></tr> :
                 bp.map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...rptTd, textAlign: "left", fontWeight: 600 }}>{r.name_en}</td>
                    <td style={rptTd}>{r.bags}</td>
                    <td style={rptTd}>{parseFloat(r.weight).toFixed(1)}</td>
                    <td style={{ ...rptTd, fontWeight: 700 }}>{fmt.currency(r.net)}</td>
                    <td style={{ ...rptTd, color: "#16a34a", fontWeight: 600 }}>{fmt.currency(r.margin)}</td>
                  </tr>
                 ))}
              </tbody>
            </table>
          </>
        )}
        </>
        )}
      </div>
    </div>
  );
}

// Shared little pieces for reports
function ReportTitle({ title, from, to }) {
  return (
    <div style={{ borderBottom: "2px solid #1a7a45", paddingBottom: 10, marginBottom: 6 }}>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{title}</div>
      <div style={{ fontSize: 12, color: "#666" }}>Sri Murugan & Co · {fmt.date(from)} → {fmt.date(to)}</div>
    </div>
  );
}
function StatCard({ label, value, big, color }) {
  return (
    <div style={{ background: "#f9fafb", borderRadius: 10, padding: "10px 14px", border: "1px solid #eef2f7" }}>
      <div style={{ fontSize: 11, color: "#666" }}>{label}</div>
      <div style={{ fontSize: big ? 22 : 16, fontWeight: 800, color: color || "#111827" }}>{value}</div>
    </div>
  );
}

function OverflowPnLReport() {
  const [from, setFrom] = useState(getWorkingDate().slice(0, 7) + "-01");
  const [to, setTo]     = useState(getWorkingDate());
  const [d, setD]       = useState(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef();

  useEffect(() => {
    setLoading(true);
    api(`overflow?action=report&from=${from}&to=${to}`).then(setD).catch(() => {}).finally(() => setLoading(false));
  }, [from, to]);

  const collected = d?.collected || [];
  const open      = d?.open || [];
  const totalColl  = collected.reduce((s, r) => s + parseFloat(r.total_collected || 0), 0);
  const totalBill  = collected.reduce((s, r) => s + parseFloat(r.total_billed    || 0), 0);
  const totalVar   = collected.reduce((s, r) => s + parseFloat(r.total_variance  || 0), 0);
  const totalOpen  = open.reduce((s, r) => s + parseFloat(r.total_outstanding || 0), 0);

  const varStyle = (v) => {
    const n = parseFloat(v || 0);
    if (Math.abs(n) < 0.01) return { color: "#888" };
    return { color: n > 0 ? "#16a34a" : "#dc2626", fontWeight: 700 };
  };
  const varLabel = (v) => {
    const n = parseFloat(v || 0);
    if (Math.abs(n) < 0.01) return "—";
    return `${n > 0 ? "+" : ""}${fmt.currency(n)}`;
  };

  return (
    <div>
      <ReportBar from={from} setFrom={setFrom} to={to} setTo={setTo} onPrint={() => printReport(ref.current)}>
      </ReportBar>
      <div ref={ref} style={reportSheet}>
        <ReportTitle title="Overflow Vendor P&L" from={from} to={to} />
        {loading ? <div style={{ padding: 20, textAlign: "center", color: "#666" }}>Loading...</div> : (
        <>
          {/* Summary stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, margin: "14px 0" }}>
            <StatCard label="Total Collected (period)" value={fmt.currency(totalColl)} big />
            <StatCard label="Billed for settled bags" value={fmt.currency(totalBill)} />
            <StatCard label="Variance (profit/loss)" value={varLabel(totalVar)} color={totalVar > 0 ? "#16a34a" : totalVar < 0 ? "#dc2626" : "#888"} big />
            <StatCard label="Still Outstanding" value={fmt.currency(totalOpen)} color="#c2410c" />
          </div>

          {/* Collections by vendor */}
          {collected.length > 0 && (
            <>
              <div style={{ fontWeight: 700, fontSize: 14, marginTop: 20, marginBottom: 8 }}>Collections This Period</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  {["Vendor", "Collections", "Bags Settled", "Billed ₹", "Collected ₹", "Variance"].map((h, i) => (
                    <th key={h} style={{ ...rptH, textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {collected.map((r, i) => (
                    <tr key={i} style={{ background: i % 2 ? "#fafafa" : "white" }}>
                      <td style={{ ...rptTd, textAlign: "left", fontWeight: 600 }}>{r.party_name}{r.party_name_ta ? ` / ${r.party_name_ta}` : ""}</td>
                      <td style={rptTd}>{r.collection_events}</td>
                      <td style={rptTd}>{r.bills_with_collections} bill{r.bills_with_collections !== "1" ? "s" : ""}</td>
                      <td style={rptTd}>{fmt.currency(r.total_billed)}</td>
                      <td style={{ ...rptTd, fontWeight: 700 }}>{fmt.currency(r.total_collected)}</td>
                      <td style={{ ...rptTd, ...varStyle(r.total_variance) }}>{varLabel(r.total_variance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: "#eff6ff", fontWeight: 800, borderTop: "2px solid #2563eb" }}>
                    <td style={{ ...rptTd, textAlign: "left" }}>TOTAL</td>
                    <td style={rptTd}></td><td style={rptTd}></td>
                    <td style={{ ...rptTd, fontWeight: 800 }}>{fmt.currency(totalBill)}</td>
                    <td style={{ ...rptTd, fontWeight: 800, color: "#2563eb" }}>{fmt.currency(totalColl)}</td>
                    <td style={{ ...rptTd, ...varStyle(totalVar), fontSize: 14 }}>{varLabel(totalVar)}</td>
                  </tr>
                </tfoot>
              </table>
            </>
          )}

          {/* Open bills */}
          {open.length > 0 && (
            <>
              <div style={{ fontWeight: 700, fontSize: 14, marginTop: 24, marginBottom: 8 }}>Outstanding Bills (not yet fully collected)</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  {["Vendor", "Open Bills", "Total Billed ₹", "Still Owed ₹"].map((h, i) => (
                    <th key={h} style={{ ...rptH, textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {open.map((r, i) => (
                    <tr key={i} style={{ background: i % 2 ? "#fafafa" : "white" }}>
                      <td style={{ ...rptTd, textAlign: "left", fontWeight: 600, color: "#c2410c" }}>{r.party_name}</td>
                      <td style={rptTd}>{r.open_bills}</td>
                      <td style={rptTd}>{fmt.currency(r.total_billed_open)}</td>
                      <td style={{ ...rptTd, fontWeight: 700, color: "#dc2626" }}>{fmt.currency(r.total_outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: "#fff7ed", fontWeight: 800, borderTop: "2px solid #ea580c" }}>
                    <td style={{ ...rptTd, textAlign: "left" }}>TOTAL OUTSTANDING</td>
                    <td style={rptTd}></td><td style={rptTd}></td>
                    <td style={{ ...rptTd, fontWeight: 800, color: "#c2410c", fontSize: 14 }}>{fmt.currency(totalOpen)}</td>
                  </tr>
                </tfoot>
              </table>
            </>
          )}

          {collected.length === 0 && open.length === 0 && (
            <div style={{ padding: 30, textAlign: "center", color: "#888" }}>No overflow data found for this period</div>
          )}
        </>
        )}
      </div>
    </div>
  );
}

function PnLReport() {
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 7) + "-01");
  const [to,   setTo]   = useState(new Date().toISOString().split("T")[0]);
  const [group, setGroup] = useState("daily");
  const [data,  setData]  = useState(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    api(`reports?action=pnl&from=${from}&to=${to}&group=${group}`)
      .then(r => setData(r))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [from, to, group]);

  return (
    <div>
      <div style={{ background: "white", borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={labelStyle}>From</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputSm} />
          </div>
          <div>
            <label style={labelStyle}>To</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputSm} />
          </div>
          <div>
            <label style={labelStyle}>Group By</label>
            <select value={group} onChange={e => setGroup(e.target.value)} style={inputSm}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
        </div>
      </div>

      {data?.summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
          {[
            { label: "Gross Sales",   value: fmt.currency(data.summary.gross_sales),    color: "#2563eb" },
            { label: "Net Sales",     value: fmt.currency(data.summary.net_sales),       color: "#1a7a45" },
            { label: "Gross Profit",  value: fmt.currency(data.summary.gross_profit),    color: "#7c3aed" },
            { label: "Net Profit",    value: fmt.currency(data.summary.net_profit),      color: data.summary.net_profit >= 0 ? "#16a34a" : "#dc2626" },
          ].map((c, i) => (
            <div key={i} style={{ background: "white", borderRadius: 10, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
              <div style={{ fontSize: 12, color: "#666" }}>{c.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: c.color, marginTop: 4 }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: "white", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              {["Period", "Gross Sales ₹", "Net Sales ₹", "Gross Profit ₹", "Commission ₹", "Expenses ₹"].map(h => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: "center", color: "#666" }}>Loading...</td></tr>
            ) : (data?.data || []).map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#fafafa" }}>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontWeight: 600, fontSize: 13 }}>{row.period}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>{fmt.currency(row.gross_sales)}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>{fmt.currency(row.net_sales)}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 13, color: "#7c3aed", fontWeight: 600 }}>{fmt.currency(row.gross_profit)}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>{fmt.currency(row.commission)}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 13, color: "#dc2626" }}>{fmt.currency(row.expenses)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AgingReport() {
  const [data, setData] = useState([]);
  const [detail, setDetail] = useState([]);
  useEffect(() => {
    api("sales?action=aging").then(r => setData(r.data)).catch(() => {});
    api("parties?action=outstanding").then(r => setDetail(r.data)).catch(() => {});
  }, []);

  const colors = { "Current": "#16a34a", "1-15 Days": "#ca8a04", "16-30 Days": "#ea580c", "31-60 Days": "#dc2626", "Over 60 Days": "#7f1d1d" };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
        {data.map((row, i) => (
          <div key={i} style={{ background: "white", borderRadius: 10, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", borderTop: `3px solid ${colors[row.aging_bucket] || "#6b7280"}` }}>
            <div style={{ fontSize: 12, color: "#666", fontWeight: 600 }}>{row.aging_bucket}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: colors[row.aging_bucket] || "#111", marginTop: 4 }}>{fmt.currency(row.total_due)}</div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{row.bill_count} bills · {row.vendor_count} vendors</div>
          </div>
        ))}
      </div>

      <div style={{ background: "white", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <div style={{ padding: "14px 20px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>All Outstanding Bills</h3>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              {["Vendor", "Bill No", "Bill Date", "Due Date", "Amount ₹", "Balance ₹", "Days Overdue", "Bucket"].map(h => (
                <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {detail.map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#fafafa" }}>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{row.vendor_name}</div>
                  {row.phone1 && <div style={{ fontSize: 11, color: "#888" }}>📞 {row.phone1}</div>}
                </td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6", fontSize: 12, color: "#2563eb", fontWeight: 600 }}>{row.bill_no}</td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>{fmt.date(row.bill_date)}</td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>{fmt.date(row.due_date)}</td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>{fmt.currency(row.net_amount)}</td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6", fontWeight: 700, color: "#dc2626", fontSize: 13 }}>{fmt.currency(row.balance_due)}</td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6", fontSize: 12, color: row.days_overdue > 0 ? "#dc2626" : "#16a34a", fontWeight: 600 }}>
                  {row.days_overdue > 0 ? `${row.days_overdue} days` : "On time"}
                </td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6" }}>
                  <span style={{ background: colors[row.aging_bucket] + "20", color: colors[row.aging_bucket] || "#6b7280", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
                    {row.aging_bucket}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OutstandingReport() {
  const [from, setFrom] = useState(getWorkingDate());
  const [to, setTo]     = useState(getWorkingDate());
  const [rows, setRows] = useState([]);      // per vendor: day purchases, day payments, overall outstanding
  const [bills, setBills] = useState([]);    // per-bill detail (for expand)
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState("ALL");    // sales-party type filter
  const [cityFilter, setCityFilter] = useState("ALL");  // vendor city filter
  const [open, setOpen] = useState(null);    // expanded party_id
  const [tpl, setTpl] = useState(null);      // print template (for shop name in reminder)

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api(`reports?action=outstanding-day&from=${from}&to=${to}`),
      api("parties?action=outstanding"),
    ]).then(([t, d]) => { setRows(t.data || []); setBills(d.data || []); })
      .finally(() => setLoading(false));
  }, [from, to]);
  useEffect(() => { getPrintTemplate().then(setTpl).catch(() => {}); }, []);

  // Per-bill detail grouped by party (for the expandable view)
  const billsByParty = bills.reduce((acc, row) => {
    (acc[row.party_id] = acc[row.party_id] || []).push(row);
    return acc;
  }, {});

  // Build a WhatsApp payment reminder and open wa.me (click-to-send)
  const remind = (v) => {
    const digits = String(v.phone1 || "").replace(/\D/g, "");
    const phone = digits.length === 10 ? "91" + digits : (digits.length === 11 && digits[0] === "0" ? "91" + digits.slice(1) : digits);
    if (!phone || phone.length < 11) { alert("No valid phone number for this vendor.\nAdd one in Parties → edit the vendor, then try again."); return; }
    const det = [...(billsByParty[v.party_id] || [])].sort((a, b) => new Date(b.due_date || 0) - new Date(a.due_date || 0)).slice(0, 5);
    const company = tpl?.company_en || "SRI MURUGAN & Co.";
    const billLines = det.length
      ? det.map(b => `• ${b.bill_no}  (${fmt.date(b.due_date)})  ${fmt.currency(b.balance_due)}${b.days_overdue > 0 ? `  ⚠️${b.days_overdue}d` : ""}`).join("\n")
      : "—";
    const msg =
`${company}
Payment reminder / பணம் நினைவூட்டல்

Dear ${v.party_name},
வணக்கம். உங்கள் நிலுவைத் தொகை:

*Outstanding / நிலுவை: ${fmt.currency(v.balance_due)}*

Recent bills / சமீபத்திய பில்கள்:
${billLines}

Kindly clear the balance at your earliest convenience. Thank you.
தயவுசெய்து தொகையை விரைவில் செலுத்தவும். நன்றி.`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const CAT_LABEL = { CUSTOMER: "Customer", OVERFLOW: "Overflow Vendor", MARKET_VENDOR: "Market Vendor", MARKET_SUPPLIER: "Market Vendor", ORDER_SUPPLIER: "Order Party" };
  const ALL_CATS  = ["MARKET_VENDOR", "CUSTOMER", "OVERFLOW", "ORDER_SUPPLIER"];
  const cityOpts = [...new Set(rows.map(r => r.city_name).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  const s = q.trim().toLowerCase();
  const filtered = rows.filter(p =>
    (!s || (p.party_name || "").toLowerCase().includes(s) || (p.party_name_ta || "").includes(q.trim()))
    && (catFilter === "ALL" || p.cat_code === catFilter)
    && (cityFilter === "ALL" || (p.city_name || "") === cityFilter));

  const sum = (k) => filtered.reduce((n, p) => n + parseFloat(p[k] || 0), 0);
  const gTotal = sum("balance_due"), gPur = sum("purchases"), gPay = sum("payments");

  const csv = () => downloadCSV(`outstanding_${from}_${to}.csv`,
    [["Vendor", "Purchases (period)", "Payments (period, cash+discount)", "Overall Outstanding"],
     ...filtered.map(p => [p.party_name, p.purchases, p.payments, p.balance_due]),
     [], ["GRAND TOTAL", gPur, gPay, gTotal]]);

  const oneDay = from === to;
  return (
    <div>
      {/* Date range — defaults to the working day */}
      <div className="no-print" style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 14, flexWrap: "wrap" }}>
        <div><label style={labelStyle}>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputSm} /></div>
        <div><label style={labelStyle}>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputSm} /></div>
        <div>
          <label style={labelStyle}>Vendor type</label>
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={{ ...inputSm, width: "auto", minWidth: 150 }}>
            <option value="ALL">All sales parties</option>
            {ALL_CATS.map(c => <option key={c} value={c}>{CAT_LABEL[c] || c}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>City</label>
          <select value={cityFilter} onChange={e => setCityFilter(e.target.value)} style={{ ...inputSm, width: "auto", minWidth: 140 }}>
            <option value="ALL">All cities</option>
            {cityOpts.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {(catFilter !== "ALL" || cityFilter !== "ALL") && (
          <button onClick={() => { setCatFilter("ALL"); setCityFilter("ALL"); }} style={{ padding: "8px 12px", background: "#f3f4f6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#374151" }}>✕ Clear filters</button>
        )}
      </div>
      {/* Prominent grand total — total amount all vendors owe right now */}
      <div style={{ background: "#fef2f2", border: "2px solid #fecaca", borderRadius: 12, padding: "16px 20px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#b91c1c" }}>💸 Total Outstanding — vendors owe us</div>
          <div style={{ fontSize: 12, color: "#7f1d1d" }}>{filtered.length} vendor{filtered.length !== 1 ? "s" : ""} · overall balance · {oneDay ? `activity on ${fmt.date(from)}` : `activity ${fmt.date(from)} – ${fmt.date(to)}`}</div>
        </div>
        <div style={{ fontSize: 32, fontWeight: 800, color: "#dc2626" }}>{fmt.currency(gTotal)}</div>
      </div>
      <div className="no-print" style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Search vendor..." style={{ ...inputSm, maxWidth: 320 }} />
        <div style={{ flex: 1 }} />
        <button onClick={() => printReport(document.getElementById("outstanding-sheet"))} style={{ padding: "9px 16px", background: "#1a7a45", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>🖨️ Print</button>
        <button onClick={csv} style={{ padding: "9px 16px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, color: "#16a34a", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>⬇️ Export all (CSV)</button>
      </div>
      <div id="outstanding-sheet">
        {loading ? <div style={{ padding: 40, textAlign: "center" }}>Loading...</div> : (
        <table style={{ width: "100%", borderCollapse: "collapse", background: "white", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
          <thead><tr>{["Vendor", "Purchases ₹", "Payments ₹", "Overall Outstanding ₹"].map((h, i) => <th key={h} style={{ ...rptH, textAlign: i === 0 ? "left" : "right" }}>{h}</th>)}</tr></thead>
          <tbody>
            {filtered.length === 0 ? <tr><td colSpan={4} style={{ padding: 24, textAlign: "center", color: "#888" }}>{s ? "No matching vendors" : "No purchases, payments or outstanding in this period"}</td></tr> :
             filtered.map((p, i) => {
               const det = billsByParty[p.party_id] || [];
               const isOpen = String(open) === String(p.party_id);
               return (
                <Fragment key={i}>
                  <tr onClick={() => setOpen(isOpen ? null : p.party_id)} style={{ cursor: det.length ? "pointer" : "default" }}>
                    <td style={{ ...rptTd, textAlign: "left", fontWeight: 600 }}>
                      {det.length > 0 && <span style={{ color: "#9ca3af", marginRight: 6 }}>{isOpen ? "▾" : "▸"}</span>}
                      {p.party_name}{p.party_name_ta ? ` / ${p.party_name_ta}` : ""}
                      {p.phone1
                        ? <button className="no-print" onClick={e => { e.stopPropagation(); remind(p); }} title={`WhatsApp reminder to ${p.phone1}`}
                            style={{ marginLeft: 10, padding: "2px 9px", background: "#dcfce7", border: "1px solid #86efac", borderRadius: 14, color: "#15803d", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>📲 Remind</button>
                        : <span className="no-print" style={{ marginLeft: 10, fontSize: 11, color: "#cbd5e1" }} title="Add a phone number in Parties to enable reminders">no phone</span>}
                    </td>
                    <td style={rptTd}>{fmt.currency(p.purchases)}</td>
                    <td style={{ ...rptTd, color: "#16a34a" }}>{fmt.currency(p.payments)}</td>
                    <td style={{ ...rptTd, fontWeight: 700, color: "#dc2626" }}>{fmt.currency(p.balance_due)}</td>
                  </tr>
                  {isOpen && det.map((b, j) => (
                    <tr key={`${i}-${j}`} style={{ background: "#fafafa" }}>
                      <td style={{ ...rptTd, textAlign: "left", paddingLeft: 28, fontSize: 12, color: "#2563eb" }}>{b.bill_no}
                        <span style={{ color: b.days_overdue > 0 ? "#dc2626" : "#888", marginLeft: 8 }}>
                          {b.days_overdue > 0 ? `⚠️ ${b.days_overdue}d overdue` : `Due ${fmt.date(b.due_date)}`}
                        </span>
                      </td>
                      <td style={{ ...rptTd, fontSize: 12 }}></td>
                      <td style={{ ...rptTd, fontSize: 12 }}></td>
                      <td style={{ ...rptTd, fontSize: 12, color: "#dc2626" }}>{fmt.currency(b.balance_due)}</td>
                    </tr>
                  ))}
                </Fragment>
               );
             })}
            <tr style={{ background: "#fef2f2" }}>
              <td style={{ ...rptTd, textAlign: "left", fontWeight: 800 }}>GRAND TOTAL</td>
              <td style={{ ...rptTd, fontWeight: 800 }}>{fmt.currency(gPur)}</td>
              <td style={{ ...rptTd, fontWeight: 800, color: "#16a34a" }}>{fmt.currency(gPay)}</td>
              <td style={{ ...rptTd, fontWeight: 800, color: "#dc2626" }}>{fmt.currency(gTotal)}</td>
            </tr>
          </tbody>
        </table>
        )}
        <div style={{ fontSize: 11, color: "#888", marginTop: 8 }}>Purchases &amp; Payments are for the selected period; <b>Overall Outstanding</b> is each vendor's total balance to date (all bills − all payments). Click a row to see the unpaid bills.</div>
      </div>
    </div>
  );
}

// Market Outstanding — what WE owe market vendors on held (unsettled) market purchases,
// with each vendor's sales due netted off to show the net payable.
function MarketOutstandingReport() {
  const [upTo, setUpTo]     = useState(getWorkingDate());
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ]           = useState("");
  const [netFilter, setNetFilter] = useState("ALL"); // ALL | POS | NEG

  useEffect(() => {
    setLoading(true);
    api(`reports?action=market-outstanding&up_to=${upTo}`)
      .then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [upTo]);

  const rows = data?.data || [];
  const s = q.trim().toLowerCase();
  const filtered = rows.filter(r => {
    if (s && !(r.vendor_name || "").toLowerCase().includes(s) && !(r.vendor_name_ta || "").includes(q.trim())) return false;
    if (netFilter === "POS" && parseFloat(r.net_payable) < 0) return false;
    if (netFilter === "NEG" && parseFloat(r.net_payable) >= 0) return false;
    return true;
  });

  const sum = (k) => filtered.reduce((n, r) => n + parseFloat(r[k] || 0), 0);
  const gOwed = sum("purchases_owed"), gDue = sum("sales_due"), gNet = sum("net_payable");
  const gBills = filtered.reduce((n, r) => n + (parseInt(r.bill_count) || 0), 0);

  const csv = () => downloadCSV(`market_outstanding_upto_${upTo}.csv`,
    [["Vendor", "Bills", "Pending purchases ₹", "Their sales due ₹", "Net payable ₹"],
     ...filtered.map(r => [r.vendor_name, r.bill_count || 0, r.purchases_owed, r.sales_due, r.net_payable]),
     [], ["GRAND TOTAL", gBills, gOwed, gDue, gNet]]);

  const netBtnStyle = (val) => ({
    padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, border: "1px solid",
    background: netFilter === val ? (val === "NEG" ? "#dcfce7" : val === "POS" ? "#faf5ff" : "#f0f9ff") : "white",
    borderColor: netFilter === val ? (val === "NEG" ? "#16a34a" : val === "POS" ? "#7c3aed" : "#60a5fa") : "#d1d5db",
    color: netFilter === val ? (val === "NEG" ? "#15803d" : val === "POS" ? "#7c3aed" : "#1d4ed8") : "#6b7280",
  });

  return (
    <div>
      <div className="no-print" style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <label style={labelStyle}>Up to date</label>
          <input type="date" value={upTo} onChange={e => setUpTo(e.target.value)} style={{ ...inputSm, width: 150 }} />
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Search market vendor..." style={{ ...inputSm, maxWidth: 240 }} />
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <label style={{ ...labelStyle, display: "block", marginBottom: 2 }}>Net payable</label>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setNetFilter("ALL")} style={netBtnStyle("ALL")}>All</button>
            <button onClick={() => setNetFilter("POS")} style={netBtnStyle("POS")}>We owe (+)</button>
            <button onClick={() => setNetFilter("NEG")} style={netBtnStyle("NEG")}>They owe us (−)</button>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => printReport(document.getElementById("mkt-out-sheet"))} style={{ padding: "9px 16px", background: "#1a7a45", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>🖨️ Print</button>
        <button onClick={csv} style={{ padding: "9px 16px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, color: "#16a34a", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>⬇️ Export (CSV)</button>
      </div>

      <div style={{ background: "#faf5ff", border: "2px solid #e9d5ff", borderRadius: 12, padding: "16px 20px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#7c3aed" }}>🏪 Market Outstanding — we owe market vendors</div>
          <div style={{ fontSize: 12, color: "#6b21b6" }}>
            {filtered.length} vendor{filtered.length !== 1 ? "s" : ""} · {gBills} bill{gBills !== 1 ? "s" : ""} · unsettled up to {upTo}
            {netFilter !== "ALL" ? (netFilter === "POS" ? " · showing: we owe" : " · showing: they owe us") : ""}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 32, fontWeight: 800, color: "#7c3aed" }}>{fmt.currency(gOwed)}</div>
          <div style={{ fontSize: 12, color: "#6b21b6" }}>Net payable after netting their sales: <b>{fmt.currency(gNet)}</b></div>
        </div>
      </div>

      <div id="mkt-out-sheet">
        {loading ? <div style={{ padding: 40, textAlign: "center" }}>Loading...</div> : (
        <table style={{ width: "100%", borderCollapse: "collapse", background: "white", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
          <thead><tr>
            {["Market Vendor", "Bills", "Pending purchases ₹", "Their sales due ₹", "Net payable ₹"].map((h, i) => (
              <th key={h} style={{ ...rptH, textAlign: i < 2 ? "left" : "right" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {filtered.length === 0
              ? <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: "#888" }}>{rows.length ? "No matching vendors" : "No held market purchases — nothing outstanding"}</td></tr>
              : filtered.map((r, i) => (
                <tr key={i}>
                  <td style={{ ...rptTd, textAlign: "left", fontWeight: 600 }}>{r.vendor_name}{r.vendor_name_ta ? ` / ${r.vendor_name_ta}` : ""}</td>
                  <td style={{ ...rptTd, textAlign: "center", color: "#6b7280" }}>{r.bill_count || 0}</td>
                  <td style={{ ...rptTd, fontWeight: 700, color: "#7c3aed" }}>{fmt.currency(r.purchases_owed)}</td>
                  <td style={{ ...rptTd, color: "#16a34a" }}>{fmt.currency(r.sales_due)}</td>
                  <td style={{ ...rptTd, fontWeight: 700, color: parseFloat(r.net_payable) >= 0 ? "#7c3aed" : "#16a34a" }}>{fmt.currency(r.net_payable)}</td>
                </tr>
              ))}
            <tr style={{ background: "#faf5ff" }}>
              <td style={{ ...rptTd, textAlign: "left", fontWeight: 800 }}>GRAND TOTAL</td>
              <td style={{ ...rptTd, textAlign: "center", fontWeight: 800 }}>{gBills}</td>
              <td style={{ ...rptTd, fontWeight: 800, color: "#7c3aed" }}>{fmt.currency(gOwed)}</td>
              <td style={{ ...rptTd, fontWeight: 800, color: "#16a34a" }}>{fmt.currency(gDue)}</td>
              <td style={{ ...rptTd, fontWeight: 800, color: gNet >= 0 ? "#7c3aed" : "#16a34a" }}>{fmt.currency(gNet)}</td>
            </tr>
          </tbody>
        </table>
        )}
        <div style={{ fontSize: 11, color: "#888", marginTop: 8 }}><b>Pending purchases</b> = market buys held (not yet settled) up to the selected date. <b>Net payable</b> nets off each vendor's sales dues to us.</div>
      </div>
    </div>
  );
}

function ProductProfitReport() {
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 7) + "-01");
  const [to,   setTo]   = useState(new Date().toISOString().split("T")[0]);
  const [data, setData] = useState([]);
  useEffect(() => {
    api(`reports?action=product-profit&from=${from}&to=${to}`).then(r => setData(r.data)).catch(() => {});
  }, [from, to]);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <div><label style={labelStyle}>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputSm} /></div>
        <div><label style={labelStyle}>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputSm} /></div>
      </div>
      <div style={{ background: "white", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              {["Product", "Month", "KG Sold", "Gross Sales ₹", "Total Margin ₹", "Avg Sale Rate ₹", "Avg Buy Rate ₹"].map(h => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#fafafa" }}>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{row.name_en}</div>
                  <div style={{ fontSize: 11, color: "#888" }}>{row.name_ta}</div>
                </td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>{row.month}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>{row.total_kg_sold} kg</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>{fmt.currency(row.gross_sales)}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontWeight: 700, color: "#16a34a", fontSize: 13 }}>{fmt.currency(row.total_margin)}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>₹{row.avg_sale_rate}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>₹{row.avg_purchase_rate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TallyExport() {
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 7) + "-01");
  const [to,   setTo]   = useState(new Date().toISOString().split("T")[0]);

  const [busy, setBusy] = useState(false);
  const handleExport = async () => {
    setBusy(true);
    try {
      const token = sessionStorage.getItem("rsm_token");
      const res = await fetch(`/api/reports.php?action=tally-export&from=${from}&to=${to}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        let msg = `Export failed (${res.status})`;
        try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `tally_sales_${from}_${to}.xml`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ background: "white", borderRadius: 12, padding: 30, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", maxWidth: 500 }}>
      <h3 style={{ margin: "0 0 20px", fontSize: 16 }}>📤 Export to Tally</h3>
      <p style={{ color: "#666", fontSize: 13, margin: "0 0 20px" }}>
        Downloads a Tally-compatible XML file for the selected date range. Import this in Tally ERP 9 or Tally Prime under Gateway → Import Data.
      </p>
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <div><label style={labelStyle}>From Date</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputSm} /></div>
        <div><label style={labelStyle}>To Date</label><input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputSm} /></div>
      </div>
      <button onClick={handleExport} disabled={busy} style={{ padding: "12px 28px", background: busy ? "#9ca3af" : "#1a7a45", border: "none", borderRadius: 10, color: "white", fontSize: 15, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
        {busy ? "Preparing…" : "📤 Download Tally XML"}
      </button>
    </div>
  );
}

// ============================================================
// PARTIES PAGE
// ============================================================
export function PartiesPage() {
  const [tab, setTab]           = useState('purchase');
  const [parties, setParties]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [addType, setAddType]   = useState(null);
  const [showTrucks, setShowTrucks] = useState(false);
  const [showCities, setShowCities] = useState(false);

  const PURCHASE = ['FARMER','SUPPLIER','MARKET_SUPPLIER','MARKET_VENDOR'];
  const SALES    = ['CUSTOMER','OVERFLOW','MARKET_VENDOR','ORDER_SUPPLIER'];
  const PAGE = 100;
  const [total, setTotal]           = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [debounced, setDebounced]   = useState('');
  const [filterKey, setFilterKey]   = useState(null);            // active type-filter chip (null = all in tab)
  const [selected, setSelected]     = useState(() => new Set()); // bulk-selected party ids
  const [cats, setCats]             = useState([]);              // party_categories (for the re-type dropdown)
  const [bulkTarget, setBulkTarget] = useState('');
  const [applying, setApplying]     = useState(false);

  // Filter chips per tab. The "Supplier" chip covers both SUPPLIER and MARKET_SUPPLIER.
  const chipDefs = tab === 'purchase'
    ? [{k:'FARMER',l:'🌾 Farmer',c:'#1a7a45',codes:['FARMER']},{k:'SUPPLIER',l:'📦 Supplier',c:'#2563eb',codes:['SUPPLIER','MARKET_SUPPLIER']},{k:'MARKET_VENDOR',l:'🏪 Market Vendor',c:'#7c3aed',codes:['MARKET_VENDOR']}]
    : [{k:'CUSTOMER',l:'🛒 Customer',c:'#0284c7',codes:['CUSTOMER']},{k:'OVERFLOW',l:'🚚 Overflow',c:'#ea580c',codes:['OVERFLOW']},{k:'MARKET_VENDOR',l:'🏪 Market Vendor',c:'#7c3aed',codes:['MARKET_VENDOR']},{k:'ORDER_SUPPLIER',l:'📞 Order Supplier',c:'#db2777',codes:['ORDER_SUPPLIER']}];
  const ASSIGNABLE = ['FARMER','SUPPLIER','MARKET_SUPPLIER','MARKET_VENDOR','CUSTOMER','OVERFLOW','ORDER_SUPPLIER'];

  // Debounce typing so we query the server at most ~3×/sec while searching.
  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 300); return () => clearTimeout(t); }, [search]);

  // Server-side pagination: load 100 at a time, filtered by the active tab + search.
  const fetchPage = (offset, append) => {
    const catCodes = filterKey ? (chipDefs.find(c => c.k === filterKey)?.codes || []) : (tab === 'purchase' ? PURCHASE : SALES);
    const url = `parties?action=list&active=all&cats=${catCodes.join(',')}&limit=${PAGE}&offset=${offset}` +
      (debounced ? `&search=${encodeURIComponent(debounced)}` : '');
    (append ? setLoadingMore : setLoading)(true);
    // Use the warm copy prefetched at login for the default first view; fall
    // back to a live fetch for searches, pagination, or if it's missing/stale.
    const warm = (offset === 0 && !append && !debounced) ? takePrefetch(url) : null;
    return (warm ? warm.then(r => r || api(url)) : api(url))
      .then(r => {
        setParties(prev => append ? [...prev, ...(r.data || [])] : (r.data || []));
        if (typeof r.total === 'number') setTotal(r.total);
      })
      .catch(() => {})
      .finally(() => (append ? setLoadingMore : setLoading)(false));
  };
  const load = () => fetchPage(0, false);
  useEffect(() => { load(); }, [tab, debounced, filterKey]);
  // Switching Purchase/Sales resets the type filter; filter/search/tab changes clear the selection.
  useEffect(() => { setFilterKey(null); }, [tab]);
  useEffect(() => { setSelected(new Set()); }, [tab, filterKey, debounced]);
  // Category list for the "Change type to" dropdown (loaded once).
  useEffect(() => { api('parties?action=categories').then(r => setCats(r.data || [])).catch(() => {}); }, []);

  const handleDeactivate = async (p) => {
    const action = p.is_active == 1 ? 'deactivate' : 'save';
    const msg    = p.is_active == 1
      ? `Deactivate "${p.name_en}"? They will be hidden from dropdowns but their history is kept.`
      : `Reactivate "${p.name_en}"?`;
    if (!window.confirm(msg)) return;
    try {
      if (p.is_active == 1) {
        await api('parties?action=deactivate', { method:'POST', body:JSON.stringify({ id:p.id }) });
      } else {
        await api('parties?action=save', { method:'POST', body:JSON.stringify({ id:p.id, name_en:p.name_en, category_id:p.category_id, is_active:1, city:p.city||'' }) });
      }
      clearApiCache('parties');
      load();
    } catch(e) {
      alert(e.message);
    }
  };

  // ---- Bulk selection + re-type ----
  const toggleOne = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOnPageSelected = parties.length > 0 && parties.every(p => selected.has(p.id));
  const toggleAllOnPage = () => setSelected(prev => {
    const n = new Set(prev);
    if (allOnPageSelected) parties.forEach(p => n.delete(p.id));
    else parties.forEach(p => n.add(p.id));
    return n;
  });
  const applyBulk = async () => {
    if (!bulkTarget || selected.size === 0) return;
    const cat = cats.find(c => String(c.id) === String(bulkTarget));
    const label = cat ? (PT[cat.code]?.label || cat.name_en) : 'the chosen type';
    if (!window.confirm(`Change the type of ${selected.size} selected ${selected.size === 1 ? 'party' : 'parties'} to "${label}"?\n\nNames, balances and ledger history are kept — only the category changes.`)) return;
    setApplying(true);
    try {
      const r = await api('parties?action=set-category', { method:'POST', body: JSON.stringify({ ids: [...selected], category_id: Number(bulkTarget) }) });
      clearApiCache('parties');
      setSelected(new Set()); setBulkTarget('');
      load();
      alert(`Updated ${r.data?.updated ?? selected.size} ${(r.data?.updated ?? selected.size) === 1 ? 'party' : 'parties'} → ${label}.`);
    } catch (e) { alert(e.message); }
    finally { setApplying(false); }
  };

  const visible = parties;   // server already filtered by tab category + search

  const addBtns = tab === 'purchase'
    ? [{t:'FARMER',l:'🌾 Farmer',c:'#1a7a45'},{t:'SUPPLIER',l:'📦 Supplier',c:'#2563eb'},{t:'MARKET_VENDOR',l:'🏪 Market Vendor',c:'#7c3aed'}]
    : [{t:'CUSTOMER',l:'🛒 Customer',c:'#0284c7'},{t:'OVERFLOW',l:'🚚 Overflow',c:'#ea580c'},{t:'MARKET_VENDOR',l:'🏪 Market Vendor',c:'#7c3aed'},{t:'ORDER_SUPPLIER',l:'📞 Order Supplier',c:'#db2777'}];

  if (showForm) return <PartyForm initial={editing} partyType={addType||editing?.cat_code}
    onDone={() => { setShowForm(false); setEditing(null); setAddType(null); load(); }} />;

  return (
    <div style={{ padding:24 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <h1 style={{ margin:0, fontSize:22, fontWeight:700 }}>👥 Parties <span style={{ fontSize:13, color:'#666' }}>பார்ட்டிகள்</span></h1>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={()=>setShowCities(v=>!v)} style={{ padding:'8px 14px', background:showCities?'#7c3aed':'#f5f3ff', border:'1.5px solid #ddd6fe', borderRadius:8, color:showCities?'white':'#7c3aed', fontWeight:600, cursor:'pointer', fontSize:13 }}>🏙️ Cities</button>
          <button onClick={()=>setShowTrucks(v=>!v)} style={{ padding:'8px 14px', background:showTrucks?'#1d4ed8':'#eff6ff', border:'1.5px solid #bfdbfe', borderRadius:8, color:showTrucks?'white':'#1d4ed8', fontWeight:600, cursor:'pointer', fontSize:13 }}>🚛 Trucks</button>
        </div>
      </div>

      {showCities && <CitiesPanel />}
      {showTrucks && <TrucksPanel onChanged={load} />}

      {/* Purchase / Sales tab bar */}
      <div style={{ display:'flex', background:'#f3f4f6', borderRadius:10, padding:4, marginBottom:16, gap:4 }}>
        {[
          {id:'purchase', label:'🛒 Purchase Parties', sub:'Farmers · Suppliers · Market Vendors'},
          {id:'sales',    label:'💰 Sales Parties',    sub:'Customers · Overflow · Market Vendors · Order Suppliers'},
        ].map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)} style={{ flex:1, padding:'10px 16px', borderRadius:8, border:'none', cursor:'pointer', background:tab===t.id?'white':'transparent', boxShadow:tab===t.id?'0 1px 4px rgba(0,0,0,0.1)':'none' }}>
            <div style={{ fontWeight:700, fontSize:14, color:tab===t.id?'#111':'#6b7280' }}>{t.label}</div>
            <div style={{ fontSize:11, color:'#9ca3af', marginTop:2 }}>{t.sub}</div>
          </button>
        ))}
      </div>

      {/* Type filter chips + search */}
      <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap', alignItems:'center' }}>
        <span style={{ fontSize:12, color:'#6b7280', fontWeight:700 }}>Show:</span>
        <button onClick={()=>setFilterKey(null)}
          style={{ padding:'6px 14px', borderRadius:999, border:'1.5px solid '+(filterKey===null?'#111827':'#e5e7eb'), background:filterKey===null?'#111827':'white', color:filterKey===null?'white':'#374151', fontWeight:600, fontSize:13, cursor:'pointer' }}>All</button>
        {chipDefs.map(c=>(
          <button key={c.k} onClick={()=>setFilterKey(c.k)}
            style={{ padding:'6px 14px', borderRadius:999, border:'1.5px solid '+(filterKey===c.k?c.c:'#e5e7eb'), background:filterKey===c.k?c.c:'white', color:filterKey===c.k?'white':'#374151', fontWeight:600, fontSize:13, cursor:'pointer' }}>{c.l}</button>
        ))}
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:10 }}>
          {!loading && <span style={{ fontSize:12, color:'#9ca3af' }}>{visible.length} of {total}</span>}
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, phone…"
            style={{ ...inputSm, width:220 }} />
        </div>
      </div>

      {/* Add new party */}
      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
        <span style={{ fontSize:12, color:'#6b7280', fontWeight:700 }}>➕ Add new:</span>
        {addBtns.map(b=>(
          <button key={b.t} onClick={()=>{ setAddType(b.t); setShowForm(true); }}
            style={{ padding:'8px 16px', background:b.c, border:'none', borderRadius:8, color:'white', fontWeight:600, fontSize:13, cursor:'pointer' }}>
            {b.l}
          </button>
        ))}
      </div>

      {/* Bulk re-type bar — appears when rows are selected */}
      {selected.size > 0 && (
        <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap', marginBottom:14, padding:'12px 16px', background:'#eff6ff', border:'1.5px solid #bfdbfe', borderRadius:10 }}>
          <span style={{ fontWeight:700, fontSize:14, color:'#1d4ed8' }}>{selected.size} selected</span>
          <span style={{ fontSize:13, color:'#374151' }}>Change type to:</span>
          <select value={bulkTarget} onChange={e=>setBulkTarget(e.target.value)} style={{ ...inputSm, width:200 }}>
            <option value="">Choose type…</option>
            {cats.filter(c=>ASSIGNABLE.includes(c.code)).map(c=>(
              <option key={c.id} value={c.id}>{(PT[c.code]?.label)||c.name_en}</option>
            ))}
          </select>
          <button onClick={applyBulk} disabled={!bulkTarget || applying}
            style={{ padding:'8px 18px', background:(!bulkTarget||applying)?'#9ca3af':'#1d4ed8', border:'none', borderRadius:8, color:'white', fontWeight:700, fontSize:13, cursor:(!bulkTarget||applying)?'default':'pointer' }}>
            {applying?'Applying…':'Apply'}
          </button>
          <button onClick={()=>{ setSelected(new Set()); setBulkTarget(''); }}
            style={{ padding:'8px 14px', background:'white', border:'1px solid #d1d5db', borderRadius:8, color:'#374151', fontWeight:600, fontSize:13, cursor:'pointer' }}>
            Clear
          </button>
        </div>
      )}

      {/* Party list */}
      <div style={{ background:'white', borderRadius:12, overflow:'hidden', boxShadow:'0 1px 4px rgba(0,0,0,0.08)' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#f9fafb' }}>
              <th style={{ padding:'10px 14px', borderBottom:'1px solid #e5e7eb', width:36 }}>
                <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage}
                  title="Select all on this page" style={{ width:16, height:16, cursor:'pointer' }} />
              </th>
              {['Code','Name','Type','City','Phone','','',''].map((h,hi)=>(
                <th key={hi} style={{ padding:'10px 14px', textAlign:'left', fontSize:12, fontWeight:600, color:'#6b7280', borderBottom:'1px solid #e5e7eb' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: "8px 14px" }}><SkeletonRows rows={8} cols={5} /></td></tr>
            ) : visible.length===0 ? (
              <tr><td colSpan={9} style={{ padding:30, textAlign:'center', color:'#888' }}>
                No parties match — use the “➕ Add new” buttons above to add one.
              </td></tr>
            ) : visible.map((p,i)=>{
              const cfg = PT[p.cat_code]||{};
              const sel = selected.has(p.id);
              return (
                <tr key={p.id} style={{ background: sel ? '#eff6ff' : (i%2===0?'white':'#fafafa') }}>
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid #f3f4f6' }}>
                    <input type="checkbox" checked={sel} onChange={()=>toggleOne(p.id)} style={{ width:16, height:16, cursor:'pointer' }} />
                  </td>
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid #f3f4f6', fontSize:12, color:'#999', fontFamily:'monospace' }}>{p.code}</td>
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid #f3f4f6' }}>
                    <div style={{ fontWeight:600, fontSize:13 }}>{p.name_en}</div>
                    {p.name_ta && <div style={{ fontSize:11, color:'#888' }}>{p.name_ta}</div>}
                  </td>
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid #f3f4f6' }}>
                    <span style={{ background:cfg.bg||'#f3f4f6', color:cfg.color||'#374151', padding:'2px 8px', borderRadius:10, fontSize:11, fontWeight:600 }}>
                      {cfg.icon} {cfg.label||p.cat_name}
                    </span>
                  </td>
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid #f3f4f6', fontSize:12, color:'#666' }}>{p.city_name||p.city||'—'}</td>
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid #f3f4f6', fontSize:12 }}>{p.phone1||'—'}</td>
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid #f3f4f6', fontSize:11 }}>
                    {p.is_active==0 && <span style={{ background:'#fee2e2', color:'#dc2626', padding:'2px 6px', borderRadius:6, fontSize:10 }}>Inactive</span>}
                  </td>
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid #f3f4f6' }}>
                    <button onClick={()=>{ setEditing(p); setShowForm(true); }}
                      style={{ background:'#f3f4f6', border:'none', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontSize:12 }}>Edit</button>
                  </td>
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid #f3f4f6' }}>
                    <button onClick={()=>handleDeactivate(p)}
                      style={{ background: p.is_active==0 ? '#f0fdf4':'#fee2e2', border:'none', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontSize:12, color: p.is_active==0 ? '#16a34a':'#dc2626', fontWeight:500 }}>
                      {p.is_active==0 ? '↩ Reactivate' : '🗑 Delete'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && visible.length < total && (
          <div style={{ padding:14, textAlign:'center', borderTop:'1px solid #f3f4f6' }}>
            <button onClick={() => fetchPage(parties.length, true)} disabled={loadingMore}
              style={{ padding:'9px 22px', background: loadingMore ? '#9ca3af' : '#1a7a45', border:'none', borderRadius:8, color:'white', fontWeight:600, cursor:'pointer', fontSize:13 }}>
              {loadingMore ? 'Loading…' : `Load more (${total - visible.length} more)`}
            </button>
          </div>
        )}
      </div>

    </div>
  );
}

function MarketVendorTally() {
  const [data, setData]     = useState([]);
  const [loading, setLoading] = useState(true);
  const today = new Date();
  const dow   = today.getDay();
  const lastSun = new Date(today); lastSun.setDate(today.getDate() - dow);
  const from  = lastSun.toISOString().split('T')[0];
  const to    = today.toISOString().split('T')[0];
  const isSunday = dow === 0;

  useEffect(() => {
    api(`parties?action=vendor-tally&from=${from}&to=${to}`)
      .then(r => setData(r.data||[])).catch(()=>setData([])).finally(()=>setLoading(false));
  }, []);

  if (loading) return <div style={{ padding:20, textAlign:'center', color:'#666' }}>Loading tally…</div>;

  return (
    <div style={{ background:'white', borderRadius:12, padding:20, marginTop:12, boxShadow:'0 1px 4px rgba(0,0,0,0.08)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:15 }}>This Week's Balance</div>
          <div style={{ fontSize:12, color:'#666' }}>{from} → {to}</div>
        </div>
        {isSunday && <span style={{ background:'#fef9c3', color:'#92400e', padding:'4px 12px', borderRadius:8, fontSize:12, fontWeight:600 }}>📅 Sunday — Settlement Day</span>}
      </div>
      {data.length===0 ? (
        <div style={{ color:'#888', textAlign:'center', padding:20 }}>No market vendors yet. Add them via 🏪 Add Market Vendor.</div>
      ) : (
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'#f9fafb' }}>
              {['Market Vendor','We bought ₹','They bought ₹','Net Balance',''].map(h=>(
                <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:12, fontWeight:600, color:'#6b7280', borderBottom:'1px solid #e5e7eb' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((v,i)=>(
              <tr key={v.party_id} style={{ background:i%2===0?'white':'#fafafa' }}>
                <td style={{ padding:'10px 12px', borderBottom:'1px solid #f3f4f6' }}>
                  <div style={{ fontWeight:600, fontSize:13 }}>{v.name_en}</div>
                  {v.name_ta && <div style={{ fontSize:11, color:'#888' }}>{v.name_ta}</div>}
                </td>
                <td style={{ padding:'10px 12px', borderBottom:'1px solid #f3f4f6', fontSize:13, color:'#dc2626' }}>{fmt.currency(v.purchases)}</td>
                <td style={{ padding:'10px 12px', borderBottom:'1px solid #f3f4f6', fontSize:13, color:'#16a34a' }}>{fmt.currency(v.sales)}</td>
                <td style={{ padding:'10px 12px', borderBottom:'1px solid #f3f4f6', fontWeight:700, fontSize:14 }}>
                  <span style={{ color:v.net>=0?'#16a34a':'#dc2626' }}>
                    {v.net>=0?'↑ They owe ':'↓ We owe '}{fmt.currency(Math.abs(v.net))}
                  </span>
                </td>
                <td style={{ padding:'10px 12px', borderBottom:'1px solid #f3f4f6' }}>
                  {isSunday && (
                    <button onClick={()=>alert(`${v.name_en} — Net: ${v.net>=0?'They owe you':'You owe them'} ₹${Math.abs(v.net).toFixed(2)}\n\nFull settlement available in Tally module.`)}
                      style={{ padding:'5px 12px', background:'#7c3aed', border:'none', borderRadius:6, color:'white', fontSize:12, cursor:'pointer', fontWeight:600 }}>
                      Settle
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CitiesPanel() {
  const [cities, setCities] = useState([]);
  const [nameEn, setNameEn] = useState('');
  const [nameTa, setNameTa] = useState('');
  const [saving, setSaving] = useState(false);
  const timer = useRef(null);

  const load = () => api('parties?action=list-cities').then(r=>setCities(r.data||[])).catch(()=>{});
  useEffect(()=>{ load(); },[]);

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete city "${name}"?`)) return;
    await api('parties?action=delete-city', { method:'POST', body:JSON.stringify({ id }) }).catch(()=>{});
    load();
  };

  const handleEn = (val) => {
    setNameEn(val);
    clearTimeout(timer.current);
    if (!val.trim()) { setNameTa(''); return; }
    timer.current = setTimeout(async()=>{ const t=await googleTamil(val); if(t) setNameTa(t); }, 600);
  };

  const handleAdd = async () => {
    if (!nameEn.trim()) { alert('Enter city name'); return; }
    setSaving(true);
    try {
      await api('parties?action=add-city', { method:'POST', body:JSON.stringify({name_en:nameEn.trim(), name_ta:nameTa}) });
      setNameEn(''); setNameTa(''); load();
    } catch(e) { alert(e.message); } finally { setSaving(false); }
  };

  return (
    <div style={{ background:'#f5f3ff', borderRadius:12, padding:20, marginBottom:16, border:'2px solid #ddd6fe' }}>
      <h3 style={{ margin:'0 0 12px', fontSize:14, color:'#7c3aed' }}>🏙️ Cities / Towns</h3>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:12 }}>
        <input value={nameEn} onChange={e=>handleEn(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleAdd()}
          placeholder="City name (English)" style={{ ...inputSm, flex:1, minWidth:160 }} />
        <input value={nameTa} onChange={e=>setNameTa(e.target.value)} placeholder="Tamil (auto)" style={{ ...inputSm, flex:1, minWidth:130 }} />
        <button onClick={handleAdd} disabled={saving} style={{ padding:'8px 18px', background:saving?'#9ca3af':'#7c3aed', border:'none', borderRadius:8, color:'white', fontWeight:600, cursor:'pointer', fontSize:13 }}>
          {saving?'…':'+ Add'}
        </button>
      </div>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        {cities.length===0 ? <span style={{ color:'#9ca3af', fontSize:13 }}>No cities yet — add Chennai, Madurai, Erode…</span> :
          cities.map(c=>(
            <span key={c.id} style={{ display:'inline-flex', alignItems:'center', gap:6, background:'white', border:'1px solid #ddd6fe', borderRadius:20, padding:'4px 12px', fontSize:13, color:'#7c3aed' }}>
              🏙️ {c.name_en}{c.name_ta?` / ${c.name_ta}`:''}
              <button onClick={()=>handleDelete(c.id, c.name_en)} style={{ background:'none', border:'none', color:'#a78bfa', cursor:'pointer', fontSize:14, lineHeight:1, padding:0 }}>✕</button>
            </span>
          ))}
      </div>
    </div>
  );
}

function TrucksPanel({ onChanged }) {
  const [trucks, setTrucks] = useState([]);
  const [nameEn, setNameEn] = useState('');
  const [nameTa, setNameTa] = useState('');
  const [saving, setSaving] = useState(false);
  const [mapTruck, setMapTruck] = useState(null);   // truck being mapped to farmers
  const timer = useRef(null);

  const load = () => api('parties?action=list&category=TRUCK').then(r=>setTrucks(r.data||[])).catch(()=>{});
  useEffect(()=>{ load(); },[]);

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete truck "${name}"? This will also remove its farmer assignments.`)) return;
    await api('parties?action=delete-truck', { method:'POST', body:JSON.stringify({ id }) }).catch(()=>{});
    clearApiCache('parties');
    load(); onChanged?.();
  };

  const handleEn = (val) => {
    setNameEn(val);
    clearTimeout(timer.current);
    if (!val.trim()) { setNameTa(''); return; }
    timer.current = setTimeout(async()=>{ const t=await googleTamil(val); if(t) setNameTa(t); }, 600);
  };

  const handleAdd = async () => {
    if (!nameEn.trim()) { alert('Enter truck name'); return; }
    setSaving(true);
    try {
      const r = await api('parties?action=add-truck', { method:'POST', body:JSON.stringify({name_en:nameEn.trim(), name_ta:nameTa}) });
      const newTruck = { id: r.data.id, name_en: nameEn.trim(), name_ta: nameTa };
      clearApiCache('parties');
      setNameEn(''); setNameTa(''); load(); onChanged?.();
      // Offer to map farmers to the truck right away
      if (window.confirm(`Truck "${newTruck.name_en}" created. Map farmers to it now?`)) setMapTruck(newTruck);
    } catch(e) { alert(e.message); } finally { setSaving(false); }
  };

  return (
    <div style={{ background:'#eff6ff', borderRadius:12, padding:20, marginBottom:16, border:'2px solid #bfdbfe' }}>
      <h3 style={{ margin:'0 0 12px', fontSize:14, color:'#1d4ed8' }}>🚛 Trucks / References</h3>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:12 }}>
        <input value={nameEn} onChange={e=>handleEn(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleAdd()}
          placeholder="Truck name (e.g. Rasu)" style={{ ...inputSm, flex:1, minWidth:160 }} />
        <input value={nameTa} onChange={e=>setNameTa(e.target.value)} placeholder="Tamil (auto)" style={{ ...inputSm, flex:1, minWidth:130 }} />
        <button onClick={handleAdd} disabled={saving} style={{ padding:'8px 18px', background:saving?'#9ca3af':'#1d4ed8', border:'none', borderRadius:8, color:'white', fontWeight:600, cursor:'pointer', fontSize:13 }}>
          {saving?'…':'+ Add'}
        </button>
      </div>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        {trucks.length===0 ? <span style={{ color:'#9ca3af', fontSize:13 }}>No trucks yet</span> :
          trucks.map(t=>(
            <span key={t.id} style={{ display:'inline-flex', alignItems:'center', gap:6, background:'white', border:'1px solid #bfdbfe', borderRadius:20, padding:'4px 8px 4px 12px', fontSize:13, color:'#1d4ed8' }}>
              🚛 {t.name_en}{t.name_ta?` / ${t.name_ta}`:''}
              <button onClick={()=>setMapTruck(t)} title="Map farmers" style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:14, color:'#1d4ed8', cursor:'pointer', fontSize:11, fontWeight:600, padding:'2px 8px' }}>👥 Map</button>
              <button onClick={()=>handleDelete(t.id, t.name_en)} style={{ background:'none', border:'none', color:'#93c5fd', cursor:'pointer', fontSize:14, lineHeight:1, padding:0 }}>✕</button>
            </span>
          ))}
      </div>
      {mapTruck && <TruckFarmersModal truck={mapTruck} onClose={()=>setMapTruck(null)} onSaved={()=>{ setMapTruck(null); onChanged?.(); }} />}
    </div>
  );
}

// Bulk-assign farmers to a truck — search, multi-select (persists across searches), save
function TruckFarmersModal({ truck, onClose, onSaved }) {
  const [farmers, setFarmers] = useState([]);
  const [sel, setSel] = useState(() => new Set());
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      apiCached('parties?action=list&category=FARMER&active=all&cols=lite'),
      api(`parties?action=get-truck-farmers&id=${truck.id}`),
    ]).then(([all, linked]) => {
      setFarmers(all.data || []);
      setSel(new Set((linked.data || []).map(f => f.id)));
    }).finally(() => setLoading(false));
  }, [truck.id]);

  const s = q.trim().toLowerCase();
  const filtered = s
    ? farmers.filter(f => (f.name_en||'').toLowerCase().includes(s) || (f.name_ta||'').includes(q.trim()) || (f.city||'').toLowerCase().includes(s) || (f.code||'').toLowerCase().includes(s))
    : farmers;
  const CAP = 400;
  const shown = filtered.slice(0, CAP);

  const toggle = (id) => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAllFiltered = () => setSel(prev => { const n = new Set(prev); filtered.forEach(f => n.add(f.id)); return n; });
  const clearFiltered     = () => setSel(prev => { const n = new Set(prev); filtered.forEach(f => n.delete(f.id)); return n; });

  const save = async () => {
    setSaving(true);
    try {
      const r = await api('parties?action=set-truck-farmers', { method:'POST', body: JSON.stringify({ truck_id: truck.id, farmer_ids: [...sel] }) });
      clearApiCache('parties');
      alert(`✅ ${r.data.linked} farmer${r.data.linked!==1?'s':''} mapped to ${truck.name_en}`);
      onSaved();
    } catch (e) { alert(e.message); } finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'white', borderRadius:12, padding:20, width:560, maxWidth:'94vw', maxHeight:'88vh', display:'flex', flexDirection:'column', boxShadow:'0 10px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ fontSize:16, fontWeight:700, marginBottom:4 }}>🚛 Map farmers to {truck.name_en}</div>
        <div style={{ fontSize:12, color:'#666', marginBottom:12 }}>Search and tick farmers. Your selection is kept as you search. Saving replaces this truck's farmer list.</div>

        <div style={{ display:'flex', gap:8, marginBottom:10, flexWrap:'wrap', alignItems:'center' }}>
          <input value={q} onChange={e=>setQ(e.target.value)} autoFocus placeholder="🔍 Search farmer name / city / code..." style={{ ...inputSm, flex:1, minWidth:200 }} />
          <button onClick={selectAllFiltered} style={{ padding:'7px 12px', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, color:'#1d4ed8', fontWeight:600, cursor:'pointer', fontSize:12 }}>Select all{s?` (${filtered.length})`:''}</button>
          <button onClick={clearFiltered} style={{ padding:'7px 12px', background:'#f3f4f6', border:'none', borderRadius:8, cursor:'pointer', fontSize:12 }}>Clear{s?' shown':''}</button>
        </div>

        <div style={{ flex:1, overflowY:'auto', border:'1px solid #eef2f7', borderRadius:8 }}>
          {loading ? <div style={{ padding:24, textAlign:'center', color:'#888' }}>Loading {farmers.length||''} farmers…</div> :
           shown.length===0 ? <div style={{ padding:24, textAlign:'center', color:'#888' }}>No matching farmers</div> :
           shown.map(f => {
             const on = sel.has(f.id);
             return (
               <label key={f.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 12px', borderBottom:'1px solid #f3f4f6', cursor:'pointer', background:on?'#f0fdf4':'white' }}>
                 <input type="checkbox" checked={on} onChange={()=>toggle(f.id)} />
                 <span style={{ flex:1, fontSize:13 }}>{f.name_en}{f.name_ta?<span style={{ color:'#1a7a45', marginLeft:6 }}>{f.name_ta}</span>:null}</span>
                 {f.city && <span style={{ fontSize:11, color:'#888' }}>📍 {f.city}</span>}
               </label>
             );
           })}
          {!loading && filtered.length > CAP && <div style={{ padding:10, textAlign:'center', fontSize:12, color:'#888' }}>Showing first {CAP} of {filtered.length} — refine your search to see the rest (already-ticked ones stay selected).</div>}
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:14 }}>
          <div style={{ fontSize:13, fontWeight:700, color:'#1d4ed8' }}>{sel.size} farmer{sel.size!==1?'s':''} selected</div>
          <div style={{ flex:1 }} />
          <button onClick={onClose} style={{ padding:'9px 16px', background:'white', border:'1px solid #d1d5db', borderRadius:8, cursor:'pointer', fontSize:14 }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ padding:'9px 22px', background:saving?'#9ca3af':'#1d4ed8', border:'none', borderRadius:8, color:'white', fontWeight:700, cursor:'pointer', fontSize:14 }}>{saving?'Saving…':'Save mapping'}</button>
        </div>
      </div>
    </div>
  );
}

function PartyForm({ initial, partyType, onDone }) {
  const type = partyType || initial?.cat_code || 'FARMER';
  const cfg  = PT[type] || PT.FARMER;

  const [form, setForm] = useState({
    name_en:          initial?.name_en || '',
    name_ta:          initial?.name_ta || '',
    phone1:           initial?.phone1 || '',
    city_id:          initial?.city_id ? String(initial.city_id) : '',
    area:             initial?.area || '',
    credit_days:      initial?.credit_days ?? 14,
    commission_pct:   initial?.commission_pct ?? 10,
    opening_balance:  initial?.opening_balance ?? 0,
    opening_bal_type: initial?.opening_bal_type || 'dr',
    is_active:        initial?.is_active ?? 1,
    notes:            initial?.notes || '',
  });
  const [trucks, setTrucks]       = useState([]);
  const [cities, setCities]       = useState([]);
  const [selTrucks, setSelTrucks] = useState([]);
  const [categoryId, setCategoryId] = useState(initial?.category_id || null);
  const [translating, setTranslating] = useState(false);
  const [saving, setSaving]       = useState(false);
  const timerRef = useRef(null);

  const showCity   = ['FARMER','SUPPLIER','MARKET_SUPPLIER','MARKET_VENDOR','OVERFLOW','CUSTOMER','ORDER_SUPPLIER'].includes(type);
  const showTrucks = type === 'FARMER';
  const showComm   = ['FARMER','SUPPLIER','MARKET_SUPPLIER'].includes(type);
  const showCredit = ['CUSTOMER','MARKET_VENDOR','ORDER_SUPPLIER'].includes(type);
  const showTamil  = type !== 'CUSTOMER';

  useEffect(()=>{
    // Always resolve category_id from the categories list
    api('parties?action=categories').then(r=>{
      const cat = r.data.find(c => c.code === type);
      if (cat) setCategoryId(cat.id);
    }).catch(()=>{});

    if (showCity)   api('parties?action=list-cities').then(r=>setCities(r.data||[])).catch(()=>{});
    if (showTrucks) api('parties?action=list&category=TRUCK').then(r=>setTrucks(r.data||[])).catch(()=>{});
    if (initial?.id && showTrucks) {
      api(`parties?action=get-trucks&id=${initial.id}`).then(r=>setSelTrucks(r.data.map(t=>String(t.id)))).catch(()=>{});
    }
  },[]);

  const handleNameChange = (val) => {
    setForm(p=>({...p, name_en:val}));
    if (!showTamil) return;
    clearTimeout(timerRef.current);
    if (!val.trim()) { setForm(p=>({...p, name_ta:''})); return; }
    timerRef.current = setTimeout(async()=>{
      setTranslating(true);
      const ta = await googleTamil(val);
      if (ta) setForm(p=>({...p, name_ta:ta}));
      setTranslating(false);
    }, 500);
  };

  const handleSave = async () => {
    if (!form.name_en.trim()) { alert('Name is required'); return; }
    if (!categoryId) { alert('Category not loaded yet — please wait a moment and try again'); return; }
    setSaving(true);
    try {
      await api('parties?action=save', { method:'POST', body:JSON.stringify({
        ...form,
        id:          initial?.id,
        category_id: categoryId,
        truck_ids:   showTrucks ? selTrucks.map(Number) : undefined,
      })});
      clearApiCache('parties');
      onDone();
    } catch(e) { alert(e.message); } finally { setSaving(false); }
  };

  const lbl = { display:'block', fontSize:11, fontWeight:600, color:'#6b7280', marginBottom:4, textTransform:'uppercase' };

  return (
    <div style={{ padding:24 }}>
      <button onClick={onDone} style={{ background:'none', border:'none', color:cfg.color, cursor:'pointer', fontSize:13, marginBottom:12 }}>← Back</button>
      <h1 style={{ margin:'0 0 20px', fontSize:20, fontWeight:700 }}>
        {cfg.icon} {initial?'Edit':'Add'} {cfg.label}
        <span style={{ fontSize:13, color:'#888', marginLeft:8, fontWeight:400 }}>{cfg.labelTa}</span>
      </h1>

      <div style={{ background:'white', borderRadius:12, padding:24, boxShadow:'0 1px 4px rgba(0,0,0,0.08)' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16 }}>

          <div>
            <label style={lbl}>{type==='CUSTOMER'?'Name / Initials *':type==='OVERFLOW'?'Vendor Name *':'Name *'}</label>
            <input value={form.name_en} onChange={e=>handleNameChange(e.target.value)} style={inputSm}
              placeholder={type==='CUSTOMER'?'e.g. SM, AK, TM':type==='OVERFLOW'?'e.g. Erode Market':'Full name in English'} />
          </div>

          {showTamil && (
            <div>
              <label style={lbl}>Tamil Name {translating&&<span style={{ color:'#9ca3af', fontWeight:400, textTransform:'none', fontSize:10 }}> via Google…</span>}</label>
              <input value={form.name_ta||''} onChange={e=>setForm(p=>({...p,name_ta:e.target.value}))}
                placeholder="Auto-filled via Google Input Tools" style={inputSm} />
            </div>
          )}

          <div>
            <label style={lbl}>Phone</label>
            <input type="tel" value={form.phone1||''} onChange={e=>setForm(p=>({...p,phone1:e.target.value}))} style={inputSm} />
          </div>

          {showCity && (
            <div>
              <label style={lbl}>City / Town <span style={{ color:'#9ca3af', fontWeight:400, textTransform:'none' }}>(optional)</span></label>
              <select value={form.city_id||''} onChange={e=>setForm(p=>({...p,city_id:e.target.value}))} style={inputSm}>
                <option value=''>— No city —</option>
                {cities.map(c=><option key={c.id} value={String(c.id)}>{c.name_en}{c.name_ta?` / ${c.name_ta}`:''}</option>)}
              </select>
              {cities.length===0&&<div style={{ fontSize:10, color:'#7c3aed', marginTop:3 }}>Add cities via 🏙️ Cities first</div>}
            </div>
          )}

          {showComm && (
            <div>
              <label style={lbl}>Commission %</label>
              <input type="number" step="0.5" value={form.commission_pct??10} onChange={e=>setForm(p=>({...p,commission_pct:e.target.value}))} style={inputSm} />
            </div>
          )}

          {showCredit && (
            <div>
              <label style={lbl}>Credit Days</label>
              <input type="number" value={form.credit_days??14} onChange={e=>setForm(p=>({...p,credit_days:e.target.value}))} style={inputSm} />
            </div>
          )}

          <div>
            <label style={lbl}>Opening Balance ₹</label>
            <input type="number" value={form.opening_balance||''} placeholder="0"
              onChange={e=>setForm(p=>({...p,opening_balance:e.target.value}))}
              style={{ ...inputSm, borderColor:'#fbbf24', background:'#fffbeb' }} />
          </div>

          <div>
            <label style={lbl}>Balance Type</label>
            <div style={{ display:'flex', gap:8, marginTop:4 }}>
              {[{v:'cr',l:'We owe them',c:'#16a34a'},{v:'dr',l:'They owe us',c:'#dc2626'}].map(o=>(
                <button key={o.v} type="button" onClick={()=>setForm(p=>({...p,opening_bal_type:o.v}))}
                  style={{ flex:1, padding:'8px 4px', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:600,
                           border:form.opening_bal_type===o.v?`2px solid ${o.c}`:'1px solid #d1d5db',
                           background:form.opening_bal_type===o.v?o.c+'18':'white', color:o.c }}>
                  {o.l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={lbl}>Status</label>
            <select value={form.is_active} onChange={e=>setForm(p=>({...p,is_active:e.target.value}))} style={inputSm}>
              <option value={1}>Active</option>
              <option value={0}>Inactive</option>
            </select>
          </div>

          {showTrucks && (
            <div style={{ gridColumn:'span 3' }}>
              <label style={lbl}>Assigned Trucks</label>
              {trucks.length===0 ? (
                <div style={{ fontSize:12, color:'#888', marginTop:4 }}>No trucks yet — add them via 🚛 Trucks in the Parties page</div>
              ) : (
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:6 }}>
                  {trucks.map(t=>{
                    const on = selTrucks.includes(String(t.id));
                    return (
                      <label key={t.id} style={{ display:'flex', alignItems:'center', gap:6, background:on?'#eff6ff':'#f9fafb', border:`1px solid ${on?'#bfdbfe':'#d1d5db'}`, borderRadius:8, padding:'6px 12px', cursor:'pointer', fontSize:13, fontWeight:on?600:400, userSelect:'none' }}>
                        <input type="checkbox" checked={on} onChange={e=>setSelTrucks(prev=>e.target.checked?[...prev,String(t.id)]:prev.filter(id=>id!==String(t.id)))} />
                        🚛 {t.name_en}{t.name_ta?` / ${t.name_ta}`:''}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display:'flex', gap:10, marginTop:20 }}>
          <button onClick={handleSave} disabled={saving}
            style={{ padding:'10px 24px', background:saving?'#9ca3af':cfg.color, border:'none', borderRadius:8, color:'white', fontSize:14, fontWeight:600, cursor:'pointer' }}>
            {saving?'Saving…':`Save ${cfg.label}`}
          </button>
          <button onClick={onDone} style={{ padding:'10px 24px', background:'#f3f4f6', border:'none', borderRadius:8, fontSize:14, cursor:'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// EXPENSES PAGE
// ============================================================
// Standard petty-cash / running expense categories (ids match the seeded expense_categories table).
// Shared by the Expenses page and the Day Book quick-entry modal so both always show the same list.
export const EXPENSE_CATEGORIES = [
  { id: 1, name_en: "Labour / Cooly" }, { id: 2, name_en: "Lorry Rent" },
  { id: 3, name_en: "Commission" }, { id: 4, name_en: "Bag Charges" },
  { id: 5, name_en: "Market Tax" }, { id: 6, name_en: "Shop Rent" },
  { id: 7, name_en: "Tea / Coffee" }, { id: 8, name_en: "Advance" },
  { id: 9, name_en: "Staff Salary" }, { id: 10, name_en: "Electricity" },
  { id: 11, name_en: "Petty Cash" },
];

export function ExpensesPage() {
  const [from, setFrom] = useState(new Date().toISOString().split("T")[0]);
  const [to,   setTo]   = useState(new Date().toISOString().split("T")[0]);
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ expense_date: new Date().toISOString().split("T")[0], category_id: "", description: "", amount: "", payment_mode: "cash", notes: "" });
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = () => {
    api(`reports?action=expenses&from=${from}&to=${to}`).then(r => setData(r)).catch(() => {});
  };

  useEffect(() => { load(); }, [from, to]);

  const handleSave = async () => {
    if (!form.category_id || !form.amount || !form.description) { alert("Fill all required fields"); return; }
    setSaving(true);
    try {
      await api("reports?action=add-expense", { method: "POST", body: JSON.stringify(form) });
      setForm(p => ({ ...p, description: "", amount: "", notes: "" }));
      setShowForm(false);
      load();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>📋 Expenses <span style={{ fontSize: 13, color: "#666" }}>செலவுகள்</span></h1>
        <button onClick={() => setShowForm(!showForm)} style={{ padding: "9px 20px", background: "#dc2626", border: "none", borderRadius: 8, color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          {showForm ? "✕ Close" : "+ Add Expense"}
        </button>
      </div>

      {showForm && (
        <div style={{ background: "white", borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 14 }}>Add Expense</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <div><label style={labelStyle}>Date</label><input type="date" value={form.expense_date} onChange={e => setForm(p => ({ ...p, expense_date: e.target.value }))} style={inputSm} /></div>
            <div>
              <label style={labelStyle}>Category *</label>
              <select value={form.category_id} onChange={e => setForm(p => ({ ...p, category_id: e.target.value }))} style={inputSm}>
                <option value="">-- Select --</option>
                {EXPENSE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name_en}</option>)}
              </select>
            </div>
            <div><label style={labelStyle}>Description *</label><input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="What was this expense for?" style={inputSm} /></div>
            <div><label style={labelStyle}>Amount ₹ *</label><input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} style={inputSm} /></div>
            <div>
              <label style={labelStyle}>Payment Mode</label>
              <select value={form.payment_mode} onChange={e => setForm(p => ({ ...p, payment_mode: e.target.value }))} style={inputSm}>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
                <option value="upi">UPI</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button onClick={handleSave} disabled={saving} style={{ padding: "9px 24px", background: saving ? "#9ca3af" : "#dc2626", border: "none", borderRadius: 8, color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{saving ? "Saving..." : "Save Expense"}</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <div><label style={labelStyle}>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputSm} /></div>
        <div><label style={labelStyle}>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputSm} /></div>
      </div>

      {/* Category summary */}
      {data?.summary?.length > 0 && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          {data.summary.map((s, i) => (
            <div key={i} style={{ background: "white", borderRadius: 8, padding: "10px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
              <div style={{ fontSize: 11, color: "#666" }}>{s.category}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#dc2626" }}>{fmt.currency(s.total)}</div>
              <div style={{ fontSize: 10, color: "#888" }}>{s.entries} entries</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: "white", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              {["Date", "Category", "Description", "Amount ₹", "Mode", "By"].map(h => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.detail || []).map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#fafafa" }}>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>{fmt.date(row.expense_date)}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6" }}>
                  <span style={{ background: "#fef2f2", color: "#dc2626", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{row.category}</span>
                </td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>{row.description}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontWeight: 700, color: "#dc2626", fontSize: 13 }}>{fmt.currency(row.amount)}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 11 }}>{row.payment_mode?.toUpperCase()}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 11, color: "#888" }}>{row.created_by_name}</td>
              </tr>
            ))}
            {(!data?.detail || data.detail.length === 0) && (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: "center", color: "#666" }}>No expenses for this period</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// PAYMENTS PAGE — split screen: owe farmers (left) | receive from vendors (right)
// ============================================================
export function PaymentsPage() {
  const [farmerBills, setFarmerBills] = useState([]);
  const [vendorOut, setVendorOut]     = useState([]);
  const [loading, setLoading]         = useState(true);
  const [payingBill, setPayingBill]   = useState(null);
  const [payMode, setPayMode]         = useState("cash");
  const [payRef, setPayRef]           = useState("");
  const [vendorPayForm, setVendorPayForm] = useState(null);
  const [vendorPayMode, setVendorPayMode] = useState("cash");
  const [vendorPayRef, setVendorPayRef]   = useState("");
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState("pending");   // pending | history | adjust
  const [farmerSearch, setFarmerSearch] = useState("");
  const [vendorSearch, setVendorSearch] = useState("");
  const [peek, setPeek] = useState(null);   // { id } — purchase bill to preview
  const [allVendors, setAllVendors] = useState([]);
  const [adjForm, setAdjForm] = useState({ party_id: "", amount: "", kind: "discount", note: "" });
  const [adjList, setAdjList] = useState([]);
  const [adjLoading, setAdjLoading] = useState(false);

  const loadAdjustments = () => {
    setAdjLoading(true);
    api("sales?action=adjustments-list")
      .then(r => setAdjList(r.data || []))
      .catch(() => setAdjList([]))
      .finally(() => setAdjLoading(false));
  };
  useEffect(() => { if (view === "adjust") loadAdjustments(); }, [view]);

  const load = () => {
    setLoading(true);
    Promise.all([
      api("purchase?action=farmer-outstanding"),
      api("parties?action=outstanding"),
    ]).then(([f, v]) => { setFarmerBills(f.data || []); setVendorOut(v.data || []); }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // All vendors (for discounts/adjustments — not limited to those with outstanding)
  useEffect(() => {
    Promise.all([
      apiCached("parties?action=list&category=CUSTOMER&cols=lite"),
      apiCached("parties?action=list&category=OVERFLOW&cols=lite"),
      apiCached("parties?action=list&category=MARKET_VENDOR&cols=lite"),
    ]).then(([a, b, c]) => {
      const seen = new Set();
      setAllVendors([...(a.data||[]), ...(b.data||[]), ...(c.data||[])].filter(v => !seen.has(v.id) && seen.add(v.id)));
    }).catch(() => {});
  }, []);

  const saveAdjust = async () => {
    const amt = parseFloat(adjForm.amount) || 0;
    if (!adjForm.party_id || amt <= 0) { alert("Pick a vendor and enter an amount"); return; }
    setSaving(true);
    try {
      const r = await api("sales?action=adjust", { method: "POST", body: JSON.stringify({
        party_id: adjForm.party_id, amount: amt, kind: adjForm.kind, note: adjForm.note || null,
        date: new Date().toISOString().split("T")[0] }) });
      alert(`✅ ${adjForm.kind === "adjustment" ? "Adjustment" : "Discount"} of ${fmt.currency(amt)} recorded · applied ${fmt.currency(r.data.applied)}`);
      setAdjForm({ party_id: "", amount: "", kind: adjForm.kind, note: "" });
      load();
      loadAdjustments();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const delAdjustment = async (entry) => {
    const kind = entry.txn_type === "ADJUSTMENT" ? "adjustment" : "discount";
    if (!window.confirm(`Delete this ${kind} of ${fmt.currency(entry.amount)} for ${entry.party_name}?\n\nThe amount will be added back to the vendor's outstanding.`)) return;
    setSaving(true);
    try {
      const r = await api("sales?action=delete-adjustment", { method: "POST", body: JSON.stringify({ ledger_id: entry.id }) });
      alert(`🗑️ ${kind === "adjustment" ? "Adjustment" : "Discount"} deleted · ${fmt.currency(r.data.restored)} added back to outstanding`);
      load();
      loadAdjustments();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const payFarmer = async (bill) => {
    setSaving(true);
    try {
      await api("purchase?action=pay-farmer", { method: "POST", body: JSON.stringify({ bill_id: bill.id, amount: bill.net_payable, payment_mode: payMode, payment_ref: payRef || null }) });
      setPayingBill(null); setPayRef("");
      load();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const collectVendor = async () => {
    const amt = parseFloat(vendorPayForm?.amount) || 0;
    const disc = parseFloat(vendorPayForm?.discount) || 0;
    if (!vendorPayForm?.party_id || (amt <= 0 && disc <= 0)) { alert("Enter a collected amount and/or discount"); return; }
    setSaving(true);
    try {
      const result = await api("sales?action=payment", { method: "POST", body: JSON.stringify({ ...vendorPayForm, amount: amt, discount: disc, payment_mode: vendorPayMode, payment_ref: vendorPayRef, receipt_date: getWorkingDate() }) });
      if (result.data.id && window.confirm(`✅ Recorded · Receipt ${result.data.receipt_no}${disc > 0 ? " · Discount " + fmt.currency(disc) : ""}\n\nSend the receipt on WhatsApp?`)) {
        shareReceiptWA(result.data.id);
      } else if (!result.data.id) {
        alert(`✅ Recorded${disc > 0 ? " · Discount " + fmt.currency(disc) : ""}`);
      }
      setVendorPayForm(null);
      load();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const byFarmer = farmerBills.reduce((acc, b) => {
    if (!acc[b.party_id]) acc[b.party_id] = { name: b.farmer_name, name_ta: b.farmer_name_ta, phone: b.phone1, city: b.city, total: 0, bills: [] };
    acc[b.party_id].total += parseFloat(b.net_payable);
    acc[b.party_id].bills.push(b);
    return acc;
  }, {});

  const byVendor = vendorOut.reduce((acc, row) => {
    if (!acc[row.party_id]) acc[row.party_id] = { name: row.vendor_name, name_ta: row.vendor_name_ta, phone: row.phone1, total: 0, overdue: 0, bills: 0 };
    acc[row.party_id].total += parseFloat(row.balance_due);
    acc[row.party_id].bills++;
    if (row.days_overdue > 0) acc[row.party_id].overdue += parseFloat(row.balance_due);
    return acc;
  }, {});

  const totalOweFarmers = Object.values(byFarmer).reduce((s, v) => s + v.total, 0);
  const totalReceive    = Object.values(byVendor).reduce((s, v) => s + v.total, 0);

  const fq = farmerSearch.trim().toLowerCase();
  const farmerEntries = Object.entries(byFarmer)
    .filter(([, f]) => !fq
      || (f.name || "").toLowerCase().includes(fq)
      || (f.city || "").toLowerCase().includes(fq)
      || (f.phone || "").includes(fq)
      || f.bills.some(b => (b.bill_no || "").toLowerCase().includes(fq)))
    .sort(([, a], [, b]) => b.total - a.total);

  const vq = vendorSearch.trim().toLowerCase();
  const vendorEntries = Object.entries(byVendor)
    .filter(([, v]) => !vq || (v.name || "").toLowerCase().includes(vq) || (v.phone || "").includes(vq))
    .sort(([, a], [, b]) => b.total - a.total);

  const cardStyle = { background: "white", borderRadius: 10, padding: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.07)", marginBottom: 10 };
  const searchStyle = { ...inputSm, marginBottom: 12 };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>💰 Payments <span style={{ fontSize: 13, color: "#666" }}>கட்டணங்கள்</span></h1>
        <div style={{ display: "flex", gap: 0, borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb" }}>
          {[{ id: "pending", label: "Pending" }, { id: "history", label: "Paid & Collected" }, { id: "overflow", label: "🚚 Overflow Collection" }, { id: "adjust", label: "Discounts & Adjustments" }].map(t => (
            <button key={t.id} onClick={() => setView(t.id)} style={{ padding: "7px 16px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
              background: view === t.id ? "#1a7a45" : "white", color: view === t.id ? "white" : "#374151" }}>{t.label}</button>
          ))}
        </div>
      </div>

      {view === "history" ? <PaidCollectedView /> :
      view === "overflow" ? <OverflowCollectionView /> :
      view === "adjust" ? (() => {
        const selOut = byVendor[adjForm.party_id];
        const vOpts = allVendors.map(v => ({ id: v.id, label: v.name_en + (v.name_ta ? ` / ${v.name_ta}` : "") }));
        return (
        <div style={{ maxWidth: 560 }}>
          <div style={{ ...cardStyle, padding: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Record a Discount or Adjustment</div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>
              Pick any vendor — no need for an open bill. A <b>discount</b> reduces what they owe <i>and</i> is netted off profit.
              An <b>adjustment</b> offsets goods you bought from them against what they owe (profit-neutral).
            </div>

            <div style={{ display: "flex", gap: 0, borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb", marginBottom: 14, width: "fit-content" }}>
              {[{ id: "discount", label: "💸 Discount" }, { id: "adjustment", label: "🔄 Adjustment" }].map(k => (
                <button key={k.id} onClick={() => setAdjForm(p => ({ ...p, kind: k.id }))}
                  style={{ padding: "7px 16px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                    background: adjForm.kind === k.id ? "#1a7a45" : "white", color: adjForm.kind === k.id ? "white" : "#374151" }}>{k.label}</button>
              ))}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Vendor</label>
              <SearchableSelect value={adjForm.party_id} options={vOpts}
                onChange={(id) => setAdjForm(p => ({ ...p, party_id: id }))}
                placeholder="🔍 Search any vendor..." style={{ ...inputSm, width: "100%" }} />
              {adjForm.party_id && (
                <div style={{ fontSize: 12, color: selOut ? "#1d4ed8" : "#999", marginTop: 5 }}>
                  {selOut ? `Currently owes ${fmt.currency(selOut.total)} across ${selOut.bills} bill${selOut.bills > 1 ? "s" : ""}` : "No current outstanding bills"}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
              <div><label style={labelStyle}>Amount ₹</label>
                <input type="number" value={adjForm.amount} onChange={e => setAdjForm(p => ({ ...p, amount: e.target.value }))} placeholder="0" style={{ ...inputSm, width: 130 }} /></div>
              {adjForm.kind === "discount" && selOut && (
                <div style={{ display: "flex", gap: 4 }}>
                  {[3, 3.5].map(pct => (
                    <button key={pct} onClick={() => setAdjForm(p => ({ ...p, amount: String((selOut.total * pct / 100).toFixed(2)) }))}
                      style={{ padding: "6px 10px", fontSize: 12, background: "#fef9c3", border: "1px solid #fde047", borderRadius: 6, cursor: "pointer" }}>{pct}%</button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Note {adjForm.kind === "adjustment" ? "(e.g. 2 bags potato bought from them)" : "(optional)"}</label>
              <input value={adjForm.note} onChange={e => setAdjForm(p => ({ ...p, note: e.target.value }))}
                placeholder={adjForm.kind === "adjustment" ? "Goods bought from vendor..." : "Reason for discount..."} style={{ ...inputSm, width: "100%" }} />
            </div>

            <button onClick={saveAdjust} disabled={saving}
              style={{ padding: "10px 22px", background: saving ? "#9ca3af" : "#1a7a45", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
              ✅ Record {adjForm.kind === "adjustment" ? "Adjustment" : "Discount"}
            </button>
          </div>

          <div style={{ ...cardStyle, padding: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Recent Discounts & Adjustments</div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 14 }}>
              This month. Deleting one adds the amount back to the vendor's outstanding balance.
            </div>
            {adjLoading ? <div style={{ padding: 16, textAlign: "center", color: "#666" }}>Loading...</div> :
            adjList.length === 0 ? <div style={{ padding: 16, textAlign: "center", color: "#999" }}>No discounts or adjustments this month</div> :
            adjList.map(entry => (
              <div key={entry.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 5,
                      background: entry.txn_type === "ADJUSTMENT" ? "#ede9fe" : "#fef3c7",
                      color: entry.txn_type === "ADJUSTMENT" ? "#6d28d9" : "#b45309" }}>
                      {entry.txn_type === "ADJUSTMENT" ? "🔄 Adjustment" : "💸 Discount"}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {entry.party_name}{entry.party_name_ta ? ` / ${entry.party_name_ta}` : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 3 }}>
                    {entry.txn_date}{entry.description ? ` · ${entry.description}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#ea580c" }}>{fmt.currency(entry.amount)}</span>
                  <button onClick={() => delAdjustment(entry)} disabled={saving} title="Delete"
                    style={{ padding: "5px 9px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6,
                      color: "#dc2626", cursor: saving ? "not-allowed" : "pointer", fontSize: 13 }}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        </div>);
      })() :
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

        {/* LEFT — Owe to Farmers */}
        <div>
          <div style={{ background: "#f0fdf4", borderRadius: 12, padding: "12px 16px", marginBottom: 14, border: "2px solid #bbf7d0" }}>
            <div style={{ fontWeight: 700, color: "#15803d", fontSize: 15 }}>💸 We Owe Farmers</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#15803d" }}>{fmt.currency(totalOweFarmers)}</div>
            <div style={{ fontSize: 12, color: "#166534" }}>{Object.keys(byFarmer).length} farmers with unpaid bills</div>
          </div>
          <input value={farmerSearch} onChange={e => setFarmerSearch(e.target.value)}
            placeholder="🔍 Search farmer name, town, phone or bill no..." style={searchStyle} />
          {loading ? <div style={{ padding: 20, textAlign: "center" }}>Loading...</div> :
          farmerEntries.length === 0 ? <div style={{ ...cardStyle, color: "#666", textAlign: "center", padding: 30 }}>{fq ? "No matching farmers" : "No unpaid farmer bills"}</div> :
          farmerEntries.map(([pid, farmer]) => (
            <div key={pid} style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {farmer.name}{farmer.name_ta ? ` / ${farmer.name_ta}` : ""}
                    {farmer.city && <span style={{ fontSize: 12, fontWeight: 500, color: "#2563eb", marginLeft: 6 }}>📍 {farmer.city}</span>}
                  </div>
                  {farmer.phone && <div style={{ fontSize: 11, color: "#888" }}>📞 {farmer.phone}</div>}
                  <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{farmer.bills.length} bill{farmer.bills.length > 1 ? "s" : ""}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#15803d" }}>{fmt.currency(farmer.total)}</div>
                </div>
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {farmer.bills.map(b => (
                  <div key={b.id} style={{ background: "#f0fdf4", borderRadius: 8, padding: "6px 10px", fontSize: 12 }}>
                    <button onClick={() => setPeek({ id: b.id })} title="View bill"
                      style={{ background: "none", border: "none", padding: 0, fontWeight: 600, color: "#1a7a45", cursor: "pointer", textDecoration: "underline", fontSize: 12 }}>
                      {b.bill_no}
                    </button>
                    <span style={{ color: "#666", marginLeft: 6 }}>{fmt.currency(b.net_payable)}</span>
                    {payingBill === b.id ? (
                      <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <select value={payMode} onChange={e => setPayMode(e.target.value)} style={{ ...inputSm, width: 80, padding: "4px 6px", fontSize: 11 }}>
                          <option value="cash">Cash</option><option value="bank">Bank</option><option value="upi">UPI</option><option value="cheque">Cheque</option>
                        </select>
                        <input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="Ref" style={{ ...inputSm, width: 80, padding: "4px 6px", fontSize: 11 }} />
                        <button onClick={() => payFarmer(b)} disabled={saving} style={{ padding: "4px 10px", background: "#1a7a45", border: "none", borderRadius: 6, color: "white", fontSize: 11, cursor: "pointer" }}>✅ Pay {fmt.currency(b.net_payable)}</button>
                        <button onClick={() => { setPayingBill(null); setPayRef(""); }} style={{ padding: "4px 8px", background: "#f3f4f6", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>✕</button>
                      </div>
                    ) : (
                      <button onClick={() => { setPayingBill(b.id); setPayMode("cash"); setPayRef(""); }} style={{ marginLeft: 8, padding: "2px 8px", background: "#1a7a45", border: "none", borderRadius: 4, color: "white", fontSize: 10, cursor: "pointer" }}>Pay</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* RIGHT — Receive from Vendors */}
        <div>
          <div style={{ background: "#eff6ff", borderRadius: 12, padding: "12px 16px", marginBottom: 14, border: "2px solid #bfdbfe" }}>
            <div style={{ fontWeight: 700, color: "#1d4ed8", fontSize: 15 }}>💰 Vendors Owe Us</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#1d4ed8" }}>{fmt.currency(totalReceive)}</div>
            <div style={{ fontSize: 12, color: "#1e40af" }}>{Object.keys(byVendor).length} vendors with outstanding bills</div>
          </div>
          <input value={vendorSearch} onChange={e => setVendorSearch(e.target.value)}
            placeholder="🔍 Search vendor name or phone..." style={searchStyle} />
          {loading ? <div style={{ padding: 20, textAlign: "center" }}>Loading...</div> :
          vendorEntries.length === 0 ? <div style={{ ...cardStyle, color: "#666", textAlign: "center", padding: 30 }}>{vq ? "No matching vendors" : "No outstanding vendor bills"}</div> :
          vendorEntries.map(([partyId, v]) => (
            <div key={partyId} style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{v.name}{v.name_ta ? ` / ${v.name_ta}` : ""}</div>
                  {v.phone && <div style={{ fontSize: 11, color: "#888" }}>📞 {v.phone}</div>}
                  <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{v.bills} unpaid bill{v.bills > 1 ? "s" : ""}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: v.overdue > 0 ? "#dc2626" : "#1d4ed8" }}>{fmt.currency(v.total)}</div>
                  {v.overdue > 0 && <div style={{ fontSize: 10, color: "#dc2626" }}>⚠️ {fmt.currency(v.overdue)} overdue</div>}
                  <button onClick={() => setVendorPayForm({ party_id: partyId, amount: "", grossAmt: "", discount: "" })}
                    style={{ marginTop: 6, padding: "5px 12px", background: "#2563eb", border: "none", borderRadius: 6, color: "white", fontSize: 12, cursor: "pointer" }}>
                    Collect
                  </button>
                </div>
              </div>
              {vendorPayForm?.party_id === partyId && (() => {
                const applyGrossSplit = (pct) => {
                  const gross = parseFloat(vendorPayForm.grossAmt) || 0;
                  if (!gross) return;
                  const disc = parseFloat((gross * pct / 100).toFixed(2));
                  setVendorPayForm(p => ({ ...p, amount: String((gross - disc).toFixed(2)), discount: String(disc) }));
                };
                const amt  = parseFloat(vendorPayForm.amount)   || 0;
                const disc = parseFloat(vendorPayForm.discount)  || 0;
                return (
                <div style={{ marginTop: 10, padding: 12, background: "#eff6ff", borderRadius: 8 }}>
                  {/* Row 1: Gross + % shortcut */}
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 10 }}>
                    <div>
                      <label style={labelStyle}>Gross Amount ₹</label>
                      <input type="number" inputMode="decimal" value={vendorPayForm.grossAmt} placeholder="Total received"
                        onChange={e => setVendorPayForm(p => ({ ...p, grossAmt: e.target.value }))}
                        style={{ ...inputSm, width: 130 }} />
                    </div>
                    <div style={{ paddingBottom: 1 }}>
                      <label style={labelStyle}>Split at %</label>
                      <div style={{ display: "flex", gap: 4 }}>
                        {[3, 3.5].map(pct => (
                          <button key={pct} onClick={() => applyGrossSplit(pct)}
                            style={{ padding: "6px 12px", fontSize: 12, background: "#fef9c3", border: "1px solid #fde047", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>{pct}%</button>
                        ))}
                      </div>
                    </div>
                    {(amt > 0 || disc > 0) && (
                      <div style={{ fontSize: 12, color: "#1d4ed8", paddingBottom: 4 }}>
                        Payment: <strong>{fmt.currency(amt)}</strong>  +  Discount: <strong>{fmt.currency(disc)}</strong>
                      </div>
                    )}
                  </div>
                  {/* Row 2: Manual overrides + mode/ref */}
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                    <div><label style={labelStyle}>Payment ₹</label>
                      <input type="number" value={vendorPayForm.amount} onChange={e => setVendorPayForm(p => ({ ...p, amount: e.target.value }))} style={{ ...inputSm, width: 100 }} /></div>
                    <div><label style={labelStyle}>Discount ₹</label>
                      <input type="number" value={vendorPayForm.discount || ""} onChange={e => setVendorPayForm(p => ({ ...p, discount: e.target.value }))} placeholder="0" style={{ ...inputSm, width: 90 }} /></div>
                    <div><label style={labelStyle}>Mode</label>
                      <select value={vendorPayMode} onChange={e => setVendorPayMode(e.target.value)} style={{ ...inputSm, width: 90 }}>
                        <option value="cash">Cash</option><option value="bank">Bank</option><option value="upi">UPI</option><option value="cheque">Cheque</option>
                      </select>
                    </div>
                    <div><label style={labelStyle}>Ref</label>
                      <input value={vendorPayRef} onChange={e => setVendorPayRef(e.target.value)} placeholder="UPI/Cheque" style={{ ...inputSm, width: 110 }} /></div>
                    <button onClick={collectVendor} disabled={saving} style={{ padding: "8px 16px", background: saving ? "#9ca3af" : "#2563eb", border: "none", borderRadius: 8, color: "white", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>✅ Save</button>
                    <button onClick={() => setVendorPayForm(null)} style={{ padding: "8px 12px", background: "#f3f4f6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>✕</button>
                  </div>
                </div>
                );
              })()}
            </div>
          ))}
        </div>

      </div>}

      {peek && <BillPeekModal id={peek.id} onClose={() => setPeek(null)} />}
    </div>
  );
}

// ---- Overflow Collection tab ----
function OverflowCollectionView() {
  const [bills, setBills]               = useState([]);
  const [loading, setLoading]           = useState(true);
  const [collectingBill, setCollecting] = useState(null);
  const [collectItems, setCollectItems] = useState([]);
  const [collectDate, setCollectDate]   = useState(getWorkingDate());
  const [collectMode, setCollectMode]   = useState("cash");
  const [collectRef, setCollectRef]     = useState("");
  const [collectNotes, setCollectNotes] = useState("");
  const [saving, setSaving]             = useState(false);
  const [historyTab, setHistoryTab]     = useState(false);
  const [history, setHistory]           = useState([]);
  const [hFrom, setHFrom]               = useState(getWorkingDate().slice(0, 7) + "-01");
  const [hTo, setHTo]                   = useState(getWorkingDate());
  const [search, setSearch]             = useState("");
  const [filterBy, setFilterBy]         = useState("all");
  const [deleting, setDeleting]         = useState(false);

  const loadBills = () => {
    setLoading(true);
    api("overflow?action=bills").then(r => setBills(r.data || [])).catch(() => setBills([])).finally(() => setLoading(false));
  };
  const loadHistory = () => api(`overflow?action=history&from=${hFrom}&to=${hTo}`).then(r => setHistory(r.data || [])).catch(() => {});
  useEffect(() => { loadBills(); }, []);
  useEffect(() => { if (historyTab) loadHistory(); }, [historyTab, hFrom, hTo]);

  const deleteCollection = async (entry) => {
    if (!window.confirm(`Delete receipt ${entry.receipt_no} (${fmt.currency(entry.total_collected)}) for ${entry.party_name}?\nThis will reverse the payment and add the amount back to the bill balance.`)) return;
    setDeleting(true);
    try {
      await api("overflow?action=delete-collection", { method: "POST", body: JSON.stringify({ collection_id: entry.id }) });
      loadHistory();
      loadBills();
    } catch(e) { alert(e.message); }
    finally { setDeleting(false); }
  };

  const openCollect = (bill) => {
    const items = (bill.items || [])
      .filter(it => (it.total_bags - (it.collected_bags || 0)) > 0)
      .map(it => {
        const rem = it.total_bags - (it.collected_bags || 0);
        const remWeight = rem / it.total_bags * parseFloat(it.weight || 0);
        const remAmt    = rem / it.total_bags * parseFloat(it.billed_amount || 0);
        return { ...it, bags_now: String(rem), weight_now: remWeight.toFixed(2), actual_amount: remAmt.toFixed(2) };
      });
    setCollectItems(items);
    setCollectDate(getWorkingDate());
    setCollectMode("cash");
    setCollectRef(""); setCollectNotes("");
    setCollecting(bill);
  };

  const updateItem = (i, field, val) =>
    setCollectItems(prev => prev.map((x, j) => j === i ? { ...x, [field]: val } : x));

  const submitCollect = async () => {
    const activeItems = collectItems.filter(it => (parseInt(it.bags_now) || 0) > 0);
    if (!activeItems.length) { alert("Enter bags > 0 for at least one product"); return; }
    const totalActual = activeItems.reduce((s, it) => s + parseFloat(it.actual_amount || 0), 0);
    if (totalActual <= 0) { alert("Actual amount must be > 0"); return; }
    setSaving(true);
    try {
      const r = await api("overflow?action=collect", { method: "POST", body: JSON.stringify({
        bill_id: collectingBill.id,
        collection_date: collectDate,
        notes: collectNotes || null,
        payment_mode: collectMode,
        payment_ref: collectRef || null,
        items: activeItems.map(it => ({
          sales_item_id: it.item_id,
          product_id:    it.product_id,
          product_name:  it.product_name,
          bags:          parseInt(it.bags_now) || 0,
          weight:        parseFloat(it.weight_now || 0),
          billed_rate:   parseFloat(it.rate || 0),
          billed_amount: (parseInt(it.bags_now) || 0) / it.total_bags * parseFloat(it.billed_amount || 0),
          actual_amount: parseFloat(it.actual_amount || 0),
        })),
      })});
      const v = parseFloat(r.data.variance || 0);
      alert(`✅ Receipt ${r.data.receipt_no} · Collected ${fmt.currency(r.data.collected)}`
        + (Math.abs(v) >= 0.01 ? `\nVariance: ${v > 0 ? "+" : ""}${fmt.currency(v)} (${v > 0 ? "gain" : "loss"})` : ""));
      setCollecting(null);
      loadBills();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const totalOutstanding = bills.reduce((s, b) => s + parseFloat(b.balance_due || 0), 0);
  const varLabel = (v) => { const n = parseFloat(v || 0); if (Math.abs(n) < 0.01) return "—"; return `${n > 0 ? "+" : ""}${fmt.currency(n)}`; };
  const varColor = (v) => { const n = parseFloat(v || 0); return Math.abs(n) < 0.01 ? "#888" : n > 0 ? "#16a34a" : "#dc2626"; };

  const q = search.trim().toLowerCase();
  const filteredBills = !q ? bills : bills.filter(b => {
    if (filterBy === "name")    return (b.party_name || "").toLowerCase().includes(q) || (b.party_name_ta || "").includes(search.trim());
    if (filterBy === "date")    return fmt.date(b.bill_date).toLowerCase().includes(q) || b.bill_date.includes(search.trim());
    if (filterBy === "bill")    return (b.bill_no || "").toLowerCase().includes(q);
    if (filterBy === "product") return (b.items || []).some(it => (it.product_name || "").toLowerCase().includes(q));
    // "all" — match any
    return (b.party_name || "").toLowerCase().includes(q)
      || (b.party_name_ta || "").includes(search.trim())
      || fmt.date(b.bill_date).toLowerCase().includes(q)
      || b.bill_date.includes(search.trim())
      || (b.bill_no || "").toLowerCase().includes(q)
      || (b.items || []).some(it => (it.product_name || "").toLowerCase().includes(q));
  });

  const tH = { padding: "9px 10px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280",
    borderBottom: "1px solid #e5e7eb", background: "#f9fafb", whiteSpace: "nowrap" };
  const tD = { padding: "10px 10px", fontSize: 13, borderBottom: "1px solid #f3f4f6", verticalAlign: "middle" };
  const tR = { padding: "9px 10px", fontSize: 12, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb", background: "#f9fafb", whiteSpace: "nowrap" };

  return (
    <div>
      {/* Header bar */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ background: "#fff7ed", borderRadius: 10, padding: "10px 16px", border: "2px solid #fed7aa" }}>
          <div style={{ fontWeight: 700, color: "#c2410c", fontSize: 13 }}>🚚 Overflow Outstanding</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#c2410c" }}>{fmt.currency(totalOutstanding)}</div>
          <div style={{ fontSize: 11, color: "#9a3412" }}>{bills.length} bill{bills.length !== 1 ? "s" : ""} · {new Set(bills.map(b => b.party_id)).size} vendors</div>
        </div>
        <div style={{ display: "flex", gap: 0, borderRadius: 8, border: "1px solid #e5e7eb", overflow: "hidden" }}>
          <button onClick={() => setHistoryTab(false)} style={{ padding: "7px 16px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
            background: !historyTab ? "#1a7a45" : "white", color: !historyTab ? "white" : "#374151" }}>Pending</button>
          <button onClick={() => setHistoryTab(true)} style={{ padding: "7px 16px", border: "none", borderLeft: "1px solid #e5e7eb", cursor: "pointer", fontSize: 13, fontWeight: 600,
            background: historyTab ? "#1a7a45" : "white", color: historyTab ? "white" : "#374151" }}>History</button>
        </div>
      </div>

      {/* ── PENDING TABLE ── */}
      {!historyTab && (
        <>
          {/* Search / filter bar */}
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
            <select value={filterBy} onChange={e => setFilterBy(e.target.value)}
              style={{ ...inputSm, width: 120 }}>
              <option value="all">All fields</option>
              <option value="name">Party name</option>
              <option value="date">Date</option>
              <option value="bill">Bill No</option>
              <option value="product">Product</option>
            </select>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={`🔍 Search ${filterBy === "all" ? "vendor / date / bill / product" : filterBy}…`}
              style={{ ...inputSm, flex: 1, minWidth: 200 }} />
            {search && <button onClick={() => setSearch("")}
              style={{ padding: "6px 10px", background: "#f3f4f6", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 12, color: "#374151" }}>✕ Clear</button>}
          </div>

          <div style={{ background: "white", borderRadius: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", overflow: "hidden" }}>
          {loading ? <div style={{ padding: 30, textAlign: "center", color: "#888" }}>Loading…</div> :
          filteredBills.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: "#888" }}>{q ? "No bills match your search" : "No outstanding overflow bills"}</div> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["#", "Vendor", "Date", "Bill No", "Items", "% Collected", "Balance ₹", ""].map((h, i) => (
                  <th key={i} style={{ ...tH, textAlign: i >= 5 ? "right" : "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredBills.map((bill, idx) => {
                const pct = bill.net_amount > 0 ? Math.round((bill.overflow_collected || 0) / bill.net_amount * 100) : 0;
                const hasRemaining = (bill.items || []).some(it => (it.total_bags - (it.collected_bags || 0)) > 0);
                return (
                  <tr key={bill.id} style={{ background: idx % 2 ? "#fafafa" : "white" }}>
                    <td style={{ ...tD, color: "#9ca3af", width: 36 }}>{idx + 1}</td>
                    <td style={{ ...tD, fontWeight: 600, color: "#ea580c" }}>
                      {bill.party_name}{bill.party_name_ta ? <span style={{ color: "#1a7a45", fontFamily: "'Noto Sans Tamil',sans-serif", marginLeft: 4, fontSize: 12 }}>{bill.party_name_ta}</span> : null}
                    </td>
                    <td style={{ ...tD, whiteSpace: "nowrap" }}>{fmt.date(bill.bill_date)}</td>
                    <td style={{ ...tD, color: "#2563eb", fontWeight: 600, whiteSpace: "nowrap" }}>{bill.bill_no}</td>
                    <td style={{ ...tD }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {(bill.items || []).map((it, i) => {
                          const rem = it.total_bags - (it.collected_bags || 0);
                          return (
                            <span key={i} style={{ fontSize: 11, borderRadius: 5, padding: "2px 7px",
                              background: rem > 0 ? "#fff7ed" : "#f0fdf4",
                              color: rem > 0 ? "#9a3412" : "#166534",
                              border: `1px solid ${rem > 0 ? "#fed7aa" : "#bbf7d0"}` }}>
                              {it.product_name} {it.total_bags}bg{rem > 0 ? ` (${rem} left)` : " ✓"}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td style={{ ...tD, textAlign: "right" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                        <div style={{ width: 60, height: 6, borderRadius: 3, background: "#e5e7eb", overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: pct >= 100 ? "#16a34a" : "#ea580c", borderRadius: 3 }} />
                        </div>
                        <span style={{ fontWeight: 600, fontSize: 12 }}>{pct}%</span>
                      </div>
                    </td>
                    <td style={{ ...tD, textAlign: "right", fontWeight: 700, color: "#dc2626", whiteSpace: "nowrap" }}>
                      {fmt.currency(bill.balance_due)}
                    </td>
                    <td style={{ ...tD, textAlign: "right" }}>
                      {hasRemaining && (
                        <button onClick={() => openCollect(bill)}
                          style={{ padding: "6px 12px", background: "#ea580c", border: "none", borderRadius: 7, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}>
                          📥 Collect
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: "#fff7ed", borderTop: "2px solid #ea580c" }}>
                <td colSpan={6} style={{ ...tD, fontWeight: 700, textAlign: "right" }}>TOTAL OUTSTANDING</td>
                <td style={{ ...tD, textAlign: "right", fontWeight: 800, color: "#c2410c", fontSize: 14 }}>{fmt.currency(totalOutstanding)}</td>
                <td style={tD} />
              </tr>
            </tfoot>
          </table>
          )}
        </div>
        </>
      )}

      {/* ── HISTORY TABLE ── */}
      {historyTab && (
        <div>
          <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div><label style={labelStyle}>From</label><input type="date" value={hFrom} onChange={e => setHFrom(e.target.value)} style={inputSm} /></div>
            <div><label style={labelStyle}>To</label><input type="date" value={hTo} onChange={e => setHTo(e.target.value)} style={inputSm} /></div>
          </div>
          {history.length === 0 ? <div style={{ padding: 24, textAlign: "center", color: "#888", background: "white", borderRadius: 10 }}>No overflow collections in this period</div> : (
          <div style={{ background: "white", borderRadius: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["#", "Date", "Receipt", "Vendor", "Bill No", "Products", "Collected ₹", "Variance", ""].map((h, i) => (
                    <th key={i} style={{ ...tH, textAlign: i >= 6 && i < 8 ? "right" : "left" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((h, idx) => (
                  <tr key={h.id} style={{ background: idx % 2 ? "#fafafa" : "white" }}>
                    <td style={{ ...tD, color: "#9ca3af", width: 36 }}>{idx + 1}</td>
                    <td style={{ ...tD, whiteSpace: "nowrap" }}>{fmt.date(h.collection_date)}</td>
                    <td style={{ ...tD, color: "#2563eb", fontWeight: 600 }}>{h.receipt_no}</td>
                    <td style={{ ...tD, fontWeight: 600 }}>{h.party_name}{h.party_name_ta ? ` / ${h.party_name_ta}` : ""}</td>
                    <td style={tD}>{h.bill_no}</td>
                    <td style={tD}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {(h.items || []).map((it, i) => (
                          <span key={i} style={{ fontSize: 11, background: "#f1f5f9", borderRadius: 5, padding: "2px 7px" }}>
                            {it.product_name} · {it.bags}bg · {fmt.currency(it.actual_amount)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ ...tD, textAlign: "right", fontWeight: 700 }}>{fmt.currency(h.total_collected)}</td>
                    <td style={{ ...tD, textAlign: "right", fontWeight: 600, color: varColor(h.variance) }}>{varLabel(h.variance)}</td>
                    <td style={{ ...tD, textAlign: "right" }}>
                      <button onClick={() => deleteCollection(h)} disabled={deleting}
                        title="Delete this collection — reverses the payment"
                        style={{ padding: "4px 9px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6,
                          color: "#dc2626", cursor: deleting ? "not-allowed" : "pointer", fontSize: 13 }}>🗑️</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}

      {/* ── COLLECTION MODAL ── */}
      {collectingBill && (
        <div onClick={() => !saving && setCollecting(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "white", borderRadius: 12, width: 760, maxWidth: "98vw", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 16px 48px rgba(0,0,0,0.28)", display: "flex", flexDirection: "column" }}>

            {/* Modal header */}
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#ea580c" }}>📥 Record Collection</div>
                <div style={{ fontSize: 13, color: "#666", marginTop: 2 }}>
                  {collectingBill.party_name} · {collectingBill.bill_no} · {fmt.date(collectingBill.bill_date)} · Balance {fmt.currency(collectingBill.balance_due)}
                </div>
              </div>
              <button onClick={() => setCollecting(null)} style={{ padding: "5px 10px", background: "#f3f4f6", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 }}>✕</button>
            </div>

            {/* Per-product table */}
            <div style={{ padding: "16px 20px", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {["Product", "Total Bags", "Already Collected", "Bags Now", "Weight (kg)", "Billed ₹", "Actual ₹ Received", "Variance"].map((h, i) => (
                      <th key={i} style={{ ...tR, textAlign: i >= 3 ? "right" : "left" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {collectItems.map((it, i) => {
                    const bagsNow   = parseInt(it.bags_now) || 0;
                    const billedNow = bagsNow / it.total_bags * parseFloat(it.billed_amount || 0);
                    const actual    = parseFloat(it.actual_amount || 0);
                    const variance  = actual - billedNow;
                    return (
                      <tr key={i} style={{ background: i % 2 ? "#fafafa" : "white" }}>
                        <td style={{ ...tD, fontWeight: 600, color: "#1a7a45" }}>{it.product_name}</td>
                        <td style={{ ...tD, textAlign: "right" }}>{it.total_bags}</td>
                        <td style={{ ...tD, textAlign: "right", color: it.collected_bags > 0 ? "#16a34a" : "#9ca3af" }}>
                          {it.collected_bags || 0}
                        </td>
                        <td style={{ ...tD, textAlign: "right" }}>
                          <input type="number" min={0} max={it.total_bags - (it.collected_bags || 0)}
                            value={it.bags_now}
                            onChange={e => {
                              const b = e.target.value;
                              const bn = parseInt(b) || 0;
                              const newWt = (bn / it.total_bags * parseFloat(it.weight || 0)).toFixed(2);
                              setCollectItems(prev => prev.map((x, j) => j === i
                                ? { ...x, bags_now: b, weight_now: newWt }
                                : x));
                            }}
                            style={{ ...inputSm, width: 64, textAlign: "right", padding: "4px 6px" }} />
                        </td>
                        <td style={{ ...tD, textAlign: "right" }}>
                          <input type="number" min={0} step="0.01"
                            value={it.weight_now}
                            onChange={e => updateItem(i, "weight_now", e.target.value)}
                            style={{ ...inputSm, width: 74, textAlign: "right", padding: "4px 6px" }} />
                        </td>
                        <td style={{ ...tD, textAlign: "right", color: "#666" }}>{fmt.currency(billedNow)}</td>
                        <td style={{ ...tD, textAlign: "right" }}>
                          <input type="number" min={0} step="0.01"
                            value={it.actual_amount}
                            onChange={e => updateItem(i, "actual_amount", e.target.value)}
                            style={{ ...inputSm, width: 100, textAlign: "right", padding: "4px 6px",
                              border: "1px solid #1a7a45", fontWeight: 600 }} />
                        </td>
                        <td style={{ ...tD, textAlign: "right", fontWeight: 700,
                          color: Math.abs(variance) < 0.01 ? "#888" : variance > 0 ? "#16a34a" : "#dc2626" }}>
                          {Math.abs(variance) < 0.01 ? "—" : `${variance > 0 ? "+" : ""}${fmt.currency(variance)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {(() => {
                    const totBilled = collectItems.reduce((s, it) => s + (parseInt(it.bags_now)||0) / it.total_bags * parseFloat(it.billed_amount||0), 0);
                    const totActual = collectItems.reduce((s, it) => s + parseFloat(it.actual_amount||0), 0);
                    const totWt     = collectItems.reduce((s, it) => s + parseFloat(it.weight_now||0), 0);
                    const totVar    = totActual - totBilled;
                    return (
                      <tr style={{ background: "#fff7ed", borderTop: "2px solid #ea580c", fontWeight: 800 }}>
                        <td colSpan={3} style={{ ...tD, fontWeight: 800 }}>TOTAL</td>
                        <td style={{ ...tD, textAlign: "right" }}>{collectItems.reduce((s, it) => s + (parseInt(it.bags_now)||0), 0)}</td>
                        <td style={{ ...tD, textAlign: "right" }}>{totWt.toFixed(2)}</td>
                        <td style={{ ...tD, textAlign: "right", color: "#666" }}>{fmt.currency(totBilled)}</td>
                        <td style={{ ...tD, textAlign: "right", color: "#1a7a45", fontSize: 15 }}>{fmt.currency(totActual)}</td>
                        <td style={{ ...tD, textAlign: "right", color: varColor(totVar), fontSize: 14 }}>{varLabel(totVar)}</td>
                      </tr>
                    );
                  })()}
                </tfoot>
              </table>
            </div>

            {/* Date / Mode / Ref / Notes */}
            <div style={{ padding: "0 20px 16px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div><label style={labelStyle}>Date</label><input type="date" value={collectDate} onChange={e => setCollectDate(e.target.value)} style={inputSm} /></div>
              <div><label style={labelStyle}>Mode</label>
                <select value={collectMode} onChange={e => setCollectMode(e.target.value)} style={{ ...inputSm, width: 90 }}>
                  <option value="cash">Cash</option><option value="bank">Bank</option><option value="upi">UPI</option><option value="cheque">Cheque</option>
                </select></div>
              <div><label style={labelStyle}>Ref</label><input value={collectRef} onChange={e => setCollectRef(e.target.value)} placeholder="UPI / Cheque no." style={{ ...inputSm, width: 130 }} /></div>
              <div style={{ flex: 1, minWidth: 160 }}><label style={labelStyle}>Notes</label><input value={collectNotes} onChange={e => setCollectNotes(e.target.value)} placeholder="e.g. 3 shops settled today" style={{ ...inputSm, width: "100%" }} /></div>
            </div>

            {/* Actions */}
            <div style={{ padding: "14px 20px", borderTop: "1px solid #e5e7eb", display: "flex", gap: 10 }}>
              <button onClick={submitCollect} disabled={saving}
                style={{ padding: "10px 24px", background: saving ? "#9ca3af" : "#ea580c", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 14, flex: 1 }}>
                {saving ? "Saving…" : "✅ Record Collection"}
              </button>
              <button onClick={() => setCollecting(null)} disabled={saving}
                style={{ padding: "10px 18px", background: "#f3f4f6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Paid & Collected history — vendor receipts (in) and farmer payouts (out)
function PaidCollectedView() {
  const [from, setFrom] = useState(new Date().toISOString().split("T")[0]);
  const [to, setTo]     = useState(new Date().toISOString().split("T")[0]);
  const [coll, setColl] = useState({ data: [], summary: {} });
  const [pay, setPay]   = useState([]);
  const [q, setQ]       = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => {
    api(`reports?action=collections&from=${from}&to=${to}`).then(setColl).catch(() => {});
    api(`reports?action=payouts-list&from=${from}&to=${to}`).then(r => setPay(r.data || [])).catch(() => {});
  };
  useEffect(() => { load(); }, [from, to]);

  const delColl = async (c) => {
    if (!window.confirm(`Delete receipt ${c.receipt_no} from ${c.party_name} for ${fmt.currency(c.amount)}?\n\nThis restores the bill(s) it was applied to. This cannot be undone.`)) return;
    setBusy(true);
    try { await api("sales?action=delete-payment", { method: "POST", body: JSON.stringify({ payment_id: c.id }) }); load(); }
    catch (e) { alert(e.message); } finally { setBusy(false); }
  };
  const delPay = async (p) => {
    if (!window.confirm(`Delete the ₹${parseFloat(p.amount).toLocaleString("en-IN")} payout to ${p.party_name}${p.purchase_bill_id ? ` (bill #${p.purchase_bill_id})` : ""}?\n\nThis marks that purchase bill unpaid again. This cannot be undone.`)) return;
    setBusy(true);
    try { await api("purchase?action=delete-payout", { method: "POST", body: JSON.stringify({ payout_id: p.id }) }); load(); }
    catch (e) { alert(e.message); } finally { setBusy(false); }
  };
  const s = q.trim().toLowerCase();
  const fColl = (coll.data || []).filter(c => !s || (c.party_name || "").toLowerCase().includes(s) || (c.receipt_no || "").toLowerCase().includes(s) || (c.payment_ref || "").toLowerCase().includes(s));
  const fPay = pay.filter(p => !s || (p.party_name || "").toLowerCase().includes(s) || String(p.purchase_bill_id || "").includes(s) || (p.payment_ref || "").toLowerCase().includes(s));
  const collTotal = fColl.reduce((a, c) => a + parseFloat(c.amount || 0), 0);
  const payTotal = fPay.reduce((a, p) => a + parseFloat(p.amount || 0), 0);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 16, flexWrap: "wrap", background: "white", borderRadius: 12, padding: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <div><label style={labelStyle}>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputSm} /></div>
        <div><label style={labelStyle}>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputSm} /></div>
        <div style={{ flex: 1, minWidth: 180 }}><label style={labelStyle}>Search</label><input value={q} onChange={e => setQ(e.target.value)} placeholder="party / receipt / bill no" style={inputSm} /></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Collected (money in) */}
        <div style={{ background: "white", borderRadius: 12, padding: 18, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontWeight: 700, color: "#16a34a" }}>💰 Collected (receipts)</div>
            <div style={{ fontWeight: 800, color: "#16a34a" }}>{fmt.currency(collTotal)}</div>
          </div>
          {fColl.length === 0 ? <div style={{ color: "#888", fontSize: 13, padding: 10 }}>No collections</div> :
           fColl.map((c, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>
              <div>
                <span style={{ fontWeight: 600, color: "#2563eb" }}>{c.receipt_no}</span>
                <span style={{ marginLeft: 8 }}>{c.party_name}</span>
                {(c.discount_amt > 0) && <span style={{ marginLeft: 8, fontSize: 11, background: "#fff7ed", color: "#ea580c", border: "1px solid #fed7aa", borderRadius: 6, padding: "1px 6px", fontWeight: 600 }}>disc {fmt.currency(c.discount_amt)}</span>}
                <div style={{ fontSize: 11, color: "#888" }}>{fmt.date(c.receipt_date)} · {(c.payment_mode || "cash").toUpperCase()}{c.bank_name ? ` · ${c.bank_name}` : ""}{c.payment_ref ? ` · ${c.payment_ref}` : ""}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700 }}>{fmt.currency(c.amount)}</span>
                <button onClick={() => shareReceiptWA(c.id)} title="Send receipt on WhatsApp" style={{ padding: "3px 8px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, color: "#16a34a", cursor: "pointer", fontSize: 12 }}>📲</button>
                <button onClick={() => delColl(c)} disabled={busy} title="Delete this receipt" style={{ padding: "3px 8px", background: "#fee2e2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", cursor: "pointer", fontSize: 12 }}>🗑️</button>
              </div>
            </div>
           ))}
        </div>
        {/* Paid (money out) */}
        <div style={{ background: "white", borderRadius: 12, padding: 18, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontWeight: 700, color: "#dc2626" }}>💸 Paid to farmers/suppliers</div>
            <div style={{ fontWeight: 800, color: "#dc2626" }}>{fmt.currency(payTotal)}</div>
          </div>
          {fPay.length === 0 ? <div style={{ color: "#888", fontSize: 13, padding: 10 }}>No payouts (recorded from this update onward)</div> :
           fPay.map((p, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>
              <div>
                <span style={{ fontWeight: 600 }}>{p.party_name}</span>
                {p.purchase_bill_id && <span style={{ fontSize: 11, color: "#2563eb", marginLeft: 8 }}>bill #{p.purchase_bill_id}</span>}
                <div style={{ fontSize: 11, color: "#888" }}>{fmt.date(p.pay_date)} · {(p.mode || "cash").toUpperCase()}{p.bank_name ? ` · ${p.bank_name}` : ""}{p.payment_ref ? ` · ${p.payment_ref}` : ""}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700 }}>{fmt.currency(p.amount)}</span>
                <button onClick={() => delPay(p)} disabled={busy} title="Delete this payout" style={{ padding: "3px 8px", background: "#fee2e2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", cursor: "pointer", fontSize: 12 }}>🗑️</button>
              </div>
            </div>
           ))}
        </div>
      </div>
    </div>
  );
}

// Quick read-only preview of a purchase bill (verify product/weight/amount before paying)
function BillPeekModal({ id, onClose }) {
  const [bill, setBill] = useState(null);
  const [err, setErr]   = useState(null);
  useEffect(() => {
    api(`purchase?action=get&id=${id}`).then(r => setBill(r.data)).catch(e => setErr(e.message));
  }, [id]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000,
                  display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 12, padding: 20, width: 560, maxWidth: "92vw", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
        {!bill && !err && <div style={{ padding: 20, textAlign: "center", color: "#666" }}>Loading bill...</div>}
        {err && <div style={{ padding: 20, color: "#dc2626" }}>Could not load bill: {err}</div>}
        {bill && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#1a7a45" }}>{bill.bill_no}</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{bill.party_name}{bill.party_name_ta ? ` / ${bill.party_name_ta}` : ""}</div>
                <div style={{ fontSize: 12, color: "#666" }}>
                  {fmt.date(bill.bill_date)}{bill.reference_name ? ` · 🚛 ${bill.reference_name}` : ""}
                </div>
              </div>
              <button onClick={onClose} style={{ padding: "6px 12px", background: "#f3f4f6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>✕ Close</button>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  {["Product", "Bags", "Weight", "Rate ₹", "Amount ₹"].map(h => (
                    <th key={h} style={{ padding: "6px 8px", textAlign: h === "Product" ? "left" : "right", borderBottom: "1px solid #e5e7eb", fontSize: 11, color: "#6b7280" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(bill.items || []).map((it, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "6px 8px" }}>
                      <div style={{ fontWeight: 600 }}>{it.product_name}</div>
                      {it.weights_detail && <div style={{ fontSize: 10, color: "#888" }}>{it.weights_detail}</div>}
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{it.no_of_bags}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{parseFloat(it.billed_weight || 0).toFixed(1)} kg</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{parseFloat(it.purchase_rate || 0).toFixed(2)}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{fmt.currency(it.gross_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 12, textAlign: "right", fontSize: 15, fontWeight: 800, color: "#1a7a45" }}>
              Net Payable: {fmt.currency(bill.net_payable)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}


// ============================================================
// USERS / ADMIN — create logins with per-module permissions (admin only)
// ============================================================
const APP_MODULES = [
  { id: "dashboard", label: "Dashboard" }, { id: "yard", label: "Yard Entry" },
  { id: "purchase", label: "Farmer Purchase" }, { id: "supplier", label: "Supplier Purchase" },
  { id: "market", label: "Market Purchase" }, { id: "sales", label: "Sales" },
  { id: "orders", label: "Orders" },
  { id: "payments", label: "Payments" }, { id: "parties", label: "Parties" },
  { id: "products", label: "Products" }, { id: "tally", label: "Tally" },
  { id: "reports", label: "Reports" }, { id: "print", label: "Print" },
  { id: "expenses", label: "Expenses" },
];

export function UsersAdminPage() {
  const [users, setUsers] = useState([]);
  const [editing, setEditing] = useState(null);   // user object or {} for new
  const [loading, setLoading] = useState(true);
  const load = () => { setLoading(true); api("auth?action=users-list").then(r => setUsers(r.data || [])).catch(e => alert(e.message)).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>👤 Users &amp; Permissions</h1>
        <button onClick={() => setEditing({})} style={{ padding: "9px 18px", background: "#1a7a45", border: "none", borderRadius: 8, color: "white", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>+ Add User</button>
      </div>
      {loading ? <div style={{ padding: 20, color: "#666" }}>Loading...</div> :
       <div style={{ background: "white", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
         <table style={{ width: "100%", borderCollapse: "collapse" }}>
           <thead><tr style={{ background: "#f9fafb" }}>{["User", "Name", "Role", "Access", "Status", ""].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>{h}</th>)}</tr></thead>
           <tbody>
             {users.map(u => (
               <tr key={u.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                 <td style={{ padding: "10px 14px", fontWeight: 600 }}>{u.username}</td>
                 <td style={{ padding: "10px 14px", fontSize: 13 }}>{u.full_name}</td>
                 <td style={{ padding: "10px 14px", fontSize: 12 }}>{u.role === "admin" ? <span style={{ background: "#ede9fe", color: "#7c3aed", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>Admin</span> : "Staff"}</td>
                 <td style={{ padding: "10px 14px", fontSize: 12, color: "#666" }}>{u.role === "admin" ? "All modules" : (u.permissions || []).join(", ") || "—"}</td>
                 <td style={{ padding: "10px 14px" }}><span style={{ fontSize: 11, fontWeight: 600, color: u.is_active ? "#16a34a" : "#dc2626" }}>{u.is_active ? "Active" : "Disabled"}</span></td>
                 <td style={{ padding: "10px 14px" }}><button onClick={() => setEditing(u)} style={{ padding: "4px 10px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, color: "#2563eb", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>✏️ Edit</button></td>
               </tr>
             ))}
           </tbody>
         </table>
       </div>}
      {editing && <UserForm user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}

      <BackupPanel />
      <BrandLogoPanel />
      <DayLockPanel />
      <BusinessRulesPanel />
      <OutstandingImportPanel />
      <LegacyBalancesPanel />
      <ReconcileOutstandingPanel />
      <ScopedImportPanel />
      <LegacyBillsPanel />
      <FarmerCityFixPanel />
      <CitiesBackfillPanel />
      <DangerZone />
    </div>
  );
}

// Upload a brand logo shown in the sidebar & login (replaces the 🌿 leaf). Admin only.
function BrandLogoPanel() {
  const [open, setOpen]   = useState(false);
  const [logo, setLogo]   = useState("");      // current data URL ("" = none)
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr]     = useState("");

  useEffect(() => {
    if (!open) return;
    api("settings?action=app-logo").then(r => setLogo(r.data?.logo || "")).catch(e => setErr(e.message));
  }, [open]);

  const onFile = (file) => {
    if (!file) return;
    setErr("");
    if (file.size > 1400000) { setErr("Image too large — pick one under ~1.4 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => { setLogo(reader.result); setDirty(true); };
    reader.readAsDataURL(file);
  };

  const save = async (value) => {
    setSaving(true); setErr("");
    try {
      await api("settings?action=app-logo-save", { method: "POST", body: JSON.stringify({ logo: value }) });
      setAppLogoCache(value);   // live-refresh the sidebar/login without reload
      setDirty(false);
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ marginTop: 20, background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", overflow: "hidden" }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width: "100%", textAlign: "left", padding: "14px 18px", background: "#eff6ff", border: "none",
                 borderBottom: open ? "1px solid #e5e7eb" : "none", cursor: "pointer", fontSize: 15, fontWeight: 700, color: "#1d4ed8" }}>
        🖼️ Brand logo {open ? "▲" : "▼"}
      </button>
      {open && (
        <div style={{ padding: 18 }}>
          <p style={{ marginTop: 0, color: "#4b5563", fontSize: 13, lineHeight: 1.5 }}>
            Replaces the green leaf in the sidebar and login screen. Use a square PNG (transparent background looks best), under ~1.4&nbsp;MB.
          </p>
          {err && <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>{err}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ width: 72, height: 72, borderRadius: 12, background: "#0f4c2a", display: "flex",
                          alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
              {logo
                ? <img src={logo} alt="logo" style={{ width: 56, height: 56, objectFit: "contain" }} />
                : <span style={{ fontSize: 32 }}>🌿</span>}
            </div>
            <input type="file" accept="image/*" onChange={e => onFile(e.target.files?.[0])} style={{ fontSize: 13 }} />
            <button onClick={() => save(logo)} disabled={saving || !dirty}
              style={{ padding: "8px 16px", background: (saving || !dirty) ? "#9ca3af" : "#1a7a45", border: "none",
                       borderRadius: 8, color: "white", fontSize: 14, fontWeight: 700, cursor: (saving || !dirty) ? "default" : "pointer" }}>
              {saving ? "Saving…" : "Save logo"}
            </button>
            {logo && (
              <button onClick={() => { setLogo(""); save(""); }} disabled={saving}
                style={{ padding: "8px 14px", background: "#fee2e2", border: "none", borderRadius: 8,
                         color: "#dc2626", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Remove (back to leaf)
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// View & unlock locked business days. Admin only. The day-to-day lock/unlock of
// the *current* working day lives in the top Day bar; this panel can reach any
// past locked day (which the bar can't navigate to, since locked days can't be
// selected as the working date).
function DayLockPanel() {
  const [open, setOpen]   = useState(false);
  const [data, setData]   = useState(null);   // { locks:[{lock_date,locked_by,locked_at,note}], today, business_date }
  const [busy, setBusy]   = useState("");
  const [err, setErr]     = useState("");

  const load = () => api("daylock?action=status").then(r => setData(r.data)).catch(e => setErr(e.message));
  useEffect(() => { if (open && !data) load(); }, [open]);

  const unlock = async (date) => {
    if (!window.confirm(`Unlock ${date}?\n\nThis re-opens the day so bills can be back-dated or corrected. The unlock is recorded in the audit log.`)) return;
    setBusy(date); setErr("");
    try {
      await api("daylock?action=unlock", { method: "POST", body: JSON.stringify({ date }) });
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(""); }
  };

  const locks = data?.locks || [];

  return (
    <div style={{ marginTop: 20, background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", overflow: "hidden" }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width: "100%", textAlign: "left", padding: "14px 18px", background: "#f0fdf4", border: "none",
                 borderBottom: open ? "1px solid #e5e7eb" : "none", cursor: "pointer", fontSize: 15, fontWeight: 700, color: "#15803d" }}>
        🔒 Day Lock — locked business days {open ? "▲" : "▼"}
      </button>
      {open && (
        <div style={{ padding: 18 }}>
          <p style={{ marginTop: 0, color: "#4b5563", fontSize: 13, lineHeight: 1.5 }}>
            Locked days are frozen — no bills, payments or expenses dated to them can be created or changed.
            Unlock a day here to back-date or correct it, then lock it again from the top bar when done.
          </p>
          {err && <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>{err}</div>}
          {locks.length === 0
            ? <div style={{ color: "#6b7280", fontSize: 14, padding: "10px 0" }}>No days are currently locked.</div>
            : <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: "#f9fafb" }}>
                  {["Locked day", "Locked by", "Locked at", "Note", ""].map(h =>
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {locks.map(l => (
                    <tr key={l.lock_date} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 700 }}>{fmt.date ? fmt.date(l.lock_date) : l.lock_date}</td>
                      <td style={{ padding: "8px 12px", fontSize: 13 }}>{l.locked_by || "—"}</td>
                      <td style={{ padding: "8px 12px", fontSize: 12, color: "#6b7280" }}>{l.locked_at || "—"}</td>
                      <td style={{ padding: "8px 12px", fontSize: 13 }}>{l.note || "—"}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <button onClick={() => unlock(l.lock_date)} disabled={busy === l.lock_date}
                          style={{ padding: "5px 12px", background: "white", border: "1px solid #fca5a5", borderRadius: 6,
                                   color: "#b91c1c", cursor: busy ? "wait" : "pointer", fontSize: 12, fontWeight: 700 }}>
                          {busy === l.lock_date ? "…" : "🔓 Unlock"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>}
        </div>
      )}
    </div>
  );
}

// Fix farmer cities from the legacy village field (FARMERS ONLY). Admin only.
function FarmerCityFixPanel() {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const loadPreview = () => {
    setBusy(true); setResult(null);
    api("admin?action=fix-farmer-cities").then(r => setPreview(r.data)).catch(e => alert(e.message)).finally(() => setBusy(false));
  };
  useEffect(() => { if (open && !preview) loadPreview(); }, [open]);

  const apply = async () => {
    if (confirm !== "FIX-CITIES") { alert('Type FIX-CITIES exactly to proceed'); return; }
    setBusy(true);
    try {
      const r = await api("admin?action=fix-farmer-cities", { method: "POST", body: JSON.stringify({ confirm }) });
      clearApiCache();
      setResult(r.data);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 28, border: "2px solid #bfdbfe", borderRadius: 12, padding: 18, background: "#eff6ff" }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
        <div style={{ fontWeight: 700, color: "#1d4ed8" }}>📍 Fix farmer village/city (from legacy data)</div>
        <span style={{ color: "#1d4ed8" }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 13, color: "#1e3a8a", margin: "0 0 12px" }}>
            The original import put every farmer's city as Oddanchatram. This sets each farmer's city to their real
            village (from the legacy <code>st1</code> field), keeping Oddanchatram only where no village was recorded.
            <b> Customers and all other parties are not touched.</b>
          </p>
          {result ? (
            <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: 12, fontSize: 13, color: "#065f46" }}>
              ✅ Done. Updated <b>{result.updated}</b> farmer cities.{result.missing > 0 && <> ({result.missing} codes in the file weren't found.)</>}
              <div style={{ marginTop: 6, color: "#047857" }}>Reload to see the updated parties.</div>
            </div>
          ) : !preview ? (
            <div style={{ color: "#666", fontSize: 13 }}>{busy ? "Loading preview…" : <button onClick={loadPreview} style={{ ...inputSm, width: "auto", cursor: "pointer" }}>Load preview</button>}</div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 12 }}>
                <StatCard label="Farmers matched" value={preview.matched} />
                <StatCard label="Cities to change" value={preview.will_change} color="#1d4ed8" big />
                {preview.missing > 0 && <StatCard label="Codes not found" value={preview.missing} />}
              </div>
              <details style={{ marginBottom: 12 }}>
                <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Examples (old → new)</summary>
                <div style={{ fontSize: 12, color: "#555", marginTop: 6 }}>
                  {(preview.sample || []).map(s => <div key={s.code}>{s.code}: <span style={{ color: "#999" }}>{s.old || "—"}</span> → <b>{s.new}</b></div>)}
                </div>
              </details>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Type FIX-CITIES" style={{ ...inputSm, width: 180 }} />
                <button onClick={apply} disabled={busy || confirm !== "FIX-CITIES"}
                  style={{ padding: "9px 18px", background: busy || confirm !== "FIX-CITIES" ? "#93c5fd" : "#2563eb", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: busy ? "default" : "pointer", fontSize: 13 }}>
                  {busy ? "Working…" : "📍 Fix farmer cities"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Promote each party's legacy city text into the Cities master + link city_id. Admin only.
function CitiesBackfillPanel() {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const loadPreview = () => {
    setBusy(true); setResult(null);
    api("admin?action=backfill-cities").then(r => setPreview(r.data)).catch(e => alert(e.message)).finally(() => setBusy(false));
  };
  useEffect(() => { if (open && !preview) loadPreview(); }, [open]);

  const apply = async () => {
    if (confirm !== "BACKFILL-CITIES") { alert('Type BACKFILL-CITIES exactly to proceed'); return; }
    setBusy(true);
    try {
      const r = await api("admin?action=backfill-cities", { method: "POST", body: JSON.stringify({ confirm }) });
      clearApiCache();
      setResult(r.data);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 28, border: "2px solid #ddd6fe", borderRadius: 12, padding: 18, background: "#f5f3ff" }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
        <div style={{ fontWeight: 700, color: "#7c3aed" }}>🏙️ Import cities from existing parties</div>
        <span style={{ color: "#7c3aed" }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 13, color: "#5b21b6", margin: "0 0 12px" }}>
            Every party already carries a village/town in its <code>city</code> text (from the legacy import), but those
            were never added to the <b>Cities</b> master nor linked. This collects every distinct city, adds the missing
            ones to the Cities list, and links each farmer &amp; customer to it — so the City shows in the dropdown and
            stays consistent. Safe to re-run; it only fills in what's missing.
          </p>
          {result ? (
            <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: 12, fontSize: 13, color: "#065f46" }}>
              ✅ Done. Added <b>{result.cities_created}</b> cities to the master and linked <b>{result.parties_linked}</b> parties
              across <b>{result.distinct_cities}</b> distinct cities.
              <div style={{ marginTop: 6, color: "#047857" }}>Reload Parties to see the linked cities.</div>
            </div>
          ) : !preview ? (
            <div style={{ color: "#666", fontSize: 13 }}>{busy ? "Loading preview…" : <button onClick={loadPreview} style={{ ...inputSm, width: "auto", cursor: "pointer" }}>Load preview</button>}</div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 12 }}>
                <StatCard label="Parties with a city" value={preview.parties_with_city} />
                <StatCard label="Distinct cities" value={preview.distinct_cities} />
                <StatCard label="New to add" value={preview.cities_to_create} color="#7c3aed" big />
                <StatCard label="Parties to link" value={preview.parties_to_link} color="#7c3aed" />
              </div>
              <details style={{ marginBottom: 12 }}>
                <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Breakdown &amp; examples</summary>
                <div style={{ fontSize: 12, color: "#555", marginTop: 6 }}>
                  <div style={{ marginBottom: 6 }}>{Object.entries(preview.by_category || {}).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>
                  {(preview.sample_new || []).length > 0 && <div>New cities (sample): {(preview.sample_new || []).join(", ")}</div>}
                </div>
              </details>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Type BACKFILL-CITIES" style={{ ...inputSm, width: 200 }} />
                <button onClick={apply} disabled={busy || confirm !== "BACKFILL-CITIES"}
                  style={{ padding: "9px 18px", background: busy || confirm !== "BACKFILL-CITIES" ? "#c4b5fd" : "#7c3aed", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: busy ? "default" : "pointer", fontSize: 13 }}>
                  {busy ? "Working…" : "🏙️ Import & link cities"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Import the 03-06 outstanding balances (transactions-only purge + set openings). Admin only.
function OutstandingImportPanel() {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const loadPreview = () => {
    setBusy(true); setResult(null);
    api("admin?action=import-outstanding").then(r => setPreview(r.data)).catch(e => alert(e.message)).finally(() => setBusy(false));
  };
  useEffect(() => { if (open && !preview) loadPreview(); }, [open]);

  const apply = async () => {
    if (confirm !== "IMPORT-OUTSTANDING") { alert('Type IMPORT-OUTSTANDING exactly to proceed'); return; }
    if (!window.confirm("This wipes ALL transactions and sets the new opening balances. Did you download a backup first?")) return;
    setBusy(true);
    try {
      const r = await api("admin?action=import-outstanding", { method: "POST", body: JSON.stringify({ confirm }) });
      clearApiCache();
      setResult(r.data);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const flagged = (preview?.new_suppliers || []).filter(s => /^(CASH|SM&CO)\.?$/i.test(s.code));

  return (
    <div style={{ marginTop: 28, border: "2px solid #fde68a", borderRadius: 12, padding: 18, background: "#fffbeb" }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
        <div style={{ fontWeight: 700, color: "#b45309" }}>📥 Import outstanding balances (as of 03-06)</div>
        <span style={{ color: "#b45309" }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 13, color: "#78350f", margin: "0 0 12px" }}>
            Wipes <b>all transactions</b> (bills, payments, ledger, yard, market, expenses) and resets every balance to zero,
            then sets the customer & supplier opening balances from your 03-06 file and creates their <code>OPEN-</code> bills.
            <b> Parties, products, trucks, discounts and settings are kept.</b> No undo — <b>download a backup above first.</b>
          </p>
          {result ? (
            <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: 12, fontSize: 13, color: "#065f46" }}>
              ✅ Done. Set <b>{result.opening_bills}</b> opening balances totalling {fmt.currency(result.opening_total)},
              created <b>{result.new_suppliers}</b> new suppliers.
              {result.missing_codes?.length > 0 && <div style={{ color: "#b45309", marginTop: 6 }}>Skipped (code not found): {result.missing_codes.join(", ")}</div>}
              <div style={{ marginTop: 6, color: "#047857" }}>Reload the app to see the new outstanding.</div>
            </div>
          ) : !preview ? (
            <div style={{ color: "#666", fontSize: 13 }}>{busy ? "Loading preview…" : <button onClick={loadPreview} style={{ ...inputSm, width: "auto", cursor: "pointer" }}>Load preview</button>}</div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 12 }}>
                <StatCard label="Customers matched" value={preview.matched_count} />
                <StatCard label="Matched total" value={fmt.currency(preview.matched_total)} />
                <StatCard label="New suppliers" value={preview.new_suppliers.length} />
                <StatCard label="Grand total" value={fmt.currency(preview.grand_total)} color="#b45309" big />
              </div>
              {preview.missing_codes?.length > 0 && (
                <div style={{ fontSize: 12, color: "#b45309", marginBottom: 8 }}>
                  ⚠️ {preview.missing_codes.length} code(s) not found, will be skipped: {preview.missing_codes.join(", ")}
                </div>
              )}
              {flagged.length > 0 && (
                <div style={{ fontSize: 12, color: "#b91c1c", marginBottom: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "8px 10px" }}>
                  ⚠️ These look like internal accounts, not real suppliers — tell Claude to drop them if they shouldn't be added: <b>{flagged.map(f => f.code).join(", ")}</b>
                </div>
              )}
              <details style={{ marginBottom: 12 }}>
                <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>New supplier accounts ({preview.new_suppliers.length})</summary>
                <div style={{ fontSize: 12, color: "#555", marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
                  {preview.new_suppliers.map(s => <div key={s.code}>{s.code} — {fmt.currency(s.total)}</div>)}
                </div>
              </details>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Type IMPORT-OUTSTANDING" style={{ ...inputSm, width: 230 }} />
                <button onClick={apply} disabled={busy || confirm !== "IMPORT-OUTSTANDING"}
                  style={{ padding: "9px 18px", background: busy || confirm !== "IMPORT-OUTSTANDING" ? "#fcd34d" : "#d97706", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: busy ? "default" : "pointer", fontSize: 13 }}>
                  {busy ? "Working…" : "📥 Purge & Import Outstanding"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Load historical purchase + sales bills from the legacy .mdb (Apr–May), as fully-settled
// records, and correct each vendor's dues to the 31-May closing. Re-runnable + revertible.
// Set every customer's opening balance from the uploaded "Balance List" sheet as of a
// cutoff: keep all bills but mark them paid through the cutoff, wipe the pre-cutoff ledger,
// and seed each listed customer's opening + ledger to the sheet figure. Preview, then apply.
function LegacyBalancesPanel() {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const loadPreview = () => {
    setBusy(true); setResult(null);
    api("admin?action=set-legacy-balances").then(r => setPreview(r.data)).catch(e => alert(e.message)).finally(() => setBusy(false));
  };
  useEffect(() => { if (open && !preview) loadPreview(); }, [open]);

  const apply = async () => {
    if (confirm !== "SET-LEGACY-BALANCES") { alert('Type SET-LEGACY-BALANCES exactly to proceed'); return; }
    if (!window.confirm("This marks all bills paid through the cutoff, wipes the pre-cutoff ledger, and sets opening balances from the sheet. It cannot be auto-undone. Did you download a backup above?")) return;
    setBusy(true);
    try { const r = await api("admin?action=set-legacy-balances", { method: "POST", body: JSON.stringify({ confirm }) });
          clearApiCache(); setResult(r.data); } catch (e) { alert(e.message); } finally { setBusy(false); }
  };
  const dl = (list, name, header) => { if (!list?.length) return; downloadCSV(name, [header, ...list]); };

  return (
    <div style={{ marginTop: 22, border: "2px solid #fca5a5", borderRadius: 12, padding: 18, background: "#fef2f2" }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
        <div style={{ fontWeight: 700, color: "#b91c1c" }}>📒 Set opening balances from Balance-List sheet (cutoff)</div>
        <span style={{ color: "#b91c1c" }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 13, color: "#7f1d1d", margin: "0 0 12px" }}>
            Keeps every bill but marks them <b>PAID through the cutoff date</b>, clears the pre-cutoff ledger, then sets each
            <b> listed customer's opening balance + ledger</b> to the figure in <code>legacy_balances.json</code> (from your
            sheet). Customers not in the sheet end at <b>0</b>. <b>This is not auto-reversible — download a backup first.</b>
          </p>
          {result ? (
            <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: 12, fontSize: 13, color: "#065f46" }}>
              ✅ Done. Set <b>{result.customers_set}</b> customers' opening balances (total {fmt.currency(result.target_total)}) as of <b>{result.as_of}</b>.
              {result.customers_created > 0 && <div style={{ color: "#047857", marginTop: 6 }}>Auto-created {result.customers_created} new customer(s): {(result.created_codes || []).join(", ")}</div>}
              <div style={{ marginTop: 6, color: "#047857" }}>Reload the app to see it.</div>
            </div>
          ) : !preview ? (
            <div style={{ color: "#666", fontSize: 13 }}>{busy ? "Checking…" : <button onClick={loadPreview} style={{ ...inputSm, width: "auto", cursor: "pointer" }}>Check now</button>}</div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "#7f1d1d", marginBottom: 8 }}>Cutoff date: <b>{preview.as_of}</b></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 12 }}>
                <StatCard label="Customers matched" value={preview.customers_matched} />
                <StatCard label="Opening total →" value={fmt.currency(preview.target_total)} color="#b91c1c" big />
                <StatCard label="Bills → mark paid" value={preview.bills_to_mark_paid} />
                <StatCard label="New to auto-create" value={preview.unmatched?.length || 0} color="#047857" />
              </div>
              {preview.unpaid_bills_after_cutoff > 0 && (
                <div style={{ fontSize: 12, color: "#b45309", marginBottom: 10 }}>
                  ⚠️ {preview.unpaid_bills_after_cutoff} unpaid bill(s) dated AFTER {preview.as_of} will stay unpaid and add on top of the opening. (Expected if there's activity after the cutoff.)
                </div>
              )}
              {preview.unmatched?.length > 0 && (
                <div style={{ fontSize: 12, color: "#047857", marginBottom: 10 }}>
                  {preview.unmatched.length} sheet customer(s) not in the system yet — will be <b>auto-created</b> as Market vendors: <b>{preview.unmatched.join(", ")}</b>
                </div>
              )}
              {preview.sample?.length > 0 && (
                <div style={{ marginBottom: 12, fontSize: 12, maxHeight: 220, overflow: "auto", border: "1px solid #fecaca", borderRadius: 8 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr style={{ background: "#fee2e2", color: "#7f1d1d", position: "sticky", top: 0 }}>
                      <th style={{ textAlign: "left", padding: "5px 8px" }}>Customer</th>
                      <th style={{ textAlign: "right", padding: "5px 8px" }}>Now</th>
                      <th style={{ textAlign: "right", padding: "5px 8px" }}>Sheet →</th>
                    </tr></thead>
                    <tbody>{preview.sample.map(s => (
                      <tr key={s.code} style={{ borderTop: "1px solid #fee2e2" }}>
                        <td style={{ padding: "4px 8px" }}>{s.code}</td>
                        <td style={{ textAlign: "right", padding: "4px 8px", color: "#6b7280" }}>{fmt.currency(s.current)}</td>
                        <td style={{ textAlign: "right", padding: "4px 8px", fontWeight: 700, color: s.current !== s.target ? "#b91c1c" : "#374151" }}>{fmt.currency(s.target)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Type SET-LEGACY-BALANCES" style={{ ...inputSm, width: 240 }} />
                <button onClick={apply} disabled={busy || confirm !== "SET-LEGACY-BALANCES"}
                  style={{ padding: "9px 18px", background: busy || confirm !== "SET-LEGACY-BALANCES" ? "#fca5a5" : "#b91c1c", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: busy ? "default" : "pointer", fontSize: 13 }}>
                  {busy ? "Working…" : "📒 Set opening balances"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Reconcile the Outstanding report to the Ledger (the source of truth). The bill-sum
// outstanding can read high when a vendor pays an advance; this resets each party's
// outstanding to its ledger balance. Read-only preview first, then apply.
function ReconcileOutstandingPanel() {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const loadPreview = () => {
    setBusy(true); setResult(null);
    api("admin?action=reconcile-outstanding").then(r => setPreview(r.data)).catch(e => alert(e.message)).finally(() => setBusy(false));
  };
  useEffect(() => { if (open && !preview) loadPreview(); }, [open]);

  const apply = async () => {
    if (confirm !== "RECONCILE-OUTSTANDING") { alert('Type RECONCILE-OUTSTANDING exactly to proceed'); return; }
    if (!window.confirm("Set each listed party's outstanding to its ledger balance? Download a backup first.")) return;
    setBusy(true);
    try { const r = await api("admin?action=reconcile-outstanding", { method: "POST", body: JSON.stringify({ confirm }) });
          clearApiCache(); setResult(r.data); } catch (e) { alert(e.message); } finally { setBusy(false); }
  };
  const downloadList = (list) => {
    if (!list?.length) return;
    downloadCSV(`outstanding_vs_ledger.csv`, [["Code", "Name", "Outstanding", "Ledger", "Diff"], ...list.map(m => [m.code, m.name, m.outstanding, m.ledger, m.diff])]);
  };

  return (
    <div style={{ marginTop: 22, border: "2px solid #fde68a", borderRadius: 12, padding: 18, background: "#fffbeb" }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
        <div style={{ fontWeight: 700, color: "#92400e" }}>⚖️ Reconcile outstanding to ledger</div>
        <span style={{ color: "#92400e" }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 13, color: "#78350f", margin: "0 0 12px" }}>
            The <b>ledger</b> (debit − credit) is the true balance. The Outstanding report sums unpaid bills,
            which can read <b>high</b> when a vendor pays an advance (the ledger is credited but no bill drops).
            This lists every party where they differ and resets each one's outstanding to its <b>ledger balance</b>.
            Nothing else changes; re-runnable. <b>Download a backup first.</b>
          </p>
          {result ? (
            <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: 12, fontSize: 13, color: "#065f46" }}>
              ✅ Reconciled <b>{result.parties_fixed}</b> parties (cleared {fmt.currency(result.net_overstatement_cleared)} net). Reload the app to see it.
            </div>
          ) : !preview ? (
            <div style={{ color: "#666", fontSize: 13 }}>{busy ? "Checking…" : <button onClick={loadPreview} style={{ ...inputSm, width: "auto", cursor: "pointer" }}>Check now</button>}</div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 12 }}>
                <StatCard label="Parties mismatched" value={preview.mismatched_parties} color="#b45309" />
                <StatCard label="Net overstatement" value={fmt.currency(preview.net_overstatement)} color="#b45309" big />
              </div>
              {preview.sample?.length > 0 ? (
                <>
                  <div style={{ fontSize: 12, marginBottom: 12, maxHeight: 260, overflow: "auto", border: "1px solid #fde68a", borderRadius: 8 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr style={{ background: "#fef3c7", color: "#92400e", position: "sticky", top: 0 }}>
                        <th style={{ textAlign: "left", padding: "5px 8px" }}>Party</th>
                        <th style={{ textAlign: "right", padding: "5px 8px" }}>Outstanding</th>
                        <th style={{ textAlign: "right", padding: "5px 8px" }}>Ledger →</th>
                        <th style={{ textAlign: "right", padding: "5px 8px" }}>Diff</th>
                      </tr></thead>
                      <tbody>{preview.sample.map(m => (
                        <tr key={m.party_id} style={{ borderTop: "1px solid #fef3c7" }}>
                          <td style={{ padding: "4px 8px" }}>{m.name || m.code}</td>
                          <td style={{ textAlign: "right", padding: "4px 8px", color: "#6b7280" }}>{fmt.currency(m.outstanding)}</td>
                          <td style={{ textAlign: "right", padding: "4px 8px", fontWeight: 700, color: "#16a34a" }}>{fmt.currency(m.ledger)}</td>
                          <td style={{ textAlign: "right", padding: "4px 8px", color: m.diff > 0 ? "#dc2626" : "#2563eb" }}>{m.diff > 0 ? "+" : ""}{fmt.currency(m.diff)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <button onClick={() => downloadList(preview.sample)} style={{ ...inputSm, width: "auto", cursor: "pointer" }}>⬇︎ Download list</button>
                    <input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Type RECONCILE-OUTSTANDING" style={{ ...inputSm, width: 250 }} />
                    <button onClick={apply} disabled={busy || confirm !== "RECONCILE-OUTSTANDING"}
                      style={{ padding: "9px 18px", background: busy || confirm !== "RECONCILE-OUTSTANDING" ? "#fcd34d" : "#b45309", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: busy ? "default" : "pointer", fontSize: 13 }}>
                      {busy ? "Working…" : "⚖️ Reconcile to ledger"}
                    </button>
                  </div>
                </>
              ) : <div style={{ color: "#16a34a", fontSize: 13, fontWeight: 600 }}>✅ Outstanding already matches the ledger for every party.</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Scoped, additive import: only the dated bills + outstanding sync, matching existing
// parties by code (never creates). Read-only preview first, then apply; revert available.
function ScopedImportPanel() {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const loadPreview = () => {
    setBusy(true); setResult(null);
    api("admin?action=import-scoped").then(r => setPreview(r.data)).catch(e => alert(e.message)).finally(() => setBusy(false));
  };
  useEffect(() => { if (open && !preview) loadPreview(); }, [open]);

  const apply = async () => {
    if (confirm !== "SCOPED-IMPORT") { alert('Type SCOPED-IMPORT exactly to proceed'); return; }
    if (!window.confirm("Import only the dated bills for matched parties and sync their outstanding to the legacy figure. Download a backup first?")) return;
    setBusy(true);
    try { const r = await api("admin?action=import-scoped", { method: "POST", body: JSON.stringify({ confirm }) });
          clearApiCache(); setResult(r.data); } catch (e) { alert(e.message); } finally { setBusy(false); }
  };
  const revert = async () => {
    if (!window.confirm("Remove the scoped import bills (IMP-*)? Outstanding values are not auto-restored.")) return;
    setBusy(true);
    try { const r = await api("admin?action=revert-scoped", { method: "POST", body: JSON.stringify({ confirm: "REVERT-SCOPED" }) });
          clearApiCache(); setResult({ reverted: true, ...r.data }); setPreview(null); } catch (e) { alert(e.message); } finally { setBusy(false); }
  };
  const downloadUnmatched = (list) => {
    if (!list?.length) return;
    downloadCSV(`unmatched_parties.csv`, [["Code", "Name (Tamil)"], ...list.map(u => [u.code, u.name])]);
  };

  return (
    <div style={{ marginTop: 22, border: "2px solid #c7d2fe", borderRadius: 12, padding: 18, background: "#eef2ff" }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
        <div style={{ fontWeight: 700, color: "#4338ca" }}>🎯 Scoped sync — dated bills + outstanding (match only, no create)</div>
        <span style={{ color: "#4338ca" }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 13, color: "#3730a3", margin: "0 0 12px" }}>
            Imports <b>only the bills in the window</b> (from <code>scoped_import.json</code>) for parties that <b>already exist</b>
            (matched by code), as settled records, and <b>overwrites each matched party's outstanding to its legacy figure</b>.
            It never creates parties, touches products, other dates, or settings. Unmatched names are reported for you to add.
            Safe to re-run; <b>Revert</b> removes the imported bills. <b>Download a backup first.</b>
          </p>
          {result ? (
            result.reverted ? (
              <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: 12, fontSize: 13, color: "#065f46" }}>
                ✅ Reverted — removed the scoped (IMP-) bills. Reload the app.
              </div>
            ) : (
              <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: 12, fontSize: 13, color: "#065f46" }}>
                ✅ Done. Imported <b>{result.purchase_bills}</b> purchase &amp; <b>{result.sales_bills}</b> sales bills,
                synced <b>{result.outstanding_updated}</b> parties' outstanding.
                {result.unmatched_parties?.length > 0 && (
                  <div style={{ color: "#b45309", marginTop: 6 }}>
                    {result.unmatched_parties.length} unmatched (not imported) — <button onClick={() => downloadUnmatched(result.unmatched_parties)} style={{ ...inputSm, width: "auto", cursor: "pointer", padding: "2px 8px" }}>download list</button>
                  </div>
                )}
                {result.outstanding_overflow?.length > 0 && (
                  <div style={{ color: "#b45309", marginTop: 6 }}>⚠️ {result.outstanding_overflow.length} parties already had unpaid bills above their legacy figure — left as-is.</div>
                )}
                <div style={{ marginTop: 6, color: "#047857" }}>Reload the app to see them.</div>
                <button onClick={revert} disabled={busy} style={{ marginTop: 10, padding: "7px 14px", background: "white", border: "1px solid #fca5a5", borderRadius: 7, color: "#b91c1c", fontWeight: 600, cursor: "pointer", fontSize: 12 }}>↩︎ Revert this import</button>
              </div>
            )
          ) : !preview ? (
            <div style={{ color: "#666", fontSize: 13 }}>{busy ? "Loading preview…" : <button onClick={loadPreview} style={{ ...inputSm, width: "auto", cursor: "pointer" }}>Load preview</button>}</div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "#3730a3", marginBottom: 8 }}>Window: <b>{preview.window?.[0]} → {preview.window?.[1]}</b></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 12 }}>
                <StatCard label="Purchase bills (matched)" value={preview.purchase_bills_matched} />
                <StatCard label="Sales bills (matched)" value={preview.sales_bills_matched} />
                <StatCard label="Outstanding to sync" value={preview.outstanding_parties_matched} color="#4338ca" big />
                <StatCard label="Unmatched parties" value={preview.unmatched_parties?.length || 0} color="#b45309" />
              </div>
              {preview.unmatched_parties?.length > 0 && (
                <div style={{ fontSize: 12, color: "#b45309", marginBottom: 10 }}>
                  {preview.unmatched_parties.length} party name(s) not in the system (will be skipped) —
                  <button onClick={() => downloadUnmatched(preview.unmatched_parties)} style={{ ...inputSm, width: "auto", cursor: "pointer", padding: "2px 8px", marginLeft: 6 }}>download report</button>
                  <div style={{ marginTop: 4, color: "#92400e" }}>{preview.unmatched_parties.slice(0, 8).map(u => u.name || u.code).join(", ")}{preview.unmatched_parties.length > 8 ? " …" : ""}</div>
                </div>
              )}
              {preview.outstanding_sample?.length > 0 && (
                <div style={{ marginBottom: 12, fontSize: 12 }}>
                  <div style={{ fontWeight: 700, color: "#3730a3", marginBottom: 4 }}>Outstanding change (sample):</div>
                  <table style={{ borderCollapse: "collapse" }}>
                    <thead><tr style={{ color: "#6b7280" }}><th style={{ textAlign: "left", padding: "2px 10px 2px 0" }}>Party</th><th style={{ textAlign: "right", padding: "2px 10px" }}>Now</th><th style={{ textAlign: "right", padding: "2px 10px" }}>Legacy →</th></tr></thead>
                    <tbody>{preview.outstanding_sample.map(s => (
                      <tr key={s.code}><td style={{ padding: "2px 10px 2px 0" }}>{s.name || s.code}</td><td style={{ textAlign: "right", padding: "2px 10px", color: "#6b7280" }}>{fmt.currency(s.current)}</td><td style={{ textAlign: "right", padding: "2px 10px", fontWeight: 700, color: s.legacy !== s.current ? "#4338ca" : "#374151" }}>{fmt.currency(s.legacy)}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              {(preview.already_imported?.purchase > 0 || preview.already_imported?.sales > 0) && (
                <div style={{ fontSize: 12, color: "#b45309", marginBottom: 10 }}>⚠️ Already imported: {preview.already_imported.purchase} purchase / {preview.already_imported.sales} sales. Applying again replaces them.</div>
              )}
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Type SCOPED-IMPORT" style={{ ...inputSm, width: 200 }} />
                <button onClick={apply} disabled={busy || confirm !== "SCOPED-IMPORT"}
                  style={{ padding: "9px 18px", background: busy || confirm !== "SCOPED-IMPORT" ? "#a5b4fc" : "#4338ca", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: busy ? "default" : "pointer", fontSize: 13 }}>
                  {busy ? "Working…" : "🎯 Apply scoped sync"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function LegacyBillsPanel() {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const loadPreview = () => {
    setBusy(true); setResult(null);
    api("admin?action=import-legacy-bills").then(r => setPreview(r.data)).catch(e => alert(e.message)).finally(() => setBusy(false));
  };
  useEffect(() => { if (open && !preview) loadPreview(); }, [open]);

  const apply = async () => {
    if (confirm !== "IMPORT-LEGACY-BILLS") { alert('Type IMPORT-LEGACY-BILLS exactly to proceed'); return; }
    if (!window.confirm("Import all historical bills and correct vendor dues to the 31-May closing. Did you download a backup above first?")) return;
    setBusy(true);
    try {
      const r = await api("admin?action=import-legacy-bills", { method: "POST", body: JSON.stringify({ confirm }) });
      clearApiCache(); setResult(r.data);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const revert = async () => {
    if (!window.confirm("Remove ALL imported legacy bills (LP/LS) and restore vendor openings to their original values?")) return;
    setBusy(true);
    try {
      const r = await api("admin?action=revert-legacy-bills", { method: "POST", body: JSON.stringify({ confirm: "REVERT-LEGACY-BILLS" }) });
      clearApiCache(); setResult({ reverted: true, ...r.data }); setPreview(null);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 22, border: "2px solid #bfdbfe", borderRadius: 12, padding: 18, background: "#eff6ff" }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
        <div style={{ fontWeight: 700, color: "#1d4ed8" }}>📚 Import historical bills (Apr–May) + correct vendor dues</div>
        <span style={{ color: "#1d4ed8" }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 13, color: "#1e3a8a", margin: "0 0 12px" }}>
            Loads the old purchase &amp; sales bills (with their real dates, names, products, rates and amounts) as
            <b> fully-settled history</b> — they appear in bill lists, reprints and date-range reports but do <b>not</b> post to the
            ledger or Day Book. Missing farmers/vendors are auto-created. Then each <b>vendor's outstanding is set to its true
            31-May closing balance</b>. Safe to re-run; a <b>Revert</b> button below undoes it. <b>Download a backup above first.</b>
          </p>
          {result ? (
            result.reverted ? (
              <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: 12, fontSize: 13, color: "#065f46" }}>
                ✅ Reverted. Removed imported bills and restored <b>{result.openings_restored}</b> vendor openings. Reload the app.
              </div>
            ) : (
              <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: 12, fontSize: 13, color: "#065f46" }}>
                ✅ Done. Imported <b>{result.purchase_bills}</b> purchase &amp; <b>{result.sales_bills}</b> sales bills,
                created <b>{result.parties_created}</b> parties, set <b>{result.vendor_dues_updated}</b> vendor dues
                (closing total {fmt.currency(result.closings_total)}).
                {(result.purchase_skipped > 0 || result.sales_skipped > 0) && <div style={{ color: "#b45309", marginTop: 6 }}>Skipped {result.purchase_skipped} purchase / {result.sales_skipped} sales (party not found).</div>}
                <div style={{ marginTop: 6, color: "#047857" }}>Reload the app to see them.</div>
                <button onClick={revert} disabled={busy} style={{ marginTop: 10, padding: "7px 14px", background: "white", border: "1px solid #fca5a5", borderRadius: 7, color: "#b91c1c", fontWeight: 600, cursor: "pointer", fontSize: 12 }}>↩︎ Revert this import</button>
              </div>
            )
          ) : !preview ? (
            <div style={{ color: "#666", fontSize: 13 }}>{busy ? "Loading preview…" : <button onClick={loadPreview} style={{ ...inputSm, width: "auto", cursor: "pointer" }}>Load preview</button>}</div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 12 }}>
                <StatCard label="Purchase bills" value={preview.purchase_bills} />
                <StatCard label="Sales bills" value={preview.sales_bills} />
                <StatCard label="New parties" value={preview.new_parties_to_create} />
                <StatCard label="Vendor dues → closing" value={fmt.currency(preview.closings_total)} color="#1d4ed8" big />
              </div>
              {(preview.already_imported?.purchase > 0 || preview.already_imported?.sales > 0) && (
                <div style={{ fontSize: 12, color: "#b45309", marginBottom: 10 }}>
                  ⚠️ Already imported: {preview.already_imported.purchase} purchase / {preview.already_imported.sales} sales bills. Applying again replaces them.
                </div>
              )}
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Type IMPORT-LEGACY-BILLS" style={{ ...inputSm, width: 240 }} />
                <button onClick={apply} disabled={busy || confirm !== "IMPORT-LEGACY-BILLS"}
                  style={{ padding: "9px 18px", background: busy || confirm !== "IMPORT-LEGACY-BILLS" ? "#93c5fd" : "#1d4ed8", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: busy ? "default" : "pointer", fontSize: 13 }}>
                  {busy ? "Working…" : "📚 Import historical bills"}
                </button>
                {(preview.already_imported?.purchase > 0 || preview.already_imported?.sales > 0) && (
                  <button onClick={revert} disabled={busy} style={{ padding: "9px 14px", background: "white", border: "1px solid #fca5a5", borderRadius: 8, color: "#b91c1c", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>↩︎ Revert</button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Business rules — coolie slabs, freight rate, default commission & credit days. Admin only.
function BusinessRulesPanel() {
  const [rules, setRules] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api("settings?action=rules").then(r => setRules(r.data)).catch(() => setRules({ ...DEFAULT_RULES })); }, []);
  const set = (k, v) => setRules(p => ({ ...p, [k]: v }));

  const FIELDS = [
    ["commission_pct",   "Commission % (default on purchase bills)"],
    ["credit_days",      "Vendor credit days (default on sales bills)"],
    ["freight_per_kg",   "Auto freight ₹ per kg (yard entry: weight × this)"],
    ["coolie_bag_small", "Coolie ₹/bag — up to the slab weight"],
    ["coolie_small_max", "Coolie slab weight (kg)"],
    ["coolie_bag_large", "Coolie ₹/bag — above the slab weight"],
    ["coolie_bag_zero",  "Coolie ₹/bag — bag-priced items (no weighing)"],
  ];

  const save = async () => {
    setSaving(true);
    try {
      await api("settings?action=rules-save", { method: "POST", body: JSON.stringify(rules) });
      clearBusinessRulesCache(); clearApiCache();
      alert("✅ Saved. New bills use these rules immediately (existing bills are untouched).");
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ marginTop: 22, border: "1px solid #e5e7eb", borderRadius: 12, padding: 18, background: "white" }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>⚙️ Business rules</div>
      <p style={{ fontSize: 13, color: "#666", margin: "0 0 14px" }}>
        The defaults used while billing — commission, credit days, auto freight and coolie slabs.
        Changing them affects <b>new entries only</b>; saved bills keep their stored values.
      </p>
      {!rules ? <div style={{ color: "#888", fontSize: 13 }}>Loading…</div> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
            {FIELDS.map(([k, label]) => (
              <div key={k}>
                <label style={labelStyle}>{label}</label>
                <input type="number" step="0.1" min="0" value={rules[k] ?? ""}
                  onChange={e => set(k, e.target.value)} style={inputSm} />
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 10 }}>
            Example with these values: a 25 kg bag costs ₹{rules.coolie_bag_small || 0} coolie, a 40 kg bag ₹{rules.coolie_bag_large || 0};
            a 200 kg yard entry auto-freights to ₹{(200 * (parseFloat(rules.freight_per_kg) || 0)).toFixed(0)}.
          </div>
          <button onClick={save} disabled={saving}
            style={{ marginTop: 14, padding: "10px 22px", background: saving ? "#9ca3af" : "#1a7a45", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
            {saving ? "Saving…" : "💾 Save rules"}
          </button>
        </>
      )}
    </div>
  );
}

// Download a full database backup (.sql) — admin only
function BackupPanel() {
  const [busy, setBusy] = useState(false);
  const [busySchema, setBusySchema] = useState(false);
  // kind: '' = full backup (data+structure); 'schema' = structure only (a map to commit)
  const grab = async (kind) => {
    const setter = kind === "schema" ? setBusySchema : setBusy;
    setter(true);
    try {
      const token = sessionStorage.getItem("rsm_token");
      const url = kind === "schema" ? "/api/backup.php?structure=1" : "/api/backup.php";
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) { let m = `Download failed (${res.status})`; try { const j = await res.json(); if (j.error) m = j.error; } catch {} throw new Error(m); }
      const blob = await res.blob();
      const link = URL.createObjectURL(blob);
      const a = document.createElement("a");
      // Schema downloads as a fixed "schema.sql" so it can be committed straight into the repo root.
      a.href = link;
      a.download = kind === "schema" ? "schema.sql" : `idnuk_backup_${new Date().toISOString().split("T")[0]}.sql`;
      a.click();
      URL.revokeObjectURL(link);
    } catch (e) { alert(e.message); }
    finally { setter(false); }
  };
  return (
    <div style={{ marginTop: 22, border: "1px solid #e5e7eb", borderRadius: 12, padding: 18, background: "white" }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>💾 Database backup</div>
      <p style={{ fontSize: 13, color: "#666", margin: "0 0 12px" }}>
        Download a complete copy of all your data as a <code>.sql</code> file. Keep a copy somewhere safe (Google Drive, email).
        Do this before any big change. Automatic nightly backups can also be set up — see the RUNBOOK.
      </p>
      <button onClick={() => grab("")} disabled={busy} style={{ padding: "10px 20px", background: busy ? "#9ca3af" : "#1a7a45", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: busy ? "default" : "pointer", fontSize: 14 }}>
        {busy ? "Preparing backup…" : "💾 Download backup now"}
      </button>

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #f0f0f0" }}>
        <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 14 }}>🗺️ Database map (schema only)</div>
        <p style={{ fontSize: 13, color: "#666", margin: "0 0 12px" }}>
          Downloads <code>schema.sql</code> — the table structure with <b>no data</b>. It's a readable map of the
          database for the developer. After downloading, save it into the project folder and commit it
          (see <code>RUNBOOK.md → "Regenerate schema.sql"</code>). Safe to share; contains no customer data.
        </p>
        <button onClick={() => grab("schema")} disabled={busySchema} style={{ padding: "9px 18px", background: busySchema ? "#9ca3af" : "#2563eb", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: busySchema ? "default" : "pointer", fontSize: 13 }}>
          {busySchema ? "Preparing…" : "🗺️ Download schema.sql"}
        </button>
      </div>
    </div>
  );
}

// One-time legacy data load: wipes ALL data and imports master from the .mdb export
function DangerZone() {
  const [open, setOpen]   = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy]   = useState(false);
  const [result, setResult] = useState(null);
  const [counts, setCounts] = useState(null);

  useEffect(() => { if (open && !counts) api("admin?action=counts").then(r => setCounts(r.data)).catch(() => {}); }, [open]);

  const run = async () => {
    if (confirm !== "RESET-AND-IMPORT") { alert('Type RESET-AND-IMPORT exactly to proceed'); return; }
    setBusy(true); setResult(null);
    try {
      const r = await api("admin?action=reset-import", { method: "POST", body: JSON.stringify({ confirm }) });
      clearApiCache();
      setResult(r.data);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 28, border: "2px solid #fecaca", borderRadius: 12, padding: 18, background: "#fff7f7" }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
        <div style={{ fontWeight: 700, color: "#b91c1c" }}>⚠️ Danger zone — legacy data import</div>
        <span style={{ color: "#b91c1c" }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 13, color: "#7f1d1d", margin: "0 0 12px" }}>
            This <b>permanently deletes every transaction, party and product</b> currently in the system, then imports the
            farmers, vendors, products and vendor opening balances from the legacy database. Login accounts and settings are kept.
            There is no undo — make sure you have a database backup first.
          </p>
          {counts && (
            <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
              Current data: {Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`).join(" · ") || "empty"}
            </div>
          )}
          {result ? (
            <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: 12, fontSize: 13, color: "#065f46" }}>
              ✅ Done. Imported <b>{result.imported_parties}</b> parties, <b>{result.imported_products}</b> products,
              and <b>{result.opening_bills}</b> opening balances totalling {fmt.currency(result.opening_total)}.
              <div style={{ marginTop: 6, color: "#047857" }}>Reload the app to see the new data.</div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Type RESET-AND-IMPORT" style={{ ...inputSm, width: 220 }} />
              <button onClick={run} disabled={busy || confirm !== "RESET-AND-IMPORT"}
                style={{ padding: "9px 18px", background: busy || confirm !== "RESET-AND-IMPORT" ? "#fca5a5" : "#dc2626", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: busy ? "default" : "pointer", fontSize: 13 }}>
                {busy ? "Working… (may take a minute)" : "🗑️ Wipe & Import Legacy Data"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UserForm({ user, onClose, onSaved }) {
  const [form, setForm] = useState({
    id: user?.id || null, username: user?.username || "", full_name: user?.full_name || "",
    password: "", role: user?.role || "staff", is_active: user?.is_active ?? 1,
    permissions: Array.isArray(user?.permissions) ? user.permissions : [],
  });
  const [saving, setSaving] = useState(false);
  const toggle = (id) => setForm(f => ({ ...f, permissions: f.permissions.includes(id) ? f.permissions.filter(x => x !== id) : [...f.permissions, id] }));
  const save = async () => {
    if (!form.username.trim()) { alert("Username required"); return; }
    if (!form.id && !form.password) { alert("Password required for a new user"); return; }
    setSaving(true);
    try { await api("auth?action=user-save", { method: "POST", body: JSON.stringify(form) }); onSaved(); }
    catch (e) { alert(e.message); } finally { setSaving(false); }
  };
  const isAdminRole = form.role === "admin";
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 12, padding: 22, width: 480, maxWidth: "92vw", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>{form.id ? "Edit User" : "Add User"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div><label style={labelStyle}>Username *</label><input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} style={inputSm} autoFocus /></div>
          <div><label style={labelStyle}>Full name</label><input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} style={inputSm} /></div>
          <div><label style={labelStyle}>Password {form.id ? "(blank = keep)" : "*"}</label><input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} style={inputSm} /></div>
          <div><label style={labelStyle}>Role</label>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} style={inputSm}>
              <option value="staff">Staff (limited)</option><option value="admin">Admin (full access)</option>
            </select>
          </div>
        </div>
        <label style={{ ...labelStyle, marginTop: 14 }}>Module access {isAdminRole && "(admins always see everything)"}</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, opacity: isAdminRole ? 0.5 : 1, pointerEvents: isAdminRole ? "none" : "auto" }}>
          {APP_MODULES.map(m => (
            <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "5px 8px", background: "#f9fafb", borderRadius: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={isAdminRole || form.permissions.includes(m.id)} onChange={() => toggle(m.id)} /> {m.label}
            </label>
          ))}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 14 }}>
          <input type="checkbox" checked={!!form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked ? 1 : 0 }))} /> Active (can log in)
        </label>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button onClick={onClose} style={{ padding: "9px 16px", background: "white", border: "1px solid #d1d5db", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ padding: "9px 20px", background: saving ? "#9ca3af" : "#1a7a45", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>{saving ? "Saving..." : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// TALLY / DAY BOOK — daily cash journal (opening → in/out → closing)
// ============================================================
export function TallyPage() {
  const [date, setDate]   = useState(new Date().toISOString().split("T")[0]);
  const [d, setD]         = useState(null);
  const [showBanks, setShowBanks] = useState(false);
  const [editOpen, setEditOpen]   = useState(false);
  const [entryKind, setEntryKind] = useState(null);   // 'collect' | 'payout' | 'expense'
  const [editAdv, setEditAdv]     = useState(null);   // farmer-advance row being edited
  const [q, setQ]                 = useState("");
  const ref = useRef();

  const load = () => {
    const url = `tally?action=daybook&date=${date}`;
    const warm = takePrefetch(url);   // warm copy from login (only matches the working date)
    return (warm ? warm.then(r => r || api(url)) : api(url)).then(r => r && setD(r)).catch(() => {});
  };
  useEffect(() => { load(); }, [date]);

  const fil = (rows, fields) => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(r => fields.some(f => String(r[f] ?? "").toLowerCase().includes(s)));
  };

  const delAdvance = async (r) => {
    if (!window.confirm(`Delete advance of ${fmt.currency(r.amount)} to ${r.party_name}?`)) return;
    try { await api("purchase?action=delete-advance", { method: "POST", body: JSON.stringify({ id: r.id }) }); load(); }
    catch (e) { alert(e.message); }
  };

  const csv = () => {
    if (!d) return;
    const rows = [["Day Book", fmt.date(date)], [],
      ["OPENING", "", "", d.opening.total],
      ["  Cash", "", "", d.opening.cash], ["  Bank", "", "", d.opening.bank], [],
      ["COLLECTIONS (credit)", "Party", "Mode", "Amount"],
      ...d.collections.map(c => ["", c.party_name, c.mode, c.amount]),
      ["FARMER PAYOUTS (debit)", "Party", "Mode", "Amount"],
      ...d.payouts.map(p => ["", p.party_name, p.mode, p.amount]),
      ["EXPENSES (debit)", "Description", "Mode", "Amount"],
      ...d.expenses.map(e => ["", e.description, e.mode, e.amount]),
      ["MARKET PAYOUTS (debit)", "Vendor", "Mode", "Amount"],
      ...(d.marketPayouts || []).map(p => ["", p.party_name, p.mode, p.amount]),
      ["FARMER ADVANCES (debit)", "Farmer", "Mode", "Amount"],
      ...(d.advances || []).map(a => ["", a.party_name, a.mode, a.amount]),
      [], ["CLOSING", "", "", d.closing.total],
      ["  Cash", "", "", d.closing.cash], ["  Bank", "", "", d.closing.bank]];
    downloadCSV(`daybook_${date}.csv`, rows);
  };

  const Section = ({ title, color, rows, cols, actions }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 6 }}>{title}</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {rows.length === 0 ? <tr><td style={{ ...rptTd, textAlign: "left", color: "#888" }}>None</td></tr> :
           rows.map((r, i) => (
            <tr key={i}>
              <td style={{ ...rptTd, textAlign: "left", fontWeight: 600 }}>{cols.name(r)}</td>
              <td style={{ ...rptTd, textAlign: "left", color: "#666" }}>{cols.sub(r)}</td>
              <td style={{ ...rptTd, textAlign: "left", color: "#888", fontSize: 11 }}>{(r.mode || "cash").toUpperCase()}{r.bank_name ? ` · ${r.bank_name}` : ""}</td>
              <td style={{ ...rptTd, fontWeight: 700, color }}>{fmt.currency(r.amount)}</td>
              {actions && <td style={{ ...rptTd, textAlign: "right", whiteSpace: "nowrap" }} className="no-print">{actions(r)}</td>}
            </tr>
           ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div style={{ padding: 24 }}>
      <div className="no-print" style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 16, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>📒 Day Book</h1>
        <div style={{ flex: 1 }} />
        <div><label style={labelStyle}>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputSm} /></div>
        <div style={{ minWidth: 200 }}><label style={labelStyle}>Search</label><input value={q} onChange={e => setQ(e.target.value)} placeholder="party / receipt / bill no" style={inputSm} /></div>
        <button onClick={() => setEditOpen(true)} style={{ padding: "9px 14px", background: "white", border: "1px solid #d1d5db", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>⚙️ Set Opening</button>
        {d && <button onClick={csv} style={{ padding: "9px 14px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, color: "#16a34a", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>⬇️ CSV</button>}
        {d && <button onClick={() => printReport(ref.current)} style={{ padding: "9px 14px", background: "#1a7a45", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>🖨️ Print</button>}
      </div>

      {/* Quick entries — update the day book without leaving this page */}
      <div className="no-print" style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <button onClick={() => setEntryKind("collect")} style={{ padding: "10px 18px", background: "#16a34a", border: "none", borderRadius: 9, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>➕ Collect from Vendor</button>
        <button onClick={() => setEntryKind("payout")} style={{ padding: "10px 18px", background: "#dc2626", border: "none", borderRadius: 9, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>➖ Pay Farmer</button>
        <button onClick={() => setEntryKind("payout-old")} style={{ padding: "10px 18px", background: "#b45309", border: "none", borderRadius: 9, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>💸 Pay Old Farmer Bills</button>
        <button onClick={() => setEntryKind("advance")} style={{ padding: "10px 18px", background: "#7c3aed", border: "none", borderRadius: 9, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>🌱 Farmer Advance</button>
        <button onClick={() => setEntryKind("expense")} style={{ padding: "10px 18px", background: "#ea580c", border: "none", borderRadius: 9, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>🧾 Add Expense</button>
      </div>

      {!d ? <div style={reportSheet}><SkeletonRows rows={10} cols={4} /></div> :
      <div ref={ref} style={reportSheet}>
        <ReportTitle title="Day Book / Cash Journal" from={date} to={date} />

        {/* Opening */}
        <div onClick={() => setShowBanks(s => !s)} style={{ cursor: "pointer", background: "#f9fafb", borderRadius: 10, padding: "12px 16px", margin: "14px 0", border: "1px solid #eef2f7" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>Opening Balance <span style={{ fontSize: 11, color: "#888" }}>(click for cash / bank)</span></div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{fmt.currency(d.opening.total)}</div>
          </div>
          {showBanks && (
            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
              <StatCard label="💵 Cash in hand" value={fmt.currency(d.opening.cash)} />
              <StatCard label="🏦 In bank(s)" value={fmt.currency(d.opening.bank)} />
              {(d.opening.banks || []).map((b, i) => <StatCard key={i} label={`🏦 ${b.name}`} value={fmt.currency(b.amount)} />)}
            </div>
          )}
        </div>

        <Section title="➕ Collections received (CREDIT)" color="#16a34a"
          rows={fil(d.collections, ["party_name", "receipt_no", "payment_ref"])} cols={{ name: r => r.party_name, sub: r => r.receipt_no }} />
        <div style={{ textAlign: "right", fontSize: 12, color: "#16a34a", marginTop: -8, marginBottom: 14 }}>
          Total in: <strong>{fmt.currency(d.totals.collections.total)}</strong> (cash {fmt.currency(d.totals.collections.cash)} · bank {fmt.currency(d.totals.collections.bank)})
        </div>

        <Section title="➖ Farmer / Supplier payouts (DEBIT)" color="#dc2626"
          rows={fil(d.payouts, ["party_name", "payment_ref", "purchase_bill_id"])} cols={{ name: r => r.party_name, sub: r => r.payment_ref || "" }} />
        <Section title="➖ Expenses (DEBIT)" color="#dc2626"
          rows={fil(d.expenses, ["category", "description"])} cols={{ name: r => r.category || "Expense", sub: r => r.description }} />
        <Section title="➖ Market vendor payouts (DEBIT)" color="#dc2626"
          rows={fil(d.marketPayouts || [], ["party_name"])} cols={{ name: r => r.party_name, sub: () => "Settlement" }} />
        <Section title="🌱 Farmer advances given (DEBIT)" color="#7c3aed"
          rows={fil(d.advances || [], ["party_name", "payment_ref", "notes"])}
          cols={{ name: r => r.party_name, sub: r => r.notes || r.payment_ref || "Crop advance" }}
          actions={r => (
            <>
              <button onClick={() => setEditAdv(r)} style={{ padding: "4px 10px", marginRight: 6, background: "#f3e8ff", border: "1px solid #ddd6fe", borderRadius: 6, color: "#7c3aed", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Edit</button>
              <button onClick={() => delAdvance(r)} title="Delete advance" style={{ padding: "4px 8px", background: "#fee2e2", border: "none", borderRadius: 6, color: "#dc2626", fontSize: 12, cursor: "pointer" }}>✕</button>
            </>
          )} />
        <div style={{ textAlign: "right", fontSize: 12, color: "#dc2626", marginTop: -8, marginBottom: 14 }}>
          Total out: <strong>{fmt.currency(d.totals.payouts.total + d.totals.expenses.total + (d.totals.market?.total || 0) + (d.totals.advances?.total || 0))}</strong>
        </div>

        {/* Closing tally */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, borderTop: "2px solid #1a7a45", paddingTop: 14 }}>
          <StatCard label="Closing — Cash in hand" value={fmt.currency(d.closing.cash)} />
          <StatCard label="Closing — Bank" value={fmt.currency(d.closing.bank)} />
          <StatCard label="Closing — Total" value={fmt.currency(d.closing.total)} big color="#1a7a45" />
        </div>

        {/* Memo */}
        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
          <StatCard label="Vendors owe us (receivable)" value={fmt.currency(d.memo.receivable)} color="#2563eb" />
          <StatCard label="We owe farmers (payable)" value={fmt.currency(d.memo.payable)} color="#ea580c" />
          <StatCard label="Commission earned today" value={fmt.currency(d.memo.commission_today)} color="#7c3aed" />
        </div>
      </div>}

      {editOpen && <OpeningBalanceModal onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); load(); }} />}
      {entryKind && <TallyEntryModal kind={entryKind} date={date} onClose={() => setEntryKind(null)} onSaved={() => { setEntryKind(null); load(); }} />}
      {editAdv && <AdvanceEditModal adv={editAdv} onClose={() => setEditAdv(null)} onSaved={() => { setEditAdv(null); load(); }} />}
    </div>
  );
}

function OpeningBalanceModal({ onClose, onSaved }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api("settings?action=opening").then(r => setForm({ as_of: r.data.as_of, cash: r.data.cash, banks: r.data.banks?.length ? r.data.banks : [{ name: "", amount: 0 }] })).catch(() => {}); }, []);
  if (!form) return null;
  const setBank = (i, k, v) => setForm(f => ({ ...f, banks: f.banks.map((b, j) => j === i ? { ...b, [k]: v } : b) }));
  const save = async () => {
    setSaving(true);
    try { await api("settings?action=opening-save", { method: "POST", body: JSON.stringify(form) }); onSaved(); }
    catch (e) { alert(e.message); } finally { setSaving(false); }
  };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 12, padding: 22, width: 460, maxWidth: "92vw", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Opening Balance</div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>Set once. Every day's opening carries forward automatically from here.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div><label style={labelStyle}>As of date</label><input type="date" value={form.as_of} onChange={e => setForm(f => ({ ...f, as_of: e.target.value }))} style={inputSm} /></div>
          <div><label style={labelStyle}>Cash in hand ₹</label><input type="number" value={form.cash} onChange={e => setForm(f => ({ ...f, cash: e.target.value }))} style={inputSm} /></div>
        </div>
        <label style={labelStyle}>Bank balances</label>
        {form.banks.map((b, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input value={b.name} onChange={e => setBank(i, "name", e.target.value)} placeholder="Bank name" style={{ ...inputSm, flex: 1 }} />
            <input type="number" value={b.amount} onChange={e => setBank(i, "amount", e.target.value)} placeholder="₹" style={{ ...inputSm, width: 120 }} />
            <button onClick={() => setForm(f => ({ ...f, banks: f.banks.filter((_, j) => j !== i) }))} style={{ padding: "0 10px", background: "#fee2e2", border: "none", borderRadius: 6, color: "#dc2626", cursor: "pointer" }}>✕</button>
          </div>
        ))}
        <button onClick={() => setForm(f => ({ ...f, banks: [...f.banks, { name: "", amount: 0 }] }))} style={{ padding: "5px 12px", background: "#eff6ff", border: "1px dashed #bfdbfe", borderRadius: 8, color: "#2563eb", fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 18 }}>+ Add Bank</button>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "9px 16px", background: "white", border: "1px solid #d1d5db", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ padding: "9px 20px", background: saving ? "#9ca3af" : "#1a7a45", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>{saving ? "Saving..." : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

// Edit an existing farmer advance straight from the Day Book.
function AdvanceEditModal({ adv, onClose, onSaved }) {
  const [form, setForm] = useState({
    amount: String(adv.amount ?? ""), mode: adv.mode || "cash",
    ref: adv.payment_ref || "", notes: adv.notes || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    const amt = parseFloat(form.amount) || 0;
    if (amt <= 0) { alert("Enter an amount"); return; }
    setSaving(true);
    try {
      await api("purchase?action=update-advance", { method: "POST", body: JSON.stringify({
        id: adv.id, amount: amt, payment_mode: form.mode, payment_ref: form.ref || null, notes: form.notes || null,
      }) });
      onSaved();
    } catch (e) { alert(e.message); } finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 12, padding: 22, width: 420, maxWidth: "92vw", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: "#7c3aed" }}>🌱 Edit Farmer Advance</div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>{adv.party_name} — updates the day book.</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <div><label style={labelStyle}>Amount ₹</label><input type="number" value={form.amount} onChange={e => set("amount", e.target.value)} style={{ ...inputSm, width: 140 }} /></div>
          <div><label style={labelStyle}>Mode</label>
            <select value={form.mode} onChange={e => set("mode", e.target.value)} style={{ ...inputSm, width: 110 }}>
              <option value="cash">Cash</option><option value="bank">Bank</option><option value="upi">UPI</option><option value="cheque">Cheque</option>
            </select>
          </div>
          <div><label style={labelStyle}>Ref</label><input value={form.ref} onChange={e => set("ref", e.target.value)} placeholder="UPI/Cheque" style={{ ...inputSm, width: 120 }} /></div>
        </div>
        <div style={{ marginBottom: 18 }}><label style={labelStyle}>Notes</label><input value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="e.g. for onion crop" style={{ ...inputSm, width: "100%" }} /></div>
        {parseFloat(adv.adjusted_amt) > 0 && <div style={{ fontSize: 11, color: "#92400e", marginBottom: 14 }}>⚠️ {fmt.currency(adv.adjusted_amt)} already recovered against this advance.</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "9px 16px", background: "white", border: "1px solid #d1d5db", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ padding: "9px 22px", background: saving ? "#9ca3af" : "#7c3aed", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

// Quick day-book entry: collect from a vendor, pay a farmer, or log an expense — without leaving Tally.
function TallyEntryModal({ kind, date, onClose, onSaved }) {
  const [saving, setSaving]   = useState(false);
  const [vendors, setVendors] = useState([]);      // collect: grouped {party_id,name,name_ta,total}
  const [fBills, setFBills]   = useState([]);       // payout: raw farmer bills
  const [farmers, setFarmers] = useState([]);      // payout-old: full farmer list (no bill needed)
  const cats = EXPENSE_CATEGORIES;                  // expense: standard categories
  const [form, setForm] = useState({ party_id: "", bill_id: "", amount: "", discount: "", mode: "cash", ref: "", category_id: "", description: "", notes: "", pay_date: date });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    if (kind === "collect") api("parties?action=outstanding").then(r => {
      const g = {}; (r.data || []).forEach(row => {
        if (!g[row.party_id]) g[row.party_id] = { party_id: row.party_id, name: row.vendor_name, name_ta: row.vendor_name_ta, total: 0 };
        g[row.party_id].total += parseFloat(row.balance_due);
      });
      setVendors(Object.values(g).sort((a, b) => b.total - a.total));
    }).catch(() => {});
    if (kind === "payout")     api("purchase?action=farmer-outstanding").then(r => setFBills(r.data || [])).catch(() => {});
    if (kind === "payout-old" || kind === "advance") api("parties?action=list&category=FARMER&active=all&cols=lite").then(r => setFarmers(r.data || [])).catch(() => {});
  }, [kind]);

  const titles = { collect: "➕ Collect from Vendor", payout: "➖ Pay Farmer", "payout-old": "💸 Pay Old Farmer Bills", advance: "🌱 Farmer Advance", expense: "🧾 Add Expense" };
  const accent = { collect: "#16a34a", payout: "#dc2626", "payout-old": "#b45309", advance: "#7c3aed", expense: "#ea580c" }[kind];

  const selVendor = vendors.find(v => String(v.party_id) === String(form.party_id));
  const farmerGroups = Object.values(fBills.reduce((acc, b) => {
    if (!acc[b.party_id]) acc[b.party_id] = { party_id: b.party_id, name: b.farmer_name, name_ta: b.farmer_name_ta, total: 0 };
    acc[b.party_id].total += parseFloat(b.net_payable); return acc;
  }, {}));
  const farmerBills = fBills.filter(b => String(b.party_id) === String(form.party_id));

  const submit = async () => {
    const amt = parseFloat(form.amount) || 0;
    setSaving(true);
    try {
      if (kind === "collect") {
        const disc = parseFloat(form.discount) || 0;
        if (!form.party_id || (amt <= 0 && disc <= 0)) { alert("Pick a vendor and enter an amount and/or discount"); setSaving(false); return; }
        const payRes = await api("sales?action=payment", { method: "POST", body: JSON.stringify({ party_id: form.party_id, amount: amt, discount: disc, payment_mode: form.mode, payment_ref: form.ref || null, receipt_date: date }) });
        if (payRes.data?.id && window.confirm(`✅ Receipt ${payRes.data.receipt_no} recorded.\n\nSend the receipt on WhatsApp?`)) shareReceiptWA(payRes.data.id);
      } else if (kind === "payout") {
        if (!form.bill_id || amt <= 0) { alert("Pick a bill and enter an amount"); setSaving(false); return; }
        await api("purchase?action=pay-farmer", { method: "POST", body: JSON.stringify({ bill_id: form.bill_id, amount: amt, payment_mode: form.mode, payment_ref: form.ref || null }) });
      } else if (kind === "payout-old") {
        // Back-dated cash-out with no bill mapping — just feeds the day book tally during the pilot.
        if (!form.party_id || amt <= 0) { alert("Pick a farmer and enter an amount"); setSaving(false); return; }
        const farmer = farmers.find(f => String(f.id) === String(form.party_id));
        await api("purchase?action=pay-farmer-adhoc", { method: "POST", body: JSON.stringify({ party_id: form.party_id, party_name: farmer?.name_en || "", amount: amt, pay_date: form.pay_date, payment_mode: form.mode, payment_ref: form.ref || null }) });
      } else if (kind === "advance") {
        if (!form.party_id || amt <= 0) { alert("Pick a farmer and enter an amount"); setSaving(false); return; }
        const farmer = farmers.find(f => String(f.id) === String(form.party_id));
        await api("purchase?action=give-advance", { method: "POST", body: JSON.stringify({ party_id: form.party_id, party_name: farmer?.name_en || "", amount: amt, advance_date: date, payment_mode: form.mode, payment_ref: form.ref || null, notes: form.notes || null }) });
      } else {
        if (!form.category_id || !form.description || amt <= 0) { alert("Fill category, description and amount"); setSaving(false); return; }
        await api("reports?action=add-expense", { method: "POST", body: JSON.stringify({ expense_date: date, category_id: form.category_id, description: form.description, amount: amt, payment_mode: form.mode, notes: form.notes || null }) });
      }
      onSaved();
    } catch (e) { alert(e.message); } finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 12, padding: 22, width: 440, maxWidth: "92vw", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: accent }}>{titles[kind]}</div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>Recorded against {fmt.date(kind === "payout-old" ? form.pay_date : date)} — updates the day book.</div>

        {kind === "collect" && (
          <>
            <div style={{ marginBottom: 12 }}><label style={labelStyle}>Vendor</label>
              <SearchableSelect value={form.party_id} options={vendors.map(v => ({ id: v.party_id, label: `${v.name}${v.name_ta ? " / " + v.name_ta : ""} — owes ${fmt.currency(v.total)}` }))}
                onChange={(id) => setForm(f => ({ ...f, party_id: id, amount: String(vendors.find(v => String(v.party_id) === String(id))?.total || "") }))}
                placeholder="🔍 Search vendor with outstanding..." style={{ ...inputSm, width: "100%" }} />
              {selVendor && <div style={{ fontSize: 12, color: "#1d4ed8", marginTop: 5 }}>Owes {fmt.currency(selVendor.total)}</div>}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <div><label style={labelStyle}>Amount ₹</label><input type="number" value={form.amount} onChange={e => set("amount", e.target.value)} style={{ ...inputSm, width: 120 }} /></div>
              <div><label style={labelStyle}>Discount ₹</label><input type="number" value={form.discount} onChange={e => set("discount", e.target.value)} placeholder="0" style={{ ...inputSm, width: 100 }} /></div>
            </div>
          </>
        )}

        {kind === "payout" && (
          <>
            <div style={{ marginBottom: 12 }}><label style={labelStyle}>Farmer</label>
              <SearchableSelect value={form.party_id} options={farmerGroups.map(v => ({ id: v.party_id, label: `${v.name}${v.name_ta ? " / " + v.name_ta : ""} — owed ${fmt.currency(v.total)}` }))}
                onChange={(id) => setForm(f => ({ ...f, party_id: id, bill_id: "", amount: "" }))}
                placeholder="🔍 Search farmer with unpaid bills..." style={{ ...inputSm, width: "100%" }} />
            </div>
            {form.party_id && (
              <div style={{ marginBottom: 12 }}><label style={labelStyle}>Bill</label>
                <select value={form.bill_id} onChange={e => { const b = farmerBills.find(x => String(x.id) === e.target.value); setForm(f => ({ ...f, bill_id: e.target.value, amount: b ? String(b.net_payable) : "" })); }} style={{ ...inputSm, width: "100%" }}>
                  <option value="">Select a bill…</option>
                  {farmerBills.map(b => <option key={b.id} value={b.id}>{b.bill_no} — {fmt.currency(b.net_payable)}</option>)}
                </select>
              </div>
            )}
            <div style={{ marginBottom: 12 }}><label style={labelStyle}>Amount ₹</label><input type="number" value={form.amount} onChange={e => set("amount", e.target.value)} style={{ ...inputSm, width: 140 }} /></div>
          </>
        )}

        {kind === "payout-old" && (
          <>
            <div style={{ marginBottom: 12, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 12px" }}>
              <label style={labelStyle}>Payment date (back-date)</label>
              <input type="date" max={new Date().toISOString().split("T")[0]} value={form.pay_date}
                onChange={e => set("pay_date", e.target.value)} style={{ ...inputSm, width: "100%" }} />
              <div style={{ fontSize: 11, color: "#92400e", marginTop: 5 }}>No bill needed — records a cash-out to this farmer on the chosen past date so the day book tally reconciles. Locked days are still protected.</div>
            </div>
            <div style={{ marginBottom: 12 }}><label style={labelStyle}>Farmer</label>
              <SearchableSelect value={form.party_id} options={farmers.map(f => ({ id: f.id, label: `${f.name_en}${f.name_ta ? " / " + f.name_ta : ""}` }))}
                onChange={(id) => set("party_id", id)}
                placeholder="🔍 Search farmer..." style={{ ...inputSm, width: "100%" }} />
            </div>
            <div style={{ marginBottom: 12 }}><label style={labelStyle}>Amount paid ₹</label><input type="number" value={form.amount} onChange={e => set("amount", e.target.value)} placeholder="Cash given to farmer" style={{ ...inputSm, width: 180 }} /></div>
          </>
        )}

        {kind === "advance" && (
          <>
            <div style={{ marginBottom: 12, background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 8, padding: "10px 12px", fontSize: 11, color: "#5b21b6" }}>
              Advance money given to a farmer before goods arrive (crop support). Records a cash-out in the day book and is tracked against the farmer in <b>Reports → Farmer Advances</b> until recovered.
            </div>
            <div style={{ marginBottom: 12 }}><label style={labelStyle}>Farmer</label>
              <SearchableSelect value={form.party_id} options={farmers.map(f => ({ id: f.id, label: `${f.name_en}${f.name_ta ? " / " + f.name_ta : ""}` }))}
                onChange={(id) => set("party_id", id)}
                placeholder="🔍 Search farmer..." style={{ ...inputSm, width: "100%" }} />
            </div>
            <div style={{ marginBottom: 12 }}><label style={labelStyle}>Advance amount ₹</label><input type="number" value={form.amount} onChange={e => set("amount", e.target.value)} placeholder="Cash given as advance" style={{ ...inputSm, width: 180 }} /></div>
            <div style={{ marginBottom: 12 }}><label style={labelStyle}>Notes</label><input value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="e.g. for onion crop" style={{ ...inputSm, width: "100%" }} /></div>
          </>
        )}

        {kind === "expense" && (
          <>
            <div style={{ marginBottom: 12 }}><label style={labelStyle}>Category</label>
              <select value={form.category_id} onChange={e => set("category_id", e.target.value)} style={{ ...inputSm, width: "100%" }}>
                <option value="">Select…</option>
                {cats.map(c => <option key={c.id} value={c.id}>{c.name_en || c.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 12 }}><label style={labelStyle}>Description</label><input value={form.description} onChange={e => set("description", e.target.value)} placeholder="What was this expense for?" style={{ ...inputSm, width: "100%" }} /></div>
            <div style={{ marginBottom: 12 }}><label style={labelStyle}>Amount ₹</label><input type="number" value={form.amount} onChange={e => set("amount", e.target.value)} style={{ ...inputSm, width: 140 }} /></div>
          </>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
          <div><label style={labelStyle}>Mode</label>
            <select value={form.mode} onChange={e => set("mode", e.target.value)} style={{ ...inputSm, width: 110 }}>
              <option value="cash">Cash</option><option value="bank">Bank</option><option value="upi">UPI</option><option value="cheque">Cheque</option>
            </select>
          </div>
          {kind !== "expense" && <div><label style={labelStyle}>Ref</label><input value={form.ref} onChange={e => set("ref", e.target.value)} placeholder="UPI/Cheque" style={{ ...inputSm, width: 120 }} /></div>}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "9px 16px", background: "white", border: "1px solid #d1d5db", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ padding: "9px 22px", background: saving ? "#9ca3af" : accent, border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PRINT CENTER — editable template, find & print bills, party ledger
// ============================================================
export function PrintCenterPage() {
  const [tab, setTab] = useState("bills");
  const tabs = [
    { id: "bills",    label: "Find & Print Bills", icon: "🧾" },
    { id: "ledger",   label: "Party Ledger",       icon: "📜" },
    { id: "template", label: "Bill Template",      icon: "🎨" },
    { id: "preprint", label: "Pre-print Align",    icon: "📐" },
  ];
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ margin: "0 0 20px", fontSize: 22, fontWeight: 700 }}>🖨️ Print Center</h1>
      <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer",
            background: tab === t.id ? "#1a7a45" : "white", color: tab === t.id ? "white" : "#374151",
            fontSize: 13, fontWeight: 600, boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
          }}>{t.icon} {t.label}</button>
        ))}
      </div>
      {tab === "bills"    && <BillPrintFinder />}
      {tab === "ledger"   && <PartyLedgerReport />}
      {tab === "template" && <PrintTemplateEditor />}
      {tab === "preprint" && <PreprintEditor />}
    </div>
  );
}

// Edit the letterhead/template used on all printed bills
function PrintTemplateEditor() {
  const [tpl, setTpl] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api("settings?action=print").then(r => setTpl(r.data)).catch(() => {}); }, []);
  const set = (k, v) => setTpl(p => ({ ...p, [k]: v }));

  const onLogo = (file) => {
    if (!file) return;
    if (file.size > 1400000) { alert("Image too large — pick one under ~1.4 MB"); return; }
    const reader = new FileReader();
    reader.onload = () => set("logo", reader.result);
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api("settings?action=print-save", { method: "POST", body: JSON.stringify(tpl) });
      clearPrintTemplateCache();
      alert("✅ Template saved — applies to all printed bills.");
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  if (!tpl) return <div style={{ padding: 20, color: "#666" }}>Loading template...</div>;
  const F = ({ k, label, ta }) => (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>{label}</label>
      <input value={tpl[k] || ""} onChange={e => set(k, e.target.value)}
        style={{ ...inputSm, fontFamily: ta ? "'Noto Sans Tamil', sans-serif" : "inherit" }} />
    </div>
  );

  return (
    <div style={{ background: "white", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", maxWidth: 640 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Letterhead / Template (used on every printed bill)</div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Logo</label>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {tpl.logo ? <img src={tpl.logo} alt="logo" style={{ maxHeight: 60, border: "1px solid #e5e7eb", borderRadius: 6, padding: 4 }} /> : <span style={{ color: "#888", fontSize: 12 }}>No logo</span>}
          <input type="file" accept="image/*" onChange={e => onLogo(e.target.files?.[0])} style={{ fontSize: 12 }} />
          {tpl.logo && <button onClick={() => set("logo", "")} style={{ padding: "4px 10px", background: "#fee2e2", border: "none", borderRadius: 6, color: "#dc2626", cursor: "pointer", fontSize: 12 }}>Remove</button>}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <F k="company_en" label="Company name (English)" />
        <F k="company_ta" label="Company name (தமிழ்)" ta />
        <F k="subtitle_en" label="Subtitle (English)" />
        <F k="subtitle_ta" label="Subtitle (தமிழ்)" ta />
      </div>
      <F k="address" label="Address" />
      <F k="address_ta" label="Address (தமிழ்)" ta />
      <F k="phone" label="Phone" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <F k="greeting_left" label="Greeting (left, தமிழ்)" ta />
        <F k="greeting_right" label="Greeting (right, தமிழ்)" ta />
      </div>
      <F k="footer" label="Footer line (தமிழ்)" ta />

      {/* ── Print format ── */}
      <div style={{ borderTop: "1px solid #eef2f7", marginTop: 18, paddingTop: 16 }}>
        <label style={labelStyle}>Default print format</label>
        <div style={{ display: "flex", gap: 0, borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb", width: "fit-content", marginBottom: 6 }}>
          {[{ id: "full", label: "🧾 Full letterhead (A5)" }, { id: "preprinted", label: "📄 Pre-printed paper (A5, values only)" }, { id: "thermal", label: "🧮 Thermal (80mm roll)" }].map(o => (
            <button key={o.id} onClick={() => set("print_format", o.id)} style={{ padding: "8px 16px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
              background: (tpl.print_format || "full") === o.id ? "#1a7a45" : "white", color: (tpl.print_format || "full") === o.id ? "white" : "#374151" }}>{o.label}</button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>
          Full letterhead = the app prints the whole bill (logo, headings, boxes) on plain A5 portrait paper.
          Pre-printed = your stationery already has the logo, headings and column lines; the app prints only the
          customer, bill no/date, item rows and totals into those boxes. Thermal = a compact 80mm receipt for roll printers.
          You can also switch format on the print preview for any single bill.
        </div>

        {(tpl.print_format || "full") === "preprinted" && (
          <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: 14, fontSize: 13, color: "#1e3a8a" }}>
            📐 To align the values onto your pre-printed paper, use the new <b>Pre-print Align</b> tab above —
            it has a visual editor where you drag each value into place and rename every column, for both the
            A5 sales bill and the 6×6 farmer-purchase bill.
          </div>
        )}
      </div>

      <button onClick={save} disabled={saving} style={{ marginTop: 16, padding: "10px 22px", background: saving ? "#9ca3af" : "#1a7a45", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>{saving ? "Saving..." : "💾 Save Template"}</button>
    </div>
  );
}

// Sample values shown in the visual pre-print editor so each draggable chip looks like a real bill.
const PREPRINT_SAMPLE = {
  a5: {
    cols: { rate: "103", name: "ROUND CHILLIES", weight: "40", count: "2", amount: "4,120.00" },
    fields: { cust_name: "RJ STORES", cust_place: "ERODE", bill_no: "SAL-100", bill_date: "19/06/26",
      total: "15,034.00", prev_bal: "600.00", net: "15,634.00", credited: "5,000.00", balance: "10,634.00",
      total_label: "Bill Total", prev_bal_label: "முன் பற்று / Previous", net_label: "New Total",
      credited_label: "வரவு தொகை / Credited", balance_label: "நிகர தொகை / Balance" },
  },
  sixbysix: {
    cols: { rate: "45.00", desc: "TOMATO", weight: "120", bags: "3", credit: "5,400.00" },
    fields: { farmer_name: "K. SEKAR", town: "ODDANCHATRAM", bill_no: "PUR-50", bill_date: "19/06/26", exp_cooli: "45.00", exp_freight: "60.00", exp_sakku: "30.00", exp_comm: "540.00", debit_total: "675.00", credit_gross: "5,400.00", net: "4,725.00" },
  },
};

// Visual pre-print alignment editor — drag each value onto the paper, rename columns, tune size.
function PreprintEditor() {
  const [tpl, setTpl]   = useState(null);
  const [paper, setPaper] = useState("a5");
  const [cfg, setCfg]   = useState(null);
  const [sel, setSel]   = useState(null);     // { type:'col'|'field', key }
  const [saving, setSaving] = useState(false);
  const dragRef = useRef(null);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  useEffect(() => { api("settings?action=print").then(r => setTpl(r.data || {})).catch(() => setTpl({})); }, []);
  useEffect(() => { if (tpl) { setCfg(clone(getPreprint(tpl, paper))); setSel(null); } }, [tpl, paper]);

  const scale = 2.4;   // px per mm on the editor canvas
  // Drag handlers (window-level so dragging stays smooth outside the chip).
  useEffect(() => {
    const move = (e) => {
      const d = dragRef.current; if (!d) return;
      const snap = v => Math.max(0, Math.round(v * 2) / 2);
      const nx = snap(d.x0 + (e.clientX - d.startX) / scale);
      const ny = snap(d.y0 + (e.clientY - d.startY) / scale);
      if (d.type === "col") setCfg(c => ({ ...c, items_top: ny, cols: c.cols.map(col => col.key === d.key ? { ...col, x: nx } : col) }));
      else if (d.type === "line") setCfg(c => ({ ...c, lines: (c.lines || []).map((ln, i) => i === d.key ? { ...ln, x: nx, y: ny } : ln) }));
      else setCfg(c => ({ ...c, fields: c.fields.map(f => f.key === d.key ? { ...f, x: nx, y: ny } : f) }));
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  if (!cfg) return <div style={{ padding: 20, color: "#666" }}>Loading…</div>;
  const sample = PREPRINT_SAMPLE[paper];
  const W = cfg.paper.w, H = cfg.paper.h;
  const fontPx = (cfg.font || 12) * 0.3528 * scale;

  const updateCol   = (key, patch) => setCfg(c => ({ ...c, cols: c.cols.map(col => col.key === key ? { ...col, ...patch } : col) }));
  const updateField = (key, patch) => setCfg(c => ({ ...c, fields: c.fields.map(f => f.key === key ? { ...f, ...patch } : f) }));
  const updateLine  = (i, patch) => setCfg(c => ({ ...c, lines: (c.lines || []).map((ln, idx) => idx === i ? { ...ln, ...patch } : ln) }));
  const addLine     = () => setCfg(c => { const lines = [...(c.lines || []), { x: 20, y: 100, w: 100, thickness: 0.4 }]; setSel({ type: "line", key: lines.length - 1 }); return { ...c, lines }; });
  const removeLine  = (i) => { setSel(null); setCfg(c => ({ ...c, lines: (c.lines || []).filter((_, idx) => idx !== i) })); };
  const onDown = (type, key, x0, y0, e) => { e.preventDefault(); e.stopPropagation(); setSel({ type, key }); dragRef.current = { type, key, startX: e.clientX, startY: e.clientY, x0, y0 }; };

  const save = async () => {
    setSaving(true);
    const body = { ...tpl, preprint: { ...(tpl.preprint || {}), [paper]: {
      font: cfg.font, row: cfg.row, items_top: cfg.items_top, rows: cfg.rows, cols: cfg.cols, fields: cfg.fields, lines: cfg.lines || [] } } };
    try {
      await api("settings?action=print-save", { method: "POST", body: JSON.stringify(body) });
      clearPrintTemplateCache(); setTpl(body);
      alert("✅ Pre-print layout saved — applies to all printed bills on this paper.");
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };
  const resetDefaults = () => { if (window.confirm("Reset this paper's layout to the defaults?")) setCfg(clone(DEFAULT_PREPRINT[paper])); };

  const al = a => (a === "r" ? "right" : a === "c" ? "center" : "left");
  const chip = (type, key, x, y, w, text, bold, size) => {
    const isSel = sel && sel.type === type && sel.key === key;
    return (
      <div key={`${type}-${key}`} onMouseDown={e => onDown(type, key, x, y, e)} title="Drag to position"
        style={{ position: "absolute", left: x * scale, top: y * scale, width: w * scale, cursor: "grab",
          fontSize: size ? size * 0.3528 * scale : fontPx, lineHeight: 1.05, textAlign: al(type === "col" ? cfg.cols.find(c => c.key === key).align : cfg.fields.find(f => f.key === key).align),
          fontWeight: bold ? 700 : 400, color: "#000", whiteSpace: "nowrap", overflow: "visible",
          outline: isSel ? "2px solid #2563eb" : "1px dashed rgba(37,99,235,0.35)",
          background: isSel ? "rgba(37,99,235,0.10)" : "rgba(37,99,235,0.03)", borderRadius: 2 }}>
        {text}
      </div>
    );
  };

  const selEl = sel ? (sel.type === "col" ? cfg.cols.find(c => c.key === sel.key) : sel.type === "line" ? (cfg.lines || [])[sel.key] : cfg.fields.find(f => f.key === sel.key)) : null;
  const numCtl = (label, val, on, step = 0.5) => (
    <div><label style={{ ...labelStyle, fontSize: 11 }}>{label}</label>
      <input type="number" step={step} value={val} onChange={e => on(parseFloat(e.target.value) || 0)} style={{ ...inputSm, width: "100%" }} /></div>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", border: "1px solid #d1d5db", borderRadius: 8, overflow: "hidden" }}>
          {Object.keys(DEFAULT_PREPRINT).map(p => (
            <button key={p} onClick={() => setPaper(p)} style={{ padding: "8px 16px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
              background: paper === p ? "#1a7a45" : "white", color: paper === p ? "white" : "#374151" }}>{DEFAULT_PREPRINT[p].label}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={resetDefaults} style={{ padding: "8px 14px", background: "#f3f4f6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>↺ Reset</button>
        <button onClick={save} disabled={saving} style={{ padding: "8px 20px", background: saving ? "#9ca3af" : "#1a7a45", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>{saving ? "Saving…" : "💾 Save layout"}</button>
      </div>

      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
        Drag any value to where it should land on your pre-printed paper. Click one to fine-tune its position, width,
        alignment and column name on the right. The grey rows show how the item lines step down. Print one real bill to compare.
      </div>

      <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Canvas */}
        <div style={{ position: "relative", width: W * scale, height: H * scale, background: "#fff",
          border: "1px solid #cbd5e1", boxShadow: "0 1px 6px rgba(0,0,0,0.12)", flexShrink: 0,
          backgroundImage: "linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)",
          backgroundSize: `${10 * scale}px ${10 * scale}px` }}>
          {/* Ghost item rows 2..N for context */}
          {Array.from({ length: Math.max(0, (cfg.rows || 6) - 1) }).map((_, gi) => cfg.cols.map(c => (
            <div key={`g${gi}-${c.key}`} style={{ position: "absolute", left: c.x * scale, top: (cfg.items_top + (gi + 1) * cfg.row) * scale,
              width: c.w * scale, fontSize: fontPx, lineHeight: 1.05, textAlign: al(c.align), color: "#9ca3af", whiteSpace: "nowrap", overflow: "hidden" }}>
              {sample.cols[c.key]}
            </div>
          )))}
          {/* Item-area boundary — rows past this line spill onto a 2nd (continuation) sheet.
              Keep the totals/fields BELOW this line so item rows can never overlap them. */}
          <div style={{ position: "absolute", left: 0, top: (cfg.items_top + (cfg.rows || 6) * cfg.row) * scale,
            width: "100%", borderTop: "1.5px dashed #dc2626", pointerEvents: "none" }}>
            <span style={{ position: "absolute", right: 2, top: 1, fontSize: 9, color: "#dc2626",
              background: "rgba(255,255,255,0.85)", padding: "0 3px", whiteSpace: "nowrap" }}>↑ items · 2nd sheet below ↓</span>
          </div>
          {/* Draggable column chips (first item row) */}
          {cfg.cols.map(c => chip("col", c.key, c.x, cfg.items_top, c.w, sample.cols[c.key], false))}
          {/* Draggable one-off fields */}
          {cfg.fields.map(f => chip("field", f.key, f.x, f.y, f.w, sample.fields[f.key], f.bold, f.size))}
          {/* Draggable rule lines */}
          {(cfg.lines || []).map((ln, i) => {
            const isSel = sel && sel.type === "line" && sel.key === i;
            return (
              <div key={`line-${i}`} onMouseDown={e => onDown("line", i, ln.x, ln.y, e)} title="Drag the line"
                style={{ position: "absolute", left: ln.x * scale, top: ln.y * scale - 4, width: ln.w * scale, height: 8,
                  cursor: "grab", display: "flex", alignItems: "center", outline: isSel ? "2px solid #2563eb" : "none",
                  background: isSel ? "rgba(37,99,235,0.10)" : "transparent" }}>
                <div style={{ width: "100%", borderTop: `${Math.max(1, (ln.thickness || 0.4) * scale)}px solid ${isSel ? "#2563eb" : "#000"}` }} />
              </div>
            );
          })}
        </div>

        {/* Controls */}
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ background: "#f9fafb", border: "1px solid #eef2f7", borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Whole-sheet settings</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {numCtl("Text size (pt)", cfg.font, v => setCfg(c => ({ ...c, font: v })))}
              {numCtl("Item row pitch (mm)", cfg.row, v => setCfg(c => ({ ...c, row: v })))}
              {numCtl("Items start (mm down)", cfg.items_top, v => setCfg(c => ({ ...c, items_top: v })))}
              {numCtl("Rows per sheet", cfg.rows || 6, v => setCfg(c => ({ ...c, rows: Math.max(1, Math.round(v)) })), 1)}
            </div>
          </div>

          <div style={{ background: "#f9fafb", border: "1px solid #eef2f7", borderRadius: 10, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{sel?.type === "line" ? "Selected: rule line" : selEl ? `Selected: ${selEl.label}` : "Click a value or line to edit"}</div>
              <button onClick={addLine} style={{ fontSize: 11, padding: "4px 10px", border: "1px solid #cbd5e1", borderRadius: 6, background: "white", cursor: "pointer", whiteSpace: "nowrap" }}>+ Add line</button>
            </div>
            {sel?.type === "line" && selEl && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {numCtl("X (mm from left)", selEl.x, v => updateLine(sel.key, { x: v }))}
                  {numCtl("Y (mm from top)", selEl.y, v => updateLine(sel.key, { y: v }))}
                  {numCtl("Width (mm)", selEl.w, v => updateLine(sel.key, { w: v }))}
                  {numCtl("Thickness (mm)", selEl.thickness || 0.4, v => updateLine(sel.key, { thickness: v }), 0.1)}
                </div>
                <button onClick={() => removeLine(sel.key)} style={{ marginTop: 10, fontSize: 12, padding: "6px 12px", border: "1px solid #fca5a5", borderRadius: 6, background: "white", color: "#b91c1c", cursor: "pointer" }}>Remove line</button>
              </>
            )}
            {sel?.type !== "line" && selEl && (
              <>
                <div style={{ marginBottom: 10 }}>
                  <label style={{ ...labelStyle, fontSize: 11 }}>{sel.type === "col" ? "Column name" : "Field name"}</label>
                  <input value={selEl.label} onChange={e => (sel.type === "col" ? updateCol : updateField)(sel.key, { label: e.target.value })} style={{ ...inputSm, width: "100%" }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {numCtl("X (mm from left)", selEl.x, v => (sel.type === "col" ? updateCol : updateField)(sel.key, { x: v }))}
                  {sel.type === "field"
                    ? numCtl("Y (mm from top)", selEl.y, v => updateField(sel.key, { y: v }))
                    : numCtl("Items start (mm)", cfg.items_top, v => setCfg(c => ({ ...c, items_top: v })))}
                  {numCtl("Width (mm)", selEl.w, v => (sel.type === "col" ? updateCol : updateField)(sel.key, { w: v }))}
                  {sel.type === "field" && numCtl("Text size (pt, blank=normal)", selEl.size || cfg.font, v => updateField(sel.key, { size: v }))}
                  <div><label style={{ ...labelStyle, fontSize: 11 }}>Align</label>
                    <select value={selEl.align} onChange={e => (sel.type === "col" ? updateCol : updateField)(sel.key, { align: e.target.value })} style={{ ...inputSm, width: "100%" }}>
                      <option value="l">Left</option><option value="c">Center</option><option value="r">Right</option>
                    </select>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Find bills by date/type and print (single or selected), with data-only toggle
function BillPrintFinder() {
  const [type, setType] = useState("purchase");
  const [from, setFrom] = useState(new Date().toISOString().split("T")[0]);
  const [to, setTo]     = useState(new Date().toISOString().split("T")[0]);
  const [q, setQ]       = useState("");
  const [bills, setBills] = useState([]);
  const [sel, setSel]   = useState([]);
  const [dataOnly, setDataOnly] = useState(false);
  const [printBills, setPrintBills] = useState(null);

  const load = () => {
    setSel([]);
    api(`${type}?action=list&from=${from}&to=${to}`).then(r => setBills(r.data || [])).catch(() => setBills([]));
  };
  useEffect(() => { load(); }, [type, from, to]);

  const ql = q.trim().toLowerCase();
  const filtered = bills.filter(b => !ql || (b.party_name || "").toLowerCase().includes(ql) || (b.bill_no || "").toLowerCase().includes(ql));
  const toggle = (id) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const printSelected = async () => {
    const ids = sel.length ? sel : filtered.map(b => b.id);
    if (!ids.length) return;
    const results = await Promise.all(ids.map(id => api(`${type}?action=get&id=${id}`)));
    const norm = type === "purchase" ? purchaseToPrint : salesToPrint;
    setPrintBills(results.map(r => norm(r.data)));
  };

  if (printBills) {
    const Comp = type === "purchase" ? PrintPurchaseBills : PrintSalesBills;
    return <Comp bills={printBills} dataOnly={dataOnly} onClose={() => setPrintBills(null)} />;
  }

  return (
    <div>
      <div style={{ background: "white", borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div><label style={labelStyle}>Type</label>
          <select value={type} onChange={e => setType(e.target.value)} style={{ ...inputSm, width: 130 }}>
            <option value="purchase">Purchase</option><option value="sales">Sales</option>
          </select></div>
        <div><label style={labelStyle}>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputSm} /></div>
        <div><label style={labelStyle}>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputSm} /></div>
        <div style={{ flex: 1, minWidth: 160 }}><label style={labelStyle}>Search</label><input value={q} onChange={e => setQ(e.target.value)} placeholder="party / bill no" style={inputSm} /></div>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={dataOnly} onChange={e => setDataOnly(e.target.checked)} /> Data only
        </label>
        <button onClick={printSelected} style={{ padding: "9px 16px", background: "#1a7a45", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
          🖨️ Print {sel.length ? `(${sel.length})` : "All"}
        </button>
      </div>

      <div style={{ background: "white", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ background: "#f9fafb" }}>
            <th style={{ ...rptH, width: 36, textAlign: "center" }}><input type="checkbox" checked={filtered.length > 0 && sel.length === filtered.length} onChange={e => setSel(e.target.checked ? filtered.map(b => b.id) : [])} /></th>
            {["Bill No", "Party", "Date", "Amount ₹"].map((h, i) => <th key={h} style={{ ...rptH, textAlign: i === 3 ? "right" : "left" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: "#888" }}>No bills</td></tr> :
             filtered.map((b, i) => (
              <tr key={b.id} style={{ background: sel.includes(b.id) ? "#eff6ff" : (i % 2 ? "#fafafa" : "white") }}>
                <td style={{ ...rptTd, textAlign: "center" }}><input type="checkbox" checked={sel.includes(b.id)} onChange={() => toggle(b.id)} /></td>
                <td style={{ ...rptTd, textAlign: "left", fontWeight: 600, color: "#1a7a45" }}>{b.bill_no}</td>
                <td style={{ ...rptTd, textAlign: "left" }}>{b.party_name}</td>
                <td style={{ ...rptTd, textAlign: "left" }}>{fmt.date(b.bill_date)}</td>
                <td style={{ ...rptTd, fontWeight: 700 }}>{fmt.currency(type === "purchase" ? b.net_payable : b.net_amount)}</td>
              </tr>
             ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Party ledger / statement: transactions + running balance, printable
const LEDGER_FARMER_CATS = ["FARMER", "SUPPLIER", "MARKET_SUPPLIER"];
const LEDGER_VENDOR_CATS = ["CUSTOMER", "OVERFLOW", "MARKET_VENDOR", "ORDER_SUPPLIER"];

function PartyLedgerReport() {
  const [parties, setParties] = useState([]);
  const [ptype, setPtype] = useState("vendor");   // 'vendor' | 'farmer'
  const [pid, setPid] = useState("");
  const [from, setFrom] = useState(getWorkingDate().slice(0, 7) + "-01");
  const [to, setTo]     = useState(getWorkingDate());
  const [d, setD]       = useState(null);
  const ref = useRef();
  useEffect(() => { apiCached("parties?action=list&active=all&cols=lite").then(r => setParties(r.data || [])).catch(() => {}); }, []);
  useEffect(() => { if (pid) api(`reports?action=party-ledger&party_id=${pid}&from=${from}&to=${to}`).then(setD).catch(() => {}); else setD(null); }, [pid, from, to]);

  const cats = ptype === "vendor" ? LEDGER_VENDOR_CATS : LEDGER_FARMER_CATS;
  const filteredParties = parties.filter(p => cats.includes(p.cat_code));
  const switchType = (t) => { setPtype(t); setPid(""); setD(null); };

  const rows = d?.data || [];
  const csv = () => downloadCSV(`ledger_${d?.party?.name_en || pid}_${from}_${to}.csv`,
    [["Date", "Type", "Ref", "Description", "Debit", "Credit", "Balance"],
     ["", "", "", "Opening", "", "", d?.opening_balance],
     ...rows.map(r => [r.txn_date, r.txn_type, r.ref_no, r.description, r.debit, r.credit, r.balance])]);

  return (
    <div>
      <div className="no-print" style={{ background: "white", borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label style={labelStyle}>Type</label>
          <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb", width: "fit-content" }}>
            {[{ id: "vendor", label: "Vendors" }, { id: "farmer", label: "Farmers" }].map(o => (
              <button key={o.id} onClick={() => switchType(o.id)} style={{ padding: "8px 16px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                background: ptype === o.id ? "#1a7a45" : "white", color: ptype === o.id ? "white" : "#374151" }}>{o.label}</button>
            ))}
          </div>
        </div>
        <div style={{ minWidth: 260 }}><label style={labelStyle}>{ptype === "vendor" ? "Vendor" : "Farmer"}</label>
          <SearchableSelect value={pid}
            options={filteredParties.map(p => ({ id: p.id, label: p.name_en + (p.name_ta ? ` / ${p.name_ta}` : "") + (p.city ? ` — ${p.city}` : "") }))}
            onChange={(id) => setPid(id)}
            placeholder={parties.length ? `🔍 Search ${ptype === "vendor" ? "a vendor" : "a farmer"}...` : "Loading parties..."}
            style={{ ...inputSm, width: 260 }} /></div>
        <div><label style={labelStyle}>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputSm} /></div>
        <div><label style={labelStyle}>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputSm} /></div>
        <div style={{ flex: 1 }} />
        {d && <button onClick={csv} style={{ padding: "9px 16px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, color: "#16a34a", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>⬇️ CSV</button>}
        {d && <button onClick={() => printReport(ref.current)} style={{ padding: "9px 16px", background: "#1a7a45", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>🖨️ Print</button>}
      </div>

      {!pid ? <div style={{ padding: 30, textAlign: "center", color: "#888", background: "white", borderRadius: 12 }}>Select a party to view their statement</div> :
       !d ? <div style={{ padding: 20, color: "#666" }}>Loading...</div> :
       <div ref={ref} style={reportSheet}>
         <ReportTitle title={`Statement — ${d.party.name_en}${d.party.city ? " (" + d.party.city + ")" : ""}`} from={from} to={to} />
         <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
           <thead><tr>
             {["Date", "Particulars", "Ref", "Debit ₹", "Credit ₹", "Balance ₹"].map((h, i) => <th key={h} style={{ ...rptH, textAlign: i < 3 ? "left" : "right" }}>{h}</th>)}
           </tr></thead>
           <tbody>
             <tr><td style={{ ...rptTd, textAlign: "left", fontStyle: "italic", color: "#666" }} colSpan={5}>Opening balance</td><td style={{ ...rptTd, fontWeight: 700 }}>{fmt.currency(d.opening_balance)}</td></tr>
             {rows.length === 0 ? <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: "#888" }}>No transactions in this period</td></tr> :
              rows.map((r, i) => (
               <tr key={i}>
                 <td style={{ ...rptTd, textAlign: "left" }}>{fmt.date(r.txn_date)}</td>
                 <td style={{ ...rptTd, textAlign: "left" }}>{r.description}</td>
                 <td style={{ ...rptTd, textAlign: "left", color: "#2563eb" }}>{r.ref_no || "—"}</td>
                 <td style={rptTd}>{parseFloat(r.debit) ? fmt.currency(r.debit) : "—"}</td>
                 <td style={rptTd}>{parseFloat(r.credit) ? fmt.currency(r.credit) : "—"}</td>
                 <td style={{ ...rptTd, fontWeight: 700 }}>{fmt.currency(r.balance)}</td>
               </tr>
              ))}
           </tbody>
           <tfoot>
             <tr style={{ background: "#f9fafb" }}>
               <td colSpan={3} style={{ ...rptTd, textAlign: "left", fontWeight: 700 }}>Totals</td>
               <td style={{ ...rptTd, fontWeight: 700 }}>{fmt.currency(d.totals.debit)}</td>
               <td style={{ ...rptTd, fontWeight: 700 }}>{fmt.currency(d.totals.credit)}</td>
               <td style={{ ...rptTd, fontWeight: 800, color: "#1a7a45" }}>{fmt.currency(d.totals.closing)}</td>
             </tr>
           </tfoot>
         </table>
         <div style={{ marginTop: 10, fontSize: 11, color: "#888" }}>Debit = billed to party · Credit = paid by party · Closing = balance the party owes.</div>
       </div>}
    </div>
  );
}

// ============================================================
// PRODUCTS MODULE — list, add/edit (Tamil), purchase history + price chart
// ============================================================
export function ProductsPage() {
  const [products, setProducts]   = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch]       = useState("");
  const [editing, setEditing]     = useState(null);  // product object (or {} for new) being edited
  const [detail, setDetail]       = useState(null);  // product object being viewed
  const [loading, setLoading]     = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all([
      api("products?action=list&all=1"),   // include disabled so they can be re-enabled here
      api("products?action=categories").catch(() => ({ data: [] })),
    ]).then(([p, c]) => { setProducts(p.data || []); setCategories(c.data || []); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // Disable keeps the product out of every picker but preserves its name on old bills.
  const toggleActive = async (p) => {
    const enable = p.is_active == 0;
    if (!enable && !window.confirm(`Disable "${p.name_en}"? It stays on old bills but won't appear when adding new entries. You can re-enable it anytime.`)) return;
    try {
      await api("products?action=set-active", { method: "POST", body: JSON.stringify({ id: p.id, is_active: enable ? 1 : 0 }) });
      clearApiCache('products');
      load();
    } catch (e) { alert(e.message); }
  };

  const sq = search.trim().toLowerCase();
  const filtered = products.filter(p => !sq
    || (p.name_en || "").toLowerCase().includes(sq)
    || (p.name_ta || "").includes(search.trim())
    || (p.category_name || "").toLowerCase().includes(sq));

  if (detail) return <ProductDetail product={detail} onBack={() => setDetail(null)}
                       onEdit={() => { setEditing(detail); }} editingForm={editing}
                       categories={categories} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>🥬 Products <span style={{ fontSize: 13, color: "#666" }}>பொருட்கள்</span></h1>
        <button onClick={() => setEditing({})}
          style={{ padding: "9px 18px", background: "#1a7a45", border: "none", borderRadius: 8, color: "white", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          + Add Product
        </button>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="🔍 Search product (English / தமிழ் / category)..." style={{ ...inputSm, marginBottom: 16 }} />

      {loading ? <div style={{ padding: 20, textAlign: "center", color: "#666" }}>Loading...</div> :
       filtered.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: "#666" }}>{sq ? "No matching products" : "No products yet — add one"}</div> :
       <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
         {filtered.map(p => {
           const off = p.is_active == 0;
           return (
           <div key={p.id} onClick={() => setDetail(p)}
             style={{ background: off ? "#f9fafb" : "white", borderRadius: 10, padding: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", cursor: "pointer", border: off ? "1px dashed #d1d5db" : "1px solid #eef2f7", opacity: off ? 0.7 : 1 }}>
             <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
               <div>
                 <div style={{ fontWeight: 700, fontSize: 15 }}>{p.name_en}
                   {off && <span style={{ marginLeft: 7, background: "#fee2e2", color: "#dc2626", padding: "1px 7px", borderRadius: 6, fontSize: 10, fontWeight: 700, verticalAlign: "middle" }}>Disabled</span>}
                 </div>
                 {p.name_ta && <div style={{ fontSize: 13, color: "#1a7a45", fontFamily: "'Noto Sans Tamil', sans-serif" }}>{p.name_ta}</div>}
                 <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{p.category_name || "—"} · {p.unit_type || "KG"}</div>
               </div>
               <button onClick={e => { e.stopPropagation(); setEditing(p); }}
                 style={{ padding: "3px 9px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, color: "#2563eb", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>✏️</button>
             </div>
             <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
               <span style={{ fontSize: 11, color: "#2563eb" }}>View history →</span>
               <button onClick={e => { e.stopPropagation(); toggleActive(p); }}
                 style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "1px solid", ...(off ? { background: "#f0fdf4", borderColor: "#86efac", color: "#16a34a" } : { background: "#fef2f2", borderColor: "#fecaca", color: "#dc2626" }) }}>
                 {off ? "↩ Enable" : "🚫 Disable"}
               </button>
             </div>
           </div>
           );
         })}
       </div>}

      {editing && <ProductForm product={editing} categories={categories}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

// Add / edit a product (with Tamil transliteration)
function ProductForm({ product, categories, onClose, onSaved }) {
  const [form, setForm] = useState({
    id: product?.id || null,
    name_en: product?.name_en || "",
    name_ta: product?.name_ta || "",
    category_id: product?.category_id || "",
    unit_type: product?.unit_type || "KG",
  });
  const [saving, setSaving] = useState(false);
  const timer = useRef();

  const onName = (val) => {
    setForm(p => ({ ...p, name_en: val }));
    clearTimeout(timer.current);
    const key = val.trim().toLowerCase();
    if (!key) { setForm(p => ({ ...p, name_ta: "" })); return; }
    // Known vegetables → Tamil NAME (meaning), e.g. Tomato → தக்காளி
    if (VEG_TA[key]) { setForm(p => ({ ...p, name_ta: VEG_TA[key] })); return; }
    // Otherwise fall back to phonetic transliteration
    timer.current = setTimeout(async () => { const ta = await googleTamil(val); if (ta) setForm(p => ({ ...p, name_ta: ta })); }, 600);
  };

  const save = async () => {
    if (!form.name_en.trim()) { alert("Product name required"); return; }
    setSaving(true);
    try {
      await api("products?action=save", { method: "POST", body: JSON.stringify(form) });
      clearApiCache('products');
      onSaved();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 12, padding: 22, width: 420, maxWidth: "92vw", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>{form.id ? "Edit Product" : "Add Product"}</div>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Name (English) *</label>
          <input value={form.name_en} onChange={e => onName(e.target.value)} placeholder="e.g. Tomato" style={inputSm} autoFocus />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Name (தமிழ்) — auto, editable</label>
          <input value={form.name_ta} onChange={e => setForm(p => ({ ...p, name_ta: e.target.value }))}
            placeholder="தமிழ் பெயர்" style={{ ...inputSm, fontFamily: "'Noto Sans Tamil', sans-serif" }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
          <div>
            <label style={labelStyle}>Category</label>
            <select value={form.category_id || ""} onChange={e => setForm(p => ({ ...p, category_id: e.target.value }))} style={inputSm}>
              <option value="">-- None --</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name_en}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Unit</label>
            <select value={form.unit_type} onChange={e => setForm(p => ({ ...p, unit_type: e.target.value }))} style={inputSm}>
              <option value="KG">KG</option><option value="BAG">BAG</option><option value="PIECE">PIECE</option>
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "9px 16px", background: "white", border: "1px solid #d1d5db", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ padding: "9px 20px", background: saving ? "#9ca3af" : "#1a7a45", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>{saving ? "Saving..." : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

// Product detail: purchase history table + price line chart
function ProductDetail({ product, onBack, onEdit, editingForm, categories, onClose, onSaved }) {
  const [history, setHistory] = useState(null);
  const [days, setDays]       = useState(90);

  useEffect(() => {
    setHistory(null);
    api(`products?action=purchase-history&product_id=${product.id}&days=${days}`)
      .then(r => setHistory(r.data || [])).catch(() => setHistory([]));
  }, [product.id, days]);

  const totalBags   = (history || []).reduce((s, r) => s + (parseInt(r.total_bags) || 0), 0);
  const totalWeight = (history || []).reduce((s, r) => s + (parseFloat(r.total_weight) || 0), 0);
  const rates       = (history || []).map(r => parseFloat(r.avg_rate) || 0).filter(Boolean);
  const avgRate     = rates.length ? (rates.reduce((s, r) => s + r, 0) / rates.length) : 0;

  return (
    <div style={{ padding: 24 }}>
      <button onClick={onBack} style={{ marginBottom: 14, padding: "6px 14px", background: "#f3f4f6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>← Back to Products</button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{product.name_en}</h1>
          {product.name_ta && <div style={{ fontSize: 15, color: "#1a7a45", fontFamily: "'Noto Sans Tamil', sans-serif" }}>{product.name_ta}</div>}
          <div style={{ fontSize: 12, color: "#888" }}>{product.category_name || "—"} · {product.unit_type || "KG"}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={days} onChange={e => setDays(parseInt(e.target.value))} style={{ ...inputSm, width: 130 }}>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 6 months</option>
            <option value={365}>Last 1 year</option>
          </select>
          <button onClick={onEdit} style={{ padding: "8px 14px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, color: "#2563eb", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>✏️ Edit</button>
        </div>
      </div>

      {history === null ? <div style={{ padding: 20, color: "#666" }}>Loading history...</div> :
       history.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: "#666", background: "white", borderRadius: 10 }}>No purchases recorded for this product in this period.</div> :
       <>
         {/* Summary */}
         <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
           {[
             { l: "Purchase Days", v: history.length },
             { l: "Total Bags", v: totalBags },
             { l: "Total Weight", v: `${totalWeight.toFixed(0)} kg` },
             { l: "Avg Rate", v: fmt.currency(avgRate) },
           ].map(s => (
             <div key={s.l} style={{ background: "white", borderRadius: 10, padding: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
               <div style={{ fontSize: 11, color: "#666" }}>{s.l}</div>
               <div style={{ fontSize: 20, fontWeight: 700 }}>{s.v}</div>
             </div>
           ))}
         </div>

         {/* Price chart */}
         <div style={{ background: "white", borderRadius: 10, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.07)", marginBottom: 16 }}>
           <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 10 }}>📈 Avg Purchase Rate (₹/kg) over time</div>
           <PriceChart points={history.map(r => ({ label: r.bill_date, value: parseFloat(r.avg_rate) || 0 }))} />
         </div>

         {/* Table */}
         <div style={{ background: "white", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
           <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
             <thead>
               <tr style={{ background: "#f9fafb" }}>
                 {["Date", "Bags", "Weight (kg)", "Avg Rate ₹", "Min–Max ₹", "Amount ₹"].map(h => (
                   <th key={h} style={{ padding: "10px 12px", textAlign: h === "Date" ? "left" : "right", fontSize: 11, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
                 ))}
               </tr>
             </thead>
             <tbody>
               {[...history].reverse().map((r, i) => (
                 <tr key={i} style={{ background: i % 2 ? "#fafafa" : "white" }}>
                   <td style={{ padding: "8px 12px", fontWeight: 600 }}>{fmt.date(r.bill_date)}</td>
                   <td style={{ padding: "8px 12px", textAlign: "right" }}>{r.total_bags}</td>
                   <td style={{ padding: "8px 12px", textAlign: "right" }}>{parseFloat(r.total_weight).toFixed(1)}</td>
                   <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: "#1a7a45" }}>{parseFloat(r.avg_rate).toFixed(2)}</td>
                   <td style={{ padding: "8px 12px", textAlign: "right", color: "#888" }}>{parseFloat(r.min_rate).toFixed(0)}–{parseFloat(r.max_rate).toFixed(0)}</td>
                   <td style={{ padding: "8px 12px", textAlign: "right" }}>{fmt.currency(r.total_amount)}</td>
                 </tr>
               ))}
             </tbody>
           </table>
         </div>
       </>}

      {editingForm && <ProductForm product={editingForm} categories={categories} onClose={onClose} onSaved={onSaved} />}
    </div>
  );
}

// Lightweight SVG line chart (no external library)
function PriceChart({ points }) {
  if (!points || points.length === 0) return <div style={{ color: "#888", fontSize: 13 }}>No data</div>;
  const W = 720, H = 200, padL = 44, padR = 16, padT = 14, padB = 28;
  const vals = points.map(p => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const lo = Math.floor(min * 0.95), hi = Math.ceil(max * 1.05) || 1;
  const span = (hi - lo) || 1;
  const n = points.length;
  const x = (i) => padL + (n === 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (n - 1));
  const y = (v) => padT + (H - padT - padB) * (1 - (v - lo) / span);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const ticks = [lo, lo + span / 2, hi];
  // show ~6 evenly spaced date labels
  const step = Math.max(1, Math.ceil(n / 6));

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 480, height: "auto" }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} stroke="#eef2f7" />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#9ca3af">{Math.round(t)}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke="#1a7a45" strokeWidth="2" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r="3" fill="#1a7a45">
            <title>{p.label}: ₹{p.value}</title>
          </circle>
        ))}
        {points.map((p, i) => (i % step === 0 || i === n - 1) ? (
          <text key={"l" + i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#9ca3af">
            {String(p.label).slice(5)}
          </text>
        ) : null)}
      </svg>
    </div>
  );
}


// ============================================================
// DAILY STATEMENT REPORT
// Shows all vendors: opening balance + today's bills + payments = closing balance
// ============================================================
function DailyStatement() {
  const [date, setDate]   = useState(new Date().toISOString().split("T")[0]);
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      // Get today's sales bills
      const [bills, payments, outstanding] = await Promise.all([
        api(`sales?action=list&from=${date}&to=${date}`),
        api(`reports?action=payments-daily&from=${date}&to=${date}`).catch(() => ({ data: [] })),
        api("parties?action=outstanding"),
      ]);

      // Group by party
      const partyMap = {};

      // Add today's bills
      (bills.data || []).forEach(b => {
        if (!partyMap[b.party_id]) partyMap[b.party_id] = {
          party_id: b.party_id, name: b.party_name, name_ta: b.party_name_ta,
          phone: b.phone1, today_bills: [], today_payments: [], prev_balance: 0
        };
        partyMap[b.party_id].today_bills.push(b);
      });

      // Add today's payments
      (payments.data || []).forEach(p => {
        if (!partyMap[p.party_id]) partyMap[p.party_id] = {
          party_id: p.party_id, name: p.party_name, name_ta: "",
          phone: "", today_bills: [], today_payments: [], prev_balance: 0
        };
        partyMap[p.party_id].today_payments.push(p);
      });

      // Add outstanding (previous balance)
      (outstanding.data || []).forEach(o => {
        if (partyMap[o.party_id]) {
          // Only count bills before today as previous balance
          const prevBills = (o.bill_date < date) ? o.balance_due : 0;
          partyMap[o.party_id].prev_balance += parseFloat(prevBills || 0);
        }
      });

      setData(Object.values(partyMap));
    } catch(e) {
      console.error(e);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [date]);

  const grandTotals = (data || []).reduce((acc, p) => {
    const todayBilled   = p.today_bills.reduce((s, b) => s + parseFloat(b.net_amount || 0), 0);
    const todayPaid     = p.today_payments.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    const closing       = p.prev_balance + todayBilled - todayPaid;
    return {
      prev:    acc.prev    + p.prev_balance,
      billed:  acc.billed  + todayBilled,
      paid:    acc.paid    + todayPaid,
      closing: acc.closing + closing,
    };
  }, { prev: 0, billed: 0, paid: 0, closing: 0 });

  return (
    <div>
      {/* Date picker + refresh */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <div>
          <label style={labelStyle}>Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputSm} />
        </div>
        <button onClick={load} style={{ marginTop: 18, padding: "8px 16px", background: "#1a7a45", border: "none", borderRadius: 8, color: "white", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
          🔄 Refresh
        </button>
        <button onClick={() => window.print()} style={{ marginTop: 18, padding: "8px 16px", background: "#2563eb", border: "none", borderRadius: 8, color: "white", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
          🖨️ Print
        </button>
      </div>

      {/* Grand totals bar */}
      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
          {[
            { label: "Previous Outstanding", labelTa: "முந்தைய நிலுவை", value: fmt.currency(grandTotals.prev), color: "#6b7280" },
            { label: "Today's Sales",         labelTa: "இன்றைய விற்பனை", value: fmt.currency(grandTotals.billed), color: "#2563eb" },
            { label: "Today's Payments",      labelTa: "இன்றைய ரசீது",   value: fmt.currency(grandTotals.paid), color: "#16a34a" },
            { label: "Closing Balance",       labelTa: "இறுதி நிலுவை",   value: fmt.currency(grandTotals.closing), color: grandTotals.closing > 0 ? "#dc2626" : "#16a34a" },
          ].map((c, i) => (
            <div key={i} style={{ background: "white", borderRadius: 10, padding: "14px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.08)", borderLeft: "4px solid " + c.color }}>
              <div style={{ fontSize: 11, color: "#666" }}>{c.label}</div>
              <div style={{ fontSize: 10, color: "#999" }}>{c.labelTa}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: c.color, marginTop: 4 }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Party-wise statement table */}
      <div style={{ background: "white", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#1a7a45", color: "white" }}>
              <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600 }}>Vendor / வாடிக்கையாளர்</th>
              <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 12, fontWeight: 600 }}>Opening Balance</th>
              <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 12, fontWeight: 600 }}>Today's Bills +</th>
              <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 12, fontWeight: 600 }}>Payments Received -</th>
              <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 12, fontWeight: 600 }}>Closing Balance</th>
              <th style={{ padding: "10px 14px", textAlign: "center", fontSize: 12, fontWeight: 600 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: "center", color: "#666" }}>Loading...</td></tr>
            ) : !data || data.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: "center", color: "#666" }}>No activity for this date</td></tr>
            ) : data.sort((a, b) => {
              const aClose = a.prev_balance + a.today_bills.reduce((s,b)=>s+parseFloat(b.net_amount||0),0) - a.today_payments.reduce((s,p)=>s+parseFloat(p.amount||0),0);
              const bClose = b.prev_balance + b.today_bills.reduce((s,b)=>s+parseFloat(b.net_amount||0),0) - b.today_payments.reduce((s,p)=>s+parseFloat(p.amount||0),0);
              return bClose - aClose;
            }).map((party, i) => {
              const todayBilled = party.today_bills.reduce((s,b) => s + parseFloat(b.net_amount || 0), 0);
              const todayPaid   = party.today_payments.reduce((s,p) => s + parseFloat(p.amount || 0), 0);
              const closing     = party.prev_balance + todayBilled - todayPaid;
              const hasActivity = todayBilled > 0 || todayPaid > 0;

              return (
                <tr key={party.party_id} style={{ background: i % 2 === 0 ? "white" : "#fafafa",
                  borderLeft: hasActivity ? "3px solid #2563eb" : "3px solid transparent" }}>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{party.name}</div>
                    {party.name_ta && <div style={{ fontSize: 11, color: "#888", fontFamily: "'Noto Sans Tamil', sans-serif" }}>{party.name_ta}</div>}
                    {party.phone && <div style={{ fontSize: 11, color: "#888" }}>📞 {party.phone}</div>}
                    {/* Today's bill numbers */}
                    {party.today_bills.length > 0 && (
                      <div style={{ fontSize: 10, color: "#2563eb", marginTop: 2 }}>
                        Bills: {party.today_bills.map(b => b.bill_no).join(", ")}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontSize: 13, color: "#6b7280" }}>
                    {party.prev_balance > 0 ? fmt.currency(party.prev_balance) : "—"}
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontSize: 13, color: "#2563eb", fontWeight: todayBilled > 0 ? 700 : 400 }}>
                    {todayBilled > 0 ? fmt.currency(todayBilled) : "—"}
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontSize: 13, color: "#16a34a", fontWeight: todayPaid > 0 ? 700 : 400 }}>
                    {todayPaid > 0 ? fmt.currency(todayPaid) : "—"}
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, fontSize: 14,
                               color: closing > 0 ? "#dc2626" : "#16a34a" }}>
                    {fmt.currency(Math.abs(closing))}
                    {closing < 0 && <div style={{ fontSize: 10, color: "#16a34a" }}>← Advance</div>}
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "center" }}>
                    {todayPaid > 0 && todayBilled === 0 && (
                      <span style={{ background: "#dcfce7", color: "#16a34a", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>💰 Paid</span>
                    )}
                    {todayBilled > 0 && todayPaid === 0 && (
                      <span style={{ background: "#dbeafe", color: "#2563eb", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>🧾 New Bill</span>
                    )}
                    {todayBilled > 0 && todayPaid > 0 && (
                      <span style={{ background: "#f3e8ff", color: "#7c3aed", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>Both</span>
                    )}
                    {!hasActivity && closing > 0 && (
                      <span style={{ background: "#fef9c3", color: "#ca8a04", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>Pending</span>
                    )}
                    {closing === 0 && (
                      <span style={{ background: "#dcfce7", color: "#16a34a", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>✅ Clear</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {/* Grand total row */}
          {data && data.length > 0 && (
            <tfoot>
              <tr style={{ background: "#1a7a45", color: "white" }}>
                <td style={{ padding: "10px 14px", fontWeight: 700, fontSize: 13 }}>TOTAL ({data.length} vendors)</td>
                <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700 }}>{fmt.currency(grandTotals.prev)}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700 }}>{fmt.currency(grandTotals.billed)}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700 }}>{fmt.currency(grandTotals.paid)}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, fontSize: 15 }}>{fmt.currency(grandTotals.closing)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ============================================================
// REFERENCE REPORT
// ============================================================
function ReferenceReport() {
  const today = getWorkingDate();
  const [from, setFrom]         = useState(today);
  const [to, setTo]             = useState(today);
  const [refFilter, setRefFilter] = useState("");
  const [trucks, setTrucks]     = useState([]);
  const [data, setData]         = useState([]);
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    api("parties?action=list&category=TRUCK").then(r => setTrucks(r.data)).catch(() => {});
  }, []);

  const num = v => parseFloat(v || 0);
  const load = () => {
    setLoading(true);
    const refParam = refFilter ? `&ref=${encodeURIComponent(refFilter)}` : "";
    api(`purchase?action=list&from=${from}&to=${to}${refParam}`)
      .then(r => setData(r.data || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [from, to, refFilter]);

  // Group purchase bills by truck / reference
  const byRef = data.reduce((acc, b) => {
    const key = (b.reference_name && String(b.reference_name).trim()) || "DIRECT (no truck)";
    if (!acc[key]) acc[key] = { bills: [], bags: 0, net: 0, freight: 0, weight: 0 };
    acc[key].bills.push(b);
    acc[key].bags += num(b.total_bags);
    acc[key].net  += num(b.net_payable);
    acc[key].freight += num(b.lorry_freight);
    acc[key].weight  += num(b.subtotal_weight);
    return acc;
  }, {});
  const refGroups = Object.entries(byRef).sort((a, b) => a[0] === "DIRECT (no truck)" ? 1 : b[0] === "DIRECT (no truck)" ? -1 : a[0].localeCompare(b[0]));

  return (
    <div>
      <div className="no-print" style={{ background: "white", borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><label style={labelStyle}>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputSm} /></div>
          <div><label style={labelStyle}>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputSm} /></div>
          <div style={{ minWidth: 200 }}>
            <label style={labelStyle}>Reference / Truck</label>
            <select value={refFilter} onChange={e => setRefFilter(e.target.value)} style={inputSm}>
              <option value="">All References</option>
              <option value="DIRECT">DIRECT (No Truck)</option>
              {trucks.map(t => <option key={t.id} value={t.name_en}>{t.name_en}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={() => printReport(document.getElementById("reference-sheet"))} style={{ padding: "9px 16px", background: "#1a7a45", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>🖨️ Print</button>
        </div>
      </div>

      <div id="reference-sheet">
      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "#666" }}>Loading...</div>
      ) : refGroups.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#888", background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
          No purchase bills mapped to a reference for this period
        </div>
      ) : refGroups.map(([ref, group], i) => (
        <div key={i} style={{ background: "white", borderRadius: 12, padding: 20, marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>🚛 {ref}</div>
            <div style={{ display: "flex", gap: 24 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#2563eb" }}>{group.bills.length}</div>
                <div style={{ fontSize: 11, color: "#888" }}>Bills</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#1a7a45" }}>{group.bags}</div>
                <div style={{ fontSize: 11, color: "#888" }}>Total Bags</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#16a34a" }}>{fmt.currency(group.net)}</div>
                <div style={{ fontSize: 11, color: "#888" }}>Net Amount</div>
              </div>
            </div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                {[["S.No", "right"], ["Date", "left"], ["Bill No", "left"], ["Farmer / Supplier", "left"], ["Bags", "right"], ["Freight ₹", "right"], ["Weight", "right"], ["Net Amount ₹", "right"]].map(([h, a]) => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: a, fontSize: 11, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.bills.map((b, j) => (
                <tr key={j} style={{ background: j % 2 === 0 ? "white" : "#fafafa" }}>
                  <td style={{ padding: "8px 12px", fontSize: 12, textAlign: "right", color: "#888", borderBottom: "1px solid #f3f4f6" }}>{j + 1}</td>
                  <td style={{ padding: "8px 12px", fontSize: 12, borderBottom: "1px solid #f3f4f6" }}>{fmt.date(b.bill_date)}</td>
                  <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 600, color: "#2563eb", borderBottom: "1px solid #f3f4f6" }}>{b.bill_no}</td>
                  <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 500, borderBottom: "1px solid #f3f4f6" }}>
                    {b.party_name}
                    {b.party_name_ta && <div style={{ fontSize: 11, color: "#888" }}>{b.party_name_ta}</div>}
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 13, textAlign: "right", borderBottom: "1px solid #f3f4f6" }}>{b.total_bags}</td>
                  <td style={{ padding: "8px 12px", fontSize: 13, textAlign: "right", borderBottom: "1px solid #f3f4f6" }}>{fmt.currency(b.lorry_freight)}</td>
                  <td style={{ padding: "8px 12px", fontSize: 13, textAlign: "right", borderBottom: "1px solid #f3f4f6" }}>{num(b.subtotal_weight).toFixed(1)} kg</td>
                  <td style={{ padding: "8px 12px", fontWeight: 700, color: "#16a34a", fontSize: 13, textAlign: "right", borderBottom: "1px solid #f3f4f6" }}>{fmt.currency(b.net_payable)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: "#f1f5f9" }}>
                <td colSpan={4} style={{ padding: "8px 12px", fontWeight: 800, fontSize: 12 }}>TOTAL — {group.bills.length} bill{group.bills.length !== 1 ? "s" : ""}</td>
                <td style={{ padding: "8px 12px", fontWeight: 800, fontSize: 13, textAlign: "right" }}>{group.bags}</td>
                <td style={{ padding: "8px 12px", fontWeight: 800, fontSize: 13, textAlign: "right" }}>{fmt.currency(group.freight)}</td>
                <td style={{ padding: "8px 12px", fontWeight: 800, fontSize: 13, textAlign: "right" }}>{group.weight.toFixed(1)} kg</td>
                <td style={{ padding: "8px 12px", fontWeight: 800, fontSize: 13, textAlign: "right", color: "#16a34a" }}>{fmt.currency(group.net)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ))}
      </div>
    </div>
  );
}

// ============================================================
// Shared styles
// ============================================================
const labelStyle = { display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" };
const inputSm    = { padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box", width: "100%" };

// ============================================================
// AUDIT LOG — append-only change trail (admins only)
// ============================================================
const AUDIT_ENTITIES = [
  ["", "All"], ["sales_bill", "Sales bill"], ["purchase_bill", "Purchase bill"],
  ["payment_received", "Receipt"], ["farmer_payout", "Farmer payout"],
  ["market_purchase", "Market purchase"], ["market_settlement", "Market settlement"],
  ["discount", "Discount"], ["adjustment", "Adjustment"], ["expense", "Expense"],
  ["party", "Party"], ["product", "Product"], ["vendor_discount", "Vendor discount"], ["settings", "Settings"],
];
const auditChip = (a) => {
  const m = { CREATE: ["#dcfce7", "#16a34a"], UPDATE: ["#dbeafe", "#2563eb"], DELETE: ["#fee2e2", "#dc2626"], VOID: ["#fee2e2", "#dc2626"] };
  const [bg, color] = m[a] || ["#f3f4f6", "#374151"];
  return { background: bg, color, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 5, whiteSpace: "nowrap" };
};
const fmtDetails = (s) => {
  if (!s) return "";
  try {
    const o = JSON.parse(s);
    return Object.entries(o).map(([k, v]) => {
      const isMoney = /amount|net|paid|carry|discount|restored|applied|purchases|netted|cash/i.test(k) && typeof v === "number";
      return `${k}: ${isMoney ? fmt.currency(v) : v}`;
    }).join("  ·  ");
  } catch { return s; }
};

// ===================== Website (public marketing) admin =====================
export function WebsitePage() {
  const [tab, setTab] = useState("rates");
  const T = (id, label) => (
    <button onClick={() => setTab(id)} style={{
      padding: "9px 18px", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700,
      background: tab === id ? "white" : "transparent", color: tab === id ? "#0f4c2a" : "#6b7280",
      borderBottom: tab === id ? "2px solid #1a7a45" : "2px solid transparent" }}>{label}</button>
  );
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700 }}>🌐 Website</h1>
      <p style={{ margin: "0 0 16px", color: "#6b7280", fontSize: 13 }}>
        Manage what the public homepage shows. Customers see only what you publish here — never your private data.
      </p>
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #e5e7eb", marginBottom: 18 }}>
        {T("rates", "📋 Publish daily rates")}
        {T("enquiries", "📨 Enquiries")}
      </div>
      {tab === "rates" ? <PublishRatesPanel /> : <EnquiriesPanel />}
    </div>
  );
}

function PublishRatesPanel() {
  const today = new Date().toISOString().split("T")[0];
  const [rows, setRows]   = useState([]);     // { product_id, name, name_ta, show, price, unit, note }
  const [asOf, setAsOf]   = useState(today);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]     = useState("");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api(`products?action=rates&date=${today}`),
      api("marketing?action=get-rates"),
    ]).then(([pr, pub]) => {
      const published = {};
      (pub.data?.items || []).forEach(it => { published[(it.name || "").toLowerCase()] = it; });
      if (pub.data?.as_of) setAsOf(pub.data.as_of);
      setRows((pr.data || []).map(p => {
        const pid = p.product_id || p.id;
        const m = published[(p.name_en || "").toLowerCase()];
        return {
          product_id: pid,
          name: p.name_en || "",
          name_ta: p.name_ta || "",
          show: !!m,
          price: m ? m.price : (p.market_rate || ""),
          unit: m ? m.unit : (p.unit_type === "BAG" ? "bag" : "kg"),
          note: m ? (m.note || "") : "",
        };
      }));
    }).catch(e => setMsg(e.message)).finally(() => setLoading(false));
  }, []);

  const upd = (i, k, v) => setRows(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const shownCount = rows.filter(r => r.show && r.price !== "" && Number(r.price) > 0).length;

  const publish = async () => {
    setSaving(true); setMsg("");
    try {
      const items = rows.filter(r => r.show && r.price !== "" && Number(r.price) > 0)
        .map(r => ({ name: r.name, name_ta: r.name_ta, price: Number(r.price), unit: r.unit, note: r.note }));
      const r = await api("marketing?action=save-rates", { method: "POST", body: JSON.stringify({ as_of: asOf, items }) });
      setMsg(`✅ Published ${r.data.count} rate${r.data.count === 1 ? "" : "s"} to the website.`);
    } catch (e) { setMsg(e.message); }
    finally { setSaving(false); }
  };

  if (loading) return <div style={{ color: "#666", padding: 16 }}>Loading…</div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Rates as of&nbsp;
          <input type="date" value={asOf} max={today} onChange={e => setAsOf(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid #d1d5db", fontSize: 13 }} />
        </label>
        <span style={{ fontSize: 13, color: "#6b7280" }}>{shownCount} product{shownCount === 1 ? "" : "s"} will show on the site</span>
        <span style={{ flex: 1 }} />
        <button onClick={publish} disabled={saving}
          style={{ padding: "10px 20px", background: saving ? "#9ca3af" : "#1a7a45", border: "none", borderRadius: 8,
                   color: "white", fontSize: 14, fontWeight: 700, cursor: saving ? "wait" : "pointer" }}>
          {saving ? "Publishing…" : "🚀 Publish to website"}
        </button>
      </div>
      {msg && <div style={{ marginBottom: 12, fontSize: 13.5, color: msg.startsWith("✅") ? "#15803d" : "#dc2626" }}>{msg}</div>}
      <div style={{ background: "white", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ background: "#f9fafb" }}>
            {["Show", "Product", "Public price ₹", "Per", "Note (optional)"].map(h =>
              <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.product_id} style={{ borderBottom: "1px solid #f3f4f6", background: r.show ? "#f0fdf4" : "white" }}>
                <td style={{ padding: "8px 12px", textAlign: "center" }}>
                  <input type="checkbox" checked={r.show} onChange={e => upd(i, "show", e.target.checked)} />
                </td>
                <td style={{ padding: "8px 12px", fontSize: 13.5 }}>
                  <span style={{ fontWeight: 600 }}>{r.name}</span>
                  {r.name_ta && <span style={{ color: "#6b7280", marginLeft: 6, fontSize: 12 }}>{r.name_ta}</span>}
                </td>
                <td style={{ padding: "8px 12px" }}>
                  <input type="number" step="0.5" value={r.price} onChange={e => upd(i, "price", e.target.value)}
                    style={{ width: 90, padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }} />
                </td>
                <td style={{ padding: "8px 12px" }}>
                  <select value={r.unit} onChange={e => upd(i, "unit", e.target.value)}
                    style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}>
                    <option value="kg">kg</option><option value="bag">bag</option><option value="piece">piece</option><option value="dozen">dozen</option>
                  </select>
                </td>
                <td style={{ padding: "8px 12px" }}>
                  <input value={r.note} placeholder="e.g. Ooty / A-grade" onChange={e => upd(i, "note", e.target.value)}
                    style={{ width: "90%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EnquiriesPanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = () => { setLoading(true); api("marketing?action=enquiries").then(r => setRows(r.data || [])).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const act = async (id, body) => {
    try { await api("marketing?action=enquiry-status", { method: "POST", body: JSON.stringify({ id, ...body }) }); load(); }
    catch (e) { alert(e.message); }
  };

  if (loading) return <div style={{ color: "#666", padding: 16 }}>Loading…</div>;
  if (rows.length === 0) return <div style={{ background: "white", borderRadius: 12, padding: 30, textAlign: "center", color: "#6b7280", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>No enquiries yet. They'll appear here when customers use the website form.</div>;

  const badge = (s) => ({ new: ["#fef9c3", "#ca8a04"], contacted: ["#dbeafe", "#2563eb"], closed: ["#e5e7eb", "#6b7280"] }[s] || ["#fef9c3", "#ca8a04"]);
  return (
    <div style={{ background: "white", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr style={{ background: "#f9fafb" }}>
          {["When", "Name", "Phone", "Message", "Status", ""].map(h =>
            <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>{h}</th>)}
        </tr></thead>
        <tbody>
          {rows.map(e => {
            const [bg, col] = badge(e.status);
            return (
              <tr key={e.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "10px 12px", fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>{e.created_at}</td>
                <td style={{ padding: "10px 12px", fontSize: 13.5, fontWeight: 600 }}>{e.name}</td>
                <td style={{ padding: "10px 12px", fontSize: 13.5 }}><a href={`tel:${e.phone}`} style={{ color: "#2563eb" }}>{e.phone}</a></td>
                <td style={{ padding: "10px 12px", fontSize: 13, color: "#374151", maxWidth: 320 }}>{e.message || "—"}</td>
                <td style={{ padding: "10px 12px" }}><span style={{ padding: "2px 10px", borderRadius: 10, fontSize: 11, fontWeight: 700, background: bg, color: col }}>{e.status}</span></td>
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                  {e.status !== "contacted" && <button onClick={() => act(e.id, { status: "contacted" })} style={miniBtn("#eff6ff", "#2563eb")}>✓ Contacted</button>}
                  <button onClick={() => { if (window.confirm("Delete this enquiry?")) act(e.id, { delete: true }); }} style={miniBtn("#fef2f2", "#dc2626")}>🗑️</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
const miniBtn = (bg, col) => ({ padding: "4px 10px", marginLeft: 6, background: bg, border: "none", borderRadius: 6, color: col, cursor: "pointer", fontSize: 12, fontWeight: 600 });

export function AuditLogPage() {
  const [from, setFrom] = useState(new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0]);
  const [to, setTo]     = useState(new Date().toISOString().split("T")[0]);
  const [userId, setUserId] = useState("");
  const [entity, setEntity] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api("audit?action=users").then(r => setUsers(r.data || [])).catch(() => {}); }, []);
  const load = () => {
    setLoading(true);
    const qp = new URLSearchParams({ action: "list", from, to });
    if (userId) qp.set("user_id", userId);
    if (entity) qp.set("entity", entity);
    if (q.trim()) qp.set("q", q.trim());
    api(`audit?${qp.toString()}`).then(r => setRows(r.data || [])).catch(() => setRows([])).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [from, to, userId, entity]);

  const csv = () => downloadCSV(`audit_${from}_${to}.csv`,
    [["Time", "User", "Action", "Type", "Reference", "Details", "IP"],
     ...rows.map(r => [r.ts, r.username, r.action, r.entity, `${r.label || ""} ${r.entity_id ? "#" + r.entity_id : ""}`, fmtDetails(r.details), r.ip])]);

  const th = { textAlign: "left", padding: "8px 10px", fontSize: 11, color: "#6b7280", textTransform: "uppercase", borderBottom: "2px solid #eef2f7", whiteSpace: "nowrap" };
  const td = { padding: "8px 10px", fontSize: 12.5, borderBottom: "1px solid #f1f5f9", verticalAlign: "top" };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>🔍 Audit Log <span style={{ fontSize: 13, color: "#666" }}>தணிக்கை பதிவு</span></h1>
        <span style={{ fontSize: 12, color: "#888" }}>Append-only — who changed what, when, and the values.</span>
      </div>

      <div style={{ background: "white", borderRadius: 12, padding: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", marginBottom: 14, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div><label style={labelStyle}>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...inputSm, width: "auto" }} /></div>
        <div><label style={labelStyle}>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...inputSm, width: "auto" }} /></div>
        <div><label style={labelStyle}>User</label>
          <select value={userId} onChange={e => setUserId(e.target.value)} style={{ ...inputSm, width: "auto" }}>
            <option value="">All users</option>
            {users.map(u => <option key={u.user_id} value={u.user_id}>{u.username}</option>)}
          </select></div>
        <div><label style={labelStyle}>Type</label>
          <select value={entity} onChange={e => setEntity(e.target.value)} style={{ ...inputSm, width: "auto" }}>
            {AUDIT_ENTITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></div>
        <div style={{ flex: 1, minWidth: 160 }}><label style={labelStyle}>Search</label>
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") load(); }} placeholder="bill no, name, amount…" style={inputSm} /></div>
        <button onClick={load} style={{ padding: "8px 16px", background: "#1a7a45", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Search</button>
        <button onClick={csv} style={{ padding: "8px 16px", background: "#374151", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>⬇ CSV</button>
      </div>

      <div style={{ background: "white", borderRadius: 12, padding: 6, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
          <thead><tr><th style={th}>Time</th><th style={th}>User</th><th style={th}>Action</th><th style={th}>Type</th><th style={th}>Reference</th><th style={th}>Details</th><th style={th}>IP</th></tr></thead>
          <tbody>
            {loading ? <tr><td style={{ ...td, textAlign: "center", color: "#666" }} colSpan={7}>Loading…</td></tr> :
            rows.length === 0 ? <tr><td style={{ ...td, textAlign: "center", color: "#999" }} colSpan={7}>No activity in this range</td></tr> :
            rows.map(r => (
              <tr key={r.id}>
                <td style={{ ...td, whiteSpace: "nowrap", color: "#555" }}>{r.ts}</td>
                <td style={{ ...td, fontWeight: 600, whiteSpace: "nowrap" }}>{r.username || "—"}</td>
                <td style={td}><span style={auditChip(r.action)}>{r.action}</span></td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{(AUDIT_ENTITIES.find(e => e[0] === r.entity) || [, r.entity])[1]}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{r.label}{r.entity_id ? <span style={{ color: "#999" }}> #{r.entity_id}</span> : ""}</td>
                <td style={{ ...td, color: "#374151", maxWidth: 360, whiteSpace: "normal" }}>{fmtDetails(r.details)}</td>
                <td style={{ ...td, color: "#999", whiteSpace: "nowrap" }}>{r.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length >= 500 && <div style={{ fontSize: 12, color: "#888", marginTop: 8 }}>Showing the latest 500 — narrow the date range or search to see more.</div>}
    </div>
  );
}

// ============================================================
// AUDIT PACK — financial-year P&L + balances + registers for the auditor
// ============================================================
function AuditPackReport() {
  // Indian FY runs Apr 1 → Mar 31. Build a few selectable years.
  const now = new Date();
  const curFyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyList = [curFyStart, curFyStart - 1, curFyStart - 2];
  const [fy, setFy] = useState(curFyStart);
  const from = `${fy}-04-01`;
  const toFull = `${fy + 1}-03-31`;
  const to = toFull > now.toISOString().split("T")[0] ? now.toISOString().split("T")[0] : toFull;  // cap in-progress year at today

  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    api(`reports?action=audit-pack&from=${from}&to=${to}`).then(r => setD(r.data)).catch(() => setD(null)).finally(() => setLoading(false));
  }, [from, to]);

  // CSV register: pull a list endpoint, dump every column (auditor wants the raw detail).
  const exportCSV = async (endpoint, filename, pick = (r) => r.data) => {
    try {
      const r = await api(endpoint);
      const rows = pick(r) || [];
      if (!rows.length) { alert("No rows for this period."); return; }
      const keys = Object.keys(rows[0]);
      downloadCSV(filename, [keys, ...rows.map(o => keys.map(k => o[k]))]);
    } catch (e) { alert(e.message); }
  };
  const fyTag = `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;
  const registers = [
    ["🧾 Sales register",    `sales?action=list&from=${from}&to=${to}`,             `sales_${fyTag}.csv`,     (r) => r.data],
    ["🛒 Purchase register", `purchase?action=list&from=${from}&to=${to}`,          `purchases_${fyTag}.csv`, (r) => r.data],
    ["💵 Receipts",          `reports?action=collections&from=${from}&to=${to}`,    `receipts_${fyTag}.csv`,  (r) => r.data],
    ["➖ Farmer payouts",    `reports?action=payouts-list&from=${from}&to=${to}`,   `payouts_${fyTag}.csv`,   (r) => r.data],
    ["📋 Expenses",          `reports?action=expenses&from=${from}&to=${to}`,       `expenses_${fyTag}.csv`,  (r) => r.detail],
  ];

  const row = (label, value, opts = {}) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f1f5f9",
      fontWeight: opts.bold ? 700 : 400, fontSize: opts.big ? 15 : 13.5 }}>
      <span style={{ color: opts.indent ? "#6b7280" : "#111", paddingLeft: opts.indent ? 16 : 0 }}>{label}</span>
      <span style={{ color: opts.color || "#111" }}>{fmt.currency(value)}</span>
    </div>
  );
  const cardStyle = { background: "white", borderRadius: 12, padding: 18, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", marginBottom: 16 };

  return (
    <div>
      <div className="no-print" style={{ ...cardStyle, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Financial year</span>
        {fyList.map(y => (
          <button key={y} onClick={() => setFy(y)} style={{ padding: "7px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
            background: fy === y ? "#1a7a45" : "#f3f4f6", color: fy === y ? "white" : "#374151" }}>
            {y}–{String((y + 1) % 100).padStart(2, "0")}
          </button>
        ))}
        <span style={{ fontSize: 12, color: "#888" }}>{from} → {to}</span>
        <button onClick={() => window.print()} style={{ marginLeft: "auto", padding: "8px 16px", background: "#374151", border: "none", borderRadius: 8, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>🖨️ Print</button>
      </div>

      {loading ? <div style={{ padding: 30, textAlign: "center", color: "#666" }}>Loading…</div> : !d ? <div style={{ padding: 30, textAlign: "center", color: "#999" }}>No data.</div> : (
      <>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>Sri Murugan &amp; Co — Audit Pack</div>
          <div style={{ fontSize: 13, color: "#666" }}>Financial Year {fyTag} &nbsp;·&nbsp; {from} to {to}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* P&L */}
          <div style={cardStyle}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Profit &amp; Loss</div>
            {row("Gross profit (commission + trading margin)", d.pnl.gross_profit, { bold: true })}
            <div style={{ fontSize: 11, color: "#9ca3af", padding: "2px 0 6px" }}>incl. commission {fmt.currency(d.pnl.commission)}</div>
            {row("Less: Operating expenses", d.pnl.expenses_total, { color: "#dc2626" })}
            {d.pnl.expenses_by_cat.map((c, i) => row(c.category, c.amount, { indent: true, color: "#6b7280" }))}
            {row("Less: Discounts given to customers", d.pnl.discounts, { color: "#dc2626" })}
            <div style={{ borderTop: "2px solid #1a7a45", marginTop: 6 }} />
            {row("Net profit", d.pnl.net_profit, { bold: true, big: true, color: d.pnl.net_profit >= 0 ? "#1a7a45" : "#dc2626" })}
            {d.pnl.adjustments > 0 && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>Memo: vendor adjustments booked {fmt.currency(d.pnl.adjustments)} (profit-neutral)</div>}
          </div>

          {/* Balances + turnover */}
          <div>
            <div style={cardStyle}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Closing balances (as at {to})</div>
              {row("Receivable — vendors owe us", d.balances.receivable, { color: "#16a34a" })}
              {row("Payable — we owe farmers/suppliers", d.balances.payable_farmer, { color: "#dc2626" })}
              {d.balances.payable_market > 0 && row("Payable — market vendors", d.balances.payable_market, { color: "#dc2626" })}
            </div>
            <div style={cardStyle}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Turnover</div>
              {row(`Sales (${d.turnover.sales.bills} bills)`, d.turnover.sales.net)}
              {row(`Purchases (${d.turnover.purchases.bills} bills)`, d.turnover.purchases.net_payable)}
              {row("Commission earned", d.turnover.purchases.commission, { indent: true, color: "#6b7280" })}
              {row(`Receipts collected (${d.turnover.receipts.n})`, d.turnover.receipts.total)}
              {row(`Farmer payouts (${d.turnover.payouts.n})`, d.turnover.payouts.total)}
              {d.turnover.market.purchases > 0 && row("Market purchases", d.turnover.market.purchases)}
            </div>
          </div>
        </div>

        {/* Detailed registers */}
        <div className="no-print" style={cardStyle}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Detailed registers (CSV)</div>
          <div style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>Full line-by-line detail for the year — hand these to your auditor alongside the summary above.</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {registers.map(([label, ep, fn, pick]) => (
              <button key={fn} onClick={() => exportCSV(ep, fn, pick)} style={{ padding: "8px 14px", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{label} ⬇</button>
            ))}
          </div>
        </div>

        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
          Figures are drawn directly from the recorded transactions. Net profit = gross profit − operating expenses − customer discounts.
          Provide the registers above for verification. This is a management report, not a substitute for your CA's audited statements.
        </div>
      </>)}
    </div>
  );
}
