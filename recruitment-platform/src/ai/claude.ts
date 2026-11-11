import {
  assessmentModelOutputSchema, extractedProfileSchema, rubricDraftSchema,
  type AiProvider, type AssessRequest, type AssessmentModelOutput, type ExtractedProfile, type ExtractRequest, type RubricDraft, type RubricRequest, type Served,
} from '@/domain/contract';
import type { ProviderInfo } from '@/domain/types';
import type { ZodType } from 'zod';

/**
 * Hosted-model provider. It never holds a provider key: every call goes to the app's own /api/ai proxy with the signed-in user's
 * Supabase token (see api/ai.ts). Responses are re-validated here against the same schemas the offline engine satisfies.
 */

export class AiProxyError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'AiProxyError';
  }
}

const MESSAGES: Record<string, string> = {
  unauthorized: 'Your session is not authorised to use the AI service. Sign in again.',
  payload_too_large: 'This CV is too large for the AI service.',
  rate_limited: 'The AI service is busy. Try again shortly.',
  refused: 'The AI provider declined to process this document.',
  truncated: 'The AI response was cut off. Try again or review the CV manually.',
  invalid_model_output: 'The AI service returned an unreadable response.',
  provider_error: 'The AI service is unavailable right now.',
};

/** Optional keys are returned as null by structured output; the contract expects them absent. `rating: null` is meaningful and kept. */
export function stripNulls<T>(v: T, keep: ReadonlySet<string> = new Set(['rating'])): T {
  if (Array.isArray(v)) return v.map((x) => stripNulls(x, keep)) as T;
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).filter(([k, x]) => x !== null || keep.has(k)).map(([k, x]) => [k, stripNulls(x, keep)]),
    ) as T;
  }
  return v;
}

export interface ClaudeOptions {
  endpoint?: string;
  getToken: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_INFO: ProviderInfo = { id: 'anthropic', model: 'claude-opus-5-5', promptVersion: 'rip-2026-11-v1' };

export function createClaudeProvider(opts: ClaudeOptions): AiProvider {
  const endpoint = opts.endpoint ?? '/api/ai';
  const doFetch = opts.fetchImpl ?? fetch;
  const retries = opts.retries ?? 2;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: ProviderInfo = DEFAULT_INFO;

  async function call<T>(task: 'rubric' | 'extract' | 'assess', payload: unknown, schema: ZodType<T>): Promise<Served<T>> {
    for (let attempt = 0; ; attempt++) {
      const token = await opts.getToken();
      if (!token) throw new AiProxyError(401, 'unauthorized', MESSAGES.unauthorized);
      let res: Response;
      try {
        res = await doFetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ task, payload }) });
      } catch {
        if (attempt < retries) { await sleep(400 * 2 ** attempt); continue; }
        throw new AiProxyError(0, 'network', 'Could not reach the AI service.');
      }
      if (res.ok) {
        const body = (await res.json()) as { data: unknown; meta?: { provider?: string; model?: string; promptVersion?: string } };
        const parsed = schema.parse(stripNulls(body.data));
        const served: ProviderInfo = { id: body.meta?.provider ?? 'anthropic', model: body.meta?.model ?? DEFAULT_INFO.model, promptVersion: body.meta?.promptVersion ?? DEFAULT_INFO.promptVersion };
        last = served;
        return { ...parsed, served };
      }
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      const code = err.error ?? 'provider_error';
      if ((res.status === 429 || res.status === 502) && code !== 'truncated' && attempt < retries) { await sleep(500 * 2 ** attempt); continue; }
      throw new AiProxyError(res.status, code, MESSAGES[code] ?? `AI service error (${res.status}).`);
    }
  }

  return {
    get info(): ProviderInfo { return last; },
    generateRubric: (req: RubricRequest): Promise<Served<RubricDraft>> => call('rubric', req, rubricDraftSchema),
    extractProfile: (req: ExtractRequest): Promise<Served<ExtractedProfile>> => call('extract', req, extractedProfileSchema),
    assessCandidate: (req: AssessRequest): Promise<Served<AssessmentModelOutput>> => call('assess', req, assessmentModelOutputSchema),
  };
}
