import { supabase, friendlyError } from './supabase';

/**
 * File storage is behind this tiny interface so it can be re-implemented (S3, MinIO, local disk behind an API…)
 * without touching any screen. See docs/MIGRATION_GUIDE.md.
 */
export interface FileStore {
  upload(path: string, file: File): Promise<void>;
  /** Short-lived link for viewing or downloading. */
  url(path: string, opts?: { download?: string | boolean; ttlSeconds?: number }): Promise<string>;
}
export const ALLOWED_DOC_TYPES: Record<string, string> = {
  'application/pdf': 'PDF', 'application/msword': 'Word (.doc)', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word (.docx)',
};
export const MAX_DOC_BYTES = 10 * 1024 * 1024;
export function validateDocument(file: File): string | null {
  const ext = file.name.toLowerCase().split('.').pop();
  const type = file.type || ({ pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } as Record<string, string>)[ext ?? ''];
  if (!type || !ALLOWED_DOC_TYPES[type]) return 'Only PDF and Word documents (.pdf, .doc, .docx) are allowed.';
  if (file.size > MAX_DOC_BYTES) return 'The file is larger than 10 MB.';
  if (file.size === 0) return 'The file is empty.';
  return null;
}
export const docMime = (file: File): string => file.type || ({ pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } as Record<string, string>)[file.name.toLowerCase().split('.').pop() ?? ''] || 'application/octet-stream';
export const safeName = (n: string): string => n.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').slice(-120) || 'file';

export const supabaseStore = (bucket: string): FileStore => ({
  async upload(path, file) {
    const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: docMime(file), upsert: false });
    if (error) throw new Error(friendlyError(error));
  },
  async url(path, opts) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, opts?.ttlSeconds ?? 300, opts?.download ? { download: opts.download } : undefined);
    if (error || !data) throw new Error(friendlyError(error ?? 'No link'));
    return data.signedUrl;
  },
});
export const jdStore = supabaseStore('jds');
export const cvStore = supabaseStore('cvs');
