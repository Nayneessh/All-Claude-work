import { notFound } from 'next/navigation';
import { isLang } from '../../../../core/types';
import { getDict } from '../../../../i18n';
import { siteEnv } from '../../../../lib/siteenv';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  return { title: getDict(isLang(lang) ? lang : 'en').contact.title };
}
export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const d = getDict(lang);
  const e = siteEnv();
  const rows: [string, string][] = [
    [d.contact.whatsapp, e.contactWhatsapp],
    [d.contact.email, e.contactEmail],
    [d.contact.location, e.contactLocation],
  ];
  const any = rows.some(([, v]) => v);
  return (
    <section className="section">
      <div className="container narrow">
        <h1>{d.contact.title}</h1>
        <hr className="gold-rule" />
        <p className="lead">{d.contact.lead}</p>
        <div className="card accent" style={{ margin: '22px 0' }}>
          <dl style={{ margin: 0 }}>
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
                <dt style={{ fontWeight: 700, minWidth: 130 }}>{k}</dt>
                <dd style={{ margin: 0 }}>{v || d.common.tbc}</dd>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 12, padding: '8px 0', flexWrap: 'wrap' }}>
              <dt style={{ fontWeight: 700, minWidth: 130 }}>{d.contact.grievance}</dt>
              <dd style={{ margin: 0 }}>{e.contactEmail || d.common.tbc}</dd>
            </div>
          </dl>
        </div>
        {!any && <p className="notice">{d.contact.pending}</p>}
        <p>{d.contact.dataRequests}</p>
        <p className="muted">{d.contact.whatsappHint}</p>
      </div>
    </section>
  );
}
