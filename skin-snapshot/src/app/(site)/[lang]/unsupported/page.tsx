import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isLang } from '../../../../core/types';
import { getDict } from '../../../../i18n';

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const d = getDict(lang).system.unsupported;
  return (
    <section className="section">
      <div className="container narrow" style={{ textAlign: 'center' }}>
        <h1>{d.title}</h1>
        <hr className="gold-rule" style={{ marginInline: 'auto' }} />
        <p className="lead" style={{ marginInline: 'auto' }}>{d.lead}</p>
        <p><Link className="btn" href={`/${lang}`}>{getDict(lang).nav.home}</Link></p>
      </div>
    </section>
  );
}
