import type { DateStr } from '../../lib/time';
import type { Urgency, WorkMode } from '../types';
import { AMOUNT, clean, consume, dateAfter, findCities, leftovers, norm, parseDatePhrase, tidyAmount, withinDuration, wordToNum, type ParseResult } from './common';

export interface MandateInput {
  title: string; company: string; stakeholder: string; level: string; positions: number; location: string; work_mode: WorkMode | '';
  reporting_to: string; span: string; budget: string; urgency: Urgency; confidential: boolean; received_on: string; started_on: string; target_close: string;
  consultants: string[]; notes: string;
}
export interface MandateParseContext { today: DateStr; levels?: string[]; companies?: string[]; agencies?: string[] }
const REQUIRED = ['title', 'company'];
const RECOMMENDED = ['location', 'level', 'positions', 'urgency', 'budget', 'reporting_to', 'work_mode', 'started_on', 'target_close'];

const LEVEL_RULES: { re: RegExp; label: string }[] = [
  { re: /\b(ceo|cfo|coo|cto|cmo|chro|cio|cpo|cxo|chief)\b/i, label: 'CXO / C-suite' },
  { re: /\b(president|managing director|md|bu head|business head|country head|business unit head)\b/i, label: 'President / MD / BU Head' },
  { re: /\b(svp|evp|senior vice president|vice president|vp)\b/i, label: 'SVP / VP' },
  { re: /\b(avp|assistant vice president|senior manager|sr\.? manager|associate vice president)\b/i, label: 'AVP / Sr. Manager' },
  { re: /\b(director|head of|head)\b/i, label: 'Director' },
  { re: /\bmanager\b/i, label: 'Manager' },
];

export function parseMandateText(raw: string, ctx: MandateParseContext): ParseResult<MandateInput> {
  const text = norm(raw);
  const f: Partial<MandateInput> = {};
  const inferred: string[] = []; const ambiguous: Record<string, string> = {};
  let rest = ' ' + text + ' ';

  // --- title + company: "<title> for|at|with <company>" is the first clause
  const firstClause = text.split(/[,;]/)[0];
  const cleaned = firstClause.replace(/^(?:new\s+)?(?:mandate|requirement|opening|position|role)\s*[:\-–]?\s*/i, '').replace(/^(?:we\s+)?(?:need|require|looking\s+for|hiring|hire|find)\s+(?:a|an|the)?\s*/i, '');
  const tc = cleaned.match(/^(.+?)\s+(?:for|at|with)\s+(.+)$/i);
  if (tc) {
    f.title = clean(tc[1]);
    const co = clean(tc[2].replace(/\s+(?:reporting|report|budget|located|based|in|immediate|urgent|confidential)\b.*$/i, ''));
    const known = ctx.companies?.find((c) => c.toLowerCase() === co.toLowerCase());
    f.company = known ?? co;
    rest = consume(rest, firstClause);
  } else if (cleaned) {
    f.title = clean(cleaned.replace(/\b(?:mandate|requirement)\b/i, ''));
    rest = consume(rest, firstClause);
  }

  // --- reporting line
  const rep = text.match(/\b(?:reporting|reports?)\s+to\s+(?:the\s+)?([^,;]+?)(?=\s*(?:,|;|\.\s|\.$)|\s+(?:budget|with|and|located|based|urgent|immediate|confidential|for)\b|$)/i);
  if (rep) { f.reporting_to = clean(rep[1]); rest = consume(rest, rep[0]); }
  const span = text.match(/\b(?:span(?:\s+of\s+control)?|team\s+size|team\s+of|managing)\s*(?:is|of|:)?\s*(\d+\+?(?:\s*(?:people|reportees|members|fte|direct reports))?)/i);
  if (span) { f.span = clean(span[1]); rest = consume(rest, span[0]); }

  // --- budget
  const bud = text.match(new RegExp(`\\bbudget\\s*(?:of|is|around|approx\\.?|up\\s+to|upto|:)?\\s*(${AMOUNT})`, 'i'));
  if (bud) { f.budget = tidyAmount(bud[1]); rest = consume(rest, bud[0]); }
  else {
    const loose = text.match(new RegExp(`\\b(\\d[\\d,]*(?:\\.\\d+)?\\s*(?:lakhs?|lacs?|lpa|cr|crores?))\\b`, 'i'));
    if (loose) { f.budget = tidyAmount(loose[1]); inferred.push('budget'); ambiguous.budget = `"${loose[1]}" was read as the budget — please confirm`; rest = consume(rest, loose[0]); }
  }

  // --- positions
  const pos = text.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:open\s+)?(?:positions?|openings?|vacanc(?:y|ies)|headcounts?|seats?)\b/i);
  if (pos) { const n = wordToNum(pos[1]); if (n && n >= 1) { f.positions = n; rest = consume(rest, pos[0]); } }

  // --- urgency (never guessed beyond the words used)
  if (/\b(critical|emergency|code red)\b/i.test(text)) { f.urgency = 'Critical'; rest = consume(rest, text.match(/\b(?:critical|emergency|code red)(?:\s+(?:priority|requirement|mandate|hire))?/i)?.[0]); }
  else if (/\b(immediate(?:ly)?|urgent(?:ly)?|asap|top priority|high priority|fast[- ]?track)\b/i.test(text)) {
    f.urgency = 'High'; inferred.push('urgency');
    const w = text.match(/\b(immediate(?:ly)?|urgent(?:ly)?|asap|top priority|high priority|fast[- ]?track)\b/i)![1];
    ambiguous.urgency = `"${w}" was read as High urgency — choose Critical if it is an emergency`;
    rest = consume(rest, text.match(/\b(?:immediate(?:ly)?|urgent(?:ly)?|asap|top priority|high priority|fast[- ]?track)(?:\s+(?:requirement|need|hire|mandate|priority))?/i)?.[0]);
  } else if (/\b(low priority|not urgent|no rush)\b/i.test(text)) { f.urgency = 'Low'; rest = consume(rest, text.match(/\b(?:low priority|not urgent|no rush)\b/i)?.[0]); }
  else if (/\b(medium priority|normal priority|standard priority)\b/i.test(text)) { f.urgency = 'Medium'; rest = consume(rest, text.match(/\b(?:medium|normal|standard) priority\b/i)?.[0]); }

  // --- confidential / advertised
  if (/\b(not\s+(?:to\s+be\s+)?advertis\w*|do\s*n'?t\s+advertis\w*|confidential|stealth|discreet)\b/i.test(text)) {
    f.confidential = true; rest = consume(rest, text.match(/\b(?:confidential(?:\s+mandate)?|stealth(?:\s+mandate)?|discreet|not\s+(?:to\s+be\s+)?advertis\w*|do\s*n'?t\s+advertis\w*)/i)?.[0]);
  } else if (/\b(open\s+for\s+advertis\w*|can\s+be\s+advertis\w*|advertis(?:e|ed|ement|ing)\s+(?:ok|allowed|fine))\b/i.test(text)) {
    f.confidential = false; rest = consume(rest, text.match(/\b(?:open\s+for\s+advertis\w*|can\s+be\s+advertis\w*|advertis\w*(?:\s+(?:ok|allowed|fine))?)/i)?.[0]);
  }

  // --- work mode
  const wm = text.match(/\b(hybrid|remote|work\s+from\s+home|wfh|wfo|work\s+from\s+office|on-?site|in[- ]office)\b/i);
  if (wm) { const w = wm[1].toLowerCase(); f.work_mode = w === 'hybrid' ? 'Hybrid' : /remote|home|wfh/.test(w) ? 'Remote' : 'WFO'; rest = consume(rest, wm[0]); }

  // --- location
  const loc = findCities(text);
  const inLoc = text.match(/\b(?:based\s+in|located\s+in|location\s*[:\-]?)\s+([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)?)/);
  if (loc.length) { f.location = loc.join(', '); for (const c of loc) rest = rest.replace(new RegExp(`\\b${c}\\b`, 'i'), ' '); }
  else if (inLoc) { f.location = clean(inLoc[1]); inferred.push('location'); ambiguous.location = `"${inLoc[1]}" is not a known city — please check`; rest = consume(rest, inLoc[0]); }

  // --- hiring manager, consultants
  const hm = text.match(/\b(?:hiring\s+manager|hm)\s*(?:is|:|-)?\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
  if (hm) { f.stakeholder = clean(hm[1]); rest = consume(rest, hm[0]); }
  const cons: string[] = [];
  for (const a of ctx.agencies ?? []) if (new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) cons.push(a);
  const cm = text.match(/\b(?:via|through|shared\s+with|assigned\s+to|with|using)\s+(?:external\s+)?(?:consultant|agency|recruiter|partner)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})/);
  if (cm && !cons.some((c) => c.toLowerCase() === clean(cm[1]).toLowerCase())) cons.push(clean(cm[1]));
  if (cons.length) { f.consultants = cons; for (const c of cons) rest = rest.replace(new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' '); if (cm) rest = consume(rest, cm[0]); }

  // --- dates
  const rec = dateAfter(text, /\b(?:received|came\s+in|got\s+it)\b/i, ctx.today);
  if (rec) { f.received_on = rec.date; rest = consume(rest, rec.matched); }
  const st = dateAfter(text, /\b(?:start(?:ing|ed|s)?|work\s+start|kick[- ]?off|begin(?:s|ning)?)\b/i, ctx.today);
  if (st) { f.started_on = st.date; rest = consume(rest, st.matched); }
  const tgt = dateAfter(text, /\b(?:target(?:\s+close)?|close(?:\s+by)?|closure|deadline|fill\s+by|finish\s+by)\b/i, ctx.today);
  if (tgt) { f.target_close = tgt.date; rest = consume(rest, tgt.matched); }
  else {
    const within = withinDuration(text, f.started_on ?? ctx.today);
    if (within) { f.target_close = within.date; inferred.push('target_close'); ambiguous.target_close = `"${within.matched}" was counted from ${f.started_on ? 'the start date' : 'today'}`; rest = consume(rest, within.matched); }
  }
  if (!f.started_on && /\b(?:start|begin)\s+(?:immediately|now|today)\b/i.test(text)) { f.started_on = ctx.today; inferred.push('started_on'); }
  if (f.received_on && !parseDatePhrase(f.received_on, ctx.today)) delete f.received_on;

  // --- level, inferred from the title only when the user did not state it
  const stated = text.match(/\b(?:level|band|grade)\s*(?:is|:)?\s*([A-Za-z/ .-]{2,30})/i);
  if (stated) { f.level = clean(stated[1]); rest = consume(rest, stated[0]); }
  else if (f.title) {
    for (const r of LEVEL_RULES) {
      if (r.re.test(f.title)) {
        if (!ctx.levels || ctx.levels.includes(r.label)) { f.level = r.label; inferred.push('level'); ambiguous.level = `Inferred from the title "${f.title}"`; }
        break;
      }
    }
  }

  const missing = [...REQUIRED, ...RECOMMENDED].filter((k) => (f as Record<string, unknown>)[k] === undefined);
  return { fields: f, inferred, ambiguous, missing, unused: leftovers(rest.replace(/\s+/g, ' ')), source: 'rules' };
}
