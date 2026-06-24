// ============================================================
//  IDNUK SOFTWARE - Main App Entry Point
// ============================================================
import { useState, useEffect, useRef, createContext, useContext } from "react";
import PurchasePage from "./pages/PurchasePage.jsx";
import QuickPurchasePage from "./pages/QuickPurchase.jsx";
import YardEntryPage from "./pages/YardEntry.jsx";
import SalesPage from "./pages/SalesPage.jsx";
import QuickSalesPage from "./pages/QuickSales.jsx";
import { ReportsPage, PartiesPage, ExpensesPage, PaymentsPage, ProductsPage, PrintCenterPage, TallyPage, UsersAdminPage, AuditLogPage, WebsitePage } from "./pages/OtherPages.jsx";
import MarketPage from "./pages/Market.jsx";
import OrdersPage from "./pages/Orders.jsx";
import SupplierPurchasePage from "./pages/SupplierPurchase.jsx";
// PublicHome is intentionally NOT imported here — it lives in its own bundle (src/home.jsx).

// ---- Tamil Font (Google Fonts) ----
const tamilFontLink = document.createElement('link');
tamilFontLink.rel = 'stylesheet';
tamilFontLink.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Tamil:wght@400;500;600;700&display=swap';
document.head.appendChild(tamilFontLink);

// Highlight the focused cell on billing forms so the accountant always sees where the cursor is
const billFocusStyle = document.createElement('style');
billFocusStyle.textContent = `
  .bill-page input:focus, .bill-page select:focus {
    box-shadow: 0 0 0 3px rgba(37,99,235,0.45) !important;
    border-color: #2563eb !important;
    background: #f5f9ff !important;
  }
  @media print {
    body.printing-report * { visibility: hidden !important; }
    body.printing-report .report-printing, body.printing-report .report-printing * { visibility: visible !important; }
    body.printing-report .report-printing { position: absolute; left: 0; top: 0; width: 100%; }
    body.printing-report .no-print { display: none !important; }
    @page { size: A4; margin: 10mm; }
  }
  /* ── Collapsible sidebar (desktop hamburger) ── */
  .app-sidebar { transition: width .18s ease; }
  .app-sidebar.collapsed .nav-label { display: none; }
  .app-sidebar.collapsed .nav-btn { justify-content: center; }
  /* Nav button states (hover/active can't be done inline) */
  .nav-btn { background: transparent; color: rgba(255,255,255,0.72);
             transition: background .14s ease, color .14s ease, box-shadow .14s ease; }
  .nav-btn:hover { background: rgba(255,255,255,0.10); color: #fff; }
  .nav-btn.active { background: rgba(255,255,255,0.16); color: #fff;
                    box-shadow: inset 3px 0 0 #6ee7a8; }
  .app-sidebar.collapsed .nav-btn.active { box-shadow: inset 0 0 0 1px rgba(110,231,168,0.5); }
  .app-main { transition: margin-left .18s ease; }
  /* ── Mobile responsive shell ── */
  .app-topbar { display: none; }
  .app-overlay { display: none; }
  @media (max-width: 860px) {
    /* The top bar stays ABOVE the drawer (z 101 > 100) so tapping the brand always
       toggles the menu — open or closed — instead of being covered by the open drawer. */
    .app-topbar { display: flex; align-items: center; gap: 10px; position: fixed; top: 0; left: 0; right: 0; height: 52px;
                  background: #0f4c2a; z-index: 101; padding: 0 12px; }
    .app-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 99; }
    /* Drawer slides in BELOW the top bar; its own brand header is hidden (top bar carries it). */
    .app-sidebar { transform: translateX(-100%); transition: transform .22s ease; z-index: 100;
                   top: 52px !important; height: calc(100vh - 52px) !important; }
    .app-sidebar.open { transform: translateX(0); }
    .app-sidebar-head { display: none !important; }
    /* On phones the sidebar is a full-width slide-in drawer, never the collapsed rail. */
    .app-sidebar, .app-sidebar.collapsed { width: 220px !important; }
    .app-sidebar.collapsed .nav-label { display: block !important; }
    .app-sidebar.collapsed .nav-btn { justify-content: flex-start !important; }
    .app-nav-toggle { display: none !important; }
    .app-main { margin-left: 0 !important; padding-top: 52px; overflow-x: auto; }
    .app-main > div { padding: 12px !important; }
    .bill-page { padding: 12px !important; }
  }
  /* ── Skeleton shimmer (premium loading state) ── */
  @keyframes rsmShimmer { 0% { background-position: -360px 0; } 100% { background-position: 360px 0; } }
  .rsm-skel { background: #eef2f7; background-image: linear-gradient(90deg, #eef2f7 0px, #f7fafc 180px, #eef2f7 360px);
              background-size: 720px 100%; animation: rsmShimmer 1.15s linear infinite; border-radius: 6px; }
  /* ── Per-device text scaling for small/old monitors (see TextSizeControl). Print must
        stay 1:1 so pre-printed bills + report prints keep their exact mm/px geometry. ── */
  @media print { .app-shell { zoom: 1 !important; } }

  /* ════════════════════════════════════════════════════════════════════════
     WHOLE-APP MOBILE (phones ≤ 760px).
     The app styles everything inline, so CSS media queries normally can't touch
     those rules — that's why these use !important and target classNames added to
     the inline-styled containers. Desktop (above 760px) is completely unaffected.
     ════════════════════════════════════════════════════════════════════════ */
  /* Mobile-only helpers — hidden on desktop, switched on inside the phone media query. */
  .bi-lbl { display: none; }                 /* tiny field captions over Bags/KG/Rate */
  .mobile-savebar { display: none; }         /* sticky bottom Save bar                 */
  @media (max-width: 760px) {
    /* iOS Safari zooms the whole page when a focused field's text is < 16px.
       Forcing 16px on phones keeps tap-to-type from jumping the layout around. */
    .app-shell input, .app-shell select, .app-shell textarea { font-size: 16px !important; }

    /* A stray too-wide element must never scroll the entire page sideways. */
    html, body { overflow-x: hidden; max-width: 100%; }

    /* Reflow helpers — added as classNames onto inline-styled grid containers. */
    .m-stack  { grid-template-columns: 1fr !important; }       /* two-pane → single column */
    .m-2col   { grid-template-columns: 1fr 1fr !important; }   /* 3/4-up stats → 2-up       */
    .m-1col   { grid-template-columns: 1fr !important; }
    .m-static { position: static !important; top: auto !important;     /* unstick side panels */
                height: auto !important; max-height: none !important; }
    .m-hide   { display: none !important; }   /* drop desktop-only chrome (e.g. duplicate save) */

    /* ── Compact, polished bill-item card ──────────────────────────────────
       Header line: ❶ chip · item name · ✕   |   then labelled Bags/KG/Rate
       with the running amount inline on the right. ~40% shorter than a stack. */
    .bill-itemhead { display: none !important; }
    .bill-itemrow {
      grid-template-columns: 26px 1fr 1fr 1fr !important;
      grid-template-areas:
        "sn   item item rm"
        ".    lbB  lbW  lbR"
        "amt  bags wt   rate" !important;
      gap: 4px 8px !important; align-items: center;
      border: none !important; border-radius: 14px;
      padding: 12px 14px; margin-bottom: 12px; background: #fff;
      box-shadow: 0 2px 8px rgba(16,24,40,0.10);
    }
    .bill-itemrow .bi-sn {
      grid-area: sn; justify-self: start;
      width: 22px; height: 22px; border-radius: 50%;
      background: #16a34a; color: #fff !important;
      font-size: 12px !important; font-weight: 800 !important;
      display: flex; align-items: center; justify-content: center;
    }
    .bill-itemrow .bi-item { grid-area: item; }
    .bill-itemrow .bi-rm   { grid-area: rm; justify-self: end; align-self: center; }
    .bill-itemrow .bi-lbl  { display: block; font-size: 10px !important; font-weight: 700;
                             color: #9ca3af; text-transform: uppercase; padding-left: 2px; margin-top: 4px; }
    .bill-itemrow .bi-lblB { grid-area: lbB; }
    .bill-itemrow .bi-lblW { grid-area: lbW; }
    .bill-itemrow .bi-lblR { grid-area: lbR; }
    .bill-itemrow .bi-bags { grid-area: bags; }
    .bill-itemrow .bi-wt   { grid-area: wt; }
    .bill-itemrow .bi-rate { grid-area: rate; }
    .bill-itemrow .bi-amt  { grid-area: amt; align-self: end; text-align: left !important;
                             font-size: 15px !important; padding: 0 0 7px 0 !important; }

    /* Farmer-purchase line keeps its full-width per-bag weight boxes. */
    .pbill-itemhead { display: none !important; }
    .pbill-itemrow {
      grid-template-columns: repeat(4, 1fr) !important;
      grid-template-areas:
        "prod prod prod rm"
        "bags bags rate rate"
        "wts  wts  wts  wts"
        "net  net  net  net" !important;
      gap: 8px !important;
      box-shadow: 0 2px 8px rgba(16,24,40,0.10); border-radius: 14px !important;
    }
    .pbill-itemrow .pb-prod { grid-area: prod; }
    .pbill-itemrow .pb-bags { grid-area: bags; }
    .pbill-itemrow .pb-rate { grid-area: rate; }
    .pbill-itemrow .pb-wts  { grid-area: wts; }
    .pbill-itemrow .pb-net  { grid-area: net; text-align: right !important; padding-top: 0 !important; }
    .pbill-itemrow .pb-rm   { grid-area: rm; justify-self: end; }

    /* Sticky bottom Save bar — running total + primary action, always reachable. */
    .mobile-savebar {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 80;
      background: #fff; border-top: 1px solid #e5e7eb;
      padding: 9px 14px calc(9px + env(safe-area-inset-bottom));
      box-shadow: 0 -3px 14px rgba(16,24,40,0.12);
    }
    .has-savebar { padding-bottom: 84px !important; }
  }
`;
document.head.appendChild(billFocusStyle);

// Reusable shimmer placeholder. <Skeleton w="60%" h={14} /> or a block of rows.
export function Skeleton({ w = "100%", h = 14, style }) {
  return <span className="rsm-skel" style={{ display: "inline-block", width: w, height: h, ...style }} />;
}

// ---- Per-device text scaling ------------------------------------------------
// The whole app uses absolute px sizes — fine on a Retina Mac, tiny on an old
// 1366×768 Windows monitor. CSS `zoom` on the app shell scales *and* reflows the
// entire UI uniformly (sidebar + content), and it's saved per-device so each
// person picks their own comfort level. Default 110% nudges everything readable
// out of the box. Print is reset to 1 in CSS so bills stay calibrated.
const UI_SCALES = [90, 100, 110, 125, 140, 160];
export function getUiScale() {
  const v = parseInt(localStorage.getItem("rsm_ui_scale") || "110", 10);
  return UI_SCALES.includes(v) ? v : 110;
}
export function applyUiScale(v) {
  localStorage.setItem("rsm_ui_scale", String(v));
  const el = document.querySelector(".app-shell");
  if (el) el.style.zoom = v / 100;
}
function TextSizeControl() {
  const [scale, setScale] = useState(getUiScale());
  const idx = Math.max(0, UI_SCALES.indexOf(scale));
  const step = (dir) => {
    const v = UI_SCALES[Math.max(0, Math.min(UI_SCALES.length - 1, idx + dir))];
    applyUiScale(v); setScale(v);
  };
  const btn = (on) => ({
    width: 26, height: 26, borderRadius: 6, border: "1px solid #cbd5e1",
    background: on ? "#f9fafb" : "#f1f5f9", color: on ? "#1f2937" : "#9ca3af",
    fontWeight: 800, lineHeight: 1, cursor: on ? "pointer" : "default",
    display: "flex", alignItems: "center", justifyContent: "center",
  });
  return (
    <span title="Text size — make everything bigger on small screens. Saved on this computer."
      style={{ display: "inline-flex", alignItems: "center", gap: 5,
               padding: "3px 8px", borderRadius: 999, background: "#fff",
               border: "1px solid #e5e7eb" }}>
      <span style={{ fontWeight: 700, color: "#475569", fontSize: 12 }}>Text size</span>
      <button onClick={() => step(-1)} disabled={idx === 0} style={btn(idx > 0)}
        aria-label="Smaller text">A−</button>
      <span style={{ minWidth: 40, textAlign: "center", fontWeight: 800, fontSize: 12, color: "#1f2937" }}>{scale}%</span>
      <button onClick={() => step(1)} disabled={idx === UI_SCALES.length - 1} style={btn(idx < UI_SCALES.length - 1)}
        aria-label="Bigger text">A+</button>
    </span>
  );
}
export function SkeletonRows({ rows = 6, cols = 1 }) {
  return (
    <div style={{ padding: "4px 0" }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: "flex", gap: 16, padding: "11px 4px", borderBottom: "1px solid #f3f4f6" }}>
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} w={c === 0 ? "30%" : `${Math.max(10, 60 / cols)}%`} h={13} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ---- English to Tamil Transliteration Map ----
const EN_TA_MAP = {
  'aa':'ஆ','ii':'ஈ','uu':'ஊ','ee':'ஏ','oo':'ஓ',
  'ai':'ஐ','au':'ஔ','a':'அ','i':'இ','u':'உ','e':'எ','o':'ஒ',
  'ka':'க','ki':'கி','ku':'கு','ke':'கெ','ko':'கொ','kaa':'கா','kii':'கீ','kuu':'கூ','kee':'கே','koo':'கோ',
  'nga':'ங',
  'cha':'ச','chi':'சி','chu':'சு','che':'செ','cho':'சொ','chaa':'சா','chii':'சீ','chuu':'சூ','chee':'சே','choo':'சோ',
  'ja':'ஜ','nya':'ஞ',
  'ta':'த','ti':'தி','tu':'து','te':'தெ','to':'தொ','taa':'தா','tii':'தீ','tuu':'தூ','tee':'தே','too':'தோ',
  'na':'ந','ni':'நி','nu':'நு','ne':'நெ','no':'நொ','naa':'நா','nuu':'நூ',
  'pa':'ப','pi':'பி','pu':'பு','pe':'பெ','po':'பொ','paa':'பா','pii':'பீ','puu':'பூ','pee':'பே','poo':'போ',
  'ma':'ம','mi':'மி','mu':'மு','me':'மெ','mo':'மொ','maa':'மா','mii':'மீ','muu':'மூ','mee':'மே','moo':'மோ',
  'ya':'ய','yu':'யு','ye':'யெ','yo':'யொ','yaa':'யா','yee':'யே','yoo':'யோ',
  'ra':'ர','ri':'ரி','ru':'ரு','re':'ரெ','ro':'ரொ','raa':'ரா','ree':'ரே','roo':'ரோ',
  'la':'ல','li':'லி','lu':'லு','le':'லெ','lo':'லொ','laa':'லா','lee':'லே','loo':'லோ',
  'va':'வ','vi':'வி','vu':'வு','ve':'வெ','vo':'வொ','vaa':'வா','vii':'வீ','vee':'வே','voo':'வோ',
  'zha':'ழ','zhi':'ழி','zhu':'ழு','zhaa':'ழா',
  'La':'ள','Li':'ளி','Lu':'ளு','Laa':'ளா','Lee':'ளே',
  'Ra':'ற','Ri':'றி','Ru':'று','Raa':'றா','Ree':'றே',
  'Na':'ண','Ni':'ணி','Nu':'ணு','Naa':'ணா',
  'sha':'ஷ','sri':'ஸ்ரீ',
  'murugan':'முருகன்','kumar':'குமார்','raman':'ராமன்',
  'tomato':'தக்காளி','onion':'வெங்காயம்',
};

export function transliterateToTamil(text) {
  if (!text) return '';
  let result = text.toLowerCase();
  // Sort by length descending to match longer patterns first
  const sorted = Object.keys(EN_TA_MAP).sort((a,b) => b.length - a.length);
  for (const key of sorted) {
    result = result.replace(new RegExp(key, 'g'), EN_TA_MAP[key]);
  }
  return result;
}

// ---- Tamil Input Component ----
export function TamilInput({ value, onChange, tamilValue, onTamilChange, label, placeholder, style }) {
  const handleEnglishChange = (e) => {
    const eng = e.target.value;
    onChange(eng);
    if (onTamilChange && !tamilValue) {
      onTamilChange(transliterateToTamil(eng));
    }
  };
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div style={{ flex: 1 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>
          {label} (English)
        </label>
        <input value={value} onChange={handleEnglishChange}
          placeholder={placeholder || label}
          style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box', ...style }} />
      </div>
      <div style={{ flex: 1 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>
          {label} (தமிழ்)
        </label>
        <input value={tamilValue} onChange={e => onTamilChange && onTamilChange(e.target.value)}
          placeholder="தமிழில் தட்டச்சு செய்யவும்"
          style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box', fontFamily: "'Noto Sans Tamil', sans-serif", ...style }} />
      </div>
    </div>
  );
}


// ---- API Base URL (change after deployment) ----
export const API_BASE = "/demo/api";

// ---- Auth Context ----
const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

// ---- Navigation Guard (unsaved-changes prompt) ----
// A page registers { isDirty, save } so the app can prompt Save / Discard / Cancel
// before navigating away. save() should return false to abort the navigation.
const NavGuardContext = createContext(null);
export function useNavGuard(guard) {
  const ref = useContext(NavGuardContext);
  useEffect(() => {
    if (!ref) return;
    ref.current = guard;
    return () => { if (ref.current === guard) ref.current = null; };
  });
}

// ---- Type-ahead combobox (styled to match the UI font) ----
// options: [{ id, label }]. onChange(id). onAdvance(inputEl) fires on Enter/Tab commit.
// Rank a search hit so the closest matches surface first: 0 exact, 1 starts-with,
// 2 a word inside the label starts with the query, 3 plain substring. Lower = better.
// e.g. typing "SSA" puts "SSA" (prefix) above "Saleem(Hassan)" (substring inside "Hassan").
function searchRank(label, ql) {
  const s = (label || "").toLowerCase();
  if (s === ql) return 0;
  if (s.startsWith(ql)) return 1;
  const esc = ql.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`(^|[^a-z0-9])${esc}`).test(s)) return 2;
  return 3;
}

export function SearchableSelect({ value, options, onChange, placeholder, className, wrapClassName, style, onAdvance, onEmptyEnter, onEscape }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState(null);   // null = show selected label; string = user typing
  const [hi, setHi]       = useState(-1);
  const wrapRef  = useRef(null);
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  const selected = options.find(o => String(o.id) === String(value ?? ""));
  const shownText = query !== null ? query : (selected ? selected.label : "");
  const ql = (query || "").trim().toLowerCase();
  const filtered = ql
    ? options.filter(o => (o.label || "").toLowerCase().includes(ql))
             .sort((a, b) => searchRank(a.label, ql) - searchRank(b.label, ql))
    : options;

  useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) closeReset(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  });

  const closeReset = () => { setOpen(false); setQuery(null); setHi(-1); };
  const pick = (o) => { onChange(o.id, o); setQuery(null); setOpen(false); setHi(-1); };

  // Keep the highlighted option scrolled into view while arrowing through a long list
  useEffect(() => {
    if (open && hi >= 0) listRef.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi, open]);

  return (
    <div ref={wrapRef} className={wrapClassName} style={{ position: "relative" }}>
      <input ref={inputRef} className={className} style={style} placeholder={placeholder}
        value={shownText} autoComplete="off"
        onFocus={() => { setOpen(true); setQuery(""); setHi(-1); }}
        onChange={e => { setQuery(e.target.value); setOpen(true); setHi(e.target.value ? 0 : -1); }}
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, filtered.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
          else if (e.key === "Escape") { e.preventDefault(); closeReset(); onEscape && onEscape(); }
          else if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
            let chosen = null;
            if (open && hi >= 0 && filtered[hi]) chosen = filtered[hi];
            else if (open && query && filtered.length === 1) chosen = filtered[0];
            else if (query) { const ex = options.find(o => (o.label || "").toLowerCase() === query.toLowerCase()); if (ex) chosen = ex; }
            if (chosen) { pick(chosen); e.preventDefault(); onAdvance && onAdvance(inputRef.current); return; }
            // nothing chosen — empty field + Enter can trigger a special action (e.g. save)
            const isEmpty = !query && (value === "" || value == null);
            if (e.key === "Enter" && isEmpty && onEmptyEnter) { e.preventDefault(); closeReset(); onEmptyEnter(); return; }
            closeReset();
            e.preventDefault();
            onAdvance && onAdvance(inputRef.current);
          }
        }}
      />
      {open && filtered.length > 0 && (
        <div ref={listRef} style={{ position: "absolute", zIndex: 60, top: "calc(100% + 2px)", left: 0, right: 0, background: "white",
                      border: "1px solid #d1d5db", borderRadius: 8, maxHeight: 240, overflowY: "auto",
                      boxShadow: "0 6px 18px rgba(0,0,0,0.14)", fontFamily: "inherit" }}>
          {filtered.map((o, i) => (
            <div key={o.id} data-i={i}
              onMouseDown={e => { e.preventDefault(); pick(o); onAdvance && onAdvance(inputRef.current); }}
              onMouseEnter={() => setHi(i)}
              style={{ padding: "8px 12px", fontSize: 14, cursor: "pointer", fontFamily: "inherit",
                       fontWeight: i === hi ? 700 : 400,
                       color: i === hi ? "#ffffff" : "#111827", background: i === hi ? "#1a7a45" : "white" }}>
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Keyboard-driven pending queue (search + ↑↓ + Enter) ----
// items: [{ id, label, sub }]. onPick(id) loads that item. currentId highlights the active one.
export function PendingQueue({ items, currentId, onPick, placeholder = "Search…", emptyText = "Nothing pending 🎉", autoFocus = true }) {
  const [q, setQ]   = useState("");
  const [hi, setHi] = useState(0);
  const searchRef   = useRef(null);
  const listRef     = useRef(null);
  useEffect(() => { if (autoFocus) searchRef.current?.focus(); }, [autoFocus]);

  const ql = q.trim().toLowerCase();
  const filtered = ql
    ? items.filter(it => `${it.label || ""} ${it.sub || ""}`.toLowerCase().includes(ql))
           .sort((a, b) => searchRank(a.label, ql) - searchRank(b.label, ql))
    : items;
  useEffect(() => { setHi(0); }, [q, items.length]);
  // keep the highlighted row in view
  useEffect(() => { listRef.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" }); }, [hi]);

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const it = filtered[hi]; if (it) onPick(it.id); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
        placeholder={placeholder} autoComplete="off"
        style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #d1d5db",
                 fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 8, fontFamily: "inherit" }} />
      <div ref={listRef} style={{ flex: 1, overflowY: "auto", border: "1px solid #eef2f7", borderRadius: 8, minHeight: 120 }}>
        {filtered.length === 0
          ? <div style={{ padding: 20, textAlign: "center", color: "#999", fontSize: 13 }}>{emptyText}</div>
          : filtered.map((it, i) => (
            <div key={it.id} data-i={i}
              onMouseEnter={() => setHi(i)} onClick={() => onPick(it.id)}
              style={{ padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid #f1f5f9",
                       display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center",
                       background: i === hi ? "#1a7a45" : (String(it.id) === String(currentId) ? "#dcfce7" : "white"),
                       color: i === hi ? "#ffffff" : "#111827" }}>
              <span style={{ fontWeight: 600, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.label}</span>
              {it.sub && <span style={{ fontSize: 11, opacity: i === hi ? 0.9 : 0.6, whiteSpace: "nowrap" }}>{it.sub}</span>}
            </div>
          ))}
      </div>
    </div>
  );
}

// ---- Print template (shared letterhead + pre-print layout) ----
// Cached only for a short burst (e.g. while a batch of bills renders at once). Otherwise it
// refetches, so a layout saved on one device shows up on the NEXT print from another device
// (the shop prints from different PCs) instead of being stuck on a stale in-memory copy.
let _printTplCache = null;
let _printTplAt = 0;
export async function getPrintTemplate() {
  if (_printTplCache && Date.now() - _printTplAt < 3000) return _printTplCache;
  try { const r = await api("settings?action=print"); _printTplCache = r.data; _printTplAt = Date.now(); return r.data; }
  catch { return _printTplCache; }
}
export function clearPrintTemplateCache() { _printTplCache = null; _printTplAt = 0; }

// ---- Pre-print calibration (values-only overlay on pre-printed stationery) ----
// Every field/column carries its own editable label + position (mm) + width + alignment,
// so the Pre-print editor can place each value exactly inside the paper's boxes.
// A5 = sales bills (148×210mm). 6×6 = farmer purchase (152.4mm square).
export const DEFAULT_PREPRINT = {
  a5: {
    label: "Sales bill (A5)", paper: { w: 148, h: 210 }, font: 12, row: 7.5, items_top: 56, rows: 9,
    cols: [
      { key: "rate",   label: "Rate",   x: 6,   w: 14, align: "c" },
      { key: "name",   label: "Name",   x: 20,  w: 44, align: "l" },
      { key: "weight", label: "Weight", x: 64,  w: 22, align: "c" },
      { key: "count",  label: "Count",  x: 86,  w: 18, align: "c" },
      { key: "amount", label: "Amount", x: 104, w: 28, align: "r" },
    ],
    fields: [
      { key: "cust_name",  label: "Customer name", x: 22,  y: 40,  w: 70, align: "l", bold: true },
      { key: "cust_place", label: "Place",         x: 22,  y: 44,  w: 70, align: "l" },
      { key: "bill_no",    label: "Bill No",       x: 104, y: 40,  w: 40, align: "r" },
      { key: "bill_date",  label: "Date",          x: 104, y: 44,  w: 40, align: "r" },
      // Payment block (values on the right). Net here = New Total = Bill + Previous balance.
      { key: "total",      label: "Bill total",      x: 104, y: 144, w: 28, align: "r" },
      { key: "prev_bal",   label: "Previous balance", x: 104, y: 151, w: 28, align: "r" },
      { key: "net",        label: "New total",        x: 104, y: 158, w: 28, align: "r" },
      { key: "credited",   label: "Credited",         x: 104, y: 165, w: 28, align: "r" },
      { key: "balance",    label: "Balance",          x: 102, y: 172.5, w: 30, align: "r", bold: true, size: 14 },
      // Their words, printed in the details (name) column at the bottom.
      { key: "total_label",    label: "“Bill Total” word",       x: 18, y: 144, w: 60, align: "l" },
      { key: "prev_bal_label", label: "“Previous Balance” word", x: 18, y: 151, w: 60, align: "l" },
      { key: "net_label",      label: "“New Total” word",        x: 18, y: 158, w: 60, align: "l" },
      { key: "credited_label", label: "“Credited” word",         x: 18, y: 165, w: 60, align: "l" },
      { key: "balance_label",  label: "“Balance” word",          x: 18, y: 172.5, w: 60, align: "l", bold: true },
    ],
    lines: [
      { x: 16, y: 170.5, w: 132 },   // rule above the final Balance
    ],
  },
  sixbysix: {
    label: "Farmer purchase (6×6)", paper: { w: 152.4, h: 152.4 }, font: 11, row: 7, items_top: 68, rows: 5,
    cols: [
      { key: "rate",   label: "Rate",        x: 1,   w: 16, align: "c" },
      { key: "desc",   label: "Description", x: 18,  w: 26, align: "l", wrap: true },
      { key: "weight", label: "Weight",      x: 45,  w: 13, align: "c" },
      { key: "bags",   label: "Bags",        x: 58,  w: 14, align: "c" },
      { key: "credit", label: "Amount",      x: 120, w: 28, align: "r" },
    ],
    fields: [
      { key: "farmer_name",  label: "Farmer name",  x: 18,  y: 38,    w: 70, align: "l", bold: true },
      { key: "town",         label: "Town",         x: 18,  y: 50,    w: 70, align: "l" },
      { key: "bill_no",      label: "Bill No",      x: 104, y: 47,    w: 40, align: "r" },
      { key: "bill_date",    label: "Date",         x: 104, y: 53,    w: 40, align: "r" },
      { key: "exp_cooli",    label: "Coolie",       x: 20,  y: 110,   w: 23, align: "r" },
      { key: "exp_freight",  label: "Freight",      x: 20,  y: 116.6, w: 23, align: "r" },
      { key: "exp_sakku",    label: "Rokkam",       x: 20,  y: 123.2, w: 23, align: "r" },
      { key: "exp_comm",     label: "Commission",   x: 20,  y: 129.8, w: 23, align: "r" },
      { key: "debit_total",  label: "Debit total",  x: 69,  y: 137.4, w: 24, align: "r" },
      { key: "credit_gross", label: "Gross amount", x: 120, y: 137.4, w: 28, align: "r" },
      // Net payable — bold and one size larger so the farmer can read it at a glance.
      { key: "net",          label: "Net payable",  x: 116, y: 144.5, w: 32, align: "r", bold: true, size: 15 },
    ],
    // Subtraction lines bracketing the gross/deductions row, with the result (Net) below.
    lines: [
      { x: 64, y: 135.6, w: 84 },   // above the deductions/gross row
      { x: 64, y: 142.6, w: 84 },   // below it — the "= Net" rule
    ],
  },
};

// Merge a saved pre-print config over the defaults (by key for cols/fields).
export function getPreprint(tpl, paper) {
  const d = DEFAULT_PREPRINT[paper];
  const saved = tpl && tpl.preprint && tpl.preprint[paper];
  if (!saved) return d;
  const mergeArr = (defs, sv) => defs.map(def => ({ ...def, ...((sv || []).find(s => s.key === def.key) || {}) }));
  // Lines have no key — use the saved set once the user has positioned any, else the defaults.
  const lines = Array.isArray(saved.lines) ? saved.lines : (d.lines || []);
  return { ...d, ...saved, paper: d.paper, lines, cols: mergeArr(d.cols, saved.cols), fields: mergeArr(d.fields, saved.fields) };
}

// Render a values-only pre-print overlay from a config: fixed-size page, every value
// absolutely placed so it lands inside the pre-printed boxes (one page, never overflows).
//   colVal[col.key](item) -> the value for that column on a given item row
//   fieldVal[field.key]()  -> the value for a one-off field
// showFields=false renders ONLY the item rows (no totals/lines) — used for continuation
// sheets when a bill has more items than fit before the totals. footerNote prints a small
// "continued" marker in the bottom-right of those non-final sheets.
export function PreprintRender({ cfg, className, items = [], colVal = {}, fieldVal = {}, showFields = true, footerNote }) {
  const al = a => (a === "r" ? "right" : a === "c" ? "center" : "left");
  // A field/col may set `size` (font pt), `bold`, and `wrap` (let long text flow onto more
  // lines instead of being clipped to one — e.g. a long list of per-bag weights).
  const Cell = ({ x, y, w, align, bold, size, wrap, children }) => (
    <div style={{ position: "absolute", left: `${x}mm`, top: `${y}mm`, width: `${w}mm`,
      textAlign: al(align), fontWeight: bold ? 700 : 400, lineHeight: 1.05,
      whiteSpace: wrap ? "normal" : "nowrap", overflow: wrap ? "visible" : "hidden",
      ...(size ? { fontSize: `${size}pt` } : {}) }}>
      {children}
    </div>
  );
  return (
    <div className={className} style={{ position: "relative", width: `${cfg.paper.w}mm`, height: `${cfg.paper.h}mm`,
      overflow: "hidden", fontSize: `${cfg.font}pt`, color: "#000", boxSizing: "border-box", background: "#fff",
      fontFamily: "'Noto Sans Tamil', Inter, system-ui, sans-serif" }}>
      {/* Horizontal rules (e.g. the subtraction lines around gross/deductions) — final sheet only. */}
      {showFields && (cfg.lines || []).map((ln, i) => (
        <div key={`ln-${i}`} style={{ position: "absolute", left: `${ln.x}mm`, top: `${ln.y}mm`,
          width: `${ln.w}mm`, borderTop: `${ln.thickness || 0.4}mm solid #000` }} />
      ))}
      {items.map((it, i) => cfg.cols.map(c => (
        <Cell key={`${i}-${c.key}`} x={c.x} y={cfg.items_top + i * cfg.row} w={c.w} align={c.align} wrap={c.wrap}>
          {colVal[c.key] ? colVal[c.key](it) : ""}
        </Cell>
      )))}
      {showFields && cfg.fields.map(f => (
        <Cell key={f.key} x={f.x} y={f.y} w={f.w} align={f.align} bold={f.bold} size={f.size} wrap={f.wrap}>
          {fieldVal[f.key] ? fieldVal[f.key]() : ""}
        </Cell>
      ))}
      {footerNote && (
        <div style={{ position: "absolute", right: "6mm", bottom: "5mm", fontSize: "9pt", fontStyle: "italic" }}>{footerNote}</div>
      )}
    </div>
  );
}

// ---- Business rules (coolie slabs, freight rate, commission, credit days; admin-editable) ----
export const DEFAULT_RULES = {
  commission_pct: 10, credit_days: 14, freight_per_kg: 0.5,
  coolie_bag_zero: 5, coolie_bag_small: 3, coolie_bag_large: 5, coolie_small_max: 30,
};
let _rulesCache = null;
export async function getBusinessRules() {
  if (_rulesCache) return _rulesCache;
  try { const r = await api("settings?action=rules"); _rulesCache = { ...DEFAULT_RULES, ...r.data }; }
  catch { _rulesCache = { ...DEFAULT_RULES }; }
  return _rulesCache;
}
export function clearBusinessRulesCache() { _rulesCache = null; }

// ---- App / brand logo (sidebar + login), cached; falls back to the leaf ----
let _appLogoCache = undefined;          // undefined = not loaded; string = data URL or ""
const _appLogoSubs = new Set();         // mounted <BrandLogo> instances, for live refresh
export async function getAppLogo() {
  if (_appLogoCache !== undefined) return _appLogoCache;
  try { const r = await api("settings?action=app-logo"); _appLogoCache = r.data?.logo || ""; }
  catch { _appLogoCache = ""; }
  return _appLogoCache;
}
export function setAppLogoCache(v) { _appLogoCache = v || ""; _appLogoSubs.forEach(fn => fn(_appLogoCache)); }

// Renders the uploaded brand logo if set, else the 🌿 fallback. Updates live on save.
export function BrandLogo({ size = 28, fallback = "🌿", round = false, style = {} }) {
  const [logo, setLogo] = useState(_appLogoCache || "");
  useEffect(() => {
    let alive = true;
    getAppLogo().then(v => { if (alive) setLogo(v); });
    const sub = (v) => setLogo(v);
    _appLogoSubs.add(sub);
    return () => { alive = false; _appLogoSubs.delete(sub); };
  }, []);
  if (logo) return <img src={logo} alt="logo" style={{ width: size, height: size, objectFit: "contain", borderRadius: round ? "50%" : 6, ...style }} />;
  return <span style={{ fontSize: size, lineHeight: 1, ...style }}>{fallback}</span>;
}

// ---- API Helper ----
export async function api(endpoint, options = {}) {
  const token = sessionStorage.getItem("rsm_token");
  // Convert "auth?action=login" → "auth.php?action=login"
  const parts = endpoint.split("?");
  const file  = parts[0].split("/")[0];
  const rest  = parts[0].split("/").slice(1).join("/");
  const query = parts[1] ? "?" + parts[1] : "";
  const url   = `${API_BASE}/${file}.php${rest ? "/" + rest : ""}${query}`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...options,
    });
  } catch (e) {
    // Network down / server unreachable — give a clear, non-cryptic message
    throw new Error("Can't reach the server — check your internet and try again.");
  }
  // Session died on the server (expired/revoked). Only treat as a session
  // expiry if we were actually logged in; on the login screen a 401 is just
  // "wrong password" and should fall through to the real error message.
  if (res.status === 401 && token) {
    sessionStorage.removeItem("rsm_token");
    sessionStorage.removeItem("rsm_user");
    sessionStorage.setItem("rsm_session_notice", "Your session ended. Please log in again to continue.");
    window.dispatchEvent(new CustomEvent("rsm-session-expired"));
    throw new Error("Session expired. Please log in again.");
  }
  let data;
  try { data = await res.json(); }
  catch { throw new Error(res.ok ? "Unexpected response from the server." : `Server error (${res.status}). Please try again.`); }
  if (!data.success) throw new Error(data.error || "Request failed");
  return data;
}

// ---- Cached GET helper (for big, rarely-changing lists like parties/products) ----
// Caches the resolved promise per endpoint for `ttl` ms so repeated page mounts
// don't re-pull thousands of rows. Use clearApiCache() after any write.
const _apiCache = new Map();   // key -> { ts, promise }
export function apiCached(endpoint, ttl = 300000) {
  const hit = _apiCache.get(endpoint);
  if (hit && (Date.now() - hit.ts) < ttl) return hit.promise;
  const promise = api(endpoint).catch(e => { _apiCache.delete(endpoint); throw e; });
  _apiCache.set(endpoint, { ts: Date.now(), promise });
  return promise;
}
// Drop cached lists. Pass a substring to clear matching keys, or nothing to clear all.
export function clearApiCache(match) {
  if (!match) { _apiCache.clear(); return; }
  for (const k of _apiCache.keys()) if (k.includes(match)) _apiCache.delete(k);
}

// ---- One-shot prefetch (for first-paint speed) ----
// Fire a fetch in the background (e.g. right after login) so the page that
// needs it later finds the answer already in flight. Consumed once by the
// page on first mount, so it never serves stale data after a write.
const _prefetch = new Map();   // url -> { ts, promise }
export function prefetch(endpoint) {
  if (_prefetch.has(endpoint)) return;
  _prefetch.set(endpoint, { ts: Date.now(), promise: api(endpoint).catch(() => null) });
}
// Returns the in-flight promise (resolving to the API result, or null on
// error/too-old) and removes it so it's used at most once.
export function takePrefetch(endpoint, maxAge = 30000) {
  const hit = _prefetch.get(endpoint);
  if (!hit) return null;
  _prefetch.delete(endpoint);
  if (Date.now() - hit.ts > maxAge) return null;
  return hit.promise;
}

// Warm the lists most pages open with, so the first click feels instant.
// apiCached entries stay warm for 5 min; the one-shot prefetches cover the
// two heaviest first screens (Farmers list + today's Day Book).
export function warmUpAfterLogin() {
  // Lists reused by forms, dropdowns and reports across the app
  ["products?action=list",
   "parties?action=list&category=TRUCK&cols=lite",
   "parties?action=list&category=FARMER&cols=lite",
   "parties?action=list&category=SUPPLIER&cols=lite",
   "parties?action=list&category=CUSTOMER&cols=lite",
  ].forEach(u => { try { apiCached(u); } catch {} });
  // Heavy first screens
  prefetch(`parties?action=list&active=all&cats=FARMER,SUPPLIER,MARKET_SUPPLIER,MARKET_VENDOR&limit=100&offset=0`);
  prefetch(`tally?action=daybook&date=${getWorkingDate()}`);
}

// ---- Working/business date (Day Lock) ----
// The day new bills/expenses/yard entries are filed under. Set in the Day bar;
// entry forms read it at mount so back-dated entries default to the chosen day.
// Mirrors the server-side app_settings 'business_date'.
const _todayStr = () => new Date().toISOString().split("T")[0];
let _workingDate = localStorage.getItem("rsm_working_date") || _todayStr();
export function getWorkingDate() { return _workingDate; }
export function setWorkingDateLocal(d) {
  _workingDate = d;
  localStorage.setItem("rsm_working_date", d);
  // let any open form sync immediately
  window.dispatchEvent(new CustomEvent("rsm-working-date", { detail: d }));
}

// ---- Format helpers ----
export const fmt = {
  currency: (v) => `₹${Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
  weight:   (v) => `${Number(v || 0).toFixed(2)} kg`,
  date:     (v) => v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-",
  dateISO:  (v) => v ? new Date(v).toISOString().split("T")[0] : "",
  pct:      (v) => `${Number(v || 0).toFixed(2)}%`,
};

// ---- Bill PDF share (WhatsApp) ----
// Renders the first .sbill/.pbill element as a full-A5 PDF and shares it.
// Mobile: native share sheet opens → user picks WhatsApp to send the PDF directly.
// Desktop: downloads the PDF; also opens wa.me if the party has a phone number.
export async function shareBillAsPdf(selector, billNo, phone) {
  const el = document.querySelector(selector);
  if (!el) { alert('Bill not found — make sure the print preview is open.'); return; }
  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);

    // Capture bill at 2× resolution so the PDF text is sharp on retina screens
    const canvas = await html2canvas(el, {
      scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false,
      onclone: (doc) => { doc.querySelectorAll('.no-print').forEach(n => n.remove()); },
    });

    // A5 page in mm (148 × 210). Scale canvas to fit width, preserving aspect ratio.
    const A5_W = 148, A5_H = 210;
    const imgW = canvas.width, imgH = canvas.height;
    const ratio = imgH / imgW;
    const pdfW = A5_W;
    const pdfH = Math.min(pdfW * ratio, A5_H);

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pdfW, pdfH);

    const fileName = `bill-${billNo || 'copy'}.pdf`;
    const pdfBlob = pdf.output('blob');
    const file = new File([pdfBlob], fileName, { type: 'application/pdf' });

    if (navigator.canShare?.({ files: [file] })) {
      // Mobile: share sheet opens — user picks WhatsApp
      await navigator.share({ files: [file], title: `Bill ${billNo || ''}` });
    } else {
      // Desktop: download PDF; open wa.me so user can attach it in WhatsApp Web
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      if (phone) {
        const clean = String(phone).replace(/\D/g, '');
        const num = clean.startsWith('91') && clean.length === 12 ? clean : '91' + clean.slice(-10);
        window.open(`https://wa.me/${num}`, '_blank');
      } else {
        alert('PDF downloaded — attach it in WhatsApp.');
      }
    }
  } catch (e) { alert('Could not generate PDF: ' + e.message); }
}

// ---- Login Page ----
function LoginPage({ onLogin, onBack }) {
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  // Show a friendly notice if we landed here because the session expired.
  useEffect(() => {
    const n = sessionStorage.getItem("rsm_session_notice");
    if (n) { setNotice(n); sessionStorage.removeItem("rsm_session_notice"); }
  }, []);

  const handleSubmit = async () => {
    if (!form.username || !form.password) { setError("Enter username and password"); return; }
    setLoading(true); setError(""); setNotice("");
    try {
      const data = await api("auth?action=login", {
        method: "POST",
        body: JSON.stringify(form),
      });
      sessionStorage.setItem("rsm_token", data.data.token);
      sessionStorage.setItem("rsm_user", JSON.stringify(data.data.user));
      warmUpAfterLogin();
      onLogin(data.data.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", background: "linear-gradient(135deg, #0f4c2a 0%, #1a7a45 50%, #0d3d22 100%)",
      display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif"
    }}>
      <div style={{
        background: "white", borderRadius: 16, padding: "48px 40px", width: 380,
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)"
      }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 64, height: 64, borderRadius: "50%",
            background: "linear-gradient(135deg, #1a7a45, #0f4c2a)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 28, color: "white", marginBottom: 16, overflow: "hidden"
          }}><BrandLogo size={40} round /></div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#0f4c2a" }}>Sri Murugan and Co</h1>
          <p style={{ margin: "4px 0 0", color: "#666", fontSize: 13 }}>Powered for Oddanchatram Market</p>
          <p style={{ margin: "2px 0 0", color: "#888", fontSize: 12 }}>காய்கறி கமிஷன் மண்டி</p>
        </div>

        {notice && !error && (
          <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8,
                        padding: "10px 14px", color: "#92400e", fontSize: 13, marginBottom: 20 }}>
            {notice}
          </div>
        )}

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8,
                        padding: "10px 14px", color: "#dc2626", fontSize: 13, marginBottom: 20 }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
            USERNAME
          </label>
          <input
            style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid #d1d5db",
                     fontSize: 14, boxSizing: "border-box", outline: "none" }}
            value={form.username}
            onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
            onKeyDown={e => e.key === "Enter" && handleSubmit()}
            placeholder="Enter username"
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
            PASSWORD
          </label>
          <input
            type="password"
            style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid #d1d5db",
                     fontSize: 14, boxSizing: "border-box", outline: "none" }}
            value={form.password}
            onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
            onKeyDown={e => e.key === "Enter" && handleSubmit()}
            placeholder="Enter password"
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{
            width: "100%", padding: "12px", borderRadius: 8, border: "none",
            background: loading ? "#6b7280" : "linear-gradient(135deg, #1a7a45, #0f4c2a)",
            color: "white", fontSize: 15, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer"
          }}
        >
          {loading ? "Signing in..." : "Sign In / உள்நுழைக"}
        </button>

        {onBack && (
          <button onClick={onBack}
            style={{ width: "100%", marginTop: 14, background: "none", border: "none", color: "#6b7280",
                     fontSize: 13, cursor: "pointer" }}>
            ← Back to home
          </button>
        )}
      </div>
    </div>
  );
}

// The app (this bundle) shows the login screen when logged out. The public marketing
// homepage is a SEPARATE bundle at / — "← Back to home" just navigates there. This keeps
// the heavy, frequently-edited homepage entirely out of the login/app bundle.
function PublicGate({ onLogin }) {
  return <LoginPage onLogin={onLogin} onBack={() => { window.location.href = "/"; }} />;
}

// ---- Sidebar Navigation ----
const NAV = [
  { id: "tally",      label: "Day Book",        labelTa: "நாள் கணக்கு",  icon: "📒" },
  { id: "dashboard",  label: "Dashboard",      labelTa: "டாஷ்போர்டு",  icon: "📊" },
  { id: "yard",       label: "Yard Entry",      labelTa: "முற்றம் பதிவு", icon: "📦" },
  { id: "purchase",   label: "Farmer Purchase", labelTa: "விவசாயி கொள்முதல்", icon: "🛒" },
  { id: "supplier",   label: "Supplier Purchase", labelTa: "சப்ளையர் கொள்முதல்", icon: "🚚" },
  { id: "market",     label: "Market Purchase", labelTa: "சந்தை கொள்முதல்", icon: "🏪" },
  { id: "sales",      label: "Sales",           labelTa: "விற்பனை",      icon: "🧾" },
  { id: "orders",     label: "Orders",          labelTa: "ஆர்டர்கள்",    icon: "📞" },
  { id: "payments",   label: "Payments",        labelTa: "கட்டணங்கள்",   icon: "💰" },
  { id: "parties",    label: "Parties",         labelTa: "பார்ட்டிகள்",  icon: "👥" },
  { id: "products",   label: "Products",        labelTa: "பொருட்கள்",    icon: "🥬" },
  { id: "expenses",   label: "Expenses",        labelTa: "செலவுகள்",     icon: "📋" },
  { id: "reports",    label: "Reports",         labelTa: "அறிக்கைகள்",  icon: "📈" },
  { id: "print",      label: "Print",           labelTa: "அச்சு",        icon: "🖨️" },
];

function Sidebar({ active, onNav, user, onLogout, open, collapsed, onToggle, onClose }) {
  const isAdmin = user?.role === "admin";
  const perms = Array.isArray(user?.permissions) ? user.permissions : [];
  // Admin sees everything; others see only their permitted modules
  const visible = isAdmin ? NAV : NAV.filter(item => perms.includes(item.id));
  const items = isAdmin ? [...visible,
    { id: "website", label: "Website", labelTa: "வலைதளம்", icon: "🌐" },
    { id: "audit", label: "Audit Log", labelTa: "தணிக்கை", icon: "🔍" },
    { id: "users", label: "Users / Admin", labelTa: "பயனர்கள்", icon: "👤" }] : visible;
  return (
    <div className={"app-sidebar" + (open ? " open" : "") + (collapsed ? " collapsed" : "")} style={{
      width: collapsed ? 64 : 220, height: "100vh", position: "fixed",
      background: "linear-gradient(180deg, #14583a 0%, #0f4c2a 55%, #0c3f23 100%)",
      boxShadow: "2px 0 12px rgba(0,0,0,0.12)",
      left: 0, top: 0, display: "flex", flexDirection: "column", zIndex: 100,
      fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif"
    }}>
      {/* Header — hamburger toggles collapse; brand text hides when collapsed.
          Hidden on phones (the mobile top bar carries the brand + toggle instead). */}
      <div className="app-sidebar-head" style={{ padding: collapsed ? "16px 0" : "20px 16px", borderBottom: "1px solid rgba(255,255,255,0.1)",
                    display: "flex", alignItems: "center", gap: 10, justifyContent: collapsed ? "center" : "flex-start" }}>
        <button className="app-nav-toggle" onClick={onToggle} aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          title={collapsed ? "Expand menu" : "Collapse menu"}
          style={{ background: "none", border: "none", color: "white", fontSize: 22, cursor: "pointer", padding: 4, lineHeight: 1, flexShrink: 0 }}>☰</button>
        {!collapsed && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <BrandLogo size={26} />
            <div className="nav-label">
              <div style={{ color: "white", fontWeight: 700, fontSize: 15 }}>Sri Murugan and Co</div>
              <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}>Powered for Oddanchatram Market</div>
            </div>
          </div>
        )}
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, padding: "12px 8px", overflowY: "auto", overflowX: "hidden" }}>
        {items.map(item => (
          <button
            key={item.id}
            className={"nav-btn" + (active === item.id ? " active" : "")}
            onClick={() => onNav(item.id)}
            title={collapsed ? `${item.label} / ${item.labelTa}` : undefined}
            style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%",
              padding: "10px 12px", borderRadius: 8, border: "none", cursor: "pointer",
              fontSize: 13, fontWeight: active === item.id ? 600 : 400,
              textAlign: "left", marginBottom: 2
            }}
          >
            <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
            <div className="nav-label">
              <div>{item.label}</div>
              <div style={{ fontSize: 10, opacity: 0.7 }}>{item.labelTa}</div>
            </div>
          </button>
        ))}
      </nav>

      {/* User & logout */}
      <div style={{ padding: collapsed ? "12px 8px" : "12px 16px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
        <div className="nav-label" style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, marginBottom: 8 }}>
          👤 {user?.full_name || user?.username}
        </div>
        <button
          onClick={onLogout}
          className="nav-btn"
          title="Logout / வெளியேறு"
          style={{
            width: "100%", padding: "8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)",
            background: "transparent", color: "rgba(255,255,255,0.7)", fontSize: 12, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6
          }}
        >
          <span>⎋</span><span className="nav-label">Logout / வெளியேறு</span>
        </button>
      </div>
    </div>
  );
}

// ---- Main App Shell ----
// ---- Day bar: working date + day lock (shown on every page) ----
function DayBar({ user }) {
  const [status, setStatus] = useState(null);   // { today, business_date, business_locked, locked_dates }
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState("");
  const isAdmin = user?.role === "admin";

  const load = () =>
    api("daylock?action=status")
      .then(r => {
        setStatus(r.data);
        if (r.data?.business_date) setWorkingDateLocal(r.data.business_date);
      })
      .catch(e => setErr(e.message));

  useEffect(() => { load(); }, []);

  if (!status) return null;
  const { today, business_date, business_locked, locked_dates = [] } = status;
  const isToday = business_date === today;

  const changeDate = async (d) => {
    if (!d || d === business_date) return;
    setBusy(true); setErr("");
    try {
      await api("daylock?action=set-business-date", { method: "POST", body: JSON.stringify({ date: d }) });
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const lockDay = async () => {
    if (!window.confirm(`Lock ${business_date}?\n\nOnce locked, no bills, payments or expenses dated ${business_date} can be created or changed until an admin unlocks it.`)) return;
    setBusy(true); setErr("");
    try {
      await api("daylock?action=lock", { method: "POST", body: JSON.stringify({ date: business_date }) });
      // Move on to today (if it's open) so the team starts the current day
      if (today !== business_date && !locked_dates.includes(today)) {
        await api("daylock?action=set-business-date", { method: "POST", body: JSON.stringify({ date: today }) });
      }
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const unlockDay = async () => {
    if (!window.confirm(`Unlock ${business_date}?\n\nThis re-opens the day so bills can be back-dated or corrected. The unlock is recorded in the audit log.`)) return;
    setBusy(true); setErr("");
    try {
      await api("daylock?action=unlock", { method: "POST", body: JSON.stringify({ date: business_date }) });
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const wrap = {
    display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
    padding: "8px 16px", borderBottom: "1px solid #e5e7eb",
    background: business_locked ? "#fef2f2" : (isToday ? "#f0fdf4" : "#fffbeb"),
    fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif", fontSize: 13,
  };
  const pill = (bg, color) => ({
    display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px",
    borderRadius: 999, background: bg, color, fontWeight: 700, fontSize: 12,
  });

  return (
    <div style={wrap}>
      <span style={{ fontWeight: 700, color: "#374151" }}>Working date</span>
      <input
        type="date"
        value={business_date}
        max={today}
        disabled={busy}
        onChange={e => changeDate(e.target.value)}
        style={{ padding: "5px 8px", borderRadius: 7, border: "1px solid #cbd5e1", fontSize: 13, fontWeight: 600 }}
      />
      {!isToday && (
        <span style={pill("#fef3c7", "#92400e")}>⏮ Back-dated · not today ({today})</span>
      )}
      {business_locked
        ? <span style={pill("#fee2e2", "#b91c1c")}>🔒 Locked</span>
        : <span style={pill("#dcfce7", "#15803d")}>🟢 Open</span>}

      <span style={{ flex: 1 }} />

      <TextSizeControl />

      {business_locked
        ? (isAdmin
            ? <button onClick={unlockDay} disabled={busy}
                style={{ padding: "6px 14px", borderRadius: 7, border: "1px solid #fca5a5", background: "white",
                         color: "#b91c1c", fontWeight: 700, fontSize: 13, cursor: busy ? "wait" : "pointer" }}>
                🔓 Unlock this day
              </button>
            : <span style={{ color: "#b91c1c", fontSize: 12 }}>Ask an admin to unlock</span>)
        : <button onClick={lockDay} disabled={busy}
            style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: busy ? "#9ca3af" : "#1a7a45",
                     color: "white", fontWeight: 700, fontSize: 13, cursor: busy ? "wait" : "pointer" }}>
            🔒 Lock {isToday ? "today" : "this day"} & close
          </button>}

      {err && <span style={{ color: "#dc2626", fontSize: 12, width: "100%" }}>{err}</span>}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("dashboard");
  const [ready, setReady] = useState(false);
  const navGuardRef = useRef(null);
  const [navModal, setNavModal] = useState(null);  // target page awaiting confirm
  const [navBusy, setNavBusy]   = useState(false);
  const [mobileNav, setMobileNav] = useState(false); // mobile drawer open
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem("rsm_nav_collapsed") === "1"); // desktop icon-rail
  const toggleNav = () => setNavCollapsed(v => { const n = !v; localStorage.setItem("rsm_nav_collapsed", n ? "1" : "0"); return n; });

  // Intercept navigation when the active page has unsaved changes
  const requestNav = (target) => {
    setMobileNav(false);
    if (target === page) return;
    const g = navGuardRef.current;
    if (g && g.isDirty && g.isDirty()) setNavModal(target);
    else setPage(target);
  };
  const navSaveAndLeave = async () => {
    const g = navGuardRef.current;
    const target = navModal;
    setNavBusy(true);
    try {
      const ok = g?.save ? await g.save() : true;
      if (ok !== false) { setNavModal(null); setPage(target); }
    } catch { /* save() surfaces its own error */ }
    finally { setNavBusy(false); }
  };
  const navDiscardAndLeave = () => { const t = navModal; setNavModal(null); setPage(t); };

  useEffect(() => {
    const token = sessionStorage.getItem("rsm_token");
    const stored = sessionStorage.getItem("rsm_user");
    if (token && stored) {
      try { setUser(JSON.parse(stored)); warmUpAfterLogin(); } catch {}
    }
    setReady(true);
  }, []);

  // If any request finds the session dead (401), drop straight to the login
  // screen instead of leaving clicks silently failing.
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener("rsm-session-expired", onExpired);
    return () => window.removeEventListener("rsm-session-expired", onExpired);
  }, []);

  const handleLogout = () => {
    const token = sessionStorage.getItem("rsm_token");
    if (token) api("auth?action=logout", { method: "POST" }).catch(() => {});
    sessionStorage.removeItem("rsm_token");
    sessionStorage.removeItem("rsm_user");
    setUser(null);
  };

  // For restricted (non-admin) users, land on / stay within an allowed module
  useEffect(() => {
    if (!user || user.role === "admin") return;
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    if (!perms.includes(page)) setPage(perms[0] || "dashboard");
  }, [user, page]);

  // Auto-logout after 60 minutes of inactivity
  useEffect(() => {
    if (!user) return;
    let timer;
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => { alert("Logged out after 60 minutes of inactivity."); handleLogout(); }, 60 * 60 * 1000); };
    const evts = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    evts.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => { clearTimeout(timer); evts.forEach(e => window.removeEventListener(e, reset)); };
  }, [user]);

  if (!ready) return null;
  if (!user) return <PublicGate onLogin={setUser} />;

  return (
    <AuthContext.Provider value={user}>
      <NavGuardContext.Provider value={navGuardRef}>
        <div className="app-shell" style={{ display: "flex", minHeight: "100vh", background: "#f5f5f5", fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif", zoom: getUiScale() / 100 }}>
          {/* Mobile top bar — tap the brand/logo to open or close the menu */}
          <div className="app-topbar" role="button" aria-label={mobileNav ? "Close menu" : "Open menu"}
               onClick={() => setMobileNav(v => !v)} style={{ cursor: "pointer" }}>
            <BrandLogo size={26} />
            <span style={{ color: "white", fontWeight: 700, fontSize: 15 }}>Sri Murugan and Co</span>
            <span style={{ marginLeft: "auto", color: "rgba(255,255,255,0.9)", fontSize: 20, lineHeight: 1 }}>
              {mobileNav ? "✕" : "☰"}
            </span>
          </div>
          {mobileNav && <div className="app-overlay open" onClick={() => setMobileNav(false)} />}
          <Sidebar active={page} onNav={(id) => { setMobileNav(false); requestNav(id); }} user={user} onLogout={handleLogout} open={mobileNav} collapsed={navCollapsed} onToggle={toggleNav} onClose={() => setMobileNav(false)} />
          <main className="app-main" style={{ marginLeft: navCollapsed ? 64 : 220, flex: 1, minHeight: "100vh", overflow: "auto" }}>
            <DayBar user={user} />
            <PageRouter page={page} setPage={requestNav} />
          </main>
        </div>
        {navModal && (
          <UnsavedChangesModal
            busy={navBusy}
            onSave={navSaveAndLeave}
            onDiscard={navDiscardAndLeave}
            onCancel={() => setNavModal(null)}
          />
        )}
      </NavGuardContext.Provider>
    </AuthContext.Provider>
  );
}

// ---- Unsaved changes prompt ----
function UnsavedChangesModal({ busy, onSave, onDiscard, onCancel }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000,
                  display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif" }}>
      <div style={{ background: "white", borderRadius: 14, padding: 24, width: 420, maxWidth: "90vw", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#111", marginBottom: 6 }}>Unsaved changes</div>
        <div style={{ fontSize: 14, color: "#4b5563", marginBottom: 20, lineHeight: 1.5 }}>
          You have an entry in progress. Save it before leaving, or discard your changes?
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel} disabled={busy}
            style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid #d1d5db", background: "white",
                     color: "#374151", fontSize: 14, cursor: busy ? "not-allowed" : "pointer" }}>
            Cancel
          </button>
          <button onClick={onDiscard} disabled={busy}
            style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid #fecaca", background: "#fef2f2",
                     color: "#dc2626", fontSize: 14, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer" }}>
            Discard & Leave
          </button>
          <button onClick={onSave} disabled={busy}
            style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: busy ? "#9ca3af" : "#1a7a45",
                     color: "white", fontSize: 14, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer" }}>
            {busy ? "Saving..." : "Save & Leave"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Page Router ----
function PageRouter({ page, setPage }) {
  const pages = {
    dashboard: <DashboardPage setPage={setPage} />,
    rates:     <RatesPage />,
    yard:      <YardEntryPage />,
    purchase:  <QuickPurchasePage />,
    supplier:  <SupplierPurchasePage />,
    sales:     <QuickSalesPage />,
    payments:  <PaymentsPage />,
    market:    <MarketPage />,
    orders:    <OrdersPage />,
    parties:   <PartiesPage />,
    products:  <ProductsPage />,
    print:     <PrintCenterPage />,
    tally:     <TallyPage />,
    expenses:  <ExpensesPage />,
    reports:   <ReportsPage />,
    users:     <UsersAdminPage />,
    audit:     <AuditLogPage />,
    website:   <WebsitePage />,
  };
  return pages[page] || pages.dashboard;
}

// ---- Dashboard Page ----
function DashboardPage({ setPage }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(getWorkingDate());

  useEffect(() => {
    setLoading(true);
    api(`reports?action=dashboard&date=${date}`).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, [date]);

  const todayStr = new Date().toISOString().split("T")[0];
  const isToday  = date === todayStr;
  const shiftDay = (n) => { const d = new Date(date + "T00:00:00"); d.setDate(d.getDate() + n); setDate(d.toISOString().split("T")[0]); };
  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const dayWord = isToday ? "Today" : "That day";

  if (loading && !data) return <PageLoader />;

  const t = data?.today || {};
  const o = data?.outstanding || {};

  const cards = [
    { label: "Purchase",         labelTa: "கொள்முதல்", value: fmt.currency(t.purchase?.paid), icon: "🛒", color: "#1a7a45", sub: `${t.purchase?.bills || 0} bills` },
    { label: "Sales",            labelTa: "விற்பனை",   value: fmt.currency(t.sales?.amount),  icon: "🧾", color: "#2563eb", sub: `${t.sales?.bills || 0} bills` },
    { label: "Commission Earned",labelTa: "கமிஷன்",    value: fmt.currency(t.purchase?.commission), icon: "💹", color: "#7c3aed", sub: dayWord },
    { label: "Receipts",         labelTa: "ரசீது",     value: fmt.currency(t.receipts?.amount),icon: "💰", color: "#d97706", sub: "Cash collected" },
    { label: "Total Outstanding",labelTa: "மொத்த நிலுவை", value: fmt.currency(o.total_due),    icon: "⚠️", color: "#dc2626", sub: `${o.total_vendors || 0} vendors · now` },
    { label: "Overdue Amount",   labelTa: "தாமதமான தொகை", value: fmt.currency(o.overdue_amt),  icon: "🔴", color: "#991b1b", sub: `${o.severely_overdue || 0} severely overdue` },
  ];

  const dashNavBtn = { width: 30, height: 30, borderRadius: 8, border: "1px solid #d1d5db", background: "white", cursor: "pointer", fontSize: 13, color: "#374151", display: "inline-flex", alignItems: "center", justifyContent: "center" };

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#111" }}>Dashboard <span style={{ fontSize: 14, color: "#666" }}>டாஷ்போர்டு</span></h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <button onClick={() => shiftDay(-1)} title="Previous day" style={dashNavBtn}>◀</button>
            <input type="date" value={date} max={todayStr} onChange={e => e.target.value && setDate(e.target.value)}
              style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "5px 8px", fontSize: 13, fontFamily: "inherit" }} />
            <button onClick={() => shiftDay(1)} disabled={isToday} title="Next day"
              style={{ ...dashNavBtn, opacity: isToday ? 0.4 : 1, cursor: isToday ? "default" : "pointer" }}>▶</button>
            {!isToday && <button onClick={() => setDate(todayStr)} style={{ ...dashNavBtn, width: "auto", padding: "5px 12px", fontWeight: 600 }}>Today</button>}
            <span style={{ color: "#666", fontSize: 13, marginLeft: 4 }}>{dateLabel}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <ActionBtn icon="💹" label="Set Rates" onClick={() => setPage("rates")} />
          <ActionBtn icon="🛒" label="Purchase" onClick={() => setPage("purchase")} />
          <ActionBtn icon="🧾" label="Sales" onClick={() => setPage("sales")} />
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
        {cards.map((c, i) => (
          <div key={i} style={{
            background: "white", borderRadius: 12, padding: "20px",
            boxShadow: "0 1px 4px rgba(0,0,0,0.08)", borderLeft: `4px solid ${c.color}`
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 12, color: "#666", fontWeight: 500 }}>{c.label}</div>
                <div style={{ fontSize: 10, color: "#999" }}>{c.labelTa}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: c.color, marginTop: 8 }}>{c.value}</div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{c.sub}</div>
              </div>
              <span style={{ fontSize: 28 }}>{c.icon}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Top Overdue */}
        <div style={{ background: "white", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, color: "#dc2626" }}>⚠️ Top Overdue Vendors <span style={{ fontSize: 11, color: "#999" }}>தாமதமான வாடிக்கையாளர்கள்</span></h3>
          {(data?.top_overdue || []).length === 0
            ? <p style={{ color: "#16a34a", fontSize: 13 }}>✅ No overdue payments!</p>
            : (data?.top_overdue || []).map((v, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                                    padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{v.vendor_name}</div>
                  <div style={{ fontSize: 11, color: "#ef4444" }}>{v.max_days_overdue} days overdue</div>
                </div>
                <div style={{ fontWeight: 700, color: "#dc2626", fontSize: 14 }}>{fmt.currency(v.total_due)}</div>
              </div>
            ))
          }
        </div>

        {/* Recent Bills */}
        <div style={{ background: "white", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, color: "#111" }}>🧾 Recent Sales Bills</h3>
          {(data?.recent_bills || []).map((b, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                                  padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{b.bill_no}</div>
                <div style={{ fontSize: 11, color: "#666" }}>{b.vendor_name} · {fmt.date(b.bill_date)}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{fmt.currency(b.net_amount)}</span>
                <StatusBadge status={b.payment_status} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- Daily Rates Page ----
function RatesPage() {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [products, setProducts] = useState([]);
  const [rates, setRates] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoading(true);
    api(`products?action=rates&date=${date}`)
      .then(r => {
        setProducts(r.data);
        const rmap = {};
        r.data.forEach(p => {
          rmap[p.product_id] = {
            market_rate: p.market_rate || "",
            min_rate:    p.min_rate    || "",
            max_rate:    p.max_rate    || "",
            notes:       p.notes      || "",
          };
        });
        setRates(rmap);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [date]);

  const setRate = (productId, field, value) => {
    setRates(prev => ({ ...prev, [productId]: { ...prev[productId], [field]: value } }));
  };

  const handleSave = async () => {
    setSaving(true); setSaved(false);
    const ratesList = Object.entries(rates)
      .filter(([_, v]) => v.market_rate !== "" && v.market_rate !== null)
      .map(([productId, v]) => ({ product_id: productId, ...v }));

    try {
      await api("products?action=rates", { method: "POST", body: JSON.stringify({ date, rates: ratesList }) });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const kgProducts  = products.filter(p => p.unit_type === "KG");
  const pcsProducts = products.filter(p => p.unit_type !== "KG");

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Daily Rates <span style={{ fontSize: 14, color: "#666" }}>தினசரி விலை</span></h1>
          <p style={{ margin: "4px 0 0", color: "#666", fontSize: 13 }}>Set today's market rates for all vegetables</p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14 }} />
          <button onClick={handleSave} disabled={saving}
            style={{ padding: "10px 24px", borderRadius: 8, border: "none",
                     background: saved ? "#16a34a" : "#1a7a45", color: "white",
                     fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            {saving ? "Saving..." : saved ? "✅ Saved!" : "Save Rates"}
          </button>
        </div>
      </div>

      {loading ? <PageLoader /> : (
        <>
          <RateTable title="Vegetables (Per KG)" products={kgProducts} rates={rates} setRate={setRate} />
          {pcsProducts.length > 0 && (
            <RateTable title="Bags & Packs (Per Piece)" products={pcsProducts} rates={rates} setRate={setRate} />
          )}
        </>
      )}
    </div>
  );
}

function RateTable({ title, products, rates, setRate }) {
  return (
    <div style={{ background: "white", borderRadius: 12, marginBottom: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#374151" }}>{title}</h3>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#f9fafb" }}>
            {["Product / பொருள்", "Market Rate ₹", "Min Rate ₹", "Max Rate ₹", "Notes"].map(h => (
              <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12,
                                   fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {products.map((p, i) => {
            const r = rates[p.product_id] || {};
            return (
              <tr key={p.product_id} style={{ background: i % 2 === 0 ? "white" : "#fafafa" }}>
                <td style={{ padding: "10px 16px", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name_en}</div>
                  <div style={{ fontSize: 11, color: "#888" }}>{p.name_ta} · {p.code}</div>
                </td>
                {["market_rate", "min_rate", "max_rate"].map(field => (
                  <td key={field} style={{ padding: "8px 12px", borderBottom: "1px solid #f3f4f6" }}>
                    <input
                      type="number" step="0.5" min="0"
                      value={r[field] || ""}
                      onChange={e => setRate(p.product_id, field, e.target.value)}
                      placeholder="0.00"
                      style={{ width: 90, padding: "6px 10px", borderRadius: 6,
                               border: "1px solid #d1d5db", fontSize: 13,
                               background: field === "market_rate" && r.market_rate ? "#f0fdf4" : "white" }}
                    />
                  </td>
                ))}
                <td style={{ padding: "8px 12px", borderBottom: "1px solid #f3f4f6" }}>
                  <input
                    value={r.notes || ""}
                    onChange={e => setRate(p.product_id, "notes", e.target.value)}
                    placeholder="Optional note"
                    style={{ width: 160, padding: "6px 10px", borderRadius: 6,
                             border: "1px solid #d1d5db", fontSize: 12 }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Shared Components ----
function PageLoader() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ marginBottom: 16 }}><BrandLogo size={40} /></div>
        <div style={{ color: "#666", fontSize: 14 }}>Loading...</div>
      </div>
    </div>
  );
}

function ComingSoon({ title, titleTa, icon }) {
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 700 }}>
        {icon} {title} <span style={{ fontSize: 14, color: "#666" }}>{titleTa}</span>
      </h1>
      <div style={{ background: "white", borderRadius: 12, padding: 40, textAlign: "center",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.08)", marginTop: 20 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div>
        <h2 style={{ color: "#1a7a45", margin: "0 0 8px" }}>{title}</h2>
        <p style={{ color: "#666" }}>This module is built in the backend. UI coming in next phase.</p>
      </div>
    </div>
  );
}

function ActionBtn({ icon, label, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "8px 16px", borderRadius: 8, border: "1px solid #1a7a45",
      background: "white", color: "#1a7a45", fontSize: 13, fontWeight: 600,
      cursor: "pointer", display: "flex", alignItems: "center", gap: 6
    }}>
      {icon} {label}
    </button>
  );
}

function StatusBadge({ status }) {
  const styles = {
    paid:    { bg: "#dcfce7", color: "#16a34a", label: "Paid" },
    unpaid:  { bg: "#fef9c3", color: "#ca8a04", label: "Unpaid" },
    partial: { bg: "#dbeafe", color: "#2563eb", label: "Partial" },
    overdue: { bg: "#fee2e2", color: "#dc2626", label: "Overdue" },
  };
  const s = styles[status] || styles.unpaid;
  return (
    <span style={{ background: s.bg, color: s.color, padding: "2px 8px",
                   borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
      {s.label}
    </span>
  );
}

