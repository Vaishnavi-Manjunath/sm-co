// ============================================================
//  QUICK SALES BILL - Simplified billing
//  Mode 1: Bill by Product (1 product → many vendors)
//  Mode 2: Bill by Vendor (1 vendor → many products)
// ============================================================
import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { createPortal } from "react-dom";
import { api, apiCached, fmt, useNavGuard, SearchableSelect, getPrintTemplate, PendingQueue, getWorkingDate, getBusinessRules, DEFAULT_RULES, getPreprint, PreprintRender, shareBillAsPdf } from "../App.jsx";
import BillsViewer from "./BillsViewer.jsx";

// Inline literal (NOT ...DEFAULT_RULES) — App.jsx imports this file before it declares
// DEFAULT_RULES, so reading that imported const at module-eval time hits the TDZ. Refreshed
// from the server (which merges App.jsx's defaults) on page mount.
let RULES = { commission_pct: 10, credit_days: 14, freight_per_kg: 0.5, coolie_bag_zero: 5, coolie_bag_small: 3, coolie_bag_large: 5, coolie_small_max: 30 };

export default function QuickSalesPage() {
  const [mode, setMode]       = useState("vendor"); // vendor | product | pending
  const [date, setDate]       = useState(getWorkingDate());
  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const [rates, setRates]     = useState({});
  const [bills, setBills]     = useState([]);
  const [printBills, setPrintBills] = useState(null);  // array of print-shaped bills
  const [view, setView]       = useState("form");
  const [returnToList, setReturnToList] = useState(false);   // came into the form by editing a bill from the list
  const [allocations, setAllocations] = useState([]);  // unbilled yard allocations
  const [staged, setStaged]   = useState([]);          // unbilled Bill-by-Product staged items
  const [prefill, setPrefill] = useState(null);        // pre-filled vendor bill (yard/staged/edit)
  const [selectedIds, setSelectedIds] = useState([]);  // bill ids selected for bulk print

  // Keep the bill date in sync if the working date is changed in the Day bar
  useEffect(() => {
    const h = (e) => setDate(e.detail);
    window.addEventListener("rsm-working-date", h);
    return () => window.removeEventListener("rsm-working-date", h);
  }, []);

  useEffect(() => {
    Promise.all([
      // Sales-side parties (buyers) — Customer, Overflow, Market Vendor, Order Supplier
      apiCached("parties?action=list&category=CUSTOMER&cols=lite"),
      apiCached("parties?action=list&category=OVERFLOW&cols=lite"),
      apiCached("parties?action=list&category=MARKET_VENDOR&cols=lite"),
      apiCached("parties?action=list&category=ORDER_SUPPLIER&cols=lite"),
      api(`products?action=rates&date=${date}`),
    ]).then(([cust, over, mkt, ord, r]) => {
      const seen = new Set();
      setVendors([...cust.data, ...over.data, ...mkt.data, ...ord.data].filter(v => !seen.has(v.id) && seen.add(v.id)));
      setProducts(r.data);
      const rm = {};
      r.data.forEach(p => { if (p.market_rate) rm[p.product_id || p.id] = p.market_rate; });
      setRates(rm);
    });
    loadBills();
    loadPending();
    getBusinessRules().then(r => { RULES = r; });
  }, [date]);

  const loadBills = () => {
    api(`sales?action=list&from=${date}&to=${date}`)
      .then(r => setBills(r.data || []))
      .catch(() => {});
  };

  // Pending = unbilled yard allocations + unbilled Bill-by-Product staged items
  const loadPending = () => {
    api("yard?action=allocations&billed=0").then(r => setAllocations(r.data || [])).catch(() => {});
    api("sales?action=staged&billed=0").then(r => setStaged(r.data || [])).catch(() => {});
  };

  // Group everything pending by vendor → one staged bill per vendor
  const pendingByVendor = (() => {
    const acc = {};
    const add = (vid, vname, row) => {
      if (!vid) return;
      (acc[vid] = acc[vid] || { vendor_id: vid, vendor_name: vname, rows: [] }).rows.push(row);
    };
    allocations.forEach(a => add(a.vendor_id, a.vendor_name, { ...a, _src: "yard" }));
    staged.forEach(s => add(s.vendor_id, s.vendor_name, { ...s, _src: "staged" }));
    return acc;
  })();
  const sortedPending = Object.values(pendingByVendor).sort((a, b) => (a.vendor_name || "").localeCompare(b.vendor_name || ""));
  const [pendingCurId, setPendingCurId] = useState(null);   // vendor being billed in the Pending tab

  // Build a VendorBillForm prefill from a vendor's pending rows (yard + staged)
  const stageVendor = (group) => {
    const v = vendors.find(x => x.id == group.vendor_id);
    setPrefill({
      vendor_id: group.vendor_id,
      vendor_name: group.vendor_name || v?.name_en || "",
      vendor_name_ta: v?.name_ta || "",
      place: v?.city || v?.area || "",
      items: group.rows.map(a => ({
        product_id: a.product_id || "",
        product_name: a.product_name || "",
        bags: a.no_of_bags || "",
        weight: a.weight || "",
        rate: a._src === "staged" ? (a.rate || "") : (rates[a.product_id] || ""),
        is_charge: false,
        allocation_ids: a._src === "yard"   ? [a.id] : [],
        staged_ids:     a._src === "staged" ? [a.id] : [],
      })),
    });
    setView("form");
  };

  // Delete one pending item (staged from Bill-by-Product, or a yard allocation), then
  // re-stage the current vendor from fresh data (or clear if nothing's left).
  const deletePending = async (row) => {
    if (!window.confirm(`Remove pending "${row.product_name || "item"}" (${row.no_of_bags || 0} bags) for this vendor?\n\nThis deletes the ${row._src === "yard" ? "yard allocation" : "staged item"} so it won't be billed. It cannot be undone.`)) return;
    try {
      if (row._src === "staged") await api("sales?action=delete-staged", { method: "POST", body: JSON.stringify({ id: row.id }) });
      else await api("yard?action=delete-allocation", { method: "POST", body: JSON.stringify({ id: row.id }) });
      const [al, st] = await Promise.all([
        api("yard?action=allocations&billed=0"), api("sales?action=staged&billed=0"),
      ]);
      setAllocations(al.data || []); setStaged(st.data || []);
      const fresh = [
        ...(al.data || []).filter(a => String(a.vendor_id) === String(pendingCurId)).map(a => ({ ...a, _src: "yard" })),
        ...(st.data || []).filter(s => String(s.vendor_id) === String(pendingCurId)).map(s => ({ ...s, _src: "staged" })),
      ];
      if (fresh.length) {
        const v = vendors.find(x => x.id == pendingCurId);
        stageVendor({ vendor_id: pendingCurId, vendor_name: v?.name_en || "", rows: fresh });
      } else { setPendingCurId(null); setPrefill(null); }
    } catch (e) { alert("Error: " + e.message); }
  };

  // On entering the Pending tab: re-load the current vendor (form may have remounted), else the first one.
  const loadFirstPending = () => {
    const g = (pendingCurId && sortedPending.find(x => String(x.vendor_id) === String(pendingCurId))) || sortedPending[0];
    if (g) { setPendingCurId(g.vendor_id); stageVendor(g); }
  };

  // Edit a saved sales bill → load into the vendor form (keeps same bill number on save)
  const handleEdit = async (b) => {
    try {
      const r = await api(`sales?action=get&id=${b.id}`);
      setPrefill(toFormBill(r.data));
      setMode("vendor");
      setReturnToList(true);   // after this edit (save/cancel) go back to the list, not the new-bill form
      setView("form");
    } catch (e) { alert("Error loading bill: " + e.message); }
  };

  const handleReprint = async (b) => {
    try {
      const r = await api(`sales?action=get&id=${b.id}`);
      setPrintBills([toPrintBill(r.data)]);
    } catch (e) { alert("Error: " + e.message); }
  };

  // Delete (cancel) a saved sales bill — warns first, reverses the ledger, audit-logged
  const handleDelete = async (b) => {
    if (!window.confirm(
      `⚠️ Delete bill ${b.bill_no}?\n\nVendor: ${b.party_name}\nNet amount: ${fmt.currency(b.net_amount)}\n\n` +
      `This removes the bill from reports and reverses its entries (the vendor's receivable). ` +
      `Any pending items on it return to the queue. It cannot be undone.`
    )) return;
    try {
      await api("sales?action=cancel", { method: "POST", body: JSON.stringify({ id: b.id, reason: "Deleted from Today's Bills" }) });
      loadBills();
      loadPending();
    } catch (e) { alert("Error deleting bill: " + e.message); }
  };

  const handlePrintSelected = async () => {
    if (selectedIds.length === 0) return;
    try {
      const results = await Promise.all(selectedIds.map(id => api(`sales?action=get&id=${id}`)));
      setPrintBills(results.map(r => toPrintBill(r.data)));
    } catch (e) { alert("Error: " + e.message); }
  };

  const toggleSelect = (id) => setSelectedIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  // Fetch bills by id and open the print view (used by the View Bills screen)
  const printByIds = async (ids) => {
    if (!ids?.length) return;
    try {
      const results = await Promise.all(ids.map(id => api(`sales?action=get&id=${id}`)));
      setPrintBills(results.map(r => toPrintBill(r.data)));
    } catch (e) { alert("Error: " + e.message); }
  };
  const [viewReload, setViewReload] = useState(0);

  if (printBills) return <PrintSalesBills bills={printBills} onClose={() => { setPrintBills(null); loadBills(); setViewReload(n => n + 1); if (returnToList) { setReturnToList(false); setView("list"); } }} />;

  return (
    <div className="bill-page" style={{ padding: 20, fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
          🧾 Sales Bills <span style={{ fontSize: 13, color: "#666" }}>விற்பனை பில்</span>
        </h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13 }} />
          <button onClick={() => { if (view === "form") { setView("list"); } else { setReturnToList(false); setView("form"); } }}
            style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #d1d5db", background: "white", cursor: "pointer", fontSize: 13 }}>
            {view === "form" ? "📋 Today's Bills" : "➕ New Bill"}
          </button>
        </div>
      </div>

      {view === "list" ? (
        <BillsViewer kind="sales" onEdit={handleEdit} onPrintIds={printByIds} reloadSignal={viewReload} />
      ) : (
        <>
          {/* Mode selector */}
          <div style={{ display: "flex", gap: 0, marginBottom: 16, background: "white", borderRadius: 10,
                        boxShadow: "0 1px 4px rgba(0,0,0,0.08)", overflow: "hidden", width: "fit-content" }}>
            {[
              { id: "vendor",  label: "Bill by Vendor",  sub: "1 vendor → many products", icon: "👤" },
              { id: "product", label: "Bill by Product", sub: "1 product → many vendors",  icon: "🥬" },
              { id: "pending", label: "Pending Bills",   sub: `${sortedPending.length} waiting · yard + product`, icon: "📋" },
            ].map(m => (
              <button key={m.id} onClick={() => { setMode(m.id); if (m.id === "pending") loadFirstPending(); }} style={{
                padding: "12px 28px", border: "none", cursor: "pointer", textAlign: "left",
                background: mode === m.id ? "#1a7a45" : "white",
                color: mode === m.id ? "white" : "#374151",
                borderRight: "1px solid #e5e7eb",
              }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{m.icon} {m.label}{m.id === "pending" && sortedPending.length > 0 && mode !== "pending" &&
                  <span style={{ marginLeft: 6, background: "#dc2626", color: "white", borderRadius: 10, padding: "1px 7px", fontSize: 11 }}>{sortedPending.length}</span>}</div>
                <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{m.sub}</div>
              </button>
            ))}
          </div>

          {mode === "vendor" ? (
            <VendorBillForm date={date} vendors={vendors} products={products} rates={rates}
              prefill={prefill} onConsumePrefill={() => setPrefill(null)}
              onCancelEdit={() => { if (returnToList) { setReturnToList(false); setView("list"); } }}
              onSaved={(bill) => { if (bill) setPrintBills([bill]); loadBills(); loadPending(); if (!bill && returnToList) { setReturnToList(false); setView("list"); } }} />
          ) : mode === "product" ? (
            <ProductBillForm date={date} vendors={vendors} products={products} rates={rates}
              onSaved={() => { loadPending(); }} />
          ) : (
            /* Pending Bills — searchable keyboard queue + auto-advance to the next vendor on save */
            <div className="m-stack" style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, alignItems: "start" }}>
              <div className="m-static" style={{ background: "white", borderRadius: 12, padding: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", position: "sticky", top: 16, height: "calc(100vh - 200px)", display: "flex", flexDirection: "column" }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>📋 Pending vendors ({sortedPending.length})</div>
                <PendingQueue
                  items={sortedPending.map(g => ({ id: g.vendor_id, label: g.vendor_name,
                    sub: `${g.rows.length} item${g.rows.length > 1 ? "s" : ""} · ${g.rows.reduce((s, r) => s + (parseInt(r.no_of_bags) || 0), 0)} bags` }))}
                  currentId={pendingCurId}
                  placeholder="🔍 Search vendor… (↑↓ Enter)"
                  emptyText="No pending vendors 🎉"
                  onPick={(vid) => { const g = sortedPending.find(x => String(x.vendor_id) === String(vid)); if (g) { setPendingCurId(g.vendor_id); stageVendor(g); } }} />
              </div>
              {pendingCurId ? (
                <div>
                  {(() => {
                    const g = sortedPending.find(x => String(x.vendor_id) === String(pendingCurId));
                    if (!g) return null;
                    return (
                      <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 7 }}>📋 Pending items for {g.vendor_name} — 🗑️ to remove any added by mistake</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {g.rows.map((row, i) => (
                            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "white", border: "1px solid #fde68a", borderRadius: 8, padding: "4px 9px", fontSize: 12 }}>
                              {row._src === "yard" ? "📦" : "🥬"} <b>{row.product_name || "—"}</b> · {row.no_of_bags || 0}b · {row.weight || 0}kg
                              <button onClick={() => deletePending(row)} title="Delete this pending item"
                                style={{ border: "none", background: "#fee2e2", color: "#dc2626", borderRadius: 5, cursor: "pointer", fontSize: 11, padding: "1px 7px", fontWeight: 700 }}>🗑️</button>
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                <VendorBillForm date={date} vendors={vendors} products={products} rates={rates}
                  prefill={prefill} onConsumePrefill={() => setPrefill(null)}
                  onSaved={(bill) => {
                    if (bill) setPrintBills([bill]);
                    // advance to the next pending vendor (compute from the current list before it refreshes)
                    const after = sortedPending.slice(sortedPending.findIndex(g => String(g.vendor_id) === String(pendingCurId)) + 1)
                      .find(g => String(g.vendor_id) !== String(pendingCurId));
                    const next = after || sortedPending.find(g => String(g.vendor_id) !== String(pendingCurId)) || null;
                    loadBills(); loadPending();
                    if (next) { setPendingCurId(next.vendor_id); stageVendor(next); }
                    else { setPendingCurId(null); setPrefill(null); }
                  }} />
                </div>
              ) : (
                <div style={{ background: "white", borderRadius: 12, padding: 40, textAlign: "center", color: "#888", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
                  {sortedPending.length ? "Pick a vendor from the list (or press Enter) to start billing." : "🎉 No pending items to bill."}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================
// MODE 2 — BILL BY VENDOR
// ============================================================
function VendorBillForm({ date, vendors, products, rates, prefill, onConsumePrefill, onSaved, onCancelEdit }) {
  const [bill, setBill] = useState(newBill());
  const [editingId, setEditingId] = useState(null);   // sales bill id being edited (null = new)
  const [saving, setSaving] = useState(false);
  const [openingBal, setOpeningBal] = useState(0);
  const [dupWarn, setDupWarn] = useState([]);          // products entered via BOTH yard + Bill-by-Product
  const vendorRef = useRef();
  const origCreditedRef = useRef(0);  // credited_amt loaded when editing; used to calc delta on save

  function newBill() {
    return { vendor_id: "", vendor_name: "", vendor_name_ta: "", place: "", credited: "", items: [newItem()] };
  }
  function newItem() {
    return { product_id: "", product_name: "", bags: "", weight: "", rate: "", amount: 0, is_charge: false };
  }

  // Load a prefill (yard/staged pending, or a saved bill for editing), then fetch opening balance
  useEffect(() => {
    if (!prefill) return;
    setBill({
      vendor_id: prefill.vendor_id,
      vendor_name: prefill.vendor_name || "",
      vendor_name_ta: prefill.vendor_name_ta || "",
      place: prefill.place || "",
      items: (prefill.items || []).map(i => {
        const unit = i.unit || products.find(x => (x.product_id || x.id) == i.product_id)?.unit_type || "KG";
        const qty  = unit === "BAG" ? (parseInt(i.bags) || 0) : (parseFloat(i.weight) || 0);
        return { ...newItem(), ...i, unit,
          amount: parseFloat((qty * (parseFloat(i.rate) || 0)).toFixed(2)) };
      }),
    });
    setEditingId(prefill.editingId || null);
    origCreditedRef.current = parseFloat(prefill.credited) || 0;
    setDupWarn([]);
    if (prefill.vendor_id) {
      const pv = vendors?.find(x => x.id == prefill.vendor_id);
      const excludeId = prefill.id || prefill.editingId || "";
      api(`parties?action=outstanding&party_id=${prefill.vendor_id}${excludeId ? `&exclude_bill_id=${excludeId}` : ""}`)
        .then(r => {
          const dbOut = r.totals?.total_outstanding || 0;
          const partyOb = pv?.opening_bal_type === 'dr' ? parseFloat(pv?.opening_balance || 0) : 0;
          setOpeningBal(dbOut > 0 ? dbOut : partyOb);
        })
        .catch(() => setOpeningBal(0));
    }
    onConsumePrefill && onConsumePrefill();
  }, [prefill]);

  // Selecting a vendor: load opening balance + auto-load all pending items (staged + yard)
  const handleVendorChange = async (id) => {
    const v = vendors.find(x => x.id == id);
    setBill(p => ({ ...p, vendor_id: id, vendor_name: v?.name_en || "", vendor_name_ta: v?.name_ta || "", place: v?.city || v?.area || "" }));
    setEditingId(null);
    setDupWarn([]);
    if (!id) { setOpeningBal(0); return; }
    try {
      const [out, st, al, bl] = await Promise.all([
        api(`parties?action=outstanding&party_id=${id}`),
        api(`sales?action=staged&billed=0&vendor_id=${id}`),
        api(`yard?action=allocations&billed=0&vendor_id=${id}`),
        api(`sales?action=list&from=${date}&to=${date}&party_id=${id}`),
      ]);
      const dbOutstanding = out.totals?.total_outstanding || 0;
      const partyOpeningBal = (v?.opening_bal_type === 'dr' ? parseFloat(v?.opening_balance || 0) : 0);
      setOpeningBal(dbOutstanding > 0 ? dbOutstanding : partyOpeningBal);
      const unitOf = (pid) => products.find(x => (x.product_id || x.id) == pid)?.unit_type || "KG";
      const amtFor = (unit, bags, weight, rate) => parseFloat(((unit === "BAG" ? (parseInt(bags) || 0) : (parseFloat(weight) || 0)) * (parseFloat(rate) || 0)).toFixed(2));
      const stagedItems = (st.data || []).map(s => {
        const unit = unitOf(s.product_id);
        return { ...newItem(),
          product_id: s.product_id ? String(s.product_id) : "", product_name: s.product_name || "", unit,
          bags: s.no_of_bags || "", weight: s.weight || "", rate: s.rate || "",
          amount: amtFor(unit, s.no_of_bags, s.weight, s.rate), staged_ids: [s.id] };
      });
      const yardItems = (al.data || []).map(a => {
        const unit = unitOf(a.product_id);
        return { ...newItem(),
          product_id: a.product_id ? String(a.product_id) : "", product_name: a.product_name || "", unit,
          bags: a.no_of_bags || "", weight: a.weight || "", rate: rates[a.product_id] || "",
          amount: amtFor(unit, a.no_of_bags, a.weight, rates[a.product_id]), allocation_ids: [a.id] };
      });
      const loaded = [...stagedItems, ...yardItems];
      // Flag products that arrived through BOTH channels (yard allocation + Bill-by-Product
      // staging) for this vendor — that's a double entry the staff should reconcile before billing.
      const stagedPids = new Set(stagedItems.map(i => String(i.product_id)).filter(Boolean));
      const overlap = [...new Set(
        yardItems.filter(y => y.product_id && stagedPids.has(String(y.product_id)))
                 .map(y => y.product_name || "this product")
      )];
      setDupWarn(overlap);

      // One bill per vendor per day: if this vendor already has a bill today, amend that
      // bill (append the new pending items) instead of opening a second one.
      const todays = bl.data || [];
      if (todays.length > 0) {
        const eb = todays[0];   // list is newest-first
        const total = Number(eb.net_amount || 0).toLocaleString("en-IN");
        const ok = window.confirm(
          `${v?.name_en || "This vendor"} already has bill #${eb.bill_no} today (₹${total}).\n\n` +
          `Add to / edit that bill instead of creating a new one?`
        );
        if (ok) {
          const full = await api(`sales?action=get&id=${eb.id}`);
          const g = full.data || {};
          const existRows = (g.items || []).map(it => {
            const charge = !it.product_id;
            const unit = charge ? "KG" : unitOf(it.product_id);
            return { ...newItem(),
              product_id: charge ? "" : String(it.product_id),
              product_name: it.product_name || "", unit,
              bags:   !charge && it.no_of_bags    ? String(it.no_of_bags)    : "",
              weight: !charge && it.vendor_weight ? String(it.vendor_weight) : "",
              rate:   charge ? String(it.net_amount || it.gross_amount || 0)
                             : (it.sale_rate ? String(it.sale_rate) : ""),
              amount: parseFloat(it.net_amount || 0),
              is_charge: charge,
            };
          });
          setEditingId(eb.id);
          setBill(p => ({ ...p,
            vendor_id: id,
            vendor_name: g.party_name || v?.name_en || "",
            vendor_name_ta: g.party_name_ta || v?.name_ta || "",
            place: g.town || g.address || v?.city || v?.area || "",
            items: [...existRows, ...loaded, newItem()],
          }));
          return;
        }
        // Declined → fall through to a fresh bill with just the pending items.
      }
      setBill(p => ({ ...p, items: loaded.length ? [...loaded, newItem()] : [newItem()] }));
    } catch { setOpeningBal(0); }
  };

  const calcAmount = (item) => {
    const w = parseFloat(item.weight) || 0;
    const r = parseFloat(item.rate) || 0;
    const b = parseInt(item.bags) || 0;
    // For charges (sakku/cooly/freight): bags×rate or weight×rate
    if (item.is_charge) return parseFloat((b > 0 ? b * r : w > 0 ? w * r : r).toFixed(2));
    // BAG-unit products (e.g. Brinjal) bill by bag count; others by weight
    const qty = item.unit === "BAG" ? b : w;
    return parseFloat((qty * r).toFixed(2));
  };

  const updateItem = (idx, field, value) => {
    setBill(prev => {
      const items = [...prev.items];
      let item = { ...items[idx], [field]: value };
      if (field === "product_id") {
        const p = products.find(x => (x.product_id || x.id) == value);
        item.product_name = p?.name_en || "";
        item.unit = p?.unit_type || "KG";     // BAG-billed products charge bags × rate
        item.rate = rates[value] || "";
        item.is_charge = false;
      }
      item.amount = calcAmount(item);
      items[idx] = item;
      return { ...prev, items };
    });
  };

  const addItem    = () => setBill(p => ({ ...p, items: [...p.items, newItem()] }));
  const addCharge  = (name) => setBill(p => ({ ...p, items: [...p.items, { ...newItem(), product_name: name, is_charge: true }] }));
  const removeItem = (idx) => setBill(p => ({ ...p, items: p.items.filter((_, i) => i !== idx) }));

  const billTotal = bill.items.reduce((s, i) => s + (i.amount || 0), 0);
  const netAmount = billTotal + openingBal;

  const isDirty = () => {
    if (saving) return false;
    if (bill.vendor_id) return true;
    return bill.items.some(i => i.product_id || i.product_name || i.weight || i.bags || i.rate);
  };

  const handleSave = async (andPrint = false) => {
    if (!bill.vendor_id) { alert("Select vendor"); return false; }
    // Ignore blank trailing rows (e.g. the empty item left after a double-Enter)
    const filledItems = bill.items.filter(i => i.product_name || i.product_id || i.weight || i.bags || i.rate || i.is_charge);
    if (filledItems.length === 0) { alert("Add at least one item"); return false; }
    if (filledItems.some(i => !i.product_name || (!i.weight && !i.bags) || !i.rate)) {
      alert("Fill item name, weight/bags and rate for all rows"); return false;
    }
    setSaving(true);
    try {
      const credited = parseFloat(bill.credited) || 0;
      const payload = {
        bill_date: date,
        party_id: bill.vendor_id,
        credit_days: RULES.credit_days,
        discount_pct: 0,
        credited,
        items: filledItems.map(i => ({
          product_id:      i.product_id || null,
          product_name:    i.product_name,
          no_of_bags:      parseInt(i.bags) || 0,
          vendor_weight:   parseFloat(i.weight) || 0,
          purchase_weight: parseFloat(i.weight) || 0,
          unit_type:       i.unit || "KG",
          purchase_rate:   parseFloat(i.rate) || 0,
          sale_rate:       parseFloat(i.rate) || 0,
          gross_amount:    i.amount,
          discount_pct:    0,
          discount_amt:    0,
          net_amount:      i.amount,
          margin_amount:   0,
          is_charge:       i.is_charge ? 1 : 0,
        })),
      };
      if (editingId) payload.id = editingId;
      const result = await api(`sales?action=${editingId ? "update" : "save"}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      // Mark consumed yard allocations + staged items as billed
      const allocIds  = filledItems.flatMap(i => i.allocation_ids || []);
      // Send the final billed values per staged id so the staged snapshot is corrected to
      // match the bill (a row's bags/weight/rate may be edited before saving).
      const stagedItems = filledItems
        .filter(i => (i.staged_ids || []).length)
        .flatMap(i => i.staged_ids.map(id => ({
          id, no_of_bags: parseInt(i.bags) || 0,
          weight: parseFloat(i.weight) || 0, rate: parseFloat(i.rate) || 0,
        })));
      if (allocIds.length > 0) {
        await api("yard?action=mark-allocation-billed", {
          method: "POST", body: JSON.stringify({ ids: allocIds, sales_bill_id: result.data.id }),
        }).catch(() => {});
      }
      if (stagedItems.length > 0) {
        await api("sales?action=mark-staged-billed", {
          method: "POST", body: JSON.stringify({ items: stagedItems, sales_bill_id: result.data.id }),
        }).catch(() => {});
      }

      // Record a receipt for any net-new credited amount (new bill = full amount; edit = increase only).
      const creditedDelta = credited - (editingId ? origCreditedRef.current : 0);
      if (creditedDelta > 0) {
        await api("sales?action=payment", {
          method: "POST", body: JSON.stringify({ party_id: bill.vendor_id, amount: creditedDelta, receipt_date: date }),
        }).catch(() => {});
      }

      if (andPrint) {
        onSaved({
          ...bill, bill_no: result.data.bill_no, bill_id: result.data.id,
          bill_total: billTotal, opening_balance: openingBal, net_amount: netAmount,
          credited_amt: credited, date, items: filledItems,
        });
      } else {
        onSaved(null);
      }
      setBill(newBill());
      setEditingId(null);
      setOpeningBal(0);
      return true;
    } catch (e) { alert("Error: " + e.message); return false; }
    finally { setSaving(false); }
  };

  // Prompt to Save / Discard before leaving with an in-progress bill
  useNavGuard({ isDirty, save: () => handleSave(false) });

  return (
    <div className="m-stack has-savebar" style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16 }}>
      <div>
        {/* Vendor */}
        <div style={{ background: "white", borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={lbl}>Vendor / Customer <span style={{ color: "#dc2626" }}>*</span></label>
              <SearchableSelect className="vendor-sel" style={inp} placeholder="Type to search vendor..."
                value={bill.vendor_id}
                options={vendors.map(v => ({ id: v.id, label: v.name_en }))}
                onChange={(id) => handleVendorChange(id)}
                onAdvance={() => document.querySelector(".prod-sel")?.focus()} />
            </div>
            <div>
              <label style={lbl}>Place / ஊர் (auto-filled)</label>
              <input id="place-inp" value={bill.place}
                onChange={e => setBill(p => ({ ...p, place: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); document.querySelector(".prod-sel")?.focus(); }}}
                placeholder="Town / City" style={inp} />
            </div>
          </div>
          {openingBal > 0 && (
            <div style={{ marginTop: 10, background: "#fef9c3", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
              ⚠️ Previous Outstanding: <strong style={{ color: "#dc2626" }}>{fmt.currency(openingBal)}</strong>
            </div>
          )}
        </div>

        {/* Double-entry warning: same product pulled from both yard + Bill-by-Product */}
        {dupWarn.length > 0 && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#b91c1c", marginBottom: 4 }}>
              ⚠️ Possible double entry — check before saving
            </div>
            <div style={{ fontSize: 12, color: "#7f1d1d" }}>
              {dupWarn.join(", ")} {dupWarn.length > 1 ? "were" : "was"} entered both in the Yard and in Bill-by-Product for this vendor,
              so {dupWarn.length > 1 ? "they appear" : "it appears"} as two rows below. Remove the duplicate row (✕) before saving.
            </div>
          </div>
        )}

        {/* Items */}
        <div style={{ background: "white", borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
          {/* Column headers */}
          <div className="bill-itemhead" style={{ display: "grid", gridTemplateColumns: "40px 1fr 70px 90px 90px 100px 32px", gap: 6, marginBottom: 8 }}>
            {["S.No", "விபரம் / Item", "எண்ணம் Bags", "எடை KG", "ரேட் Rate", "தொகை Amount", ""].map(h => (
              <span key={h} style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</span>
            ))}
          </div>

          {bill.items.map((item, idx) => (
            <div key={idx} className="sale-row bill-itemrow" style={{ display: "grid", gridTemplateColumns: "40px 1fr 70px 90px 90px 100px 32px", gap: 6, marginBottom: 6, alignItems: "center" }}>
              {/* Serial */}
              <div className="bi-sn" style={{ textAlign: "center", fontWeight: 700, color: "#888", fontSize: 14 }}>{idx + 1}</div>

              {/* Item name */}
              {item.is_charge ? (
                <input className="bi-item" value={item.product_name}
                  onChange={e => updateItem(idx, "product_name", e.target.value)}
                  style={{ ...inp, background: "#fef9c3", fontWeight: 600 }} />
              ) : (
                <SearchableSelect className="prod-sel" wrapClassName="bi-item" style={{ ...inp, fontSize: 13 }} placeholder="Type item..."
                  value={item.product_id}
                  options={products.map(p => ({ id: (p.product_id || p.id), label: p.name_en }))}
                  onChange={(id) => {
                    const p = products.find(x => (x.product_id || x.id) == id);
                    setBill(prev => {
                      const items = [...prev.items];
                      let it = { ...items[idx], product_id: id, product_name: p?.name_en || "", unit: p?.unit_type || "KG", is_charge: false };
                      if (id && !it.rate) it.rate = rates[id] || "";
                      it.amount = calcAmount(it);
                      items[idx] = it;
                      return { ...prev, items };
                    });
                  }}
                  onAdvance={(el) => el.closest(".sale-row")?.querySelector(".s-bag")?.focus()}
                  onEmptyEnter={() => document.getElementById("sales-save-btn")?.focus()} />
              )}

              {/* Bags — for BAG-billed products this drives the amount (bags × rate) */}
              <input className="s-bag bi-bags" type="number" min="0" step="1" inputMode="numeric" value={item.bags} placeholder="Bags"
                onChange={e => updateItem(idx, "bags", e.target.value.replace(/[^\d]/g, ""))}
                onKeyDown={e => {
                  if ([".", "e", "E", "+", "-"].includes(e.key)) { e.preventDefault(); return; }   // bags are whole numbers
                  // BAG products: weight is optional, so Enter jumps straight to rate.
                  if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); const r = e.target.closest(".sale-row"); (item.unit === "BAG" ? r.querySelector(".s-rate") : r.querySelector(".s-wt"))?.focus(); }}}
                style={{ ...inp, textAlign: "center" }} />

              {/* Weight — greyed/optional for BAG-billed products (amount comes from bags) */}
              <input className="s-wt bi-wt" type="number" step="0.5" value={item.weight} placeholder={item.unit === "BAG" ? "KG (opt)" : "KG"}
                onChange={e => updateItem(idx, "weight", e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); e.target.closest(".sale-row").querySelector(".s-rate")?.focus(); }}}
                style={{ ...inp, textAlign: "center", ...(item.unit === "BAG" ? { background: "#f9fafb", color: "#9ca3af" } : {}) }} />

              {/* Rate — Enter: add a new item & jump to it (Enter again on the empty item = Save & Print).
                   Tab: just move to the next row's item (no new row). */}
              <input className="s-rate bi-rate" type="number" step="0.5" value={item.rate} placeholder="Rate ₹"
                onChange={e => updateItem(idx, "rate", e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const nextProd = document.querySelectorAll(".prod-sel")[idx + 1];
                    if (nextProd) { nextProd.focus(); }
                    else { addItem(); setTimeout(() => document.querySelectorAll(".prod-sel")[idx + 1]?.focus(), 30); }
                  } else if (e.key === "Tab" && !e.shiftKey) {
                    e.preventDefault();
                    const nextProd = document.querySelectorAll(".prod-sel")[idx + 1];
                    if (nextProd) nextProd.focus(); else document.getElementById("sales-save-btn")?.focus();
                  }
                }}
                style={{ ...inp, textAlign: "center", background: item.rate ? "#f0fdf4" : "white" }} />

              {/* Mobile-only field captions (hidden on desktop) */}
              <span className="bi-lbl bi-lblB">Bags</span>
              <span className="bi-lbl bi-lblW">KG</span>
              <span className="bi-lbl bi-lblR">Rate</span>

              {/* Amount */}
              <div className="bi-amt" style={{ textAlign: "right", fontWeight: 700, color: "#2563eb", fontSize: 14, paddingRight: 4 }}>
                {item.amount > 0 ? fmt.currency(item.amount) : "—"}
              </div>

              {/* Remove */}
              {bill.items.length > 1 && (
                <button className="bi-rm" onClick={() => removeItem(idx)}
                  style={{ background: "#fee2e2", border: "none", borderRadius: 6, color: "#dc2626", cursor: "pointer", fontSize: 13, padding: "5px 8px" }}>✕</button>
              )}
            </div>
          ))}

          {/* Add buttons */}
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button onClick={addItem}
              style={{ padding: "6px 14px", background: "#f0fdf4", border: "1px dashed #86efac", borderRadius: 8, color: "#16a34a", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              + Add Item
            </button>
            <button onClick={() => addCharge("SAKKU + COOLY")}
              style={{ padding: "6px 14px", background: "#fef9c3", border: "1px dashed #fde047", borderRadius: 8, color: "#92400e", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              + Sakku & Cooly
            </button>
            <button onClick={() => addCharge("FREIGHT")}
              style={{ padding: "6px 14px", background: "#fef9c3", border: "1px dashed #fde047", borderRadius: 8, color: "#92400e", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              + Freight
            </button>
            <button onClick={() => addCharge("")}
              style={{ padding: "6px 14px", background: "#f3f4f6", border: "1px dashed #d1d5db", borderRadius: 8, color: "#6b7280", fontSize: 12, cursor: "pointer" }}>
              + Other Charge
            </button>
          </div>
        </div>
      </div>

      {/* Summary panel */}
      <div className="m-static" style={{ position: "sticky", top: 20 }}>
        <div style={{ background: "white", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 14 }}>BILL SUMMARY</div>
          {bill.vendor_name && (
            <div style={{ background: "#eff6ff", borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{bill.vendor_name}</div>
              {bill.vendor_name_ta && <div style={{ fontSize: 12, color: "#666", fontFamily: "'Noto Sans Tamil', sans-serif" }}>{bill.vendor_name_ta}</div>}
              <div style={{ fontSize: 12, color: "#888" }}>{bill.place}</div>
            </div>
          )}
          <SRow label="Bill Total"        value={fmt.currency(billTotal)} />
          {openingBal > 0 && <SRow label="Previous Balance" value={fmt.currency(openingBal)} color="#dc2626" />}
          <div style={{ borderTop: "2px solid #2563eb", paddingTop: 10, marginTop: 10 }}>
            <SRow label="Net Amount Due" value={fmt.currency(netAmount)} bold color="#2563eb" big />
          </div>
          {/* Vendor payment taken at billing — records a receipt and prints on the bill */}
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#16a34a" }}>Credited (paid now)</label>
            <input type="number" inputMode="decimal" value={bill.credited}
              onChange={e => setBill(p => ({ ...p, credited: e.target.value }))}
              placeholder="0" style={{ width: 110, padding: "6px 8px", borderRadius: 8, border: "1px solid #86efac", textAlign: "right", fontSize: 14, background: "#f0fdf4", fontFamily: "inherit" }} />
          </div>
          {parseFloat(bill.credited) > 0 && (
            <div style={{ borderTop: "1px dashed #cbd5e1", paddingTop: 8, marginTop: 8 }}>
              <SRow label="Balance" value={fmt.currency(netAmount - (parseFloat(bill.credited) || 0))} bold color="#16a34a" big />
            </div>
          )}
        </div>

        {editingId && (
          <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "8px 12px",
                        marginBottom: 8, fontSize: 12, fontWeight: 600, color: "#2563eb" }}>
            ✏️ Editing bill #{bill.bill_no || ""} — saving keeps the same bill number.
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button id="sales-save-btn" className="m-hide" onClick={() => handleSave(true)} disabled={saving}
            style={{ padding: "12px", borderRadius: 10, border: "none", cursor: saving ? "not-allowed" : "pointer",
                     background: saving ? "#9ca3af" : "#2563eb", color: "white", fontSize: 15, fontWeight: 700 }}>
            {saving ? "Saving..." : (editingId ? "💾 Update & Print" : "💾 Save & Print")}
          </button>
          <button onClick={() => handleSave(false)} disabled={saving}
            style={{ padding: "10px", borderRadius: 10, border: "1px solid #d1d5db", cursor: "pointer",
                     background: "white", color: "#374151", fontSize: 13 }}>
            {editingId ? "Update Only" : "Save Only"}
          </button>
          <button onClick={() => { const wasEditing = editingId; setBill(newBill()); setEditingId(null); setOpeningBal(0); if (wasEditing) onCancelEdit?.(); }}
            style={{ padding: "8px", borderRadius: 10, border: "none", background: "#f3f4f6", color: "#6b7280", fontSize: 12, cursor: "pointer" }}>
            {editingId ? "Cancel Edit" : "Clear"}
          </button>
        </div>
      </div>

      {/* Sticky bottom Save bar (phones only) — running total always in reach */}
      <div className="mobile-savebar">
        <div>
          <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 600 }}>Net Amount</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#2563eb" }}>{fmt.currency(netAmount)}</div>
        </div>
        <button onClick={() => handleSave(true)} disabled={saving}
          style={{ padding: "12px 22px", borderRadius: 10, border: "none", cursor: saving ? "not-allowed" : "pointer",
                   background: saving ? "#9ca3af" : "#2563eb", color: "white", fontSize: 15, fontWeight: 700 }}>
          {saving ? "Saving..." : (editingId ? "💾 Update & Print" : "💾 Save & Print")}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// MODE 1 — BILL BY PRODUCT (1 product → many vendors)
// ============================================================
function ProductBillForm({ date, vendors, products, rates, onSaved }) {
  const [product, setProduct]   = useState({ id: "", name: "", unit: "KG" });
  const [rows, setRows]         = useState([newRow()]);
  const [saving, setSaving]     = useState(false);
  const [existing, setExisting] = useState([]);   // rows already staged for this product+date (any billed state)

  // BAG-billed products charge bags × rate (no weight needed); everything else weight × rate.
  const byBag = product.unit === "BAG";

  function newRow() {
    return { vendor_id: "", vendor_name: "", place: "", bags: "", weight: "", rate: "", amount: 0 };
  }

  // Vendors already entered for the selected product today — used to show the list
  // and block re-adding the same vendor (avoids duplicate staged items).
  const existingVendorIds = new Set(existing.map(e => String(e.vendor_id)));

  // Pull everything already staged for a product (billed or not) on the working date,
  // so re-selecting the product shows who's been added and we can prevent duplicates.
  const loadExisting = (productId) => {
    if (!productId) { setExisting([]); return; }
    // Pending rows come from the draft; billed rows are read live from the bills, so any
    // later edit to a bill (qty/weight/rate or a changed product) shows here correctly.
    api(`sales?action=product-customers&product_id=${productId}&date=${date}`)
      .then(r => setExisting(r.data || []))
      .catch(() => setExisting([]));
  };

  const updateRow = (idx, field, value) => {
    setRows(prev => {
      const updated = [...prev];
      let row = { ...updated[idx], [field]: value };
      if (field === "vendor_id") {
        const v = vendors.find(x => x.id == value);
        row.vendor_name = v?.name_en || "";
        row.place       = v?.city || v?.area || "";
      }
      const qty = byBag ? (parseInt(row.bags) || 0) : (parseFloat(row.weight) || 0);
      row.amount = parseFloat((qty * (parseFloat(row.rate) || 0)).toFixed(2));
      updated[idx] = row;
      return updated;
    });
  };

  const addRow    = () => setRows(p => [...p, newRow()]);
  const removeRow = (idx) => setRows(p => p.filter((_, i) => i !== idx));

  const handleProductChange = (id) => {
    const p = products.find(x => (x.product_id || x.id) == id);
    const unit = p?.unit_type || "KG";
    setProduct({ id, name: p?.name_en || "", unit });
    setRows(prev => prev.map(r => {
      const rate = rates[id] || r.rate;
      const qty = unit === "BAG" ? (parseInt(r.bags) || 0) : (parseFloat(r.weight) || 0);
      return { ...r, rate, amount: parseFloat((qty * (parseFloat(rate) || 0)).toFixed(2)) };
    }));
    loadExisting(id);   // show who's already been added for this product
  };

  const totalBags   = rows.reduce((s, r) => s + (parseInt(r.bags) || 0), 0);
  const totalWeight = rows.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0);
  const totalAmount = rows.reduce((s, r) => s + (r.amount || 0), 0);

  const isDirty = () => {
    if (saving) return false;
    // Dirty only when there's actual unsaved row content — a product selected with
    // no filled rows (e.g. right after staging) is not unsaved work.
    return rows.some(r => r.vendor_id || r.weight || r.bags || r.rate);
  };

  // Stage these product rows against each vendor — does NOT generate bills.
  // The vendor is billed once per day from "Bill by Vendor", combining all staged items.
  const handleSaveAll = async () => {
    if (!product.id) { alert("Select a product first"); return false; }
    const picked = rows.filter(r => r.vendor_id);
    if (picked.length === 0) { alert("Add at least one vendor"); return false; }
    // Re-adding a vendor already staged for this product is allowed — the same product can be
    // billed again at a different rate (it becomes a separate line). We just count the re-adds.
    const readded = picked.filter(r => existingVendorIds.has(String(r.vendor_id))).length;
    if (byBag) { if (picked.some(r => !r.bags || !r.rate)) { alert("Fill bags and rate for all rows"); return false; } }
    else       { if (picked.some(r => !r.weight || !r.rate)) { alert("Fill weight and rate for all rows"); return false; } }
    setSaving(true);
    try {
      const res = await api("sales?action=stage", {
        method: "POST",
        body: JSON.stringify({
          entry_date: date,
          items: picked.map(r => ({
            vendor_id:    r.vendor_id,
            vendor_name:  r.vendor_name,
            product_id:   product.id,
            product_name: product.name,
            no_of_bags:   parseInt(r.bags) || 0,
            weight:       parseFloat(r.weight) || 0,
            rate:         parseFloat(r.rate) || 0,
          })),
        }),
      });
      alert(`✅ ${res.data.staged} item(s) staged for ${product.name}${readded ? ` (${readded} re-added as a separate line)` : ""}. They'll appear under each vendor in "Bill by Vendor".`);
      // Keep the product selected and refresh the "already added" list so they can
      // keep adding more vendors without re-entering the ones just saved.
      setRows([newRow()]);
      loadExisting(product.id);
      onSaved();
      return true;
    } catch (e) { alert("Error: " + e.message); return false; }
    finally { setSaving(false); }
  };

  // Prompt to Save / Discard before leaving with in-progress rows
  useNavGuard({ isDirty, save: handleSaveAll });

  return (
    <div style={{ background: "white", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
      {/* Product selector */}
      <div style={{ marginBottom: 16, maxWidth: 300 }}>
        <label style={lbl}>Select Product / விபரம்</label>
        <SearchableSelect style={inp} placeholder="Type to search product..."
          value={product.id}
          options={products.map(p => ({ id: (p.product_id || p.id), label: p.name_en }))}
          onChange={(id) => handleProductChange(id)}
          onAdvance={() => document.querySelector(".pv-vendor")?.focus()} />
        {byBag && (
          <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: "#7c3aed" }}>
            🧺 Billed by bag — amount = bags × rate (weight optional)
          </div>
        )}
      </div>

      {/* Already added for this product — so you don't re-enter the same vendors */}
      {product.id && existing.length > 0 && (
        <div style={{ marginBottom: 16, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 8 }}>
            Already staged for {product.name} · {existing.length} vendor{existing.length > 1 ? "s" : ""} — re-adding creates a separate line (e.g. a different rate)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {existing.map(e => (
              <span key={e.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "white",
                     border: "1px solid #fcd34d", borderRadius: 16, padding: "3px 10px", fontSize: 12, color: "#374151" }}>
                {e.vendor_name}
                <span style={{ color: "#9ca3af" }}>· {e.no_of_bags || 0} bag{(e.no_of_bags || 0) === 1 ? "" : "s"} · {Number(e.weight || 0).toFixed(1)}kg · ₹{Number(e.rate || 0)}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: e.is_billed == 1 ? "#16a34a" : "#d97706" }}>
                  {e.is_billed == 1 ? "BILLED" : "PENDING"}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Vendor rows */}
      <div style={{ marginBottom: 8 }}>
        <div className="bill-itemhead" style={{ display: "grid", gridTemplateColumns: "40px 1fr 80px 90px 90px 100px 32px", gap: 6, marginBottom: 8 }}>
          {["S.No", "Vendor", "Bags", "Weight KG", "Rate ₹", "Amount ₹", ""].map(h => (
            <span key={h} style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</span>
          ))}
        </div>

        {rows.map((row, idx) => {
         const dup = row.vendor_id && existingVendorIds.has(String(row.vendor_id));
         return (
          <Fragment key={idx}>
          <div className="pv-row bill-itemrow" style={{ display: "grid", gridTemplateColumns: "40px 1fr 80px 90px 90px 100px 32px", gap: 6, marginBottom: dup ? 2 : 6, alignItems: "center" }}>
            <div className="bi-sn" style={{ textAlign: "center", fontWeight: 700, color: "#888" }}>{idx + 1}</div>
            <SearchableSelect className="pv-vendor" wrapClassName="bi-item" style={{ ...inp, fontSize: 13 }} placeholder="Type vendor..."
              value={row.vendor_id}
              options={vendors.map(v => ({ id: v.id, label: v.name_en }))}
              onChange={(id) => {
                const v = vendors.find(x => x.id == id);
                setRows(prev => {
                  const u = [...prev];
                  u[idx] = { ...u[idx], vendor_id: id, vendor_name: v?.name_en || "", place: v ? (v.city || v.area || u[idx].place) : u[idx].place };
                  return u;
                });
              }}
              onAdvance={(el) => el.closest(".pv-row")?.querySelector(".pv-bag")?.focus()} />
            <input className="pv-bag bi-bags" type="number" min="0" step="1" inputMode="numeric" value={row.bags} placeholder="Bags"
              onChange={e => updateRow(idx, "bags", e.target.value.replace(/[^\d]/g, ""))}
              onKeyDown={e => {
                if ([".", "e", "E", "+", "-"].includes(e.key)) { e.preventDefault(); return; }   // bags are whole numbers
                if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); const r = e.target.closest(".pv-row"); (byBag ? r.querySelector(".pv-rate") : r.querySelector(".pv-wt"))?.focus(); }}}
              style={{ ...inp, textAlign: "center" }} />
            <input className="pv-wt bi-wt" type="number" step="0.5" value={row.weight} placeholder={byBag ? "KG (opt)" : "KG"}
              onChange={e => updateRow(idx, "weight", e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); e.target.closest(".pv-row").querySelector(".pv-rate")?.focus(); }}}
              style={{ ...inp, textAlign: "center", ...(byBag ? { background: "#f9fafb", color: "#9ca3af" } : {}) }} />
            <input className="pv-rate bi-rate" type="number" step="0.5" value={row.rate} placeholder="Rate ₹"
              onChange={e => updateRow(idx, "rate", e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                  e.preventDefault();
                  const next = document.querySelectorAll(".pv-vendor")[idx + 1];
                  if (next) next.focus();
                  else { addRow(); setTimeout(() => document.querySelectorAll(".pv-vendor")[idx + 1]?.focus(), 30); }
                }
              }}
              style={{ ...inp, textAlign: "center" }} />
            {/* Mobile-only field captions */}
            <span className="bi-lbl bi-lblB">Bags</span>
            <span className="bi-lbl bi-lblW">KG</span>
            <span className="bi-lbl bi-lblR">Rate</span>
            <div className="bi-amt" style={{ textAlign: "right", fontWeight: 700, color: "#2563eb", fontSize: 13 }}>
              {row.amount > 0 ? fmt.currency(row.amount) : "—"}
            </div>
            {rows.length > 1 && (
              <button className="bi-rm" onClick={() => removeRow(idx)}
                style={{ background: "#fee2e2", border: "none", borderRadius: 6, color: "#dc2626", cursor: "pointer", fontSize: 13, padding: "5px 8px" }}>✕</button>
            )}
          </div>
          {dup && (
            <div style={{ margin: "0 0 8px 46px", fontSize: 11, color: "#b45309", fontWeight: 600 }}>
              ⚠️ {row.vendor_name} already has this product staged — this will be added as a separate line.
            </div>
          )}
          </Fragment>
         );
        })}
      </div>

      <button onClick={addRow}
        style={{ padding: "6px 14px", background: "#f0fdf4", border: "1px dashed #86efac", borderRadius: 8, color: "#16a34a", fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 20 }}>
        + Add Vendor Row
      </button>

      {/* Totals */}
      <div style={{ background: "#f9fafb", borderRadius: 10, padding: 14, marginBottom: 16 }}>
        <div className="m-2col" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, textAlign: "center" }}>
          <div><div style={{ fontSize: 11, color: "#666" }}>Vendors</div><div style={{ fontSize: 20, fontWeight: 700 }}>{rows.filter(r => r.vendor_id).length}</div></div>
          <div><div style={{ fontSize: 11, color: "#666" }}>Total Bags</div><div style={{ fontSize: 20, fontWeight: 700 }}>{totalBags}</div></div>
          <div><div style={{ fontSize: 11, color: "#666" }}>Total KG</div><div style={{ fontSize: 20, fontWeight: 700 }}>{totalWeight.toFixed(1)}</div></div>
          <div><div style={{ fontSize: 11, color: "#666" }}>Total Amount</div><div style={{ fontSize: 20, fontWeight: 700, color: "#2563eb" }}>{fmt.currency(totalAmount)}</div></div>
        </div>
      </div>

      <button onClick={handleSaveAll} disabled={saving || !product.id}
        style={{ padding: "12px 32px", background: saving || !product.id ? "#9ca3af" : "#2563eb", border: "none",
                 borderRadius: 10, color: "white", fontSize: 15, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>
        {saving ? "Staging..." : `➕ Add ${rows.filter(r => r.vendor_id).length} item(s) to Vendors' Bills`}
      </button>
    </div>
  );
}

// ============================================================
// PRINT — portal-isolated, A4. Supports single + bulk (one bill per page)
// ============================================================
export function PrintSalesBills({ bills, onClose, dataOnly: dataOnlyProp = false }) {
  const list = Array.isArray(bills) ? bills : (bills ? [bills] : []);
  const [tpl, setTpl] = useState(null);
  const [tplReady, setTplReady] = useState(false);
  const [mode, setMode] = useState(dataOnlyProp ? "preprinted" : null);   // 'full' | 'preprinted' | 'thermal'
  useEffect(() => {
    getPrintTemplate().then(t => { setTpl(t); setMode(m => m || (t?.print_format || "full")); })
      .finally(() => setTplReady(true));
  }, []);
  // Auto-open the print dialog only once the template (logo/address/labels) has loaded —
  // otherwise on a cold cache the dialog fires on a half-built page that shows just the heading.
  useEffect(() => {
    if (!tplReady) return;
    const t = setTimeout(() => window.print(), 350);
    return () => clearTimeout(t);
  }, [tplReady]);
  // Count this as a print so reprints are visible in View Bills (anti double-cash)
  useEffect(() => {
    const ids = list.map(b => b.id).filter(Boolean);
    if (ids.length) api("sales?action=mark-printed", { method: "POST", body: JSON.stringify({ ids }) }).catch(() => {});
  }, []);

  const eff = mode || "full";
  const pageCss = {
    full:       "@page { size: A5 portrait; margin: 0; }",
    preprinted: "@page { size: A5; margin: 0; }",
    thermal:    "@page { size: 80mm auto; margin: 0; }",
  }[eff];
  const billWidth = { full: "148mm", preprinted: "148mm", thermal: "80mm" }[eff];

  return createPortal(
    <div className="print-portal">
      <style>{`
        .print-portal { position: fixed; inset: 0; background: #f3f4f6; overflow: auto; z-index: 2000;
                        font-family: 'Noto Sans Tamil', Inter, 'Segoe UI', system-ui, sans-serif; }
        .sbill { width: ${billWidth}; margin: 0 auto 16px; box-sizing: border-box; background: #fff; }
        .sbill.full { padding: 7mm; }
        .sbill.full table { width: 100%; border-collapse: collapse; }
        .sbill.full td, .sbill.full th { border: 1px solid #2d6a2d; padding: 5px 8px; font-size: 12.5px; }
        .sbill.full th { background: #e8f5e9; font-weight: 700; font-size: 11.5px; }
        .sbill.thermal { padding: 3mm 3.5mm; font-size: 12px; color: #000; line-height: 1.35; }
        @media screen { .sbill { box-shadow: 0 1px 10px rgba(0,0,0,0.18); } }
        @media print {
          .no-print { display: none !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body > *:not(.print-portal) { display: none !important; }
          .print-portal { position: static; overflow: visible; background: #fff; }
          .sbill { margin: 0; page-break-after: always; box-shadow: none; }
          .sbill:last-child { page-break-after: auto; }
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
          ← Back
        </button>
        <div style={{ display: "flex", border: "1px solid #d1d5db", borderRadius: 8, overflow: "hidden" }}>
          {[["full", "🧾 Full A5"], ["preprinted", "📄 Pre-printed"], ["thermal", "🧮 Thermal 80mm"]].map(([id, lab]) => (
            <button key={id} onClick={() => setMode(id)} style={{ padding: "8px 14px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
              borderLeft: id !== "full" ? "1px solid #e5e7eb" : "none",
              background: eff === id ? "#1a7a45" : "white", color: eff === id ? "white" : "#374151" }}>{lab}</button>
          ))}
        </div>
        {list.length === 1 && (list[0].id || list[0].bill_id) && (
          <button onClick={() => shareBillAsPdf('.sbill', list[0].bill_no, list[0].phone1)}
            style={{ padding: "10px 20px", background: "#16a34a", border: "none", borderRadius: 8, color: "white", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            📲 WhatsApp
          </button>
        )}
        <span style={{ fontSize: 13, color: "#6b7280" }}>{list.length} bill{list.length > 1 ? "s" : ""}</span>
        {eff === "preprinted" && <span className="no-print" style={{ fontSize: 12, color: "#9ca3af" }}>Adjust margins in Print Center → Bill Template to align with your paper.</span>}
      </div>

      {list.map((b, i) => <SalesBillSheet key={i} bill={b} tpl={tpl} mode={eff} />)}
    </div>,
    document.body
  );
}

// One printed sales-bill sheet. tpl = editable letterhead; mode = 'full' (A5) | 'preprinted' | 'thermal'.
function SalesBillSheet({ bill, tpl, mode = "full", dataOnly: dataOnlyProp }) {
  const billTotal = bill.bill_total || bill.items?.reduce((s, i) => s + (parseFloat(i.amount ?? i.net_amount) || 0), 0) || 0;
  const prevBal   = parseFloat(bill.opening_balance || 0);
  const netAmt    = billTotal + prevBal;   // New Total = Bill Total + Previous Balance
  const allocatedPayments = (bill.payments || []).reduce((s, p) => s + parseFloat(p.allocated_amt || 0), 0);
  const credited  = allocatedPayments || parseFloat(bill.credited_amt ?? bill.credited ?? 0) || 0;
  const balance   = netAmt - credited;     // Balance = New Total − Credited
  const t = tpl || {};
  const dataOnly = dataOnlyProp ?? (mode === "preprinted");

  if (mode === "thermal") return <SalesThermalSheet bill={bill} t={t} billTotal={billTotal} prevBal={prevBal} netAmt={netAmt} credited={credited} balance={balance} />;
  if (dataOnly) return <PreprintedSalesSheet bill={bill} t={t} billTotal={billTotal} prevBal={prevBal} netAmt={netAmt} credited={credited} balance={balance} />;

  return (
    <div className="sbill full">
      {(
      /* Header */
      <table style={{ marginBottom: 0 }}>
        <tbody>
          <tr>
            <td style={{ border: "2px solid #2d6a2d", textAlign: "center", padding: "10px 16px" }} colSpan={2}>
              {t.logo ? <img src={t.logo} alt="" style={{ maxHeight: 60, marginBottom: 4 }} /> : null}
              <div style={{ fontSize: 24, fontWeight: 900, color: "#1a5c1a", letterSpacing: 1 }}>{t.company_en || "SRI MURUGAN & Co.,"}</div>
              <div style={{ fontSize: 13, color: "#333" }}>{t.subtitle_en}</div>
              <div style={{ fontSize: 13, color: "#333" }}>{t.address}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#c00000", fontFamily: "'Noto Sans Tamil', sans-serif", margin: "4px 0" }}>
                {t.company_ta || "ஸ்ரீ முருகன் அன் கோ.,"}
              </div>
              <div style={{ fontSize: 12, color: "#333", fontFamily: "'Noto Sans Tamil', sans-serif" }}>{t.subtitle_ta}</div>
              {t.address_ta && <div style={{ fontSize: 12, color: "#333", fontFamily: "'Noto Sans Tamil', sans-serif" }}>{t.address_ta}</div>}
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>{t.phone || "Cell : 94433 34663, 73733 99999"}</div>
            </td>
          </tr>
        </tbody>
      </table>
      )}

      {/* Bill meta */}
      <table style={{ marginBottom: 0, borderTop: "none" }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #2d6a2d", width: "60%" }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                திரு. {bill.vendor_name}
                {bill.vendor_name_ta && <span style={{ fontFamily: "'Noto Sans Tamil', sans-serif", marginLeft: 8, fontSize: 14 }}>{bill.vendor_name_ta}</span>}
              </div>
              <div style={{ fontSize: 14, marginTop: 2 }}>ஊர் : <strong>{bill.place || "—"}</strong></div>
            </td>
            <td style={{ border: "1px solid #2d6a2d", textAlign: "right" }}>
              <div style={{ fontSize: 14 }}>எண் : <strong>{bill.bill_no}</strong></div>
              <div style={{ fontSize: 14, marginTop: 4 }}>
                தேதி : <strong>{bill.date ? new Date(bill.date).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "2-digit" }) : ""}</strong>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* Items table */}
      <table style={{ borderTop: "none" }}>
        <thead>
          <tr>
            <th style={{ width: 65, textAlign: "center" }}>ரேட்<br/>Rate</th>
            <th style={{ textAlign: "left" }}>விபரம்<br/>Description</th>
            <th style={{ width: 85, textAlign: "center" }}>எடை<br/>Weight</th>
            <th style={{ width: 75, textAlign: "center" }}>எண்ணம்<br/>Bags</th>
            <th style={{ width: 110, textAlign: "right" }}>பற்று பை.<br/>Amount</th>
          </tr>
        </thead>
        <tbody>
          {(bill.items || []).map((item, i) => (
            <tr key={i}>
              <td style={{ textAlign: "center" }}>{item.rate || item.sale_rate || ""}</td>
              <td style={{ fontWeight: 600, fontFamily: "'Noto Sans Tamil', sans-serif" }}>{item.product_name || item.name}</td>
              <td style={{ textAlign: "center" }}>{item.weight || item.vendor_weight || ""}</td>
              <td style={{ textAlign: "center" }}>{item.bags || item.no_of_bags || ""}</td>
              <td style={{ textAlign: "right" }}>{parseFloat(item.amount ?? item.net_amount ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
            </tr>
          ))}
          {Array.from({ length: Math.max(0, 6 - (bill.items?.length || 0)) }).map((_, i) => (
            <tr key={`empty-${i}`}><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} style={{ textAlign: "right", fontWeight: 700 }}>Bill Total :</td>
            <td style={{ textAlign: "right", fontWeight: 700 }}>{billTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
          </tr>
          {prevBal > 0 && (
            <tr>
              <td colSpan={4} style={{ textAlign: "right", fontWeight: 700 }}>Previous Balance :</td>
              <td style={{ textAlign: "right", fontWeight: 700 }}>{prevBal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
            </tr>
          )}
          <tr style={{ background: "#e8f5e9" }}>
            <td colSpan={4} style={{ textAlign: "right", fontWeight: 800, fontSize: 16 }}>Net Amount :</td>
            <td style={{ textAlign: "right", fontWeight: 800, fontSize: 16 }}>{netAmt.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
          </tr>
        </tfoot>
      </table>

      {/* Footer greetings */}
      {!dataOnly && (
      <table style={{ borderTop: "none" }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #2d6a2d", fontFamily: "'Noto Sans Tamil', sans-serif", fontSize: 13, color: "#1a5c1a", fontWeight: 700 }}>
              {t.greeting_left || "வாணிபமே கோயில் !"}
            </td>
            <td style={{ border: "1px solid #2d6a2d", textAlign: "right", fontFamily: "'Noto Sans Tamil', sans-serif", fontSize: 13, color: "#1a5c1a", fontWeight: 700 }}>
              {t.greeting_right || "வாடிக்கையாளரே தெய்வம் !!"}
            </td>
          </tr>
        </tbody>
      </table>
      )}
    </div>
  );
}

// Compact 80mm thermal receipt for a vendor sales bill.
function SalesThermalSheet({ bill, t, billTotal, prevBal, netAmt }) {
  const money = (n) => parseFloat(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 });
  const Row = ({ l, r, bold, big }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: bold ? 700 : 400, fontSize: big ? 15 : 12 }}>
      <span>{l}</span><span style={{ whiteSpace: "nowrap" }}>{r}</span>
    </div>
  );
  const hr = { borderTop: "1px dashed #000", margin: "5px 0" };
  return (
    <div className="sbill thermal">
      <div style={{ textAlign: "center" }}>
        {t.logo ? <img src={t.logo} alt="" style={{ maxHeight: 40, marginBottom: 2 }} /> : null}
        <div style={{ fontWeight: 800, fontSize: 14 }}>{t.company_en || "SRI MURUGAN & Co.,"}</div>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{t.company_ta || "ஸ்ரீ முருகன் அன் கோ.,"}</div>
        {t.subtitle_ta && <div style={{ fontSize: 10 }}>{t.subtitle_ta}</div>}
        <div style={{ fontSize: 10 }}>{t.address}</div>
        <div style={{ fontSize: 11, fontWeight: 600 }}>{t.phone || "Cell : 94433 34663, 73733 99999"}</div>
      </div>
      <div style={hr} />
      <Row l={`எண்: ${bill.bill_no}`} r={`தேதி: ${bill.date ? new Date(bill.date).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "2-digit" }) : ""}`} />
      <div style={{ fontWeight: 700, marginTop: 3 }}>திரு. {bill.vendor_name} {bill.vendor_name_ta || ""}</div>
      <div style={{ fontSize: 11 }}>ஊர்: {bill.place || "—"}</div>
      <div style={hr} />
      {(bill.items || []).map((item, i) => {
        const rate = item.rate || item.sale_rate || "";
        const wt = item.weight || item.vendor_weight || "";
        const bags = item.bags || item.no_of_bags || "";
        return (
          <div key={i} style={{ marginBottom: 3 }}>
            <div style={{ fontWeight: 600 }}>{item.product_name || item.name}</div>
            <Row l={`${rate ? rate + " ×" : ""} ${wt}${bags ? ` (${bags} மூ)` : ""}`} r={money(item.amount ?? item.net_amount)} />
          </div>
        );
      })}
      <div style={hr} />
      <Row l="பில் தொகை / Bill Total" r={money(billTotal)} />
      {prevBal > 0 && <Row l="பழைய பாக்கி / Prev Bal" r={money(prevBal)} />}
      <div style={hr} />
      <Row l="நிகர தொகை / NET" r={money(netAmt)} bold big />
      <div style={hr} />
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: 11 }}>{t.greeting_left || "வாணிபமே கோயில் !"} {t.greeting_right || "வாடிக்கையாளரே தெய்வம் !!"}</div>
      {t.footer && <div style={{ textAlign: "center", fontSize: 10, marginTop: 2 }}>{t.footer}</div>}
    </div>
  );
}

// Values-only overlay for pre-printed A5 stationery (logo/headers/labels are already on the paper).
// Every block + column is absolutely positioned from the editable template so it lands exactly in
// the physical form's boxes; the sheet is one fixed A5 page (overflow hidden) so it never carries
// over to a second page.
function PreprintedSalesSheet({ bill, t, billTotal, prevBal, netAmt, credited = 0, balance }) {
  const cfg = getPreprint(t, "a5");
  const num = v => (parseFloat(v) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 });
  const dateStr = bill.date ? new Date(bill.date).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "";
  const colVal = {
    rate:   it => it.rate || it.sale_rate || "",
    name:   it => it.product_name || it.name || "",
    weight: it => it.weight || it.vendor_weight || "",
    count:  it => it.bags || it.no_of_bags || "",
    amount: it => num(it.amount ?? it.net_amount ?? 0),
  };
  const fieldVal = {
    cust_name:  () => (
      <>
        {bill.vendor_name_ta && <div style={{ fontFamily: "'Noto Sans Tamil', sans-serif" }}>{bill.vendor_name_ta}</div>}
        {bill.vendor_name && <div>{bill.vendor_name}</div>}
      </>
    ),
    cust_place: () => bill.place || "",
    bill_no:    () => bill.bill_no || "",
    bill_date:  () => dateStr,
    total:      () => num(billTotal),
    prev_bal:   () => prevBal > 0 ? num(prevBal) : "",
    net:        () => num(netAmt),               // New Total = Bill + Previous
    credited:   () => credited > 0 ? num(credited) : "",
    balance:    () => num(balance ?? (netAmt - credited)),
    // Words (bilingual) sit in the details column, below the products
    total_label:    () => "Bill Total",
    prev_bal_label: () => prevBal > 0 ? "முன் பற்று / Previous" : "",
    net_label:      () => "New Total",
    credited_label: () => credited > 0 ? "வரவு தொகை / Credited" : "",
    balance_label:  () => "நிகர தொகை / Balance",
  };
  // Paginate so item rows can never reach the totals: at most cfg.rows items per sheet;
  // extra items continue on a second pre-printed sheet, with the totals on the last one.
  const allItems = bill.items || [];
  const perPage = Math.max(1, cfg.rows || 9);
  const pageCount = Math.max(1, Math.ceil(allItems.length / perPage));
  return Array.from({ length: pageCount }, (_, pi) => {
    const last = pi === pageCount - 1;
    return <PreprintRender key={pi} cfg={cfg} className="sbill" items={allItems.slice(pi * perPage, (pi + 1) * perPage)}
      colVal={colVal} fieldVal={fieldVal} showFields={last}
      footerNote={last ? undefined : `Sheet ${pi + 1} of ${pageCount} — continued →`} />;
  });
}

// Bills list — selectable (bulk print), editable, reprintable
function BillsList({ bills, onReprint, onEdit, onDelete, selectedIds = [], onToggleSelect, onPrintSelected }) {
  const allSelected = bills.length > 0 && bills.every(b => selectedIds.includes(b.id));
  const toggleAll = () => {
    if (allSelected) bills.forEach(b => selectedIds.includes(b.id) && onToggleSelect(b.id));
    else bills.forEach(b => !selectedIds.includes(b.id) && onToggleSelect(b.id));
  };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 13, color: "#6b7280" }}>{selectedIds.length} selected</span>
        <button onClick={onPrintSelected} disabled={selectedIds.length === 0}
          style={{ padding: "7px 16px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 600,
                   cursor: selectedIds.length === 0 ? "not-allowed" : "pointer",
                   background: selectedIds.length === 0 ? "#e5e7eb" : "#2563eb",
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
              {["Bill No", "Vendor", "Place", "Net Amount ₹", "Balance ₹", "Status", ""].map(h => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bills.length === 0
              ? <tr><td colSpan={8} style={{ padding: 30, textAlign: "center", color: "#666" }}>No bills today</td></tr>
              : bills.map((b, i) => (
                <tr key={b.id} style={{ background: selectedIds.includes(b.id) ? "#eff6ff" : (i % 2 === 0 ? "white" : "#fafafa") }}>
                  <td style={{ padding: "10px 14px", textAlign: "center" }}>
                    <input type="checkbox" checked={selectedIds.includes(b.id)} onChange={() => onToggleSelect(b.id)} />
                  </td>
                  <td style={{ padding: "10px 14px", fontWeight: 700, color: "#2563eb", fontSize: 13 }}>#{b.bill_no}</td>
                  <td style={{ padding: "10px 14px", fontSize: 13 }}>{b.party_name}</td>
                  <td style={{ padding: "10px 14px", fontSize: 12, color: "#666" }}>{b.town || "—"}</td>
                  <td style={{ padding: "10px 14px", fontWeight: 700, fontSize: 13 }}>{fmt.currency(b.net_amount)}</td>
                  <td style={{ padding: "10px 14px", fontWeight: 700, color: "#dc2626", fontSize: 13 }}>{fmt.currency(b.balance_due)}</td>
                  <td style={{ padding: "10px 14px" }}>
                    <span style={{ padding: "2px 10px", borderRadius: 10, fontSize: 11, fontWeight: 600,
                      background: b.payment_status === "paid" ? "#dcfce7" : "#fef9c3",
                      color: b.payment_status === "paid" ? "#16a34a" : "#ca8a04" }}>
                      {b.payment_status}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                    <button onClick={() => onEdit(b)}
                      style={{ padding: "4px 10px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, color: "#2563eb", cursor: "pointer", fontSize: 12, fontWeight: 600, marginRight: 6 }}>✏️ Edit</button>
                    <button onClick={() => onReprint(b)}
                      style={{ padding: "4px 10px", background: "#f3f4f6", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, marginRight: 6 }}>🖨️</button>
                    {onDelete && (
                      <button onClick={() => onDelete(b)} title="Delete bill"
                        style={{ padding: "4px 10px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🗑️ Delete</button>
                    )}
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Map a saved sales bill (GET response) → print-sheet shape
export function toPrintBill(gb) {
  return {
    id: gb.id,
    bill_no: gb.bill_no, date: gb.bill_date,
    vendor_name: gb.party_name || "", vendor_name_ta: gb.party_name_ta || "",
    place: gb.town || gb.address || "",
    items: (gb.items || []).map(it => ({
      product_name: it.product_name, sale_rate: it.sale_rate, rate: it.sale_rate,
      vendor_weight: it.vendor_weight, weight: it.vendor_weight,
      no_of_bags: it.no_of_bags, bags: it.no_of_bags,
      net_amount: it.net_amount, amount: it.net_amount,
    })),
    bill_total: gb.subtotal_amount, net_amount: gb.net_amount, opening_balance: 0,
    credited_amt: gb.credited_amt || 0,
    payments: gb.payments || [],
    phone1: gb.phone1 || "",
  };
}

// Map a saved sales bill (GET response) → editable VendorBillForm prefill shape
function toFormBill(gb) {
  return {
    editingId: gb.id, bill_no: gb.bill_no,
    vendor_id: gb.party_id, vendor_name: gb.party_name || "", vendor_name_ta: gb.party_name_ta || "",
    place: gb.town || gb.address || "",
    credited: gb.credited_amt ? String(gb.credited_amt) : "",
    items: (gb.items || []).map(it => ({
      product_id: it.product_id ? String(it.product_id) : "",
      product_name: it.product_name || "",
      bags: it.no_of_bags ? String(it.no_of_bags) : "",
      weight: it.vendor_weight ? String(it.vendor_weight) : "",
      rate: it.sale_rate ? String(it.sale_rate) : "",
      amount: parseFloat(it.net_amount || 0),
      is_charge: false,
    })),
  };
}

const SRow = ({ label, value, bold, color, big }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #f3f4f6" }}>
    <span style={{ fontSize: big ? 13 : 12, color: "#4b5563", fontWeight: bold ? 600 : 400 }}>{label}</span>
    <span style={{ fontSize: big ? 15 : 13, fontWeight: bold ? 700 : 600, color: color || "#111" }}>{value}</span>
  </div>
);

const lbl = { display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 5, textTransform: "uppercase" };
const inp = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14, boxSizing: "border-box", outline: "none", fontFamily: "inherit" };
