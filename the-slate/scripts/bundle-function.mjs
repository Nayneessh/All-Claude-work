// Prints a function as a flat {name, content}[] list (imports rewritten from ../_shared/ to ./) for tools that cannot follow
// relative folders. The Supabase CLI (`supabase functions deploy <name>`) deploys the repo layout directly and does not need this.
// Usage: node scripts/bundle-function.mjs notify > bundle.json
import { readFileSync, readdirSync } from 'node:fs';
const name = process.argv[2]; if (!name) { console.error('usage: bundle-function.mjs <function>'); process.exit(2); }
const base = new URL(`../supabase/functions/`, import.meta.url);
const files = [];
for (const f of readdirSync(new URL(`${name}/`, base))) files.push({ name: f, content: readFileSync(new URL(`${name}/${f}`, base), 'utf8').replaceAll("'../_shared/", "'./") });
const src = readFileSync(new URL(`${name}/index.ts`, base), 'utf8') + files.map((f) => f.content).join('\n');
if (src.includes('../_shared/')) for (const s of readdirSync(new URL('_shared/', base))) if (src.includes(`./${s}`)) files.push({ name: s, content: readFileSync(new URL(`_shared/${s}`, base), 'utf8').replaceAll("'../_shared/", "'./") });
console.log(JSON.stringify(files));
