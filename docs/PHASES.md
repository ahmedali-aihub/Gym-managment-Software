# Build phases — status

Each phase must run, typecheck, and pass its tests before the next begins.

Legend: ✅ done & verified · 🔄 in progress · ⬜ not started · ⏸ blocked

---

## Phase 0 — Foundation ✅

| Item | Status | Verified by |
|---|---|---|
| Monorepo (npm workspaces) | ✅ | `npm install` clean |
| `@azf/shared` package | ✅ | `tsc` clean, helpers exercised |
| Money helpers (paise, INR, words) | ✅ | Lakh grouping + float-drift check |
| Date helpers (dd/MM/yyyy, FY, expiry) | ✅ | FY rolls at 1 Apr; 30-day plan ends 30/09 |
| Identifiers (AZF-YYYY-0001, invoices, QR) | ✅ | Round-trip parse verified |
| Prisma schema (18 models) | ✅ | `prisma validate` passes |
| Prisma 7 client + pg adapter | ✅ | `prisma generate` + `tsc` clean |
| Env validation (Zod, fail-fast) | ✅ | Boot-time refinements |
| Logger with secret redaction | ✅ | Redaction list covers tokens/passwords |
| Typed error hierarchy | ✅ | `tsc` clean |
| Pagination + sort allowlist | ✅ | `tsc` clean |
| Dependency audit triage | ✅ | `docs/SECURITY-NOTES.md` |

## Phase 1 — Core 🔄

**Backend complete.** 74 tests passing, full typecheck clean, Express app
verified assembling and responding over HTTP.

| Item | Status | Notes |
|---|---|---|
| SMS provider interface | ✅ | Adapter pattern; app depends only on the interface |
| Mock provider | ✅ | Logs, outbox, simulated latency & failures |
| MSG91 provider | ✅ | Flow API v5, DLT template resolution |
| Twilio provider | ✅ | REST, no SDK dependency |
| Fast2SMS provider | ✅ | DLT manual route |
| SMS service (queue/retry/dead-letter) | ✅ | 22 tests |
| SMS templates (7, DLT-shaped) | ✅ | All fit one GSM-7 segment |
| Auth: JWT + refresh rotation | ✅ | Hashed tokens, reuse detection |
| Auth: RBAC (4 roles) | ✅ | Per-route guards, verified by smoke tests |
| Billing engine | ✅ | 30 tests; GST-ready but issuing plain receipts |
| Member registration (transactional) | ✅ | Member + membership + payment atomic |
| Photo capture + storage | ✅ | Magic-byte validation, orphan cleanup |
| QR generation | ✅ | Secret token, rotatable |
| Member ID sequences | ✅ | Atomic, gap-free under concurrency |
| Member list + filters + stats | ✅ | Paginated, sort allowlisted |
| Member profile | ✅ | Payments, attendance, dues, QR |
| Plans CRUD | ✅ | Soft-retire preserves history |
| Freeze / unfreeze | ✅ | Preserves paid-for days |
| Upgrade (with preview) | ✅ | Prorated credit, same path quotes & charges |
| Transfer | ✅ | Both sides audited |
| Renew | ✅ | Continues from expiry if renewing early |
| Payments + idempotency | ✅ | Server-side balance, overpayment rejected |
| Receipts (numbered, snapshotted) | ✅ | RCPT/FY/NNNN, GST-ready |
| Refunds (full & partial) | ✅ | Recorded on original row |
| Express app + workers | ✅ | Graceful shutdown, 3 background workers |
| Seed script: 200 members | ✅ | Written & typechecked |
| HTTP smoke tests | ✅ | 22 tests: guards, validation, error shape |
| Receipt PDF rendering | ✅ | **7 tests**; GST-ready, snapshot-based |
| Razorpay integration | ⬜ | Deferred — awaiting keys |
| **Migration + seed run** | ⏸ | **Blocked: needs Supabase credentials** |
| Frontend (React) | ⬜ | Next after PDF |

### Test coverage

| Suite | Tests | Covers |
|---|---|---|
| `billing.test.ts` | 30 | Proration, discounts, refunds, balances |
| `sms.service.test.ts` | 22 | Retry, backoff, dead-letter, segments |
| `app.smoke.test.ts` | 22 | Auth guards, validation, error contract |
| `receipt.test.ts` | 7 | PDF validity, receipt vs. tax invoice |
| `safe-redirect.test.ts` (web) | 39 | Open-redirect payloads |
| **Total** | **120** | |

### Completed in the final pass

| Item | Notes |
|---|---|
| Record payment dialog | Idempotency key per dialog opening, quick amounts |
| Freeze dialog | Shows the new expiry before committing |
| Send SMS dialog | Live preview with billed segment count |
| Reports page | Charts + CSV export with UTF-8 BOM for Excel |
| Settings page | Gym, tax, SMS provider and role reference |
| Payments CSV export | Exports the filtered view, not the whole ledger |
| Receipt PDF | On-demand from the stored snapshot |

**Bug caught by the PDF tests.** The first extractor searched for `(text) Tj`
literals; PDFKit actually emits kerned hex arrays (`[<50> 120 <41>…] TJ`)
inside deflate streams. Three tests failed until the helper decompressed the
stream and decoded hex — a reminder that "the PDF renders" and "the PDF
contains the right words" are different assertions.

### Bug caught by tests

**Proration rounding.** The first implementation floored a per-day rate then
multiplied, losing 20 paise on a ₹4,000 → 45-day credit. Compounding across
every remaining day, it would have shortchanged members on every mid-cycle
upgrade. Fixed to floor the proportion once; regression test added.

## Phase 2 — Dashboard & UI 🔄

**Design system and dashboard complete.** Production build succeeds,
typecheck clean, 39 frontend tests passing.

| Item | Status | Notes |
|---|---|---|
| Design tokens (light + dark) | ✅ | HSL variables; one swap re-themes everything |
| Tailwind config + typography | ✅ | Outfit display / Inter body / JetBrains mono |
| UI primitives (14 components) | ✅ | Button, Card, Input, Select, Dialog, Dropdown… |
| API client + token refresh | ✅ | Single-flight refresh; in-memory access token |
| **Open-redirect guard** | ✅ | **39 tests** — mitigates GHSA-wrjc-x8rr-h8h6 |
| Auth context + route guards | ✅ | Silent restore on boot, no login flash |
| Login page | ✅ | Split layout, animated, mobile-first |
| App shell (sidebar + topbar) | ✅ | Drawer below `lg`, animated active marker |
| Command palette (Ctrl+K) | ✅ | Debounced member search + navigation |
| Theme switching | ✅ | Light / dark / system, follows OS live |
| Animated KPI cards | ✅ | Spring count-up, honours reduced-motion |
| Charts (5 types) | ✅ | Revenue, growth, plans, methods, heatmap |
| Dashboard widgets | ✅ | Expiring, defaulters, live check-in feed |
| Dashboard API | ✅ | One parallel call, not nine round trips |
| Members list | ✅ | URL-driven filters, responsive table→cards |
| Skeleton / empty / error states | ✅ | Every list and panel |
| Register member form | ✅ | 3-step, webcam capture, live bill preview |
| Member profile | ✅ | QR pass, payments, attendance, history |
| Payments UI | ✅ | Ledger, filters, totals, URL-driven state |
| Plans UI | ✅ | Product cards with live member counts |
| Messages / SMS queue UI | ✅ | Delivery log + failed queue with retry |
| Demo mode | ✅ | In-memory adapter; all screens usable without a DB |

### Theme: Natural Titanium

Replaced the original lime-on-charcoal palette at the user's request.

**Light** — warm gray through cream white, soft bronze accent. Nothing is
pure: every surface sits at hue 30–40, which is what separates titanium from
plain aluminium.

**Dark** — graphite at hue 220 with a champagne accent. The first attempt
put dark surfaces at hue 30 (warm), which turned the whole page sepia. A dark
room does not make metal look warmer; it drains colour out of it. Warmth now
lives only in the accent and text: one warm element against a cool ground
reads as precious, everything warm together reads as a stain.

**Navigation** is a floating pill that travels across every screen, replacing
the sidebar and topbar entirely. Its active marker is a shared Framer
`layoutId`, so it slides between items rather than cross-fading.

### Frontend bundle

Code-split so the initial load carries only what is needed:

| Chunk | Gzipped |
|---|---|
| Dashboard | 5.94 kB |
| Members | 16.48 kB |
| React core | 68.22 kB |
| Charts (lazy) | 115.37 kB |
| CSS | 8.41 kB |

Recharts loads only when a chart page opens — a receptionist who never
opens Reports never downloads it.

## Phase 3 — Operations 🔄

| Item | Status | Notes |
|---|---|---|
| QR / ID check-in | ✅ | Scanner-first; **17 QR tests** |
| Currently-in-gym list + check-out | ✅ | Live, 30s refresh |
| Plans create / edit | ✅ | Per-day cost preview, feature chips |
| Renew membership | ✅ | Continues from expiry when renewing early |
| Unfreeze | ✅ | Shows days added back before committing |
| Bulk renewal reminders | ✅ | Per-member variables, cost estimate |
| Period analytics | ✅ | **21 tests**; Indian financial quarters |
| Training-focus filters | ✅ | OR semantics, URL-shareable |
| Trainer management | ⬜ | |
| Workout / diet plans | ⬜ | |
| Body measurements | ⬜ | |
| Class scheduling | ⬜ | |
| Lead / enquiry CRM | ✅ | Pipeline, follow-ups, activity log |
| Expense tracking + P&L | ✅ | **11 tests**; recurring roll-forward |
| Inventory | ⬜ | |
| Locker management | ⬜ | |

### Check-in design notes

Built for a **hardware barcode scanner**, which is how gyms actually do this:
the scanner types the QR contents and presses Enter. The input stays focused
at all times and re-focuses on window focus, because a scanner sends
keystrokes to whatever is focused — losing focus means the scan goes nowhere.

The result panel returns the member's status, expiry and outstanding balance
in one response. A receptionist would otherwise look those up separately
while someone waits at the desk.

**Duplicate scans within 5 minutes reuse the existing row** rather than
creating a second visit, which is what happens when a scanner double-fires or
a member scans again because they missed the confirmation.

## Phase 4 — Standout features ⬜

---

## Dependency decisions

Three pins, each with reasoning in `package.json` → `overridesRationale`:

**Prisma 7.10.0 (exact).** `latest` is an 8.x release candidate — not a
foundation for a payments system.

**`deepmerge-ts` ^8.** Clears a high-severity advisory reaching us through
the Prisma CLI.

**`@types/react` ^18.** Transitive deps pulled React 19 types above our spec.
Two copies in the tree made every lucide icon and Radix component fail to
typecheck, because React 19 widened `ReactNode` to include `bigint`.

**Radix UI pinned to exact versions.** The `^` ranges resolved to
React-19-only releases whose props typed as empty objects.

A `postinstall` hook regenerates the Prisma client, since `npm install` wipes
`node_modules` and takes the generated client with it.

---

## Open decisions

| Decision | Status |
|---|---|
| Database | Supabase Postgres — **credentials pending** |
| GST | Not registered; receipts issue without tax. Schema stays GST-ready |
| Plan pricing | Hyderabad placeholders, editable in UI |
| SMS provider | Mock for now; MSG91 wired and ready for keys |
| Razorpay | Mock for now; deferred by user |

## Notable engineering decisions

**Money is integer paise.** Floats cannot represent `0.1 + 0.2` exactly.
Rupees appear only at the UI boundary.

**Prisma pinned to stable 7.10.0.** `latest` is an 8.x release candidate —
not an appropriate base for a payments system. See `docs/SECURITY-NOTES.md`.

**Membership prices are copied, not referenced.** A price rise next month must
not rewrite what a member already paid.

**Invoice/member sequences are DB rows.** Allocated under a row lock inside the
same transaction as the record, so concurrent registrations cannot collide or
leave gaps.

**SMS failures never roll back their trigger.** Rows persist *before* delivery
is attempted, so a crash mid-send leaves the message recoverable.
