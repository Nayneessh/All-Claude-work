# AI engine

## Configuration (no rebuild to change provider or model)

| Variable | Meaning |
| --- | --- |
| `AI_PROVIDER` | `anthropic`, `openai-compatible`, or `mock` (tests and offline demos; refused in staging and production) |
| `AI_MODEL` | Model identifier for that provider |
| `AI_API_KEY`, `AI_BASE_URL` | Credential and endpoint |
| `AI_AUTH` | `bearer` (API key) or `vercel-oidc` (Vercel AI Gateway, no key to manage) |
| `AI_PASSES` | Independent passes, default 2 |
| `AI_TIMEOUT_MS` | Per-call timeout, default 50 000 |

Candidate models (to be chosen by evaluation, not assumed): Claude Sonnet 5.5 as default, Opus 5.5 or Fable 5.2 for accuracy, Haiku 5.5 for a cheap pre-check. Any provider with image input and JSON-schema output can be added as one class in `src/ai/providers.ts`.

## Pipeline (`src/server/analysis.ts`)

1. Gate A is re-run server-side from the stored answers. A stop ends the flow before any image is read.
2. Required photos (front, left, right) are loaded and downscaled to 1280 px for the model.
3. `AI_PASSES` independent calls run in parallel. Output that is not valid is retried once; provider errors that are retryable are retried once.
4. Every response is validated against a strict schema and a closed vocabulary (`src/core/ai-schema.ts`, `validate-output.ts`): unknown fields, free text, a finding from another attribute, an attribute for the wrong zone, a missing reason for "not assessed" are all rejected.
5. Passes are merged: agreement keeps a finding; disagreement turns it into "Not sure" using the milder finding; red flags are the union.
6. Gate B turns image red flags into a stop. By default even "not sure" stops (configurable, needs dermatologist sign-off).
7. Poor image quality asks for a retake instead of a snapshot.
8. The snapshot is composed from approved phrases (`src/core/phrases.ts`); the routine comes from cosmetologist templates.
9. Logged: identifiers, provider, model, prompt version, passes, disagreements, timings, token counts. Never images, answers or model text.

## What the model receives

Photos (front, left, right, optional close-up), the chosen path, and whether makeup is worn. **Health answers are never sent.**

## Output schema (`skin-snapshot-result/v1`)

`image_quality {overall, issues[]}`, `observations[] {zone, attribute, finding, side, confidence, reason}`, `best_fit_path`, `best_fit_confidence`, `red_flags[] {code, confidence}`. Zones: forehead, cheeks, nose, chin, under_eyes. Confidence: clear, likely, not_sure, not_assessed. Allowed findings per attribute are in `src/core/types.ts`. There is no field for a diagnosis, score, percentage, skin age, hydration reading, product or medicine.

## Prompt

`src/ai/prompt.ts`, version `prompt-v1`. Any change to wording or rules must change the version string; every stored analysis records the version that produced it. Key rules: describe only; no condition names; one observation per attribute/zone; honest uncertainty; extra care on deeper skin tones (redness is harder to see, so unsure means "not sure", never "none visible"); report red flags by code only; over-flag when unsure.

## Errors

| Situation | Behaviour |
| --- | --- |
| Provider unreachable, 5xx, 429, timeout | One retry, then the case moves to `analysis_failed`; the visitor can retry; photos are kept |
| Invalid model output | One retry, then `analysis_failed`; nothing is shown |
| Poor photo quality reported by the model | `needs_retake` with plain reasons |
| Missing configuration | The API reports `not_configured`; public pages still work |

## Cost

Not measured: no live model was called during the build. Rough size per case with 2 passes: about 14 000 input tokens (3 to 4 images plus prompt, twice) and about 3 000 output tokens. Multiply by your model's price. The analysis table records tokens per run, so real cost per case can be read from the database after the first live tests.

## Evaluation

`ai_feedback` stores the cosmetologist's agree/disagree per observation and reports of missed or false safety flags. Images are kept for evaluation only if the visitor ticked the optional fifth consent. A dermatologist-labelled test set, split by skin tone, is required before launch (`docs/REVIEW_REQUIRED.md`).
