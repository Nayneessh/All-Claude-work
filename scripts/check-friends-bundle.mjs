// Privacy guard for the "friends" edition.
//
//   node scripts/check-friends-bundle.mjs <dir>      <dir> = a built web bundle (dist/) or the web assets unpacked from an APK
//
// Exits 1 if anything from the author's own routine (src/data/seed/routineV6.ts) is found in <dir>.
// The marker list is derived from that file itself — every distinctive string literal in it that no other source file also uses
// (exercise names and ids shared with the public library are deliberately not markers) — so it cannot drift out of date.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = join(ROOT, 'src/data/seed/routineV6.ts');
const TEXT_EXT = new Set(['.js', '.mjs', '.css', '.html', '.json', '.map', '.txt', '.svg', '.webmanifest']);
/** Always checked, in addition to the derived list. */
const FIXED = ['Arms First', 'Chest = Back', 'Load my v6 routine', 'routineV6'];
const MIN_DERIVED = 10; // if extraction finds fewer, the seed layout changed and this guard needs attention — fail loudly rather than pass vacuously

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

function literals(src) {
  const found = new Set();
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\$]|\\.)*)`/g;
  for (let m; (m = re.exec(src)); ) {
    const s = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\(['"`\\])/g, '$1');
    if (s.length >= 14) found.add(s);
  }
  return found;
}

export function derivedMarkers() {
  const others = walk(join(ROOT, 'src'))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && resolve(f) !== SEED)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  return [...literals(readFileSync(SEED, 'utf8'))].filter((s) => !others.includes(s));
}

/** The text as it may appear in a minified bundle: raw, and with non-ASCII escaped the way some minifiers emit it. */
function variants(s) {
  const esc = s.replace(/\P{ASCII}/gu, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return esc === s ? [s] : [s, esc];
}

export function findLeaks(dir, markers) {
  const hits = [];
  const files = walk(dir);
  for (const f of files) {
    if (/routineV6/i.test(f)) hits.push({ file: f, marker: '(file name)' });
    if (!TEXT_EXT.has(extname(f).toLowerCase())) continue;
    const text = readFileSync(f, 'utf8');
    for (const m of markers) if (variants(m).some((v) => text.includes(v))) hits.push({ file: f, marker: m });
  }
  return { hits, scanned: files.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node scripts/check-friends-bundle.mjs <dir>'); process.exit(2); }
  const derived = derivedMarkers();
  if (derived.length < MIN_DERIVED) { console.error(`only ${derived.length} markers could be derived from the routine seed (need ${MIN_DERIVED}) — update scripts/check-friends-bundle.mjs`); process.exit(2); }
  const markers = [...new Set([...FIXED, ...derived])];
  const { hits, scanned } = findLeaks(resolve(dir), markers);
  if (hits.length) {
    console.error(`FAIL: ${hits.length} trace(s) of the owner's routine in ${dir}`);
    for (const h of hits.slice(0, 20)) console.error(`  ${h.file.replace(resolve(dir), '.')}  ←  ${JSON.stringify(h.marker.slice(0, 60))}`);
    process.exit(1);
  }
  console.log(`friends bundle clean: ${scanned} files scanned for ${markers.length} markers from the routine seed — none found`);
}
