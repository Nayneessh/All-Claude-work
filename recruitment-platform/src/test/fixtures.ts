import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph } from 'docx';

/** Build real PDF/DOCX/legacy-DOC bytes for tests, so extraction is exercised on genuine file formats. */
export function makePdf(pages: string[]): Uint8Array {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  pages.forEach((text, i) => {
    if (i > 0) doc.addPage();
    let y = 60;
    for (const line of text.split('\n')) {
      doc.setFontSize(10);
      doc.text(line, 40, y);
      y += 14;
    }
  });
  return new Uint8Array(doc.output('arraybuffer'));
}

export async function makeDocx(text: string): Promise<Uint8Array> {
  const doc = new Document({ sections: [{ children: text.split('\n').map((l) => new Paragraph(l)) }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}

/** An OLE2 header followed by UTF-16LE text runs: enough to exercise best-effort .doc extraction. */
export function makeLegacyDoc(text: string): Uint8Array {
  const head = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(504).fill(0)]);
  const body = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) { body[i * 2] = text.charCodeAt(i) & 0xff; body[i * 2 + 1] = text.charCodeAt(i) >> 8; }
  const out = new Uint8Array(head.length + body.length);
  out.set(head);
  out.set(body, head.length);
  return out;
}

export const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
