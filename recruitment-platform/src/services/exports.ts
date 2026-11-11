import type { Alignment, Fill, Font } from 'exceljs';
import { STATUS_LABEL, type Assessment, type Candidate, type CandidateDocument, type Mandate, type Rubric, type ScreeningStatus } from '@/domain/types';
import type { DashData, LatestRow } from './analytics';

/** PDF and Excel exports (plan §4.9) in the product's golden-and-green palette. Lazy-loaded so the main bundle stays light. */

export const BRAND = { green: '0B3D2E', greenMid: '14543F', gold: 'D4AF37', cream: 'F6F0DC', ink: '1B2B24' };
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Standard PDF fonts are Latin-1 only; keep text readable instead of letting glyphs turn into noise. */
export function pdfSafe(s: string): string {
  return s
    .replace(/₹/g, 'Rs.').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/→/g, '->').replace(/[•·]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/…/g, '...').replace(/\u00a0/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0a\x0d\x20-\x7e¡-ÿ–—]/g, '?');
}

const label = (s: ScreeningStatus): string => STATUS_LABEL[s];
const pageRef = (doc: CandidateDocument | undefined, e: { page?: number; paragraph?: number }): string =>
  e.page ? (doc?.mimeType.includes('pdf') ? `p.${e.page}` : `section ${e.page}`) : '';

// ───────────────────────── Excel ─────────────────────────
type Workbook = import('exceljs').Workbook;
type Sheet = import('exceljs').Worksheet;

async function newWorkbook(): Promise<Workbook> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Recruitment Intelligence Platform';
  wb.created = new Date();
  return wb;
}

const headFill: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${BRAND.green}` } };
const headFont: Partial<Font> = { bold: true, color: { argb: `FF${BRAND.gold}` } };
const wrap: Partial<Alignment> = { wrapText: true, vertical: 'top' };

function titleBlock(ws: Sheet, title: string, sub: string, cols: number): void {
  ws.mergeCells(1, 1, 1, cols);
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { bold: true, size: 15, color: { argb: `FF${BRAND.gold}` } };
  ws.getCell(1, 1).fill = headFill;
  ws.mergeCells(2, 1, 2, cols);
  ws.getCell(2, 1).value = sub;
  ws.getCell(2, 1).font = { italic: true, color: { argb: `FF${BRAND.ink}` } };
  ws.getCell(2, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${BRAND.cream}` } };
  ws.getRow(1).height = 26;
}

function table(ws: Sheet, startRow: number, headers: string[], rows: (string | number | null)[][], widths: number[]): void {
  const h = ws.getRow(startRow);
  headers.forEach((t, i) => { const c = h.getCell(i + 1); c.value = t; c.fill = headFill; c.font = headFont; c.alignment = { vertical: 'middle', wrapText: true }; });
  rows.forEach((r, ri) => {
    const row = ws.getRow(startRow + 1 + ri);
    r.forEach((v, i) => { const c = row.getCell(i + 1); c.value = v; c.alignment = wrap; if (ri % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F7F2' } }; });
  });
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: 'frozen', ySplit: startRow }];
}

const toBlob = async (wb: Workbook): Promise<Blob> => new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_MIME });

export interface ScreeningExport { mandate: Mandate; rows: LatestRow[]; rubric?: Rubric }

/** Mandate-wise candidate screening report. */
export async function screeningWorkbook({ mandate, rows, rubric }: ScreeningExport, at = new Date()): Promise<Blob> {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet('Screening');
  titleBlock(ws, `${mandate.code} — ${mandate.title}: candidate screening`, `Mandate v${mandate.version}${rubric ? ` · rubric v${rubric.version}` : ''} · generated ${at.toISOString().slice(0, 10)} · internal screening statuses, not hiring decisions`, 11);
  const sorted = [...rows].sort((a, b) => b.assessment.score.total - a.assessment.score.total);
  table(ws, 4, ['Rank', 'Candidate', 'Code', 'Current designation', 'Current company', 'Experience (yrs)', 'Score /100', 'Status (in force)', 'AI status', 'Mandatory requirements', 'Verification needed'],
    sorted.map((r, i) => [
      i + 1, r.candidate.name, r.candidate.code, r.candidate.currentDesignation ?? '', r.candidate.currentCompany ?? '', r.candidate.totalExperienceYears ?? null,
      r.assessment.score.total, label(r.status), label(r.assessment.status),
      `${r.assessment.gates.filter((g) => g.status === 'pass').length}/${r.assessment.gates.length} passed${r.assessment.gates.some((g) => g.status === 'fail') ? ' — FAILED' : ''}`,
      r.assessment.verificationQuestions.slice(0, 3).join(' | '),
    ]), [6, 24, 12, 26, 26, 12, 10, 24, 24, 24, 60]);
  if (rubric) {
    const rs = wb.addWorksheet('Rubric');
    titleBlock(rs, `Rubric v${rubric.version}`, `Threshold ${rubric.policy.threshold} · borderline review ${rubric.policy.borderlineFloor}–${rubric.policy.threshold - 0.1} · weights total ${rubric.criteria.reduce((a, c) => a + c.weight, 0)}`, 5);
    table(rs, 4, ['Criterion', 'Class', 'Weight', 'Expected CV evidence', 'Guidance'], rubric.criteria.map((c) => [c.name, c.classification, c.weight, c.expectedEvidence, c.guidance]), [38, 12, 9, 50, 50]);
  }
  return toBlob(wb);
}

export interface CompareExport { mandate: Mandate; rubric: Rubric; items: { candidate: Candidate; assessment: Assessment; status: ScreeningStatus }[] }

export async function comparisonWorkbook({ mandate, rubric, items }: CompareExport): Promise<Blob> {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet('Comparison');
  titleBlock(ws, `${mandate.code} — ${mandate.title}: candidate comparison`, 'Points earned / weight per criterion. Not Evident is shown as "n/e" and is not a finding of non-compliance.', items.length + 2);
  const head = ['Criterion', 'Weight', ...items.map((i) => i.candidate.name)];
  const body = rubric.criteria.map((c) => [c.name, c.weight, ...items.map((i) => {
    const l = i.assessment.score.lines.find((x) => x.criterionId === c.id);
    return l && l.rating !== null ? `${l.points}/${c.weight}` : 'n/e';
  })]);
  body.push(['Total score', 100, ...items.map((i) => i.assessment.score.total)]);
  body.push(['Status (in force)', '', ...items.map((i) => label(i.status))]);
  for (const g of rubric.gates) body.push([`Gate: ${g.name}`, '', ...items.map((i) => i.assessment.gates.find((x) => x.gateId === g.id)?.status.replace('_', ' ') ?? '')]);
  body.push(['Extraction confidence', '', ...items.map((i) => `${Math.round(i.assessment.extractionConfidence * 100)}%`)]);
  table(ws, 4, head, body, [40, 9, ...items.map(() => 22)]);
  return toBlob(wb);
}

export async function dashboardWorkbook(d: DashData, at = new Date()): Promise<Blob> {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet('Summary');
  titleBlock(ws, 'Recruitment dashboard', `Generated ${at.toISOString().slice(0, 10)}`, 2);
  table(ws, 4, ['Measure', 'Value'], [
    ['Active mandates', d.mandateCounts.active], ['On hold', d.mandateCounts.onHold], ['Closed', d.mandateCounts.closed],
    ['CVs received', d.cvsReceived], ['CVs screened', d.cvsScreened], ['Qualified (75+ and mandatory gates passed)', d.qualified],
    ['Awaiting review', d.awaitingReview], ['Average score', d.averageScore],
  ], [44, 16]);
  const es = wb.addWorksheet('By entity');
  table(es, 1, ['Entity', 'Mandates', 'CVs', 'Screened', 'Qualified'], d.byEntity.map((e) => [e.entity.name, e.mandates, e.cvs, e.screened, e.qualified]), [30, 10, 10, 10, 10]);
  const ms = wb.addWorksheet('By mandate');
  table(ms, 1, ['Mandate', 'Title', 'Status', 'CVs', 'Screened', 'Qualified', 'Average', 'Best'], d.byMandate.map((m) => [m.mandate.code, m.mandate.title, m.mandate.status, m.cvs, m.screened, m.qualified, m.avg, m.best]), [12, 30, 12, 8, 10, 10, 10, 10]);
  return toBlob(wb);
}

// ───────────────────────── PDF ─────────────────────────
type Pdf = import('jspdf').jsPDF;
interface PdfLib { jsPDF: typeof import('jspdf').jsPDF; autoTable: typeof import('jspdf-autotable').default }
async function pdfLib(): Promise<PdfLib> {
  const [{ jsPDF }, autoTable] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  return { jsPDF, autoTable: autoTable.default };
}

function banner(doc: Pdf, title: string, sub: string): number {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(...rgb(BRAND.green)).rect(0, 0, w, 64, 'F');
  doc.setFillColor(...rgb(BRAND.gold)).rect(0, 64, w, 3, 'F');
  doc.setTextColor(...rgb(BRAND.gold)).setFont('helvetica', 'bold').setFontSize(17).text(pdfSafe(title), 36, 30);
  doc.setTextColor(255, 255, 255).setFont('helvetica', 'normal').setFontSize(9.5).text(pdfSafe(sub), 36, 48);
  doc.setTextColor(...rgb(BRAND.ink));
  return 86;
}

function footer(doc: Pdf, note: string): void {
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...rgb(BRAND.gold)).line(36, h - 30, w - 36, h - 30);
    doc.setFontSize(7.5).setTextColor(110, 120, 114).text(pdfSafe(note), 36, h - 18).text(`Page ${p} of ${n}`, w - 36, h - 18, { align: 'right' });
  }
}

function heading(doc: Pdf, text: string, y: number): number {
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...rgb(BRAND.greenMid)).text(pdfSafe(text), 36, y);
  doc.setTextColor(...rgb(BRAND.ink)).setFont('helvetica', 'normal');
  return y + 8;
}

const styles = { headStyles: { fillColor: rgb(BRAND.green), textColor: rgb(BRAND.gold) }, alternateRowStyles: { fillColor: [244, 247, 242] as [number, number, number] }, styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' as const } };

export interface AssessmentExport {
  mandate: Mandate; rubric: Rubric; candidate: Candidate; assessment: Assessment; status: ScreeningStatus; doc?: CandidateDocument;
  decisions?: { decidedAt: string; originalStatus: ScreeningStatus; newStatus: ScreeningStatus; reason: string }[];
}

/** Full candidate screening report: score, gates, criterion-by-criterion evidence (CV evidence / AI interpretation / verification). */
export async function assessmentPdf(x: AssessmentExport, at = new Date()): Promise<Blob> {
  const { jsPDF, autoTable } = await pdfLib();
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const { mandate, rubric, candidate, assessment: a } = x;
  let y = banner(doc, 'Candidate Screening Report', `${mandate.code} - ${mandate.title}  |  ${candidate.code}  |  generated ${at.toISOString().slice(0, 10)}`);

  autoTable(doc, {
    startY: y, theme: 'plain', styles: { fontSize: 9.5, cellPadding: 3 },
    body: [
      ['Candidate', candidate.name, 'Overall score', `${a.score.total} / 100`],
      ['Current role', `${candidate.currentDesignation ?? '-'}${candidate.currentCompany ? `, ${candidate.currentCompany}` : ''}`, 'Status (in force)', label(x.status)],
      ['Experience', candidate.totalExperienceYears !== undefined ? `${candidate.totalExperienceYears} years (per CV chronology)` : '-', 'AI status', label(a.status)],
      ['Score range', `${a.score.floor} - ${a.score.ceiling} (evidence coverage ${Math.round(a.score.coverage * 100)}%)`, 'Versions', `mandate v${a.mandateVersion}, rubric v${a.rubricVersion}, assessment v${a.version}`],
    ].map((r) => r.map(pdfSafe)),
    columnStyles: { 0: { fontStyle: 'bold', textColor: rgb(BRAND.greenMid), cellWidth: 70 }, 1: { cellWidth: 190 }, 2: { fontStyle: 'bold', textColor: rgb(BRAND.greenMid), cellWidth: 80 } },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;

  y = heading(doc, 'Why this status', y);
  autoTable(doc, { startY: y, theme: 'plain', styles: { fontSize: 9, cellPadding: 2 }, body: [...a.statusReasons, ...a.flags.filter((f) => f.severity !== 'info').map((f) => `Flag: ${f.message}`)].map((s) => [pdfSafe(s)]) });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

  y = heading(doc, 'Mandatory requirements', y);
  autoTable(doc, { startY: y, ...styles, head: [['Requirement', 'Result', 'Note']], body: a.gates.map((g) => [rubric.gates.find((d) => d.id === g.gateId)?.name ?? g.gateId, g.status.replace('_', ' '), g.note].map(pdfSafe)), columnStyles: { 1: { cellWidth: 90 } } });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

  y = heading(doc, 'Criterion scores', y);
  autoTable(doc, {
    startY: y, ...styles, head: [['Criterion', 'Weight', 'Rating', 'Points', 'Assessment']],
    body: rubric.criteria.map((c) => {
      const line = a.score.lines.find((l) => l.criterionId === c.id);
      const ca = a.criteria.find((k) => k.criterionId === c.id);
      return [c.name, String(c.weight), line?.rating === null || line?.rating === undefined ? 'n/e' : `${line.rating}/5`, line?.rating === null || line?.rating === undefined ? '-' : String(line.points), (ca?.state ?? '').replace(/_/g, ' ')].map(pdfSafe);
    }),
    columnStyles: { 1: { cellWidth: 46 }, 2: { cellWidth: 46 }, 3: { cellWidth: 46 } },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

  y = heading(doc, 'Evidence, interpretation and verification', y);
  autoTable(doc, {
    startY: y, ...styles, head: [['Criterion', 'CV evidence', 'AI interpretation', 'Verification']],
    body: rubric.criteria.map((c) => {
      const ca = a.criteria.find((k) => k.criterionId === c.id);
      return [c.name, ca?.evidence.length ? ca.evidence.map((e) => `"${e.quote}" ${pageRef(x.doc, e)}`).join('\n') : 'Not evident on the CV', ca?.interpretation ?? '', ca?.verification ?? ''].map(pdfSafe);
    }),
    columnStyles: { 0: { cellWidth: 80 }, 1: { cellWidth: 170 } },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

  const lists: [string, string[]][] = [['Strengths', a.strengths], ['Gaps', a.gaps], ['Missing or unclear information', a.missingInformation], ['Verification questions', a.verificationQuestions]];
  for (const [t, items] of lists) {
    if (!items.length) continue;
    y = heading(doc, t, y);
    autoTable(doc, { startY: y, theme: 'plain', styles: { fontSize: 9, cellPadding: 2 }, body: items.map((s) => [pdfSafe(`- ${s}`)]) });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  }
  if (x.decisions?.length) {
    y = heading(doc, 'Human decisions', y);
    autoTable(doc, { startY: y, ...styles, head: [['When', 'From', 'To', 'Reason']], body: x.decisions.map((d) => [d.decidedAt.slice(0, 16).replace('T', ' '), label(d.originalStatus), label(d.newStatus), d.reason].map(pdfSafe)) });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  }
  y = heading(doc, 'Recommended next action', y);
  doc.setFontSize(9.5).text(doc.splitTextToSize(pdfSafe(a.recommendedAction), 520), 36, y + 6);

  footer(doc, `Internal screening status - not a hiring decision. ${a.provider.id}/${a.provider.model} (${a.provider.promptVersion}). AI assists; recruiters decide.`);
  return doc.output('blob');
}

export async function comparisonPdf({ mandate, rubric, items }: CompareExport, at = new Date()): Promise<Blob> {
  const { jsPDF, autoTable } = await pdfLib();
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const y = banner(doc, 'Candidate Comparison', `${mandate.code} - ${mandate.title}  |  ${items.length} candidates  |  ${at.toISOString().slice(0, 10)}`);
  const head = ['Criterion', 'Weight', ...items.map((i) => i.candidate.name)];
  const body = rubric.criteria.map((c) => [c.name, String(c.weight), ...items.map((i) => { const l = i.assessment.score.lines.find((x) => x.criterionId === c.id); return l && l.rating !== null ? `${l.points}/${c.weight}` : 'n/e'; })]);
  body.push(['Total score', '100', ...items.map((i) => String(i.assessment.score.total))]);
  body.push(['Status (in force)', '', ...items.map((i) => label(i.status))]);
  for (const g of rubric.gates) body.push([`Gate: ${g.name}`, '', ...items.map((i) => i.assessment.gates.find((x) => x.gateId === g.id)?.status.replace('_', ' ') ?? '')]);
  autoTable(doc, { startY: y, ...styles, head: [head.map(pdfSafe)], body: body.map((r) => r.map(pdfSafe)), columnStyles: { 0: { cellWidth: 170 }, 1: { cellWidth: 46 } } });
  footer(doc, 'n/e = Not Evident on the CV (not a finding of non-compliance). Internal screening statuses, not hiring decisions.');
  return doc.output('blob');
}
