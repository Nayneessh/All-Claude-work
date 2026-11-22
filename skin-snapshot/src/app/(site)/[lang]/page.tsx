import Link from 'next/link';
import { CtaButton, PathCards } from '../../../components/pages';
import { IconShield, IconSpark } from '../../../components/icons';
import { isLang } from '../../../core/types';
import { fmt, getDict } from '../../../i18n';
import { notFound } from 'next/navigation';
import { retentionVars } from '../../../components/pages';

export default async function Home({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const d = getDict(lang);
  const v = retentionVars();
  return (
    <>
      <section className="hero">
        <div className="container">
          <p className="eyebrow">{d.home.eyebrow}</p>
          <h1>{d.home.title}</h1>
          <p className="lead">{d.home.lead}</p>
          <div className="btn-row">
            <CtaButton lang={lang} d={d}><span>{d.home.cta}</span></CtaButton>
            <Link className="btn on-sage secondary" href={`/${lang}/how-it-works`}>{d.home.ctaSecondary}</Link>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="who">
        <div className="container">
          <h2 id="who">{d.home.whoTitle}</h2>
          <hr className="gold-rule" />
          <p className="lead" style={{ marginBottom: 24 }}>{d.home.whoLead}</p>
          <PathCards lang={lang} d={d} />
        </div>
      </section>

      <section className="section alt" aria-labelledby="how">
        <div className="container">
          <h2 id="how">{d.home.howTitle}</h2>
          <hr className="gold-rule" />
          <ol className="steps">
            {d.home.steps.map((s) => (
              <li key={s.t}><h3>{s.t}</h3><p style={{ marginBottom: 0 }}>{s.d}</p></li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section" aria-labelledby="ai">
        <div className="container">
          <h2 id="ai">{d.home.aiTitle}</h2>
          <hr className="gold-rule" />
          <div className="grid g2">
            <div className="card">
              <h3>{d.home.aiCan}</h3>
              <ul className="check-list" style={{ marginBottom: 0 }}>{d.home.aiCanList.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div className="card accent">
              <h3>{d.home.aiCannot}</h3>
              <ul className="cross-list" style={{ marginBottom: 0 }}>{d.home.aiCannotList.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section alt" aria-labelledby="expert">
        <div className="container grid g2" style={{ alignItems: 'center' }}>
          <div>
            <span className="icon-badge" style={{ marginBottom: 12 }}><IconShield size={24} /></span>
            <h2 id="expert">{d.home.expertTitle}</h2>
            <hr className="gold-rule" />
            <p className="lead">{d.home.expertLead}</p>
            <Link className="btn secondary" href={`/${lang}/about`}>{d.home.expertCta}</Link>
          </div>
          <div className="card">
            <span className="icon-badge" style={{ marginBottom: 12 }}><IconSpark size={24} /></span>
            <p style={{ marginBottom: 0 }}>{fmt(d.how.sections[4]!.p[1]!, v)}</p>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="faqs">
        <div className="container narrow">
          <h2 id="faqs">{d.home.faqTitle}</h2>
          <hr className="gold-rule" />
          {d.faq.items.slice(0, 3).map((f) => (
            <details key={f.q} className="card flat" style={{ marginBottom: 10 }}>
              <summary style={{ fontWeight: 700, cursor: 'pointer' }}>{f.q}</summary>
              <p style={{ marginTop: 10, marginBottom: 0 }}>{fmt(f.a, v)}</p>
            </details>
          ))}
          <p style={{ marginTop: 18 }}><Link href={`/${lang}/faq`}>{d.nav.faq} →</Link></p>
        </div>
      </section>
    </>
  );
}
