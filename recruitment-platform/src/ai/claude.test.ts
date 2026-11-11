import { describe, expect, it, vi } from 'vitest';
import { AiProxyError, createClaudeProvider, stripNulls } from './claude';

const ok = (data: unknown, meta = { provider: 'anthropic', model: 'claude-opus-4-8', promptVersion: 'v9' }): Response =>
  new Response(JSON.stringify({ data, meta }), { status: 200, headers: { 'content-type': 'application/json' } });
const err = (status: number, error: string): Response => new Response(JSON.stringify({ error }), { status });

const profile = { name: 'A B', email: null, employment: [{ company: 'X', title: 'VP', start: '2019-01', end: null, description: 'did things', ref: null }], education: [], certifications: [], skills: [], industries: [], achievements: [] };
const mk = (fetchImpl: typeof fetch, over: Partial<Parameters<typeof createClaudeProvider>[0]> = {}) =>
  createClaudeProvider({ getToken: async () => 'tok', fetchImpl, sleep: async () => undefined, ...over });

describe('stripNulls', () => {
  it('removes null optionals recursively but keeps rating:null (Not Evident)', () => {
    expect(stripNulls({ a: null, b: { c: null, d: 1 }, list: [{ rating: null, x: null }] })).toEqual({ b: { d: 1 }, list: [{ rating: null }] });
  });
});

describe('Claude provider (via the secure proxy)', () => {
  it('sends the user token and task, parses structured output, and reports the model that actually served the call', async () => {
    const f = vi.fn(async () => ok(profile));
    const p = mk(f as unknown as typeof fetch);
    const out = await p.extractProfile({ fileName: 'a.pdf', pages: [{ page: 1, text: 'hi' }] });
    expect(out.name).toBe('A B');
    expect(out.email).toBeUndefined();
    expect(out.employment[0].end).toBeUndefined();
    expect(out.served).toEqual({ id: 'anthropic', model: 'claude-opus-4-8', promptVersion: 'v9' }); // e.g. after a fallback
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/ai');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toMatchObject({ task: 'extract' });
    expect(p.info.model).toBe('claude-opus-4-8');
  });
  it('refuses to call without a signed-in user', async () => {
    const f = vi.fn();
    await expect(mk(f as unknown as typeof fetch, { getToken: async () => undefined }).extractProfile({ fileName: 'a', pages: [] })).rejects.toMatchObject({ status: 401 });
    expect(f).not.toHaveBeenCalled();
  });
  it('retries rate limits and provider errors with backoff, then succeeds', async () => {
    const f = vi.fn().mockResolvedValueOnce(err(429, 'rate_limited')).mockResolvedValueOnce(err(502, 'provider_error')).mockResolvedValueOnce(ok(profile));
    const out = await mk(f as unknown as typeof fetch).extractProfile({ fileName: 'a', pages: [] });
    expect(out.name).toBe('A B');
    expect(f).toHaveBeenCalledTimes(3);
  });
  it('gives up after the retry budget with a plain-language message', async () => {
    const f = vi.fn(async () => err(429, 'rate_limited'));
    await expect(mk(f as unknown as typeof fetch, { retries: 1 }).extractProfile({ fileName: 'a', pages: [] })).rejects.toThrow(/busy/);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('does not retry refusals or truncation', async () => {
    for (const [status, code] of [[422, 'refused'], [502, 'truncated'], [401, 'unauthorized'], [413, 'payload_too_large']] as const) {
      const f = vi.fn(async () => err(status, code));
      await expect(mk(f as unknown as typeof fetch).extractProfile({ fileName: 'a', pages: [] })).rejects.toBeInstanceOf(AiProxyError);
      expect(f).toHaveBeenCalledTimes(1);
    }
  });
  it('retries network failures, then reports them', async () => {
    const f = vi.fn(async () => { throw new TypeError('network down'); });
    await expect(mk(f as unknown as typeof fetch, { retries: 1 }).extractProfile({ fileName: 'a', pages: [] })).rejects.toThrow(/Could not reach/);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('rejects model output that breaks the contract instead of passing it on', async () => {
    const f = vi.fn(async () => ok({ criteria: 'nope' }));
    await expect(mk(f as unknown as typeof fetch).assessCandidate({
      mandate: { title: 't', location: '', minExperience: 1 }, rubric: { criteria: [], gates: [], roleIntelligence: { purpose: '', responsibilities: [], mandatory: [], preferred: [], competencies: [], industry: [], leadership: [], scale: [], achievements: [], progression: [], practical: [] } },
      profile: { name: '', employment: [], education: [], certifications: [], skills: [], industries: [], achievements: [] }, pages: [],
    })).rejects.toThrow();
  });
});
