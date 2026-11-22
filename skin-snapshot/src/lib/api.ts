'use client';
// Browser-side API client. The private case token travels in a header, never in a URL the API logs.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string, public fields?: string[]) {
    super(message ?? code);
  }
}

export interface ApiOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string;
  capture?: string;
  staff?: string;
  signal?: AbortSignal;
}

export async function api<T = any>(path: string, o: ApiOpts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (o.token) headers['x-case-token'] = o.token;
  if (o.capture) headers['x-capture-token'] = o.capture;
  if (o.staff) headers.authorization = `Bearer ${o.staff}`;
  let body: string | undefined;
  if (o.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(o.body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method: o.method ?? (body ? 'POST' : 'GET'), headers, body, signal: o.signal, cache: 'no-store' });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network');
  }
  if (res.status === 204) return undefined as T;
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) throw new ApiError(res.status, json?.error ?? 'generic', json?.message, json?.fields);
  return json as T;
}

export function errorText(e: unknown, errors: Record<string, string>): string {
  if (e instanceof ApiError) return errors[e.code] ?? errors.generic ?? 'Error';
  return errors.generic ?? 'Error';
}

/** Upload with progress. fetch() cannot report upload progress, XHR can. */
export function putWithProgress(url: string, blob: Blob, onProgress: (frac: number) => void, headers: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new ApiError(x.status, 'upload_failed')));
    x.onerror = () => reject(new ApiError(0, 'network'));
    x.ontimeout = () => reject(new ApiError(0, 'network'));
    x.timeout = 90_000;
    x.send(blob);
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry with backoff. Used for uploads on poor connections. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, tries = 4, baseMs = 800): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn(i);
    } catch (e) {
      last = e;
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) throw e;
      await sleep(baseMs * 2 ** i);
    }
  }
  throw last;
}
