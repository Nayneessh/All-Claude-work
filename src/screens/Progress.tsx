import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { loadDashboard, type Dashboard } from '@/data/repo/dashboard';
import { storeRecommendations, listRecommendations } from '@/data/repo/misc';
import type { RangeKey } from '@/domain/periods';
import { parseDate, addDays } from '@/domain/periods';
import { GROUP_LABELS, type MuscleGroup } from '@/domain/muscles';
import { PR_LABELS } from '@/domain/records';
import { formatVolume, formatWeight, kgToLb } from '@/domain/units';
import { Badge, Banner, Button, Card, Chip, Empty, Loading, ProgressBar, Section } from '@/ui/kit';
import { Icon } from '@/ui/icons';
import { BarChart, HBars, LineChart } from '@/ui/charts';
import { useLive } from '@/app/hooks';
import { useApp } from '@/app/AppContext';
import { fmtDate, fmtMonth, pct, plural, signed } from '@/ui/format';
import type { DipFlag } from '@/domain/dips';

const RANGES: { key: RangeKey; label: string }[] = [{ key: '7d', label: '7 days' }, { key: '4w', label: '4 weeks' }, { key: '8w', label: '8 weeks' }, { key: '12w', label: '12 weeks' }, { key: '6m', label: '6 months' }, { key: '1y', label: '1 year' }, { key: 'all', label: 'All time' }];
type Metric = 'volume' | 'sets' | 'sessions';

const SIGNAL: Record<string, { label: string; tone: 'ok' | 'warn' | 'info' | 'dim' | 'bad' }> = {
  insufficient_data: { label: 'Not enough data', tone: 'dim' }, improving: { label: 'Improving', tone: 'ok' }, plateau: { label: 'Plateau', tone: 'warn' }, regressing: { label: 'Trending down', tone: 'bad' },
  possible_fatigue: { label: 'Possible fatigue', tone: 'warn' }, inconsistent: { label: 'Inconsistent', tone: 'info' }, steady: { label: 'Steady', tone: 'info' },
};

export function Progress() {
  const nav = useNavigate();
  const { today, unit } = useApp();
  const [sp, setSp] = useSearchParams();
  const range = (sp.get('r') as RangeKey | null) ?? '8w';
  const [metric, setMetric] = useState<Metric>('volume');
  const [monthly, setMonthly] = useState(false);
  const [mode, setMode] = useState<'direct' | 'weighted'>('direct');
  const [exId, setExId] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const d = useLive(() => loadDashboard(range, today), [range, today]);
  const open = useLive(async () => (await listRecommendations()).filter((r) => r.status === 'open').length, []);
  const setRange = (r: RangeKey): void => setSp({ r }, { replace: true });

  // store (never apply) suggestions so the user can accept / edit / dismiss / defer them later
  useEffect(() => { if (d.data?.proposals.length) void storeRecommendations(d.data.proposals); }, [d.data?.proposals]);

  const dash: Dashboard | undefined = d.data;
  const hasData = !!dash && dash.stats.sessions > 0;
  const trend = useMemo(() => { if (!dash) return null; return dash.trends.find((t) => t.exercise.id === exId) ?? dash.trends.find((t) => t.perfs.filter((p) => p.score !== null).length >= 2) ?? dash.trends[0] ?? null; }, [dash, exId]);

  return (
    <div className="screen">
      <div className="page-title"><h1>Progress</h1><Button small variant="soft" icon="note" onClick={() => nav('/progress/reports')}>Reports</Button></div>
      <div className="chips" role="group" aria-label="Date range">{RANGES.map((r) => <Chip key={r.key} on={range === r.key} onClick={() => setRange(r.key)}>{r.label}</Chip>)}</div>

      {d.loading || !dash ? <div className="mt-4"><Loading /></div> : !hasData && dash.attendance.planned === 0 ? (
        <Card className="mt-4"><Empty icon="chart" title="Your progress starts with your first workout" hint="Every chart here is built from the sets you log — nothing is made up. Finish a workout and this page fills in." action={<Button variant="primary" onClick={() => nav('/')}>Go to today</Button>} /></Card>
      ) : (
        <>
          {(open.data ?? 0) > 0 && <div className="mt-3"><Banner icon="bolt" action={<Button small variant="soft" onClick={() => nav('/progress/suggestions')}>Review</Button>}>{plural(open.data ?? 0, 'suggestion')} based on your recent training.</Banner></div>}

          <div className="kpis mt-4">
            <button className="kpi" type="button" onClick={() => nav(`/progress/drill/sessions/all?r=${range}`)} aria-label="Sessions: see details">
              <div className="l">Sessions done / planned</div><div className="v">{dash.attendance.attended}<span className="dim" style={{ fontSize: '1.2rem' }}> / {dash.attendance.planned || '—'}</span></div>
              <div className={`d ${dash.attendance.rate !== null && dash.attendance.rate >= 0.8 ? 'ok' : 'warn'}`}>{dash.attendance.rate !== null ? `${pct(dash.attendance.rate)} attendance` : 'No schedule in range'}</div>
            </button>
            <button className="kpi" type="button" onClick={() => nav(`/progress/drill/volume/all?r=${range}`)} aria-label="Volume: see details">
              <div className="l">Volume load</div><div className="v">{formatVolume(dash.stats.volumeKg, unit)}</div>
              <Delta cur={dash.stats.volumeKg} prev={dash.prev.volumeKg} />
            </button>
            <button className="kpi" type="button" onClick={() => nav(`/progress/drill/muscle/all?r=${range}`)} aria-label="Sets: see details">
              <div className="l">Working sets · hard sets</div><div className="v">{dash.stats.workingSets}<span className="dim" style={{ fontSize: '1.2rem' }}> · {dash.stats.hardSets}</span></div>
              <Delta cur={dash.stats.workingSets} prev={dash.prev.workingSets} />
            </button>
            <button className="kpi" type="button" onClick={() => nav(`/progress/drill/prs/all?r=${range}`)} aria-label="Records: see details">
              <div className="l">Personal records</div><div className="v">{dash.prs.length}</div><div className="d dim">{dash.prs[0] ? `latest ${fmtDate(dash.prs[0].date)}` : 'none yet in range'}</div>
            </button>
          </div>
          {dash.stats.unknownVolumeSets > 0 && <p className="tiny warn mt-2">{plural(dash.stats.unknownVolumeSets, 'set')} had no load recorded and {dash.stats.unknownVolumeSets === 1 ? 'is' : 'are'} not in the volume total (missing is never counted as zero).</p>}

          <Section title={monthly ? 'Monthly trend' : 'Weekly trend'} action={<div className="row-flex" style={{ gap: 6 }}><Chip on={!monthly} onClick={() => setMonthly(false)}>Week</Chip><Chip on={monthly} onClick={() => setMonthly(true)}>Month</Chip></div>}>
            <Card className="blue">
              <div className="chips mb-2" style={{ marginBottom: 8 }}>{(['volume', 'sets', 'sessions'] as Metric[]).map((m) => <Chip key={m} on={metric === m} onClick={() => setMetric(m)}>{m === 'volume' ? 'Volume' : m === 'sets' ? 'Sets' : 'Sessions'}</Chip>)}</div>
              {(monthly ? dash.months : dash.weeks).length === 0 ? <Empty icon="chart" title="No data in this range" /> : (
                <BarChart ariaLabel={`${monthly ? 'Monthly' : 'Weekly'} ${metric}`} yFormat={(n) => (metric === 'volume' ? (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n))) : String(Math.round(n)))}
                  data={(monthly ? dash.months.map((m) => ({ key: m.month, label: fmtMonth(m.month).slice(0, 3), p: m })) : dash.weeks.map((w) => ({ key: w.weekStart, label: fmtDate(w.weekStart, { weekday: false }), p: w }))).map(({ key, label, p }) => ({
                    key, label, value: p.trained ? (metric === 'volume' ? (unit === 'kg' ? p.volumeKg : kgToLb(p.volumeKg)) : metric === 'sets' ? p.workingSets : p.sessions) : null, highlight: key === (monthly ? today.slice(0, 7) : dash.weeks.at(-1)?.weekStart),
                  }))}
                  onBar={(b) => { if (!monthly) nav(`/progress/drill/week/${b.key}?r=${range}`); }} />
              )}
              <p className="tiny dim mt-2">{metric === 'volume' ? `Volume load in ${unit}: load × reps for working sets. ` : ''}Weeks with no training show as an empty baseline. Tap a bar to see its sessions.</p>
            </Card>
          </Section>

          <Section title="Plan vs reality">
            <Card>
              <div className="row-flex between"><span>Sessions completed</span><span className="strong">{dash.attendance.attended} of {dash.attendance.planned}</span></div>
              <div className="mt-1"><ProgressBar value={(dash.attendance.rate ?? 0) * 100} label="Attendance" /></div>
              <div className="row-flex between mt-3"><span>Planned volume performed</span><span className="strong">{dash.pva.ratio !== null ? pct(dash.pva.ratio) : '—'}</span></div>
              <div className="mt-1"><ProgressBar value={Math.min(100, (dash.pva.ratio ?? 0) * 100)} label="Planned volume performed" /></div>
              <p className="tiny dim mt-2">{dash.pva.comparableSets > 0 ? `Compared on ${plural(dash.pva.comparableSets, 'set')} that had a planned load and reps. ${dash.pva.completedSets} of ${dash.pva.plannedSets} planned sets were done.` : 'Needs sets that have a planned load (not “find your 12RM”).'}</p>
              <div className="row-flex between mt-3 small"><span className="dim">Streak (weeks ≥ 80% attended)</span><span className="strong gold">{dash.streak.currentWeeks} <span className="dim">· best {dash.streak.longestWeeks}</span></span></div>
              <div className="row-flex between small mt-1"><span className="dim">Avg sessions / week</span><span className="strong">{dash.frequencyPerWeek.toFixed(1)}</span></div>
              <div className="row-flex between small mt-1"><span className="dim">Avg session length</span><span className="strong">{dash.avgDurationMin ? `${dash.avgDurationMin} min` : '—'}</span></div>
            </Card>
          </Section>

          <Section title="Muscle groups" action={<div className="row-flex" style={{ gap: 6 }}><Chip on={mode === 'direct'} onClick={() => setMode('direct')}>Direct</Chip><Chip on={mode === 'weighted'} onClick={() => setMode('weighted')}>Weighted</Chip></div>}>
            <Card>
              {(mode === 'direct' ? dash.muscles : dash.musclesWeighted).length === 0 ? <Empty icon="dumbbell" title="No sets in range" /> : (
                <HBars rows={(mode === 'direct' ? dash.muscles : dash.musclesWeighted).map((m) => ({ key: m.group, label: GROUP_LABELS[m.group], value: Math.round(m.sets * 10) / 10, sub: dash.sinceMuscle.has(m.group) ? `${dash.sinceMuscle.get(m.group)} d ago` : '' }))} onRow={(g) => nav(`/progress/drill/muscle/${g as MuscleGroup}?r=${range}`)} />
              )}
              <p className="tiny dim mt-2">{mode === 'direct' ? 'Direct sets: only a movement’s primary muscles count (this matches how a program sheet counts “Biceps 19”).' : 'Weighted: secondary muscles get half credit. An estimate — compound lifts are not counted in full for every muscle.'} Sets in range, not per week.</p>
            </Card>
          </Section>

          <Section title="Strength trend" action={trend && <Button small variant="ghost" onClick={() => nav(`/exercises/${trend.exercise.id}`)}>Details</Button>}>
            <Card className="blue">
              {dash.trends.length === 0 ? <Empty icon="chart" title="No lifts logged yet" /> : (
                <>
                  <div className="chips">{dash.trends.slice(0, 10).map((t) => <Chip key={t.exercise.id} on={trend?.exercise.id === t.exercise.id} onClick={() => setExId(t.exercise.id)}>{t.exercise.name.length > 22 ? `${t.exercise.name.slice(0, 20)}…` : t.exercise.name}</Chip>)}</div>
                  {trend && (() => {
                    const comp = trend.perfs.filter((p) => p.score !== null && p.date >= dash.from && p.date <= dash.to);
                    const t0 = comp[0] ? parseDate(comp[0].date) : 0;
                    const pts = comp.map((p) => ({ x: Math.round((parseDate(p.date) - t0) / 86_400_000), y: unit === 'lb' && trend.exercise.tracking_method === 'weight_reps' ? kgToLb(p.score as number) : (p.score as number), label: `${fmtDate(p.date)} · ${Math.round(p.score as number)}`, marker: trend.prs.some((r) => r.session_id === p.session_id && !r.is_baseline) }));
                    const sg = SIGNAL[trend.assessment.signal] ?? SIGNAL.steady!;
                    return (
                      <div className="mt-3">
                        <div className="row-flex between"><span className="strong">{trend.exercise.name}</span><Badge tone={sg.tone}>{sg.label}</Badge></div>
                        {pts.length >= 2 ? <LineChart ariaLabel={`${trend.exercise.name} trend`} series={[{ name: 'e1RM', points: pts }]} xTicks={[0, pts[pts.length - 1]!.x].map((x) => ({ x, label: fmtDate(addDays(comp[0]!.date, x), { weekday: false }) }))} /> : <Empty icon="chart" title="Not enough sessions in this range" hint="A trend needs at least 2 sessions of this lift." />}
                        <p className="small dim">{trend.assessment.reasons[0]}</p>
                        <p className="tiny dim mt-1">{trend.exercise.tracking_method === 'weight_reps' ? `Estimated 1RM (${unit}) per session — an estimate, not a tested max. Gold dots = records.` : 'Best result per session. Gold dots = records.'}</p>
                      </div>
                    );
                  })()}
                </>
              )}
            </Card>
          </Section>

          <Section title="What changed">
            {dash.dips.length === 0 ? <Card><p className="small dim">No volume drops, missed sessions or performance dips detected. Flags need enough comparable history, and a planned deload is never flagged.</p></Card> : <div className="col">{dash.dips.map((f) => <DipCard key={f.id} flag={f} unit={unit} onDrill={() => nav(`/progress/drill/${f.drill.type}/${f.drill.id}?r=${range}`)} />)}</div>}
          </Section>

          <Section title="Recent records" action={<Button small variant="ghost" onClick={() => nav(`/progress/drill/prs/all?r=${range}`)}>All</Button>}>
            {dash.prs.length === 0 ? <Card><p className="small dim">No new records in this range. The first time you log a lift is its baseline; records appear when you beat it.</p></Card> : (
              <Card className="pad-0"><div className="list">{dash.prs.slice(0, 5).map((p) => <button key={`${p.set_id}${p.type}`} type="button" className="item" onClick={() => nav(`/history/${p.session_id}`)}><span className="sticker">PR</span><div className="grow"><div className="strong ellipsis">{dash.ctx.exercises.get(p.exercise_id)?.name}</div><div className="small dim">{PR_LABELS[p.type]}{p.estimated ? ' (est.)' : ''} · {fmtDate(p.date)}{p.improvement_pct !== null ? ` · ${signed(p.improvement_pct, 1)}%` : ''}</div></div><div className="num strong gold">{['max_weight', 'best_e1rm', 'actual_1rm', 'max_set_volume'].includes(p.type) ? formatWeight(p.value, unit) : Math.round(p.value)}</div></button>)}</div></Card>
            )}
          </Section>

          {dash.quality.length > 0 && <Section title="Data quality"><div className="col">{dash.quality.map((q) => <Banner key={q.code} tone="warn" icon="warn">{q.message}</Banner>)}</div></Section>}

          <Section title="Advanced" action={<Button small variant="ghost" onClick={() => setAdvanced(!advanced)}>{advanced ? 'Hide' : 'Show'}</Button>}>
            {advanced && (
              <Card>
                <div className="row-flex between small"><span className="dim">Acute (7 d) vs chronic (28 d avg) volume</span><span className="strong">{dash.workload.ratio !== null ? dash.workload.ratio.toFixed(2) : '—'}</span></div>
                <div className="row-flex between small mt-2"><span className="dim">Training monotony (7 d)</span><span className="strong">{dash.monotony.monotony !== null ? dash.monotony.monotony.toFixed(2) : '—'}</span></div>
                <p className="tiny dim mt-2">Descriptive ratios of your own volume — not injury-prediction scores.</p>
                <div className="divider" />
                {dash.trends.filter((t) => t.perfs.filter((p) => p.score !== null).length >= 3).slice(0, 6).map((t) => (
                  <div key={t.exercise.id} className="mt-2"><div className="strong small">{t.exercise.name}</div>
                    <div className="tiny dim">Progress / week: 4w {fmtVel(t.velocity.w4)} · 8w {fmtVel(t.velocity.w8)} · 12w {fmtVel(t.velocity.w12)}{t.daysSincePr !== null ? ` · last PR ${t.daysSincePr} d ago` : ''}{t.relStrength !== null ? ` · ${t.relStrength.toFixed(2)}× bodyweight` : ''}</div></div>
                ))}
              </Card>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

const fmtVel = (v: number | null): string => (v === null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`);

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return <div className="d dim">no previous period to compare</div>;
  const ch = ((cur - prev) / prev) * 100;
  return <div className={`d ${ch >= 0 ? 'ok' : 'warn'}`}>{ch >= 0 ? '▲' : '▼'} {Math.abs(ch).toFixed(0)}% vs previous period</div>;
}

function DipCard({ flag, onDrill }: { flag: DipFlag; unit: 'kg' | 'lb'; onDrill: () => void }) {
  const [openC, setOpenC] = useState(false);
  return (
    <Card>
      <button type="button" className="row-flex" style={{ width: '100%', background: 'none', border: 0, color: 'inherit', textAlign: 'left', padding: 0 }} onClick={() => setOpenC(!openC)} aria-expanded={openC}>
        <Icon name={flag.severity === 'watch' ? 'warn' : 'info'} className={flag.severity === 'watch' ? 'warn' : 'dim'} /><div className="grow"><div className="strong">{flag.title}</div><div className="small dim">{flag.summary}</div></div><Icon name={openC ? 'up' : 'down'} size={20} className="chev" />
      </button>
      {openC && (
        <div className="mt-3 small">
          <div className="row-flex between"><span className="dim">Started</span><span>{fmtDate(flag.startDate, { year: true })}</span></div>
          {flag.magnitudePct !== null && <div className="row-flex between"><span className="dim">Magnitude</span><span>{signed(flag.magnitudePct)}%</span></div>}
          <div className="row-flex between"><span className="dim">Compared with</span><span>{flag.comparison.label}{flag.comparison.baseline !== null ? ` (${Math.round(flag.comparison.baseline)} ${flag.comparison.unit})` : ''}</span></div>
          <div className="row-flex between"><span className="dim">Persistence</span><span>{plural(flag.persistence, flag.kind === 'e1rm_decline' || flag.kind === 'effort_rising' ? 'session' : 'week')}</span></div>
          {flag.contributors.length > 0 && <div className="mt-2"><div className="dim">Biggest contributors</div>{flag.contributors.map((c) => <div key={c.label}>{c.label}{c.deltaPct !== null ? ` · ${signed(c.deltaPct)}%` : ''}</div>)}</div>}
          {flag.notes.length > 0 && <div className="mt-2"><div className="dim">Your notes</div>{flag.notes.map((n) => <div key={n}>“{n}”</div>)}</div>}
          {flag.hypotheses.length > 0 && <div className="mt-2"><div className="dim">Possible explanations (hypotheses, not facts)</div>{flag.hypotheses.map((h) => <div key={h}>• {h}</div>)}</div>}
          <Button small className="mt-3" onClick={onDrill}>See the records behind this</Button>
        </div>
      )}
    </Card>
  );
}
