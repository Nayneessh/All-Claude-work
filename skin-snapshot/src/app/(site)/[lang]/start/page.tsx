import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { StartFlow } from '../../../../components/StartFlow';
import { isLang } from '../../../../core/types';
import { getDict } from '../../../../i18n';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  return { title: getDict(isLang(lang) ? lang : 'en').nav.start };
}
export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return (
    <Suspense fallback={null}>
      <StartFlow />
    </Suspense>
  );
}
