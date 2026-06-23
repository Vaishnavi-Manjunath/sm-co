// Auto-version the service worker cache name — run as the last build step.
//
// Vite gives every built JS/CSS file a content hash in its filename (e.g.
// app-9fb73ec5.js). We hash those filenames into a short token and write it into
// the built service workers as  const CACHE = 'smco-<token>'.  The token changes
// exactly when the shipped code changes, so returning staff always get the new
// version — and nobody ever has to hand-bump smco-vNN again.
//
// Source file frontend/public/sw.js keeps a placeholder ('smco-dev'); this script
// only rewrites the COPIES under dist/. If no built assets are found it fails the
// build loudly rather than shipping a stale, unchanging cache name.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

function assetNames(dir) {
  const assets = `${dir}/assets`;
  return existsSync(assets) ? readdirSync(assets) : [];
}

const names = [...assetNames('dist'), ...assetNames('dist/app')].sort();
if (names.length === 0) {
  console.error('stamp-sw: no built assets found under dist/ — did the Vite build run first?');
  process.exit(1);
}

const token = createHash('sha1').update(names.join('|')).digest('hex').slice(0, 10);
const cache = `smco-${token}`;

let stamped = 0;
for (const sw of ['dist/sw.js', 'dist/app/sw.js']) {
  if (!existsSync(sw)) continue;
  const src = readFileSync(sw, 'utf8');
  const out = src.replace(/const CACHE = '[^']*';/, `const CACHE = '${cache}';`);
  if (out === src) { console.error(`stamp-sw: could not find the CACHE line in ${sw}`); process.exit(1); }
  writeFileSync(sw, out);
  console.log(`stamp-sw: ${sw} -> ${cache}`);
  stamped++;
}
if (stamped === 0) { console.error('stamp-sw: no service worker files found under dist/'); process.exit(1); }
