import type { PageText } from '@/domain/types';
import type { FileKind } from './validate';

/** Text extraction (plan §4.5 step 4–5). Original files are always kept; this only reads them. */

export interface Extracted {
  pages: PageText[];
  pageCount: number;
  /** No usable text layer (scanned PDF) — OCR needed. No OCR provider is bundled in this build. */
  ocrRequired: boolean;
  isLegacyDoc: boolean;
  warnings: string[];
}

const MIN_TEXT_CHARS = 80;
const SECTION_LINES = 40;

export async function extractText(kind: FileKind, bytes: Uint8Array): Promise<Extracted> {
  if (kind === 'pdf') return extractPdf(bytes);
  if (kind === 'docx') return extractDocx(bytes);
  return extractLegacyDoc(bytes);
}

// ───────────────────────── PDF ─────────────────────────
type PdfJs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfJs> | undefined;

async function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= (async () => {
    const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
    if (isBrowser) {
      const lib = await import('pdfjs-dist');
      lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      return lib;
    }
    return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs;
  })();
  return pdfjsPromise;
}

interface TextItem { str: string; transform: number[]; hasEOL?: boolean }

async function extractPdf(bytes: Uint8Array): Promise<Extracted> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  const pages: PageText[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = content.items.filter((i): i is TextItem & typeof i => 'str' in i && (i as TextItem).str !== undefined) as TextItem[];
      // Rebuild visual lines: group by baseline (y), then left to right.
      const rows: { y: number; parts: { x: number; s: string }[] }[] = [];
      for (const it of items) {
        if (!it.str.trim() && !it.hasEOL) continue;
        const y = it.transform[5];
        const row = rows.find((r) => Math.abs(r.y - y) < 2.5);
        if (row) row.parts.push({ x: it.transform[4], s: it.str });
        else rows.push({ y, parts: [{ x: it.transform[4], s: it.str }] });
      }
      rows.sort((a, b) => b.y - a.y);
      const text = rows.map((r) => r.parts.sort((a, b) => a.x - b.x).map((x) => x.s).join(' ').replace(/\s{2,}/g, ' ').trim()).filter(Boolean).join('\n');
      pages.push({ page: p, text });
    }
  } finally {
    await doc.destroy();
  }
  const chars = pages.reduce((a, p) => a + p.text.replace(/\s/g, '').length, 0);
  const ocr = chars < MIN_TEXT_CHARS;
  return {
    pages, pageCount: pages.length, ocrRequired: ocr, isLegacyDoc: false,
    warnings: ocr ? ['No text layer found: this looks like a scanned document. OCR is required.'] : [],
  };
}

// ───────────────────────── DOCX ─────────────────────────
function chunkLines(text: string): PageText[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\u00a0/g, ' ').trimEnd());
  const pages: PageText[] = [];
  for (let i = 0; i < lines.length; i += SECTION_LINES) pages.push({ page: pages.length + 1, text: lines.slice(i, i + SECTION_LINES).join('\n') });
  return pages.length ? pages : [{ page: 1, text: '' }];
}

async function extractDocx(bytes: Uint8Array): Promise<Extracted> {
  const mammoth = (await import('mammoth')).default;
  // mammoth's Node build reads `buffer`; its browser build reads `arrayBuffer`.
  const input = typeof Buffer !== 'undefined'
    ? { buffer: Buffer.from(bytes) }
    : { arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
  const res = await mammoth.extractRawText(input as Parameters<typeof mammoth.extractRawText>[0]);
  const text = res.value.replace(/\n{3,}/g, '\n\n');
  const pages = chunkLines(text);
  const empty = text.replace(/\s/g, '').length < MIN_TEXT_CHARS;
  return {
    pages, pageCount: pages.length, ocrRequired: empty, isLegacyDoc: false,
    warnings: [
      'DOCX has no fixed pages; references use numbered sections of about 40 lines.',
      ...res.messages.slice(0, 3).map((m) => m.message),
      ...(empty ? ['The document contains almost no text (it may be image-only).'] : []),
    ],
  };
}

// ───────────────────────── Legacy .doc (best effort) ─────────────────────────
function runs(text: string): string[] {
  return text.match(/[\x20-\x7E\u00a0-ɏ₹–—‘-”•]{14,}/g) ?? [];
}

async function extractLegacyDoc(bytes: Uint8Array): Promise<Extracted> {
  const u16 = new TextDecoder('utf-16le').decode(bytes.subarray(0, bytes.length - (bytes.length % 2)));
  const l1 = new TextDecoder('latin1').decode(bytes);
  const a = runs(u16).filter((r) => /[a-z]{3}/i.test(r));
  const b = runs(l1).filter((r) => /[a-z]{3}/i.test(r) && !/^(?:Microsoft|Root Entry|WordDocument|SummaryInformation)/.test(r));
  const best = a.join('').length >= b.join('').length ? a : b;
  const text = best.join('\n');
  const pages = chunkLines(text);
  return {
    pages, pageCount: pages.length, ocrRequired: text.replace(/\s/g, '').length < MIN_TEXT_CHARS, isLegacyDoc: true,
    warnings: ['Legacy .doc text is recovered on a best-effort basis; formatting and order may be imperfect. A person should review it.'],
  };
}
