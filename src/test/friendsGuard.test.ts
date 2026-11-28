import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/** The privacy guard for the friends edition must be able to fail: prove it does on a bundle that contains the routine, and passes on one that does not. */
const GUARD = join(process.cwd(), 'scripts/check-friends-bundle.mjs');
const SEED = readFileSync(join(process.cwd(), 'src/data/seed/routineV6.ts'), 'utf8');
const dirs: string[] = [];
function bundle(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), 'mg-guard-'));
  dirs.push(d);
  mkdirSync(join(d, 'assets'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(d, 'assets', name), text);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('check-friends-bundle', () => {
  it('passes on a bundle that has nothing from the routine', () => {
    const d = bundle({ 'index.js': 'console.log("Start with a clean slate");' });
    expect(execFileSync('node', [GUARD, d]).toString()).toMatch(/friends bundle clean/);
  });

  it('fails when the routine seed itself is in the bundle', () => {
    const d = bundle({ 'chunk.js': SEED });
    const r = spawnSync('node', [GUARD, d]);
    expect(r.status).toBe(1);
    expect(r.stderr.toString()).toMatch(/trace\(s\) of the owner's routine/);
  });

  it('fails on a single distinctive routine string, and on a routine chunk by its file name', () => {
    expect(spawnSync('node', [GUARD, bundle({ 'a.js': 'x="Tuesday — Chest #1 · Delts #1 · Triceps #1"' })]).status).toBe(1);
    expect(spawnSync('node', [GUARD, bundle({ 'routineV6-abc123.js': 'export{}' })]).status).toBe(1);
  });

  it('also catches the text when a minifier escaped the non-ASCII characters', () => {
    const escaped = 'x="Tuesday \\u2014 Chest #1 \\u00b7 Delts #1 \\u00b7 Triceps #1"';
    expect(spawnSync('node', [GUARD, bundle({ 'a.js': escaped })]).status).toBe(1);
  });
});
