# Security notes

## Dependency advisories — assessed, accepted

`npm audit` reports findings that do not affect this application. Each is
recorded here with the reasoning, so the decision is not re-made from scratch
every time someone runs an audit.

Re-check this file whenever dependencies are upgraded.

### Accepted: `mysql2` (high) — via the `prisma` CLI

| | |
|---|---|
| **Advisories** | Auth plugin downgrade leaking plaintext credentials; unbounded zlib inflate (decompression-bomb DoS) |
| **Path** | `@azf/api → prisma@7.10.0 → mysql2@3.15.3` |
| **Assessment** | Not exploitable here |

Prisma 7 bundles drivers for every database it supports. This project uses
**PostgreSQL**, so the MySQL driver is never loaded at runtime.

Two independent reasons it cannot be reached:

1. The dependency belongs to the `prisma` **CLI** package, not `@prisma/client`.
   Only the client is imported by application code; the CLI runs at build time
   (`migrate`, `generate`, `studio`) and ships nowhere near production.
2. Both advisories require an actual connection to a MySQL server. Every
   connection string in this system points at PostgreSQL.

**Revisit if** the project ever adds a MySQL datasource, or Prisma moves
`mysql2` into `@prisma/client`.

### Accepted: `vitest` / `@vitest/mocker` (moderate)

| | |
|---|---|
| **Advisory** | Path traversal / arbitrary file read via the mocker's redirect-mock feature |
| **Path** | `@azf/api → vitest → @vitest/mocker` |
| **Assessment** | Test-only, never deployed |

Vitest is a `devDependency` and does not appear in a production install
(`npm ci --omit=dev`). Exploiting it requires running a malicious test file,
which implies the attacker already has commit access — at which point this is
not the weakest link.

**Revisit if** tests are ever executed against untrusted, externally
contributed code.

### Accepted: `prisma` (moderate)

Flagged transitively through the two entries above. No separate issue.

### Mitigated in code: `react-router` (moderate) — two advisories

| | |
|---|---|
| **Advisories** | [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) — open redirect via backslash in `<Link>`/`useNavigate` (a bypass of CVE-2025-68470); [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg) — arbitrary constructor injection in `deserializeErrors()` during SSR hydration |
| **Affected** | `>=6.0.0 <7.18.0` — the entire v6 line, including the latest `6.30.6` |
| **Assessment** | One not reachable; one mitigated in application code |

**The SSR advisory is not reachable.** `deserializeErrors()` runs only during
server-side-rendering hydration. This frontend is a pure client-side SPA built
by Vite with no SSR, so that code path never executes.

**The open redirect is reachable in principle**, because the login page
remembers where the user was heading and returns them there afterwards — a
target that comes from the URL and is therefore attacker-controlled. A link
such as `…/login?next=https://evil.example/login` would bounce a receptionist
to a lookalike login page at the exact moment they are primed to type a
password.

Rather than take a major-version upgrade to v7 (breaking API changes) in the
middle of a build, the fix lives in `apps/web/src/lib/safe-redirect.ts`:
**every redirect target in the app is routed through `safeRedirectPath()`**,
which permits only same-origin, absolute, single-slash paths.

The backslash cases are why a naive `startsWith('/')` check is not enough:
browsers normalise `/\evil.example` and `\\evil.example` into
protocol-relative URLs pointing at an external host. That is precisely the
bypass this advisory describes.

39 tests in `safe-redirect.test.ts` cover the payload classes that defeat
weak implementations: absolute URLs, protocol-relative URLs, all backslash
variants, `javascript:`/`data:`/`vbscript:` schemes, whitespace and
control-character smuggling, and relative paths.

**Revisit when** upgrading to React Router v7.18+, which patches both. The
sanitiser should be kept regardless — validating redirect targets is correct
practice independent of any library version.

## Resolved

### `deepmerge-ts` — GHSA-ggr8-5vv4-36mx (high)

Stack exhaustion when merging recursive object graphs, reaching us through the
Prisma CLI's config loader. Fixed with an npm `override` pinning
`deepmerge-ts` to `^8.0.0` (see `overridesRationale` in the root
`package.json`).

The alternative — upgrading to Prisma 8 — was rejected because its `latest`
tag currently points at a **release candidate**, which is not an appropriate
foundation for a system that handles payments.

## Deliberate security choices in application code

These are decisions worth knowing about when reviewing or extending the code.

**Money is integer paise, never floats.** IEEE-754 cannot represent `0.1 + 0.2`
exactly, and a gym reconciling cash at day's end cannot absorb the drift.
Rupees exist only at the UI boundary. See
`packages/shared/src/constants/money.ts`.

**Refresh tokens are stored hashed.** A database leak cannot be replayed as a
live session. Tokens rotate on every use and record their successor, so a
stolen token is detectable when the original is reused.

**`tokenVersion` on the user record.** Bumped on password change or forced
logout, invalidating every live access token without needing a distributed
token blacklist.

**Log redaction is mandatory, not optional.** The system handles member phone
numbers, passwords and payment references. `apps/api/src/lib/logger.ts`
maintains an explicit redaction list; extend it whenever a field is added that
could carry a secret or personal detail.

**Sort fields are allowlisted.** `buildOrderBy` in
`apps/api/src/lib/pagination.ts` rejects any column not explicitly permitted.
Without this, a caller could sort by `passwordHash` and binary-search the
column's contents one page at a time.

**Payment amounts are recomputed server-side.** The client never dictates what
is owed. `idempotencyKey` guards the real failure mode at a busy front desk: a
double-click creating two receipts for one handover of cash.

**Non-cash payments require a reference.** A UPI or card payment with no
transaction ID cannot be reconciled against a bank statement later.

**SMS failures never roll back the triggering transaction.** A gateway outage
must not undo a member's registration. Messages persist to the queue *before*
delivery is attempted, so a crash mid-send leaves them recoverable.

**Permanent SMS errors are not retried.** An invalid number or a DND block
fails identically every time; retrying only burns SMS credits. See
`PERMANENT_ERROR_CODES` in `apps/api/src/services/sms/sms.service.ts`.

## Row-Level Security (2 Oct 2026)

Every table was publicly readable until this date. Supabase auto-generates a
public REST API (PostgREST) over every table in the `public` schema unless
RLS is explicitly enabled. Nobody had enabled it on any table since the
project was created — confirmed live with a plain `curl` using only the
public anon key (the one already embedded in the deployed JavaScript
bundle), which returned real member records and a staff password hash with
no authentication at all.

Fixed in `prisma/migrations/20261002095930_enable_row_level_security`,
applied directly to production. No policies are written — nothing should
ever reach this data through Supabase's public API, only through this API
server. The app is unaffected because Prisma connects as the `postgres`
role, which has `rolbypassrls = true`; confirmed against the live database
before the migration ran.

**`_prisma_migrations` is RLS-enabled in production but not in that
migration's SQL file.** Prisma creates that table itself, outside of any
migration, before the first migration ever runs — a fresh environment's
shadow database (used to validate new migrations) does not have it yet at
that point in migration order, and an `ALTER TABLE` on it fails with
"relation does not exist" the moment anyone adds a later migration.
Production's copy was altered once, by hand, directly against the live
database; it is not and should not be re-added to the migration file.

**New environment setup checklist, because of this:** after a fresh
`prisma migrate deploy` on any new database (a disaster-recovery restore, a
second environment), run once, directly:

```sql
ALTER TABLE "public"."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
```

Everything else is covered by the migration itself.

## Forced password change (2 Oct 2026)

All eight staff accounts — including the owner's — were created while the
database above was still publicly readable, so every password hash was
exposed for an unknown window before the fix. bcrypt hashes are crackable
offline given enough time, so rotation could not be optional.

`User.mustChangePassword` (default `false`) is checked in
`authenticate()` on every request, not just shown as a prompt the client
could choose to skip: once set, every endpoint except `/auth/me`,
`/auth/change-password` and `/auth/logout*` returns 403
`PASSWORD_CHANGE_REQUIRED` until the user actually changes it. A successful
change clears the flag as part of the same transaction that rotates
`tokenVersion` and revokes existing sessions.

Set `true` administratively for all eight existing accounts as part of this
fix. Never cleared automatically by anything except `changePassword()`
itself — there is no backdoor path that marks it satisfied without a real
password change.
