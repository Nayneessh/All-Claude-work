import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLang } from '../../../../core/types';
import { getDict } from '../../../../i18n';
import { CameraPreview } from '../../../../components/CameraPreview';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const d = getDict(lang);
  return (
    <section className="section">
      <div className="container narrow">
        <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.6rem)' }}>{d.camera.preview.title}</h1>
        <hr className="gold-rule" />
        <CameraPreview />
      </div>
    </section>
  );
}
