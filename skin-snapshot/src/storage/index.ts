// Object storage abstraction. Photos live behind this interface so the database-backed store used
// on staging can be swapped for any S3-compatible bucket (including Supabase Storage's S3 endpoint)
// by configuration alone.
import type { Queryable } from '../data/db';
import * as repo from '../data/repo';
import { AwsClient } from 'aws4fetch';

export interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
}

export interface ObjectStore {
  readonly kind: 'postgres' | 's3';
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  /** Direct-to-bucket upload URL. Null means the API receives the upload itself. */
  presignUpload(key: string, contentType: string, ttlSeconds: number): Promise<string | null>;
}

/** Postgres-backed store: private table, no public URL exists. */
export class PostgresStore implements ObjectStore {
  readonly kind = 'postgres' as const;
  constructor(private q: Queryable) {}
  async put(key: string, bytes: Uint8Array, contentType: string) {
    await repo.putObject(this.q, key, contentType, bytes);
  }
  async get(key: string) {
    const r = await repo.getObject(this.q, key);
    return r ? { bytes: new Uint8Array(r.bytes), contentType: r.content_type } : null;
  }
  async delete(key: string) {
    await repo.deleteObject(this.q, key);
  }
  async presignUpload() {
    return null;
  }
}

export interface S3Config {
  endpoint: string; // e.g. https://<ref>.supabase.co/storage/v1/s3 or https://s3.amazonaws.com
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** S3-compatible store (AWS S3, Cloudflare R2, MinIO, Supabase Storage). Path-style addressing. */
export class S3Store implements ObjectStore {
  readonly kind = 's3' as const;
  private aws: AwsClient;
  constructor(private cfg: S3Config) {
    this.aws = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: cfg.region, service: 's3' });
  }
  private url(key: string) {
    return `${this.cfg.endpoint.replace(/\/$/, '')}/${this.cfg.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }
  async put(key: string, bytes: Uint8Array, contentType: string) {
    const r = await this.aws.fetch(this.url(key), { method: 'PUT', body: bytes as BodyInit, headers: { 'content-type': contentType } });
    if (!r.ok) throw new Error(`s3 put failed: ${r.status}`);
  }
  async get(key: string) {
    const r = await this.aws.fetch(this.url(key), { method: 'GET' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`s3 get failed: ${r.status}`);
    return { bytes: new Uint8Array(await r.arrayBuffer()), contentType: r.headers.get('content-type') ?? 'application/octet-stream' };
  }
  async delete(key: string) {
    const r = await this.aws.fetch(this.url(key), { method: 'DELETE' });
    if (!r.ok && r.status !== 404) throw new Error(`s3 delete failed: ${r.status}`);
  }
  async presignUpload(key: string, contentType: string, ttlSeconds: number) {
    const u = new URL(this.url(key));
    u.searchParams.set('X-Amz-Expires', String(ttlSeconds));
    const signed = await this.aws.sign(u.toString(), { method: 'PUT', headers: { 'content-type': contentType }, aws: { signQuery: true, allHeaders: false } });
    return signed.url;
  }
}

export function photoKey(caseId: string, photoId: string): string {
  return `cases/${caseId}/${photoId}.jpg`;
}
