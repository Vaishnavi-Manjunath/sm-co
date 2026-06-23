import { useState, useEffect, useRef, useCallback } from "react";
import { api, BrandLogo } from "../public-lib.jsx";

// ============================================================
// PUBLIC HOMEPAGE — Sri Murugan & Co, Oddanchatram
// Immersive, editorial, motion-driven landing. Dark canvas, giant
// kinetic Tamil/English type, scroll-choreographed reveals, custom
// cursor — built with pure CSS + one rAF loop + IntersectionObserver
// (no libraries) so it stays fast on mobile and shared hosting.
// Talks ONLY to the public endpoints: rates (read) + enquiry (write).
// ============================================================

const PRODUCE = [
  ["தக்காளி", "Tomato", "🍅"], ["வெங்காயம்", "Onion", "🧅"],
  ["உருளை", "Potato", "🥔"], ["பச்சை மிளகாய்", "Green Chilli", "🌶️"],
  ["பீட்ரூட்", "Beetroot", "🟣"], ["கேரட்", "Carrot", "🥕"],
  ["முட்டைகோசு", "Cabbage", "🥬"], ["பீன்ஸ்", "Beans", "🫛"],
  ["கத்தரி", "Brinjal", "🍆"], ["வெண்டை", "Ladies Finger", "🌿"],
  ["முருங்கை", "Drumstick", "🌱"], ["கருப்பு செடி", "Karumpu Cedi", "🎋"],
];

const STEPS = [
  ["04:00", "The lorries roll in", "Through the night and before dawn, farmers and trucks from the surrounding villages and the Palani foothills bring their harvest straight to our yard at Gandhi Market.", "வண்டி வருகை"],
  ["05:30", "Weighed in the open", "Every bag goes on the scale in front of the farmer. Bag by bag, kilo by kilo — the weights are written on the bill, so there is never a doubt.", "நேர்மையான எடை"],
  ["07:00", "Priced by the market", "Rates move with the day's demand. We work the floor for the farmer's best price and publish our indicative rates openly — the same number for everyone.", "சந்தை விலை"],
  ["09:00", "Dispatched & settled", "Buyers load out to shops, hotels and wholesale markets across South India. Farmers are paid out, buyers' accounts are settled — every rupee on a printed bill.", "பட்டுவாடா"],
];

const WHY = [
  ["⚖️", "Weighed before your eyes", "Open scales, per-bag weights printed on every bill, and a transparent commission. What you see is exactly what you pay."],
  ["🌄", "Hill-fresh, farm-direct", "Produce arrives overnight from the growing belts around Oddanchatram and the Palani foothills — sold the same morning, not stored."],
  ["🚛", "Bulk & order supply", "Tell us the list and the quantity. We line it up from the day's arrivals and load your vehicle — daily, reliably, in season and out."],
  ["📈", "Rates published daily", "Our indicative wholesale rates go up on this page every market day. One honest number, the same for every caller."],
  ["🧾", "Every rupee on a bill", "Farmer payouts, buyer accounts, advances, freight — all printed, all accounted. Three generations of market trust run on paper you can check."],
  ["📞", "One call does it", "Phone or WhatsApp before the market closes and your order is on the next lorry. We answer fast — ask anyone in the market."],
];

export default function PublicHome({ onStaffLogin }) {
  const [data, setData]       = useState(null);                 // { rates, contact }
  const [form, setForm]       = useState({ name: "", phone: "", message: "", company: "" });
  const [sending, setSending] = useState(false);
  const [sent, setSent]       = useState(false);
  const [err, setErr]         = useState("");
  const [ready, setReady]     = useState(false);                // intro finished
  const [loaded, setLoaded]   = useState(false);                // hero animate-in

  const rootRef = useRef(null);
  const dotRef  = useRef(null);
  const ringRef = useRef(null);
  const glowRef = useRef(null);
  const heroTaRef = useRef(null);
  const progRef = useRef(null);

  useEffect(() => {
    api("public?action=rates")
      .then(r => setData(r.data))
      .catch(() => setData({ rates: { items: [] }, contact: {} }));
  }, []);

  // ---- intro loader → hero reveal ----
  useEffect(() => {
    const t1 = setTimeout(() => setReady(true), 1000);
    const t2 = setTimeout(() => setLoaded(true), 1100);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // ---- scroll reveals + parallax + progress + custom cursor (one rAF loop) ----
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.15, rootMargin: "0px 0px -6% 0px" });
    root.querySelectorAll("[data-reveal]").forEach(el => io.observe(el));

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY || 0;
        if (glowRef.current)   glowRef.current.style.transform   = `translate3d(0, ${y * 0.16}px, 0)`;
        if (heroTaRef.current) heroTaRef.current.style.transform = `translate3d(${y * -0.08}px, ${y * 0.1}px, 0)`;
        if (progRef.current) {
          const h = document.documentElement.scrollHeight - innerHeight;
          progRef.current.style.transform = `scaleX(${h > 0 ? Math.min(1, y / h) : 0})`;
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    // custom cursor — skipped entirely on touch devices
    const fine = window.matchMedia("(pointer:fine)").matches;
    let mx = innerWidth / 2, my = innerHeight / 2, dx = mx, dy = my, rx = mx, ry = my, craf = 0;
    const onMove  = (e) => { mx = e.clientX; my = e.clientY; };
    const onHover = (e) => ringRef.current?.classList.toggle("hot", !!e.target.closest("a,button,input,textarea,select,.sm-card,.sm-rate,.sm-prod"));
    const tick = () => {
      dx += (mx - dx) * 0.35; dy += (my - dy) * 0.35;
      rx += (mx - rx) * 0.16; ry += (my - ry) * 0.16;
      if (dotRef.current)  dotRef.current.style.transform  = `translate3d(${dx}px,${dy}px,0) translate(-50%,-50%)`;
      if (ringRef.current) ringRef.current.style.transform = `translate3d(${rx}px,${ry}px,0) translate(-50%,-50%)`;
      craf = requestAnimationFrame(tick);
    };
    if (fine) {
      document.addEventListener("mousemove", onMove, { passive: true });
      document.addEventListener("mouseover", onHover, { passive: true });
      craf = requestAnimationFrame(tick);
    }
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseover", onHover);
      if (craf) cancelAnimationFrame(craf);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [data]);

  const goTo = useCallback((id) => (e) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const contact  = data?.contact || {};
  const rates    = data?.rates   || { items: [] };
  const items    = (rates.items || []).filter(it => Number(it.price) > 0);
  const company  = contact.company_en || "Sri Murugan & Co.,";
  const address  = contact.address || "94, 95, Gandhi Market, Thangachiammapatti, ODDANCHATRAM - 624 612.";
  const phones   = (contact.phone || "Cell : 94433 34663, 73733 99999").replace(/[^0-9, ]/g, "").trim();
  const firstNum = (phones.match(/\d[\d ]{7,}/) || [""])[0].replace(/\s+/g, "");
  const waNumber = firstNum ? "91" + firstNum.slice(-10) : "";

  const submit = async () => {
    if (!form.name.trim() || !form.phone.trim()) { setErr("Please enter your name and phone number."); return; }
    setSending(true); setErr("");
    try {
      await api("public?action=enquiry", { method: "POST", body: JSON.stringify(form) });
      setSent(true);
    } catch (e) { setErr(e.message); }
    finally { setSending(false); }
  };

  return (
    <div ref={rootRef} className={`sm-root${loaded ? " sm-loaded" : ""}`}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <style>{CSS}</style>

      {/* cursor + scroll progress */}
      <div ref={ringRef} className="sm-cursor sm-ring" aria-hidden="true" />
      <div ref={dotRef}  className="sm-cursor sm-dot"  aria-hidden="true" />
      <div ref={progRef} className="sm-progress" aria-hidden="true" />

      {/* intro loader */}
      <div className={`sm-intro${ready ? " gone" : ""}`} aria-hidden="true">
        <div className="sm-intro-inner">
          <BrandLogo size={44} round />
          <div className="sm-intro-ta">ஸ்ரீ முருகன் அன் கோ</div>
          <div className="sm-intro-name">SRI MURUGAN &amp; CO · ODDANCHATRAM</div>
          <div className="sm-intro-bar"><i /></div>
        </div>
      </div>

      {/* ambient glow + grain */}
      <div ref={glowRef} className="sm-glow" aria-hidden="true" />
      <div className="sm-grain" aria-hidden="true" />

      {/* ===== Nav ===== */}
      <header className="sm-nav">
        <div className="sm-nav-in">
          <div className="sm-brand">
            <span className="sm-brand-mark"><BrandLogo size={26} round /></span>
            <span>
              <b>Sri Murugan &amp; Co</b>
              <em>Gandhi Market · Oddanchatram</em>
            </span>
          </div>
          <nav className="sm-nav-links">
            <a href="#town"    onClick={goTo("town")}>The Town</a>
            <a href="#story"   onClick={goTo("story")}>Our Story</a>
            <a href="#day"     onClick={goTo("day")}>A Market Day</a>
            <a href="#rates"   onClick={goTo("rates")}>Rates</a>
            <a href="#contact" onClick={goTo("contact")}>Contact</a>
          </nav>
          <button className="sm-login" onClick={onStaffLogin}>Staff Login</button>
        </div>
      </header>

      {/* ===== Hero ===== */}
      <section className="sm-hero">
        <div ref={heroTaRef} className="sm-hero-bigta" aria-hidden="true">ஒட்டன்சத்திரம்</div>
        <div className="sm-hero-tag sm-rise" style={{ "--d": "0ms" }}>
          வாணிபமே கோயில் · வாடிக்கையாளரே தெய்வம்
        </div>
        <h1 className="sm-hero-title">
          <span className="sm-line"><span className="sm-w" style={{ "--d": "60ms" }}>Where the</span></span>
          <span className="sm-line"><span className="sm-w" style={{ "--d": "150ms" }}>hills feed</span></span>
          <span className="sm-line"><span className="sm-w sm-grad" style={{ "--d": "240ms" }}>the South.</span></span>
        </h1>
        <p className="sm-hero-sub sm-rise" style={{ "--d": "430ms" }}>
          {company} is a vegetable commission agent &amp; order supplier inside Gandhi Market,
          Oddanchatram — the market town they call the vegetable capital of Tamil Nadu.
          Farmers trust us with their harvest. Buyers trust us with their price.
        </p>
        <div className="sm-hero-cta sm-rise" style={{ "--d": "560ms" }}>
          <a href="#contact" onClick={goTo("contact")} className="sm-btn sm-btn-fill">Place an enquiry <span>→</span></a>
          <a href="#rates"   onClick={goTo("rates")}   className="sm-btn sm-btn-ghost">Today's rates</a>
        </div>
        <div className="sm-hero-stats sm-rise" style={{ "--d": "700ms" }}>
          {[["6,400+", "farmers on our books"], ["700+", "regular buyers"], ["100+", "vegetables traded"], ["24/7", "the market never sleeps"]].map(([n, l], i) => (
            <div key={i} className="sm-hstat"><b>{n}</b><span>{l}</span></div>
          ))}
        </div>
        <div className="sm-scroll sm-rise" style={{ "--d": "820ms" }}><span /> scroll</div>
      </section>

      {/* ===== Marquee ===== */}
      <div className="sm-marquee" aria-hidden="true">
        <div className="sm-marquee-track">
          {Array.from({ length: 2 }).map((_, k) => (
            <span key={k}>
              தக்காளி <i>✦</i> வெங்காயம் <i>✦</i> மிளகாய் <i>✦</i> பீன்ஸ் <i>✦</i> கேரட் <i>✦</i>
              Fresh before sunrise <i>✦</i> Honest weighing <i>✦</i> Fair daily rates <i>✦</i>
            </span>
          ))}
        </div>
      </div>

      {/* ===== 01 The Town ===== */}
      <section id="town" className="sm-sec">
        <div className="sm-sec-head" data-reveal>
          <span className="sm-kicker">01 — The Town</span>
          <h2>Oddanchatram. <span className="sm-grad">The vegetable capital.</span></h2>
        </div>
        <div className="sm-edit">
          <p className="sm-lead" data-reveal>
            On the Dindigul–Palani road, where the plains meet the Palani foothills, sits a town
            whose whole rhythm is set by vegetables. While most of Tamil Nadu sleeps, Oddanchatram
            is wide awake — headlights queueing into Gandhi Market, bags coming off lorries,
            scales clinking, prices called out over the noise.
          </p>
          <p data-reveal style={{ "--d": "80ms" }}>
            The hills and valleys around this town — cool, fertile, watered by the Western Ghats —
            grow vegetables nearly all year round. Tomato, beans, carrot, cabbage and greens from the
            high farms; onion, brinjal and chillies from the plains. Every night it all converges
            here, and by morning it is on the road again — to wholesale markets, hotels and shops
            across Tamil Nadu, Kerala and beyond.
          </p>
          <p data-reveal style={{ "--d": "160ms" }}>
            That is why traders simply call Oddanchatram the <b>vegetable capital</b>. It is not a
            slogan — it is a supply chain that has run on trust, scales and handwritten bills for
            generations. And it is the market we are proud to work in, every single day.
          </p>
          <blockquote className="sm-pull" data-reveal style={{ "--d": "220ms" }}>
            "Buy it in Oddanchatram tonight,<br />sell it anywhere in the South tomorrow."
            <cite>— what they say in the market</cite>
          </blockquote>
        </div>
      </section>

      {/* ===== 02 Our Story ===== */}
      <section id="story" className="sm-sec sm-sec-alt">
        <div className="sm-sec-head" data-reveal>
          <span className="sm-kicker">02 — Our Story</span>
          <h2>A name farmers <span className="sm-grad">hand down.</span></h2>
        </div>
        <div className="sm-edit">
          <p className="sm-lead sm-dropcap" data-reveal>
            Sri Murugan &amp; Co began the way every honest mandi business begins — with one shop,
            one scale, and a promise: the farmer's weight is the farmer's money. We are commission
            agents, which means we never profit from a farmer's loss. We sell their harvest at the
            best rate the market will give, take a transparent commission, and hand over the rest
            the same day. That's the whole business — done right, thousands of times a season.
          </p>
          <p data-reveal style={{ "--d": "80ms" }}>
            Today more than <b>6,400 farmers</b> have accounts with us, from villages all around
            Oddanchatram and the hill farms beyond. On the other side of the scale stand
            <b> 700+ regular buyers</b> — wholesale traders, retail shops, hotels and van merchants —
            who know that an order placed with us is loaded, billed and on the road on time.
          </p>
          <p data-reveal style={{ "--d": "160ms" }}>
            The tools have changed — our billing now runs on software built for this market, every
            transaction audited and printed — but the values on the wall haven't:
            <b> வாணிபமே கோயில், வாடிக்கையாளரே தெய்வம்</b> — business is our temple, and the
            customer is god.
          </p>
          <div className="sm-stats" data-reveal style={{ "--d": "220ms" }}>
            {[["6,400+", "farmer accounts"], ["700+", "regular buyers"], ["100+", "vegetables in season"], ["1", "promise: honest weight"]].map(([n, l], i) => (
              <div key={i} className="sm-stat"><b>{n}</b><span>{l}</span></div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== 03 A Market Day ===== */}
      <section id="day" className="sm-sec">
        <div className="sm-sec-head" data-reveal>
          <span className="sm-kicker">03 — A Market Day</span>
          <h2>From headlights <span className="sm-grad">to handshake.</span></h2>
        </div>
        <div className="sm-steps">
          {STEPS.map(([time, title, body, ta], i) => (
            <article key={i} className="sm-step" data-reveal style={{ "--d": `${i * 90}ms` }}>
              <div className="sm-step-time">{time}</div>
              <div className="sm-step-line"><i /></div>
              <div className="sm-step-body">
                <h3>{title} <em>{ta}</em></h3>
                <p>{body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ===== 04 What we trade ===== */}
      <section className="sm-sec sm-sec-alt">
        <div className="sm-sec-head" data-reveal>
          <span className="sm-kicker">04 — What We Trade</span>
          <h2>If it grows here, <span className="sm-grad">it's on our floor.</span></h2>
          <p className="sm-sec-note">A taste of the daily arrivals — 100+ vegetables move through our yard in season.</p>
        </div>
        <div className="sm-prods">
          {PRODUCE.map(([ta, en, ic], i) => (
            <div key={i} className="sm-prod" data-reveal style={{ "--d": `${(i % 6) * 50}ms` }}>
              <span className="sm-prod-ic">{ic}</span>
              <b>{ta}</b><em>{en}</em>
            </div>
          ))}
        </div>
      </section>

      {/* ===== 05 Why us ===== */}
      <section className="sm-sec">
        <div className="sm-sec-head" data-reveal>
          <span className="sm-kicker">05 — Why Merchants Choose Us</span>
          <h2>Trust you can <span className="sm-grad">weigh.</span></h2>
        </div>
        <div className="sm-grid">
          {WHY.map(([ic, t, s], i) => (
            <article key={i} className="sm-card" data-reveal style={{ "--d": `${(i % 3) * 80}ms` }}>
              <div className="sm-card-ic">{ic}</div>
              <h3>{t}</h3>
              <p>{s}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ===== 06 Rates ===== */}
      <section id="rates" className="sm-sec sm-sec-alt">
        <div className="sm-sec-head" data-reveal>
          <span className="sm-kicker">06 — Today's Market</span>
          <h2>Indicative <span className="sm-grad">wholesale rates.</span></h2>
          <p className="sm-sec-note">
            {rates.as_of ? `As on ${fmtDate(rates.as_of)}` : "Updated by our team"} · prices move through the day — call to confirm before you load.
          </p>
        </div>
        {items.length === 0 ? (
          <div className="sm-empty" data-reveal>Rates will appear here once published. Call us for today's prices — we answer.</div>
        ) : (
          <div className="sm-rates">
            {items.map((it, i) => (
              <div key={i} className="sm-rate" data-reveal style={{ "--d": `${(i % 4) * 60}ms` }}>
                <div className="sm-rate-name">{it.name}{it.name_ta && <em>{it.name_ta}</em>}</div>
                <div className="sm-rate-price">
                  <b>₹{Number(it.price).toLocaleString("en-IN")}</b><span>/ {it.unit || "kg"}</span>
                </div>
                {it.note && <div className="sm-rate-note">{it.note}</div>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ===== 07 Contact ===== */}
      <section id="contact" className="sm-sec">
        <div className="sm-sec-head" data-reveal>
          <span className="sm-kicker">07 — Get In Touch</span>
          <h2>New customer? <span className="sm-grad">Let's talk vegetables.</span></h2>
        </div>
        <div className="sm-contact">
          <div className="sm-card sm-map" data-reveal>
            <iframe title="map" width="100%" height="250" style={{ border: 0, display: "block" }} loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              src={`https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`} />
            <div className="sm-map-body">
              <div className="sm-map-title">📍 {company}</div>
              <div className="sm-map-addr">{address}</div>
              {contact.address_ta && <div className="sm-map-addr ta">{contact.address_ta}</div>}
              <div className="sm-map-btns">
                {firstNum && <a href={`tel:${firstNum}`} className="sm-pill sm-pill-green">📞 Call us</a>}
                {waNumber && <a href={`https://wa.me/${waNumber}`} target="_blank" rel="noreferrer" className="sm-pill sm-pill-wa">💬 WhatsApp</a>}
              </div>
              <div className="sm-map-phone">{phones}</div>
              <div className="sm-map-hours">Market hours: the yard works round the clock — call any time, we're probably awake.</div>
            </div>
          </div>

          <div className="sm-card sm-form" data-reveal style={{ "--d": "90ms" }}>
            <div className="sm-form-title">Send an enquiry</div>
            <div className="sm-form-ta">புதிய வாடிக்கையாளரா? உங்கள் தேவையை அனுப்புங்கள் — நாங்களே அழைக்கிறோம்</div>
            {sent ? (
              <div className="sm-ok">✅ Thank you! We've received your enquiry and will call you back soon.</div>
            ) : (
              <div className="sm-fields">
                <input className="sm-inp" placeholder="Your name / பெயர்" value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
                <input className="sm-inp" placeholder="Phone / WhatsApp number" value={form.phone}
                  onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />
                <textarea className="sm-inp" placeholder="What vegetables / quantity do you need?" rows={3} value={form.message}
                  onChange={e => setForm(p => ({ ...p, message: e.target.value }))} />
                {/* Honeypot — hidden from real users */}
                <input tabIndex={-1} autoComplete="off" aria-hidden="true" className="sm-hp" value={form.company}
                  onChange={e => setForm(p => ({ ...p, company: e.target.value }))} />
                {err && <div className="sm-err">{err}</div>}
                <button className="sm-btn sm-btn-fill sm-submit" onClick={submit} disabled={sending}>
                  {sending ? "Sending…" : <>Send enquiry / அனுப்பு <span>→</span></>}
                </button>
                <div className="sm-fineprint">We use your details only to contact you about your enquiry.</div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ===== Footer ===== */}
      <footer className="sm-foot">
        <div className="sm-foot-big">FRESH FROM THE<br />FARMER'S FIELDS</div>
        <div className="sm-foot-row">
          <div>
            <div className="sm-foot-name">{company}</div>
            <div className="sm-foot-addr">{address}</div>
            <div className="sm-foot-addr">{phones}</div>
          </div>
          <div className="sm-foot-links">
            <a href="#town"    onClick={goTo("town")}>The Town</a>
            <a href="#story"   onClick={goTo("story")}>Our Story</a>
            <a href="#rates"   onClick={goTo("rates")}>Rates</a>
            <a href="#contact" onClick={goTo("contact")}>Contact</a>
            <button onClick={onStaffLogin}>Staff Login</button>
          </div>
        </div>
        <div className="sm-foot-bot">© {new Date().getFullYear()} Sri Murugan &amp; Co · Powered for Oddanchatram Market · வாணிபமே கோயில் !</div>
      </footer>
    </div>
  );
}

function fmtDate(d) {
  try { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return d; }
}

/* ============================================================
   Styles — dark immersive canvas, kinetic type, editorial
   sections, scroll reveals, marquee, custom cursor. Below-fold
   sections use content-visibility:auto for fast first paint.
   ============================================================ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Space+Grotesk:wght@400;500;600;700&display=swap');

.sm-root{
  --bg:#06120b; --bg2:#081a0f; --ink:#eef5ea; --mut:#8fa896;
  --lime:#b8ff4d; --green:#2fd06b; --warm:#ff6a3d;
  position:relative; background:var(--bg); color:var(--ink); overflow-x:hidden;
  font-family:'Space Grotesk','Segoe UI',system-ui,sans-serif;
  -webkit-font-smoothing:antialiased; min-height:100vh;
}
@media (pointer:fine){ .sm-root, .sm-root *{ cursor:none !important; } }
.sm-root ::selection{ background:var(--lime); color:#06120b; }

/* ---- cursor + progress ---- */
.sm-cursor{ position:fixed; top:0; left:0; z-index:9999; pointer-events:none; will-change:transform; }
.sm-dot{ width:7px; height:7px; border-radius:50%; background:var(--lime); }
.sm-ring{ width:34px; height:34px; border-radius:50%; border:1.5px solid rgba(184,255,77,.55); transition:width .2s,height .2s,background .2s,border-color .2s; }
.sm-ring.hot{ width:56px; height:56px; background:rgba(184,255,77,.12); border-color:var(--lime); }
@media (pointer:coarse){ .sm-cursor{ display:none; } }
.sm-progress{ position:fixed; top:0; left:0; right:0; height:2.5px; z-index:9998; transform-origin:left;
  transform:scaleX(0); background:linear-gradient(90deg,var(--green),var(--lime)); will-change:transform; }

/* ---- intro ---- */
.sm-intro{ position:fixed; inset:0; z-index:9997; background:var(--bg);
  display:flex; align-items:center; justify-content:center; transition:opacity .5s ease, transform .6s cubic-bezier(.7,0,.2,1); }
.sm-intro.gone{ opacity:0; transform:translateY(-100%); pointer-events:none; }
.sm-intro-inner{ text-align:center; display:flex; flex-direction:column; align-items:center; gap:10px; }
.sm-intro-ta{ font-size:clamp(20px,6vw,34px); font-weight:700; color:var(--lime); }
.sm-intro-name{ font-family:'Anton',sans-serif; letter-spacing:.16em; font-size:clamp(11px,2.6vw,15px); color:var(--mut); }
.sm-intro-bar{ width:170px; height:2px; margin-top:8px; background:rgba(255,255,255,.12); border-radius:2px; overflow:hidden; }
.sm-intro-bar i{ display:block; height:100%; width:0; background:var(--lime); animation:smload .95s ease forwards; }
@keyframes smload{ from{width:0} to{width:100%} }

/* ---- glow + grain ---- */
.sm-glow{ position:absolute; top:-12%; left:50%; width:120vw; height:95vh; transform:translateX(-50%);
  background:
    radial-gradient(42% 52% at 22% 20%, rgba(47,208,107,.30), transparent 70%),
    radial-gradient(38% 48% at 82% 10%, rgba(184,255,77,.20), transparent 70%),
    radial-gradient(52% 52% at 50% 82%, rgba(255,106,61,.10), transparent 70%);
  filter:blur(22px); pointer-events:none; z-index:0; will-change:transform; }
.sm-grain{ position:fixed; inset:0; z-index:1; pointer-events:none; opacity:.05; mix-blend-mode:overlay;
  background-image:radial-gradient(rgba(255,255,255,.7) .5px, transparent .5px); background-size:3px 3px; }
.sm-root > section, .sm-root > header, .sm-root > .sm-marquee, .sm-root > footer{ position:relative; z-index:2; }

/* ---- nav ---- */
.sm-nav{ position:sticky; top:0; z-index:50; backdrop-filter:blur(10px);
  background:linear-gradient(180deg, rgba(6,18,11,.93), rgba(6,18,11,.58)); border-bottom:1px solid rgba(255,255,255,.06); }
.sm-nav-in{ max-width:1200px; margin:0 auto; padding:13px 22px; display:flex; align-items:center; gap:18px; }
.sm-brand{ display:flex; align-items:center; gap:11px; }
.sm-brand-mark{ width:38px; height:38px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center;
  overflow:hidden; background:linear-gradient(135deg,var(--green),#0d3d22); box-shadow:0 0 0 1px rgba(184,255,77,.25); }
.sm-brand b{ display:block; font-size:15px; font-weight:700; }
.sm-brand em{ display:block; font-style:normal; font-size:10.5px; color:var(--mut); margin-top:1px; }
.sm-nav-links{ margin-left:auto; display:flex; gap:20px; }
.sm-nav-links a{ color:var(--mut); text-decoration:none; font-size:13.5px; font-weight:500; transition:color .2s; }
.sm-nav-links a:hover{ color:var(--lime); }
.sm-login{ background:var(--lime); color:#06120b; border:none; padding:9px 18px; border-radius:999px;
  font-weight:700; font-size:13px; font-family:inherit; transition:transform .15s, box-shadow .2s; }
.sm-login:hover{ transform:translateY(-1px); box-shadow:0 8px 22px rgba(184,255,77,.3); }
@media (max-width:760px){ .sm-nav-links{ display:none; } .sm-login{ margin-left:auto; } }

/* ---- hero ---- */
.sm-hero{ max-width:1200px; margin:0 auto; padding:clamp(64px,12vh,130px) 22px clamp(44px,7vh,80px); position:relative; }
.sm-hero-bigta{ position:absolute; top:clamp(8px,4vh,40px); right:-2%; font-weight:800; white-space:nowrap;
  font-size:clamp(60px,13vw,190px); color:transparent; -webkit-text-stroke:1px rgba(184,255,77,.14);
  pointer-events:none; user-select:none; will-change:transform; }
.sm-hero-tag{ display:inline-block; padding:7px 16px; border:1px solid rgba(184,255,77,.3); border-radius:999px;
  font-size:12.5px; color:var(--lime); letter-spacing:.04em; margin-bottom:26px; }
.sm-hero-title{ margin:0; font-family:'Anton',sans-serif; font-weight:400; letter-spacing:-.01em;
  font-size:clamp(54px,11.5vw,150px); line-height:.94; }
.sm-line{ display:block; overflow:hidden; padding-bottom:.05em; }
.sm-w{ display:inline-block; transform:translateY(115%); transition:transform .9s cubic-bezier(.16,1,.3,1); transition-delay:var(--d,0ms); }
.sm-loaded .sm-w{ transform:translateY(0); }
.sm-grad{ background:linear-gradient(100deg,var(--lime),var(--green) 60%,var(--warm)); -webkit-background-clip:text; background-clip:text; color:transparent; }
.sm-hero-sub{ max-width:600px; margin:30px 0 0; font-size:clamp(15px,1.7vw,18px); line-height:1.65; color:#c5d6c4; }
.sm-hero-cta{ display:flex; gap:14px; flex-wrap:wrap; margin-top:32px; }
.sm-hero-stats{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:14px; margin-top:46px;
  border-top:1px solid rgba(255,255,255,.1); padding-top:26px; max-width:840px; }
.sm-hstat b{ display:block; font-family:'Anton',sans-serif; font-size:clamp(24px,3.4vw,38px); color:var(--lime); line-height:1; }
.sm-hstat span{ display:block; margin-top:6px; font-size:12px; color:var(--mut); }
.sm-scroll{ margin-top:44px; font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:var(--mut);
  display:flex; align-items:center; gap:10px; }
.sm-scroll span{ width:1px; height:32px; background:linear-gradient(var(--lime),transparent); display:inline-block; animation:smscroll 1.8s ease-in-out infinite; transform-origin:top; }
@keyframes smscroll{ 0%,100%{ transform:scaleY(.4); opacity:.5; } 50%{ transform:scaleY(1); opacity:1; } }

.sm-rise{ opacity:0; transform:translateY(26px); transition:opacity .8s ease, transform .8s cubic-bezier(.16,1,.3,1); transition-delay:var(--d,0ms); }
.sm-loaded .sm-rise{ opacity:1; transform:none; }

/* ---- buttons ---- */
.sm-btn{ display:inline-flex; align-items:center; gap:9px; padding:13px 24px; border-radius:999px;
  font-size:14.5px; font-weight:700; text-decoration:none; font-family:inherit; transition:transform .15s, box-shadow .25s, background .2s; border:none; }
.sm-btn span{ transition:transform .25s; }
.sm-btn:hover span{ transform:translateX(4px); }
.sm-btn-fill{ background:var(--lime); color:#06120b; }
.sm-btn-fill:hover{ transform:translateY(-2px); box-shadow:0 14px 30px rgba(184,255,77,.28); }
.sm-btn-ghost{ background:transparent; color:var(--ink); border:1px solid rgba(255,255,255,.22); }
.sm-btn-ghost:hover{ border-color:var(--lime); color:var(--lime); }

/* ---- marquee ---- */
.sm-marquee{ overflow:hidden; border-top:1px solid rgba(255,255,255,.08); border-bottom:1px solid rgba(255,255,255,.08);
  padding:16px 0; background:rgba(184,255,77,.03); white-space:nowrap; }
.sm-marquee-track{ display:inline-flex; animation:smmarq 30s linear infinite; will-change:transform; }
.sm-marquee-track span{ font-family:'Anton',sans-serif; font-size:clamp(20px,3.2vw,36px); color:rgba(238,245,234,.4); padding-right:.4em; }
.sm-marquee-track i{ color:var(--lime); font-style:normal; padding:0 .35em; }
@keyframes smmarq{ to{ transform:translateX(-50%); } }

/* ---- sections ---- */
.sm-sec{ max-width:1200px; margin:0 auto; padding:clamp(66px,10vh,116px) 22px; content-visibility:auto; contain-intrinsic-size: 1px 900px; }
.sm-sec-alt{ position:relative; }
.sm-sec-alt::before{ content:""; position:absolute; inset:0; background:linear-gradient(180deg, rgba(184,255,77,.025), transparent 70%); pointer-events:none; }
.sm-sec-head{ max-width:900px; }
.sm-kicker{ display:inline-block; font-size:12px; letter-spacing:.2em; text-transform:uppercase; color:var(--lime); margin-bottom:16px; }
.sm-sec-head h2{ margin:0; font-family:'Anton',sans-serif; font-weight:400; line-height:1.02;
  font-size:clamp(32px,5.6vw,68px); letter-spacing:-.01em; }
.sm-sec-note{ color:var(--mut); margin:16px 0 0; font-size:14px; }

[data-reveal]{ opacity:0; transform:translateY(34px); transition:opacity .8s ease, transform .9s cubic-bezier(.16,1,.3,1); transition-delay:var(--d,0ms); }
[data-reveal].in{ opacity:1; transform:none; }

/* ---- editorial ---- */
.sm-edit{ max-width:820px; margin-top:42px; }
.sm-edit p{ margin:0 0 22px; font-size:clamp(15px,1.75vw,18.5px); line-height:1.75; color:#c8d8c6; }
.sm-edit p b{ color:var(--ink); }
.sm-lead{ font-size:clamp(17px,2.1vw,22px) !important; color:#dcead9 !important; }
.sm-dropcap::first-letter{ font-family:'Anton',sans-serif; font-size:3.4em; line-height:.8; float:left;
  padding:6px 12px 0 0; color:var(--lime); }
.sm-pull{ margin:34px 0 0; padding:26px 30px; border-left:3px solid var(--lime);
  font-family:'Anton',sans-serif; font-size:clamp(20px,3vw,30px); line-height:1.3; color:var(--ink);
  background:rgba(184,255,77,.04); border-radius:0 16px 16px 0; }
.sm-pull cite{ display:block; margin-top:12px; font-family:'Space Grotesk',sans-serif; font-style:normal; font-size:13px; color:var(--mut); }
.sm-stats{ display:grid; grid-template-columns:repeat(4,1fr); gap:18px; margin-top:36px;
  border-top:1px solid rgba(255,255,255,.1); padding-top:30px; }
.sm-stat b{ display:block; font-family:'Anton',sans-serif; font-size:clamp(24px,3.6vw,42px); color:var(--lime); line-height:1; }
.sm-stat span{ display:block; margin-top:8px; font-size:12.5px; color:var(--mut); }
@media (max-width:700px){ .sm-stats{ grid-template-columns:1fr 1fr; } }

/* ---- market-day steps ---- */
.sm-steps{ margin-top:50px; display:flex; flex-direction:column; gap:0; max-width:880px; }
.sm-step{ display:grid; grid-template-columns:86px 40px 1fr; gap:0 8px; }
.sm-step-time{ font-family:'Anton',sans-serif; font-size:clamp(18px,2.6vw,26px); color:var(--lime); padding-top:2px; }
.sm-step-line{ position:relative; display:flex; justify-content:center; }
.sm-step-line::before{ content:""; position:absolute; top:6px; bottom:-6px; width:1px; background:linear-gradient(rgba(184,255,77,.5), rgba(184,255,77,.08)); }
.sm-step-line i{ width:11px; height:11px; border-radius:50%; background:var(--lime); margin-top:6px; position:relative; box-shadow:0 0 14px rgba(184,255,77,.7); }
.sm-step:last-child .sm-step-line::before{ display:none; }
.sm-step-body{ padding:0 0 42px 10px; }
.sm-step-body h3{ margin:0 0 8px; font-size:clamp(17px,2.2vw,21px); font-weight:700; }
.sm-step-body h3 em{ font-style:normal; font-size:.72em; color:var(--lime); margin-left:10px; font-weight:600; }
.sm-step-body p{ margin:0; font-size:14.5px; line-height:1.65; color:var(--mut); max-width:620px; }
@media (max-width:560px){ .sm-step{ grid-template-columns:64px 26px 1fr; } }

/* ---- produce grid ---- */
.sm-prods{ display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:12px; margin-top:46px; }
.sm-prod{ display:flex; align-items:center; gap:12px; padding:14px 16px; border:1px solid rgba(255,255,255,.08);
  border-radius:14px; background:rgba(255,255,255,.025); transition:transform .3s, border-color .3s, background .3s; }
.sm-prod:hover{ transform:translateY(-3px); border-color:rgba(184,255,77,.4); background:rgba(184,255,77,.05); }
.sm-prod-ic{ font-size:24px; }
.sm-prod b{ display:block; font-size:14px; }
.sm-prod em{ display:block; font-style:normal; font-size:11px; color:var(--mut); }

/* ---- why-us cards ---- */
.sm-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:18px; margin-top:48px; }
.sm-card{ background:linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.01));
  border:1px solid rgba(255,255,255,.08); border-radius:20px; padding:30px 26px;
  transition:transform .35s cubic-bezier(.16,1,.3,1), border-color .35s, background .35s; }
.sm-card:hover{ transform:translateY(-6px); border-color:rgba(184,255,77,.4); background:linear-gradient(180deg, rgba(184,255,77,.07), rgba(255,255,255,.01)); }
.sm-card-ic{ font-size:30px; }
.sm-card h3{ margin:16px 0 8px; font-size:18px; font-weight:700; }
.sm-card p{ margin:0; font-size:14px; line-height:1.6; color:var(--mut); }
@media (max-width:880px){ .sm-grid{ grid-template-columns:1fr 1fr; } }
@media (max-width:560px){ .sm-grid{ grid-template-columns:1fr; } }

/* ---- rates ---- */
.sm-rates{ display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:14px; margin-top:48px; }
.sm-rate{ background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.08); border-radius:16px; padding:18px;
  transition:transform .3s, border-color .3s, background .3s; }
.sm-rate:hover{ transform:translateY(-4px); border-color:rgba(184,255,77,.45); background:rgba(184,255,77,.05); }
.sm-rate-name{ font-size:15.5px; font-weight:700; }
.sm-rate-name em{ display:block; font-style:normal; font-size:12px; color:var(--mut); margin-top:1px; }
.sm-rate-price{ margin-top:14px; display:flex; align-items:baseline; gap:5px; }
.sm-rate-price b{ font-family:'Anton',sans-serif; font-size:30px; color:var(--lime); }
.sm-rate-price span{ font-size:12.5px; color:var(--mut); }
.sm-rate-note{ font-size:11.5px; color:#7f9684; margin-top:6px; }
.sm-empty{ margin-top:40px; padding:34px; text-align:center; color:var(--mut); border:1px dashed rgba(255,255,255,.14); border-radius:16px; }

/* ---- contact ---- */
.sm-contact{ display:grid; grid-template-columns:1fr 1fr; gap:22px; margin-top:48px; }
.sm-map{ overflow:hidden; padding:0; }
.sm-map-body{ padding:22px; }
.sm-map-title{ font-weight:700; font-size:16px; }
.sm-map-addr{ color:#c2d3c0; font-size:13.5px; margin-top:8px; line-height:1.55; }
.sm-map-addr.ta{ color:var(--mut); font-size:12.5px; margin-top:2px; }
.sm-map-btns{ margin-top:16px; display:flex; gap:10px; flex-wrap:wrap; }
.sm-pill{ padding:9px 16px; border-radius:999px; font-weight:700; font-size:13px; text-decoration:none; color:#06120b; }
.sm-pill-green{ background:var(--lime); }
.sm-pill-wa{ background:#25D366; }
.sm-map-phone{ margin-top:14px; font-size:13.5px; color:#c2d3c0; }
.sm-map-hours{ margin-top:10px; font-size:12px; color:var(--mut); }
.sm-form{ padding:30px 28px; }
.sm-form-title{ font-family:'Anton',sans-serif; font-size:24px; }
.sm-form-ta{ font-size:12.5px; color:var(--mut); margin-top:4px; }
.sm-fields{ margin-top:20px; display:flex; flex-direction:column; gap:12px; }
.sm-inp{ width:100%; box-sizing:border-box; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.14);
  border-radius:12px; padding:13px 15px; font-size:14.5px; color:var(--ink); font-family:inherit; outline:none; resize:vertical;
  transition:border-color .2s, background .2s; }
.sm-inp::placeholder{ color:#7f9684; }
.sm-inp:focus{ border-color:var(--lime); background:rgba(184,255,77,.05); }
.sm-hp{ position:absolute; left:-9999px; width:1px; height:1px; opacity:0; }
.sm-submit{ justify-content:center; margin-top:4px; }
.sm-submit:disabled{ background:#3a4a3f; color:#9fb0a4; }
.sm-err{ color:#ff8a6a; font-size:13px; }
.sm-ok{ margin-top:20px; background:rgba(47,208,107,.12); border:1px solid rgba(47,208,107,.4); border-radius:14px; padding:20px; color:#a7f3c8; font-size:14px; }
.sm-fineprint{ font-size:11.5px; color:#7f9684; text-align:center; }
@media (max-width:760px){ .sm-contact{ grid-template-columns:1fr; } }

/* ---- footer ---- */
.sm-foot{ border-top:1px solid rgba(255,255,255,.08); padding:64px 22px 34px; max-width:1200px; margin:0 auto; }
.sm-foot-big{ font-family:'Anton',sans-serif; font-size:clamp(38px,9.5vw,128px); line-height:.95; letter-spacing:-.01em;
  background:linear-gradient(100deg, rgba(238,245,234,.18), rgba(184,255,77,.45)); -webkit-background-clip:text; background-clip:text; color:transparent; }
.sm-foot-row{ display:flex; justify-content:space-between; gap:24px; flex-wrap:wrap; margin-top:40px; border-top:1px solid rgba(255,255,255,.08); padding-top:28px; }
.sm-foot-name{ font-weight:700; }
.sm-foot-addr{ font-size:13px; color:var(--mut); margin-top:6px; max-width:380px; line-height:1.5; }
.sm-foot-links{ display:flex; gap:18px; align-items:center; flex-wrap:wrap; }
.sm-foot-links a{ color:var(--mut); text-decoration:none; font-size:13.5px; }
.sm-foot-links a:hover{ color:var(--lime); }
.sm-foot-links button{ background:transparent; border:1px solid rgba(255,255,255,.25); color:var(--ink);
  padding:8px 16px; border-radius:999px; font-size:13px; font-family:inherit; }
.sm-foot-links button:hover{ border-color:var(--lime); color:var(--lime); }
.sm-foot-bot{ margin-top:30px; font-size:12px; color:#6f857a; }

@media (prefers-reduced-motion:reduce){
  .sm-w, .sm-rise, [data-reveal]{ transition:none !important; transform:none !important; opacity:1 !important; }
  .sm-marquee-track, .sm-scroll span, .sm-intro-bar i{ animation:none !important; }
  .sm-hero-bigta, .sm-glow{ transform:none !important; }
}
`;
