// ============================================================
//  YARD ENTRY MODULE - Supervisor iPad View
//  Touch-friendly, fast entry, sticky reference
// ============================================================
import { useState, useEffect, useRef } from "react";
import { api, apiCached, fmt, useNavGuard, getWorkingDate, getBusinessRules, DEFAULT_RULES } from "../App.jsx";

export default function YardEntryPage() {
  const [reference, setReference]   = useState(localStorage.getItem("yard_ref") || "DIRECT");
  const [editRef, setEditRef]       = useState(!localStorage.getItem("yard_ref"));
  const [allFarmers, setAllFarmers]  = useState([]);
  const [farmers, setFarmers]       = useState([]);
  const [trucks, setTrucks]         = useState([]);
  const [products, setProducts]     = useState([]);
  const [vendors, setVendors]       = useState([]);   // CUSTOMER parties (buyers)
  const [entries, setEntries]       = useState([]);   // list of farmer entries today
  const [stock, setStock]           = useState([]);   // yard items with unallocated bags
  const [current, setCurrent]       = useState(newFarmerEntry());
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(null);
  const [rules, setRules]           = useState(DEFAULT_RULES);
  useEffect(() => { getBusinessRules().then(setRules); }, []);
  const farmerRef = useRef();

  function newFarmerEntry() {
    return { farmer_id: "", farmer_name: "", town: "", items: [newItem()], freight_mode: "auto", freight: "" };
  }
  function newItem() {
    return {
      product_id: "", product_name: "", bags: "", weights: [], note: "", bag_deduction: 0,
      show_alloc: false, alloc_mode: "perbag",
      bag_vendors: [],            // per-bag mode: vendor_id at each bag index ("" = stock)
      qty_allocs: [newQtyAlloc()] // by-quantity mode: rows of {vendor_id, bags, weight}
    };
  }
  function newQtyAlloc() { return { vendor_id: "", bags: "", weight: "" }; }

  useEffect(() => {
    Promise.all([
      apiCached("parties?action=list&category=FARMER&cols=lite"),
      apiCached("parties?action=list&category=MARKET_SUPPLIER&cols=lite"),
      apiCached("products?action=list"),
      apiCached("parties?action=list&category=TRUCK&cols=lite"),
      // Sales-side parties (buyers) — Customer, Overflow, Market Vendor
      apiCached("parties?action=list&category=CUSTOMER&cols=lite"),
      apiCached("parties?action=list&category=OVERFLOW&cols=lite"),
      apiCached("parties?action=list&category=MARKET_VENDOR&cols=lite"),
    ]).then(([f, s, p, t, cust, over, mkt]) => {
      const all = [...f.data, ...s.data];
      setAllFarmers(all);
      setFarmers(all);
      setProducts(p.data);
      setTrucks(t.data);
      // Merge buyer categories, dedupe by id
      const seen = new Set();
      const buyers = [...cust.data, ...over.data, ...mkt.data]
        .filter(v => !seen.has(v.id) && seen.add(v.id));
      setVendors(buyers);
    });
    loadTodayEntries();
    loadStock();
  }, []);

  const loadStock = () => {
    api("yard?action=stock")
      .then(r => setStock(r.data || []))
      .catch(() => {});
  };

  const loadTodayEntries = () => {
    const today = getWorkingDate();
    const refParam = reference && reference !== "DIRECT"
      ? `&ref=${encodeURIComponent(reference)}`
      : "&ref=DIRECT";
    api(`yard?action=list&date=${today}${refParam}`)
      .then(r => setEntries(r.data))
      .catch(() => {});
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete yard entry for ${name}? This will NOT affect any purchase bills.`)) return;
    try {
      await api("yard?action=delete", { method: "POST", body: JSON.stringify({ id }) });
      loadTodayEntries();
    } catch (e) { alert(e.message); }
  };

  const setRef = (val) => {
    setReference(val);
    localStorage.setItem("yard_ref", val);
    setEditRef(false);
    // Filter farmers by truck
    if (val && val !== 'DIRECT') {
      const truck = trucks.find(t => t.name_en === val);
      if (truck) {
        Promise.all([
          apiCached(`parties?action=list&category=FARMER&truck_id=${truck.id}&cols=lite`),
          apiCached(`parties?action=list&category=MARKET_SUPPLIER&truck_id=${truck.id}&cols=lite`),
        ]).then(([f, s]) => setFarmers([...f.data, ...s.data])).catch(() => setFarmers(allFarmers));
      } else setFarmers(allFarmers);
    } else {
      setFarmers(allFarmers);
    }
    setTimeout(() => farmerRef.current?.focus(), 100);
  };

  // When bags count changes → create weight input boxes
  const handleBagCount = (itemIdx, count) => {
    const n = parseInt(count) || 0;
    setCurrent(prev => {
      const items = [...prev.items];
      const existing = items[itemIdx].weights || [];
      const existingBV = items[itemIdx].bag_vendors || [];
      items[itemIdx] = {
        ...items[itemIdx],
        bags: count,
        weights: Array.from({ length: n }, (_, i) => existing[i] || ""),
        bag_vendors: Array.from({ length: n }, (_, i) => existingBV[i] || ""),
      };
      return { ...prev, items };
    });
  };

  const handleWeight = (itemIdx, wIdx, val) => {
    setCurrent(prev => {
      const items = [...prev.items];
      const weights = [...items[itemIdx].weights];
      weights[wIdx] = val;
      items[itemIdx] = { ...items[itemIdx], weights };
      return { ...prev, items };
    });
  };

  const addItem = () => setCurrent(prev => ({ ...prev, items: [...prev.items, newItem()] }));

  const removeItem = (idx) => setCurrent(prev => ({
    ...prev, items: prev.items.filter((_, i) => i !== idx)
  }));

  // ---- Vendor allocation helpers ----
  const patchItem = (idx, patch) => setCurrent(prev => {
    const items = [...prev.items];
    items[idx] = { ...items[idx], ...(typeof patch === "function" ? patch(items[idx]) : patch) };
    return { ...prev, items };
  });

  const setBagVendor = (idx, bagIdx, vendorId) => patchItem(idx, it => {
    const bv = [...(it.bag_vendors || [])];
    bv[bagIdx] = vendorId;
    return { bag_vendors: bv };
  });

  const updateQtyAlloc = (idx, rowIdx, field, val) => patchItem(idx, it => {
    const rows = [...(it.qty_allocs || [])];
    rows[rowIdx] = { ...rows[rowIdx], [field]: val };
    return { qty_allocs: rows };
  });
  const addQtyAlloc    = (idx) => patchItem(idx, it => ({ qty_allocs: [...(it.qty_allocs || []), newQtyAlloc()] }));
  const removeQtyAlloc = (idx, rowIdx) => patchItem(idx, it => ({ qty_allocs: (it.qty_allocs || []).filter((_, i) => i !== rowIdx) }));

  // How many bags of an item are assigned to a vendor (rest = stock)
  const allocatedBags = (item) => {
    if (item.alloc_mode === "qty") {
      return (item.qty_allocs || []).reduce((s, r) => s + (r.vendor_id ? (parseInt(r.bags) || 0) : 0), 0);
    }
    return (item.bag_vendors || []).filter(v => v).length;
  };

  // Build the allocations payload for one item (for the allocate API)
  const buildAllocations = (item) => {
    const vName = (id) => vendors.find(v => v.id == id)?.name_en || "";
    if (item.alloc_mode === "qty") {
      return (item.qty_allocs || [])
        .filter(r => r.vendor_id && (parseInt(r.bags) || 0) > 0)
        .map(r => ({
          vendor_id: r.vendor_id, vendor_name: vName(r.vendor_id),
          no_of_bags: parseInt(r.bags) || 0,
          weight: parseFloat(r.weight) || 0,
        }));
    }
    // per-bag: group bags by vendor
    const byVendor = {};
    (item.bag_vendors || []).forEach((vid, i) => {
      if (!vid) return;
      if (!byVendor[vid]) byVendor[vid] = { bags: 0, weight: 0, bag_weights: [] };
      const w = parseFloat(item.weights[i]) || 0;
      byVendor[vid].bags += 1;
      byVendor[vid].weight += w;
      byVendor[vid].bag_weights.push(w);
    });
    return Object.entries(byVendor).map(([vid, g]) => ({
      vendor_id: vid, vendor_name: vName(vid),
      no_of_bags: g.bags, weight: parseFloat(g.weight.toFixed(2)), bag_weights: g.bag_weights,
    }));
  };

  const totalWeight = (item) => {
    const raw = item.weights.reduce((s, w) => s + (parseFloat(w) || 0), 0);
    // No auto deduction — net is the actual weighed weight. Spot adjustments are done by hand.
    return { raw: raw.toFixed(1), net: raw.toFixed(1), deduct: 0, deductPer: 0 };
  };

  // Is there an in-progress entry worth guarding against navigation?
  const isDirty = () => {
    if (saving) return false;
    if (current.farmer_id) return true;
    return current.items.some(i => i.product_id || i.bags || (i.weights || []).some(w => w));
  };

  const handleSaveFarmer = async () => {
    if (!current.farmer_id) { alert("Select farmer"); return false; }
    if (current.items.some(i => !i.product_id || !i.bags)) { alert("Fill all product rows"); return false; }
    // Validate: per item, allocated bags must not exceed bag count
    for (const it of current.items) {
      const total = parseInt(it.bags) || 0;
      if (allocatedBags(it) > total) {
        alert(`${it.product_name || "Product"}: allocated bags exceed ${total} bags`);
        return false;
      }
    }
    setSaving(true);
    try {
      const res = await api("yard?action=save", {
        method: "POST",
        body: JSON.stringify({
          reference,
          entry_date: getWorkingDate(),
          farmer_id: current.farmer_id,
          farmer_name: current.farmer_name,
          town: current.town,
          items: current.items,
          freight_mode: current.freight_mode,
          freight: parseFloat(current.freight) || 0,
        }),
      });
      const yardEntryId = res.data?.id;

      // Save vendor allocations for any product that has them
      if (yardEntryId) {
        for (const it of current.items) {
          const allocations = buildAllocations(it);
          if (allocations.length > 0) {
            await api("yard?action=allocate", {
              method: "POST",
              body: JSON.stringify({
                yard_entry_id: yardEntryId,
                product_id: it.product_id,
                product_name: it.product_name,
                allocations,
              }),
            });
          }
        }
      }

      setSaved(current.farmer_name);
      setCurrent(newFarmerEntry());
      loadTodayEntries();
      loadStock();
      setTimeout(() => { setSaved(null); farmerRef.current?.focus(); }, 2000);
      return true;
    } catch (e) { alert(e.message); return false; }
    finally { setSaving(false); }
  };

  // Prompt to Save / Discard before leaving with an in-progress entry
  useNavGuard({ isDirty, save: handleSaveFarmer });

  return (
    <div style={{ padding: 16, fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif", maxWidth: 900, margin: "0 auto" }}>

      {/* Reference bar */}
      <div style={{ background: "#0f4c2a", borderRadius: 12, padding: "12px 20px", marginBottom: 16,
                    display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 13 }}>📦 Reference:</span>
        {editRef ? (
          <div style={{ flex: 1 }}>
            <select autoFocus defaultValue={reference}
              onChange={e => setRef(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "none", fontSize: 15, fontWeight: 600 }}>
              <option value="">-- Select Reference --</option>
              <option value="DIRECT">DIRECT (No Truck)</option>
              {trucks.map(t => <option key={t.id} value={t.name_en}>{t.name_en}{t.name_ta ? ` / ${t.name_ta}` : ""}</option>)}
            </select>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
            <span style={{ color: "white", fontWeight: 700, fontSize: 20, letterSpacing: 1 }}>{reference || "DIRECT"}</span>
            <button onClick={() => setEditRef(true)}
              style={{ padding: "4px 12px", background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)",
                       borderRadius: 6, color: "white", cursor: "pointer", fontSize: 12 }}>Change</button>
          </div>
        )}
        <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>
          {new Date(getWorkingDate()).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
        </span>
      </div>

      {saved && (
        <div style={{ background: "#dcfce7", border: "1px solid #86efac", borderRadius: 10, padding: "12px 20px",
                      marginBottom: 16, color: "#16a34a", fontWeight: 600, fontSize: 15 }}>
          ✅ {saved}'s entry saved! Ready for next farmer.
        </div>
      )}

      {/* Farmer entry form */}
      <div style={{ background: "white", borderRadius: 12, padding: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.08)", marginBottom: 16 }}>

        {/* Farmer selection */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div>
            <label style={lbl}>Farmer / Supplier</label>
            <select ref={farmerRef} value={current.farmer_id}
              onChange={e => {
                const f = farmers.find(x => x.id == e.target.value);
                setCurrent(p => ({ ...p, farmer_id: e.target.value, farmer_name: f?.name_en || "", town: f?.city || f?.area || p.town }));
              }}
              onKeyDown={e => e.key === "Enter" && e.target.nextSibling?.focus()}
              style={inp}>
              <option value="">-- Select Farmer --</option>
              {farmers.map(f => <option key={f.id} value={f.id}>{f.name_en} {f.name_ta ? `/ ${f.name_ta}` : ""}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Town / Area</label>
            <input value={current.town}
              onChange={e => setCurrent(p => ({ ...p, town: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && e.target.closest(".item-row")?.querySelector(".product-sel")?.focus()}
              placeholder="Erode, Salem, Coimbatore..."
              style={inp} />
          </div>
        </div>

        {/* Product rows */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "200px 60px 1fr 80px", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>Product</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>Bags</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>Weight per bag (kg)</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", textTransform: "uppercase" }}>Net KG</span>
          </div>

          {current.items.map((item, idx) => {
            const tw = totalWeight(item);
            return (
              <div key={idx} className="item-row" style={{ marginBottom: 12, background: "#f9fafb", borderRadius: 10, padding: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "200px 60px 1fr 80px 32px", gap: 8, alignItems: "start" }}>
                  {/* Product */}
                  <select className="product-sel" value={item.product_id}
                    onChange={e => {
                      const p = products.find(x => x.id == e.target.value);
                      setCurrent(prev => {
                        const items = [...prev.items];
                        items[idx] = { ...items[idx], product_id: e.target.value, product_name: p?.name_en || "", bag_deduction: 0 };
                        return { ...prev, items };
                      });
                    }}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.target.closest(".item-row").querySelector(".bag-inp").focus(); }}}
                    style={{ ...inp, fontSize: 13 }}>
                    <option value="">-- Product --</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name_en}</option>)}
                  </select>

                  {/* Bags count */}
                  <input className="bag-inp" type="number" min="1" value={item.bags} placeholder="0"
                    onChange={e => handleBagCount(idx, e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.target.closest(".item-row").querySelectorAll(".w-inp")[0]?.focus(); }}}
                    style={{ ...inp, textAlign: "center", fontSize: 15, fontWeight: 700 }} />

                  {/* Weight inputs - one per bag */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {item.weights.map((w, wi) => (
                      <input key={wi} type="number" step="0.5" className="w-inp"
                        value={w} placeholder={`Bag ${wi + 1}`}
                        onChange={e => handleWeight(idx, wi, e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter" || e.key === "Tab") {
                            e.preventDefault();
                            const all = e.target.closest(".item-row").querySelectorAll(".w-inp");
                            if (wi < all.length - 1) all[wi + 1].focus();
                            else {
                              // move to next row or add new
                              const nextRow = e.target.closest("[class='item-row']")?.nextSibling;
                              if (nextRow) nextRow.querySelector(".product-sel")?.focus();
                              else addItem();
                            }
                          }
                        }}
                        style={{ width: 62, padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db",
                                 fontSize: 13, textAlign: "center", boxSizing: "border-box" }} />
                    ))}
                    {item.weights.length > 0 && (
                      <div style={{ fontSize: 11, color: "#6b7280", alignSelf: "center", marginLeft: 4 }}>
                        Total: {tw.raw} kg
                      </div>
                    )}
                  </div>

                  {/* Net weight */}
                  <div style={{ textAlign: "right", fontWeight: 700, color: "#1a7a45", fontSize: 16, paddingTop: 6 }}>
                    {tw.net > 0 ? `${tw.net}` : "—"}<br/>
                    <span style={{ fontSize: 10, fontWeight: 400, color: "#888" }}>kg</span>
                  </div>

                  {/* Remove */}
                  {current.items.length > 1 && (
                    <button onClick={() => removeItem(idx)}
                      style={{ background: "#fee2e2", border: "none", borderRadius: 6, color: "#dc2626",
                               cursor: "pointer", fontSize: 14, padding: "4px 8px", marginTop: 4 }}>✕</button>
                  )}
                </div>

                {/* Vendor allocation */}
                {(parseInt(item.bags) || 0) > 0 && (() => {
                  const totalBags = parseInt(item.bags) || 0;
                  const alloc = allocatedBags(item);
                  const stockBags = Math.max(0, totalBags - alloc);
                  return (
                    <div style={{ marginTop: 10, borderTop: "1px dashed #e5e7eb", paddingTop: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <button onClick={() => patchItem(idx, it => ({ show_alloc: !it.show_alloc }))}
                          style={{ padding: "5px 12px", background: item.show_alloc ? "#dbeafe" : "#eff6ff",
                                   border: "1px solid #bfdbfe", borderRadius: 8, color: "#2563eb",
                                   fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                          🧾 Sell to vendors {item.show_alloc ? "▲" : "▼"}
                        </button>
                        {alloc > 0 && (
                          <span style={{ fontSize: 12, color: "#2563eb", fontWeight: 600 }}>
                            {alloc} bag{alloc > 1 ? "s" : ""} allocated
                          </span>
                        )}
                        <span style={{ padding: "2px 10px", borderRadius: 10, fontSize: 11, fontWeight: 600,
                                       background: stockBags > 0 ? "#fef9c3" : "#dcfce7",
                                       color: stockBags > 0 ? "#ca8a04" : "#16a34a" }}>
                          {stockBags > 0 ? `${stockBags} bag${stockBags > 1 ? "s" : ""} as stock` : "Fully allocated"}
                        </span>
                      </div>

                      {item.show_alloc && (
                        <div style={{ marginTop: 10 }}>
                          {/* Mode toggle */}
                          <div style={{ display: "flex", gap: 0, marginBottom: 10, width: "fit-content",
                                        borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb" }}>
                            {[{ id: "perbag", label: "Per Bag" }, { id: "qty", label: "By Quantity" }].map(m => (
                              <button key={m.id} onClick={() => patchItem(idx, { alloc_mode: m.id })}
                                style={{ padding: "6px 16px", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
                                         background: item.alloc_mode === m.id ? "#2563eb" : "white",
                                         color: item.alloc_mode === m.id ? "white" : "#6b7280" }}>{m.label}</button>
                            ))}
                          </div>

                          {item.alloc_mode === "perbag" ? (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                              {item.weights.map((w, bi) => (
                                <div key={bi} style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 8, padding: 8, width: 150 }}>
                                  <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>
                                    Bag {bi + 1} · {(parseFloat(w) || 0) || "—"} kg
                                  </div>
                                  <select value={item.bag_vendors[bi] || ""}
                                    onChange={e => setBagVendor(idx, bi, e.target.value)}
                                    style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }}>
                                    <option value="">— Stock —</option>
                                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name_en}</option>)}
                                  </select>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 90px 32px", gap: 6, marginBottom: 4 }}>
                                {["Vendor", "Bags", "Weight kg", ""].map(h => (
                                  <span key={h} style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</span>
                                ))}
                              </div>
                              {(item.qty_allocs || []).map((r, ri) => (
                                <div key={ri} style={{ display: "grid", gridTemplateColumns: "1fr 80px 90px 32px", gap: 6, marginBottom: 6, alignItems: "center" }}>
                                  <select value={r.vendor_id}
                                    onChange={e => updateQtyAlloc(idx, ri, "vendor_id", e.target.value)}
                                    style={{ ...inp, fontSize: 12, padding: "6px 8px" }}>
                                    <option value="">-- Vendor --</option>
                                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name_en}</option>)}
                                  </select>
                                  <input type="number" min="0" value={r.bags} placeholder="0"
                                    onChange={e => updateQtyAlloc(idx, ri, "bags", e.target.value)}
                                    style={{ ...inp, textAlign: "center", padding: "6px 8px" }} />
                                  <input type="number" step="0.5" value={r.weight} placeholder="kg"
                                    onChange={e => updateQtyAlloc(idx, ri, "weight", e.target.value)}
                                    style={{ ...inp, textAlign: "center", padding: "6px 8px" }} />
                                  {(item.qty_allocs || []).length > 1 && (
                                    <button onClick={() => removeQtyAlloc(idx, ri)}
                                      style={{ background: "#fee2e2", border: "none", borderRadius: 6, color: "#dc2626", cursor: "pointer", fontSize: 12, padding: "5px 8px" }}>✕</button>
                                  )}
                                </div>
                              ))}
                              <button onClick={() => addQtyAlloc(idx)}
                                style={{ padding: "5px 12px", background: "#eff6ff", border: "1px dashed #bfdbfe", borderRadius: 8, color: "#2563eb", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                                + Add Vendor
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>

        {/* Freight (வண்டி வாடகை) — toggle auto (weight × 0.5) or manual; flows to the purchase bill */}
        {(() => {
          const entryNet = current.items.reduce((s, it) => s + (it.weights || []).reduce((a, w) => a + (parseFloat(w) || 0), 0), 0);
          const freightAuto = +(entryNet * rules.freight_per_kg).toFixed(2);
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                          background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 14px", margin: "4px 0 12px" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>🚚 Freight <span style={{ color: "#6b7280", fontWeight: 400 }}>வண்டி வாடகை</span></span>
              <div style={{ display: "flex", border: "1px solid #d1d5db", borderRadius: 8, overflow: "hidden" }}>
                {[["auto", `Auto (wt × ${rules.freight_per_kg})`], ["manual", "Manual"]].map(([id, lab]) => (
                  <button key={id} onClick={() => setCurrent(p => ({ ...p, freight_mode: id }))}
                    style={{ padding: "6px 13px", border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                             background: current.freight_mode === id ? "#1a7a45" : "white", color: current.freight_mode === id ? "white" : "#374151" }}>{lab}</button>
                ))}
              </div>
              {current.freight_mode === "auto" ? (
                <div style={{ fontSize: 14 }}>
                  <span style={{ color: "#6b7280" }}>{entryNet.toFixed(1)} kg × {rules.freight_per_kg} = </span>
                  <strong style={{ color: "#1a7a45" }}>₹{freightAuto.toLocaleString("en-IN")}</strong>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: "#6b7280", fontSize: 14 }}>₹</span>
                  <input type="number" step="1" value={current.freight} placeholder="0"
                    onChange={e => setCurrent(p => ({ ...p, freight: e.target.value }))}
                    style={{ width: 120, padding: "7px 10px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14, fontWeight: 600 }} />
                </div>
              )}
              <span style={{ fontSize: 11.5, color: "#9ca3af", marginLeft: "auto" }}>→ goes onto the purchase bill</span>
            </div>
          );
        })()}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={addItem}
            style={{ padding: "8px 16px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8,
                     color: "#16a34a", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            + Add Product
          </button>
          <button onClick={handleSaveFarmer} disabled={saving}
            style={{ padding: "10px 28px", background: saving ? "#9ca3af" : "#1a7a45", border: "none",
                     borderRadius: 8, color: "white", fontSize: 15, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", marginLeft: "auto" }}>
            {saving ? "Saving..." : "✓ Save & Next Farmer"}
          </button>
        </div>
      </div>

      {/* Today's yard entries */}
      {entries.length > 0 && (
        <div style={{ background: "white", borderRadius: 12, padding: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 15, color: "#374151" }}>
            Today's Entries — {reference} ({entries.length} farmers)
          </h3>
          {entries.map((e, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                                  padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{e.farmer_name}</span>
                <span style={{ color: "#888", fontSize: 12, marginLeft: 8 }}>{e.town}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#666" }}>{e.item_count} products</span>
                <span style={{ fontWeight: 700, color: "#1a7a45" }}>{e.total_net_weight} kg</span>
                <span style={{
                  padding: "2px 10px", borderRadius: 10, fontSize: 11, fontWeight: 600,
                  background: e.billed ? "#dcfce7" : "#fef9c3",
                  color: e.billed ? "#16a34a" : "#ca8a04"
                }}>{e.billed ? "Billed" : "Pending"}</span>
                <button onClick={() => handleDelete(e.id, e.farmer_name)}
                  style={{ padding: "3px 10px", background: "#fee2e2", border: "none", borderRadius: 6,
                           color: "#dc2626", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                  🗑 Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Stock — unallocated bags waiting to be sold */}
      {stock.length > 0 && (
        <StockPanel stock={stock} vendors={vendors} onChange={loadStock} />
      )}
    </div>
  );
}

// ============================================================
//  STOCK PANEL — yard bags not yet assigned to a vendor.
//  Allocate them to a vendor later (even on a following day).
// ============================================================
function StockPanel({ stock, vendors, onChange }) {
  const [openKey, setOpenKey] = useState(null);
  const [form, setForm]       = useState({ vendor_id: "", bags: "", weight: "" });
  const [busy, setBusy]       = useState(false);

  const keyOf = (s) => `${s.yard_entry_id}:${s.product_id}`;

  const startAllocate = (s) => {
    setOpenKey(keyOf(s));
    setForm({ vendor_id: "", bags: String(s.stock_bags), weight: "" });
  };

  const submit = async (s) => {
    if (!form.vendor_id) { alert("Select vendor"); return; }
    const bags = parseInt(form.bags) || 0;
    if (bags <= 0 || bags > s.stock_bags) { alert(`Bags must be 1–${s.stock_bags}`); return; }
    setBusy(true);
    try {
      // Merge with any existing unbilled allocations for this (entry, product)
      const existing = await api(`yard?action=allocations&yard_entry_id=${s.yard_entry_id}`);
      const prior = (existing.data || [])
        .filter(a => a.product_id == s.product_id)
        .map(a => ({ vendor_id: a.vendor_id, vendor_name: a.vendor_name,
                     no_of_bags: a.no_of_bags, weight: a.weight }));
      const vName = vendors.find(v => v.id == form.vendor_id)?.name_en || "";
      const allocations = [...prior, {
        vendor_id: form.vendor_id, vendor_name: vName,
        no_of_bags: bags, weight: parseFloat(form.weight) || 0,
      }];
      await api("yard?action=allocate", {
        method: "POST",
        body: JSON.stringify({
          yard_entry_id: s.yard_entry_id,
          product_id: s.product_id,
          product_name: s.product_name,
          allocations,
        }),
      });
      setOpenKey(null);
      onChange();
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ background: "white", borderRadius: 12, padding: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.08)", marginTop: 16 }}>
      <h3 style={{ margin: "0 0 14px", fontSize: 15, color: "#374151" }}>
        📦 Stock — bags waiting to be sold ({stock.length})
      </h3>
      {stock.map((s, i) => {
        const k = keyOf(s);
        return (
          <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{s.product_name}</span>
                <span style={{ color: "#888", fontSize: 12, marginLeft: 8 }}>
                  {s.farmer_name} · {fmt.date(s.entry_date)}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ padding: "2px 10px", borderRadius: 10, fontSize: 11, fontWeight: 600, background: "#fef9c3", color: "#ca8a04" }}>
                  {s.stock_bags} / {s.total_bags} bags
                </span>
                <button onClick={() => openKey === k ? setOpenKey(null) : startAllocate(s)}
                  style={{ padding: "4px 12px", background: "#2563eb", border: "none", borderRadius: 6, color: "white", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                  {openKey === k ? "Cancel" : "Allocate"}
                </button>
              </div>
            </div>

            {openKey === k && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 100px 90px", gap: 8, marginTop: 10, alignItems: "center" }}>
                <select value={form.vendor_id} onChange={e => setForm(f => ({ ...f, vendor_id: e.target.value }))}
                  style={{ ...inp, fontSize: 13 }}>
                  <option value="">-- Vendor --</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name_en}</option>)}
                </select>
                <input type="number" min="1" max={s.stock_bags} value={form.bags} placeholder="bags"
                  onChange={e => setForm(f => ({ ...f, bags: e.target.value }))}
                  style={{ ...inp, textAlign: "center" }} />
                <input type="number" step="0.5" value={form.weight} placeholder="weight kg"
                  onChange={e => setForm(f => ({ ...f, weight: e.target.value }))}
                  style={{ ...inp, textAlign: "center" }} />
                <button onClick={() => submit(s)} disabled={busy}
                  style={{ padding: "8px", background: busy ? "#9ca3af" : "#16a34a", border: "none", borderRadius: 8, color: "white", cursor: busy ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700 }}>
                  {busy ? "..." : "Save"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const lbl = { display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 5, textTransform: "uppercase" };
const inp = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14, boxSizing: "border-box", outline: "none", fontFamily: "inherit" };
