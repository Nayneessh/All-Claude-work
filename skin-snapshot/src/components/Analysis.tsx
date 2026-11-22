'use client';
import { useEffect, useState } from 'react';
import { useLang } from './LangProvider';

export function Analysis() {
  const { dict: d } = useLang();
  const [i, setI] = useState(0);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const a = setInterval(() => setI((n) => Math.min(n + 1, d.analysis.stages.length - 1)), 7000);
    const b = setTimeout(() => setSlow(true), 45_000);
    return () => {
      clearInterval(a);
      clearTimeout(b);
    };
  }, [d.analysis.stages.length]);
  return (
    <div className="container flow-wrap narrow" style={{ textAlign: 'center' }} role="status" aria-live="polite" data-testid="analysis">
      <div className="spinner" style={{ margin: '24px auto' }} />
      <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.6rem)' }}>{d.analysis.title}</h1>
      <p className="lead" style={{ marginInline: 'auto' }}>{d.analysis.lead}</p>
      <ol className="check-list" style={{ display: 'inline-block', textAlign: 'left', margin: '14px 0 0' }}>
        {d.analysis.stages.map((s, n) => <li key={s} style={{ opacity: n <= i ? 1 : 0.4, fontWeight: n === i ? 700 : 400 }}>{s}</li>)}
      </ol>
      {slow && <p className="muted" style={{ marginTop: 18 }}>{d.analysis.slow}</p>}
    </div>
  );
}
