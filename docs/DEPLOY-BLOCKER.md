# The deploy blocker, and how to finish it

**Status:** the site builds and serves. Every `/api/*` request returns 500.
Root cause is found and reproduced locally. The fix is chosen but not written.

Nothing here is guesswork — each claim below was reproduced on this machine.

---

## What is wrong

Vercel bundles `api/index.ts` into a single **ESM** file. Express,
compression and jsonwebtoken are **CommonJS** and call `require()` internally.
In an ESM bundle `require` does not exist, so the function throws at import,
before Express can answer anything:

```
Dynamic require of "buffer" is not supported
```

Vercel reports only `FUNCTION_INVOCATION_FAILED`, because the throw happens at
module load rather than inside a request.

`safe-buffer` is what actually trips it, pulled in by all three packages:

```
@azf/api
 +-- compression@1.8.2      -> safe-buffer
 +-- express@4.22.3         -> safe-buffer
 `-- jsonwebtoken@9.0.3     -> jws -> safe-buffer
```

It is not one bad package. Any CommonJS dependency does this.

## How it was reproduced

```bash
npx esbuild api/index.ts --bundle --platform=node --format=esm \
  --outfile=./fn.mjs --external:@prisma/client --external:.prisma
node -e "import('./fn.mjs')"      # Dynamic require of "buffer" is not supported
```

And the proof that externals fix it:

```bash
npx esbuild api/index.ts --bundle --platform=node --format=esm \
  --outfile=./fn.mjs --packages=external
node -e "import('./fn.mjs')"      # BOOTED OK
```

The compiled app is fine on its own — this is purely a bundling problem:

```bash
npm run build -w apps/api
node -e "import('./apps/api/dist/app.js').then(m => console.log(typeof m.createApp()))"
# function
```

## What was already ruled out

- **Deployment Protection** — was on, now off. It masked the real error.
- **Missing dependencies** — root `package.json` declared none; `api/package.json`
  fixed that (commit `b5463f4`). Real bug, but not this one.
- **`process.exit` on bad env** — destroyed the diagnostic in serverless; now
  throws instead (commit `cbcb149`). Real bug, but not this one.
- **Environment variables** — not yet verified against the live deployment.
  Still worth checking `DATABASE_URL` has no `[YOUR-PASSWORD]` placeholder.

## Two ways to finish

### A — keep one deployment (recommended)

Make the function plain JavaScript so Vercel's Node builder leaves
dependencies external instead of inlining them.

1. `npm run build --workspace=apps/api` added to `buildCommand` in `vercel.json`
   (so `apps/api/dist` exists at deploy time)
2. Replace `api/index.ts` with `api/index.js` importing `@azf/api/dist/app.js`
   — the deep import resolves, this was verified
3. Deploy and check `/api/health` returns 200

Both halves were tested separately and work; they were reverted because the
combination was not verified end to end, and a half-applied fix is worse than
none.

### B — split into two projects

Web as a static site, API as a normal Node server. This is what Express is
designed for and avoids the bundler completely. Costs the single-deployment
property, and needs `VITE_API_URL` set plus the refresh cookie moved back to
`sameSite: 'none'` for cross-site auth.

## First thing to try tomorrow

Option A, step by step, verifying against a real deploy rather than locally —
the whole problem is that local behaviour and Vercel's bundler differ.
