import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

describe('design tokens', () => {
  it('defines the three brand colours exactly', () => {
    const css = readFileSync(join(__dirname, 'tokens.css'), 'utf8');
    expect(css).toMatch(/--gold:\s*#D4AF37/i);
    expect(css).toMatch(/--night-green:\s*#071F16/i);
    expect(css).toMatch(/--night-blue:\s*#0B1630/i);
  });
  it('keeps raw colour values out of components, screens and domain code', () => {
    const offenders: string[] = [];
    for (const f of walk(root)) {
      if (!/\.(tsx?|css)$/.test(f) || f.includes('/brand/') || f.endsWith('.test.ts') || f.includes('/test/') || f.includes('seed/')) continue;
      const hits = readFileSync(f, 'utf8').match(HEX);
      if (hits) offenders.push(`${f.replace(root, 'src')}: ${hits.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });
  it('theme.css only uses tokens or the three rgba glows derived from them', () => {
    const css = readFileSync(join(__dirname, 'theme.css'), 'utf8');
    expect(css.match(HEX)).toBeNull();
  });
});
