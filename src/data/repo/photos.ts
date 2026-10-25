import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProgressPhoto } from '@/domain/types';
import { db, tbl } from '../db';
import { insert, update } from '../write';
import { nowIso, runtime } from '../runtime';

/**
 * Optional progress photos. The image blob lives on the device (and in a PRIVATE storage bucket once uploaded, folder = your user id);
 * only metadata rows go through normal sync. Photos are resized to ≤1280 px JPEG before storing.
 */
export async function shrinkImage(file: Blob, maxPx = 1280, quality = 0.82): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not process the photo'))), 'image/jpeg', quality));
}

export async function addPhoto(blob: Blob, pose: string | null, note: string | null): Promise<ProgressPhoto> {
  return db.transaction('rw', tbl('progress_photos'), db.photo_blobs, async () => {
    const row = await insert('progress_photos', { taken_at: nowIso(), storage_path: null, pose, note });
    await db.photo_blobs.put({ id: row.id, blob, uploaded: 0 });
    const { _dirty: _d, ...rest } = row;
    void _d;
    return rest;
  });
}

export async function listPhotos(): Promise<ProgressPhoto[]> {
  return (await tbl('progress_photos').toArray()).filter((p) => !p.deleted_at).map(({ _dirty: _d, ...r }) => (void _d, r as ProgressPhoto)).sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1));
}

export async function photoUrl(p: ProgressPhoto, client: SupabaseClient | null): Promise<string | null> {
  const local = await db.photo_blobs.get(p.id);
  if (local) return URL.createObjectURL(local.blob);
  if (client && p.storage_path) {
    const { data } = await client.storage.from('progress-photos').createSignedUrl(p.storage_path, 3600);
    return data?.signedUrl ?? null;
  }
  return null;
}

export async function deletePhoto(p: ProgressPhoto, client: SupabaseClient | null): Promise<void> {
  await update('progress_photos', p.id, { deleted_at: nowIso() });
  await db.photo_blobs.delete(p.id);
  if (client && p.storage_path) { try { await client.storage.from('progress-photos').remove([p.storage_path]); } catch { /* the row is already hidden; a later cleanup can retry */ } }
}

/** Uploads photos whose metadata is signed-in-owned and whose blob has not been stored remotely yet. Safe to call repeatedly. */
export async function uploadPendingPhotos(client: SupabaseClient): Promise<number> {
  if (!runtime.userId) return 0;
  let n = 0;
  for (const b of await db.photo_blobs.where('uploaded').equals(0).toArray()) {
    const row = await tbl('progress_photos').get(b.id);
    if (!row || row.deleted_at || !row.user_id) continue;
    const path = `${runtime.userId}/${b.id}.jpg`;
    const { error } = await client.storage.from('progress-photos').upload(path, b.blob, { contentType: 'image/jpeg', upsert: true });
    if (error) continue;
    await update('progress_photos', b.id, { storage_path: path });
    await db.photo_blobs.update(b.id, { uploaded: 1 });
    n++;
  }
  return n;
}
