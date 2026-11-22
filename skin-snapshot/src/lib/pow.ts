'use client';
// Solves the proof-of-work bot challenge. A few hundred milliseconds for a person, costly in bulk for a script.
import { api } from './api';

function leadingZeroBits(b: Uint8Array): number {
  let n = 0;
  for (const x of b) {
    if (x === 0) {
      n += 8;
      continue;
    }
    n += Math.clz32(x) - 24;
    break;
  }
  return n;
}

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void };
  }
}

/** Cloudflare Turnstile, used only when BOTCHECK=turnstile and the site key is configured. */
async function turnstileToken(siteKey: string): Promise<string | undefined> {
  if (!window.turnstile) {
    await new Promise<void>((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => res();
      s.onerror = () => rej(new Error('turnstile failed to load'));
      document.head.appendChild(s);
    });
  }
  return new Promise((resolve) => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const id = window.turnstile!.render(el, { sitekey: siteKey, size: 'invisible', callback: (t: string) => { resolve(t); window.turnstile?.remove(id); el.remove(); }, 'error-callback': () => resolve(undefined) });
  });
}

export async function getBotToken(): Promise<string | undefined> {
  const site = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (site) return turnstileToken(site);
  const { challenge } = await api<{ challenge: { c: string; d: number; e: number; s: string } | null }>('/api/botcheck');
  if (!challenge) return undefined;
  const enc = new TextEncoder();
  for (let n = 0; ; n++) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${challenge.c}:${n}`)));
    if (leadingZeroBits(d) >= challenge.d) {
      const json = JSON.stringify({ ...challenge, n: String(n) });
      return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    if (n % 2000 === 1999) await new Promise((r) => setTimeout(r)); // keep the page responsive
  }
}
