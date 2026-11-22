import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PhoneCapture } from '../../../../../components/PhoneCapture';
import { isLang } from '../../../../../core/types';

export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true }, title: 'Continue on your phone' };

export default async function Page({ params }: { params: Promise<{ lang: string; token: string }> }) {
  const { lang, token } = await params;
  if (!isLang(lang)) notFound();
  return <PhoneCapture token={token} />;
}
