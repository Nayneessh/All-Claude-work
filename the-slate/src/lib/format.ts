export const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const maskPhone = (p: string | null) => (p ? p.replace(/\d(?=\d{3})/g, '•') : '');
export const maskEmail = (e: string | null) => (e ? e.replace(/^(.).*(@.*)$/, '$1•••$2') : '');
export const maskMoney = (v: string | null) => (v ? v.replace(/\d/g, '•') : '');
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'item';
export const debounce = <A extends unknown[]>(fn: (...a: A) => void, ms: number) => { let t: ReturnType<typeof setTimeout>; const d = (...a: A) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; };
/** Run storage access safely (private windows, blocked storage). */
export const safeLocal = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
