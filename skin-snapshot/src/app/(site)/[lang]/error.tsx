'use client';
import { getDict } from '../../../i18n';
import { useParams } from 'next/navigation';
import { isLang } from '../../../core/types';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const p = useParams<{ lang?: string }>();
  const d = getDict(isLang(p?.lang) ? (p!.lang as 'en' | 'hi') : 'en');
  return (
    <section className="section">
      <div className="container narrow" style={{ textAlign: 'center' }}>
        <h1>{d.system.error.title}</h1>
        <p className="lead" style={{ marginInline: 'auto' }}>{d.system.error.lead}</p>
        <button className="btn" onClick={reset}>{d.common.retry}</button>
      </div>
    </section>
  );
}
