import { useEffect, useMemo, useState } from 'react';
import { planProgramEdit, SCOPE_LABELS, type EditPlan, type EditScope, type PlanEdit } from '@/domain/editScope';
import { resolveVersion, isProgramLiveOn, latestVersion } from '@/domain/versioning';
import { addDays, todayISO } from '@/domain/periods';
import { getBundle, treeOfVersion, versionIsUnused, type ProgramBundle } from '@/data/repo/programs';
import { commitProgramEdit, planForDate } from '@/data/repo/sessions';
import { exerciseMap } from '@/data/repo/exercises';
import { Banner, Button, Sheet, useUi } from '@/ui/kit';
import { fmtDate, errMsg } from '@/ui/format';
import type { ISODate } from '@/domain/types';
import type { CommitResult } from '@/data/repo/programs';

const HELP: Partial<Record<EditScope, string>> = {
  exercise_future: 'Every future session uses the new prescription. Past sessions keep what was prescribed then.',
  day_week: 'Only that one workout changes. The program and every other week stay as they are.',
  day_future: 'This workout day changes from today on. Earlier sessions are untouched.',
  program_all: 'The whole program changes from today on. Earlier sessions are untouched.',
  program_from_date: 'The whole program changes from the date you pick. Earlier sessions are untouched.',
};

/**
 * Nothing is applied until the user sees WHICH scheduled workouts will change. History is never rewritten: broad edits create a
 * new program version; one-week changes become a single planned session.
 */
export function EditScopeSheet({ open, onClose, programId, edits, scopes, initialScope, description, targetDate, onApplied }: {
  open: boolean; onClose: () => void; programId: string; edits: PlanEdit[]; scopes: EditScope[]; initialScope: EditScope; description: string; targetDate?: ISODate; onApplied: (r: CommitResult) => void;
}) {
  const ui = useUi();
  const [scope, setScope] = useState<EditScope>(initialScope);
  const [date, setDate] = useState<ISODate>(targetDate ?? addDays(todayISO(), 1));
  const [bundle, setBundle] = useState<ProgramBundle | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [unused, setUnused] = useState(false);
  const [todayHas, setTodayHas] = useState(false);
  const [busy, setBusy] = useState(false);
  const today = todayISO();

  useEffect(() => { if (open) { setScope(initialScope); setDate(targetDate ?? (initialScope === 'program_from_date' ? addDays(today, 1) : today)); } }, [open, initialScope, targetDate, today]);
  useEffect(() => {
    if (!open) return;
    void (async () => {
      const b = await getBundle(programId);
      setBundle(b ?? null);
      setNames(new Map([...(await exerciseMap())].map(([id, e]) => [id, e.name])));
      const latest = b ? latestVersion(b.versions) : null;
      setUnused(latest ? await versionIsUnused(latest.id) : false);
      setTodayHas((await planForDate(today)).some((i) => i.bundle.program.id === programId && i.session && ['in_progress', 'completed_as_planned', 'completed_modified', 'partial'].includes(i.session.status)));
    })();
  }, [open, programId, today]);

  const plan: EditPlan | null = useMemo(() => {
    if (!bundle) return null;
    const effective = scope === 'program_from_date' ? date : today;
    const v = resolveVersion(bundle.versions, effective) ?? latestVersion(bundle.versions);
    if (!v) return null;
    return planProgramEdit({ scope, edits, current: treeOfVersion(bundle, v.id), today, targetDate: scope === 'day_week' || scope === 'program_from_date' ? date : undefined, nameOf: (id) => names.get(id) ?? 'exercise', versionIsUnused: unused, todayHasSession: todayHas, isLiveOn: (d) => isProgramLiveOn(bundle.program, d) });
  }, [bundle, scope, date, edits, names, unused, todayHas, today]);

  async function apply(): Promise<void> {
    if (!plan) return;
    setBusy(true);
    try {
      const res = await commitProgramEdit({ programId, plan, edits, description, today });
      ui.toast(plan.mode === 'week_override' ? 'Changed for that day only' : plan.mode === 'in_place' ? 'Program updated' : 'New program version saved', { tone: 'ok' });
      onApplied(res);
      onClose();
    } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); } finally { setBusy(false); }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Apply this change to…" footer={<Button block variant="primary" disabled={busy || !plan || (plan.preview.length === 0 && plan.mode !== 'in_place')} onClick={() => void apply()}>{busy ? 'Applying…' : 'Apply change'}</Button>}>
      <div className="col">
        <div className="strong">{description}</div>
        <div className="col" role="radiogroup" aria-label="Change scope">
          {scopes.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={scope === s} className={`card ${scope === s ? 'hl' : ''}`} style={{ textAlign: 'left', color: 'inherit' }} onClick={() => setScope(s)}>
              <div className="row-flex"><span className="check" style={{ borderColor: scope === s ? 'var(--gold)' : undefined, background: scope === s ? 'var(--gold)' : undefined }}>{scope === s ? '✓' : ''}</span><div><div className="strong">{SCOPE_LABELS[s]}</div><div className="small dim">{HELP[s]}</div></div></div>
            </button>
          ))}
        </div>
        {(scope === 'program_from_date' || scope === 'day_week') && (
          <div className="field"><label htmlFor="scope-date">{scope === 'day_week' ? 'Which day?' : 'Starting from'}</label><input id="scope-date" className="input" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} /></div>
        )}
        {plan && (
          <div className="card blue">
            <div className="eyebrow">What will change</div>
            <p className="small mt-1">{plan.summary}</p>
            {plan.preview.length > 0 && (
              <div className="col mt-3" style={{ gap: 8 }}>
                {plan.preview.slice(0, 6).map((r) => <div key={`${r.date}${r.template_name}`} className="small"><span className="gold strong">{fmtDate(r.date)}</span> · {r.template_name.split(' — ')[0]}<div className="dim">{r.changes.join('; ')}</div></div>)}
                {plan.preview.length > 6 && <div className="small dim">…and {plan.preview.length - 6} more over the next 8 weeks.</div>}
              </div>
            )}
          </div>
        )}
        {todayHas && scope !== 'program_from_date' && scope !== 'day_week' && <Banner icon="info">Today's workout is already underway, so the change starts tomorrow.</Banner>}
        {plan && plan.preview.length === 0 && plan.mode !== 'in_place' && <Banner tone="warn" icon="warn">Nothing scheduled in the next 8 weeks would change, so there is nothing to apply.</Banner>}
      </div>
    </Sheet>
  );
}
