import { beforeAll, describe, expect, it } from 'vitest';
import { seedDemo } from '@/data/demo';
import { extractText } from '@/docs/extract';
import { makeCtx } from '@/test/helpers';
import { dashboard, latestAssessments } from './analytics';
import { assessmentPdf, comparisonPdf, comparisonWorkbook, dashboardWorkbook, pdfSafe, screeningWorkbook, type AssessmentExport } from './exports';
import type { Ctx } from './ctx';
import type { Mandate, Rubric } from '@/domain/types';

let ctx: Ctx; let mandate: Mandate; let rubric: Rubric; let rows: ReturnType<typeof latestAssessments>;
beforeAll(async () => {
  ctx = await makeCtx(); await seedDemo(ctx);
  mandate = (await ctx.repo.list('mandates')).find((m) => m.title.startsWith('VP'))!;
  rubric = (await ctx.repo.get('rubrics', mandate.activeRubricId!))!;
  rows = latestAssessments({ assessments: await ctx.repo.list('assessments'), candidates: await ctx.repo.list('candidates'), mandates: [mandate], decisions: [] });
});

const readXlsx = async (b: Blob) => { const E = (await import('exceljs')).default; const wb = new E.Workbook(); await wb.xlsx.load(await b.arrayBuffer()); return wb; };
const pdfText = async (b: Blob): Promise<string> => (await extractText('pdf', new Uint8Array(await b.arrayBuffer()))).pages.map((p) => p.text).join('\n');

describe('Excel', () => {
  it('screening workbook ranks candidates by score and carries the rubric, in the brand colours', async () => {
    const wb = await readXlsx(await screeningWorkbook({ mandate, rows, rubric }));
    const ws = wb.getWorksheet('Screening')!;
    expect(String(ws.getCell(1, 1).value)).toMatch(/VP – Procurement/);
    expect(ws.getCell(4, 1).fill).toMatchObject({ fgColor: { argb: 'FF0B3D2E' } });
    expect((ws.getCell(4, 1).font as { color?: { argb?: string } }).color?.argb).toBe('FFD4AF37');
    const scores = [5, 6, 7, 8].map((r) => Number(ws.getCell(r, 7).value));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(ws.getCell(5, 2).value).toBe('Aarav Mehta');
    expect(wb.getWorksheet('Rubric')!.rowCount).toBeGreaterThan(8);
  });
  it('comparison shows points per criterion, n/e for Not Evident, totals and gates', async () => {
    const items = rows.slice(0, 3).map((r) => ({ candidate: r.candidate, assessment: r.assessment, status: r.status }));
    const ws = (await readXlsx(await comparisonWorkbook({ mandate, rubric, items }))).getWorksheet('Comparison')!;
    const col = (r: number) => items.map((_, i) => String(ws.getCell(r, i + 3).value));
    expect(ws.getCell(4, 3).value).toBe(items[0].candidate.name);
    expect(col(5)[0]).toMatch(/^\d+(\.\d+)?\/25$|^n\/e$/);
    const totalRow = Array.from({ length: ws.rowCount }, (_, i) => i + 1).find((r) => ws.getCell(r, 1).value === 'Total score')!;
    expect(col(totalRow).map(Number)).toEqual(items.map((i) => i.assessment.score.total));
  });
  it('dashboard workbook has summary, entity and mandate sheets', async () => {
    const d = dashboard({ mandates: [mandate], candidates: rows.map((r) => r.candidate), jobs: await ctx.repo.list('processing_jobs'), assessments: await ctx.repo.list('assessments'), decisions: [], entities: await ctx.repo.list('entities'), departments: [] });
    const wb = await readXlsx(await dashboardWorkbook(d));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'By entity', 'By mandate']);
  });
});

describe('PDF', () => {
  const build = async (): Promise<AssessmentExport> => {
    const r = rows.find((x) => x.candidate.name === 'Aarav Mehta')!;
    return { mandate, rubric, candidate: r.candidate, assessment: r.assessment, status: r.status, doc: await ctx.repo.get('candidate_documents', r.assessment.documentId) };
  };
  it('assessment report is a real PDF with the score, gates and the three evidence layers', async () => {
    const blob = await assessmentPdf(await build());
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    const t = await pdfText(blob);
    expect(t).toContain('Candidate Screening Report');
    expect(t).toContain('Aarav Mehta');
    expect(t).toContain('Mandatory requirements');
    expect(t).toMatch(/CV evidence/);
    expect(t).toMatch(/AI interpretation/);
    expect(t).toMatch(/Verification/);
    expect(t).toMatch(/Internal screening status - not a hiring decision/);
  });
  it('comparison PDF lists every candidate', async () => {
    const items = rows.slice(0, 3).map((r) => ({ candidate: r.candidate, assessment: r.assessment, status: r.status }));
    const t = await pdfText(await comparisonPdf({ mandate, rubric, items }));
    for (const i of items) expect(t).toContain(i.candidate.name.split(' ')[0]);
  });
  it('pdfSafe keeps the Indian rupee and symbols readable instead of garbling them', () => {
    expect(pdfSafe('₹650 crore ≥ 15 years → strong • “ok”')).toBe('Rs.650 crore >= 15 years -> strong - "ok"');
    expect(pdfSafe('日本語')).toBe('???');
  });
});
