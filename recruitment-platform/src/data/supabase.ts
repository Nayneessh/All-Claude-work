import type { SupabaseClient } from '@supabase/supabase-js';
import { ImmutableRecordError, APPEND_ONLY } from '@/domain/guards';
import type { UserProfile } from '@/domain/types';
import { matches, type Filter, type Repo, type TableMap, type TableName } from './repo';

/**
 * Supabase adapter: Postgres tables (RLS, append-only triggers) + a private Storage bucket for original CVs.
 * Typed key columns mirror the record fields below; the full record is stored in `data`. Schema: supabase/migrations.
 */

/** record field → column, for the columns that drive access control, foreign keys and filtering. */
export const COLUMNS: Record<Exclude<TableName, 'profiles'>, Record<string, string>> = {
  entities: { name: 'name', code: 'code' },
  departments: { entityId: 'entity_id', name: 'name' },
  mandates: { entityId: 'entity_id', status: 'status' },
  mandate_versions: { mandateId: 'mandate_id', entityId: 'entity_id' },
  rubrics: { mandateId: 'mandate_id', entityId: 'entity_id', status: 'status' },
  candidates: { entityId: 'entity_id' },
  candidate_documents: { candidateId: 'candidate_id', entityId: 'entity_id', sha256: 'sha256' },
  assessments: { mandateId: 'mandate_id', candidateId: 'candidate_id', entityId: 'entity_id' },
  decisions: { assessmentId: 'assessment_id', mandateId: 'mandate_id', candidateId: 'candidate_id', entityId: 'entity_id' },
  processing_jobs: { mandateId: 'mandate_id', entityId: 'entity_id', status: 'status' },
  audit_logs: { at: 'at', userId: 'user_id', entityId: 'entity_id', targetId: 'target_id' },
};

const BUCKET = 'cvs';
const PAGE = 1000;

export function toRow(table: TableName, rec: object): Record<string, unknown> {
  const r = rec as Record<string, unknown>;
  if (table === 'profiles') {
    const p = rec as UserProfile;
    return { id: p.id, email: p.email, name: p.name, role: p.role, active: p.active, entity_ids: p.entityIds };
  }
  const row: Record<string, unknown> = { id: r.id, data: rec };
  for (const [field, col] of Object.entries(COLUMNS[table])) row[col] = r[field] ?? null;
  // Columns declared NOT NULL with a default must not receive an explicit null.
  if (table === 'candidate_documents' && row.sha256 === null) row.sha256 = '';
  return row;
}

export function fromRow<K extends TableName>(table: K, row: Record<string, unknown>): TableMap[K] {
  if (table === 'profiles') {
    return { id: row.id, email: row.email ?? '', name: row.name ?? '', role: row.role, active: row.active, entityIds: row.entity_ids ?? [] } as unknown as TableMap[K];
  }
  if (table === 'entities' || table === 'departments') {
    const d = (row.data ?? {}) as Record<string, unknown>;
    return { createdAt: row.created_at, ...d, id: row.id, name: row.name, code: row.code, entityId: row.entity_id } as unknown as TableMap[K];
  }
  return row.data as TableMap[K];
}

function column(table: TableName, field: string): string | undefined {
  if (field === 'id') return 'id';
  if (table === 'profiles') return { role: 'role', active: 'active', email: 'email' }[field];
  return COLUMNS[table][field];
}

export function createSupabaseRepo(client: SupabaseClient): Repo {
  const listeners = new Set<(t: TableName) => void>();
  const emit = (t: TableName): void => listeners.forEach((l) => l(t));

  const translate = (table: TableName, message: string, code?: string): Error => {
    if (/append-only|frozen|never hard-deleted|cannot be deleted/i.test(message) || (code === '23505' && APPEND_ONLY.has(table))) return new ImmutableRecordError(table, 'record');
    if (code === '42501' || /row-level security/i.test(message)) return new Error('You do not have permission to do that (blocked by the database access rules).');
    return new Error(message);
  };

  return {
    mode: 'cloud',

    async list<K extends TableName>(table: K, filter?: Filter): Promise<TableMap[K][]> {
      const out: TableMap[K][] = [];
      const clientSide: Filter = {};
      for (let from = 0; ; from += PAGE) {
        let q = client.from(table).select('*').order('id').range(from, from + PAGE - 1);
        for (const [field, value] of Object.entries(filter ?? {})) {
          if (value === undefined) continue;
          const col = column(table, field);
          if (col) q = q.eq(col, value); else clientSide[field] = value;
        }
        const { data, error } = await q;
        if (error) throw translate(table, error.message, error.code);
        for (const row of data ?? []) out.push(fromRow(table, row as Record<string, unknown>));
        if (!data || data.length < PAGE) break;
      }
      return Object.keys(clientSide).length ? out.filter((r) => matches(r, clientSide)) : out;
    },

    async get<K extends TableName>(table: K, id: string): Promise<TableMap[K] | undefined> {
      const { data, error } = await client.from(table).select('*').eq('id', id).maybeSingle();
      if (error) throw translate(table, error.message, error.code);
      return data ? fromRow(table, data as Record<string, unknown>) : undefined;
    },

    async put<K extends TableName>(table: K, row: TableMap[K]): Promise<void> {
      const payload = toRow(table, row);
      // Append-only tables have no UPDATE privilege: plain insert (a duplicate id is reported as immutable).
      const res = APPEND_ONLY.has(table) ? await client.from(table).insert(payload) : await client.from(table).upsert(payload, { onConflict: 'id' });
      if (res.error) throw translate(table, res.error.message, res.error.code);
      emit(table);
    },

    async putFile(path, blob) {
      const { error } = await client.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false });
      if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(error.message);
    },

    async getFile(path) {
      const { data, error } = await client.storage.from(BUCKET).download(path);
      return error ? undefined : data;
    },

    async fileUrl(path) {
      const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 300);
      return error ? undefined : data.signedUrl;
    },

    onChange(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  };
}
