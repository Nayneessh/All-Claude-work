// Staff authentication adapter. The console accepts a bearer token; this layer turns it into
// verified claims. Today that is Supabase Auth (open source, self-hostable). Replace the class to
// move to another identity provider. The database only needs the claims: sub, email, aal.
import type { StaffClaims } from '../data/db';
import { ConfigError } from './config';
import { hmacHex } from './signing';

export interface AuthProvider {
  verify(bearer: string): Promise<StaffClaims | null>;
}

function decodePayload(jwt: string): Record<string, any> | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString());
  } catch {
    return null;
  }
}

/**
 * Validates the token by asking the Supabase Auth server (so signature, expiry and revocation are
 * checked by the issuer), then reads aal (two-step state) from the now-trusted payload.
 */
export class SupabaseAuth implements AuthProvider {
  private cache = new Map<string, { claims: StaffClaims; until: number }>();
  constructor(private url: string, private anonKey: string) {}
  async verify(bearer: string): Promise<StaffClaims | null> {
    const hit = this.cache.get(bearer);
    if (hit && hit.until > Date.now()) return hit.claims;
    let res: Response;
    try {
      res = await fetch(`${this.url.replace(/\/$/, '')}/auth/v1/user`, { headers: { apikey: this.anonKey, authorization: `Bearer ${bearer}` } });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const user = (await res.json()) as { id?: string; email?: string };
    const payload = decodePayload(bearer);
    if (!user.id || !payload || payload.sub !== user.id) return null;
    const claims: StaffClaims = { sub: user.id, email: user.email ?? payload.email, aal: String(payload.aal ?? 'aal1'), role: 'authenticated', exp: payload.exp };
    this.cache.set(bearer, { claims, until: Date.now() + 20_000 });
    if (this.cache.size > 200) this.cache.clear();
    return claims;
  }
}

/**
 * Development and test only. Refused by loadConfig in staging and production.
 * Token: dev.<base64url(json)>.<hmac>
 */
export class DevAuth implements AuthProvider {
  constructor(private secret: string) {}
  static async mint(secret: string, c: { sub: string; email: string; aal: 'aal1' | 'aal2'; ttlSeconds?: number }): Promise<string> {
    const body = Buffer.from(JSON.stringify({ sub: c.sub, email: c.email, aal: c.aal, exp: Math.floor(Date.now() / 1000) + (c.ttlSeconds ?? 3600) })).toString('base64url');
    return `dev.${body}.${await hmacHex(secret, body)}`;
  }
  async verify(bearer: string): Promise<StaffClaims | null> {
    const [tag, body, sig] = bearer.split('.');
    if (tag !== 'dev' || !body || !sig) return null;
    if ((await hmacHex(this.secret, body)) !== sig) return null;
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString());
      if (p.exp * 1000 < Date.now()) return null;
      return { sub: p.sub, email: p.email, aal: p.aal, role: 'authenticated', exp: p.exp };
    } catch {
      return null;
    }
  }
}

/** Used when staff sign-in is not set up yet. Public pages keep working; console calls say why they cannot. */
export class UnconfiguredAuth implements AuthProvider {
  async verify(): Promise<StaffClaims | null> {
    throw new ConfigError('Staff sign-in is not configured (NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY).');
  }
}
