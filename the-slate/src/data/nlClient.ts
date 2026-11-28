import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { parseMandateText, type MandateInput, type MandateParseContext } from '../domain/nl/mandateParser';
import { parseCandidateText, type CandidateInput, type CandidateParseContext } from '../domain/nl/candidateParser';
import type { ParseResult } from '../domain/nl/common';

/**
 * Natural-language entry. Order of attempts:
 *   1. Claude via the `slate-parse` edge function (the API key lives ONLY in Supabase secrets, never in the browser);
 *   2. the deterministic rule-based parser (works offline, needs no key).
 * Either way the result only PRE-FILLS a form; nothing is saved until the user reviews and confirms.
 */
const aiSchema = z.object({
  fields: z.record(z.string(), z.unknown()), inferred: z.array(z.string()).default([]), ambiguous: z.record(z.string(), z.string()).default({}),
  missing: z.array(z.string()).default([]), unused: z.array(z.string()).default([]),
});

async function callAI<F>(kind: 'mandate' | 'candidate', text: string, context: unknown): Promise<ParseResult<F> | null> {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15_000);
    const { data, error } = await supabase.functions.invoke('slate-parse', { body: { kind, text, context }, signal: ctl.signal } as never);
    clearTimeout(t);
    if (error || !data || (data as { error?: string }).error) return null;
    const p = aiSchema.safeParse(data); if (!p.success) return null;
    return { ...p.data, fields: p.data.fields as Partial<F>, source: 'ai' };
  } catch { return null; }
}

export async function parseMandate(text: string, ctx: MandateParseContext): Promise<ParseResult<MandateInput>> {
  const ai = await callAI<MandateInput>('mandate', text, ctx);
  return ai ?? parseMandateText(text, ctx);
}
export async function parseCandidate(text: string, ctx: CandidateParseContext): Promise<ParseResult<CandidateInput>> {
  const ai = await callAI<CandidateInput>('candidate', text, ctx);
  return ai ?? parseCandidateText(text, ctx);
}
