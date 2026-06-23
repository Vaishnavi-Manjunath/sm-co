// Render smoke-test: loads each page in headless Chrome and asserts the React app
// actually mounted (#root has children) with no uncaught error. Catches white-screens
// that return HTTP 200 but crash in JS — the failure mode that took the site down.
// Used both locally (before deploy) and by the scheduled monitor (against the live site).
// Usage: node scripts/smoke.mjs https://smand.co
import { chromium } from 'playwright';

const base  = (process.argv[2] || 'http://localhost:4178').replace(/\/$/, '');
const PATHS = ['/', '/app/'];

async function check(browser, path) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
  try { await page.goto(base + path, { waitUntil: 'load', timeout: 25000 }); }
  catch (e) { errs.push('GOTO: ' + e.message); }
  await page.waitForTimeout(2000);
  const kids = await page.evaluate(() => document.getElementById('root')?.childElementCount || 0);
  await page.close();
  // A blank #root or an uncaught exception/navigation failure = down. (401s from
  // authed probes on the logged-out app are normal and ignored.)
  const fatal = errs.some(e => e.startsWith('PAGEERROR') || e.startsWith('GOTO'));
  return { ok: kids > 0 && !fatal, kids, errs };
}

const browser = await chromium.launch({ channel: 'chrome' });
let failed = false;
for (const path of PATHS) {
  let r = await check(browser, path);
  if (!r.ok) { await new Promise(s => setTimeout(s, 5000)); r = await check(browser, path); }  // retry once (ignore transient blips)
  console.log(`${path.padEnd(7)} root=${r.kids}  ${r.ok ? '✅ RENDERED' : '❌ FAIL'}`);
  if (!r.ok) { r.errs.forEach(e => console.log('     ' + e)); failed = true; }
}
await browser.close();
console.log(failed ? '\n=== SMOKE FAILED ===' : '\n=== SMOKE PASSED ===');
process.exit(failed ? 1 : 0);
