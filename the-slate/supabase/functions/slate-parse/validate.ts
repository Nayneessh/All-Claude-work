// Pure post-processing of the model's answer. The model is NEVER trusted: every field must (a) be of the right type/enum,
// and (b) be backed by a quote that really occurs in the user's text — unless it is explicitly flagged as inferred.
export type Kind = 'mandate' | 'candidate';
export interface Raw { fields?: Record<string, unknown>; evidence?: Record<string, string>; inferred?: string[]; ambiguous?: Record<string, string>; missing?: string[]; unused?: string[] }
export interface Ctx { today?: string; levels?: string[]; sources?: string[]; agencies?: string[]; companies?: string[]; mandates?: { id: string; title: string; company: string | null }[] }
export interface Out { fields: Record<string, unknown>; inferred: string[]; ambiguous: Record<string, string>; missing: string[]; unused: string[]; dropped: string[] }

const MANDATE = { title: 's', company: 's', stakeholder: 's', level: 's', positions: 'n', location: 's', work_mode: 'e:WFO,Hybrid,Remote', reporting_to: 's', span: 's', budget: 's', urgency: 'e:Low,Medium,High,Critical',
  confidential: 'b', received_on: 'd', started_on: 'd', target_close: 'd', consultants: 'a' } as const;
const CANDIDATE = { name: 's', current_company: 's', designation: 's', phone: 's', email: 's', source: 's', current_ctc: 's', expected_ctc: 's', additional_benefits: 's', notice_period: 's', current_location: 's', open_to_relocate: 'b', mandate_id: 's' } as const;
export const REQUIRED: Record<Kind, string[]> = { mandate: ['title', 'company'], candidate: ['name'] };
const RECOMMENDED: Record<Kind, string[]> = { mandate: ['location', 'level', 'positions', 'urgency', 'budget', 'reporting_to', 'work_mode', 'started_on', 'target_close'], candidate: ['mandate_id', 'current_company', 'designation', 'current_location', 'current_ctc', 'expected_ctc', 'notice_period', 'source', 'phone', 'email'] };

const norm = (s: string) => s.toLowerCase().replace(/[\s,.;:!?"'’“”()\-–—]+/g, ' ').trim();
export const quoted = (text: string, evidence: unknown): boolean => typeof evidence === 'string' && evidence.trim().length >= 2 && norm(text).includes(norm(evidence));

export function validate(kind: Kind, text: string, raw: Raw, ctx: Ctx): Out {
  const spec: Record<string, string> = kind === 'mandate' ? MANDATE : CANDIDATE;
  const inferred = new Set((raw.inferred ?? []).filter((k) => k in spec));
  const ambiguous: Record<string, string> = Object.fromEntries(Object.entries(raw.ambiguous ?? {}).filter(([k, v]) => k in spec && typeof v === 'string').map(([k, v]) => [k, String(v).slice(0, 300)]));
  const fields: Record<string, unknown> = {}; const dropped: string[] = [];
  for (const [k, v] of Object.entries(raw.fields ?? {})) {
    const t = spec[k]; if (!t || v === null || v === undefined || v === '') continue;
    let val: unknown = null;
    if (t === 's') val = typeof v === 'string' ? v.trim().slice(0, 200) : null;
    else if (t === 'n') { const n = Number(v); val = Number.isInteger(n) && n >= 1 && n <= 500 ? n : null; }
    else if (t === 'b') val = typeof v === 'boolean' ? v : null;
    else if (t === 'd') val = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    else if (t === 'a') val = Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 120)).slice(0, 10) : null;
    else if (t.startsWith('e:')) val = t.slice(2).split(',').includes(String(v)) ? v : null;
    if (val === null || (Array.isArray(val) && val.length === 0)) { dropped.push(k); continue; }
    // list-bound fields
    if (k === 'level' && ctx.levels?.length && !ctx.levels.includes(String(val))) { dropped.push(k); continue; }
    if (k === 'source' && ctx.sources?.length) { const m = ctx.sources.find((s) => s.toLowerCase() === String(val).toLowerCase()); if (!m) { val = ctx.sources.find((s) => s.toLowerCase() === 'other') ?? null; if (val === null) { dropped.push(k); continue; } inferred.add(k); ambiguous[k] = 'Not in your source list'; } else val = m; }
    if (k === 'mandate_id' && !(ctx.mandates ?? []).some((m) => m.id === val)) { dropped.push(k); continue; }
    if (k === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(val))) { dropped.push(k); continue; }
    // anti-fabrication: stated values need a quote that is really in the text
    if (!inferred.has(k) && k !== 'mandate_id') {
      const ev = raw.evidence?.[k];
      if (!quoted(text, ev) && !(t === 'd' && /today|tomorrow|next|week|month|day|\d/.test(String(ev ?? '')) && quoted(text, ev))) { dropped.push(k); continue; }
    }
    fields[k] = val;
  }
  // phone/email must literally appear in the text
  for (const k of ['phone', 'email'] as const) if (k in fields && !norm(text).replace(/ /g, '').includes(norm(String(fields[k])).replace(/ /g, ''))) { delete fields[k]; dropped.push(k); }
  const missing = [...REQUIRED[kind], ...RECOMMENDED[kind]].filter((k) => fields[k] === undefined);
  return { fields, inferred: [...inferred].filter((k) => k in fields), ambiguous: Object.fromEntries(Object.entries(ambiguous).filter(([k]) => k in fields || dropped.includes(k))), missing,
    unused: (raw.unused ?? []).filter((x) => typeof x === 'string').map((x) => x.slice(0, 120)).slice(0, 8), dropped };
}
