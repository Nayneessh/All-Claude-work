import { notFound } from 'next/navigation';
import { IconShield } from '../../../../components/icons';
import { isLang } from '../../../../core/types';
import { getDict } from '../../../../i18n';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  return { title: getDict(isLang(lang) ? lang : 'en').about.title };
}
export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const a = getDict(lang).about;
  const c = getDict(lang).common;
  return (
    <section className="section">
      <div className="container narrow">
        <h1>{a.title}</h1>
        <hr className="gold-rule" />
        <p className="lead">{a.lead}</p>
        <div className="card accent" style={{ margin: '22px 0' }}>
          <span className="icon-badge" style={{ marginBottom: 12 }}><IconShield size={24} /></span>
          <h2 style={{ fontSize: '1.6rem' }}>{a.profileTitle}</h2>
          <dl style={{ margin: '14px 0' }}>
            {(['name', 'qualifications', 'experience', 'location'] as const).map((k) => (
              <div key={k} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
                <dt style={{ fontWeight: 700, minWidth: 150 }}>{a.fields[k]}</dt>
                <dd style={{ margin: 0 }}>{c.tbc}</dd>
              </div>
            ))}
          </dl>
          <p className="notice" style={{ marginBottom: 0 }}>{a.pending}</p>
        </div>
        <div className="grid g2">
          <div className="card"><h3>{a.isTitle}</h3><ul className="check-list" style={{ marginBottom: 0 }}>{a.is.map((x) => <li key={x}>{x}</li>)}</ul></div>
          <div className="card accent"><h3>{a.isNotTitle}</h3><ul className="cross-list" style={{ marginBottom: 0 }}>{a.isNot.map((x) => <li key={x}>{x}</li>)}</ul></div>
        </div>
      </div>
    </section>
  );
}
