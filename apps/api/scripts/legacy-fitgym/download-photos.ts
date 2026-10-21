/**
 * Download every member photo referenced by the FitGymSoftware export into
 * backups/photos/<old member id>.<ext>.
 *
 * The photos sit in a public Google Cloud Storage bucket, so no session is
 * needed. The extension comes from the response's Content-Type, not the URL:
 * the old system names JPEGs ".png".
 *
 * SAFE TO RE-RUN. A photo already on disk is skipped, so an interrupted run
 * resumes. Failures are listed at the end and written to
 * backups/photos/failed.json rather than aborting the run.
 *
 *   npx tsx scripts/legacy-fitgym/download-photos.ts
 */
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKUPS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../backups');
const PHOTO_DIR = path.join(BACKUPS, 'photos');
const ALLOWED_HOST = 'storage.googleapis.com';
const DELAY_MS = 250;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

interface ListedMember {
  localId: string;
  profilePhotoPath: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const members = JSON.parse(await readFile(path.join(BACKUPS, 'fitgym/members.json'), 'utf8'))
    .data.rows as ListedMember[];
  const withPhoto = members.filter((m) => m.profilePhotoPath);

  await mkdir(PHOTO_DIR, { recursive: true });
  const existing = new Set((await readdir(PHOTO_DIR)).map((f) => f.replace(/\.[^.]+$/, '')));

  const todo = withPhoto.filter((m) => !existing.has(m.localId));
  console.log(`${withPhoto.length} members have a photo; ${todo.length} still to download.`);

  const failed: { localId: string; url: string; reason: string }[] = [];
  let done = 0;

  for (const member of todo) {
    const url = member.profilePhotoPath!;
    try {
      // Only ever fetch from the bucket the old system uses.
      if (new URL(url).hostname !== ALLOWED_HOST) throw new Error('unexpected host');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
      const ext = EXTENSIONS[type];
      if (!ext) throw new Error(`not an image: ${type || 'no content-type'}`);
      await writeFile(path.join(PHOTO_DIR, `${member.localId}${ext}`), Buffer.from(await res.arrayBuffer()));
      done++;
      if (done % 100 === 0) console.log(`  ${done}/${todo.length}`);
    } catch (err) {
      failed.push({ localId: member.localId, url, reason: String((err as Error).message ?? err) });
    }
    await sleep(DELAY_MS);
  }

  await writeFile(path.join(PHOTO_DIR, 'failed.json'), JSON.stringify(failed, null, 1));
  console.log(`Downloaded ${done}, failed ${failed.length}.`);
  for (const f of failed.slice(0, 20)) console.log(`  #${f.localId}: ${f.reason}`);
}

await main();
