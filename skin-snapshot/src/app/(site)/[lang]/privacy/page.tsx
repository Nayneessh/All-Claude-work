import { notFound } from 'next/navigation';
import { LegalSections, LegalShell, retentionVars } from '../../../../components/pages';
import { isLang } from '../../../../core/types';
import { fmt, getDict } from '../../../../i18n';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  return { title: getDict(isLang(lang) ? lang : 'en').legal.privacy.title };
}
export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const d = getDict(lang);
  const v = retentionVars();
  const l = d.legal.privacy;
  return (
    <LegalShell d={d} title={l.title}>
      <p className="muted small">{fmt(d.legal.updated, v)}</p>
      <LegalSections sections={l.sections} vars={v} />
    </LegalShell>
  );
}
