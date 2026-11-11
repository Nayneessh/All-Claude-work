import { STATUS_LABEL, type ScreeningStatus } from '@/domain/types';

export const fmtDate = (iso?: string): string => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (iso?: string): string => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const pct = (n: number): string => `${Math.round(n * 100)}%`;
export const years = (n?: number): string => (n === undefined ? '—' : `${n} yrs`);

export type Tone = 'ok' | 'caution' | 'info' | 'bad' | 'neutral' | 'gold';
export interface StatusStyle { tone: Tone; icon: 'check' | 'star' | 'scale' | 'eye' | 'alert' | 'minus' | 'person'; label: string }

/** Status colour reflects what happens next: qualified → ok, a person must decide → caution, verify/review → info, failed gate → bad, below threshold → neutral. */
export const STATUS_STYLE: Record<ScreeningStatus, StatusStyle> = {
  exceptional_match: { tone: 'ok', icon: 'star', label: STATUS_LABEL.exceptional_match },
  strong_match: { tone: 'ok', icon: 'check', label: STATUS_LABEL.strong_match },
  potential_match: { tone: 'ok', icon: 'check', label: STATUS_LABEL.potential_match },
  borderline_review: { tone: 'caution', icon: 'scale', label: STATUS_LABEL.borderline_review },
  below_threshold: { tone: 'neutral', icon: 'minus', label: STATUS_LABEL.below_threshold },
  mandatory_non_compliance: { tone: 'bad', icon: 'alert', label: STATUS_LABEL.mandatory_non_compliance },
  verification_required: { tone: 'info', icon: 'eye', label: STATUS_LABEL.verification_required },
  manual_review: { tone: 'info', icon: 'person', label: STATUS_LABEL.manual_review },
};

export const download = (blob: Blob, name: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
