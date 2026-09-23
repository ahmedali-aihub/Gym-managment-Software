/**
 * Move member photos from local disk to Supabase Storage.
 *
 * WHY THIS EXISTS. Photos written before the move to Supabase have
 * "/uploads/..." URLs and live on the API server's disk. A serverless
 * function has no persistent disk, so on deploy those files are simply not
 * there: the member profile shows a broken image and nothing logs an error.
 * This copies each one into the bucket and repoints the URL.
 *
 * SAFE TO RUN TWICE. It only selects members whose photoUrl still starts
 * with "/uploads/", so an already-migrated photo is not considered. A member
 * whose file is missing from disk is reported and skipped, never blanked —
 * an empty photoUrl would silently lose the record that a photo existed.
 *
 * The local file is left in place. Deleting it is a separate decision, and
 * keeping it means a failed migration can simply be re-run.
 *
 *   npm run photos:migrate -w apps/api          # report only
 *   npm run photos:migrate -w apps/api -- --commit
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import {
  ensurePhotoBucket,
  isSupabaseStorageEnabled,
  uploadPhoto,
} from '../src/services/storage/supabase-storage.js';

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const commit = process.argv.includes('--commit');

async function main(): Promise<void> {
  if (!isSupabaseStorageEnabled()) {
    console.error(
      'Supabase Storage is not configured.\n' +
        'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this.',
    );
    process.exitCode = 1;
    return;
  }

  await ensurePhotoBucket();

  const members = await prisma.member.findMany({
    where: { photoUrl: { startsWith: '/uploads/' } },
    select: { id: true, memberId: true, fullName: true, photoUrl: true },
    orderBy: { memberId: 'asc' },
  });

  if (members.length === 0) {
    console.log('No photos left on local disk. Nothing to do.');
    return;
  }

  console.log(
    `${members.length} photo(s) on local disk` +
      (commit ? '' : ' — dry run, nothing will be changed'),
  );
  console.log('');

  let moved = 0;
  let missing = 0;
  let failed = 0;

  for (const member of members) {
    const photoUrl = member.photoUrl!;
    const label = `${member.memberId} ${member.fullName}`.padEnd(34);

    const relative = photoUrl.replace(/^\/uploads\//, '');
    const absolutePath = path.resolve(env.UPLOAD_DIR, relative);

    // Same guard as deletePhoto: never follow a path out of the upload
    // directory, even though these values come from our own database.
    const uploadRoot = path.resolve(env.UPLOAD_DIR);
    if (!absolutePath.startsWith(uploadRoot)) {
      console.log(`${label} SKIPPED  path escapes the upload directory`);
      failed += 1;
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = await readFile(absolutePath);
    } catch {
      // The file is gone. Leave photoUrl as it is: a dangling URL still
      // records that this member had a photo, which a blank field would not.
      console.log(`${label} MISSING  ${relative}`);
      missing += 1;
      continue;
    }

    const extension = path.extname(absolutePath).toLowerCase();
    const contentType = CONTENT_TYPES[extension] ?? 'image/jpeg';
    // Keep the original UUID filename, so the object path stays traceable
    // back to the file it came from.
    const objectPath = relative.split(path.sep).join('/');

    if (!commit) {
      console.log(`${label} would move -> ${objectPath} (${buffer.byteLength} bytes)`);
      moved += 1;
      continue;
    }

    try {
      const url = await uploadPhoto(buffer, objectPath, contentType);
      await prisma.member.update({
        where: { id: member.id },
        data: { photoUrl: url },
      });
      console.log(`${label} moved    -> ${objectPath}`);
      moved += 1;
    } catch (error) {
      console.log(`${label} FAILED   ${(error as Error).message}`);
      failed += 1;
    }
  }

  console.log('');
  console.log(
    `${commit ? 'moved' : 'would move'}: ${moved}` +
      (missing ? ` | file missing: ${missing}` : '') +
      (failed ? ` | failed: ${failed}` : ''),
  );

  if (!commit && moved > 0) {
    console.log('');
    console.log('Re-run with --commit to apply.');
  }

  if (failed > 0) process.exitCode = 1;
}

await main();
await prisma.$disconnect();
