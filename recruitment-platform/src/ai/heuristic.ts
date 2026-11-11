import type {
  AiProvider, AssessmentModelOutput, AssessRequest, ExtractedProfile, ExtractRequest, RubricDraft, RubricRequest,
} from '@/domain/contract';
import { analyseChronology, evaluateExperienceGate, seniorityLevel } from '@/domain/chronology';
import { extractionConfidence } from '@/domain/validate';
import type { EvidenceRef, GateDef, ProviderInfo, RubricCriterion } from '@/domain/types';
import {
  CERT_VOCAB, DATE_RANGE, EMAIL_RE, PHONE_RE, evidenceFrom, findAchievements, findIndustries, findLocation, findName, hasDegree,
  INDUSTRY_VOCAB, parseCertifications, parseEducation, parseEmployment, parseSkills, splitSections, toLines, type Line,
} from './text';

/**
 * Offline rules engine. It satisfies the same AiProvider contract as a hosted model, so the whole product runs without
 * an API key, in tests, and as a fallback. It is deliberately conservative: it only reports what keyword + context
 * evidence supports, treats absence as Not Evident, and never rates 0 from silence. A hosted model reads nuance this engine
 * cannot — which is why every result still passes through the validation layer and human review.
 */

export const HEURISTIC_INFO: ProviderInfo = { id: 'heuristic', model: 'offline-rules-1', promptVersion: 'heuristic-2026-11-v1' };

// ───────────────────────── Keyword matching ─────────────────────────
const STOP = new Set(('about above across after again against also among and are around because been before being between both but can could '
  + 'deliver delivered delivering demonstrable each ensure experience for from further have having into its more most must need other over '
  + 'own role same should some strong such than that the their them then there these they this those through under until upon very were what '
  + 'when where which while will with within would years year your including level large step change group define build drive lead '
  + 'governance govern develop capability across using based work working skills skill ability').split(/\s+/));

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stem = (w: string): string => (w.length >= 8 ? w.slice(0, w.length - 3) : w.length >= 6 ? w.slice(0, w.length - 1) : w);

/** Prefix-stem matcher so "negotiation" finds "negotiated", "negotiations"; phrases keep their word order. */
export function keywordRegex(kw: string): RegExp {
  const words = kw.toLowerCase().split(/[\s/-]+/).filter(Boolean);
  const body = words.map((w) => (w.length >= 5 ? `${esc(stem(w))}\\w*` : `${esc(w)}\\b`)).join('[\\s/-]+');
  return new RegExp(`\\b${body}`, 'i');
}

const compile = (kws: string[]): { kw: string; re: RegExp }[] => kws.filter((k) => k.trim()).map((kw) => ({ kw, re: keywordRegex(kw) }));

export function significantWords(text: string, max = 6): string[] {
  const seen = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z][a-z&-]{4,}/g) ?? []) if (!STOP.has(w)) seen.add(w);
  return [...seen].slice(0, max);
}

const FN_VOCAB: Record<string, string[]> = {
  procurement: ['procurement', 'sourcing', 'purchasing', 'purchase', 'vendor management', 'supplier', 'category management', 'buyer'],
  'supply chain': ['supply chain', 'logistics', 'planning', 'warehousing', 'inventory', 'distribution', 'sourcing'],
  finance: ['finance', 'accounting', 'treasury', 'audit', 'financial planning', 'controller', 'tax', 'budgeting'],
  operations: ['operations', 'plant', 'production', 'manufacturing', 'lean', 'quality', 'maintenance'],
  technology: ['technology', 'engineering', 'software', 'architecture', 'cloud', 'platform', 'data'],
  marketing: ['marketing', 'brand', 'campaign', 'digital marketing', 'communications'],
  sales: ['sales', 'business development', 'key account', 'revenue', 'channel'],
  hr: ['human resources', 'talent', 'recruitment', 'compensation', 'learning', 'people strategy'],
  legal: ['legal', 'compliance', 'contracts', 'litigation', 'regulatory'],
};

function functionKeywords(fn: string, title: string): string[] {
  const hay = `${fn} ${title}`.toLowerCase();
  const out = new Set<string>();
  for (const [k, v] of Object.entries(FN_VOCAB)) if (hay.includes(k)) v.forEach((x) => out.add(x));
  for (const w of significantWords(`${fn} ${title}`, 6)) out.add(w);
  return [...out].filter((w) => !/^(vice|president|senior|manager|head|director|chief|officer)$/i.test(w)).slice(0, 12);
}

const LEADERSHIP_KW = ['lead', 'led', 'team', 'people', 'organisation', 'organization', 'reports', 'head', 'director', 'strategy', 'stakeholder', 'transformation', 'budget'];
const ACHIEVEMENT_KW = ['saving', 'savings', 'saved', 'reduced', 'reduction', 'cut', 'delivered', 'achieved', 'increased', 'improved', 'grew', 'growth', 'cost'];

// ───────────────────────── Rubric generation ─────────────────────────
const sentence = (s: string): string => s.replace(/\s+/g, ' ').replace(/[.;:,\s]+$/, '').trim();
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
const shorten = (s: string, n = 64): string => {
  let t = sentence(s).replace(/^(?:define|own|build|govern|drive|deliver|lead|manage|develop|ensure|oversee|set|create)(?:\s+and\s+\w+)?\s+(?:a|an|the)?\s*/i, '');
  // Keep the noun phrase: cut at the first clause break.
  t = t.split(/\s+(?:across|including|through|within|via|for|with|to)\s+|[,:;]/)[0].trim() || t;
  if (t.length > n) {
    const cut = t.slice(0, n);
    t = cut.slice(0, Math.max(cut.lastIndexOf(' '), 20));
  }
  return cap(t.replace(/\s+(?:and|of|the|a|an|in|on)$/i, ''));
};

function jdBullets(jd: string): { responsibilities: string[]; requirements: string[]; first: string } {
  const responsibilities: string[] = [];
  const requirements: string[] = [];
  let bucket: string[] | undefined;
  let first = '';
  for (const raw of jd.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    if (/^(?:key\s+)?(?:responsibilit|role\s+purpose|purpose|duties)/i.test(t)) { bucket = /responsibilit|duties/i.test(t) ? responsibilities : undefined; continue; }
    if (/^(?:requirements?|qualifications?|must\s+have|skills|who\s+you\s+are)/i.test(t)) { bucket = requirements; continue; }
    const b = /^\s*(?:[-•·*▪●]|\d+[.)])\s+(.*)$/.exec(raw);
    if (b && bucket) bucket.push(sentence(b[1]));
    else if (!first && t.split(/\s+/).length > 6) first = sentence(t);
  }
  return { responsibilities, requirements, first };
}

function degreeKeywords(education: string): string[] {
  const out = new Set<string>();
  const e = education.toLowerCase();
  if (/mba|pgdm|post[- ]?graduate|master/.test(e)) ['MBA', 'PGDM', 'postgraduate', 'master'].forEach((x) => out.add(x));
  if (/b\.?tech|b\.?e\b|engineer/.test(e)) ['B.Tech', 'B.E.', 'engineering', 'bachelor'].forEach((x) => out.add(x));
  if (/ca\b|chartered/.test(e)) ['CA', 'Chartered Accountant'].forEach((x) => out.add(x));
  if (/ph\.?d|doctor/.test(e)) ['PhD', 'doctorate'].forEach((x) => out.add(x));
  if (/bachelor|graduate|degree/.test(e)) ['bachelor', 'degree', 'B.Com', 'B.Sc'].forEach((x) => out.add(x));
  for (const w of significantWords(education, 4)) out.add(w);
  return [...out];
}

function industryKeywords(names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    out.add(n);
    const v = INDUSTRY_VOCAB.find(([label]) => label.toLowerCase().includes(n.toLowerCase()) || n.toLowerCase().includes(label.toLowerCase().split(' ')[0]));
    if (v) v[1].source.replace(/\\b|\(|\)|\?:|\\w\*/g, '').split('|').forEach((s) => { const w = s.replace(/[^a-z &-]/gi, '').trim(); if (w.length >= 4) out.add(w); });
  }
  return [...out].slice(0, 10);
}

export function buildRubricDraft(req: RubricRequest): RubricDraft {
  const m = req.mandate;
  const jd = jdBullets(m.jdText);
  const fnKw = functionKeywords(m.function, m.title);
  const fnName = m.function || m.title;

  const leadershipBullets = jd.responsibilities.filter((r) => /\b(lead|team|organi[sz]ation|leaders|people)\b/i.test(r));
  const achievementBullets = jd.responsibilities.filter((r) => /\b(saving|cost|optimi[sz]ation|demonstrable|results?|outcomes?)\b/i.test(r) && !leadershipBullets.includes(r));
  const compBullets = [
    ...m.competencies,
    ...jd.responsibilities.filter((r) => !leadershipBullets.includes(r) && !achievementBullets.includes(r)),
  ].filter((v, i, a) => v.trim() && a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i).slice(0, 4);

  const criteria: RubricDraft['criteria'] = [];
  const mk = (c: Omit<RubricDraft['criteria'][number], 'verification'> & { verification?: string }): void => {
    criteria.push({ verification: 'Confirm scope, ownership and outcomes at interview.', ...c });
  };

  mk({
    category: 'functional_experience', name: `Relevant ${fnName.toLowerCase()} experience`, classification: 'mandatory', weight: 25,
    description: `Depth and recency of hands-on ${fnName.toLowerCase()} experience at or near the level of ${m.title}, measured against the ${m.minExperience}-year minimum.`,
    keywords: fnKw, expectedEvidence: `Roles whose responsibilities are clearly in ${fnName.toLowerCase()}, with tenure, scope and seniority.`,
    guidance: 'Count only relevant years. Rate on depth and seniority of the experience, not on employer name.',
    verification: 'Confirm that the most recent roles carried direct decision-making authority.',
  });

  const inds = [...m.mandatoryIndustries, ...m.preferredIndustries];
  const jdInds = inds.length ? inds : findIndustries(m.jdText);
  mk({
    category: 'industry_experience', name: 'Industry / domain experience',
    classification: m.mandatoryIndustries.length ? 'mandatory' : 'preferred', weight: 15,
    description: jdInds.length
      ? `Exposure to ${jdInds.join(', ')}. Adjacent-industry experience that clearly transfers counts partially.`
      : 'No industry was specified on the mandate. Add one to the mandate or edit this criterion; until then it will usually be Not Evident.',
    keywords: industryKeywords(jdInds), expectedEvidence: 'Employers and roles in the named industries, with years spent in them.',
    guidance: 'Time spent in the industry matters more than the number of employers. Credit transferable adjacent sectors.',
    verification: 'Ask how the candidate\'s industry experience maps to this business.',
  });

  const per = compBullets.length ? Math.floor(20 / compBullets.length) : 0;
  const rem = compBullets.length ? 20 - per * compBullets.length : 0;
  if (compBullets.length) {
    compBullets.forEach((b, i) => mk({
      category: 'core_competencies', name: shorten(b), classification: 'mandatory', weight: per + (i === 0 ? rem : 0),
      description: sentence(b), keywords: significantWords(b, 6),
      expectedEvidence: 'Specific programmes, decisions or results that show the competency in practice, not a skills-list mention.',
      guidance: 'Require context: what was done, at what scale, with what result.',
    }));
  } else {
    mk({
      category: 'core_competencies', name: `Core ${fnName.toLowerCase()} competencies`, classification: 'mandatory', weight: 20,
      description: 'Core technical and functional competencies for the role.', keywords: fnKw,
      expectedEvidence: 'Specific programmes and results demonstrating the core competencies.', guidance: 'Require context, not keywords.',
    });
  }

  mk({
    category: 'leadership', name: 'Leadership and strategic capability', classification: 'mandatory', weight: 15,
    description: sentence(leadershipBullets[0] ?? `Leading a team and shaping ${fnName.toLowerCase()} strategy.`) + (m.teamSize ? `. Expected team size: ${m.teamSize}.` : ''),
    keywords: LEADERSHIP_KW, expectedEvidence: 'Team size and structure, hierarchy led, budget owned, strategy set and stakeholders managed.',
    guidance: 'Rate scale (team, budget) and strategic ownership; do not equate title with leadership.',
    verification: 'Confirm direct reports versus dotted-line, and who set the strategy.',
  });

  mk({
    category: 'achievements', name: 'Achievements and measurable impact', classification: 'mandatory', weight: 15,
    description: sentence(achievementBullets[0] ?? 'Quantified outcomes delivered in prior roles.'),
    keywords: ACHIEVEMENT_KW, expectedEvidence: 'Quantified results: savings, growth, cycle-time, spend managed, programmes delivered.',
    guidance: 'Quantified, attributable results rate higher than general claims. Treat figures as self-reported until verified.',
    verification: 'Validate the baseline, the candidate\'s own contribution and whether the figures are audited.',
  });

  mk({
    category: 'education', name: 'Education and qualifications', classification: m.education ? 'mandatory' : 'desirable', weight: 5,
    description: m.education ? `Required: ${m.education}.` : 'Relevant degree and professional qualifications.',
    keywords: m.education ? degreeKeywords(m.education) : ['MBA', 'degree', 'bachelor', 'master'],
    expectedEvidence: 'Degree, institution and year; professional qualifications.', guidance: 'Judge relevance of the qualification, not the institution\'s prestige. Accept equivalent qualifications.',
    verification: 'Confirm degree and equivalence where the CV is silent.',
  });

  const certs = m.certifications.length ? m.certifications : CERT_VOCAB.filter((c) => new RegExp(`\\b${c}\\b`).test(m.jdText));
  mk({
    category: 'other', name: certs.length ? 'Professional certifications and other requirements' : 'Other mandate-specific requirements',
    classification: 'preferred', weight: 5,
    description: certs.length ? `Preferred certifications: ${certs.join(', ')}.` : `Location (${m.location || 'not specified'}) and any other practical requirements.`,
    keywords: certs.length ? certs : [m.location].filter(Boolean),
    expectedEvidence: 'Certificates, licences or practical fit stated on the CV.', guidance: 'Preferred items improve the score but never gate.',
  });

  // Gates: only what the mandate states as mandatory.
  const gates: RubricDraft['gates'] = [];
  if (m.minExperience > 0) {
    gates.push({
      type: 'min_experience', name: `Minimum ${m.minExperience} years relevant experience`, requirement: `At least ${m.minExperience} years of relevant ${fnName.toLowerCase()} experience.`,
      keywords: fnKw, years: m.minExperience, verification: 'Confirm start and end dates and that the roles were in the function.',
    });
  }
  if (m.education.trim()) {
    gates.push({
      type: 'qualification', name: 'Required qualification', requirement: m.education, keywords: degreeKeywords(m.education),
      verification: 'Confirm degree, awarding body and equivalence.',
    });
  }
  for (const ind of m.mandatoryIndustries) {
    gates.push({ type: 'industry', name: `Industry: ${ind}`, requirement: `Experience in ${ind}.`, keywords: industryKeywords([ind]), verification: 'Confirm years and roles in this industry.' });
  }

  const roleIntelligence = {
    purpose: jd.first || `Lead the ${fnName.toLowerCase()} function as ${m.title}.`,
    responsibilities: jd.responsibilities.slice(0, 10),
    mandatory: gates.map((g) => g.requirement),
    preferred: [...m.preferredIndustries.map((i) => `Industry exposure: ${i}`), ...m.certifications.map((c) => `Certification: ${c}`)],
    competencies: compBullets,
    industry: jdInds,
    leadership: leadershipBullets.length ? leadershipBullets : [m.teamSize ? `Team size: ${m.teamSize}` : 'Leadership of a team and function'],
    scale: [m.budget ? `Budget: ${m.budget}` : '', ...jd.requirements.filter((r) => /spend|budget|crore|million|revenue|scale/i.test(r))].filter(Boolean),
    achievements: achievementBullets.length ? achievementBullets : ['Quantified, attributable results'],
    progression: [`Progression into ${m.title}-level responsibility`],
    practical: [m.location ? `Location: ${m.location}` : '', m.priority ? `Priority: ${m.priority}` : ''].filter(Boolean),
  };

  return { roleIntelligence, criteria, gates };
}

// ───────────────────────── Extraction ─────────────────────────
export function buildProfile(req: ExtractRequest): ExtractedProfile {
  const lines = toLines(req.pages);
  const sections = splitSections(lines);
  const all = lines.map((l) => l.text).join('\n');

  const expLines = sections.get('experience') ?? lines.filter((l) => !hasDegree(l.text) || DATE_RANGE.test(l.text) === false);
  let employment = parseEmployment(sections.has('experience') ? sections.get('experience')! : expLines);
  if (employment.length === 0 && sections.has('experience')) employment = [];

  const eduLines = sections.get('education') ?? lines.filter((l) => hasDegree(l.text));
  const education = parseEducation(eduLines);

  const contactLines = lines.slice(0, 12);
  const email = contactLines.map((l) => EMAIL_RE.exec(l.text)?.[0]).find(Boolean);
  const phoneLine = contactLines.find((l) => { const m = PHONE_RE.exec(l.text.replace(EMAIL_RE, '')); return m && m[0].replace(/\D/g, '').length >= 10; });
  const phone = phoneLine ? PHONE_RE.exec(phoneLine.text.replace(EMAIL_RE, ''))![0].trim() : undefined;

  const latest = [...employment].sort((a, b) => ((b.end === 'present' ? '9999-12' : b.end ?? '') > (a.end === 'present' ? '9999-12' : a.end ?? '') ? 1 : -1))[0];

  return {
    name: findName(lines),
    email, phone,
    location: findLocation(lines),
    currentDesignation: latest?.title || undefined,
    currentCompany: latest?.company || undefined,
    employment,
    education,
    certifications: parseCertifications(sections.get('certifications') ?? [], all),
    skills: parseSkills(sections.get('skills') ?? []),
    industries: findIndustries(all),
    achievements: findAchievements(lines.filter((l) => !sections.get('education')?.includes(l))),
  };
}

// ───────────────────────── Assessment ─────────────────────────
const METRIC_LINE = /(?:₹|rs\.?|inr|usd|\$)\s?[\d,.]+|\b\d+(?:\.\d+)?\s?%|\b\d+\s?(?:crores?|cr\b|lakhs?|million|mn|billion|bn)\b|\b(?:team|staff|people|reports|buyers|members)\s+of\s+\d+|\b\d+\s+(?:people|buyers|suppliers|plants|members|reports)\b/i;
const ACTION_LINE = /\b(led|lead|managed|delivered|achieved|saved|reduced|increased|improved|grew|negotiated|built|launched|implemented|drove|established|transformed|owned?|responsible|handled|introduced|cut)\b/i;

interface Hit { line: Line; kws: string[]; quantified: boolean; acts: boolean }

function findHits(kws: { kw: string; re: RegExp }[], lines: Line[]): Hit[] {
  const hits: Hit[] = [];
  for (const line of lines) {
    if (line.text.length < 12 || line.text.length > 600) continue;
    const found = kws.filter((k) => k.re.test(line.text)).map((k) => k.kw);
    if (!found.length) continue;
    hits.push({ line, kws: found, quantified: METRIC_LINE.test(line.text), acts: ACTION_LINE.test(line.text) });
  }
  return hits.sort((a, b) =>
    (b.kws.length + (b.quantified ? 1.5 : 0) + (b.acts ? 0.5 : 0)) - (a.kws.length + (a.quantified ? 1.5 : 0) + (a.acts ? 0.5 : 0)));
}

const clamp5 = (n: number): 1 | 2 | 3 | 4 | 5 => Math.max(1, Math.min(5, Math.round(n))) as 1 | 2 | 3 | 4 | 5;

function teamSizeIn(text: string): number {
  let max = 0;
  for (const m of text.matchAll(/\b(?:team|staff|people|reports|organi[sz]ation|buyers|members)\s+of\s+(\d{1,4})\b|\b(\d{1,4})\s+(?:people|buyers|reports|members|team members|employees|fte)\b/gi)) {
    max = Math.max(max, +(m[1] ?? m[2]));
  }
  return max;
}

const SELF_REPORT = 'Quantified claims are self-reported — confirm scope and authority.';

/** One line per distinct question; the same boilerplate across many criteria collapses into a single general line. */
function verificationList(criteria: AssessmentModelOutput['criteria'], named: (id: string) => string, flags: string[]): string[] {
  const out: string[] = [];
  const seen = new Map<string, string[]>();
  let selfReported = false;
  for (const c of criteria) {
    if (c.rating === null || !c.verification) continue;
    let v = c.verification;
    if (v.includes(SELF_REPORT)) { selfReported = true; v = v.replace(SELF_REPORT, '').trim(); }
    if (!v) continue;
    seen.set(v, [...(seen.get(v) ?? []), named(c.criterionId)]);
  }
  for (const [text, names] of seen) {
    out.push(names.length === 1 ? `${names[0]}: ${text}` : `${names[0]} and ${names.length - 1} other criteri${names.length === 2 ? 'on' : 'a'}: ${text}`);
  }
  if (selfReported) out.push(SELF_REPORT);
  return [...out.slice(0, 6), ...flags.slice(0, 3)];
}

export function assessWith(req: AssessRequest, now: Date): AssessmentModelOutput {
  const lines = toLines(req.pages);
  const profile = req.profile;
  const fnCriterion = req.rubric.criteria.find((c) => c.category === 'functional_experience');
  const fnKw = compile(fnCriterion?.keywords ?? []);
  const roleText = (e: { title: string; description: string; company: string }): string => `${e.title} ${e.description}`;
  const isRelevant = (e: { title: string; company: string; start?: string; end?: string }): boolean => {
    const full = profile.employment.find((x) => x.company === e.company && x.title === e.title);
    return fnKw.length === 0 || fnKw.some((k) => k.re.test(roleText(full ?? { ...e, description: '' })));
  };
  const chron = analyseChronology(profile.employment, now, isRelevant);
  const allText = lines.map((l) => l.text).join('\n');
  const conf = extractionConfidence({ ...profile, name: profile.name || 'Redacted Candidate' }, { textLength: allText.length, ocrRequired: false });

  const criteria: AssessmentModelOutput['criteria'] = req.rubric.criteria.map((c) => assessCriterion(c, lines, profile, chron, req, fnKw, allText));
  const gates: AssessmentModelOutput['gates'] = req.rubric.gates.map((g) => assessGate(g, lines, profile, chron, conf, allText));

  const named = (id: string): string => req.rubric.criteria.find((c) => c.id === id)?.name ?? id;
  const strong = criteria.filter((c) => (c.rating ?? 0) >= 4);
  const weak = criteria.filter((c) => c.rating !== null && c.rating <= 2);
  const missing = criteria.filter((c) => c.rating === null);

  return {
    criteria,
    gates,
    summary: `Offline rules assessment against ${req.rubric.criteria.length} criteria and ${req.rubric.gates.length} mandatory requirement(s). `
      + `${strong.length} criteria show strong evidence, ${weak.length} limited evidence and ${missing.length} could not be evidenced from the CV. `
      + `Relevant experience found: ${chron.relevantYears} years of ${chron.totalYears} total.`,
    strengths: strong.map((c) => { const q = c.evidence[0]?.quote ?? ''; return `${named(c.criterionId)} — ${q ? (q.length > 140 ? `${q.slice(0, 137).trimEnd()}…` : q) : 'strong alignment'}`; }),
    gaps: weak.map((c) => `${named(c.criterionId)} — only limited evidence on the CV`),
    missingInformation: missing.map((c) => `${named(c.criterionId)} — not evident on the CV (this is not a finding of non-compliance)`),
    verificationQuestions: verificationList(criteria, named, chron.flags),
    recommendedAction: 'Review the evidence and verification questions before progressing.',
  };
}

function assessCriterion(
  c: Pick<RubricCriterion, 'id' | 'category' | 'name' | 'keywords' | 'verification' | 'description'>,
  lines: Line[],
  profile: ExtractedProfile,
  chron: ReturnType<typeof analyseChronology>,
  req: AssessRequest,
  fnKw: { kw: string; re: RegExp }[],
  allText: string,
): AssessmentModelOutput['criteria'][number] {
  const kws = compile(c.keywords);
  const notEvident = (why: string): AssessmentModelOutput['criteria'][number] => ({
    criterionId: c.id, rating: null, evidence: [], confidence: 0.6,
    interpretation: `${why} Not Evident is not a finding of non-compliance.`, verification: c.verification || 'Ask the candidate directly.',
  });

  // Education is read from the structured profile, not from keyword lines.
  if (c.category === 'education') {
    if (profile.education.length === 0) return notEvident('No qualification could be read from the CV.');
    const match = profile.education.filter((e) => kws.some((k) => k.re.test(`${e.qualification} ${e.institution ?? ''}`)));
    const ev: EvidenceRef[] = (match.length ? match : profile.education).slice(0, 2).map((e) => e.ref ?? { quote: e.qualification });
    const rating = match.length ? (match.length > 1 || profile.education.some((e) => /ph\.?d|doctor/i.test(e.qualification)) ? 4 : 3) : 2;
    return {
      criterionId: c.id, rating, evidence: ev, confidence: 0.75,
      interpretation: match.length ? 'A qualification matching the requirement is stated.' : 'Qualifications are stated but none clearly matches the requirement; equivalence should be confirmed.',
      verification: c.verification,
    };
  }

  const hits = findHits(kws, lines);
  if (hits.length === 0) return notEvident(`No CV text addresses "${c.name}".`);
  const top = hits.slice(0, 3);
  const evidence = top.map((h) => evidenceFrom(h.line));
  const quantified = hits.filter((h) => h.quantified).length;
  const distinct = new Set(hits.flatMap((h) => h.kws)).size;
  const roles = profile.employment.filter((e) => kws.some((k) => k.re.test(`${e.title} ${e.description}`))).length;
  let rating: number;
  let note: string;

  switch (c.category) {
    case 'functional_experience': {
      const need = Math.max(req.mandate.minExperience, 1);
      const ratio = chron.relevantYears / need;
      rating = ratio >= 1.4 ? 5 : ratio >= 1.15 ? 4 : ratio >= 1 ? 3 : ratio >= 0.7 ? 2 : 1;
      if (hits.length < 2) rating = Math.min(rating, 3);
      note = `${chron.relevantYears} years of relevant experience found against a ${req.mandate.minExperience}-year benchmark; ${roles} role(s) in the function.`;
      break;
    }
    case 'industry_experience': {
      const years = chron.relevantYears;
      const indRoles = profile.employment.filter((e) => kws.some((k) => k.re.test(`${e.company} ${e.title} ${e.description}`))).length;
      rating = indRoles >= 3 ? 5 : indRoles === 2 ? 4 : indRoles === 1 ? 3 : 2;
      if (hits.length < 2 && rating > 3) rating = 3;
      note = `Industry-relevant text appears in ${indRoles} role(s) (${years} relevant functional years overall).`;
      break;
    }
    case 'leadership': {
      const team = teamSizeIn(allText);
      const level = Math.max(0, ...profile.employment.map((e) => seniorityLevel(e.title)));
      rating = 1 + (hits.length >= 3 ? 1 : 0) + (team >= 40 ? 1 : team >= 15 ? 0.5 : 0) + (team >= 100 ? 1 : 0) + (level >= 6 ? 1 : level >= 4 ? 0.5 : 0);
      note = `${team ? `Largest team stated: ${team}. ` : 'No team size stated. '}Highest title level reached: ${level || 'unclear'}.`;
      break;
    }
    case 'achievements': {
      const q = profile.achievements.length;
      rating = q >= 5 ? 5 : q >= 3 ? 4 : q >= 1 ? 3 : 2;
      note = `${q} quantified achievement(s) extracted from the CV.`;
      break;
    }
    case 'other': {
      // Presence of a preferred certification / practical requirement meets it; more of them is stronger.
      const found = new Set(hits.flatMap((h) => h.kws)).size;
      rating = found >= Math.max(2, kws.length) ? 4 : 3;
      note = `${found} of ${kws.length} listed item(s) found on the CV.`;
      break;
    }
    default: {
      rating = 1 + (hits.length >= 2 || distinct >= 2 ? 1 : 0) + (roles >= 2 || hits.length >= 3 ? 1 : 0) + (quantified >= 1 ? 1 : 0) + (distinct >= Math.max(3, kws.length * 0.6) && quantified >= 2 ? 1 : 0);
      note = `${hits.length} relevant statement(s) across ${roles} role(s); ${distinct} of ${kws.length} keywords evidenced; ${quantified} quantified.`;
    }
  }
  if (fnKw.length === 0 && c.category === 'functional_experience') rating = Math.min(rating, 3);

  const r = clamp5(rating);
  return {
    criterionId: c.id, rating: r, evidence,
    confidence: Math.min(0.9, 0.55 + 0.1 * Math.min(hits.length, 3) + (quantified ? 0.05 : 0)),
    interpretation: `${note} Rated ${r}/5 on keyword-in-context evidence; a hosted model or recruiter should confirm nuance.`,
    verification: quantified ? `${c.verification} ${SELF_REPORT}` : c.verification,
  };
}

function assessGate(
  g: Pick<GateDef, 'id' | 'type' | 'name' | 'keywords' | 'years' | 'requirement' | 'verification'>,
  lines: Line[],
  profile: ExtractedProfile,
  chron: ReturnType<typeof analyseChronology>,
  conf: number,
  allText: string,
): AssessmentModelOutput['gates'][number] {
  const kws = compile(g.keywords);
  const unclear = (note: string): AssessmentModelOutput['gates'][number] => ({ gateId: g.id, status: 'needs_verification', evidence: [], note: `${note} ${g.verification}`.trim() });

  switch (g.type) {
    case 'min_experience': {
      const res = evaluateExperienceGate(g.years ?? 0, chron, conf, 'relevant');
      const ev = profile.employment.slice(0, 3).map((e) => e.ref).filter((r): r is EvidenceRef => !!r);
      return { gateId: g.id, status: res.status, evidence: ev, note: res.note };
    }
    case 'qualification': {
      const m = profile.education.filter((e) => kws.some((k) => k.re.test(`${e.qualification} ${e.institution ?? ''}`)));
      if (m.length) return { gateId: g.id, status: 'pass', evidence: m.slice(0, 2).map((e) => e.ref ?? { quote: e.qualification }), note: 'A qualification matching the requirement is stated.' };
      return unclear(profile.education.length ? 'Qualifications are stated but none clearly meets the requirement; equivalence is for a person to judge.' : 'No qualification could be read from the CV.');
    }
    case 'location': {
      if (profile.location && kws.some((k) => k.re.test(profile.location!))) return { gateId: g.id, status: 'pass', evidence: [{ quote: profile.location }], note: 'Stated location matches.' };
      return unclear('Location could not be confirmed from the CV.');
    }
    default: {
      const hits = findHits(kws, lines);
      if (hits.length) return { gateId: g.id, status: 'pass', evidence: hits.slice(0, 2).map((h) => evidenceFrom(h.line)), note: 'Evidence of the requirement found on the CV.' };
      return unclear(allText.length < 300 ? 'The CV text is too short to confirm this.' : 'The requirement is not evident on the CV.');
    }
  }
}

// ───────────────────────── Provider ─────────────────────────
export function createHeuristicProvider(opts: { now?: () => Date } = {}): AiProvider {
  const now = opts.now ?? ((): Date => new Date());
  return {
    info: HEURISTIC_INFO,
    async generateRubric(req) { return buildRubricDraft(req); },
    async extractProfile(req) { return buildProfile(req); },
    async assessCandidate(req) { return assessWith(req, now()); },
  };
}
