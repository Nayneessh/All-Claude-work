import Link from 'next/link';
import type { Lang } from '../core/types';
import { PATHS } from '../core/types';
import type { Dict } from '../i18n';
import { fmt } from '../i18n';

export function Footer({ lang, d }: { lang: Lang; d: Dict }) {
  const h = (p: string) => `/${lang}${p}`;
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="grid g3">
          <div>
            <h3>{d.footer.about}</h3>
            <ul>
              {PATHS.map((p) => (
                <li key={p}><Link href={h(`/${d.paths[p].slug}`)}>{d.paths[p].name}</Link></li>
              ))}
              <li><Link href={h('/how-it-works')}>{d.footer.how}</Link></li>
              <li><Link href={h('/about')}>{d.nav.about}</Link></li>
            </ul>
          </div>
          <div>
            <h3>{d.footer.legal}</h3>
            <ul>
              <li><Link href={h('/privacy')}>{d.footer.privacy}</Link></li>
              <li><Link href={h('/consent')}>{d.footer.consent}</Link></li>
              <li><Link href={h('/terms')}>{d.footer.terms}</Link></li>
              <li><Link href={h('/disclaimer')}>{d.footer.disclaimer}</Link></li>
            </ul>
          </div>
          <div>
            <h3>{d.footer.contact}</h3>
            <ul>
              <li><Link href={h('/contact')}>{d.nav.contact}</Link></li>
              <li><Link href={h('/faq')}>{d.nav.faq}</Link></li>
              <li><Link href={h('/camera-help')}>{d.system.cameraHelp.title}</Link></li>
            </ul>
          </div>
        </div>
        <p className="fine">{d.footer.note}</p>
        <p className="fine" style={{ marginBottom: 0 }}>{fmt(d.footer.copyright, { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}
