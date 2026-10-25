import type { ISODate, Program, ProgramVersion, WorkoutTemplate } from './types';
import { addDays, isoWeekday } from './periods';

/**
 * A program's current version is NOT the version prescribed six weeks ago. Versions are immutable
 * history: for any date the prescription is the version with the greatest `effective_from <= date`
 * (ties → highest version_no). Sessions additionally keep a frozen copy of what was prescribed.
 */
type VersionLike = Pick<ProgramVersion, 'id' | 'version_no' | 'effective_from'> & { deleted_at?: string | null };
type TemplateLike = Pick<WorkoutTemplate, 'id' | 'program_version_id' | 'template_key' | 'weekday' | 'sequence' | 'name'> & { deleted_at?: string | null };
type ProgramLike = Pick<Program, 'start_date' | 'end_date' | 'paused_intervals'>;

export function resolveVersion<V extends VersionLike>(versions: V[], date: ISODate): V | null {
  let best: V | null = null;
  for (const v of versions) {
    if (v.deleted_at || v.effective_from > date) continue;
    if (!best || v.effective_from > best.effective_from || (v.effective_from === best.effective_from && v.version_no > best.version_no)) best = v;
  }
  return best;
}

export const latestVersion = <V extends VersionLike>(versions: V[]): V | null =>
  versions.filter((v) => !v.deleted_at).reduce<V | null>((a, v) => (!a || v.version_no > a.version_no ? v : a), null);

export function isProgramPausedOn(program: Pick<Program, 'paused_intervals'>, date: ISODate): boolean {
  return program.paused_intervals.some((p) => date >= p.from && (p.to === null || date < p.to));
}

export function isProgramLiveOn(program: ProgramLike, date: ISODate): boolean {
  if (program.start_date && date < program.start_date) return false;
  if (program.end_date && date > program.end_date) return false;
  return !isProgramPausedOn(program, date);
}

export function templatesOnDate<T extends TemplateLike>(
  program: ProgramLike,
  versions: VersionLike[],
  templates: T[],
  date: ISODate,
): T[] {
  if (!isProgramLiveOn(program, date)) return [];
  const v = resolveVersion(versions, date);
  if (!v) return [];
  const wd = isoWeekday(date);
  return templates
    .filter((t) => !t.deleted_at && t.program_version_id === v.id && t.weekday === wd)
    .sort((a, b) => a.sequence - b.sequence);
}

export interface Occurrence<T> { date: ISODate; template: T }

export function occurrences<T extends TemplateLike>(
  program: ProgramLike,
  versions: VersionLike[],
  templates: T[],
  from: ISODate,
  to: ISODate,
): Occurrence<T>[] {
  const out: Occurrence<T>[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const t of templatesOnDate(program, versions, templates, d)) out.push({ date: d, template: t });
  }
  return out;
}

export function nextOccurrence<T extends TemplateLike>(
  program: ProgramLike,
  versions: VersionLike[],
  templates: T[],
  from: ISODate,
  horizonDays = 28,
): Occurrence<T> | null {
  return occurrences(program, versions, templates, from, addDays(from, horizonDays))[0] ?? null;
}
