import { useMemo, useState, type ReactElement } from 'react';
import type { Exercise } from '@/domain/types';
import { GROUP_LABELS, GROUP_ORDER, type MuscleGroup, MUSCLES } from '@/domain/muscles';
import { suggestSubstitutes } from '@/domain/substitutes';
import { listExercises } from '@/data/repo/exercises';
import { recentExerciseIds } from '@/data/repo/history';
import { useLive } from '@/app/hooks';
import { useApp } from '@/app/AppContext';
import { Chip, Empty, Sheet } from '@/ui/kit';
import { Icon } from '@/ui/icons';

const NO_IDS: string[] = [];
export function ExercisePicker({ open, onClose, onPick, title = 'Choose exercise', replacing, excludeIds = NO_IDS }: { open: boolean; onClose: () => void; onPick: (e: Exercise) => void; title?: string; replacing?: Exercise; excludeIds?: string[] }) {
  const { today } = useApp();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<MuscleGroup | null>(null);
  const all = useLive(() => listExercises(), []);
  const recent = useLive(() => recentExerciseIds(today), [today]);
  const rows = useMemo(() => {
    const list = (all.data ?? []).filter((e) => !excludeIds.includes(e.id));
    const needle = q.trim().toLowerCase();
    return list.filter((e) => (!group || [...e.primary_muscles, ...e.secondary_muscles].some((m) => MUSCLES[m]?.group === group)) && (!needle || e.name.toLowerCase().includes(needle) || e.aliases.some((a) => a.toLowerCase().includes(needle)) || e.equipment.includes(needle)));
  }, [all.data, q, group, excludeIds]);
  const suggested = useMemo(() => (replacing && !q && !group ? suggestSubstitutes(replacing, (all.data ?? []).filter((e) => !excludeIds.includes(e.id)), 6) : []), [replacing, all.data, q, group, excludeIds]);
  const recents = useMemo(() => (!q && !group && !replacing ? (recent.data ?? []).map((id) => (all.data ?? []).find((e) => e.id === id)).filter((e): e is Exercise => !!e && !excludeIds.includes(e.id)).slice(0, 6) : []), [recent.data, all.data, q, group, replacing, excludeIds]);
  const row = (e: Exercise, sub?: string): ReactElement => (
    <button key={e.id} className="item" type="button" onClick={() => { onPick(e); onClose(); setQ(''); setGroup(null); }}>
      <div className="grow"><div className="strong">{e.name}</div><div className="small dim">{sub ?? `${e.primary_muscles.slice(0, 2).map((m) => MUSCLES[m]?.label ?? m).join(' · ') || e.category} · ${e.equipment}`}</div></div>
      {e.is_custom && <span className="badge dim">custom</span>}<Icon name="plus" className="chev" size={20} />
    </button>
  );
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="col">
        <div style={{ position: 'relative' }}>
          <input className="input" type="search" placeholder="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search exercises" autoFocus />
        </div>
        <div className="chips">{GROUP_ORDER.map((g) => <Chip key={g} on={group === g} onClick={() => setGroup(group === g ? null : g)}>{GROUP_LABELS[g]}</Chip>)}</div>
        <div className="list" style={{ margin: '0 -16px' }}>
          {suggested.length > 0 && <><div className="eyebrow" style={{ padding: '4px 16px' }}>Suggested alternatives</div>{suggested.map((s) => row(s.exercise, s.reasons.slice(0, 2).join(' · ')))}<div className="eyebrow" style={{ padding: '12px 16px 4px' }}>All exercises</div></>}
          {recents.length > 0 && <><div className="eyebrow" style={{ padding: '4px 16px' }}>Recent</div>{recents.map((e) => row(e))}<div className="eyebrow" style={{ padding: '12px 16px 4px' }}>All exercises</div></>}
          {rows.map((e) => row(e))}
          {rows.length === 0 && <Empty icon="search" title="No matching exercise" hint="Try another word, or create a custom exercise from the Exercises tab." />}
        </div>
      </div>
    </Sheet>
  );
}
