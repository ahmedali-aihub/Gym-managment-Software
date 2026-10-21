/**
 * Local receiver for the FitGymSoftware export.
 *
 * WHY THIS EXISTS. The old software's API only answers requests carrying the
 * logged-in staff session, and that session lives in the browser. Rather than
 * copy the token out of the browser, the scraper (browser-scraper.js) runs
 * inside the logged-in page and POSTs what it fetches here, and this process
 * writes it to backups/fitgym/. The token never leaves the page.
 *
 * STORAGE. Each record kind is an append-only JSONL file, one line per
 * fetched record: {"key": ..., "fetchedAt": ..., "data": ...}. A crash mid-run
 * loses at most the batch in flight, and GET /done tells the scraper which
 * keys it already has so a restart resumes rather than starts over.
 * Whole-collection snapshots (the member list, all invoices...) are written as
 * plain JSON via /snapshot.
 *
 * Listens on 127.0.0.1 only. backups/ is gitignored: this is member PII.
 *
 *   npx tsx scripts/legacy-fitgym/receiver.ts
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { appendFile, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 4599;
const ALLOWED_ORIGIN = 'https://control.fitgymsoftware.com';
const OUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../backups/fitgym',
);

// Only these names can be written, so a malformed request cannot pick a path.
const NAME_RE = /^[a-z][a-z0-9-]{0,40}$/;

/** In-memory index of keys already on disk, per JSONL kind. */
const done = new Map<string, Set<string>>();

async function loadDone(kind: string): Promise<Set<string>> {
  let keys = done.get(kind);
  if (keys) return keys;
  keys = new Set();
  const file = path.join(OUT_DIR, `${kind}.jsonl`);
  if (existsSync(file)) {
    for (const line of (await readFile(file, 'utf8')).split('\n')) {
      if (!line.trim()) continue;
      try {
        keys.add(String((JSON.parse(line) as { key: unknown }).key));
      } catch {
        // A torn final line from a crash. The key is simply re-fetched.
      }
    }
  }
  done.set(kind, keys);
  return keys;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  // CORS + Chrome's Private Network Access preflight: the page is on a public
  // https origin calling a loopback address.
  if (req.headers.origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
    const name = url.searchParams.get('name') ?? '';

    if (url.pathname === '/ping') return send(res, 200, { ok: true, outDir: OUT_DIR });

    if (!NAME_RE.test(name)) return send(res, 400, { error: 'bad name' });

    if (req.method === 'GET' && url.pathname === '/done') {
      return send(res, 200, [...(await loadDone(name))]);
    }

    // Lets the scraper read back ids from an earlier snapshot after a reload.
    if (req.method === 'GET' && url.pathname === '/snapshot') {
      const file = path.join(OUT_DIR, `${name}.json`);
      if (!existsSync(file)) return send(res, 404, { error: 'no snapshot' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(await readFile(file, 'utf8'));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/records') {
      const records = (await readBody(req)) as { key: string | number; data: unknown }[];
      const keys = await loadDone(name);
      const fetchedAt = new Date().toISOString();
      const fresh = records.filter((r) => !keys.has(String(r.key)));
      if (fresh.length > 0) {
        const lines = fresh
          .map((r) => JSON.stringify({ key: String(r.key), fetchedAt, data: r.data }))
          .join('\n');
        await appendFile(path.join(OUT_DIR, `${name}.jsonl`), lines + '\n');
        for (const r of fresh) keys.add(String(r.key));
      }
      return send(res, 200, { written: fresh.length, total: keys.size });
    }

    if (req.method === 'POST' && url.pathname === '/snapshot') {
      const body = await readBody(req);
      const file = path.join(OUT_DIR, `${name}.json`);
      // Write-then-rename so a crash never leaves a half-written snapshot.
      await writeFile(`${file}.tmp`, JSON.stringify(body, null, 1));
      await rename(`${file}.tmp`, file);
      return send(res, 200, { ok: true });
    }

    send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: String(err) });
  }
});

await mkdir(OUT_DIR, { recursive: true });
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Receiver on http://127.0.0.1:${PORT}, writing to ${OUT_DIR}`);
});
