import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';
import { ValidationError } from '../../lib/errors.js';
import { moduleLogger } from '../../lib/logger.js';

const log = moduleLogger('storage:photo');

/**
 * Member photo storage.
 *
 * Photos arrive as base64 data URLs from the webcam capture. They are written
 * to local disk under UPLOAD_DIR and served statically.
 *
 * The local-disk choice is deliberate for a single-branch gym: no object
 * storage account to manage, and backups are a folder copy. The interface is
 * narrow enough that swapping in S3 or Supabase Storage for multi-branch
 * (Phase 4) means reimplementing two functions.
 */

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface StoredPhoto {
  /** Public URL path, e.g. /uploads/members/abc.jpg */
  url: string;
  /** Absolute path on disk, for deletion. */
  absolutePath: string;
  sizeBytes: number;
}

/**
 * Decode and persist a base64 data-URL photo.
 * @param dataUrl  e.g. "data:image/jpeg;base64,/9j/4AAQ..."
 * @param subdir   Folder under UPLOAD_DIR, e.g. "members"
 */
export async function savePhotoFromDataUrl(
  dataUrl: string,
  subdir = 'members',
): Promise<StoredPhoto> {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);

  if (!match?.[1] || !match[2]) {
    throw new ValidationError('Invalid image data', {
      photoDataUrl: ['Expected a base64 data URL'],
    });
  }

  const [, mimeType, base64] = match;

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new ValidationError('Unsupported image type', {
      photoDataUrl: [`${mimeType} is not allowed. Use JPEG, PNG or WebP.`],
    });
  }

  const buffer = Buffer.from(base64, 'base64');

  if (buffer.byteLength > env.MAX_UPLOAD_BYTES) {
    const limitMb = (env.MAX_UPLOAD_BYTES / 1_048_576).toFixed(1);
    throw new ValidationError('Image is too large', {
      photoDataUrl: [`Maximum size is ${limitMb} MB`],
    });
  }

  // A declared MIME type is not evidence of file contents. Check the magic
  // bytes so an executable renamed as a .jpg is not written to disk.
  if (!hasValidImageSignature(buffer, mimeType)) {
    throw new ValidationError('Invalid image data', {
      photoDataUrl: ['The file contents do not match a valid image'],
    });
  }

  const extension = MIME_EXTENSIONS[mimeType] ?? 'jpg';
  const filename = `${randomUUID()}.${extension}`;

  const directory = path.resolve(env.UPLOAD_DIR, subdir);
  await mkdir(directory, { recursive: true });

  const absolutePath = path.join(directory, filename);
  await writeFile(absolutePath, buffer);

  log.debug({ filename, sizeBytes: buffer.byteLength }, 'Photo stored');

  return {
    url: `/uploads/${subdir}/${filename}`,
    absolutePath,
    sizeBytes: buffer.byteLength,
  };
}

/** Remove a stored photo. Never throws — a missing file is not a failure. */
export async function deletePhoto(photoUrl: string | null): Promise<void> {
  if (!photoUrl?.startsWith('/uploads/')) return;

  try {
    const relative = photoUrl.replace(/^\/uploads\//, '');
    const absolutePath = path.resolve(env.UPLOAD_DIR, relative);

    // Refuse to follow a path that escapes the upload directory.
    const uploadRoot = path.resolve(env.UPLOAD_DIR);
    if (!absolutePath.startsWith(uploadRoot)) {
      log.warn({ photoUrl }, 'Refused to delete outside the upload directory');
      return;
    }

    await unlink(absolutePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      log.warn({ photoUrl, err: error }, 'Failed to delete photo');
    }
  }
}

/**
 * Verify the buffer starts with the magic bytes for its declared type.
 * Cheap defence against content-type spoofing.
 */
function hasValidImageSignature(buffer: Buffer, mimeType: string): boolean {
  if (buffer.byteLength < 12) return false;

  switch (mimeType) {
    case 'image/jpeg':
    case 'image/jpg':
      // FF D8 FF
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

    case 'image/png':
      // 89 50 4E 47 0D 0A 1A 0A
      return (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47
      );

    case 'image/webp':
      // "RIFF" .... "WEBP"
      return (
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP'
      );

    default:
      return false;
  }
}

/** Ensure the upload directories exist at boot. */
export async function ensureUploadDirectories(): Promise<void> {
  for (const subdir of ['members', 'invoices', 'avatars']) {
    await mkdir(path.resolve(env.UPLOAD_DIR, subdir), { recursive: true });
  }
}
