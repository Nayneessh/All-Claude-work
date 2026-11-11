import type {
  Assessment, AuditEntry, Candidate, CandidateDocument, Decision, Department, Entity, Mandate, MandateVersion, ProcessingJob,
  Rubric, UserProfile,
} from '@/domain/types';

/** Persistence port. Two adapters: local (IndexedDB, works offline, no account) and cloud (Supabase Postgres + RLS + Storage). */

export interface TableMap {
  entities: Entity;
  departments: Department;
  profiles: UserProfile;
  mandates: Mandate;
  mandate_versions: MandateVersion;
  rubrics: Rubric;
  candidates: Candidate;
  candidate_documents: CandidateDocument;
  assessments: Assessment;
  decisions: Decision;
  processing_jobs: ProcessingJob;
  audit_logs: AuditEntry;
}
export type TableName = keyof TableMap;
export const TABLES: TableName[] = [
  'entities', 'departments', 'profiles', 'mandates', 'mandate_versions', 'rubrics', 'candidates', 'candidate_documents',
  'assessments', 'decisions', 'processing_jobs', 'audit_logs',
];

/** Equality filter on top-level record fields (entityId, mandateId, candidateId, status, ...). */
export type Filter = Record<string, string | undefined>;

export interface Repo {
  readonly mode: 'local' | 'cloud';
  list<K extends TableName>(table: K, filter?: Filter): Promise<TableMap[K][]>;
  get<K extends TableName>(table: K, id: string): Promise<TableMap[K] | undefined>;
  /** Insert or update. Append-only tables reject updates (ImmutableRecordError). */
  put<K extends TableName>(table: K, row: TableMap[K]): Promise<void>;
  putFile(path: string, blob: Blob): Promise<void>;
  getFile(path: string): Promise<Blob | undefined>;
  /** Time-limited URL for downloading an original CV (cloud: signed URL; local: object URL). */
  fileUrl(path: string): Promise<string | undefined>;
  onChange(cb: (table: TableName) => void): () => void;
}

export const newId = (): string => crypto.randomUUID();
export const nowIso = (): string => new Date().toISOString();

export function matches(row: object, filter?: Filter): boolean {
  if (!filter) return true;
  const r = row as Record<string, unknown>;
  return Object.entries(filter).every(([k, v]) => v === undefined || r[k] === v);
}
