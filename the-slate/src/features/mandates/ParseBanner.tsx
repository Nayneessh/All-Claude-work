import type { ParseResult } from '../../domain/nl/common';

const LABEL: Record<string, string> = { title: 'Title', company: 'Company', level: 'Level', positions: 'Positions', location: 'Location', work_mode: 'Work mode', reporting_to: 'Reporting to', span: 'Span',
  budget: 'Budget', urgency: 'Urgency', received_on: 'Received date', started_on: 'Start date', target_close: 'Target close', consultants: 'Consultant', confidential: 'Confidential',
  name: 'Name', current_company: 'Current company', designation: 'Designation', phone: 'Phone', email: 'Email', source: 'Source', current_ctc: 'Current CTC', expected_ctc: 'Expected CTC',
  notice_period: 'Notice period', current_location: 'Location', mandate_id: 'Mandate', open_to_relocate: 'Relocation', stakeholder: 'Hiring manager', additional_benefits: 'Benefits' };
export const labelOf = (k: string) => LABEL[k] ?? k;

/** Summary shown above a pre-filled form: what was understood, what needs checking, what is missing. */
export function ParseBanner({ r, onDismiss }: { r: ParseResult<never>; onDismiss: () => void }) {
  const found = Object.keys(r.fields).length;
  return (
    <div className="banner info stack-s" role="status" style={{ flexDirection: 'column' }}>
      <div className="row"><b>{found} field{found === 1 ? '' : 's'} understood</b><span className="chip">{r.source === 'ai' ? '✦ read by AI' : '⚙ read by rules'}</span><button className="btn xs right" onClick={onDismiss} type="button">Hide</button></div>
      <div className="small dim">Nothing is saved yet — review, correct anything, then confirm. <span style={{ color: 'var(--amber)' }}>Amber ⚑</span> = inferred or ambiguous, <span className="gold">dashed gold</span> = not provided.</div>
      {Object.entries(r.ambiguous).map(([k, v]) => <div key={k} className="small" style={{ color: 'var(--amber)' }}>⚑ <b>{labelOf(k)}:</b> {v}</div>)}
      {r.missing.length > 0 && <div className="small"><span className="muted">Not provided: </span>{r.missing.map(labelOf).join(', ')}</div>}
      {r.unused.length > 0 && <div className="small"><span className="muted">Not used (no matching field): </span>{r.unused.map((u) => `“${u}”`).join(' · ')}</div>}
    </div>
  );
}
