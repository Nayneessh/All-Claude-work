import { useMemo, useState } from 'react';
import { SERIES } from '@/brand/tokens';

/** Real-data charts only: every component takes computed values and shows a gap (not a zero) for missing points. */
export function niceScale(min: number, max: number, ticks = 4): { lo: number; hi: number; step: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { lo: 0, hi: 1, step: 0.25 };
  if (min === max) { const pad = Math.abs(min) * 0.1 || 1; min -= pad; max += pad; }
  const raw = (max - min) / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
}

const W = 340;

export interface LinePoint { x: number; y: number | null; label?: string; marker?: boolean }
export interface LineSeries { name: string; color?: string; points: LinePoint[] }

export function LineChart({ series, xTicks, yFormat = (n) => String(Math.round(n * 10) / 10), height = 180, ariaLabel, onPoint, zeroBased = false }: {
  series: LineSeries[]; xTicks: { x: number; label: string }[]; yFormat?: (n: number) => string; height?: number; ariaLabel: string; onPoint?: (p: LinePoint, seriesIdx: number) => void; zeroBased?: boolean;
}) {
  const [sel, setSel] = useState<{ x: number; y: number; text: string } | null>(null);
  const { lo, hi, step, x0, x1 } = useMemo(() => {
    const ys = series.flatMap((s) => s.points.map((p) => p.y).filter((v): v is number => v !== null));
    const xs = [...series.flatMap((s) => s.points.map((p) => p.x)), ...xTicks.map((t) => t.x)];
    const sc = niceScale(zeroBased ? 0 : Math.min(...ys), Math.max(...ys));
    return { ...sc, x0: Math.min(...xs), x1: Math.max(...xs) };
  }, [series, xTicks, zeroBased]);
  const padL = 38, padR = 10, padT = 10, padB = 22;
  const iw = W - padL - padR, ih = height - padT - padB;
  const sx = (x: number): number => padL + (x1 === x0 ? iw / 2 : ((x - x0) / (x1 - x0)) * iw);
  const sy = (y: number): number => padT + ih - ((y - lo) / (hi - lo || 1)) * ih;
  const grid: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) grid.push(v);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={ariaLabel}>
      {grid.map((g) => <g key={g}><line className="grid" x1={padL} x2={W - padR} y1={sy(g)} y2={sy(g)} /><text x={padL - 6} y={sy(g) + 3} textAnchor="end">{yFormat(g)}</text></g>)}
      {xTicks.map((t) => <text key={t.x} x={sx(t.x)} y={height - 6} textAnchor="middle">{t.label}</text>)}
      {series.map((s, si) => {
        const color = s.color ?? SERIES[si % SERIES.length];
        const segs: LinePoint[][] = [];
        let cur: LinePoint[] = [];
        for (const p of s.points) { if (p.y === null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(p); }
        if (cur.length) segs.push(cur);
        return (
          <g key={s.name}>
            {segs.map((seg, i) => seg.length > 1 && <polyline key={i} fill="none" style={{ stroke: color }} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" points={seg.map((p) => `${sx(p.x)},${sy(p.y as number)}`).join(' ')} />)}
            {s.points.filter((p) => p.y !== null).map((p) => (
              <g key={`${p.x}`} onClick={() => { setSel({ x: sx(p.x), y: sy(p.y as number), text: p.label ?? yFormat(p.y as number) }); onPoint?.(p, si); }} style={{ cursor: 'pointer' }}>
                <circle cx={sx(p.x)} cy={sy(p.y as number)} r={14} fill="transparent" />
                <circle cx={sx(p.x)} cy={sy(p.y as number)} r={p.marker ? 5 : 3.2} style={{ fill: p.marker ? 'var(--gold)' : color, stroke: 'var(--night-green)' }} strokeWidth={1.5} />
              </g>
            ))}
          </g>
        );
      })}
      {sel && (
        <g pointerEvents="none">
          <rect x={Math.min(Math.max(sel.x - 48, 2), W - 98)} y={Math.max(sel.y - 30, 2)} width={96} height={20} rx={6} style={{ fill: 'var(--night-blue)', stroke: 'var(--gold)' }} />
          <text x={Math.min(Math.max(sel.x, 50), W - 50)} y={Math.max(sel.y - 16, 16)} textAnchor="middle" style={{ fill: 'var(--text)' }}>{sel.text}</text>
        </g>
      )}
    </svg>
  );
}

export interface BarDatum { key: string; label: string; value: number | null; sub?: string; highlight?: boolean; muted?: boolean }

export function BarChart({ data, yFormat = (n) => String(Math.round(n)), height = 170, ariaLabel, onBar, color = 'var(--gold)' }: { data: BarDatum[]; yFormat?: (n: number) => string; height?: number; ariaLabel: string; onBar?: (d: BarDatum) => void; color?: string }) {
  const max = Math.max(0, ...data.map((d) => d.value ?? 0));
  const { hi, step } = niceScale(0, max || 1, 4);
  const padL = 38, padR = 6, padT = 10, padB = 22;
  const iw = W - padL - padR, ih = height - padT - padB;
  const bw = Math.min(34, (iw / Math.max(data.length, 1)) * 0.68);
  const grid: number[] = [];
  for (let v = 0; v <= hi + 1e-9; v += step) grid.push(v);
  const every = data.length > 12 ? Math.ceil(data.length / 8) : 1;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={ariaLabel}>
      {grid.map((g) => { const y = padT + ih - (g / hi) * ih; return <g key={g}><line className="grid" x1={padL} x2={W - padR} y1={y} y2={y} /><text x={padL - 6} y={y + 3} textAnchor="end">{yFormat(g)}</text></g>; })}
      {data.map((d, i) => {
        const cx = padL + (iw / data.length) * (i + 0.5);
        const h = d.value ? (d.value / hi) * ih : 0;
        return (
          <g key={d.key} onClick={() => onBar?.(d)} style={{ cursor: onBar ? 'pointer' : 'default' }} role={onBar ? 'button' : undefined} aria-label={`${d.label}: ${d.value === null ? 'no data' : yFormat(d.value)}`}>
            <rect x={cx - iw / data.length / 2} y={padT} width={iw / data.length} height={ih} fill="transparent" />
            {d.value === null || d.value === 0
              ? <rect x={cx - bw / 2} y={padT + ih - 2} width={bw} height={2} rx={1} style={{ fill: 'var(--line-strong)' }} />
              : <rect x={cx - bw / 2} y={padT + ih - h} width={bw} height={h} rx={4} style={{ fill: d.muted ? 'var(--gold-dim)' : color, opacity: d.highlight ? 1 : 0.85 }} />}
            {i % every === 0 && <text x={cx} y={height - 6} textAnchor="middle">{d.label}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export function HBars({ rows, max, format = (n) => String(Math.round(n * 10) / 10), onRow }: { rows: { key: string; label: string; value: number; color?: string; sub?: string }[]; max?: number; format?: (n: number) => string; onRow?: (key: string) => void }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      {rows.map((r, i) => {
        const inner = (
          <>
            <span className="small ellipsis">{r.label}</span>
            <span className="bar"><i style={{ width: `${(r.value / m) * 100}%`, background: r.color ?? SERIES[i % SERIES.length] }} /></span>
            <span className="num small center">{format(r.value)}</span>
          </>
        );
        return onRow
          ? <button key={r.key} type="button" className="hbar" onClick={() => onRow(r.key)}>{inner}</button>
          : <div key={r.key} className="hbar">{inner}</div>;
      })}
    </div>
  );
}

export function Sparkline({ values, width = 90, height = 28 }: { values: (number | null)[]; width?: number; height?: number }) {
  const v = values.filter((x): x is number => x !== null);
  if (v.length < 2) return null;
  const lo = Math.min(...v), hi = Math.max(...v);
  const pts = values.map((y, i) => (y === null ? null : `${(i / (values.length - 1)) * width},${height - 3 - ((y - lo) / (hi - lo || 1)) * (height - 6)}`)).filter(Boolean).join(' ');
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><polyline points={pts} fill="none" style={{ stroke: 'var(--gold)' }} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
