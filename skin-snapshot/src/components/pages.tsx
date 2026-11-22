import Link from 'next/link';
import type { ReactNode } from 'react';
import { IconDrop, IconLeaf, IconSpark } from './icons';
import { PATHS, type Lang, type PathId } from '../core/types';
import { fmt, type Dict } from '../i18n';
import { siteEnv } from '../lib/siteenv';

export const PATH_ICON: Record<PathId, (p: { size?: number }) => ReactNode> = { maintenance: IconLeaf, concerns: IconDrop, scars: IconSpark };

export function CtaButton({ lang, d, path, secondary, children }: { lang: Lang; d: Dict; path?: PathId; secondary?: boolean; children?: ReactNode }) {
  return (
    <Link className={`btn${secondary ? ' secondary' : ''}`} href={`/${lang}/start${path ? `?path=${path}` : ''}`}>
      {children ?? d.nav.start}
    </Link>
  );
}

export function PathCards({ lang, d }: { lang: Lang; d: Dict }) {
  return (
    <div className="grid g3">
      {PATHS.map((p) => {
        const Icon = PATH_ICON[p];
        return (
          <Link key={p} href={`/${lang}/${d.paths[p].slug}`} className="card path-card" data-testid={`path-card-${p}`}>
            <span className="icon-badge"><Icon size={24} /></span>
            <h3>{d.paths[p].name}</h3>
            <p style={{ margin: 0 }}>{d.paths[p].short}</p>
            <span className="go">{d.common.learnMore} →</span>
          </Link>
        );
      })}
    </div>
  );
}

export function PathPage({ lang, d, path }: { lang: Lang; d: Dict; path: PathId }) {
  const p = d.paths[path];
  const extra = p as Dict['paths']['concerns'];
  const Icon = PATH_ICON[path];
  return (
    <>
      <section className="hero">
        <div className="container">
          <p className="eyebrow">{d.nav.paths}</p>
          <h1>{p.name}</h1>
          <p className="lead">{p.short}</p>
          <div className="btn-row"><CtaButton lang={lang} d={d} path={path}><span>{p.cta}</span></CtaButton></div>
        </div>
      </section>
      <section className="section">
        <div className="container grid g2">
          <div className="card accent">
            <span className="icon-badge" style={{ marginBottom: 12 }}><Icon size={24} /></span>
            <h3>{p.whoTitle}</h3>
            <p style={{ marginBottom: 0 }}>{p.who}</p>
          </div>
          <div className="card">
            <h3>{p.lookTitle}</h3>
            <ul className="check-list" style={{ marginBottom: 0 }}>{p.look.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
          <div className="card">
            <h3>{p.getTitle}</h3>
            <ul className="check-list" style={{ marginBottom: 0 }}>{p.get.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
          <div className="card">
            <h3>{p.notTitle}</h3>
            <ul style={{ marginBottom: 0 }}>{p.not.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
          {'doctor' in p && (
            <div className="card accent" style={{ gridColumn: '1 / -1' }}>
              <h3>{extra.doctorTitle}</h3>
              <ul className="cross-list">{extra.doctor.map((x) => <li key={x}>{x}</li>)}</ul>
              {'doctorNote' in p && <p className="notice" style={{ marginBottom: 0 }}>{(p as Dict['paths']['scars']).doctorNote}</p>}
            </div>
          )}
        </div>
      </section>
      <section className="section alt">
        <div className="container btn-row" style={{ justifyContent: 'space-between' }}>
          <p style={{ margin: 0, maxWidth: '52ch' }}>{d.privacyStrip}</p>
          <CtaButton lang={lang} d={d} path={path}><span>{p.cta}</span></CtaButton>
        </div>
      </section>
    </>
  );
}

export function LegalSections({ sections, vars }: { sections: readonly { h: string; p: readonly string[] }[]; vars?: Record<string, string | number> }) {
  return (
    <div className="prose">
      {sections.map((s) => (
        <section key={s.h}>
          <h2>{s.h}</h2>
          {s.p.map((t) => <p key={t}>{vars ? fmt(t, vars) : t}</p>)}
        </section>
      ))}
    </div>
  );
}

export function LegalShell({ d, title, lead, children }: { d: Dict; title: string; lead?: string; children: ReactNode }) {
  return (
    <section className="section">
      <div className="container narrow">
        <h1>{title}</h1>
        <hr className="gold-rule" />
        {lead && <p className="lead">{lead}</p>}
        <p className="notice draft" role="note">{d.legal.banner}</p>
        {children}
      </div>
    </section>
  );
}

export const retentionVars = () => {
  const e = siteEnv();
  return { hours: e.unbookedHours, days: e.closedDays, version: '2026-11-22-DRAFT-1', promise: e.servicePromise };
};
