export interface CheckResult { group: string; name: string; status: 'pass' | 'warn' | 'fail' | 'skip'; detail: string }
/** Runs the read-only GitHub / Vercel / Supabase checks. `f` lets tests inject a fake network. */
export function runChecks(env?: Record<string, string | undefined>, f?: typeof fetch): Promise<CheckResult[]>;
export function summarize(results: CheckResult[]): { pass: number; warn: number; fail: number; skip: number; ok: boolean };
export function toMarkdown(results: CheckResult[], now?: Date): string;
