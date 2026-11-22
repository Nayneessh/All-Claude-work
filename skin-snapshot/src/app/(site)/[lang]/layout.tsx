import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-700.css';
import '@fontsource-variable/manrope/index.css';
import '@fontsource/noto-sans-devanagari/devanagari-400.css';
import '@fontsource/noto-sans-devanagari/devanagari-500.css';
import '@fontsource/noto-sans-devanagari/devanagari-600.css';
import '@fontsource/tiro-devanagari-hindi/devanagari-400.css';
import '../../globals.css';
import { Footer } from '../../../components/Footer';
import { Header } from '../../../components/Header';
import { LangProvider } from '../../../components/LangProvider';
import { PageView } from '../../../components/PageView';
import { IconLock } from '../../../components/icons';
import { LANGS, isLang } from '../../../core/types';
import { fmt, getDict } from '../../../i18n';
import { siteEnv } from '../../../lib/siteenv';

export const dynamicParams = false;
export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#4A6B5D' };

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const d = getDict(isLang(lang) ? lang : 'en');
  const env = siteEnv();
  return {
    title: { default: d.meta.title, template: `%s · ${d.meta.siteName}` },
    description: d.meta.description,
    robots: env.noindex ? { index: false, follow: false } : undefined,
    alternates: { languages: { en: '/en', hi: '/hi' } },
    icons: { icon: '/icon.svg' },
  };
}

export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const d = getDict(lang);
  const env = siteEnv();
  return (
    <html lang={lang}>
      <body>
        <a className="skip" href="#main">{d.nav.skip}</a>
        <LangProvider lang={lang} dict={d} hours={env.unbookedHours} days={env.closedDays}>
          {env.testBanner && (
            <div className="test-banner" role="note" data-testid="test-banner">
              {fmt(d.banner.test, { hours: env.unbookedHours })}
            </div>
          )}
          <Header />
          <div className="privacy-strip" data-testid="privacy-strip">
            <div className="container">
              <IconLock size={18} />
              <span>{d.privacyStrip}</span>
            </div>
          </div>
          <main id="main" tabIndex={-1}>{children}</main>
          <Footer lang={lang} d={d} />
          <PageView />
        </LangProvider>
      </body>
    </html>
  );
}
