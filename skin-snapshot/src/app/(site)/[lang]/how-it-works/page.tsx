import { notFound } from 'next/navigation';
import { CtaButton, LegalSections, retentionVars } from '../../../../components/pages';
import { isLang } from '../../../../core/types';
import { getDict } from '../../../../i18n';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  return { title: getDict(isLang(lang) ? lang : 'en').how.title };
}
export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const d = getDict(lang);
  return (
    <section className="section">
      <div className="container narrow">
        <h1>{d.how.title}</h1>
        <hr className="gold-rule" />
        <p className="lead">{d.how.lead}</p>
        <LegalSections sections={d.how.sections} vars={retentionVars()} />
        <div className="btn-row" style={{ marginTop: 24 }}><CtaButton lang={lang} d={d}><span>{d.how.cta}</span></CtaButton></div>
      </div>
    </section>
  );
}
