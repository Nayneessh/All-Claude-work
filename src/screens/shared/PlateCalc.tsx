import { useEffect, useState } from 'react';
import { DEFAULT_PLATES_KG, plateBreakdown, warmupSuggestions } from '@/domain/plates';
import { formatWeight, fromDisplayWeight, parseNumber, toDisplayWeight } from '@/domain/units';
import { addWarmupSets } from '@/data/repo/sessions';
import { useApp } from '@/app/AppContext';
import { Button, Sheet, useUi } from '@/ui/kit';

export function PlateCalc({ open, onClose, startKg, seId }: { open: boolean; onClose: () => void; startKg: number | null; seId?: string }) {
  const { unit, settings } = useApp();
  const ui = useUi();
  const [text, setText] = useState('');
  useEffect(() => { if (open) setText(startKg ? String(toDisplayWeight(startKg, unit)) : ''); }, [open, startKg, unit]);
  const n = parseNumber(text);
  const kg = n === null ? null : fromDisplayWeight(n, unit);
  const bar = settings.plate_bar_kg;
  const plates = settings.plates_kg ?? DEFAULT_PLATES_KG;
  const r = kg !== null && kg >= bar ? plateBreakdown(kg, bar, plates) : null;
  const warm = kg ? warmupSuggestions(kg, bar) : [];
  return (
    <Sheet open={open} onClose={onClose} title="Plates & warm-up" footer={seId && warm.length ? <Button block variant="primary" onClick={async () => { await addWarmupSets(seId, warm.map((w) => ({ weight_kg: w.weight_kg, reps: w.reps }))); ui.toast('Warm-up sets added', { tone: 'ok' }); onClose(); }}>Add {warm.length} warm-up sets</Button> : undefined}>
      <div className="col">
        <div className="field"><label htmlFor="plate-w">Target weight ({unit})</label><input id="plate-w" className="input" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} /></div>
        {r ? (
          <div className="card blue">
            <div className="eyebrow">Per side (bar {formatWeight(bar, unit)})</div>
            <div className="chips wrap mt-2">{r.perSide.length ? r.perSide.map((p, i) => <span key={i} className="badge">{formatWeight(p, unit, false)}</span>) : <span className="dim">Bar only</span>}</div>
            <div className="small mt-2">{r.exact ? 'Exact load.' : `Closest loadable: ${formatWeight(r.achievedKg, unit)}`}</div>
          </div>
        ) : <p className="dim small">Enter a weight of at least the bar ({formatWeight(bar, unit)}).</p>}
        {warm.length > 0 && <div className="card"><div className="eyebrow">Suggested warm-up ramp</div>{warm.map((w) => <div key={w.weight_kg} className="row-flex between small mt-1"><span>{formatWeight(w.weight_kg, unit)}</span><span className="dim">× {w.reps}</span></div>)}</div>}
      </div>
    </Sheet>
  );
}
