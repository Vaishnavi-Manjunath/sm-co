// ============================================================
//  Standalone helpers for the PUBLIC marketing homepage.
//  Deliberately self-contained — it must NOT import App.jsx, so the
//  marketing bundle stays tiny and a crash in the app can never affect
//  the homepage (and vice-versa). Talks only to the public endpoint.
// ============================================================
import { useState, useEffect } from "react";

const API_BASE = "/api";

// Minimal fetch wrapper (no auth token — the public page is logged-out).
export async function api(endpoint, options = {}) {
  const [path, qs] = endpoint.split("?");
  const res = await fetch(`${API_BASE}/${path}.php${qs ? "?" + qs : ""}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Request failed");
  return data;
}

// Brand logo from the public rates endpoint (contact.logo), else the leaf fallback.
let _logoPromise = null;
function publicLogo() {
  if (!_logoPromise) _logoPromise = api("public?action=rates").then(r => r.data?.contact?.logo || "").catch(() => "");
  return _logoPromise;
}
export function BrandLogo({ size = 28, fallback = "🌿", round = false, style = {} }) {
  const [logo, setLogo] = useState("");
  useEffect(() => { let alive = true; publicLogo().then(v => { if (alive) setLogo(v); }); return () => { alive = false; }; }, []);
  if (logo) return <img src={logo} alt="logo" style={{ width: size, height: size, objectFit: "contain", borderRadius: round ? "50%" : 6, ...style }} />;
  return <span style={{ fontSize: size, lineHeight: 1, ...style }}>{fallback}</span>;
}
