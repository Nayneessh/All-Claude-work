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

export async function getBotToken(): Promise<string | undefined> {
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
