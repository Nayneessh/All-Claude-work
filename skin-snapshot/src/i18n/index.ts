import { en, type Dict } from './en';
import { hi } from './hi';
import type { Lang } from '../core/types';

export type { Dict };
const dicts: Record<Lang, Dict> = { en, hi };

export function getDict(lang: Lang): Dict {
  return dicts[lang] ?? en;
}

/** Replace {name} placeholders. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export interface QDef {
  label: string;
  help?: string;
  opt: Record<string, string>;
}
export function qdef(d: Dict, id: string): QDef {
  return (d.q as unknown as Record<string, QDef>)[id]!;
}

export const LANG_NAMES: Record<Lang, string> = { en: 'English', hi: 'हिन्दी' };
