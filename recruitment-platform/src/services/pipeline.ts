import { newId } from '@/data/repo';
import { extractedProfileSchema, type ExtractedProfile } from '@/domain/contract';
import { analyseChronology } from '@/domain/chronology';
import { findDuplicates, normaliseEmail } from '@/domain/duplicates';
import { extractionConfidence } from '@/domain/validate';
import type {
  Candidate, CandidateDocument, Mandate, PageText, ProcessingJob, ProcessingStatus,
} from '@/domain/types';
import { extractText } from '@/docs/extract';
import { MIME, checkFile, kindFromName, sha256, type FileKind } from '@/docs/validate';
import { groupIds } from './candidates';
import { audit, nextCode, require, NotFoundError, type Ctx } from './ctx';
import { getMandate } from './mandates';
import { activeRubric, screeningBlocker } from './rubrics';
import { screenCandidate } from './screening';

/**
 * CV processing pipeline (plan §4.5). Every upload becomes a ProcessingJob that survives refreshes and failures:
 * validate → security screen → store original → extract text (OCR flagged) → structure → de-duplicate → link → screen.
 * A CV is never silently dropped: it ends Completed, Needs Review or Failed, and its original file stays downloadable.
 */

const safe = (n: string): string => n.replace(/[^\w.\- ]+/g, '_').slice(0, 120);

async function setJob(ctx: Ctx, job: ProcessingJob, patch: Partial<ProcessingJob>, note?: string): Promise<ProcessingJob> {
  const next: ProcessingJob = { ...job, ...patch, notes: note ? [...job.notes, note] : job.notes, updatedAt: ctx.now().toISOString() };
  await ctx.repo.put('processing_jobs', next);
  return next;
}

export async function getJob(ctx: Ctx, id: string): Promise<ProcessingJob> {
  const j = await ctx.repo.get('processing_jobs', id);
  if (!j) throw new NotFoundError('Processing job', id);
  return j;
}

export interface UploadInput { mandateId: string; fileName: string; bytes: Uint8Array }

/** Steps 1–3 and the original-file save. Returns a job in `queued` (ready to run), `needs_review` (quarantined) or `failed` (rejected). */
export async function createJob(ctx: Ctx, input: UploadInput): Promise<ProcessingJob> {
  const mandate = await getMandate(ctx, input.mandateId);
  require(ctx, 'cv.upload', mandate.entityId);
  const at = ctx.now().toISOString();
  const check = checkFile(input.fileName, input.bytes);
  const kind = check.kind;
  const base: ProcessingJob = {
    id: newId(), entityId: mandate.entityId, mandateId: mandate.id, fileName: input.fileName,
    mimeType: kind ? MIME[kind] : undefined, size: input.bytes.length, status: 'uploaded', notes: ['File received.'],
    attempts: 0, createdBy: ctx.user.id, createdAt: at, updatedAt: at,
  };
  if (!check.ok) {
    const failed = { ...base, status: 'failed' as const, error: check.errors.join(' ') };
    await ctx.repo.put('processing_jobs', failed);
    return failed;
  }
  const hash = await sha256(input.bytes);
  const path = `${mandate.entityId}/${base.id}/${safe(input.fileName)}`;
  await ctx.repo.putFile(path, new Blob([input.bytes as BlobPart], { type: MIME[kind!] }));
  let job: ProcessingJob = { ...base, sha256: hash, storagePath: path };
  await ctx.repo.put('processing_jobs', job);
  if (check.securityFlags.length) {
    job = await setJob(ctx, job, { status: 'needs_review', error: `Quarantined: ${check.securityFlags.join('; ')}` }, 'Security screening flagged active or suspicious content. An administrator must release it before it is processed.');
    await audit(ctx, { action: 'job.quarantine', targetType: 'processing_job', targetId: job.id, entityId: job.entityId, summary: `${input.fileName} quarantined: ${check.securityFlags.join('; ')}` });
    return job;
  }
  return setJob(ctx, job, { status: 'queued' }, 'Validated and stored. Waiting to be processed.');
}

/** Admin-only: let a quarantined file proceed. Audited. */
export async function releaseQuarantine(ctx: Ctx, jobId: string): Promise<ProcessingJob> {
  const job = await getJob(ctx, jobId);
  require(ctx, 'config.manage', job.entityId);
  if (!job.error?.startsWith('Quarantined')) return job;
  await audit(ctx, { action: 'job.quarantine_release', targetType: 'processing_job', targetId: job.id, entityId: job.entityId, summary: `Released quarantined file ${job.fileName} (${job.error})` });
  return setJob(ctx, job, { status: 'queued', error: undefined }, `Quarantine released by ${ctx.user.name}.`);
}

export async function processUpload(ctx: Ctx, input: UploadInput): Promise<ProcessingJob> {
  const job = await createJob(ctx, input);
  return job.status === 'queued' ? runJob(ctx, job.id) : job;
}

export async function runJob(ctx: Ctx, jobId: string): Promise<ProcessingJob> {
  let job = await getJob(ctx, jobId);
  // Rejected at validation (unsupported / corrupt / mismatched file): nothing was stored, so there is nothing to run. Keep the reason.
  if (job.status === 'failed' && !job.storagePath) return job;
  const mandate = await getMandate(ctx, job.mandateId);
  require(ctx, 'cv.upload', mandate.entityId);
  job = await setJob(ctx, job, { attempts: job.attempts + 1, error: undefined, status: 'extracting' });
  try {
    const hit = await reuseIfSameFile(ctx, job, mandate);
    if (hit) return hit;

    const blob = job.storagePath ? await ctx.repo.getFile(job.storagePath) : undefined;
    if (!blob) throw new Error('The original file could not be found in storage.');
    const kind = kindFromName(job.fileName) as FileKind;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const ex = await extractText(kind, bytes);
    if (ex.ocrRequired) {
      return await setJob(ctx, job, { status: 'needs_review', error: 'No readable text: OCR is required.' },
        'This looks like a scanned or image-only document. No OCR provider is configured. Download the original, or paste the text manually to continue.');
    }
    return await continueIngest(ctx, job, mandate, ex.pages, { isLegacyDoc: ex.isLegacyDoc, warnings: ex.warnings });
  } catch (e) {
    const latest = (await ctx.repo.get('processing_jobs', job.id)) ?? job;
    return setJob(ctx, latest, { status: 'failed', error: e instanceof Error ? e.message : String(e) }, 'Processing failed. The original file is kept; use Retry.');
  }
}

export async function retryJob(ctx: Ctx, jobId: string): Promise<ProcessingJob> {
  const job = await getJob(ctx, jobId);
  if (job.status === 'completed') return job;
  if (!job.storagePath) return job;
  return runJob(ctx, jobId);
}

/** Needs-review OCR case: a person supplies the text, the pipeline continues. Audited. */
export async function resolveWithText(ctx: Ctx, jobId: string, text: string): Promise<ProcessingJob> {
  let job = await getJob(ctx, jobId);
  const mandate = await getMandate(ctx, job.mandateId);
  require(ctx, 'cv.upload', mandate.entityId);
  if (text.trim().length < 80) throw new Error('Paste the full CV text (at least a few lines).');
  await audit(ctx, { action: 'job.manual_text', targetType: 'processing_job', targetId: job.id, entityId: job.entityId, summary: `Text supplied manually for ${job.fileName}` });
  job = await setJob(ctx, job, { status: 'extracting', error: undefined }, `Text supplied manually by ${ctx.user.name}.`);
  try {
    return await continueIngest(ctx, job, mandate, [{ page: 1, text }], { isLegacyDoc: false, warnings: [] });
  } catch (e) {
    return setJob(ctx, job, { status: 'failed', error: e instanceof Error ? e.message : String(e) });
  }
}

/** Ingest already-extracted text (demo data, pasted text). Creates a job with no stored file. */
export async function ingestText(ctx: Ctx, mandateId: string, fileName: string, text: string): Promise<ProcessingJob> {
  const mandate = await getMandate(ctx, mandateId);
  require(ctx, 'cv.upload', mandate.entityId);
  const at = ctx.now().toISOString();
  const kind = kindFromName(fileName);
  let job: ProcessingJob = {
    id: newId(), entityId: mandate.entityId, mandateId, fileName, mimeType: kind ? MIME[kind] : undefined, size: text.length,
    sha256: await sha256(new TextEncoder().encode(text)), status: 'extracting', notes: ['Text ingested directly (no original file stored).'],
    attempts: 1, createdBy: ctx.user.id, createdAt: at, updatedAt: at,
  };
  await ctx.repo.put('processing_jobs', job);
  if (text.trim().length < 80) {
    return setJob(ctx, job, { status: 'needs_review', error: 'No readable text: OCR is required.' }, 'No text content. OCR is required.');
  }
  try {
    job = await continueIngest(ctx, job, mandate, [{ page: 1, text }], { isLegacyDoc: false, warnings: [] });
    return job;
  } catch (e) {
    return setJob(ctx, job, { status: 'failed', error: e instanceof Error ? e.message : String(e) });
  }
}

// ───────────────────────── internals ─────────────────────────
async function reuseIfSameFile(ctx: Ctx, job: ProcessingJob, mandate: Mandate): Promise<ProcessingJob | undefined> {
  if (!job.sha256) return undefined;
  const dups = (await ctx.repo.list('candidate_documents', { entityId: job.entityId })).filter((d) => d.sha256 === job.sha256);
  if (!dups.length) return undefined;
  const all = await ctx.repo.list('candidates');
  const candidate = all.find((c) => c.id === dups[0].candidateId);
  if (!candidate) return undefined;
  const survivor = all.find((c) => c.id === groupIds(all, candidate.id)[0]) ?? candidate;
  const doc = dups.sort((a, b) => b.version - a.version)[0];
  const rubric = await activeRubric(ctx, mandate);
  const ids = new Set(groupIds(all, candidate.id));
  const existing = (await ctx.repo.list('assessments', { mandateId: mandate.id }))
    .filter((a) => ids.has(a.candidateId) && a.documentId === doc.id && a.rubricId === rubric?.id)
    .sort((a, b) => b.version - a.version)[0];
  if (existing) {
    return setJob(ctx, job, { status: 'completed', candidateId: candidate.id, documentId: doc.id, assessmentId: existing.id },
      `Duplicate file: this exact CV was already screened for this mandate (${survivor.code}). No new assessment was created.`);
  }
  const linked = await setJob(ctx, job, { candidateId: candidate.id, documentId: doc.id, status: 'extracted' },
    `Duplicate file: reusing the extracted profile of ${survivor.code}.`);
  return finish(ctx, linked, mandate, candidate, doc);
}

function factsFrom(profile: ExtractedProfile, now: Date): Pick<Candidate, 'employment' | 'education' | 'certifications' | 'skills' | 'industries' | 'achievements' | 'totalExperienceYears' | 'currentDesignation' | 'currentCompany'> {
  return {
    employment: profile.employment,
    education: profile.education,
    certifications: profile.certifications,
    skills: profile.skills,
    industries: profile.industries,
    achievements: profile.achievements,
    totalExperienceYears: profile.employment.length ? analyseChronology(profile.employment, now).totalYears : undefined,
    currentDesignation: profile.currentDesignation,
    currentCompany: profile.currentCompany,
  };
}

async function continueIngest(
  ctx: Ctx, job0: ProcessingJob, mandate: Mandate, pages: PageText[], meta: { isLegacyDoc: boolean; warnings: string[] },
): Promise<ProcessingJob> {
  let job = job0;
  const raw = await ctx.ai.extractProfile({ fileName: job.fileName, pages });
  const profile = extractedProfileSchema.parse(raw);
  const textLength = pages.reduce((a, p) => a + p.text.length, 0);
  const conf = extractionConfidence(profile, { textLength, ocrRequired: false, isLegacyDoc: meta.isLegacyDoc });
  const at = ctx.now().toISOString();
  const now = ctx.now();

  const all = await ctx.repo.list('candidates');
  const matches = findDuplicates(
    { name: profile.name, email: profile.email, phone: profile.phone, currentCompany: profile.currentCompany, employers: profile.employment.map((e) => e.company) },
    all,
  );
  const strong = matches.find((m) => m.level === 'strong' && !m.nameConflict);
  const flagged = matches.filter((m) => !(strong && m.candidateId === strong.candidateId));

  let candidate: Candidate;
  let version = 1;
  if (strong) {
    const existing = all.find((c) => c.id === strong.candidateId)!;
    const docs = (await ctx.repo.list('candidate_documents')).filter((d) => groupIds(all, existing.id).includes(d.candidateId));
    version = Math.max(0, ...docs.map((d) => d.version)) + 1;
    candidate = {
      ...existing, ...factsFrom(profile, now),
      email: profile.email ?? existing.email, phone: profile.phone ?? existing.phone, location: profile.location ?? existing.location,
      extractionConfidence: conf, updatedAt: at,
    };
    job = await setJob(ctx, job, {}, `Linked to existing candidate ${existing.code} (${strong.signals.join(', ')}); stored as CV version ${version}.`);
  } else {
    const flags: string[] = [];
    if (!profile.name.trim()) flags.push('name_not_found');
    if (matches.some((m) => m.level === 'strong' && m.nameConflict)) flags.push('shared_identifier_name_conflict');
    if (flagged.length) flags.push('possible_duplicate');
    candidate = {
      id: newId(), code: await nextCode(ctx, 'candidates', 'CND', 5), entityId: mandate.entityId,
      name: profile.name.trim() || 'Unnamed candidate', email: normaliseEmail(profile.email) ? profile.email : undefined, phone: profile.phone,
      location: profile.location, ...factsFrom(profile, now), extractionConfidence: conf, verificationStatus: 'unverified',
      duplicateOf: flagged.map((m) => m.candidateId), identityFlags: flags, createdAt: at, updatedAt: at,
    };
    if (flagged.length) job = await setJob(ctx, job, {}, `Possible duplicate of ${flagged.map((m) => all.find((c) => c.id === m.candidateId)?.code).join(', ')}: ${flagged[0].signals.join(', ')}. A person must review before profiles are merged.`);
  }

  const doc: CandidateDocument = {
    id: newId(), candidateId: candidate.id, entityId: candidate.entityId, version, fileName: job.fileName,
    mimeType: job.mimeType ?? 'text/plain', size: job.size ?? textLength, sha256: job.sha256 ?? '', storagePath: job.storagePath,
    pageCount: pages.length, pages, ocrRequired: false, securityFlags: [], uploadedBy: ctx.user.id, uploadedAt: at,
  };
  candidate = { ...candidate, latestDocumentId: doc.id };
  await ctx.repo.put('candidates', candidate);
  await ctx.repo.put('candidate_documents', doc);
  await audit(ctx, {
    action: strong ? 'candidate.cv_version' : 'candidate.create', targetType: 'candidate', targetId: candidate.id, entityId: candidate.entityId,
    summary: strong ? `${candidate.code}: CV version ${version} added from ${job.fileName}; profile refreshed (earlier assessments unchanged)` : `Created ${candidate.code} (${candidate.name}) from ${job.fileName}; extraction confidence ${Math.round(conf * 100)}%`,
  });
  job = await setJob(ctx, job, { status: 'extracted', candidateId: candidate.id, documentId: doc.id },
    `Extracted: ${profile.employment.length} role(s), ${profile.education.length} qualification(s); confidence ${Math.round(conf * 100)}%.${meta.warnings.length ? ' ' + meta.warnings[0] : ''}`);
  return finish(ctx, job, mandate, candidate, doc);
}

async function finish(ctx: Ctx, job: ProcessingJob, mandate: Mandate, candidate: Candidate, doc: CandidateDocument): Promise<ProcessingJob> {
  const blocker = await screeningBlocker(ctx, mandate);
  if (blocker) return setJob(ctx, job, {}, `Waiting for screening: ${blocker}`);
  const rubric = (await activeRubric(ctx, mandate))!;
  job = await setJob(ctx, job, { status: 'screening' });
  const a = await screenCandidate(ctx, { mandate, rubric, candidate, doc });
  return setJob(ctx, job, { status: 'completed', assessmentId: a.id }, `Screened: score ${a.score.total}, ${a.status.replace(/_/g, ' ')}.`);
}

/** Screen every extracted-but-unscreened CV of a mandate (e.g. after its rubric is approved). */
export async function screenPending(ctx: Ctx, mandateId: string): Promise<ProcessingJob[]> {
  const mandate = await getMandate(ctx, mandateId);
  require(ctx, 'assessment.run', mandate.entityId);
  if (await screeningBlocker(ctx, mandate)) return [];
  const jobs = (await ctx.repo.list('processing_jobs', { mandateId, status: 'extracted' }));
  const out: ProcessingJob[] = [];
  for (const j of jobs) {
    try {
      const c = j.candidateId ? await ctx.repo.get('candidates', j.candidateId) : undefined;
      const d = j.documentId ? await ctx.repo.get('candidate_documents', j.documentId) : undefined;
      if (!c || !d) continue;
      out.push(await finish(ctx, j, mandate, c, d));
    } catch (e) {
      out.push(await setJob(ctx, j, { status: 'failed', error: e instanceof Error ? e.message : String(e) }));
    }
  }
  return out;
}

/** Screen an existing candidate against any mandate (re-screen after a rubric revision, or a different vacancy). New assessment version; nothing overwritten. */
export async function screenExisting(ctx: Ctx, candidateId: string, mandateId: string) {
  const mandate = await getMandate(ctx, mandateId);
  const candidate = await ctx.repo.get('candidates', candidateId);
  if (!candidate) throw new NotFoundError('Candidate', candidateId);
  const blocker = await screeningBlocker(ctx, mandate);
  if (blocker) throw new Error(blocker);
  const doc = candidate.latestDocumentId ? await ctx.repo.get('candidate_documents', candidate.latestDocumentId) : undefined;
  if (!doc) throw new Error('This candidate has no stored CV to assess.');
  const rubric = (await activeRubric(ctx, mandate))!;
  return screenCandidate(ctx, { mandate, rubric, candidate, doc });
}

// ───────────────────────── Queue ─────────────────────────
export const IN_FLIGHT: ReadonlySet<ProcessingStatus> = new Set(['uploaded', 'queued', 'extracting', 'screening']);

/** Run jobs with bounded concurrency so a bulk upload neither blocks the UI nor floods the AI provider. */
export async function runQueue(ctx: Ctx, jobIds: string[], opts: { concurrency?: number; onDone?: (j: ProcessingJob) => void } = {}): Promise<ProcessingJob[]> {
  const limit = Math.max(1, opts.concurrency ?? 3);
  const results: ProcessingJob[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < jobIds.length) {
      const id = jobIds[next++];
      const j = await runJob(ctx, id);
      results.push(j);
      opts.onDone?.(j);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobIds.length) }, worker));
  return results;
}

/** After a crash/refresh: jobs left mid-flight are put back in the queue (their original file is stored). Returns ids to run. */
export async function recoverStuckJobs(ctx: Ctx): Promise<string[]> {
  const stuck = (await ctx.repo.list('processing_jobs')).filter((j) => (j.status === 'extracting' || j.status === 'screening' || j.status === 'queued') && j.storagePath);
  const ids: string[] = [];
  for (const j of stuck) {
    await setJob(ctx, j, { status: 'queued' }, 'Recovered after an interruption; re-queued.');
    ids.push(j.id);
  }
  return ids;
}
