import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Banner } from '@/ui/kit';

/**
 * Optional app lock. A 4–8 digit PIN is stored only as a salted PBKDF2 hash. It locks the interface (not the storage):
 * data at rest relies on Android's own device encryption. See docs/ARCHITECTURE.md → Privacy.
 */
const KEY = 'mg-lock';
interface Stored { salt: string; hash: string; enabled: boolean }

const b64 = (a: ArrayBuffer | Uint8Array): string => btoa(String.fromCharCode(...new Uint8Array(a instanceof Uint8Array ? a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) : a)));
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: 100_000 }, k, 256));
}
const read = (): Stored | null => { try { const s = localStorage.getItem(KEY); return s ? (JSON.parse(s) as Stored) : null; } catch { return null; } };

export const lockEnabled = (): boolean => !!read()?.enabled;
export async function setPin(pin: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  localStorage.setItem(KEY, JSON.stringify({ salt: b64(salt), hash: await derive(pin, salt), enabled: true } satisfies Stored));
}
export async function verifyPin(pin: string): Promise<boolean> { const s = read(); return !!s && (await derive(pin, unb64(s.salt))) === s.hash; }
export function disableLock(): void { try { localStorage.removeItem(KEY); } catch { /* nothing stored */ } }

export function AppLock({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(lockEnabled());
  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    const onVis = (): void => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now();
      else if (lockEnabled() && hiddenAt.current && Date.now() - hiddenAt.current > 60_000) setLocked(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  if (!locked) return <>{children}</>;
  return <Unlock onOk={() => setLocked(false)} />;
}

function Unlock({ onOk }: { onOk: () => void }) {
  const [pin, setPin2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [fails, setFails] = useState(0);
  const [wait, setWait] = useState(0);
  useEffect(() => { if (wait <= 0) return; const t = window.setTimeout(() => setWait(wait - 1), 1000); return () => window.clearTimeout(t); }, [wait]);
  async function submit(): Promise<void> {
    if (wait > 0) return;
    if (await verifyPin(pin)) { onOk(); return; }
    const f = fails + 1;
    setFails(f); setPin2(''); setErr('Wrong PIN');
    if (f >= 3) setWait(Math.min(60, 5 * 2 ** (f - 3)));
  }
  return (
    <div className="splash" style={{ flexDirection: 'column', gap: 16, padding: 24 }}>
      <img src="./logo.svg" alt="" />
      <h2>Enter your PIN</h2>
      <input className="input" style={{ maxWidth: 220, textAlign: 'center', letterSpacing: '.4em', fontSize: '1.4rem' }} type="password" inputMode="numeric" autoComplete="off" aria-label="PIN" maxLength={8} value={pin} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} autoFocus />
      {err && <Banner tone="err">{wait > 0 ? `Too many tries. Wait ${wait}s.` : err}</Banner>}
      <Button variant="primary" disabled={pin.length < 4 || wait > 0} onClick={() => void submit()}>Unlock</Button>
    </div>
  );
}
