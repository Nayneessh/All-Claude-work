// AI orchestration pipeline: structured input, quality validation, safety screening,
// path-specific analysis, structured output, confidence handling, output validation, error handling.
// Logging carries identifiers, timings and counts only. Never images, answers or model text.
import { downscaleForModel } from './images';
import { PROMPT_VERSION } from '../ai/prompt';
import { ProviderError, type ProviderOutput } from '../ai/types';
import { AI_SCHEMA_VERSION, type AiResult } from '../core/ai-schema';
import { evaluateGateA, evaluateGateB, combineSafety } from '../core/safety';
import { mergePasses, parseAiResult, OutputValidationError, qualityNeedsRetake } from '../core/validate-output';
import { REQUIRED_SLOTS, type PhotoSlot } from '../core/types';
import * as repo from '../data/repo';
import type { CaseRow } from '../data/repo';
import type { Deps } from './deps';

export function log(event: string, fields: Record<string, unknown> = {}): void {
  // One JSON line per event. Deliberately no free text from users or the model.
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
}

async function callOnce(deps: Deps, input: Parameters<Deps['ai']['analyze']>[0]): Promise<{ out: ProviderOutput; result: AiResult }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await deps.ai.analyze(input);
      return { out, result: parseAiResult(out.raw) };
    } catch (e) {
      lastErr = e;
      const retry = (e instanceof ProviderError && e.retryable) || e instanceof OutputValidationError;
      if (!retry) break;
    }
  }
  throw lastErr;
}

export type PipelineOutcome = 'snapshot_ready' | 'safety_stopped' | 'needs_retake' | 'analysis_failed';

/** Runs analysis for the case's current path. Idempotent: a second caller while one is running just waits for state. */
export async function runAnalysis(deps: Deps, c: CaseRow): Promise<PipelineOutcome> {
  const started = Date.now();
  const settings = await deps.settings();

  // Always create a fresh analysis row for this run; claim it atomically.
  const row = await repo.createAnalysis(deps.db, c.id, c.path);
  const claimed = await repo.claimAnalysis(deps.db, row.id, 120);
  if (!claimed) return 'analysis_failed';
  await repo.updateCase(deps.db, c.id, { stage: 'analysing' });
  log('analysis.start', { analysis: row.id, path: c.path, provider: deps.ai.name, model: deps.ai.model });

  try {
    // 1. Safety gate A is re-run server-side, from the stored answers, before any image leaves the system.
    const gateA = evaluateGateA(c.path, c.answers);
    if (gateA.stop) {
      await repo.updateCase(deps.db, c.id, { stage: 'safety_stopped', safety_stopped: true, safety_flags: gateA.flags, restrictions: gateA.restrictions });
      await repo.finishAnalysis(deps.db, row.id, { status: 'done', gateB: null, result: null });
      await repo.insertEvent(deps.db, { sessionId: c.session_id, name: 'safety_stop', path: c.path, lang: c.lang, props: { source: 'answers' } });
      return 'safety_stopped';
    }

    // 2. Images: all required photos must be stored.
    const photos = await repo.listPhotos(deps.db, c.id);
    const stored = photos.filter((p) => p.status === 'stored' && p.object_key);
    for (const slot of REQUIRED_SLOTS) if (!stored.some((p) => p.slot === slot)) throw new PipelineError('photos_missing');
    const images: Parameters<Deps['ai']['analyze']>[0]['images'] = [];
    for (const p of stored) {
      const obj = await deps.store.get(p.object_key!);
      if (!obj) throw new PipelineError('photo_unreadable');
      images.push({ slot: p.slot as PhotoSlot, mime: 'image/jpeg' as const, bytes: await downscaleForModel(obj.bytes) });
    }
    const makeup = c.answers.makeup_today === 'yes' ? true : c.answers.makeup_today === 'no' ? false : null;

    // 3. Independent passes in parallel. Agreement drives confidence.
    const passes = await Promise.all(Array.from({ length: deps.config.ai.passes }, () => callOnce(deps, { path: c.path, images, makeupToday: makeup, scenario: settings.aiMockScenario })));
    const merged = mergePasses(passes.map((p) => p.result), c.path);
    const inTok = passes.reduce((a, p) => a + (p.out.inputTokens ?? 0), 0);
    const outTok = passes.reduce((a, p) => a + (p.out.outputTokens ?? 0), 0);

    // 4. Safety gate B on image findings. Over-flags by default.
    const gateB = evaluateGateB(merged.redFlags, settings.gateBMinConfidence);
    const safety = combineSafety(gateA, gateB);
    const result = { observations: merged.observations, bestFit: merged.bestFit, quality: merged.quality, redFlags: merged.redFlags };

    await repo.finishAnalysis(deps.db, row.id, {
      status: 'done', provider: deps.ai.name, model: deps.ai.model, promptVersion: PROMPT_VERSION, schemaVersion: AI_SCHEMA_VERSION,
      passes: passes.length, disagreements: merged.disagreements, gateB, result, inputTokens: inTok, outputTokens: outTok,
    });

    if (safety.stopped) {
      await repo.updateCase(deps.db, c.id, { stage: 'safety_stopped', safety_stopped: true, safety_flags: safety.flags, restrictions: safety.restrictions });
      await repo.insertEvent(deps.db, { sessionId: c.session_id, name: 'safety_stop', path: c.path, lang: c.lang, props: { source: 'image' } });
      log('analysis.done', { analysis: row.id, outcome: 'safety_stopped', ms: Date.now() - started });
      return 'safety_stopped';
    }
    const poor = qualityNeedsRetake({ image_quality: merged.quality } as AiResult);
    if (poor) {
      await repo.updateCase(deps.db, c.id, { stage: 'needs_retake' });
      log('analysis.done', { analysis: row.id, outcome: 'needs_retake', ms: Date.now() - started });
      return 'needs_retake';
    }
    await repo.updateCase(deps.db, c.id, { stage: 'snapshot_ready' });
    await repo.insertEvent(deps.db, { sessionId: c.session_id, name: 'snapshot_ready', path: c.path, lang: c.lang, props: { ms: Date.now() - started } });
    log('analysis.done', { analysis: row.id, outcome: 'snapshot_ready', ms: Date.now() - started, passes: passes.length, disagreements: merged.disagreements, inTok, outTok });
    return 'snapshot_ready';
  } catch (e) {
    const code = e instanceof PipelineError ? e.code : e instanceof ProviderError ? `provider_${e.code}` : e instanceof OutputValidationError ? `output_${e.code}` : 'unexpected';
    await repo.finishAnalysis(deps.db, row.id, { status: 'failed', errorCode: code, provider: deps.ai.name, model: deps.ai.model, promptVersion: PROMPT_VERSION });
    await repo.updateCase(deps.db, c.id, { stage: 'analysis_failed' });
    log('analysis.failed', { analysis: row.id, code, ms: Date.now() - started });
    return 'analysis_failed';
  }
}

export class PipelineError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
