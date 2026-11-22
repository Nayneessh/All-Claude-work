// Identifiers. The case code is short and shareable (it goes into WhatsApp) and grants nothing.
// The private link token is long, random and stored only as a hash.

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no 0/O, 1/I/L, U

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/** e.g. SS-7K3Q-9XMD. Eight symbols from a 30-letter alphabet, about 39 bits. */
export function generateCaseCode(): string {
  const bytes = randomBytes(8);
  let s = '';
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `SS-${s.slice(0, 4)}-${s.slice(4)}`;
}

export function isCaseCode(v: string): boolean {
  return /^SS-[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}$/.test(v);
}

export function normaliseCaseCode(v: string): string {
  return v.trim().toUpperCase();
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 256-bit random token for private case links and phone-continuation links. */
export function generateToken(): string {
  return toBase64Url(randomBytes(32));
}

export function isToken(v: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(v);
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
