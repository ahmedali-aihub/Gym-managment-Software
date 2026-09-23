import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../../config/env.js';
import { moduleLogger } from '../../lib/logger.js';

const log = moduleLogger('storage:supabase');

/**
 * Supabase Storage, for member photos.
 *
 * WHY NOT LOCAL DISK. A serverless function has no persistent filesystem —
 * anything written there vanishes when the instance is recycled, often
 * within minutes. Photos would silently disappear and the member profile
 * would show a broken image with no error anywhere.
 *
 * Uses the SERVICE ROLE key, which bypasses row-level security. That is
 * correct here and nowhere else: this code runs only on the server, and the
 * key must never reach the browser. It is deliberately not prefixed VITE_,
 * so Vite cannot bundle it even by accident.
 *
 * The bucket is PUBLIC. Member photos are shown in an <img> on every member
 * row; signed URLs would expire mid-session and need refreshing per image,
 * for a photo that is already visible to any staff member who can open the
 * page. The filenames are random UUIDs, so a URL cannot be guessed.
 */

export const PHOTO_BUCKET = 'member-photos';

let client: SupabaseClient | null | undefined;

/**
 * The storage client, or null when Supabase Storage is not configured.
 *
 * Returning null rather than throwing lets the caller fall back to local
 * disk, which is what development does — one less service to run locally.
 */
export function getStorageClient(): SupabaseClient | null {
  if (client !== undefined) return client;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    log.info('Supabase Storage not configured; photos use local disk');
    client = null;
    return null;
  }

  client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      // No session to persist or refresh: this is a server using a static
      // key, not a user logging in.
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return client;
}

export function isSupabaseStorageEnabled(): boolean {
  return getStorageClient() !== null;
}

/** Upload a photo and return its public URL. */
export async function uploadPhoto(
  buffer: Buffer,
  objectPath: string,
  contentType: string,
): Promise<string> {
  const supabase = getStorageClient();
  if (!supabase) throw new Error('Supabase Storage is not configured');

  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(objectPath, buffer, {
      contentType,
      // Filenames are UUIDs, so a collision means something is badly wrong
      // — better to fail loudly than to overwrite another member's photo.
      upsert: false,
      cacheControl: '31536000',
    });

  if (error) {
    log.error({ err: error, objectPath }, 'Photo upload failed');
    throw new Error(`Could not upload the photo: ${error.message}`);
  }

  const { data } = supabase.storage
    .from(PHOTO_BUCKET)
    .getPublicUrl(objectPath);

  return data.publicUrl;
}

/** Remove a photo. Never throws — a missing object is not a failure. */
export async function removePhoto(publicUrl: string): Promise<void> {
  const supabase = getStorageClient();
  if (!supabase) return;

  const objectPath = objectPathFromUrl(publicUrl);
  if (!objectPath) return;

  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .remove([objectPath]);

  if (error) {
    log.warn({ err: error, objectPath }, 'Photo delete failed');
  }
}

/**
 * Recover the object path from a public URL.
 *
 * Supabase public URLs look like:
 *   https://<ref>.supabase.co/storage/v1/object/public/member-photos/members/abc.jpg
 *
 * Returns null for anything that is not one, so a legacy /uploads/ URL
 * falls through to the local-disk deletion path instead of being mangled.
 */
export function objectPathFromUrl(url: string): string | null {
  const marker = `/object/public/${PHOTO_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return null;

  return url.slice(index + marker.length);
}

/**
 * Create the bucket if it is missing.
 *
 * Called at boot so a fresh Supabase project works without anyone opening
 * the dashboard. Failure is logged, not thrown: the gym should still open
 * if storage is misconfigured, with photos as the only casualty.
 */
export async function ensurePhotoBucket(): Promise<void> {
  const supabase = getStorageClient();
  if (!supabase) return;

  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    if (buckets?.some((b) => b.name === PHOTO_BUCKET)) {
      log.info(`Supabase Storage ready — bucket "${PHOTO_BUCKET}"`);
      return;
    }

    const { error } = await supabase.storage.createBucket(PHOTO_BUCKET, {
      public: true,
      fileSizeLimit: env.MAX_UPLOAD_BYTES,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    });

    if (error) {
      log.warn({ err: error }, 'Could not create the photo bucket');
      return;
    }

    log.info(`Created Supabase Storage bucket "${PHOTO_BUCKET}"`);
  } catch (error) {
    log.warn({ err: error }, 'Supabase Storage check failed');
  }
}
