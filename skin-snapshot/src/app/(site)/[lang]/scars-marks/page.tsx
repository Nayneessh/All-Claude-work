import { notFound } from 'next/navigation';
import { PathPage } from '../../../../components/pages';
import { isLang } from '../../../../core/types';
import { getDict } from '../../../../i18n';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  return { title: getDict(isLang(lang) ? lang : 'en').paths.scars.name };
}

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return <PathPage lang={lang} d={getDict(lang)} path="scars" />;
}
