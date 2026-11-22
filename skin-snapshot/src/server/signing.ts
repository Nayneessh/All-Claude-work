// Short-lived signed tokens (HMAC-SHA256) for photo uploads and photo views served by this app.
// They are bearer links: they expire within minutes and are scoped to one object and one action.
export type SignedAction = 'upload' | 'view';

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return Buffer.from(sig).toString('base64url');
}

export interface SignedPayload {
  a: SignedAction;
  id: string; // photo id
  exp: number; // unix seconds
  /** Staff actor for audit, view tokens only. */
  by?: string;
  byEmail?: string;
  max?: number;
}

export async function signToken(secret: string, p: SignedPayload): Promise<string> {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url');
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyToken(secret: string, token: string, action: SignedAction, now = Date.now()): Promise<SignedPayload | null> {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = await hmac(secret, body);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as SignedPayload;
    if (p.a !== action || p.exp * 1000 < now) return null;
    return p;
  } catch {
    return null;
  }
}

export async function hmacHex(secret: string, msg: string): Promise<string> {
  return Buffer.from(Buffer.from(await hmac(secret, msg), 'base64url')).toString('hex');
}
