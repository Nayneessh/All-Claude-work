import { notFound } from 'next/navigation';
import { LegalSections, LegalShell, retentionVars } from '../../../../components/pages';
import { isLang } from '../../../../core/types';
import { fmt, getDict } from '../../../../i18n';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  return { title: getDict(isLang(lang) ? lang : 'en').legal.consent.title };
}
export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const d = getDict(lang);
  const v = retentionVars();
  const l = d.legal.consent;
  return (
    <LegalShell d={d} title={l.title} lead={l.lead}>
      <p className="muted small">{fmt(d.legal.updated, v)}</p>
      <LegalSections sections={l.items} vars={v} />
    </LegalShell>
  );
}
