import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CaseApp } from '../../../../../components/CaseApp';
import { isLang } from '../../../../../core/types';

export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true }, title: 'Your skin check' };

export default async function Page({ params }: { params: Promise<{ lang: string; token: string }> }) {
  const { lang, token } = await params;
  if (!isLang(lang)) notFound();
  return <CaseApp token={token} />;
}
