'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { PATHS, type Lang } from '../core/types';
import { useLang } from './LangProvider';
import { fmt } from '../i18n';

/** The logo area is reserved top right and left empty until the real logo exists. The text is fixed English by request. */
export const LOGO_PLACEHOLDER = 'Your logo goes over here.';

function LangToggle() {
  const { lang } = useLang();
  const pathname = usePathname();
  const router = useRouter();
  const go = (next: Lang) => {
    if (next === lang) return;
    try {
      document.cookie = `ss_lang=${next}; path=/; SameSite=Lax`; // session cookie, remembers the choice for this visit
    } catch {
      /* ignore */
    }
    const rest = pathname.replace(/^\/(en|hi)(?=\/|$)/, '');
    router.push(`/${next}${rest || ''}${window.location.search}${window.location.hash}`);
  };
  return (
    <div className="lang-toggle" role="group" aria-label={lang === 'hi' ? 'भाषा / Language' : 'Language / भाषा'}>
      <button type="button" lang="en" aria-pressed={lang === 'en'} onClick={() => go('en')}>English</button>
      <button type="button" lang="hi" aria-pressed={lang === 'hi'} onClick={() => go('hi')}>हिन्दी</button>
    </div>
  );
}

export function Header() {
  const { lang, dict } = useLang();
  const d = dict;
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState(false);
  const pathname = usePathname();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    setOpen(false);
    setSub(false);
  }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (setOpen(false), setSub(false));
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setSub(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, []);
  const href = (p: string) => `/${lang}${p}`;
  const cur = (p: string) => (pathname === href(p) ? 'page' : undefined);

  return (
    <header className="site-header" ref={ref}>
      <div className="container header-row">
        <button type="button" className="nav-toggle" aria-expanded={open} aria-controls="site-nav" aria-label={open ? d.nav.close : d.nav.menu} onClick={() => setOpen((v) => !v)}>
          <span />
        </button>
        <nav id="site-nav" className={`nav${open ? ' open' : ''}`} aria-label={d.nav.main}>
          <Link href={href('')} aria-current={pathname === `/${lang}` ? 'page' : undefined}>{d.nav.home}</Link>
          <div className={`has-sub${sub ? ' open' : ''}`}>
            <button type="button" className="nav-link" aria-expanded={sub} aria-haspopup="true" onClick={(e) => { e.stopPropagation(); setSub((v) => !v); }}>
              {d.nav.paths} <span aria-hidden="true">▾</span>
            </button>
            <div className="sub" style={sub ? undefined : undefined}>
              {PATHS.map((p) => (
                <Link key={p} href={href(`/${d.paths[p].slug}`)} aria-current={cur(`/${d.paths[p].slug}`)}>{d.paths[p].name}</Link>
              ))}
            </div>
          </div>
          <Link href={href('/how-it-works')} aria-current={cur('/how-it-works')}>{d.nav.how}</Link>
          <Link href={href('/about')} aria-current={cur('/about')}>{d.nav.about}</Link>
          <Link href={href('/faq')} aria-current={cur('/faq')}>{d.nav.faq}</Link>
          <Link href={href('/contact')} aria-current={cur('/contact')}>{d.nav.contact}</Link>
        </nav>
        <div className="header-right">
          <LangToggle />
          <div className="logo-slot" data-testid="logo-placeholder">{LOGO_PLACEHOLDER}</div>
        </div>
      </div>
      <style>{`@media (max-width:899px){ .nav .has-sub .sub{display:block} } `}</style>
    </header>
  );
}

export function startHref(lang: Lang, path?: string) {
  return `/${lang}/start${path ? `?path=${path}` : ''}`;
}
void fmt;
