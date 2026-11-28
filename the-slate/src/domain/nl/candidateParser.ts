import type { DateStr } from '../../lib/time';
import { AMOUNT, clean, consume, findCities, leftovers, norm, tidyAmount, type ParseResult } from './common';

export interface CandidateInput {
  name: string; current_company: string; designation: string; phone: string; email: string; source: string; current_ctc: string; expected_ctc: string;
  additional_benefits: string; notice_period: string; current_location: string; open_to_relocate: boolean | null; mandate_id: string; notes: string;
}
export interface CandidateParseContext {
  today: DateStr; sources: string[];
  mandates?: { id: string; title: string; company: string | null }[];
}
const REQUIRED = ['name'];
const RECOMMENDED = ['mandate_id', 'current_company', 'designation', 'current_location', 'current_ctc', 'expected_ctc', 'notice_period', 'source', 'phone', 'email'];

const SOURCE_SYNONYMS: Record<string, string> = {
  naukri: 'Naukri', linkedin: 'LinkedIn', 'linked in': 'LinkedIn', reference: 'Reference', referral: 'Reference', referred: 'Reference', 'internal database': 'Internal Database',
  'internal db': 'Internal Database', database: 'Internal Database', mapping: 'Mapping', 'cold outreach': 'Cold Outreach', 'cold call': 'Cold Outreach', agency: 'Agency', consultant: 'Agency',
};
const STOP_NAME = /^(?:currently|presently|working|works|is|was|has|based|from|located|ex|former|current|aged|age|and|who|with|at|in|a|an|the)$/i;

export function parseCandidateText(raw: string, ctx: CandidateParseContext): ParseResult<CandidateInput> {
  const text = norm(raw);
  const f: Partial<CandidateInput> = {};
  const inferred: string[] = []; const ambiguous: Record<string, string> = {};
  let rest = ' ' + text + ' ';

  // --- name: the leading run of capitalised words
  const words = text.replace(/^(?:add|new candidate|candidate|profile)\s*[:\-–]?\s*/i, '').split(/\s+/);
  const nameWords: string[] = [];
  for (const w of words) {
    const bare = w.replace(/[,;:]$/, '');
    if (nameWords.length >= 4 || STOP_NAME.test(bare) || !/^\p{Lu}[\p{L}.'’-]*$/u.test(bare)) break;
    nameWords.push(bare);
    if (/[,;:]$/.test(w)) break;
  }
  if (nameWords.length) { f.name = nameWords.join(' '); rest = consume(rest, nameWords.join(' ')); }

  // --- contact
  const email = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (email) { f.email = email[0]; rest = consume(rest, email[0]); }
  const phone = text.match(/(?:\+?91[-\s]?)?\b[6-9]\d{4}[-\s]?\d{5}\b/);
  if (phone) { f.phone = phone[0].replace(/[-\s]/g, ''); rest = consume(rest, phone[0]); }

  // --- compensation
  const cur = text.match(new RegExp(`\\b(?:current|present|existing)\\s*(?:ctc|salary|compensation|fixed|package|comp)\\s*(?:is|of|:|-)?\\s*(${AMOUNT})`, 'i'))
    ?? text.match(new RegExp(`\\b(?:currently\\s+)?(?:drawing|earning|making|on)\\s+(${AMOUNT})`, 'i'));
  if (cur) { f.current_ctc = tidyAmount(cur[1]); rest = consume(rest, cur[0]); }
  const exp = text.match(new RegExp(`\\b(?:expected|expecting|expects|expectation|wants?|asking(?:\\s+for)?|looking\\s+for)\\s*(?:ctc|salary|compensation|fixed|package)?\\s*(?:is|of|:|-)?\\s*(${AMOUNT})`, 'i'));
  if (exp) { f.expected_ctc = tidyAmount(exp[1]); rest = consume(rest, exp[0]); }
  const ben = text.match(/\bbenefits?\s*(?:include|are|:|-)?\s*([^;.]+?)(?=,\s*(?:notice|expect|current|sourced|based|open)|;|\.\s|\.$|$)/i);
  if (ben) { f.additional_benefits = clean(ben[1]); rest = consume(rest, ben[0]); }

  // --- notice period
  const np = text.match(/\bnotice(?:\s+period)?\s*(?:is|of|:|-)?\s*(\d+\s*(?:days?|weeks?|months?)|immediate(?:ly)?|nil|none|serving(?:\s+notice)?)/i)
    ?? text.match(/\b(\d+\s*(?:days?|weeks?|months?))\s+notice\b/i);
  if (np) { f.notice_period = clean(np[1]).replace(/^immediately$/i, 'Immediate'); rest = consume(rest, np[0]); }
  else if (/\bimmediate\s+joiner\b/i.test(text)) { f.notice_period = 'Immediate'; rest = consume(rest, text.match(/\bimmediate\s+joiner\b/i)![0]); }
  else if (/\bserving\s+(?:his|her|their)?\s*notice\b/i.test(text)) { f.notice_period = 'Serving notice'; rest = consume(rest, text.match(/\bserving\s+(?:his|her|their)?\s*notice\b/i)![0]); }

  // --- source
  const src = text.match(/\b(?:sourced|found|source|via|through|from|referred|came)\s*(?:through|via|from|by|on|in)?\s*(naukri|linked\s?in|reference|referral|internal\s+(?:database|db)|database|mapping|cold\s+(?:outreach|call)|agency|consultant)\b/i);
  if (src) {
    const syn = SOURCE_SYNONYMS[src[1].toLowerCase().replace(/\s+/g, ' ')] ?? src[1];
    const match = ctx.sources.find((s) => s.toLowerCase() === syn.toLowerCase());
    if (match) f.source = match; else { f.source = ctx.sources.find((s) => s.toLowerCase() === 'other') ?? syn; inferred.push('source'); ambiguous.source = `"${src[1]}" is not in your source list`; }
    rest = consume(rest, src[0]);
  }

  // --- relocation
  if (/\b(?:not\s+(?:open|willing|ready)\s+to\s+relocat\w*|no\s+relocation|won'?t\s+relocate)\b/i.test(text)) { f.open_to_relocate = false; rest = consume(rest, text.match(/\b(?:not\s+(?:open|willing|ready)\s+to\s+relocat\w*|no\s+relocation|won'?t\s+relocate)\b/i)![0]); }
  else if (/\b(?:open|willing|ready)\s+to\s+relocat\w*/i.test(text)) { f.open_to_relocate = true; rest = consume(rest, text.match(/\b(?:open|willing|ready)\s+to\s+relocat\w*/i)![0]); }

  // --- designation + company: "(currently|working as|is) <designation> at|with <company>"
  const dc = text.match(/\b(?:currently|presently|working|works|is|as)?\s*(?:as\s+)?(?:a\s+|an\s+|the\s+)?([A-Z][A-Za-z&./ -]{1,50}?)\s+(?:at|with|in)\s+([A-Z][A-Za-z0-9&.' -]*?)(?=\s*(?:,|;|\.\s|\.$)|\s+(?:based|located|in|current|expect|notice|sourced|via|from|open)\b|$)/);
  if (dc) {
    const desig = clean(dc[1].replace(/^(?:currently|presently|working|works|is|as)\s+/i, ''));
    const comp = clean(dc[2]);
    if (desig && comp && !findCities(comp).length) { f.designation = desig; f.current_company = comp; rest = consume(rest, dc[0]); }
  }
  if (!f.current_company) {
    const at = text.match(/\b(?:works?|working|employed)\s+(?:at|with|for)\s+([A-Z][A-Za-z0-9&.' -]*?)(?=,|;|\.|$)/);
    if (at) { f.current_company = clean(at[1]); rest = consume(rest, at[0]); }
  }

  // --- location (current): known cities not already used as part of a company/designation
  const cities = findCities(text.replace(f.current_company ?? '', ' ').replace(f.designation ?? '', ' '));
  if (cities.length) { f.current_location = cities[0]; for (const c of cities) rest = rest.replace(new RegExp(`\\b${c}\\b`, 'i'), ' '); if (cities.length > 1) { inferred.push('current_location'); ambiguous.current_location = `Several cities mentioned (${cities.join(', ')}) — the first was used`; } }
  else { const bl = text.match(/\b(?:based|located|living|residing)\s+in\s+([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)?)/); if (bl) { f.current_location = clean(bl[1]); rest = consume(rest, bl[0]); } }

  // --- mandate association (only when it is unambiguous)
  if (ctx.mandates?.length) {
    const low = text.toLowerCase();
    const scored = ctx.mandates.map((m) => {
      const tt = m.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !['the', 'of', 'and', 'for'].includes(w));
      const hit = tt.filter((w) => low.includes(w)).length;
      const co = m.company ? (low.includes(m.company.toLowerCase()) ? 1 : 0) : 0;
      return { m, score: (tt.length ? hit / tt.length : 0) + co * 0.6 };
    }).filter((x) => x.score >= 1).sort((a, b) => b.score - a.score);
    if (scored.length && (scored.length === 1 || scored[0].score > scored[1].score)) { f.mandate_id = scored[0].m.id; inferred.push('mandate_id'); ambiguous.mandate_id = `Matched "${scored[0].m.title}${scored[0].m.company ? ' — ' + scored[0].m.company : ''}" — please confirm`; }
    else if (scored.length > 1) ambiguous.mandate_id = `Could be: ${scored.slice(0, 3).map((x) => x.m.title + (x.m.company ? ' — ' + x.m.company : '')).join(' / ')}`;
  }

  const missing = [...REQUIRED, ...RECOMMENDED].filter((k) => (f as Record<string, unknown>)[k] === undefined || (f as Record<string, unknown>)[k] === '');
  return { fields: f, inferred, ambiguous, missing, unused: leftovers(rest.replace(/\s+/g, ' ')), source: 'rules' };
}
