/**
 * Upload validation + structural security screening (plan §4.5 steps 1–3).
 * This is NOT an antivirus: it rejects mismatched/oversized/empty files and flags active content (scripts, macros,
 * embedded executables) and the EICAR test signature for quarantine. A production deployment must add a real scanner
 * (e.g. ClamAV) behind the same `securityFlags` interface.
 */

export const MAX_BYTES = 10 * 1024 * 1024;
export type FileKind = 'pdf' | 'docx' | 'doc';

export const MIME: Record<FileKind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
};

export interface FileCheck { ok: boolean; kind?: FileKind; errors: string[]; securityFlags: string[] }

export function kindFromName(name: string): FileKind | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1].toLowerCase();
  return ext === 'pdf' || ext === 'docx' || ext === 'doc' ? ext : undefined;
}

const starts = (b: Uint8Array, sig: number[], at = 0): boolean => sig.every((v, i) => b[at + i] === v);

function sniff(b: Uint8Array): FileKind | 'zip' | 'unknown' {
  const head = b.subarray(0, Math.min(b.length, 1024));
  for (let i = 0; i + 5 <= head.length; i++) if (starts(head, [0x25, 0x50, 0x44, 0x46, 0x2d], i)) return 'pdf'; // %PDF-
  if (starts(b, [0x50, 0x4b, 0x03, 0x04])) return 'zip';
  if (starts(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'doc';
  return 'unknown';
}

const latin1 = (b: Uint8Array): string => {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < b.length; i += step) s += String.fromCharCode(...b.subarray(i, i + step));
  return s;
};

const EICAR = 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE';

export function securityScan(kind: FileKind, bytes: Uint8Array): string[] {
  const flags: string[] = [];
  const text = latin1(bytes);
  if (text.includes(EICAR)) flags.push('Antivirus test signature (EICAR) detected');
  if (kind === 'pdf') {
    if (/\/(?:JavaScript|JS)\b/.test(text)) flags.push('PDF contains JavaScript');
    if (/\/Launch\b/.test(text)) flags.push('PDF contains a launch action');
    if (/\/EmbeddedFile\b/.test(text)) flags.push('PDF contains an embedded file');
    if (/\/RichMedia\b/.test(text)) flags.push('PDF contains rich media');
  } else if (kind === 'docx') {
    if (/vbaProject\.bin/i.test(text)) flags.push('Word file contains VBA macros');
    if (/[\w/.-]+\.(?:exe|dll|bat|cmd|scr|vbs|js|ps1)\b/i.test(text.replace(/<[^>]+>/g, ''))) flags.push('Archive contains an executable-type file name');
  } else {
    const wide = latin1(bytes).replace(/\0/g, '');
    if (/(?:_VBA_PROJECT|Macros|VBA\/)/.test(wide)) flags.push('Legacy Word file contains macros');
  }
  return flags;
}

export function checkFile(name: string, bytes: Uint8Array): FileCheck {
  const errors: string[] = [];
  const kind = kindFromName(name);
  if (!kind) errors.push('Unsupported file type. Upload a PDF, DOC or DOCX file.');
  if (bytes.length === 0) errors.push('The file is empty.');
  if (bytes.length > MAX_BYTES) errors.push(`The file is ${(bytes.length / 1048576).toFixed(1)} MB; the limit is ${MAX_BYTES / 1048576} MB.`);

  if (kind && bytes.length > 0) {
    const real = sniff(bytes);
    const okMatch = (kind === 'pdf' && real === 'pdf') || (kind === 'docx' && real === 'zip') || (kind === 'doc' && real === 'doc');
    if (!okMatch) errors.push(`The file content does not match its .${kind} extension${real === 'unknown' ? '' : ` (it looks like ${real === 'zip' ? 'a ZIP/DOCX' : real.toUpperCase()})`}.`);
  }
  const securityFlags = errors.length || !kind ? [] : securityScan(kind, bytes);
  return { ok: errors.length === 0, kind, errors, securityFlags };
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
