/** Chart/JS access to the design tokens — values are CSS variables, never raw colours. */
export const COLORS = {
  gold: 'var(--gold)',
  green: 'var(--night-green)',
  blue: 'var(--night-blue)',
  text: 'var(--text)',
  dim: 'var(--text-dim)',
  line: 'var(--line)',
  lineStrong: 'var(--line-strong)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  card: 'var(--card)',
  cardBlue: 'var(--card-blue)',
} as const;

export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)'] as const;

/** Native APIs (status bar, splash) cannot read CSS variables, so the brand hex values are exported here — the only TS file allowed to hold them. */
export const NATIVE = { nightGreen: '#071F16', gold: '#D4AF37', nightBlue: '#0B1630' } as const;
