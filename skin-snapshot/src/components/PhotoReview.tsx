'use client';
import type { CheckResult } from '../core/pose';
import { useLang } from './LangProvider';

/** Shows a captured or chosen photo with specific problems, and Retake / Use this photo. */
export function PhotoReview({ url, results, onRetake, onUse, busy }: { url: string; results: CheckResult[]; onRetake: () => void; onUse: (filterOverride: boolean) => void; busy?: boolean }) {
  const { dict: d } = useLang();
  const failing = results.filter((r) => !r.ok);
  const hard = failing.filter((r) => r.severity === 'hard');
  const filter = failing.find((r) => r.code === 'possible_filter');
  const soft = failing.filter((r) => r.severity === 'soft' && r.code !== 'possible_filter');
  const msg = (code: string) => (d.camera.msg as Record<string, string>)[code] ?? code;
  return (
    <div data-testid="photo-review" className="stack">
      <h2 style={{ fontSize: '1.6rem' }}>{d.camera.reviewTitle}</h2>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="review-img" src={url} alt="" />
      {failing.length === 0 ? (
        <p className="notice calm" role="status">{d.camera.reviewOk}</p>
      ) : (
        <div className="notice" role="alert">
          <strong>{d.camera.reviewProblems}</strong>
          <ul style={{ margin: '8px 0 0' }}>{failing.map((r) => <li key={r.id + r.code}>{msg(r.code)}</li>)}</ul>
          {hard.length > 0 && <p style={{ margin: '10px 0 0', fontWeight: 700 }}>{d.camera.cannotUse}</p>}
        </div>
      )}
      <div className="btn-row">
        <button type="button" className="btn secondary" onClick={onRetake} data-testid="retake">{d.camera.retake}</button>
        {hard.length === 0 && soft.length >= 0 && (
          <button type="button" className="btn" onClick={() => onUse(false)} disabled={busy || !!filter} data-testid="use-photo">{d.camera.use}</button>
        )}
        {hard.length === 0 && filter && (
          <button type="button" className="btn gold" onClick={() => onUse(true)} disabled={busy} data-testid="use-anyway">{d.camera.useAnyway}</button>
        )}
      </div>
    </div>
  );
}
