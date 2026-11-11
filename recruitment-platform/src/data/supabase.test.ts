import { describe, expect, it } from 'vitest';
import { ImmutableRecordError } from '@/domain/guards';
import type { Assessment, Mandate, UserProfile } from '@/domain/types';
import { createSupabaseRepo, fromRow, toRow } from './supabase';

describe('row mapping', () => {
  const mandate = { id: 'm', entityId: 'e', status: 'open', title: 'T' } as unknown as Mandate;
  it('stores key columns and the full record', () => {
    expect(toRow('mandates', mandate)).toEqual({ id: 'm', entity_id: 'e', status: 'open', data: mandate });
    expect(fromRow('mandates', { id: 'm', entity_id: 'e', status: 'open', data: mandate })).toEqual(mandate);
  });
  it('maps audit and document columns, defaulting a missing hash to an empty string', () => {
    expect(toRow('audit_logs', { id: 'a', at: 't', userId: 'u', entityId: undefined, targetId: 'x' })).toMatchObject({ user_id: 'u', target_id: 'x', entity_id: null, at: 't' });
    expect(toRow('candidate_documents', { id: 'd', candidateId: 'c', entityId: 'e' })).toMatchObject({ sha256: '' });
  });
  it('profiles map 1:1 to typed columns', () => {
    const p: UserProfile = { id: 'u', email: 'a@b.c', name: 'N', role: 'recruiter', entityIds: ['e1'], active: true };
    expect(toRow('profiles', p)).toEqual({ id: 'u', email: 'a@b.c', name: 'N', role: 'recruiter', active: true, entity_ids: ['e1'] });
    expect(fromRow('profiles', toRow('profiles', p))).toEqual(p);
  });
  it('entities and departments rebuild from columns', () => {
    expect(fromRow('entities', { id: 'e', name: 'N', code: 'C', data: {}, created_at: 't' })).toMatchObject({ id: 'e', name: 'N', code: 'C', createdAt: 't' });
  });
});

// A tiny query-builder double so the adapter's paging, filtering and error mapping are exercised without a network.
type Call = { table: string; op: string; arg?: unknown; eqs: [string, string][]; range?: [number, number] };
function fakeClient(opts: { rows?: Record<string, unknown>[]; error?: { message: string; code?: string } }) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: 'select', eqs: [] };
      const result = () => ({ data: opts.error ? null : (opts.rows ?? []).slice(call.range?.[0] ?? 0, (call.range?.[1] ?? 1e9) + 1), error: opts.error ?? null });
      const b: Record<string, unknown> = {
        select: () => b, order: () => b,
        range: (a: number, z: number) => { call.range = [a, z]; return b; },
        eq: (c: string, v: string) => { call.eqs.push([c, v]); return b; },
        maybeSingle: async () => { calls.push(call); return { data: opts.rows?.[0] ?? null, error: opts.error ?? null }; },
        insert: async (row: unknown) => { calls.push({ ...call, op: 'insert', arg: row }); return { error: opts.error ?? null }; },
        upsert: async (row: unknown) => { calls.push({ ...call, op: 'upsert', arg: row }); return { error: opts.error ?? null }; },
        then: (res: (v: unknown) => unknown) => { calls.push(call); return Promise.resolve(result()).then(res); },
      };
      return b;
    },
    storage: { from: () => ({}) },
  };
  return { client: client as never, calls };
}

describe('Supabase repository', () => {
  it('filters on typed columns server-side and on other fields client-side', async () => {
    const rows = [{ id: '1', data: { id: '1', entityId: 'e', status: 'open', priority: 'high' }, entity_id: 'e', status: 'open' }, { id: '2', data: { id: '2', entityId: 'e', status: 'open', priority: 'low' }, entity_id: 'e', status: 'open' }];
    const { client, calls } = fakeClient({ rows });
    const out = await createSupabaseRepo(client).list('mandates', { entityId: 'e', priority: 'high' });
    expect(out.map((m) => m.id)).toEqual(['1']);
    expect(calls[0].eqs).toEqual([['entity_id', 'e']]);
  });
  it('pages through more than 1000 rows instead of silently truncating', async () => {
    const rows = Array.from({ length: 2300 }, (_, i) => ({ id: String(i), data: { id: String(i) } }));
    const { client, calls } = fakeClient({ rows });
    expect(await createSupabaseRepo(client).list('candidates')).toHaveLength(2300);
    expect(calls.map((c) => c.range)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it('append-only tables use insert (never upsert); ordinary tables upsert', async () => {
    const { client, calls } = fakeClient({});
    const repo = createSupabaseRepo(client);
    await repo.put('assessments', { id: 'a', mandateId: 'm', candidateId: 'c', entityId: 'e' } as unknown as Assessment);
    await repo.put('mandates', { id: 'm', entityId: 'e', status: 'open' } as unknown as Mandate);
    expect(calls.map((c) => `${c.table}:${c.op}`)).toEqual(['assessments:insert', 'mandates:upsert']);
  });
  it('translates database immutability and permission errors into plain errors', async () => {
    const a = { id: 'a', mandateId: 'm', candidateId: 'c', entityId: 'e' } as unknown as Assessment;
    await expect(createSupabaseRepo(fakeClient({ error: { message: 'duplicate key', code: '23505' } }).client).put('assessments', a)).rejects.toBeInstanceOf(ImmutableRecordError);
    await expect(createSupabaseRepo(fakeClient({ error: { message: 'assessments is append-only: records cannot be updated or deleted', code: 'P0001' } }).client).put('assessments', a)).rejects.toBeInstanceOf(ImmutableRecordError);
    await expect(createSupabaseRepo(fakeClient({ error: { message: 'new row violates row-level security policy', code: '42501' } }).client).put('assessments', a)).rejects.toThrow(/permission/);
  });
});
