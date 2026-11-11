import { z } from 'zod';
import type {
  Candidate, GateDef, Mandate, PageText, ProviderInfo, Rubric, RubricCriterion, RoleIntelligence, ScreeningPolicy,
} from './types';

/**
 * Provider-independent AI contract (plan §9.4). Any model — hosted or the offline heuristic engine — must satisfy
 * AiProvider. Everything a provider returns is parsed through these schemas and then through the validation layer
 * (validate.ts) before it can influence a score. Switching providers never touches storage, scoring or the UI.
 */

const evidence = z.object({
  page: z.number().int().positive().optional(),
  paragraph: z.number().int().positive().optional(),
  quote: z.string().min(1),
});

const classification = z.enum(['mandatory', 'preferred', 'desirable']);
const category = z.enum([
  'functional_experience', 'industry_experience', 'core_competencies', 'leadership', 'achievements', 'education', 'other',
]);

export const roleIntelligenceSchema = z.object({
  purpose: z.string(),
  responsibilities: z.array(z.string()),
  mandatory: z.array(z.string()),
  preferred: z.array(z.string()),
  competencies: z.array(z.string()),
  industry: z.array(z.string()),
  leadership: z.array(z.string()),
  scale: z.array(z.string()),
  achievements: z.array(z.string()),
  progression: z.array(z.string()),
  practical: z.array(z.string()),
});

export const rubricDraftSchema = z.object({
  roleIntelligence: roleIntelligenceSchema,
  criteria: z.array(z.object({
    category,
    name: z.string().min(1),
    description: z.string(),
    classification,
    weight: z.number().min(0).max(100),
    keywords: z.array(z.string()),
    expectedEvidence: z.string(),
    guidance: z.string(),
    verification: z.string(),
  })).min(1),
  gates: z.array(z.object({
    type: z.enum(['min_experience', 'qualification', 'certification', 'location', 'industry', 'other']),
    name: z.string().min(1),
    requirement: z.string(),
    keywords: z.array(z.string()),
    years: z.number().min(0).optional(),
    verification: z.string(),
  })),
});
export type RubricDraft = z.infer<typeof rubricDraftSchema>;

const employment = z.object({
  company: z.string(),
  title: z.string(),
  start: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  end: z.union([z.string().regex(/^\d{4}-\d{2}$/), z.literal('present')]).optional(),
  description: z.string().default(''),
  ref: evidence.optional(),
});

export const extractedProfileSchema = z.object({
  name: z.string().default(''),
  email: z.string().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  currentDesignation: z.string().optional(),
  currentCompany: z.string().optional(),
  employment: z.array(employment).default([]),
  education: z.array(z.object({
    qualification: z.string(), institution: z.string().optional(), year: z.number().int().optional(), ref: evidence.optional(),
  })).default([]),
  certifications: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  industries: z.array(z.string()).default([]),
  achievements: z.array(z.object({ text: z.string(), metric: z.string().optional(), ref: evidence.optional() })).default([]),
});
export type ExtractedProfile = z.infer<typeof extractedProfileSchema>;

export const assessmentModelOutputSchema = z.object({
  criteria: z.array(z.object({
    criterionId: z.string(),
    rating: z.number().nullable(),
    unable: z.boolean().optional(),
    evidence: z.array(evidence),
    interpretation: z.string(),
    verification: z.string(),
    confidence: z.number().min(0).max(1),
  })),
  gates: z.array(z.object({
    gateId: z.string(),
    status: z.enum(['pass', 'fail', 'needs_verification', 'not_applicable']),
    evidence: z.array(evidence),
    note: z.string(),
  })),
  summary: z.string(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  missingInformation: z.array(z.string()),
  verificationQuestions: z.array(z.string()),
  recommendedAction: z.string(),
});
export type AssessmentModelOutput = z.infer<typeof assessmentModelOutputSchema>;

// ───────────────────────── Provider interface ─────────────────────────
export interface RubricRequest { mandate: Mandate; policy: ScreeningPolicy }
export interface ExtractRequest { fileName: string; pages: PageText[] }
export interface AssessRequest {
  mandate: Pick<Mandate, 'title' | 'location' | 'minExperience'>;
  rubric: Pick<Rubric, 'criteria' | 'gates' | 'roleIntelligence'>;
  /** Blind representation: name/contact/protected attributes already removed. */
  profile: ExtractedProfile;
  pages: PageText[];
}

/** A provider may attach the model that actually served a call (e.g. after a server-side fallback); it is recorded on the assessment. */
export type Served<T> = T & { served?: ProviderInfo };

export interface AiProvider {
  readonly info: ProviderInfo;
  generateRubric(req: RubricRequest): Promise<Served<RubricDraft>>;
  extractProfile(req: ExtractRequest): Promise<Served<ExtractedProfile>>;
  assessCandidate(req: AssessRequest): Promise<Served<AssessmentModelOutput>>;
}

export type RubricCriterionInput = Omit<RubricCriterion, 'id'>;
export type GateInput = Omit<GateDef, 'id'>;
export type CandidateFacts = Pick<Candidate, 'employment' | 'education' | 'certifications' | 'skills' | 'industries' | 'achievements'>;
export type { RoleIntelligence };
