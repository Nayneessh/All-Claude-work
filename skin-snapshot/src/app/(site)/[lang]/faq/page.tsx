import { notFound } from 'next/navigation';
import { retentionVars } from '../../../../components/pages';
import { isLang } from '../../../../core/types';
import { fmt, getDict } from '../../../../i18n';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  return { title: getDict(isLang(lang) ? lang : 'en').faq.title };
}
export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const d = getDict(lang);
  const v = retentionVars();
  return (
    <section className="section">
      <div className="container narrow">
        <h1>{d.faq.title}</h1>
        <hr className="gold-rule" />
        {d.faq.items.map((f) => (
          <details key={f.q} className="card flat" style={{ marginBottom: 12 }}>
            <summary style={{ fontWeight: 700, cursor: 'pointer', minHeight: 32 }}>{f.q}</summary>
            <p style={{ marginTop: 10, marginBottom: 0 }}>{fmt(f.a, v)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
