// ============================================================
//  QUICK PURCHASE BILL - Simplified for speed (200 bills/30min)
//  Preloaded from Yard Entry, Tab/Enter navigation
// ============================================================
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { api, apiCached, fmt, useNavGuard, SearchableSelect, getPrintTemplate, PendingQueue, getWorkingDate, getBusinessRules, DEFAULT_RULES, getPreprint, PreprintRender, shareBillAsPdf } from "../App.jsx";
import BillsViewer from "./BillsViewer.jsx";

export default function QuickPurchasePage() {
  const [date, setDate]           = useState(getWorkingDate());
  const [reference, setReference] = useState(localStorage.getItem("yard_ref") || "DIRECT");
  const [editRef, setEditRef]     = useState(!localStorage.getItem("yard_ref"));
  const [trucks, setTrucks]       = useState([]);
  const [yardEntries, setYardEntries] = useState([]);
  const [farmers, setFarmers]     = useState([]);
  const [products, setProducts]   = useState([]);
  const [rates, setRates]         = useState({});
  const [bill, setBill]           = useState(newBill());
  const [editingId, setEditingId] = useState(null);   // bill id being edited (null = new)
  const [saving, setSaving]       = useState(false);
  const [printBills, setPrintBills] = useState(null); // array of print-shaped bills
  const [view, setView]           = useState("form"); // form | pending | list
  const [fromPending, setFromPending] = useState(false); // billing from the Pending queue (auto-advance on save)
  const [bills, setBills]         = useState([]);
  const [selectedIds, setSelectedIds] = useState([]); // bill ids selected in list for bulk print
  const farmerSelRef = useRef();

  function newBill() {
    return {
      farmer_id: "", farmer_name: "", farmer_name_ta: "", town: "",
      items: [newItem()],
      commission_pct: RULES.commission_pct, coolie: "", sakku: "", freight: "",
    };
  }
  function newItem() {
    return { product_id: "", product_name: "", bags: "", weights: [], net_weight: 0, rate: "", total: 0, bag_deduction: 0, unit: "KG", damage: "" };
  }

  // Keep the bill date in sync if the working date is changed in the Day bar
  useEffect(() => {
    const h = (e) => setDate(e.detail);
    window.addEventListener("rsm-working-date", h);
    return () => window.removeEventListener("rsm-working-date", h);
  }, []);

  useEffect(() => {
    Promise.all([
      // Purchase-side parties: Farmer, Supplier, Market Supplier
      apiCached("parties?action=list&category=FARMER&cols=lite"),
      apiCached("parties?action=list&category=SUPPLIER&cols=lite"),
      apiCached("parties?action=list&category=MARKET_SUPPLIER&cols=lite"),
      api(`products?action=rates&date=${date}`),
      apiCached("parties?action=list&category=TRUCK&cols=lite"),
    ]).then(([f, su, ms, r, t]) => {
      const seen = new Set();
      setFarmers([...f.data, ...su.data, ...ms.data].filter(x => !seen.has(x.id) && seen.add(x.id)));
      setProducts(r.data);
      setTrucks(t.data);
      const rm = {};
      r.data.forEach(p => { if (p.market_rate) rm[p.product_id] = p.market_rate; });
      setRates(rm);
    });
    loadYardEntries();
    loadTodayBills();
    getBusinessRules().then(r => {
      RULES = r;
      // apply the configured default commission to the untouched blank form
      setBill(p => (!p.farmer_id && !editingId) ? { ...p, commission_pct: r.commission_pct } : p);
    });
  }, [date]);

  const setRef = (val) => {
    setReference(val);
    localStorage.setItem("yard_ref", val);
    setEditRef(false);
  };

  const loadYardEntries = () => {
    const refParam = reference && reference !== "DIRECT"
      ? `&ref=${encodeURIComponent(reference)}`
      : "&ref=DIRECT";
    api(`yard?action=list&date=${date}${refParam}`)
      .then(r => setYardEntries(r.data || []))
      .catch(() => {});
  };

  const loadTodayBills = () => {
    api(`purchase?action=list&from=${date}&to=${date}`)
      .then(r => setBills(r.data || []))
      .catch(() => {});
  };

  // Load yard entry into bill form
  const loadFromYard = (entry) => {
    const items = (entry.items || []).map(i => ({
      product_id: i.product_id,
      product_name: i.product_name,
      bags: i.bags,
      weights: i.weights || [],
      net_weight: i.net_weight,
      rate: rates[i.product_id] || "",
      total: ((i.net_weight) * (rates[i.product_id] || 0)).toFixed(2),
    }));
    setBill({
      farmer_id: entry.farmer_id,
      farmer_name: entry.farmer_name,
      farmer_name_ta: entry.farmer_name_ta || "",
      town: entry.town,
      yard_entry_id: entry.id,
      items,
      commission_pct: RULES.commission_pct, coolie: String(computePurchaseCoolie(items)), sakku: "",
      freight: Number(entry.freight) > 0 ? String(entry.freight) : "",
    });
    setView("form");
    setTimeout(() => document.querySelector(".farmer-sel")?.focus(), 100);
  };

  const handleBagCount = (idx, count) => {
    const n = parseInt(count) || 0;
    setBill(prev => {
      const items = [...prev.items];
      const it = items[idx];
      const rate = parseFloat(it.rate) || 0;
      if (it.unit === "BAG") {
        // Bag-priced (e.g. Brinjal): no weighing — bill by bag count
        items[idx] = { ...it, bags: count, weights: [], net_weight: 0, total: (n * rate).toFixed(2) };
      } else {
        const existing = it.weights || [];
        const deduct = it.bag_deduction ?? 0;
        const weights = Array.from({ length: n }, (_, i) => existing[i] || "");
        const net = calcNet(weights, n, deduct, it.damage);
        items[idx] = { ...it, bags: count, weights, net_weight: net, total: (net * rate).toFixed(2) };
      }
      return { ...prev, items, coolie: String(computePurchaseCoolie(items)) };
    });
  };

  const handleWeight = (idx, wi, val) => {
    setBill(prev => {
      const items = [...prev.items];
      const weights = [...items[idx].weights];
      weights[wi] = val;
      const deduct = items[idx].bag_deduction ?? 0;
      const net = calcNet(weights, parseInt(items[idx].bags) || 0, deduct, items[idx].damage);
      const rate = parseFloat(items[idx].rate) || 0;
      items[idx] = { ...items[idx], weights, net_weight: net, total: (net * rate).toFixed(2) };
      return { ...prev, items, coolie: String(computePurchaseCoolie(items)) };
    });
  };

  // Damaged-goods weight for a row — deducted from the billed (net) weight; shown on the bill.
  const handleDamage = (idx, val) => {
    setBill(prev => {
      const items = [...prev.items];
      const it = items[idx];
      const deduct = it.bag_deduction ?? 0;
      const net = calcNet(it.weights, parseInt(it.bags) || 0, deduct, val);
      const rate = parseFloat(it.rate) || 0;
      items[idx] = { ...it, damage: val, net_weight: net, total: (net * rate).toFixed(2) };
      return { ...prev, items, coolie: String(computePurchaseCoolie(items)) };
    });
  };

  const handleRate = (idx, val) => {
    setBill(prev => {
      const items = [...prev.items];
      const it = items[idx];
      const r = parseFloat(val) || 0;
      const qty = it.unit === "BAG" ? (parseInt(it.bags) || 0) : (it.net_weight || 0);
      items[idx] = { ...it, rate: val, total: (qty * r).toFixed(2) };
      return { ...prev, items };
    });
  };

  const calcNet = (weights, bags, deductionPerBag = 0, damage = 0) => {
    const raw = weights.reduce((s, w) => s + (parseFloat(w) || 0), 0);
    return Math.max(0, parseFloat((raw - bags * deductionPerBag - (parseFloat(damage) || 0)).toFixed(2)));
  };

  const addItem = () => setBill(prev => ({ ...prev, items: [...prev.items, newItem()] }));
  const removeItem = (idx) => setBill(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));

  // Totals
  const grossAmt   = bill.items.reduce((s, i) => s + parseFloat(i.total || 0), 0);
  // Commission is rounded to whole rupees (no paise on the farmer's bill): half-up, so
  // 1151.23 → 1151 and 1151.50 → 1152. The net payable is rounded to whole rupees too.
  const commAmt    = Math.round(grossAmt * (parseFloat(bill.commission_pct) || 0) / 100);
  // Coolie auto-calculates per bag (0kg→₹5, 1–30kg→₹3, 31kg+→₹5) but is editable with the stepper.
  const coolieAmt  = parseFloat(bill.coolie || 0);
  const sakkuAmt   = parseFloat(bill.sakku   || 0);
  const freightAmt = parseFloat(bill.freight || 0);
  const netPayable = Math.round(grossAmt - commAmt - coolieAmt - sakkuAmt - freightAmt);
  const totalWeight = bill.items.reduce((s, i) => s + (parseFloat(i.net_weight) || 0), 0);

  const isDirty = () => {
    if (saving) return false;
    if (bill.farmer_id) return true;
    return bill.items.some(i => i.product_id || i.bags || i.rate || (i.weights || []).some(w => w));
  };

  const handleSave = async (andPrint = false) => {
    if (!bill.farmer_id) { alert("Select farmer"); return false; }
    // Drop blank rows (an empty line is left behind when Enter adds the next product)
    const rows = bill.items.filter(i => i.product_id || i.bags || i.rate || (i.weights || []).some(w => w));
    if (rows.length === 0 || rows.some(i => !i.product_id || !i.bags || !i.rate)) { alert("Fill product, bags and rate for all rows"); return false; }
    setSaving(true);
    try {
      const payload = {
        bill_date: date,
        party_id: bill.farmer_id,
        party_type: "FARMER",
        payment_status: "unpaid",
        commission_pct: bill.commission_pct,
        total_cooly_amt: coolieAmt,
        total_sakku_amt: sakkuAmt,
        lorry_freight: freightAmt,
        reference: reference,
        items: rows.map(i => ({
          product_id: i.product_id,
          no_of_bags: parseInt(i.bags),
          actual_weight: i.weights.reduce((s, w) => s + (parseFloat(w) || 0), 0),
          bag_deduction: 0,
          billed_weight: i.net_weight,
          purchase_rate: parseFloat(i.rate),
          weights_detail: i.weights.join(","),
          damage_kg: parseFloat(i.damage) || 0,
          unit_type: i.unit || "KG",
          commission_pct: bill.commission_pct,
          cooly_amt: 0,
          sungam_amt: 0,
        })),
      };
      if (editingId) payload.id = editingId;
      const result = await api(`purchase?action=${editingId ? "update" : "save"}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (andPrint) {
        setPrintBills([{
          ...bill,
          items:       rows,   // filtered rows — not bill.items (which has the empty trailing line)
          bill_no:     result.data.bill_no,
          bill_id:     result.data.id,
          net_payable: result.data.net_payable,
          gross_amt:   grossAmt,
          comm_amt:    commAmt,
          coolie_amt:  coolieAmt,
          sakku_amt:   sakkuAmt,
          freight_amt: freightAmt,
          total_weight: totalWeight,
          date,
          reference,
        }]);
      }
      setEditingId(null);
      loadTodayBills();
      if (fromPending) {
        // Auto-advance to the next pending yard entry (compute from current list before it refreshes)
        const next = yardEntries.find(e => !e.billed && String(e.id) !== String(bill.yard_entry_id));
        loadYardEntries();
        if (next) { loadFromYard(next); }
        else { setBill(newBill()); setFromPending(false); setView("pending"); }
      } else {
        setBill(newBill());
        loadYardEntries();
        setTimeout(() => document.querySelector(".farmer-sel")?.focus(), 100);
      }
      return true;
    } catch (e) { alert("Error: " + e.message); return false; }
    finally { setSaving(false); }
  };

  // Load a saved bill into the form for editing (keeps same bill number on save)
  const handleEdit = async (b) => {
    try {
      const r = await api(`purchase?action=get&id=${b.id}`);
      setBill(toFormBill(r.data, farmers));
      setEditingId(r.data.id);
      setView("form");
      setTimeout(() => document.querySelector(".farmer-sel")?.focus(), 100);
    } catch (e) { alert("Error loading bill: " + e.message); }
  };

  const cancelEdit = () => { setEditingId(null); setBill(newBill()); };

  // Delete (cancel) a saved bill — warns first, reverses the ledger, audit-logged
  const handleDelete = async (b) => {
    if (!window.confirm(
      `⚠️ Delete bill ${b.bill_no}?\n\nFarmer: ${b.party_name}\nNet payable: ${fmt.currency(b.net_payable)}\n\n` +
      `This removes the bill from reports and reverses its entries (commission, the farmer's payable). It cannot be undone.`
    )) return;
    try {
      await api("purchase?action=cancel", { method: "POST", body: JSON.stringify({ id: b.id, reason: "Deleted from View Bills" }) });
      loadTodayBills();
      loadYardEntries();
    } catch (e) { alert("Error deleting bill: " + e.message); }
  };

  // Reprint a single saved bill (fetch full detail first)
  const handleReprint = async (b) => {
    try {
      const r = await api(`purchase?action=get&id=${b.id}`);
      setPrintBills([toPrintBill(r.data)]);
    } catch (e) { alert("Error: " + e.message); }
  };

  // Print all selected bills together (one per page)
  const handlePrintSelected = async () => {
    if (selectedIds.length === 0) return;
    try {
      const results = await Promise.all(selectedIds.map(id => api(`purchase?action=get&id=${id}`)));
      setPrintBills(results.map(r => toPrintBill(r.data)));
    } catch (e) { alert("Error: " + e.message); }
  };

  // Fetch bills by id and open the print view (used by the View Bills screen)
  const printByIds = async (ids) => {
    if (!ids?.length) return;
    try {
      const results = await Promise.all(ids.map(id => api(`purchase?action=get&id=${id}`)));
      setPrintBills(results.map(r => toPrintBill(r.data)));
    } catch (e) { alert("Error: " + e.message); }
  };
  const [viewReload, setViewReload] = useState(0);

  const toggleSelect = (id) => setSelectedIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  // Prompt to Save / Discard before leaving with an in-progress bill
  useNavGuard({ isDirty, save: () => handleSave(false) });

  if (printBills) return <PrintPurchaseBills bills={printBills} onClose={() => { setPrintBills(null); loadTodayBills(); setViewReload(n => n + 1); }} />;

  return (
    <div className="bill-page" style={{ padding: 20, fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
            🛒 Purchase Bills
            <span style={{ fontSize: 13, color: "#666", marginLeft: 8 }}>கொள்முதல் பில்</span>
          </h1>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13 }} />
          <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid #d1d5db" }}>
            {(() => { const pendCount = yardEntries.filter(e => !e.billed).length; return [
              { id: "form",    label: "➕ New Bill" },
              { id: "pending", label: `📋 Pending${pendCount ? ` (${pendCount})` : ""}` },
              { id: "list",    label: "📄 View Bills" },
            ].map(t => (
              <button key={t.id} onClick={() => { setFromPending(false); if (t.id === "form") { setBill(newBill()); setEditingId(null); } setView(t.id); }}
                style={{ padding: "7px 14px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                  background: view === t.id ? "#1a7a45" : "white", color: view === t.id ? "white" : "#374151" }}>{t.label}</button>
            )); })()}
          </div>
        </div>
      </div>

      {/* Reference / Truck bar */}
      <div style={{ background: "#0f4c2a", borderRadius: 12, padding: "10px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 13 }}>🚛 Reference:</span>
        {editRef ? (
          <select autoFocus defaultValue={reference} onChange={e => setRef(e.target.value)}
            style={{ flex: 1, padding: "7px 12px", borderRadius: 8, border: "none", fontSize: 14, fontWeight: 600 }}>
            <option value="">-- Select --</option>
            <option value="DIRECT">DIRECT (No Truck)</option>
            {trucks.map(t => <option key={t.id} value={t.name_en}>{t.name_en}{t.name_ta ? ` / ${t.name_ta}` : ""}</option>)}
          </select>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
            <span style={{ color: "white", fontWeight: 700, fontSize: 18, letterSpacing: 1 }}>{reference || "DIRECT"}</span>
            <button onClick={() => setEditRef(true)}
              style={{ padding: "4px 12px", background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 6, color: "white", cursor: "pointer", fontSize: 12 }}>Change</button>
          </div>
        )}
      </div>

      {/* Billing from the pending queue — progress + exit */}
      {fromPending && view === "form" && (
        <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 10, padding: "10px 16px",
                      marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#047857" }}>
            📋 Billing from pending queue — {yardEntries.filter(e => !e.billed).length} left. Saving loads the next automatically.
          </span>
          <button onClick={() => { setFromPending(false); setBill(newBill()); setView("pending"); }}
            style={{ padding: "5px 12px", background: "white", border: "1px solid #a7f3d0", borderRadius: 6, color: "#047857", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
            ← Back to queue
          </button>
        </div>
      )}

      {editingId && view === "form" && (
        <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "10px 16px",
                      marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#2563eb" }}>
            ✏️ Editing a saved bill — saving keeps the same bill number.
          </span>
          <button onClick={cancelEdit}
            style={{ padding: "5px 12px", background: "white", border: "1px solid #bfdbfe", borderRadius: 6, color: "#2563eb", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
            Cancel edit
          </button>
        </div>
      )}

      {view === "list" ? (
        <BillsViewer kind="purchase" onEdit={handleEdit} onPrintIds={printByIds} reloadSignal={viewReload} />
      ) : view === "pending" ? (
        <div style={{ background: "white", borderRadius: 12, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", maxWidth: 560 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>📋 Yard entries waiting to be billed ({yardEntries.filter(e => !e.billed).length})</div>
          <div style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
            Reference: <b>{reference}</b>. Pick one (↑↓ then Enter) — it loads into the bill form, and the next auto-loads after you save.
          </div>
          <div style={{ height: "calc(100vh - 340px)", minHeight: 200 }}>
            <PendingQueue
              items={yardEntries.filter(e => !e.billed).map(e => ({ id: e.id, label: e.farmer_name,
                sub: `${e.total_net_weight} kg · ${(e.items || []).length} item${(e.items || []).length > 1 ? "s" : ""}` }))}
              currentId={bill.yard_entry_id}
              placeholder="🔍 Search farmer… (↑↓ Enter)"
              emptyText="No yard entries pending 🎉"
              onPick={(id) => { const e = yardEntries.find(x => String(x.id) === String(id)); if (e) { setFromPending(true); loadFromYard(e); } }} />
          </div>
        </div>
      ) : (
        <div className="m-stack has-savebar" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
          {/* Bill form */}
          <div>
            {/* Farmer */}
            <div style={{ background: "white", borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={lbl}>Farmer / Supplier</label>
                  <SearchableSelect
                    className="farmer-sel" style={inp} placeholder="Type to search..."
                    value={bill.farmer_id}
                    options={farmers.map(f => ({ id: f.id, label: f.name_en }))}
                    onChange={(id) => {
                      const f = farmers.find(x => x.id == id);
                      setBill(p => ({ ...p, farmer_id: id, farmer_name: f?.name_en || "", farmer_name_ta: f?.name_ta || "", town: f?.city || f?.area || p.town }));
                    }}
                    onAdvance={() => document.querySelector(".product-sel")?.focus()} />   {/* skip Town (auto-filled) → go straight to product */}
                </div>
                <div>
                  <label style={lbl}>Town</label>
                  <input id="town-inp" value={bill.town}
                    onChange={e => setBill(p => ({ ...p, town: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); document.querySelector(".product-sel")?.focus(); }}}
                    placeholder="Town / Area" style={inp} />
                </div>
              </div>
            </div>

            {/* Items */}
            <div style={{ background: "white", borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
              <div className="pbill-itemhead" style={{ display: "grid", gridTemplateColumns: "180px 55px 1fr 90px 100px 32px", gap: 6, marginBottom: 8 }}>
                {["Product", "Bags", "Bag Weights (kg each)", "Net KG", "Rate ₹/kg", ""].map(h => (
                  <span key={h} style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</span>
                ))}
              </div>

              {bill.items.map((item, idx) => {
                const raw = item.weights.reduce((s, w) => s + (parseFloat(w) || 0), 0);
                return (
                  <div key={idx} className="item-row-wrap" style={{ background: "#f9fafb", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                    <div className="pbill-itemrow" style={{ display: "grid", gridTemplateColumns: "180px 55px 1fr 90px 100px 32px", gap: 6, alignItems: "start" }}>

                      {/* Product */}
                      <SearchableSelect className="product-sel" wrapClassName="pb-prod" style={{ ...inp, fontSize: 13, padding: "7px 8px" }} placeholder="Type product..."
                        value={item.product_id}
                        options={products.map(p => ({ id: (p.product_id || p.id), label: p.name_en }))}
                        onChange={(id) => {
                          const p = products.find(x => (x.product_id || x.id) == id);
                          setBill(prev => {
                            const items = [...prev.items];
                            const unit = p?.unit_type || "KG";
                            const r = parseFloat(items[idx].rate || rates[id] || 0);
                            const qty = unit === "BAG" ? (parseInt(items[idx].bags) || 0) : (items[idx].net_weight || 0);
                            items[idx] = { ...items[idx], product_id: id, product_name: p?.name_en || "", product_name_ta: p?.name_ta || "", unit, rate: items[idx].rate || rates[id] || "", bag_deduction: 0, total: (qty * r).toFixed(2) };
                            return { ...prev, items };
                          });
                        }}
                        onAdvance={(el) => el.closest(".item-row-wrap")?.querySelector(".bag-inp")?.focus()}
                        onEmptyEnter={() => document.getElementById("sakku-inp")?.focus()}
                        onEscape={() => document.getElementById("sakku-inp")?.focus()} />

                      {/* Bags */}
                      <input className="bag-inp pb-bags" type="number" min="1" step="1" inputMode="numeric" value={item.bags} placeholder="Bags"
                        onChange={e => handleBagCount(idx, e.target.value.replace(/[^\d]/g, ""))}
                        onKeyDown={e => {
                          if ([".", "e", "E", "+", "-"].includes(e.key)) { e.preventDefault(); return; }   // bags are whole numbers
                          if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                          e.preventDefault();
                          const row = e.target.closest(".item-row-wrap");
                          const firstW = row.querySelectorAll(".w-inp")[0];
                          (firstW || row.querySelector(".rate-inp"))?.focus();
                        }}}
                        style={{ ...inp, padding: "7px 6px", textAlign: "center", fontSize: 15, fontWeight: 700 }} />

                      {/* Weight boxes (KG products) — bag-priced products skip weighing */}
                      <div className="pb-wts">
                        {item.unit === "BAG" ? (
                          <div style={{ fontSize: 12, color: "#92400e", background: "#fffbeb", border: "1px dashed #fde047", borderRadius: 6, padding: "7px 10px" }}>
                            🧺 Billed by bag — {parseInt(item.bags) || 0} bags × ₹{item.rate || 0}
                          </div>
                        ) : (
                        <>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                          {item.weights.map((w, wi) => (
                            <input key={wi} className="w-inp" type="number" step="0.5" value={w}
                              placeholder={wi + 1}
                              onChange={e => handleWeight(idx, wi, e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                                  e.preventDefault();
                                  const row = e.target.closest(".item-row-wrap");
                                  const all = row.querySelectorAll(".w-inp");
                                  if (wi < all.length - 1) all[wi + 1].focus();
                                  else row.querySelector(".dmg-inp")?.focus();   // last bag → damage box
                                }
                              }}
                              style={{ width: 55, padding: "5px 4px", borderRadius: 6, border: "1px solid #d1d5db",
                                       fontSize: 12, textAlign: "center", boxSizing: "border-box" }} />
                          ))}
                          {/* Damaged-goods box (extra box; not billed in this line) */}
                          <div style={{ display: "flex", alignItems: "center", gap: 3, marginLeft: 4 }}>
                            <span style={{ fontSize: 9, fontWeight: 800, color: "#dc2626" }}>DMG</span>
                            <input className="dmg-inp" type="number" step="0.5" value={item.damage || ""} placeholder="kg"
                              onChange={e => handleDamage(idx, e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); e.target.closest(".item-row-wrap").querySelector(".rate-inp")?.focus(); }}}
                              title="Damaged goods weight — shown on the bill, not billed here"
                              style={{ width: 55, padding: "5px 4px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fef2f2",
                                       fontSize: 12, textAlign: "center", boxSizing: "border-box" }} />
                          </div>
                        </div>
                        {(raw > 0 || parseFloat(item.damage) > 0) && (
                          <div style={{ fontSize: 10, color: "#888", marginTop: 4 }}>
                            {parseFloat(item.damage) > 0 && <>Scale: <strong>{raw} kg</strong> − Damage: <strong style={{ color: "#dc2626" }}>{parseFloat(item.damage)} kg</strong> = </>}
                            Net billed: <strong style={{ color: "#1a7a45" }}>{item.net_weight} kg</strong>
                          </div>
                        )}
                        </>
                        )}
                      </div>

                      {/* Net qty */}
                      <div className="pb-net" style={{ fontWeight: 700, color: "#1a7a45", fontSize: 16, textAlign: "right", paddingTop: 6 }}>
                        {item.unit === "BAG" ? `${parseInt(item.bags) || 0} bags` : (item.net_weight > 0 ? `${item.net_weight} kg` : "—")}
                      </div>

                      {/* Rate */}
                      <input className="rate-inp pb-rate" type="number" step="0.5" value={item.rate} placeholder="₹ Rate"
                        onChange={e => handleRate(idx, e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Escape") { e.preventDefault(); document.getElementById("sakku-inp")?.focus(); return; }
                          if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                            e.preventDefault();
                            const nextProduct = document.querySelectorAll(".product-sel")[idx + 1];
                            if (nextProduct) { nextProduct.focus(); return; }
                            // Last row → open a fresh product line and jump to it (press Enter again on the
                            // empty product, or Esc, to drop down to Cash Advance instead)
                            addItem();
                            setTimeout(() => { const s = document.querySelectorAll(".product-sel"); s[s.length - 1]?.focus(); }, 40);
                          }
                        }}
                        style={{ ...inp, padding: "7px 8px", fontWeight: 600, background: item.rate ? "#f0fdf4" : "white" }} />

                      {/* Remove */}
                      {bill.items.length > 1 && (
                        <button className="pb-rm" onClick={() => removeItem(idx)}
                          style={{ background: "#fee2e2", border: "none", borderRadius: 6, color: "#dc2626", cursor: "pointer", fontSize: 13, padding: "6px 8px" }}>✕</button>
                      )}
                    </div>
                    {/* Row total */}
                    {item.total > 0 && (
                      <div style={{ textAlign: "right", fontSize: 12, color: "#374151", marginTop: 4 }}>
                        {item.net_weight} kg × ₹{item.rate} = <strong>{fmt.currency(item.total)}</strong>
                      </div>
                    )}
                  </div>
                );
              })}

              <button onClick={addItem}
                style={{ padding: "7px 16px", background: "#f0fdf4", border: "1px dashed #86efac",
                         borderRadius: 8, color: "#16a34a", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                + Add Product (Enter)
              </button>
            </div>

            {/* Deductions */}
            <div style={{ background: "white", borderRadius: 12, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 12 }}>DEDUCTIONS</div>
              <div className="m-2col" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                <div>
                  <label style={lbl}>Commission %</label>
                  {/* Auto-applied; click to edit. Skipped in Enter/Tab flow. */}
                  <input type="number" step="0.5" tabIndex={-1} value={bill.commission_pct}
                    onChange={e => setBill(p => ({ ...p, commission_pct: e.target.value }))}
                    style={inp} />
                </div>
                <div>
                  <label style={lbl}>Coolie ₹ (auto)</label>
                  {/* Auto-calculated per bag (0kg→₹5, 1–30kg→₹3, 31kg+→₹5); adjustable with the stepper */}
                  <input type="number" step="1" tabIndex={-1} value={bill.coolie} placeholder="0"
                    onChange={e => setBill(p => ({ ...p, coolie: e.target.value }))}
                    style={{ ...inp, fontWeight: 600 }} />
                </div>
                <div>
                  <label style={lbl}>Cash Advance ₹</label>
                  <input id="sakku-inp" type="number" value={bill.sakku} placeholder="0"
                    onChange={e => setBill(p => ({ ...p, sakku: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); document.getElementById("freight-inp")?.focus(); }}}
                    style={inp} />
                </div>
                <div>
                  <label style={lbl}>Freight ₹</label>
                  <input id="freight-inp" type="number" value={bill.freight} placeholder="0"
                    onChange={e => setBill(p => ({ ...p, freight: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); document.getElementById("save-print-btn")?.focus(); }}}
                    style={inp} />
                </div>
              </div>
            </div>
          </div>

          {/* Summary & Actions */}
          <div className="m-static" style={{ position: "sticky", top: 20 }}>
            <div style={{ background: "white", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#374151", marginBottom: 14 }}>BILL SUMMARY</div>
              {bill.farmer_name && (
                <div style={{ background: "#f0fdf4", borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{bill.farmer_name}</div>
                  {bill.farmer_name_ta && <div style={{ fontSize: 12, color: "#666" }}>{bill.farmer_name_ta}</div>}
                  <div style={{ fontSize: 12, color: "#888" }}>{bill.town}</div>
                </div>
              )}
              <SRow label="Total Weight"    value={`${totalWeight.toFixed(2)} kg`} />
              <SRow label="Gross Amount"    value={fmt.currency(grossAmt)} />
              <SRow label={`Commission ${bill.commission_pct}%`} value={fmt.currency(commAmt)} color="#7c3aed" />
              {coolieAmt  > 0 && <SRow label="Coolie"   value={fmt.currency(coolieAmt)} />}
              {sakkuAmt   > 0 && <SRow label="Cash Advance" value={fmt.currency(sakkuAmt)} />}
              {freightAmt > 0 && <SRow label="Freight"  value={fmt.currency(freightAmt)} />}
              <div style={{ borderTop: "2px solid #1a7a45", paddingTop: 10, marginTop: 10 }}>
                <SRow label="Net Payable to Farmer" value={fmt.currency(netPayable)} bold color="#1a7a45" big />
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button id="save-print-btn" className="m-hide" onClick={() => handleSave(true)} disabled={saving}
                style={{ padding: "12px", borderRadius: 10, border: "none", cursor: saving ? "not-allowed" : "pointer",
                         background: saving ? "#9ca3af" : "#1a7a45", color: "white", fontSize: 15, fontWeight: 700 }}>
                {saving ? "Saving..." : (editingId ? "💾 Update & Print" : "💾 Save & Print")}
              </button>
              <button onClick={() => handleSave(false)} disabled={saving}
                style={{ padding: "10px", borderRadius: 10, border: "1px solid #d1d5db", cursor: "pointer",
                         background: "white", color: "#374151", fontSize: 13, fontWeight: 600 }}>
                {editingId ? "Update Only" : "Save Only (Next Bill →)"}
              </button>
              <button onClick={() => editingId ? cancelEdit() : setBill(newBill())}
                style={{ padding: "8px", borderRadius: 10, border: "none", cursor: "pointer",
                         background: "#f3f4f6", color: "#6b7280", fontSize: 12 }}>
                {editingId ? "Cancel Edit" : "Clear Form"}
              </button>
            </div>
          </div>

          {/* Sticky bottom Save bar (phones only) */}
          <div className="mobile-savebar">
            <div>
              <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 600 }}>Net Payable</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#1a7a45" }}>{fmt.currency(netPayable)}</div>
            </div>
            <button onClick={() => handleSave(true)} disabled={saving}
              style={{ padding: "12px 22px", borderRadius: 10, border: "none", cursor: saving ? "not-allowed" : "pointer",
                       background: saving ? "#9ca3af" : "#1a7a45", color: "white", fontSize: 15, fontWeight: 700 }}>
              {saving ? "Saving..." : (editingId ? "💾 Update & Print" : "💾 Save & Print")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Print Bill Component ----
function PrintBill({ bill, onClose }) {
  useEffect(() => { setTimeout(() => window.print(), 300); }, []);
  return (
    <div>
      <div className="no-print" style={{ padding: 20, display: "flex", gap: 10 }}>
        <button onClick={() => window.print()}
          style={{ padding: "10px 24px", background: "#1a7a45", border: "none", borderRadius: 8, color: "white", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          🖨️ Print
        </button>
        <button onClick={onClose}
          style={{ padding: "10px 24px", background: "#f3f4f6", border: "none", borderRadius: 8, fontSize: 14, cursor: "pointer" }}>
          ← Back to Billing
        </button>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; padding: 0; }
          .print-bill { page-break-after: always; }
        }
        .print-bill { font-family: 'Noto Sans Tamil', Inter, 'Segoe UI', system-ui, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #333; padding: 6px 10px; }
        th { background: #f3f4f6; font-weight: 700; }
      `}</style>

      <div className="print-bill">
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 16, borderBottom: "2px solid #333", paddingBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Sri Murugan and Co</h2>
          <div style={{ fontSize: 12, color: "#666" }}>Powered for Oddanchatram Market</div>
          <div style={{ fontSize: 14, marginTop: 6, fontWeight: 600 }}>PURCHASE BILL / கொள்முதல் பில்</div>
        </div>

        {/* Bill meta */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14, fontSize: 13,
                      background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#1a7a45" }}>#{bill.bill_no}</div>
          <div style={{ textAlign: "right", fontSize: 13 }}>
            <strong>Date:</strong> {new Date(bill.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
          </div>
          <div><strong>Farmer:</strong> {bill.farmer_name} {bill.farmer_name_ta ? `/ ${bill.farmer_name_ta}` : ""}</div>
          <div style={{ textAlign: "right" }}><strong>Town:</strong> {bill.town}</div>
        </div>

        {/* Items table */}
        <table style={{ marginBottom: 14 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Product</th>
              <th>Bags</th>
              <th style={{ textAlign: "left" }}>Bag Weights (kg)</th>
              <th>Net KG</th>
              <th>Rate ₹</th>
              <th style={{ textAlign: "right" }}>Amount ₹</th>
            </tr>
          </thead>
          <tbody>
            {bill.items.map((item, i) => (
              <tr key={i}>
                <td>{item.product_name}</td>
                <td style={{ textAlign: "center" }}>{item.bags}</td>
                <td style={{ fontSize: 12 }}>{item.weights.join(", ")}</td>
                <td style={{ textAlign: "center", fontWeight: 700 }}>{item.net_weight}</td>
                <td style={{ textAlign: "center" }}>{item.rate}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{parseFloat(item.total || 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "#f9fafb" }}>
              <td colSpan={3} style={{ fontWeight: 700 }}>Total</td>
              <td style={{ textAlign: "center", fontWeight: 700 }}>
                {bill.items.reduce((s, i) => s + (parseFloat(i.net_weight) || 0), 0).toFixed(2)}
              </td>
              <td></td>
              <td style={{ textAlign: "right", fontWeight: 700 }}>
                {bill.items.reduce((s, i) => s + parseFloat(i.total || 0), 0).toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Deductions */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <table style={{ width: 280, fontSize: 13 }}>
            <tbody>
              <tr><td>Gross Amount</td><td style={{ textAlign: "right" }}>₹{bill.gross_amt?.toFixed(2)}</td></tr>
              <tr><td>Commission ({bill.commission_pct}%)</td><td style={{ textAlign: "right" }}>- ₹{parseFloat(bill.comm_amt || 0).toFixed(2)}</td></tr>
              {parseFloat(bill.coolie_amt || bill.coolie || 0) > 0 && <tr><td>Coolie</td><td style={{ textAlign: "right" }}>- ₹{parseFloat(bill.coolie_amt || bill.coolie || 0).toFixed(2)}</td></tr>}
              {parseFloat(bill.sakku_amt || bill.sakku || 0) > 0 && <tr><td>Cash Advance</td><td style={{ textAlign: "right" }}>- ₹{parseFloat(bill.sakku_amt || bill.sakku || 0).toFixed(2)}</td></tr>}
              {parseFloat(bill.freight_amt || bill.freight || 0) > 0 && <tr><td>Freight</td><td style={{ textAlign: "right" }}>- ₹{parseFloat(bill.freight_amt || bill.freight || 0).toFixed(2)}</td></tr>}
              <tr style={{ fontWeight: 700, fontSize: 15, borderTop: "2px solid #333" }}>
                <td>Net Payable</td>
                <td style={{ textAlign: "right", color: "#1a7a45" }}>₹{parseFloat(bill.net_payable || 0).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 20, fontSize: 12, color: "#666", borderTop: "1px solid #ddd", paddingTop: 10, display: "flex", justifyContent: "space-between" }}>
          <span>Payment Mode: {bill.payment_mode?.toUpperCase()}</span>
          <span>Thank you / நன்றி</span>
        </div>
      </div>
    </div>
  );
}

function BillsList({ bills, onReprint, onEdit, onDelete, selectedIds = [], onToggleSelect, onPrintSelected }) {
  const allSelected = bills.length > 0 && bills.every(b => selectedIds.includes(b.id));
  const toggleAll = () => {
    if (allSelected) bills.forEach(b => selectedIds.includes(b.id) && onToggleSelect(b.id));
    else bills.forEach(b => !selectedIds.includes(b.id) && onToggleSelect(b.id));
  };
  return (
    <div>
      {/* Bulk action bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 13, color: "#6b7280" }}>{selectedIds.length} selected</span>
        <button onClick={onPrintSelected} disabled={selectedIds.length === 0}
          style={{ padding: "7px 16px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 600,
                   cursor: selectedIds.length === 0 ? "not-allowed" : "pointer",
                   background: selectedIds.length === 0 ? "#e5e7eb" : "#1a7a45",
                   color: selectedIds.length === 0 ? "#9ca3af" : "white" }}>
          🖨️ Print Selected{selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
        </button>
      </div>

      <div style={{ background: "white", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              <th style={{ padding: "10px 14px", borderBottom: "1px solid #e5e7eb", width: 36 }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              {["Bill No", "Farmer", "Reference", "Town", "Weight", "Gross ₹", "Commission ₹", "Net Payable ₹", ""].map(h => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bills.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: 30, textAlign: "center", color: "#666" }}>No bills today</td></tr>
            ) : bills.map((b, i) => (
              <tr key={b.id} style={{ background: selectedIds.includes(b.id) ? "#eff6ff" : (i % 2 === 0 ? "white" : "#fafafa") }}>
                <td style={{ padding: "10px 14px", textAlign: "center" }}>
                  <input type="checkbox" checked={selectedIds.includes(b.id)} onChange={() => onToggleSelect(b.id)} />
                </td>
                <td style={{ padding: "10px 14px", fontWeight: 600, color: "#1a7a45", fontSize: 13 }}>{b.bill_no}</td>
                <td style={{ padding: "10px 14px", fontSize: 13 }}>{b.party_name}</td>
                <td style={{ padding: "10px 14px", fontSize: 12 }}>
                  {b.reference_name
                    ? <span style={{ background: "#eff6ff", color: "#2563eb", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>🚛 {b.reference_name}</span>
                    : <span style={{ color: "#9ca3af", fontSize: 11 }}>DIRECT</span>}
                </td>
                <td style={{ padding: "10px 14px", fontSize: 12, color: "#666" }}>{b.town || "—"}</td>
                <td style={{ padding: "10px 14px", fontSize: 12 }}>{parseFloat(b.subtotal_weight || 0).toFixed(1)} kg</td>
                <td style={{ padding: "10px 14px", fontSize: 12 }}>{fmt.currency(b.subtotal_amount)}</td>
                <td style={{ padding: "10px 14px", fontSize: 12, color: "#7c3aed" }}>{fmt.currency(b.total_commission)}</td>
                <td style={{ padding: "10px 14px", fontWeight: 700, color: "#1a7a45", fontSize: 13 }}>{fmt.currency(b.net_payable)}</td>
                <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                  <button onClick={() => onEdit(b)}
                    style={{ padding: "4px 10px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, color: "#2563eb", cursor: "pointer", fontSize: 12, fontWeight: 600, marginRight: 6 }}>✏️ Edit</button>
                  <button onClick={() => onReprint(b)}
                    style={{ padding: "4px 10px", background: "#f3f4f6", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, marginRight: 6 }}>🖨️</button>
                  <button onClick={() => onDelete(b)} title="Delete bill"
                    style={{ padding: "4px 10px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🗑️ Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Per-bag coolie slabs — configurable in Users/Admin → Business Rules
// (defaults: ₹5 if bag-priced/unweighed, ₹3 up to 30 kg, ₹5 above).
// Inline literal (NOT ...DEFAULT_RULES): App.jsx imports this file before it declares the
// DEFAULT_RULES const, so reading it at module-eval time would hit the TDZ and white-screen
// the whole app. Refreshed from the server on mount.
let RULES = { commission_pct: 10, credit_days: 14, freight_per_kg: 0.5, coolie_bag_zero: 5, coolie_bag_small: 3, coolie_bag_large: 5, coolie_small_max: 30 };
function coolieForBag(w) {
  const wt = parseFloat(w) || 0;
  return wt === 0 ? RULES.coolie_bag_zero : (wt <= RULES.coolie_small_max ? RULES.coolie_bag_small : RULES.coolie_bag_large);
}
function computePurchaseCoolie(items) {
  return (items || []).reduce((s, it) => {
    const bags = parseInt(it.bags) || 0;
    const ws = it.weights || [];
    let n = 0;
    for (let i = 0; i < bags; i++) n += coolieForBag(ws[i]);
    return s + n;
  }, 0);
}

// Map a saved purchase bill (GET response) into the editable form shape
function toFormBill(gb, farmers = []) {
  const party = farmers.find(f => f.id == gb.party_id);
  const items = (gb.items || []).map(it => {
    const bags = parseInt(it.no_of_bags) || 0;
    const billed = parseFloat(it.billed_weight || 0);
    const unit = it.unit_type || "KG";
    const rate = parseFloat(it.purchase_rate || 0);
    const damage = parseFloat(it.damage_kg || 0) ? String(it.damage_kg) : "";
    if (unit === "BAG") {
      return { product_id: String(it.product_id), product_name: it.product_name || "", product_name_ta: it.product_name_ta || "", unit,
               bags: String(bags), weights: [], net_weight: 0, damage,
               rate: rate ? String(rate) : "", total: (bags * rate).toFixed(2), bag_deduction: 0 };
    }
    let weights = it.weights_detail
      ? String(it.weights_detail).split(",").map(s => s.trim()).filter(s => s !== "")
      : [];
    if (weights.length === 0 && bags > 0) {
      // Older bills didn't store per-bag weights — spread the total evenly so the sum is preserved
      const per = billed > 0 ? +(billed / bags).toFixed(2) : 0;
      weights = Array.from({ length: bags }, () => per ? String(per) : "");
    }
    const rawSum = weights.reduce((s, w) => s + (parseFloat(w) || 0), 0);
    const net = rawSum > 0 ? Math.max(0, +(rawSum - (parseFloat(damage) || 0)).toFixed(2)) : billed;
    return {
      product_id: String(it.product_id), product_name: it.product_name || "", product_name_ta: it.product_name_ta || "", unit,
      bags: String(bags), weights, net_weight: net, damage,
      rate: rate ? String(rate) : "", total: (net * rate).toFixed(2), bag_deduction: 0,
    };
  });
  // Commission %: legacy/imported bills were stored with commission_pct=0 but a real
  // commission amount — derive the effective % so editing keeps the right commission & net.
  const grossForPct = parseFloat(gb.subtotal_amount || 0) || items.reduce((s, i) => s + parseFloat(i.total || 0), 0);
  const storedComm  = parseFloat(gb.total_commission || 0);
  let commPct = gb.commission_pct == null ? 10 : parseFloat(gb.commission_pct) || 0;
  if (!commPct && storedComm > 0 && grossForPct > 0) commPct = +(storedComm / grossForPct * 100).toFixed(2);
  return {
    farmer_id: gb.party_id,
    farmer_name: gb.party_name || party?.name_en || "",
    farmer_name_ta: gb.party_name_ta || party?.name_ta || "",
    town: gb.town || party?.city || party?.area || "",
    commission_pct: commPct,
    coolie: gb.total_cooly_amt ? String(gb.total_cooly_amt) : String(computePurchaseCoolie(items)),
    sakku: gb.total_sakku_amt ? String(gb.total_sakku_amt) : "",
    freight: gb.lorry_freight ? String(gb.lorry_freight) : "",
    items,
  };
}

// Map a saved purchase bill (GET response) into the print shape used by PurchaseBillSheet
export function toPrintBill(gb) {
  return {
    id: gb.id,
    bill_no: gb.bill_no, date: gb.bill_date, reference: gb.reference_name || "",
    farmer_name: gb.party_name || "", farmer_name_ta: gb.party_name_ta || "",
    town: gb.town || gb.city || gb.address || "",
    items: (gb.items || []).map(it => ({
      product_name: it.product_name, product_name_ta: it.product_name_ta,
      purchase_rate: it.purchase_rate, rate: it.purchase_rate,
      billed_weight: it.billed_weight, no_of_bags: it.no_of_bags,
      gross_amount: it.gross_amount, weights_detail: it.weights_detail, damage_kg: it.damage_kg,
    })),
    comm_amt: gb.total_commission, coolie_amt: gb.total_cooly_amt,
    sakku_amt: gb.total_sakku_amt, freight_amt: gb.lorry_freight,
    net_payable: gb.net_payable, gross_amt: gb.subtotal_amount,
    phone1: gb.phone1 || "",
  };
}

const SRow = ({ label, value, bold, color, big }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #f3f4f6" }}>
    <span style={{ fontSize: big ? 13 : 12, color: "#4b5563", fontWeight: bold ? 600 : 400 }}>{label}</span>
    <span style={{ fontSize: big ? 15 : 13, fontWeight: bold ? 700 : 600, color: color || "#111" }}>{value}</span>
  </div>
);

const lbl = { display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 5, textTransform: "uppercase" };
const inp = { width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14, boxSizing: "border-box", outline: "none", fontFamily: "inherit" };

// ============================================================
//  PURCHASE PRINT BILL - Matches actual SM&Co format exactly
// ============================================================
export function PrintPurchaseBills({ bills, onClose, dataOnly: dataOnlyProp = false }) {
  const list = Array.isArray(bills) ? bills : (bills ? [bills] : []);
  const [tpl, setTpl] = useState(null);
  const [tplReady, setTplReady] = useState(false);
  const [mode, setMode] = useState(dataOnlyProp ? "preprinted" : null);   // 'full' | 'preprinted' | 'thermal'
  useEffect(() => {
    getPrintTemplate().then(t => { setTpl(t); setMode(m => m || (t?.print_format || "full")); })
      .finally(() => setTplReady(true));
  }, []);
  // Auto-open the print dialog only once the template (logo/address/labels) has loaded —
  // otherwise on a cold cache (e.g. straight after Save & Print) the dialog fires on a
  // half-built page that shows just the heading.
  useEffect(() => {
    if (!tplReady) return;
    const t = setTimeout(() => window.print(), 350);
    return () => clearTimeout(t);
  }, [tplReady]);
  // Count this as a print so reprints are visible in View Bills (anti double-cash)
  useEffect(() => {
    const ids = list.map(b => b.id).filter(Boolean);
    if (ids.length) api("purchase?action=mark-printed", { method: "POST", body: JSON.stringify({ ids }) }).catch(() => {});
  }, []);

  const eff = mode || "full";
  const pageCss = {
    full:       "@page { size: A5 portrait; margin: 0; }",
    preprinted: "@page { size: 152.4mm 152.4mm; margin: 0; }",
    thermal:    "@page { size: 80mm auto; margin: 0; }",
  }[eff];
  const billWidth = { full: "148mm", preprinted: "152.4mm", thermal: "80mm" }[eff];

  return createPortal(
    <div className="print-portal">
      <style>{`
        .print-portal { position: fixed; inset: 0; background: #f3f4f6; overflow: auto; z-index: 2000;
                        font-family: 'Noto Sans Tamil', Inter, 'Segoe UI', system-ui, sans-serif; }
        .pbill { width: ${billWidth}; margin: 0 auto 16px; box-sizing: border-box; background: #fff; }
        .pbill.full { padding: 7mm; }
        .pbill.full table { width: 100%; border-collapse: collapse; }
        .pbill.full td, .pbill.full th { border: 1px solid #2d6a2d; padding: 4px 7px; font-size: 11.5px; }
        .pbill.full th { background: #e8f5e9; font-weight: 700; font-size: 10.5px; }
        .pbill.thermal { padding: 3mm 3.5mm; font-size: 12px; color: #000; line-height: 1.35; }
        @media screen { .pbill { box-shadow: 0 1px 10px rgba(0,0,0,0.18); } }
        @media print {
          .no-print { display: none !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body > *:not(.print-portal) { display: none !important; }
          .print-portal { position: static; overflow: visible; background: #fff; }
          .pbill { margin: 0; page-break-after: always; box-shadow: none; }
          .pbill:last-child { page-break-after: auto; }
          ${pageCss}
        }
      `}</style>

      <div className="no-print" style={{ padding: "16px 20px", display: "flex", gap: 10, alignItems: "center", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", flexWrap: "wrap" }}>
        <button onClick={() => window.print()}
          style={{ padding: "10px 24px", background: "#1a7a45", border: "none", borderRadius: 8, color: "white", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          🖨️ Print
        </button>
        <button onClick={onClose}
          style={{ padding: "10px 24px", background: "#f3f4f6", border: "none", borderRadius: 8, fontSize: 14, cursor: "pointer" }}>
          ← Back to Billing
        </button>
        <div style={{ display: "flex", border: "1px solid #d1d5db", borderRadius: 8, overflow: "hidden" }}>
          {[["full", "🧾 Full A5"], ["preprinted", "📄 Pre-printed"], ["thermal", "🧮 Thermal 80mm"]].map(([id, lab]) => (
            <button key={id} onClick={() => setMode(id)} style={{ padding: "8px 14px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
              borderLeft: id !== "full" ? "1px solid #e5e7eb" : "none",
              background: eff === id ? "#1a7a45" : "white", color: eff === id ? "white" : "#374151" }}>{lab}</button>
          ))}
        </div>
        {list.length === 1 && (list[0].id || list[0].bill_id) && (
          <button onClick={() => shareBillAsPdf('.pbill', list[0].bill_no, list[0].phone1)}
            style={{ padding: "10px 20px", background: "#16a34a", border: "none", borderRadius: 8, color: "white", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            📲 WhatsApp
          </button>
        )}
        <span style={{ fontSize: 13, color: "#6b7280" }}>{list.length} bill{list.length > 1 ? "s" : ""}</span>
        {eff === "preprinted" && <span style={{ fontSize: 12, color: "#9ca3af" }}>Adjust margins in Print Center → Bill Template.</span>}
      </div>

      {list.map((b, i) => <PurchaseBillSheet key={i} bill={b} tpl={tpl} mode={eff} />)}
    </div>,
    document.body
  );
}

// One printed purchase-bill sheet. Reused for single, reprint, and bulk print.
// tpl = editable letterhead template; mode = 'full' (A5 letterhead) | 'preprinted' | 'thermal'.
function PurchaseBillSheet({ bill, tpl, mode = "full", dataOnly: dataOnlyProp }) {
  const grossAmt  = bill.items?.reduce((s, i) => s + parseFloat(i.gross_amount || i.total || 0), 0) || 0;
  const commAmt   = parseFloat(bill.comm_amt || 0);
  const coolieAmt = parseFloat(bill.coolie_amt || bill.coolie || 0);
  const sakkuAmt  = parseFloat(bill.sakku_amt || bill.sakku || 0);
  const freightAmt= parseFloat(bill.freight_amt || bill.freight || 0);
  const netPayable= parseFloat(bill.net_payable || 0);
  const deductTotal = commAmt + coolieAmt + sakkuAmt + freightAmt;
  const t = tpl || {};
  const dataOnly = dataOnlyProp ?? (mode === "preprinted");

  if (mode === "thermal") return <PurchaseThermalSheet bill={bill} t={t} grossAmt={grossAmt}
    coolieAmt={coolieAmt} freightAmt={freightAmt} sakkuAmt={sakkuAmt} commAmt={commAmt} deductTotal={deductTotal} netPayable={netPayable} />;
  if (dataOnly) return <PreprintedPurchaseSheet bill={bill} t={t} grossAmt={grossAmt}
    coolieAmt={coolieAmt} freightAmt={freightAmt} sakkuAmt={sakkuAmt} commAmt={commAmt} netPayable={netPayable} />;

  return (
      <div className="pbill full">
        {(
        /* Header */
        <table style={{ marginBottom: 0 }}>
          <tbody>
            <tr>
              <td style={{ border: "2px solid #2d6a2d", textAlign: "center", padding: "8px 12px" }}>
                {t.logo ? <img src={t.logo} alt="" style={{ maxHeight: 54, marginBottom: 4 }} /> : null}
                <div style={{ fontSize: 22, fontWeight: 900, color: "#1a5c1a", fontFamily: "'Noto Sans Tamil', sans-serif" }}>
                  {t.company_ta || "ஸ்ரீ முருகன் அன் கோ.,"}
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#1a5c1a" }}>{t.company_en || "SRI MURUGAN & Co.,"}</div>
                <div style={{ fontSize: 12, fontFamily: "'Noto Sans Tamil', sans-serif", color: "#333" }}>{t.subtitle_ta}</div>
                <div style={{ fontSize: 11, color: "#333" }}>{t.address}</div>
                {t.address_ta && <div style={{ fontSize: 11, color: "#333", fontFamily: "'Noto Sans Tamil', sans-serif" }}>{t.address_ta}</div>}
                <div style={{ fontSize: 13, fontWeight: 700 }}>{t.phone || "Cell : 94433 34663, 73733 99999"}</div>
              </td>
            </tr>
          </tbody>
        </table>
        )}

        {/* Party info */}
        <table style={{ borderTop: "none", marginBottom: 0 }}>
          <tbody>
            <tr>
              <td style={{ border: "1px solid #2d6a2d", width: "60%", padding: "6px 10px" }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  திரு. {bill.farmer_name_ta && <span style={{ fontFamily: "'Noto Sans Tamil', sans-serif", marginRight: 6 }}>{bill.farmer_name_ta}</span>}
                  {bill.farmer_name}
                </div>
                <div style={{ fontSize: 12, marginTop: 2 }}>ஊர் : <strong>{bill.town || "—"}</strong></div>
                {bill.reference && bill.reference !== "DIRECT" && (
                  <div style={{ fontSize: 12, marginTop: 2 }}>வண்டி : <strong>{bill.reference}</strong></div>
                )}
              </td>
              <td style={{ border: "1px solid #2d6a2d", textAlign: "center", padding: "6px 10px", background: "#e8f5e9" }}>
                <div style={{ fontWeight: 700, fontSize: 12 }}>CASH BILL</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>எண் : <strong>{bill.bill_no}</strong></div>
                <div style={{ fontSize: 12, marginTop: 2 }}>
                  தேதி : <strong>{new Date(bill.date).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "2-digit" })}</strong>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Items table */}
        <table style={{ borderTop: "none", marginBottom: 0 }}>
          <thead>
            <tr>
              <th style={{ width: 55, textAlign: "center" }}>ரேட்<br/>Rate</th>
              <th style={{ textAlign: "left" }}>விபரம்<br/>Description</th>
              <th style={{ width: 75, textAlign: "center" }}>எடை<br/>Weight</th>
              <th style={{ width: 65, textAlign: "center" }}>எண்ணம்<br/>Bags</th>
              <th style={{ width: 95, textAlign: "right" }}>பற்று பை.<br/>Debit</th>
              <th style={{ width: 95, textAlign: "right" }}>வரவு பை.<br/>Credit</th>
            </tr>
          </thead>
          <tbody>
            {(bill.items || []).map((item, i) => (
              <tr key={i}>
                <td style={{ textAlign: "center" }}>{parseFloat(item.rate || item.purchase_rate || 0).toFixed(2)}</td>
                <td>
                  <div style={{ fontWeight: 600, fontFamily: "'Noto Sans Tamil', sans-serif" }}>{item.product_name_ta || item.product_name}</div>
                  {/* Show individual bag weights below product name */}
                  {(() => {
                    const wstr = item.weights_detail || (Array.isArray(item.weights) ? item.weights.filter(w => w !== "" && w != null).join(", ") : "");
                    return wstr && <div style={{ fontSize: 10, color: "#666", marginTop: 2, whiteSpace: "normal", wordBreak: "break-all" }}>{wstr}</div>;
                  })()}
                  {parseFloat(item.damage_kg ?? item.damage ?? 0) > 0 && (() => {
                    const dmg = parseFloat(item.damage_kg ?? item.damage);
                    const billed = parseFloat(item.billed_weight || item.net_weight || 0);
                    // Show only the deduction as plain arithmetic — no "damage" wording to the farmer.
                    return (
                      <div style={{ fontSize: 10, color: "#666", marginTop: 1 }}>
                        ({(billed + dmg).toFixed(0)} − {dmg.toFixed(0)})
                      </div>
                    );
                  })()}
                </td>
                <td style={{ textAlign: "center" }}>{parseFloat(item.billed_weight || item.net_weight || 0).toFixed(0)}</td>
                <td style={{ textAlign: "center" }}>{item.no_of_bags || item.bags || ""}</td>
                <td style={{ textAlign: "right" }}></td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>
                  {parseFloat(item.gross_amount || item.total || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
            {/* Empty rows */}
            {Array.from({ length: Math.max(0, 5 - (bill.items?.length || 0)) }).map((_, i) => (
              <tr key={`e${i}`}><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>
            ))}
            {/* Deductions row - shown at bottom left like original */}
            <tr>
              <td colSpan={4} style={{ verticalAlign: "top", padding: "6px 10px", fontSize: 12 }}>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontFamily: "'Noto Sans Tamil', sans-serif" }}>
                  {coolieAmt > 0  && <span>கூலி {coolieAmt.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>}
                  {freightAmt > 0 && <span>வாடகை {freightAmt.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>}
                  {sakkuAmt > 0   && <span>ரொக்கம் {sakkuAmt.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>}
                  {commAmt > 0    && <span>கமிஷன் {commAmt.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>}
                </div>
              </td>
              <td style={{ textAlign: "right", fontWeight: 700 }}>
                {deductTotal > 0 ? deductTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : ""}
              </td>
              <td style={{ textAlign: "right", fontWeight: 700 }}>
                {grossAmt.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </td>
            </tr>
            {/* Net payable */}
            <tr style={{ background: "#f9f9f9" }}>
              <td colSpan={5} style={{ textAlign: "right", fontWeight: 800, fontSize: 15, padding: "8px 10px" }}></td>
              <td style={{ textAlign: "right", fontWeight: 900, fontSize: 16, padding: "8px 10px" }}>
                {netPayable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Footer greetings */}
        {!dataOnly && (
        <table style={{ borderTop: "none" }}>
          <tbody>
            <tr>
              <td style={{ border: "1px solid #2d6a2d", fontFamily: "'Noto Sans Tamil', sans-serif", fontWeight: 700, color: "#1a5c1a", fontSize: 12 }}>
                {t.greeting_left || "வாணிபமே கோயில் !"}
              </td>
              <td style={{ border: "1px solid #2d6a2d", textAlign: "right", fontFamily: "'Noto Sans Tamil', sans-serif", fontWeight: 700, color: "#1a5c1a", fontSize: 12 }}>
                {t.greeting_right || "வாடிக்கையாளரே தெய்வம் !!"}
              </td>
            </tr>
            <tr>
              <td colSpan={2} style={{ border: "1px solid #2d6a2d", textAlign: "center", fontSize: 11, fontFamily: "'Noto Sans Tamil', sans-serif" }}>
                {t.footer || "என்றும் தங்கள் நல்வரவை விரும்பும் (S.M. & CO.,)"}
              </td>
            </tr>
          </tbody>
        </table>
        )}
      </div>
  );
}

// Compact 80mm thermal receipt for a farmer purchase bill. Tamil renders fine via the browser.
function PurchaseThermalSheet({ bill, t, grossAmt, coolieAmt, freightAmt, sakkuAmt, commAmt, deductTotal, netPayable }) {
  const money = (n) => parseFloat(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 });
  const Row = ({ l, r, bold, big }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: bold ? 700 : 400, fontSize: big ? 15 : 12 }}>
      <span>{l}</span><span style={{ whiteSpace: "nowrap" }}>{r}</span>
    </div>
  );
  const hr = { borderTop: "1px dashed #000", margin: "5px 0" };
  return (
    <div className="pbill thermal">
      <div style={{ textAlign: "center" }}>
        {t.logo ? <img src={t.logo} alt="" style={{ maxHeight: 40, marginBottom: 2 }} /> : null}
        <div style={{ fontWeight: 800, fontSize: 15 }}>{t.company_ta || "ஸ்ரீ முருகன் அன் கோ.,"}</div>
        <div style={{ fontWeight: 700, fontSize: 12 }}>{t.company_en || "SRI MURUGAN & Co.,"}</div>
        {t.subtitle_ta && <div style={{ fontSize: 10 }}>{t.subtitle_ta}</div>}
        <div style={{ fontSize: 10 }}>{t.address}</div>
        <div style={{ fontSize: 11, fontWeight: 600 }}>{t.phone || "Cell : 94433 34663, 73733 99999"}</div>
      </div>
      <div style={hr} />
      <div style={{ fontWeight: 700 }}>ரொக்கப் பற்று / CASH BILL</div>
      <Row l={`எண்: ${bill.bill_no}`} r={`தேதி: ${bill.date ? new Date(bill.date).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "2-digit" }) : ""}`} />
      <div style={{ fontWeight: 700, marginTop: 3 }}>திரு. {bill.farmer_name_ta ? `${bill.farmer_name_ta} ` : ""}{bill.farmer_name}</div>
      <div style={{ fontSize: 11 }}>ஊர்: {bill.town || "—"}{bill.reference && bill.reference !== "DIRECT" ? `   வண்டி: ${bill.reference}` : ""}</div>
      <div style={hr} />
      {(bill.items || []).map((item, i) => {
        const wt = parseFloat(item.billed_weight || item.net_weight || 0).toFixed(0);
        const rate = parseFloat(item.rate || item.purchase_rate || 0).toFixed(2);
        const bags = item.no_of_bags || item.bags || "";
        return (
          <div key={i} style={{ marginBottom: 3 }}>
            <div style={{ fontWeight: 600, fontFamily: "'Noto Sans Tamil', sans-serif" }}>{item.product_name_ta || item.product_name}</div>
            <Row l={`${rate} × ${wt}kg${bags ? ` (${bags} மூ)` : ""}`} r={money(item.gross_amount || item.total)} />
          </div>
        );
      })}
      <div style={hr} />
      <Row l="மொத்தம் / Gross" r={money(grossAmt)} />
      {coolieAmt > 0  && <Row l="கூலி" r={money(coolieAmt)} />}
      {freightAmt > 0 && <Row l="வாடகை" r={money(freightAmt)} />}
      {sakkuAmt > 0   && <Row l="ரொக்கம்" r={money(sakkuAmt)} />}
      {commAmt > 0    && <Row l="கமிஷன்" r={money(commAmt)} />}
      {deductTotal > 0 && <Row l="கழிவு மொத்தம்" r={money(deductTotal)} />}
      <div style={hr} />
      <Row l="நிகர தொகை / NET" r={money(netPayable)} bold big />
      <div style={hr} />
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: 11 }}>{t.greeting_left || "வாணிபமே கோயில் !"} {t.greeting_right || "வாடிக்கையாளரே தெய்வம் !!"}</div>
      {t.footer && <div style={{ textAlign: "center", fontSize: 10, marginTop: 2 }}>{t.footer}</div>}
    </div>
  );
}

// Values-only overlay for pre-printed A5 purchase stationery (logo/headers/labels are on the paper).
// Pre-printed 6"x6" purchase bill (152.4mm square). Values only — the letterhead,
// column rules and the cooli/vadakai/rokkam/commission labels are pre-printed on the paper.
// Everything is absolutely positioned so the expense block always lands on the pre-printed
// labels regardless of how many item rows there are. Nudge the whole overlay with
// pre_pur_top_mm / pre_pur_left_mm, and the expense-row pitch with pre_pur_row_mm.
function PreprintedPurchaseSheet({ bill, t, grossAmt, coolieAmt, freightAmt, sakkuAmt, commAmt, netPayable }) {
  const cfg = getPreprint(t, "sixbysix");
  const num = v => (parseFloat(v) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 });
  const dateStr = bill.date ? new Date(bill.date).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "";
  const descOf = (it) => {
    const rawW = it.weights_detail || (Array.isArray(it.weights) ? it.weights.filter(w => w !== "" && w != null).join(",") : "");
    const dmg = parseFloat(it.damage_kg ?? it.damage ?? 0) || 0;
    const billedW = parseFloat(it.billed_weight || it.net_weight || 0);
    const dmgStr = dmg > 0 ? ` (${(billedW + dmg).toFixed(0)}−${dmg.toFixed(0)})` : "";
    const bags = parseInt(it.no_of_bags || it.bags) || 0;
    const wFontPt = 7.5;
    // Chunk weights into rows of 15 — each row is nowrap and bleeds horizontally.
    const wArr = rawW ? rawW.split(",").filter(Boolean) : [];
    const wLines = [];
    for (let i = 0; i < wArr.length; i += 15) wLines.push(wArr.slice(i, i + 15).join(","));
    return (
      <div>
        <div style={{ whiteSpace: "nowrap", overflow: "hidden", fontFamily: "'Noto Sans Tamil', sans-serif" }}>{it.product_name_ta || it.product_name}</div>
        {wLines.map((line, idx) => (
          <div key={idx} style={{ fontSize: `${wFontPt}pt`, whiteSpace: "nowrap", lineHeight: 1.05 }}>
            {line}{idx === wLines.length - 1 ? dmgStr : ""}
          </div>
        ))}
      </div>
    );
  };
  const colVal = {
    rate:   it => parseFloat(it.rate || it.purchase_rate || 0).toFixed(2),
    desc:   descOf,
    weight: it => parseFloat(it.billed_weight || it.net_weight || 0).toFixed(0),
    bags:   it => it.no_of_bags || it.bags || "",
    credit: it => num(it.gross_amount || it.total || 0),
  };
  const fieldVal = {
    farmer_name:  () => (
      <>
        {bill.farmer_name_ta && <div style={{ fontFamily: "'Noto Sans Tamil', sans-serif" }}>{bill.farmer_name_ta}</div>}
        {bill.farmer_name && <div>{bill.farmer_name}</div>}
      </>
    ),
    town:         () => bill.town || "",
    bill_no:      () => bill.bill_no || "",
    bill_date:    () => dateStr,
    exp_cooli:    () => coolieAmt > 0 ? num(coolieAmt) : "",
    exp_freight:  () => freightAmt > 0 ? num(freightAmt) : "",
    exp_sakku:    () => sakkuAmt > 0 ? num(sakkuAmt) : "",
    exp_comm:     () => commAmt > 0 ? num(commAmt) : "",
    debit_total:  () => num(coolieAmt + freightAmt + sakkuAmt + commAmt),
    credit_gross: () => num(grossAmt),
    net:          () => num(netPayable),
  };
  // Paginate so item rows never reach the deductions/totals: at most cfg.rows items per
  // sheet; extras continue on a second pre-printed sheet, totals only on the last.
  const allItems = bill.items || [];
  const perPage = Math.max(1, cfg.rows || 5);
  const pageCount = Math.max(1, Math.ceil(allItems.length / perPage));
  return Array.from({ length: pageCount }, (_, pi) => {
    const last = pi === pageCount - 1;
    return <PreprintRender key={pi} cfg={cfg} className="pbill" items={allItems.slice(pi * perPage, (pi + 1) * perPage)}
      colVal={colVal} fieldVal={fieldVal} showFields={last}
      footerNote={last ? undefined : `Sheet ${pi + 1} of ${pageCount} — continued →`} />;
  });
}
