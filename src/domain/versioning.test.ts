import { describe, expect, it } from 'vitest';
import { isProgramLiveOn, isProgramPausedOn, latestVersion, nextOccurrence, occurrences, resolveVersion, templatesOnDate } from './versioning';

const versions = [
  { id: 'v1', version_no: 1, effective_from: '2026-10-26' },
  { id: 'v2', version_no: 2, effective_from: '2026-11-09' },
  { id: 'v3', version_no: 3, effective_from: '2026-11-09' }, // same date: higher version wins
];
const templates = [
  { id: 't1a', program_version_id: 'v1', template_key: 'mon', weekday: 1, sequence: 0, name: 'Mon v1' },
  { id: 't1b', program_version_id: 'v1', template_key: 'tue', weekday: 2, sequence: 0, name: 'Tue v1' },
  { id: 't3a', program_version_id: 'v3', template_key: 'mon', weekday: 1, sequence: 0, name: 'Mon v3' },
  { id: 't3b', program_version_id: 'v3', template_key: 'wed', weekday: 3, sequence: 0, name: 'Wed v3' },
];
const program = { start_date: '2026-10-26', end_date: null, paused_intervals: [] as { from: string; to: string | null }[] };

describe('program versions', () => {
  it('resolves the version prescribed on a given date (history stays accessible)', () => {
    expect(resolveVersion(versions, '2026-10-26')!.id).toBe('v1');
    expect(resolveVersion(versions, '2026-11-08')!.id).toBe('v1'); // six weeks ago ≠ current
    expect(resolveVersion(versions, '2026-11-09')!.id).toBe('v3');
    expect(resolveVersion(versions, '2026-12-25')!.id).toBe('v3');
    expect(resolveVersion(versions, '2026-10-01')).toBeNull();
    expect(latestVersion(versions)!.id).toBe('v3');
  });
  it('ignores soft-deleted versions', () => {
    expect(resolveVersion([...versions, { id: 'v4', version_no: 4, effective_from: '2026-11-01', deleted_at: 'x' }], '2026-11-05')!.id).toBe('v1');
  });
  it('schedules the template of the resolved version for the weekday', () => {
    expect(templatesOnDate(program, versions, templates, '2026-10-26').map((t) => t.name)).toEqual(['Mon v1']);
    expect(templatesOnDate(program, versions, templates, '2026-11-09').map((t) => t.name)).toEqual(['Mon v3']);
    expect(templatesOnDate(program, versions, templates, '2026-11-10')).toEqual([]); // Tue removed in v3
    expect(templatesOnDate(program, versions, templates, '2026-11-11').map((t) => t.name)).toEqual(['Wed v3']);
  });
  it('respects start/end dates and pauses', () => {
    expect(isProgramLiveOn(program, '2026-10-25')).toBe(false);
    const paused = { ...program, paused_intervals: [{ from: '2026-11-02', to: '2026-11-09' }] };
    expect(isProgramPausedOn(paused, '2026-11-05')).toBe(true);
    expect(isProgramPausedOn(paused, '2026-11-09')).toBe(false);
    expect(templatesOnDate(paused, versions, templates, '2026-11-02')).toEqual([]);
    const open = { ...program, paused_intervals: [{ from: '2026-11-02', to: null }] };
    expect(isProgramLiveOn(open, '2027-01-01')).toBe(false);
    expect(isProgramLiveOn({ ...program, end_date: '2026-12-01' }, '2026-12-02')).toBe(false);
  });
  it('lists occurrences and finds the next one', () => {
    const o = occurrences(program, versions, templates, '2026-10-26', '2026-11-01');
    expect(o.map((x) => x.date)).toEqual(['2026-10-26', '2026-10-27']);
    expect(nextOccurrence(program, versions, templates, '2026-10-28')!.date).toBe('2026-11-02');
  });
});
