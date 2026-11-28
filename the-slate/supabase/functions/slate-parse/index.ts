// Supabase Edge Function: slate-parse
// Turns one free-text sentence into structured mandate / candidate fields for the app to PRE-FILL a form.
// Nothing is saved here. The Anthropic key lives only in the function's secrets (ANTHROPIC_API_KEY); without it the
// function answers 503 and the app falls back to its built-in rule-based parser.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { validate, type Ctx, type Kind, type Raw } from './validate.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const MODEL = Deno.env.get('SLATE_PARSE_MODEL') || Deno.env.get('COMMAND_MODEL') || 'claude-sonnet-5-5';
const hits = new Map<string, number[]>(); // best-effort per-user rate limit (resets with the isolate)

const RULES = `You extract structured recruitment data from ONE short message written by a recruiter. Call submit exactly once.
ABSOLUTE RULES
1. NEVER invent, guess or "complete" anything. Include a field only if the message states it (or it is a trivially safe normalisation such as "two" -> 2).
2. For EVERY field you include, put in "evidence" the exact words from the message that support it (copy them verbatim). Fields without evidence will be discarded.
3. If you had to interpret rather than copy (e.g. "immediate" -> urgency High, a level inferred from a job title), list the field in "inferred" and explain in "ambiguous". Prefer leaving the field out over guessing.
4. Never infer phone numbers, emails, compensation, dates or names that are not written.
5. Fragments of the message you could not map to any field go in "unused". Fields the message did not provide go in "missing".
6. Dates must be YYYY-MM-DD; resolve relative dates ("tomorrow", "next Monday") from TODAY. Compensation stays as written (e.g. "80 lakhs").`;
const SCHEMAS: Record<Kind, string> = {
  mandate: `KIND: mandate. Fields: title, company, stakeholder (hiring manager name), level (must be one of LEVELS), positions (integer), location, work_mode (WFO|Hybrid|Remote), reporting_to, span, budget, urgency (Low|Medium|High|Critical; "critical/emergency" = Critical; "urgent/immediate/asap" = High and mark inferred), confidential (true if confidential/stealth; false only if "open for advertisement" is said), received_on, started_on, target_close, consultants (array of agency/consultant names).`,
  candidate: `KIND: candidate. Fields: name, current_company, designation, phone, email, source (one of SOURCES), current_ctc, expected_ctc, additional_benefits, notice_period, current_location, open_to_relocate (boolean), mandate_id (ONLY if exactly one entry of MANDATES clearly matches; copy its id and mark inferred).`,
};
const TOOL = { name: 'submit', description: 'Submit the extracted fields.', input_schema: { type: 'object', required: ['fields', 'evidence'], properties: {
  fields: { type: 'object' }, evidence: { type: 'object', additionalProperties: { type: 'string' } }, inferred: { type: 'array', items: { type: 'string' } },
  ambiguous: { type: 'object', additionalProperties: { type: 'string' } }, missing: { type: 'array', items: { type: 'string' } }, unused: { type: 'array', items: { type: 'string' } } } } };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (req.method === 'GET') return json({ ai: !!key, model: key ? MODEL : null }); // health: reveals only whether a key is configured
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '', { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: 'unauthorized' }, 401);
  if (!key) return json({ error: 'no_key', message: 'The AI key is not set up; using the built-in reader.' }, 503);
  const now = Date.now(); const h = (hits.get(u.user.id) ?? []).filter((t) => now - t < 60_000); if (h.length >= 20) return json({ error: 'rate', message: 'Too many requests — wait a minute.' }, 429); hits.set(u.user.id, [...h, now]);

  let b: { kind?: string; text?: string; context?: Ctx };
  try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const kind = b.kind === 'candidate' ? 'candidate' : b.kind === 'mandate' ? 'mandate' : null; const text = String(b.text ?? '').trim().slice(0, 3000);
  if (!kind || !text) return json({ error: 'bad_request' }, 400);
  const ctx: Ctx = b.context ?? {};
  const lists = [`TODAY: ${ctx.today ?? new Date().toISOString().slice(0, 10)}`, `LEVELS: ${(ctx.levels ?? []).join(' | ') || '(any)'}`, `SOURCES: ${(ctx.sources ?? []).join(' | ') || '(any)'}`,
    `MANDATES: ${(ctx.mandates ?? []).slice(0, 150).map((m) => `${m.id} = ${m.title}${m.company ? ' — ' + m.company : ''}`).join('; ') || '(none)'}`].join('\n');

  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 30_000);
  let r: Response;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl.signal, headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: `${RULES}\n${SCHEMAS[kind]}`, tools: [TOOL], tool_choice: { type: 'tool', name: 'submit' }, messages: [{ role: 'user', content: `${lists}\n\nMESSAGE:\n${text}` }] }) });
  } catch { return json({ error: 'upstream', message: 'The AI service did not respond.' }, 502); } finally { clearTimeout(to); }
  if (!r.ok) { console.error('anthropic', r.status, (await r.text()).slice(0, 300)); return json({ error: r.status === 401 ? 'bad_key' : 'upstream', message: `The AI service returned an error (${r.status}).` }, 502); }
  const d = await r.json(); const tu = (d.content ?? []).find((c: { type: string }) => c.type === 'tool_use');
  if (!tu) return json({ error: 'no_result' }, 502);
  const out = validate(kind, text, tu.input as Raw, ctx);
  return json({ fields: out.fields, inferred: out.inferred, ambiguous: out.ambiguous, missing: out.missing, unused: out.unused, dropped: out.dropped, model: MODEL });
});
