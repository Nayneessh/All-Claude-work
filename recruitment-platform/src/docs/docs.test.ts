import { describe, expect, it } from 'vitest';
import { makeDocx, makeLegacyDoc, makePdf, enc } from '@/test/fixtures';
import { MAX_BYTES, checkFile, kindFromName, securityScan, sha256 } from './validate';
import { extractText } from './extract';

const CV = ['Aarav Mehta', 'VP - Procurement | Mumbai | aarav@example.com', '', 'EXPERIENCE', 'VP - Procurement, Orion Auto Components | Jan 2019 - Present',
  '- Own category strategy for 650 crore annual spend and lead a team of 45 people across 4 plants.'].join('\n');

describe('checkFile', () => {
  it('accepts real PDF / DOCX / DOC content', async () => {
    expect(checkFile('cv.pdf', makePdf([CV])).ok).toBe(true);
    expect(checkFile('cv.docx', await makeDocx(CV)).ok).toBe(true);
    expect(checkFile('cv.doc', makeLegacyDoc(CV)).ok).toBe(true);
  });
  it('rejects unsupported types, empty files and oversize files with plain-language reasons', () => {
    expect(checkFile('cv.exe', enc('MZ')).errors[0]).toMatch(/Unsupported/);
    expect(checkFile('cv.pdf', new Uint8Array()).errors.join()).toMatch(/empty/);
    expect(checkFile('cv.pdf', new Uint8Array(MAX_BYTES + 1)).errors.join()).toMatch(/limit/);
  });
  it('rejects files whose content does not match the extension (renamed executables)', () => {
    const r = checkFile('cv.pdf', enc('MZ\x90\x00 this is not a pdf'));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/does not match/);
  });
  it('kindFromName is case-insensitive', () => expect(kindFromName('CV.PDF')).toBe('pdf'));
});

describe('securityScan', () => {
  it('flags active content in PDFs', () => {
    const evil = enc('%PDF-1.7\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> /Launch >> endobj /EmbeddedFile');
    const f = securityScan('pdf', evil);
    expect(f.join()).toMatch(/JavaScript/);
    expect(f.join()).toMatch(/launch/);
    expect(f.join()).toMatch(/embedded/);
  });
  it('flags macros in DOCX and the EICAR test signature anywhere', () => {
    expect(securityScan('docx', enc('PK\x03\x04 word/vbaProject.bin')).join()).toMatch(/macros/);
    expect(securityScan('pdf', enc('%PDF-1.4 X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')).join()).toMatch(/EICAR/);
  });
  it('a clean generated PDF has no flags', () => expect(securityScan('pdf', makePdf([CV]))).toEqual([]));
});

describe('sha256', () => {
  it('is stable and content-based', async () => {
    expect(await sha256(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256(enc('abc'))).toBe(await sha256(enc('abc')));
    expect(await sha256(enc('abd'))).not.toBe(await sha256(enc('abc')));
  });
});

describe('extractText', () => {
  it('reads PDF text per page and rebuilds lines in reading order', async () => {
    const e = await extractText('pdf', makePdf([CV, 'EDUCATION\nMBA, IIM Ahmedabad, 2008 - a long enough second page of text for the extractor to keep']));
    expect(e.pageCount).toBe(2);
    expect(e.ocrRequired).toBe(false);
    expect(e.pages[0].text).toContain('Aarav Mehta');
    expect(e.pages[0].text.split('\n')[0]).toBe('Aarav Mehta');
    expect(e.pages[1].text).toContain('MBA, IIM Ahmedabad');
  });
  it('flags a PDF with no text layer as needing OCR instead of returning empty success', async () => {
    const e = await extractText('pdf', makePdf(['']));
    expect(e.ocrRequired).toBe(true);
    expect(e.warnings.join()).toMatch(/OCR/);
  });
  it('reads DOCX paragraphs', async () => {
    const e = await extractText('docx', await makeDocx(CV));
    expect(e.ocrRequired).toBe(false);
    expect(e.pages[0].text).toContain('Own category strategy');
  });
  it('recovers best-effort text from legacy .doc and marks it for review', async () => {
    const e = await extractText('doc', makeLegacyDoc(CV));
    expect(e.isLegacyDoc).toBe(true);
    expect(e.pages.map((p) => p.text).join(' ')).toContain('Orion Auto Components');
    expect(e.warnings.join()).toMatch(/best-effort/);
  });
});
