import Link from 'next/link';
import { getDict } from '../../../i18n';

// Rendered inside the language layout, so it is shown in the visitor's language chrome.
export default function NotFound() {
  const d = getDict('en').system.notFound;
  const h = getDict('hi').system.notFound;
  return (
    <section className="section">
      <div className="container narrow" style={{ textAlign: 'center' }}>
        <h1>{d.title}</h1>
        <hr className="gold-rule" style={{ marginInline: 'auto' }} />
        <p className="lead" style={{ marginInline: 'auto' }}>{d.lead}</p>
        <p lang="hi" className="muted">{h.title}. {h.lead}</p>
        <p className="btn-row" style={{ justifyContent: 'center' }}>
          <Link className="btn" href="/en">{d.home}</Link>
          <Link className="btn secondary" href="/hi" lang="hi">{h.home}</Link>
        </p>
      </div>
    </section>
  );
}
