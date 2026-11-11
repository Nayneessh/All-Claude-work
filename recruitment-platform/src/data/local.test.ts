import { afterEach, describe, expect, it } from 'vitest';
import { ImmutableRecordError } from '@/domain/guards';
import { createLocalRepo, type LocalRepo } from './local';
import type { AuditEntry, Candidate } from '@/domain/types';

let n = 0;
const open = (): LocalRepo => createLocalRepo(`test-${++n}-${Math.random()}`);
const cand = (id: string, entityId: string): Candidate => ({
  id, code: id, entityId, name: id, employment: [], education: [], certifications: [], skills: [], industries: [], achievements: [],
  extractionConfidence: 1, verificationStatus: 'unverified', identityFlags: [], createdAt: '', updatedAt: '',
});

describe('local repository', () => {
  let repo: LocalRepo;
  afterEach(() => repo?.close());

  it('puts, gets, lists with filters and updates ordinary rows', async () => {
    repo = open();
    await repo.put('candidates', cand('a', 'e1'));
    await repo.put('candidates', cand('b', 'e2'));
    expect((await repo.list('candidates')).length).toBe(2);
    expect((await repo.list('candidates', { entityId: 'e2' })).map((c) => c.id)).toEqual(['b']);
    await repo.put('candidates', { ...cand('a', 'e1'), name: 'Renamed' });
    expect((await repo.get('candidates', 'a'))?.name).toBe('Renamed');
    expect(await repo.get('candidates', 'zzz')).toBeUndefined();
  });

  it('audit log is append-only: a second write to the same id is refused and the original survives', async () => {
    repo = open();
    const e: AuditEntry = { id: 'x', at: 't', userId: 'u', userName: 'U', action: 'a', targetType: 't', targetId: 'i', summary: 'original' };
    await repo.put('audit_logs', e);
    await expect(repo.put('audit_logs', { ...e, summary: 'tampered' })).rejects.toBeInstanceOf(ImmutableRecordError);
    expect((await repo.get('audit_logs', 'x'))?.summary).toBe('original');
  });

  it('notifies listeners on change and stops after unsubscribe', async () => {
    repo = open();
    const seen: string[] = [];
    const off = repo.onChange((t) => seen.push(t));
    await repo.put('candidates', cand('a', 'e'));
    off();
    await repo.put('candidates', cand('b', 'e'));
    expect(seen).toEqual(['candidates']);
  });

  it('stores and returns files; wipe clears everything', async () => {
    repo = open();
    await repo.putFile('e/1/cv.pdf', new Blob(['%PDF-1.4 hi']));
    expect(await (await repo.getFile('e/1/cv.pdf'))!.text()).toBe('%PDF-1.4 hi');
    expect(await repo.getFile('nope')).toBeUndefined();
    await repo.put('candidates', cand('a', 'e'));
    await repo.wipe();
    expect(await repo.list('candidates')).toEqual([]);
    expect(await repo.getFile('e/1/cv.pdf')).toBeUndefined();
  });
});
