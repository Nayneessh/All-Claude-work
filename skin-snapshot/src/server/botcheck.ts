// Bot protection behind one interface. Default: a self-hosted proof-of-work challenge (no third party,
// nothing leaves the site) combined with a honeypot field and a minimum fill time on the form.
// Cloudflare Turnstile is available by configuration.
import type { Queryable } from '../data/db';
import * as repo from '../data/repo';
import { hmacHex } from './signing';

export interface BotCheck {
  readonly kind: 'pow' | 'turnstile' | 'off';
  challenge(): Promise<Record<string, unknown> | null>;
  verify(token: string | undefined, ip: string): Promise<boolean>;
}

export class OffBotCheck implements BotCheck {
  readonly kind = 'off' as const;
  async challenge() {
    return null;
  }
  async verify() {
    return true;
  }
}

export function leadingZeroBits(bytes: Uint8Array): number {
  let n = 0;
  for (const b of bytes) {
    if (b === 0) {
      n += 8;
      continue;
    }
    n += Math.clz32(b) - 24;
    break;
  }
  return n;
}

export class PowBotCheck implements BotCheck {
  readonly kind = 'pow' as const;
  constructor(private secret: string, private difficulty: number, private q: () => Queryable) {}

  async challenge() {
    const c = Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString('hex');
    const e = Math.floor(Date.now() / 1000) + 600;
    const s = await hmacHex(this.secret, `${c}.${this.difficulty}.${e}`);
    return { c, d: this.difficulty, e, s };
  }

  async verify(token: string | undefined): Promise<boolean> {
    if (!token) return false;
    let t: { c: string; d: number; e: number; s: string; n: string };
    try {
      t = JSON.parse(Buffer.from(token, 'base64url').toString());
    } catch {
      return false;
    }
    if (!t || typeof t.c !== 'string' || typeof t.n !== 'string' || t.n.length > 32 || t.d !== this.difficulty || t.e * 1000 < Date.now()) return false;
    if ((await hmacHex(this.secret, `${t.c}.${t.d}.${t.e}`)) !== t.s) return false;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${t.c}:${t.n}`)));
    if (leadingZeroBits(digest) < t.d) return false;
    // single use
    const uses = await repo.hitRateLimit(this.q(), `pow:${t.c}`, 900);
    return uses === 1;
  }
}

export class TurnstileBotCheck implements BotCheck {
  readonly kind = 'turnstile' as const;
  constructor(private secret: string) {}
  async challenge() {
    return null;
  }
  async verify(token: string | undefined, ip: string) {
    if (!token) return false;
    try {
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: this.secret, response: token, remoteip: ip }),
      });
      return Boolean(((await r.json()) as { success?: boolean }).success);
    } catch {
      return false;
    }
  }
}
