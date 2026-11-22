import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isLang } from '../../../../core/types';
import { getDict } from '../../../../i18n';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  return { title: getDict(isLang(lang) ? lang : 'en').system.cameraHelp.title };
}
export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const d = getDict(lang);
  const s = d.camera.blocked.steps;
  const groups: [string, readonly string[]][] = [['Chrome (Android)', s.chromeAndroid], ['Safari (iPhone, iPad)', s.safariIos], ['Chrome, Edge, Firefox (laptop)', s.desktop], ['—', s.other]];
  return (
    <section className="section">
      <div className="container narrow">
        <h1>{d.system.cameraHelp.title}</h1>
        <hr className="gold-rule" />
        <p className="lead">{d.system.cameraHelp.lead}</p>
        <div className="grid g2" style={{ marginTop: 20 }}>
          {groups.map(([name, steps]) => (
            <div key={name} className="card">
              <h3>{name}</h3>
              <ol style={{ marginBottom: 0 }}>{steps.map((x) => <li key={x}>{x}</li>)}</ol>
            </div>
          ))}
        </div>
        <p style={{ marginTop: 24 }}><Link className="btn" href={`/${lang}/start`}>{d.nav.start}</Link></p>
      </div>
    </section>
  );
}
