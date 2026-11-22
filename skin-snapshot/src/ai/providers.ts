// Provider adapters. Swapping the model or vendor is configuration, not a rebuild:
//   AI_PROVIDER = anthropic | openai-compatible | mock
//   AI_MODEL, AI_API_KEY, AI_BASE_URL, AI_AUTH (bearer | vercel-oidc)
import { aiResultJsonSchemaPortable } from '../core/ai-schema';
import { FINDINGS, PATH_ATTRIBUTES, ZONE_ATTRIBUTES, allowedSides, CONFIDENCES, type PathId } from '../core/types';
import type { AiResult } from '../core/ai-schema';
import { PROMPT_VERSION, TOOL_NAME, systemPrompt, userIntro } from './prompt';
import { ProviderError, type AnalyzeInput, type ProviderOutput, type VisionProvider } from './types';

export interface AiConfig {
  provider: 'anthropic' | 'openai-compatible' | 'mock';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  auth: 'bearer' | 'vercel-oidc';
  timeoutMs: number;
  passes: number;
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, signal?: AbortSignal) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  signal?.addEventListener('abort', () => ctl.abort(), { once: true });
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    const text = await r.text();
    if (!r.ok) throw new ProviderError('http', `provider returned ${r.status}`, r.status);
    try {
      return JSON.parse(text) as any;
    } catch {
      throw new ProviderError('bad_response', 'provider returned non-JSON');
    }
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if ((e as Error).name === 'AbortError') throw new ProviderError('timeout', 'provider timed out');
    throw new ProviderError('http', `provider request failed: ${(e as Error).message}`, 503);
  } finally {
    clearTimeout(t);
  }
}

export class AnthropicProvider implements VisionProvider {
  readonly name = 'anthropic';
  constructor(private cfg: AiConfig) {}
  get model() {
    return this.cfg.model;
  }
  async analyze(input: AnalyzeInput, signal?: AbortSignal): Promise<ProviderOutput> {
    if (!this.cfg.apiKey) throw new ProviderError('not_configured', 'AI_API_KEY is not set');
    const content: unknown[] = [{ type: 'text', text: userIntro(input) }];
    for (const img of input.images) {
      content.push({ type: 'text', text: `Photo: ${img.slot}` });
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: b64(img.bytes) } });
    }
    const json = await post(
      `${(this.cfg.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`,
      { 'x-api-key': this.cfg.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: this.cfg.model,
        max_tokens: 6000,
        temperature: 0,
        system: systemPrompt(input.path),
        messages: [{ role: 'user', content }],
        tools: [{ name: TOOL_NAME, description: 'Report the skin snapshot using only the allowed codes.', input_schema: aiResultJsonSchemaPortable() }],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      },
      this.cfg.timeoutMs,
      signal,
    );
    const block = (json.content ?? []).find((b: any) => b.type === 'tool_use');
    if (!block) throw new ProviderError(json.stop_reason === 'refusal' ? 'refused' : 'bad_response', 'no tool call in response');
    return { raw: block.input, inputTokens: json.usage?.input_tokens, outputTokens: json.usage?.output_tokens };
  }
}

export class OpenAiCompatibleProvider implements VisionProvider {
  readonly name = 'openai-compatible';
  constructor(private cfg: AiConfig) {}
  get model() {
    return this.cfg.model;
  }
  private async bearer(): Promise<string> {
    if (this.cfg.auth === 'vercel-oidc') {
      const { getVercelOidcToken } = await import('@vercel/oidc');
      return getVercelOidcToken();
    }
    if (!this.cfg.apiKey) throw new ProviderError('not_configured', 'AI_API_KEY is not set');
    return this.cfg.apiKey;
  }
  async analyze(input: AnalyzeInput, signal?: AbortSignal): Promise<ProviderOutput> {
    const token = await this.bearer();
    const content: unknown[] = [{ type: 'text', text: userIntro(input) }];
    for (const img of input.images) {
      content.push({ type: 'text', text: `Photo: ${img.slot}` });
      content.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${b64(img.bytes)}` } });
    }
    const json = await post(
      `${(this.cfg.baseUrl ?? 'https://ai-gateway.vercel.sh/v1').replace(/\/$/, '')}/chat/completions`,
      { authorization: `Bearer ${token}` },
      {
        model: this.cfg.model,
        temperature: 0,
        max_tokens: 6000,
        messages: [
          { role: 'system', content: systemPrompt(input.path) },
          { role: 'user', content },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'skin_snapshot', strict: true, schema: aiResultJsonSchemaPortable() } },
      },
      this.cfg.timeoutMs,
      signal,
    );
    const msg = json.choices?.[0]?.message;
    if (!msg?.content) throw new ProviderError('bad_response', 'empty completion');
    let raw: unknown;
    try {
      raw = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
    } catch {
      throw new ProviderError('bad_response', 'completion was not JSON');
    }
    return { raw, inputTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens };
  }
}

/** Deterministic stand-in for tests and offline demos. Never selected in production unless explicitly configured. */
export class MockProvider implements VisionProvider {
  readonly name = 'mock';
  readonly model = 'mock-v1';
  async analyze(input: AnalyzeInput): Promise<ProviderOutput> {
    const scenario = input.scenario ?? 'normal';
    if (scenario === 'error') throw new ProviderError('http', 'mock provider failure', 503);
    if (scenario === 'invalid') return { raw: { diagnosis: 'acne', skin_score: 87 } };
    let seed = 0;
    for (const img of input.images) for (let i = 0; i < img.bytes.length; i += 97) seed = (seed * 31 + img.bytes[i]!) >>> 0;
    return { raw: mockResult(input.path, seed, scenario), inputTokens: 3000, outputTokens: 900 };
  }
}

export function mockResult(path: PathId, seed: number, scenario = 'normal'): AiResult {
  let s = seed + 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const observations: AiResult['observations'] = [];
  for (const attribute of PATH_ATTRIBUTES[path]) {
    for (const zone of ZONE_ATTRIBUTES[attribute]) {
      // Mostly assessed, mostly "likely", so the staging page shows a realistic mix of labels.
      const r = rnd();
      const confidence = r < 0.2 ? 'clear' : r < 0.65 ? 'likely' : r < 0.9 ? 'not_sure' : 'not_assessed';
      const sides = allowedSides(zone);
      const side = sides[Math.floor(rnd() * sides.length)]!;
      if (confidence === 'not_assessed') observations.push({ zone, attribute, finding: 'not_assessed', side, confidence, reason: 'uneven_lighting' });
      else {
        const list = FINDINGS[attribute] as readonly string[];
        observations.push({ zone, attribute, finding: list[Math.min(list.length - 1, Math.floor(rnd() * rnd() * list.length))]!, side, confidence, reason: 'none' });
      }
    }
  }
  void CONFIDENCES;
  return {
    image_quality: scenario === 'poor_quality' ? { overall: 'poor', issues: ['photo_too_dark', 'photo_blurry'] } : { overall: scenario === 'fair_quality' ? 'fair' : 'good', issues: [] },
    observations,
    best_fit_path: scenario === 'mismatch' ? (path === 'maintenance' ? 'concerns' : 'maintenance') : path,
    best_fit_confidence: 'likely',
    red_flags: scenario === 'red_flag' ? [{ code: 'lesion_visible', confidence: 'likely' }] : [],
  };
}

export function buildProvider(cfg: AiConfig): VisionProvider {
  switch (cfg.provider) {
    case 'anthropic':
      return new AnthropicProvider(cfg);
    case 'openai-compatible':
      return new OpenAiCompatibleProvider(cfg);
    case 'mock':
      return new MockProvider();
  }
}

export { PROMPT_VERSION };
