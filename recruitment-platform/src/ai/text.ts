import type { Achievement, EducationEntry, Employment, EvidenceRef, PageText } from '@/domain/types';

/** Deterministic CV text utilities used by the offline engine. No network, no model. */

export interface Line { page: number; n: number; text: string }

export function toLines(pages: PageText[]): Line[] {
  const out: Line[] = [];
  let n = 0;
  for (const p of pages) {
    for (const raw of p.text.split(/\r?\n/)) {
      n++;
      const text = raw.replace(/\u00a0/g, ' ').trim();
      if (text) out.push({ page: p.page, n, text });
    }
  }
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MON = '(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?';
const POINT = `(?:${MON}\\s+\\d{4}|\\d{1,2}[/.-]\\d{4}|\\d{4})`;
const END = `(?:${POINT}|present|current|till\\s+date|to\\s+date|date|now|ongoing)`;
export const DATE_RANGE = new RegExp(`(${POINT})\\s*(?:-|–|—|to|till|until)\\s*(${END})`, 'i');

const pad = (n: number): string => String(n).padStart(2, '0');

export function parsePoint(token: string, isEnd: boolean): string | 'present' | undefined {
  const t = token.trim().toLowerCase();
  if (/^(present|current|till\s+date|to\s+date|date|now|ongoing)$/.test(t)) return 'present';
  let m = /^([a-z]+)\.?\s+(\d{4})$/.exec(t);
  if (m && MONTHS[m[1].slice(0, 4) === 'sept' ? 'sept' : m[1].slice(0, 3)]) return `${m[2]}-${pad(MONTHS[m[1].slice(0, 4) === 'sept' ? 'sept' : m[1].slice(0, 3)])}`;
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${pad(+m[1])}`;
  m = /^(\d{4})$/.exec(t);
  if (m && +m[1] >= 1950 && +m[1] <= 2100) return `${m[1]}-${isEnd ? '12' : '01'}`;
  return undefined;
}

// ───────────────────────── Sections ─────────────────────────
type Section = 'summary' | 'experience' | 'education' | 'certifications' | 'skills' | 'achievements' | 'other';
const HEADERS: [Section, RegExp][] = [
  ['experience', /^(?:professional\s+|work\s+|relevant\s+)?(?:experience|employment(?:\s+history)?|work\s+history|career(?:\s+history|\s+summary)?|positions?\s+held)$/i],
  ['education', /^(?:education(?:al)?(?:\s+(?:qualifications?|background))?|academics?|academic\s+(?:qualifications?|background)|qualifications?)$/i],
  ['certifications', /^(?:certifications?|licen[cs]es?(?:\s+(?:and|&)\s+certifications?)?|professional\s+certifications?|courses|training)$/i],
  ['skills', /^(?:(?:key|core|technical|functional)\s+)?(?:skills|competenc(?:ies|y)|expertise|areas\s+of\s+expertise)$/i],
  ['achievements', /^(?:key\s+|major\s+|notable\s+)?(?:achievements?|accomplishments?|awards?(?:\s+(?:and|&)\s+recognition)?|highlights)$/i],
  ['summary', /^(?:professional\s+|executive\s+|career\s+)?(?:summary|profile|objective|about(?:\s+me)?)$/i],
  ['other', /^(?:personal\s+(?:details|information|particulars)|declaration|references?|hobbies|interests|languages?(?:\s+known)?)$/i],
];
/** Label-style personal fields that sometimes trail a CV with no heading; they must never be read as certifications or skills. */
const PERSONAL_LABEL = /^(?:date\s+of\s+birth|d\.?o\.?b\.?|gender|sex|marital\s+status|nationality|religion|age|father'?s?\s+name|passport)\s*:/i;

export function sectionOf(lineText: string): Section | undefined {
  const t = lineText.replace(/[:\-–—_=*#]+$/g, '').replace(/^[#*\-–—\s]+/, '').trim();
  if (t.length > 48 || !t) return undefined;
  for (const [s, re] of HEADERS) if (re.test(t)) return s;
  return undefined;
}

export function splitSections(lines: Line[]): Map<Section, Line[]> {
  const out = new Map<Section, Line[]>();
  let cur: Section = 'summary';
  let seenHeader = false;
  for (const l of lines) {
    const s = sectionOf(l.text);
    if (s) { cur = s; seenHeader = true; continue; }
    if (PERSONAL_LABEL.test(l.text)) { cur = 'other'; seenHeader = true; }
    if (!seenHeader && !out.has('summary')) out.set('summary', []);
    const arr = out.get(cur) ?? [];
    arr.push(l);
    out.set(cur, arr);
  }
  return out;
}

// ───────────────────────── Contact ─────────────────────────
export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
export const PHONE_RE = /(?:\+?\d{1,3}[\s-]?)?\d[\d\s-]{8,13}\d/;

const CITIES = [
  'mumbai', 'delhi', 'new delhi', 'bengaluru', 'bangalore', 'pune', 'hyderabad', 'chennai', 'kolkata', 'gurgaon', 'gurugram',
  'noida', 'ahmedabad', 'jaipur', 'kochi', 'chandigarh', 'indore', 'nagpur', 'vadodara', 'coimbatore', 'dubai', 'abu dhabi',
  'singapore', 'london', 'new york', 'toronto', 'sydney', 'riyadh', 'doha', 'dhaka', 'colombo', 'kathmandu',
];

export function findLocation(lines: Line[]): string | undefined {
  for (const l of lines.slice(0, 14)) {
    const lab = /^(?:location|address|city|based\s+in|current\s+location)\s*:\s*(.+)$/i.exec(l.text);
    if (lab) return lab[1].split(/[|•·]/)[0].trim();
  }
  for (const l of lines.slice(0, 10)) {
    for (const seg of l.text.split(/[|•·]/)) {
      const s = seg.trim().toLowerCase();
      if (CITIES.some((c) => new RegExp(`\\b${c}\\b`).test(s)) && s.length < 60 && !EMAIL_RE.test(s)) return seg.trim();
    }
  }
  return undefined;
}

const NOT_A_NAME = /(resume|curriculum|vitae|\bcv\b|profile|summary|contact|address|email|phone|mobile|linkedin|objective|experience|education)/i;

export function findName(lines: Line[]): string {
  for (const l of lines.slice(0, 12)) {
    const lab = /^name\s*:\s*(.+)$/i.exec(l.text);
    if (lab) return titleCase(lab[1].trim());
  }
  for (const l of lines.slice(0, 5)) {
    const t = l.text.replace(/^[#*\s]+|[#*\s]+$/g, '');
    const parts = t.split(/\s+/);
    if (parts.length < 2 || parts.length > 4) continue;
    if (/[\d@:|,/()]/.test(t) || NOT_A_NAME.test(t)) continue;
    if (!parts.every((p) => /^[A-Z][A-Za-z.'’-]*$/.test(p) || /^[A-Z.]+$/.test(p))) continue;
    return titleCase(t);
  }
  return '';
}

export const titleCase = (s: string): string =>
  s === s.toUpperCase() ? s.toLowerCase().replace(/(^|\s)(\S)/g, (_m, a: string, b: string) => a + b.toUpperCase()) : s;

// ───────────────────────── Employment ─────────────────────────
const TITLE_WORD = /\b(chief|president|vice\s+president|vp|svp|avp|evp|director|head|general\s+manager|gm|dgm|agm|manager|lead|leader|officer|analyst|engineer|executive|associate|consultant|specialist|coordinator|supervisor|architect|partner|founder|owner|controller|intern|trainee|buyer|planner|ceo|cfo|cto|coo|cpo|cmo|chro)\b/i;
const STRONG_SEP = /\s*(?:\||•|·|\s@\s|\sat\s|,)\s*/;
const BULLET = /^\s*(?:[-•·*▪●◦➢>]|\d+[.)])\s+/;
const LOCATION_ONLY = new RegExp(`^(?:${CITIES.join('|')})(?:,\\s*[a-z ]+)?$`, 'i');
/** Words that make "VP – Procurement" one title rather than "title – company". */
const FUNC_WORDS = new Set(('procurement purchase purchasing sourcing supply chain finance financial operations hr human resources marketing sales technology it '
  + 'logistics strategy strategic planning manufacturing commercial category quality engineering projects project business development digital '
  + 'transformation risk compliance legal admin administration customer service services & and of the').split(/\s+/));

function dashSplit(part: string): string[] {
  const dm = part.split(/\s[-–—]\s/);
  if (dm.length === 1) return [part];
  const left = dm[0];
  const right = dm.slice(1).join(' – ');
  if (TITLE_WORD.test(left) && !TITLE_WORD.test(right)) {
    const words = right.toLowerCase().split(/[\s&,/]+/).filter(Boolean);
    if (words.every((w) => FUNC_WORDS.has(w))) return [part]; // "VP – Procurement" stays one title
    return [left, right]; // "Head of Sourcing – Acme Industries"
  }
  return dm; // "Acme Industries — VP Procurement"
}

function splitRole(text: string): { title?: string; company?: string } {
  const parts = text.split(STRONG_SEP).flatMap(dashSplit)
    .map((p) => p.trim()).filter((p) => p && !LOCATION_ONLY.test(p) && !/^\(?\s*\d/.test(p));
  if (!parts.length) return {};
  const titleIdx = parts.findIndex((p) => TITLE_WORD.test(p) && p.split(/\s+/).length <= 10);
  if (titleIdx === -1) return { company: parts[0] };
  const company = parts.find((_p, i) => i !== titleIdx);
  return { title: parts[titleIdx], company };
}

const clean = (s: string): string => s.replace(/[()[\]]/g, ' ').replace(/\s{2,}/g, ' ').replace(/^[-–—:,|\s]+|[-–—:,|\s]+$/g, '').trim();

export function parseEmployment(lines: Line[]): Employment[] {
  const out: Employment[] = [];
  const isHeaderLine = (l: Line): boolean => DATE_RANGE.test(l.text) && !BULLET.test(l.text);
  const heads = lines.map((l, i) => (isHeaderLine(l) ? i : -1)).filter((i) => i >= 0);

  heads.forEach((hi, k) => {
    const l = lines[hi];
    const m = DATE_RANGE.exec(l.text)!;
    const start = parsePoint(m[1], false);
    const endRaw = parsePoint(m[2], true);
    if (!start || start === 'present') return;
    const rest = clean(l.text.replace(m[0], ' '));

    let title: string | undefined;
    let company: string | undefined;
    const fromRest = rest.length > 2 ? splitRole(rest) : {};
    title = fromRest.title;
    company = fromRest.company;

    // Role/company may sit on the line(s) above ("Company X — VP Procurement" / date on its own line).
    const prev = lines[hi - 1];
    const prevIsHead = prev && (isHeaderLine(prev) || BULLET.test(prev.text) || !!sectionOf(prev.text));
    if ((!title || !company) && prev && !prevIsHead) {
      const p = splitRole(clean(prev.text));
      title = title ?? p.title;
      company = company ?? p.company;
    }
    const prev2 = lines[hi - 2];
    if ((!title || !company) && prev2 && !prevIsHead && !isHeaderLine(prev2) && !BULLET.test(prev2.text) && !sectionOf(prev2.text) && prev2.text.length < 80) {
      const p = splitRole(clean(prev2.text));
      title = title ?? p.title;
      company = company ?? p.company;
    }
    // ...or on the next line when the date line carries only one of them.
    const next = lines[hi + 1];
    if ((!title || !company) && next && !BULLET.test(next.text) && !isHeaderLine(next) && !sectionOf(next.text) && next.text.length < 90) {
      const p = splitRole(clean(next.text));
      title = title ?? p.title;
      company = company ?? p.company;
    }

    const stop = heads[k + 1] ?? lines.length;
    const bodyStart = hi + 1;
    const body: string[] = [];
    for (let i = bodyStart; i < stop; i++) {
      const t = lines[i].text;
      if (sectionOf(t)) break;
      // The line above the next date line is that role's header, not part of this role's description.
      if (i === stop - 1 && heads[k + 1] !== undefined && !BULLET.test(t) && t.length < 80) break;
      body.push(t.replace(BULLET, '').trim());
    }

    out.push({
      company: company ?? '',
      title: title ?? '',
      start,
      end: endRaw ?? 'present',
      description: body.join(' ').slice(0, 1500),
      ref: { page: l.page, quote: l.text.slice(0, 200) },
    });
  });
  return out.filter((e) => e.company || e.title);
}

// ───────────────────────── Education & certifications ─────────────────────────
const DEGREE_LONG = /\b(ph\.?d|doctorate|mba|pgdm|pgpm|post[- ]graduate\s+diploma|m\.?tech|m\.?sc|m\.?com|b\.?tech|b\.?sc|b\.?com|bachelor(?:'s)?(?:\s+of\s+[a-z ]+)?|master(?:'s)?(?:\s+of\s+[a-z ]+)?|diploma|chartered\s+accountant|company\s+secretary|llb|llm|cfa|cpa|icwa|cma)\b/i;
const DEGREE_SHORT = /\b(B\.?E\.?|M\.?E\.?|B\.?A\.?|M\.?A\.?|C\.?A\.?|BBA|MBBS|BCA|MCA)\b/;

export const hasDegree = (s: string): boolean => DEGREE_LONG.test(s) || DEGREE_SHORT.test(s);

export function parseEducation(lines: Line[]): EducationEntry[] {
  const out: EducationEntry[] = [];
  for (const l of lines) {
    const text = l.text.replace(BULLET, '');
    if (DATE_RANGE.test(text) && !hasDegree(text)) continue;
    if (!hasDegree(text)) continue;
    if (text.length > 160) continue;
    const years = [...text.matchAll(/\b(19[5-9]\d|20[0-4]\d)\b/g)].map((m) => +m[1]);
    const stripped = clean(text.replace(/\b(19[5-9]\d|20[0-4]\d)\b/g, ' ').replace(/[-–—]\s*$/, ''));
    const parts = stripped.split(/\s*(?:,|\||–|—|\s-\s|\bfrom\b)\s*/).map((p) => p.trim()).filter(Boolean);
    out.push({
      qualification: parts[0] ?? stripped,
      institution: parts.length > 1 ? parts.slice(1).join(', ') : undefined,
      year: years.length ? years[years.length - 1] : undefined,
      ref: { page: l.page, quote: l.text.slice(0, 200) },
    });
  }
  return out;
}

export const CERT_VOCAB = ['CPSM', 'CSCP', 'CPIM', 'CIPS', 'PMP', 'CPA', 'CFA', 'FRM', 'CMA', 'CISA', 'CISSP', 'ITIL', 'Six Sigma', 'Lean', 'CPP', 'CPM', 'APICS', 'NEBOSH', 'SHRM', 'PRINCE2'];

export function parseCertifications(sectionLines: Line[], allText: string): string[] {
  const found = new Set<string>();
  for (const l of sectionLines) {
    for (const piece of l.text.replace(BULLET, '').split(/[,;|•]/)) {
      const p = piece.trim();
      if (p.length >= 2 && p.length <= 80) found.add(p);
    }
  }
  for (const c of CERT_VOCAB) {
    const already = [...found].some((f) => f.toLowerCase().includes(c.toLowerCase()));
    if (!already && new RegExp(`\\b${c}\\b`).test(allText)) found.add(c);
  }
  return [...found].slice(0, 20);
}

export function parseSkills(sectionLines: Line[]): string[] {
  const out = new Set<string>();
  for (const l of sectionLines) {
    for (const piece of l.text.replace(BULLET, '').replace(/^[A-Za-z &]{3,25}:\s*/, '').split(/[,;|•·]/)) {
      const p = piece.trim();
      if (p.length >= 2 && p.length <= 50) out.add(p);
    }
  }
  return [...out].slice(0, 40);
}

// ───────────────────────── Industries & achievements ─────────────────────────
export const INDUSTRY_VOCAB: [string, RegExp][] = [
  ['Manufacturing', /\bmanufactur\w*/i], ['Automotive', /\b(automotive|automobile|auto components?|oem)\b/i],
  ['Steel & Metals', /\b(steel|metals?|aluminium|aluminum|foundry)\b/i], ['FMCG', /\b(fmcg|consumer goods|packaged goods)\b/i],
  ['Pharma & Healthcare', /\b(pharma\w*|healthcare|hospital|biotech)\b/i], ['Retail', /\bretail\w*/i],
  ['Logistics', /\b(logistics|warehous\w*|freight|shipping)\b/i], ['IT & Software', /\b(software|saas|information technology|it services)\b/i],
  ['Banking & Financial Services', /\b(banking|bfsi|insurance|nbfc|financial services)\b/i], ['Oil & Gas', /\b(oil\s*(?:&|and)\s*gas|petroleum|refinery|petrochemicals?)\b/i],
  ['Power & Energy', /\b(power|energy|renewables?|solar|wind)\b/i], ['Infrastructure & Construction', /\b(infrastructure|construction|epc|real estate)\b/i],
  ['Telecom', /\btelecom\w*/i], ['Chemicals', /\bchemicals?\b/i], ['Textiles', /\b(textiles?|apparel|garments?)\b/i],
  ['Cement', /\bcement\b/i], ['Mining', /\bmining\b/i], ['Aviation', /\b(aviation|aerospace|airline)\b/i],
  ['E-commerce', /\b(e-?commerce|marketplace)\b/i], ['Consumer Durables', /\b(consumer durables?|white goods|appliances?)\b/i],
];

export function findIndustries(text: string): string[] {
  return INDUSTRY_VOCAB.filter(([, re]) => re.test(text)).map(([n]) => n);
}

const METRIC = /(?:₹|rs\.?|inr|usd|\$|eur|€|£)\s?[\d,.]+\s?(?:crores?|cr\b|lakhs?|lacs?|million|mn|m\b|billion|bn|k\b)?|[\d,.]+\s?(?:crores?|cr\b|lakhs?|lacs?|million|mn|billion|bn)\b|\b\d+(?:\.\d+)?\s?%|\b\d{2,}\+?\s?(?:suppliers?|vendors?|people|members|reports|team|employees|fte|plants?|sites?|countries|categories)\b/i;
const ACTION = /\b(led|lead|managed|delivered|achieved|saved|reduced|increased|improved|grew|negotiated|built|launched|implemented|drove|established|transformed|restructured|renegotiated|digitised|digitized|automated|consolidated|oversaw|responsible)\b/i;

export function findAchievements(lines: Line[]): Achievement[] {
  const out: Achievement[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    const t = l.text.replace(BULLET, '');
    if (t.length < 25 || t.length > 400) continue;
    const m = METRIC.exec(t);
    if (!m || !ACTION.test(t) || DATE_RANGE.test(t)) continue;
    const key = t.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: t, metric: m[0].trim(), ref: { page: l.page, quote: t.slice(0, 300) } });
    if (out.length >= 25) break;
  }
  return out;
}

export const evidenceFrom = (l: Line): EvidenceRef => ({ page: l.page, quote: l.text.replace(BULLET, '').slice(0, 300) });
