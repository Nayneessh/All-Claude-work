/**
 * Core domain model. Mirrors Section 10 of the project plan.
 * Principles enforced by the types and by the services built on them:
 *  - candidate facts (Candidate, CandidateDocument) are stored separately from assessments;
 *  - Assessment records are immutable; human decisions are appended as Decision rows;
 *  - an approved Rubric is immutable; changes create a new version.
 */

export type Id = string;
export type IsoDate = string; // full ISO timestamp
export type YearMonth = string; // 'YYYY-MM'

// ───────────────────────── Organisation & access ─────────────────────────
export type Role = 'super_admin' | 'admin' | 'recruiter' | 'viewer';

export interface Entity { id: Id; name: string; code: string; createdAt: IsoDate }
export interface Department { id: Id; entityId: Id; name: string }
export interface UserProfile {
  id: Id;
  email: string;
  name: string;
  role: Role;
  /** Entities a recruiter/viewer may see. super_admin and admin see every entity (central administration). */
  entityIds: Id[];
  active: boolean;
}

// ───────────────────────── Mandates ─────────────────────────
export type MandateStatus = 'open' | 'on_hold' | 'closed' | 'archived';
export type Priority = 'low' | 'medium' | 'high' | 'critical';

export interface Mandate {
  id: Id;
  code: string; // MND-0001
  version: number;
  entityId: Id;
  departmentId?: Id;
  title: string;
  function: string;
  reportingManager: string;
  location: string;
  minExperience: number;
  preferredExperience?: number;
  maxExperience?: number;
  education: string; // e.g. "MBA or equivalent"
  certifications: string[];
  competencies: string[];
  mandatoryIndustries: string[];
  preferredIndustries: string[];
  teamSize?: string;
  budget?: string;
  strategicResponsibilities?: string;
  compMin?: number;
  compMax?: number;
  currency: string;
  priority: Priority;
  hiringManager: string;
  targetDate?: string; // YYYY-MM-DD
  jdText: string;
  jdFileName?: string;
  status: MandateStatus;
  activeRubricId?: Id;
  createdBy: Id;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface MandateVersion {
  id: Id;
  mandateId: Id;
  entityId: Id;
  version: number;
  snapshot: Mandate;
  materialChange: boolean;
  changes: string[];
  changedBy: Id;
  changedAt: IsoDate;
}

// ───────────────────────── Rubric ─────────────────────────
export type CriterionCategory =
  | 'functional_experience'
  | 'industry_experience'
  | 'core_competencies'
  | 'leadership'
  | 'achievements'
  | 'education'
  | 'other';

export type CriterionClass = 'mandatory' | 'preferred' | 'desirable';

export interface RubricCriterion {
  id: Id;
  category: CriterionCategory;
  name: string;
  description: string;
  classification: CriterionClass;
  /** Points out of 100 across all criteria; configurable per mandate. */
  weight: number;
  /** Terms the evidence mapper looks for (contextual evidence is still required — keywords alone never score). */
  keywords: string[];
  expectedEvidence: string;
  guidance: string;
  verification: string;
}

export type GateType = 'min_experience' | 'qualification' | 'certification' | 'location' | 'industry' | 'other';

export interface GateDef {
  id: Id;
  type: GateType;
  name: string;
  requirement: string;
  keywords: string[];
  years?: number;
  verification: string;
}

export interface RoleIntelligence {
  purpose: string;
  responsibilities: string[];
  mandatory: string[];
  preferred: string[];
  competencies: string[];
  industry: string[];
  leadership: string[];
  scale: string[];
  achievements: string[];
  progression: string[];
  practical: string[];
}

export type MissingEvidencePolicy = 'rescale' | 'zero';

export interface ScreeningPolicy {
  /** Initial screening threshold (business policy, subject to validation). */
  threshold: number;
  /** Lower edge of the borderline review band. */
  borderlineFloor: number;
  strongAt: number;
  exceptionalAt: number;
  /** Below this extraction confidence the candidate goes to manual review. */
  minExtractionConfidence: number;
  /** Share of total weight that must have assessable evidence; below this → manual review. */
  minEvidenceCoverage: number;
  /** Mean per-criterion model confidence below this → manual review. */
  minAssessmentConfidence: number;
  missingEvidencePolicy: MissingEvidencePolicy;
}

export interface ProviderInfo { id: string; model: string; promptVersion: string }

export type RubricStatus = 'draft' | 'approved' | 'superseded';

export interface Rubric {
  id: Id;
  mandateId: Id;
  entityId: Id;
  mandateVersion: number;
  version: number;
  status: RubricStatus;
  criteria: RubricCriterion[];
  gates: GateDef[];
  policy: ScreeningPolicy;
  roleIntelligence: RoleIntelligence;
  generatedBy: ProviderInfo | 'manual';
  approvedBy?: Id;
  approvedAt?: IsoDate;
  createdBy: Id;
  createdAt: IsoDate;
  notes?: string;
}

// ───────────────────────── Candidates ─────────────────────────
export interface EvidenceRef {
  /** PDF page (1-based) when known. */
  page?: number;
  /** Paragraph/line index when the format has no pages (DOCX). */
  paragraph?: number;
  quote: string;
}

export interface Employment {
  company: string;
  title: string;
  start?: YearMonth;
  end?: YearMonth | 'present';
  description: string;
  ref?: EvidenceRef;
}

export interface EducationEntry { qualification: string; institution?: string; year?: number; ref?: EvidenceRef }
export interface Achievement { text: string; metric?: string; ref?: EvidenceRef }

export type VerificationStatus = 'unverified' | 'partially_verified' | 'verified';

export interface Candidate {
  id: Id;
  code: string; // CND-00001
  entityId: Id; // owning entity (central profile, entity-level visibility)
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  currentDesignation?: string;
  currentCompany?: string;
  totalExperienceYears?: number;
  employment: Employment[];
  education: EducationEntry[];
  certifications: string[];
  skills: string[];
  industries: string[];
  achievements: Achievement[];
  extractionConfidence: number;
  verificationStatus: VerificationStatus;
  latestDocumentId?: Id;
  /** Set when this record was merged into another (soft delete; never hard-deleted). */
  mergedInto?: Id;
  /** Possible duplicates awaiting a human decision. */
  duplicateOf?: Id[];
  /** Candidates a person has confirmed are NOT the same individual (never re-flagged). */
  notDuplicateOf?: Id[];
  identityFlags: string[];
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface PageText { page: number; text: string }

export interface CandidateDocument {
  id: Id;
  candidateId: Id;
  entityId: Id;
  version: number;
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  /** Object-storage path; undefined for seeded demo text. */
  storagePath?: string;
  pageCount: number;
  pages: PageText[];
  ocrRequired: boolean;
  securityFlags: string[];
  uploadedBy: Id;
  uploadedAt: IsoDate;
}

// ───────────────────────── Processing ─────────────────────────
export type ProcessingStatus =
  | 'uploaded' | 'queued' | 'extracting' | 'extracted' | 'screening' | 'completed' | 'needs_review' | 'failed';

export interface ProcessingJob {
  id: Id;
  entityId: Id;
  mandateId: Id;
  candidateId?: Id;
  documentId?: Id;
  assessmentId?: Id;
  fileName: string;
  mimeType?: string;
  size?: number;
  sha256?: string;
  /** Object-storage path of the original file; kept for every job so no CV is ever silently discarded. */
  storagePath?: string;
  status: ProcessingStatus;
  error?: string;
  notes: string[];
  attempts: number;
  createdBy: Id;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

// ───────────────────────── Assessment ─────────────────────────
export type Rating = 0 | 1 | 2 | 3 | 4 | 5;
export type CriterionState = 'met' | 'partially_met' | 'not_met' | 'not_evident' | 'unable_to_assess';

export interface CriterionAssessment {
  criterionId: Id;
  /** null = Not Evident / Unable to Assess (never silently zero). */
  rating: Rating | null;
  state: CriterionState;
  /** Layer 1: what the CV actually says. */
  evidence: EvidenceRef[];
  /** Layer 2: what that evidence indicates for suitability. */
  interpretation: string;
  /** Layer 3: what is unclear or needs confirmation. */
  verification: string;
  confidence: number; // 0..1
}

export type GateStatus = 'pass' | 'fail' | 'needs_verification' | 'not_applicable';
export interface GateResult { gateId: Id; status: GateStatus; evidence: EvidenceRef[]; note: string }

export type ScreeningStatus =
  | 'exceptional_match'
  | 'strong_match'
  | 'potential_match'
  | 'borderline_review'
  | 'below_threshold'
  | 'mandatory_non_compliance'
  | 'verification_required'
  | 'manual_review';

export interface ScoreLine { criterionId: Id; weight: number; rating: Rating | null; points: number }
export interface ScoreResult {
  total: number; // 0..100, one decimal
  floor: number; // every Not Evident criterion scored 0
  ceiling: number; // every Not Evident criterion scored 5
  coverage: number; // share of weight with an assessed rating
  lines: ScoreLine[];
  policy: MissingEvidencePolicy;
}

export interface Flag { code: string; severity: 'info' | 'warning' | 'blocking'; message: string }

export interface Assessment {
  id: Id;
  entityId: Id;
  mandateId: Id;
  candidateId: Id;
  documentId: Id;
  rubricId: Id;
  rubricVersion: number;
  mandateVersion: number;
  /** 1 for the first screening of this candidate against this mandate; re-screens increment and never overwrite. */
  version: number;
  supersedesId?: Id;
  provider: ProviderInfo;
  criteria: CriterionAssessment[];
  gates: GateResult[];
  score: ScoreResult;
  status: ScreeningStatus;
  statusReasons: string[];
  flags: Flag[];
  summary: string;
  strengths: string[];
  gaps: string[];
  missingInformation: string[];
  verificationQuestions: string[];
  recommendedAction: string;
  chronologyFlags: string[];
  extractionConfidence: number;
  redactions: string[];
  createdBy: Id;
  createdAt: IsoDate;
}

export interface Decision {
  id: Id;
  entityId: Id;
  assessmentId: Id;
  candidateId: Id;
  mandateId: Id;
  originalStatus: ScreeningStatus;
  newStatus: ScreeningStatus;
  reason: string;
  comments?: string;
  rubricVersion: number;
  assessmentVersion: number;
  decidedBy: Id;
  decidedAt: IsoDate;
}

export interface AuditEntry {
  id: Id;
  at: IsoDate;
  userId: Id;
  userName: string;
  entityId?: Id;
  action: string;
  targetType: string;
  targetId: Id;
  summary: string;
  before?: unknown;
  after?: unknown;
}

export const STATUS_LABEL: Record<ScreeningStatus, string> = {
  exceptional_match: 'Exceptional Match',
  strong_match: 'Strong Match',
  potential_match: 'Potential Match',
  borderline_review: 'Borderline Review',
  below_threshold: 'Below Threshold',
  mandatory_non_compliance: 'Mandatory Non-Compliance',
  verification_required: 'Verification Required',
  manual_review: 'Manual Review',
};

/** Statuses that count as "qualified" on the dashboard (75+ and every mandatory gate passed). */
export const QUALIFIED: ReadonlySet<ScreeningStatus> = new Set(['exceptional_match', 'strong_match', 'potential_match']);

/** Statuses that need a person before the candidate can be progressed or set aside. */
export const NEEDS_HUMAN: ReadonlySet<ScreeningStatus> = new Set([
  'borderline_review', 'verification_required', 'manual_review',
]);

export const CATEGORY_LABEL: Record<CriterionCategory, string> = {
  functional_experience: 'Relevant functional experience',
  industry_experience: 'Industry / domain experience',
  core_competencies: 'Core competency match',
  leadership: 'Leadership & strategic capability',
  achievements: 'Achievements & measurable impact',
  education: 'Education & qualifications',
  other: 'Other mandate-specific requirements',
};

export const DEFAULT_WEIGHTS: Record<CriterionCategory, number> = {
  functional_experience: 25,
  industry_experience: 15,
  core_competencies: 20,
  leadership: 15,
  achievements: 15,
  education: 5,
  other: 5,
};
