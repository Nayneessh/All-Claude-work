import Dexie, { type Table } from 'dexie';
import { guardWrite } from '@/domain/guards';
import { TABLES, matches, type Filter, type Repo, type TableMap, type TableName } from './repo';

interface Blobby { path: string; blob: Blob }

class LocalDb extends Dexie {
  blobs!: Table<Blobby, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      entities: 'id',
      departments: 'id,entityId',
      profiles: 'id',
      mandates: 'id,entityId,status',
      mandate_versions: 'id,mandateId',
      rubrics: 'id,mandateId,status',
      candidates: 'id,entityId',
      candidate_documents: 'id,candidateId,entityId',
      assessments: 'id,mandateId,candidateId,entityId',
      decisions: 'id,assessmentId,candidateId,mandateId',
      processing_jobs: 'id,mandateId,status,entityId',
      audit_logs: 'id,at,targetId,entityId',
      blobs: 'path',
    });
  }
  t(name: TableName): Table<{ id: string }, string> {
    return (this as unknown as Record<string, Table<{ id: string }, string>>)[name];
  }
}

export interface LocalRepo extends Repo {
  /** Remove every record and file (used by "Reset demo data"). */
  wipe(): Promise<void>;
  close(): void;
}

export function createLocalRepo(name = 'recruitment-intelligence'): LocalRepo {
  const db = new LocalDb(name);
  const listeners = new Set<(t: TableName) => void>();
  const emit = (t: TableName): void => listeners.forEach((l) => l(t));
  const urls = new Map<string, string>();

  return {
    mode: 'local',
    async list<K extends TableName>(table: K, filter?: Filter): Promise<TableMap[K][]> {
      const rows = (await db.t(table).toArray()) as unknown as TableMap[K][];
      return filter ? rows.filter((r) => matches(r, filter)) : rows;
    },
    async get<K extends TableName>(table: K, id: string): Promise<TableMap[K] | undefined> {
      return (await db.t(table).get(id)) as unknown as TableMap[K] | undefined;
    },
    async put<K extends TableName>(table: K, row: TableMap[K]): Promise<void> {
      await db.transaction('rw', db.t(table), async () => {
        const existing = await db.t(table).get(row.id);
        guardWrite(table, existing, row);
        await db.t(table).put(row as { id: string });
      });
      emit(table);
    },
    async putFile(path, blob) { await db.blobs.put({ path, blob }); },
    async getFile(path) { return (await db.blobs.get(path))?.blob; },
    async fileUrl(path) {
      const blob = (await db.blobs.get(path))?.blob;
      if (!blob) return undefined;
      const prev = urls.get(path);
      if (prev) URL.revokeObjectURL(prev);
      const u = URL.createObjectURL(blob);
      urls.set(path, u);
      return u;
    },
    onChange(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    async wipe() {
      await db.transaction('rw', [...TABLES.map((t) => db.t(t)), db.blobs], async () => {
        for (const t of TABLES) await db.t(t).clear();
        await db.blobs.clear();
      });
      TABLES.forEach(emit);
    },
    close() { db.close(); },
  };
}
