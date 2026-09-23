# Where things stand

Last updated: 20 September 2026

## Start here

```bash
cd "D:\A to Z managment\apps\web"
npm run dev          # http://localhost:5173
```

Demo mode is on (`apps/web/.env.local` → `VITE_DEMO_MODE=true`), so the whole
UI works against in-memory sample data with no database. Every screen shows a
banner saying so.

Sign in: **owner@atozfitness.in** / **Password123** (pre-filled in demo mode).

## The one blocker

**Supabase credentials.** Everything is built but nothing is persisted.

From your Supabase project → Settings → Database, two connection strings are
needed in the root `.env`:

| Supabase label | Port | Variable |
|---|---|---|
| Transaction pooler | 6543 | `DATABASE_URL` |
| Direct connection | 5432 | `DIRECT_URL` |

Then:

```bash
npm run db:migrate   # create tables
npm run db:seed      # 200 demo members
```

Afterwards set `VITE_DEMO_MODE=false` and start the API alongside the web app.

## What works today

**Screens** — login, dashboard, members list, member profile, registration,
check-in, payments, enquiries, plans, expenses, messages, reports, settings.

**Actions** — register, record payment, freeze, unfreeze, renew, send SMS,
bulk renewal reminders, check in / check out, create and edit plans, record
expenses, roll forward recurring costs, log enquiries and follow-ups, receipt
PDF, business report PDF.

**Tests** — 187 passing (148 API, 39 web). `npm test` from the root.

## Deliberately deferred

- **Razorpay** — scaffolded (DB columns, env validation, SDK installed) but no
  service written. Awaiting a decision on whether the ~2% fee is worth it, and
  API keys. See the discussion about dues recovery being the strongest case.
- **Editing settings** — the Settings screen is read-only. Showing wrong
  values would be worse than showing none.

## Not started (Phase 3 remainder)

Trainer management and commissions · workout and diet plans · body
measurements · class scheduling · inventory and supplement sales · locker
management.

Each is self-contained. Worth picking the ones that match actual daily
friction rather than building all six.

## Notes worth not rediscovering

**Money is integer paise everywhere.** Rupees exist only at the display
boundary. A test asserting on paise where the UI shows rupees will look like a
bug in the code and is not.

**PDF currency renders as "Rs." with a non-breaking space**, not "₹".
PDFKit's Helvetica has no rupee glyph and silently prints a superscript one.
See `money()` in both PDF services.

**Dates are handled in local time (IST).** `toISOString()` in a test shifts
every boundary back 5½ hours and makes correct code look broken.

**Financial quarters are Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar** — not calendar
quarters. 21 tests cover the boundaries.

**The logo lives at `apps/web/public/`** in four sizes, generated from the
original `logo.png` at the repo root. The API reads `logo-256.png` from there
for PDFs, so replacing the logo updates screen and print together.

**P&L income means COLLECTED, net of refunds** — not billed. A gym with ₹2L
invoiced and ₹1.2L in the bank is not a ₹2L business.

**Vitest timeout is 20s, not the 5s default.** The smoke suite boots the whole
Express app in `beforeAll`; under parallel load it exceeded 5s and the file
was silently SKIPPED, reporting green while running nothing.

**Nav labels appear from `xl`, not `lg`.** With nine items, showing them at
`lg` overflows the viewport by ~250px.

**Chart colours come from two CSS variables**, `--chart-accent` and
`--chart-contrast`, never hardcoded. The accent switcher (Trends heading on
the dashboard, header on Reports) swaps them by setting `data-chart-accent`
on `<html>`, so all five charts repaint without React re-rendering any of
them. Adding a third palette means adding a CSS block and one `CHART_ACCENTS`
entry — no component changes.

**The switcher's swatch hexes must match globals.css by hand.** TypeScript
cannot see a CSS attribute-selector string, so renaming the accent compiled
and typechecked cleanly while the selectors still said `'red'` and nothing
repainted. Found only by rendering the page and reading the computed value.

**Wine's dark step is LIGHTER than its light step** (49% vs 36%), which looks
inverted and is not. True wine on the dark surface measures 2.47:1, under the
3:1 floor; every deeper candidate threw a contrast WARN. The dark step is
lifted until it clears the floor while keeping hue 346–349.

**Both accent palettes were validated with the dataviz checker, not by eye.**
All six checks pass on both surfaces. A red/green pair was rejected at ΔE 0.8
under deuteranopia — that is why the companion hue is cool in every theme.

**A custom date range compares against the SAME NUMBER OF DAYS immediately
before it.** 1–15 Sept compares against 17–31 Aug, not against all of August.
Comparing a 15-day window to a 31-day one would show a fake ~50% collapse in
revenue every time. Year-over-year was considered and rejected: it needs a
year of history that is not in the system yet. 8 tests in `period.test.ts`.

**yyyy-MM-dd is parsed as a LOCAL date everywhere, never `new Date(str)`.**
`new Date('2026-09-01')` is UTC midnight = 05:30 IST on the 1st, so a range
starting on the 1st silently drops that morning's collections, and one ending
on the 15th drops almost the whole day. See `localDate()` in
`member.schema.ts` and `parseDateParam()` in `analytics.service.ts`.

**Membership filters COMBINE via AND; they used to overwrite.** `planId`,
`expiringInDays` and `expiringFrom/To` each assigned `where.memberships`
directly, so selecting a plan AND an expiry window silently dropped the plan
filter — the list looked right while answering a different question. Fixed in
`buildWhere`; add any new membership condition to `membershipFilters`.

**The members date filter has a Joined/Expiring toggle** because a member row
carries several dates and the right one depends on the question: "who did we
sign up in September?" vs "whose plan ends this week?". Expiring is
deliberately NOT restricted to ACTIVE — a window that has already passed
should show the memberships that lapsed in it.

**`<input type="date">` renders in the BROWSER's locale, which the page
cannot override.** On an en-US machine it shows mm/dd/yyyy while the rest of
the app shows dd/MM/yyyy, and 05/09 then means two different dates. Each
field carries a format hint read from `Intl` at runtime.

**Untrusted date ranges go through `normaliseRange()`** (in
`date-range-picker.tsx`), never straight from the URL or localStorage into a
query. A malformed date DISABLES the filter rather than being dropped — the
silent version showed all 200 members under a chip still claiming a range was
applied, which looks filtered but is not. A reversed range is swapped, not
rejected, because returning zero reads as "no business that fortnight".
9 tests cover it.

**`usePeriod` takes a storage key**, so Reports and the Dashboard keep
separate periods (`azf-report-period` vs `azf-period`). Reports is read at
"this year" for the accountant; the dashboard is watched at "today" for the
floor. One shared key made each screen fight the other.

**Choosing a preset period clears any stored custom range.** They used to
coexist in localStorage, leaving a range nothing displayed — and the next
thing to read it would have resurrected a window the owner had moved on from.

**The Reports PDF follows the on-screen period.** It used to hardcode
`period=year`, so the accountant got a different set of numbers from the ones
the owner was looking at when they clicked Download.

**Reports separates period-scoped figures from all-time ones.** Total
members, Active and Churn carry an explicit "all time" / "right now" hint and
sit in their own row, so the period filter never looks like it is filtering
numbers it does not touch.

**Report charts are scoped server-side, and BUCKET GRANULARITY FOLLOWS THE
RANGE** — days up to ~10 weeks, months beyond. A week bucketed by month is a
single bar that answers nothing; three years by day is 1,000 unreadable
slivers. See `buildBuckets` in `dashboard.service.ts`, mirrored by
`demoBuckets` in `demo-extra.ts`; change both together.

**`/dashboard` scopes its charts only when `?period=` is passed.** Without it
the response keeps its trailing 12-month / 90-day shape, which is what the
Dashboard's live feed wants and what every existing caller expects.

**Charts widen to 14 days below a week; the KPI figures never do.** "Today"
is one bar — arithmetically right, visually useless. `widenForCharts` extends
the window backwards for charts only. The figures keep the exact period, or
"collected today" would stop meaning today. The caption says "over the last
14 days" rather than mislabelling the window.

**A period with no collections used to blank the whole revenue chart.**
`max` was 0, `average / max` was NaN, and every SVG geometry attribute failed
with "Expected length, NaN". Now `Math.max(...values, 0) || 1`. The other
charts already guarded this with `|| 1`; only revenue was missing it.

**Chart bars are keyed by INDEX, not by label.** Day buckets repeat labels
("21 Sep" recurs in any multi-year range) and React silently dropped the
duplicates. The series is positional, so the index is the honest identity.

## Email channel

**Welcome emails send automatically whenever a member has an email address.**
No per-registration toggle, unlike SMS: email costs nothing and needs no DLT
approval, so there is nothing for the front desk to decide. Members without
an address simply get no email.

**Email needs no DLT registration — that is the whole reason it exists here.**
Indian transactional SMS requires a DLT-approved template, a ₹5,000 setup and
a 3–7 day wait. Email has none of that, which makes it the only channel that
is both free and automatic.

**To go live with Gmail:** set `EMAIL_PROVIDER=smtp`, `SMTP_USER` to the
address, and `SMTP_PASSWORD` to a 16-character **App Password** (Google
blocks normal account passwords for SMTP — the error is a misleading
"Username and Password not accepted"). Free limit ≈500/day, far above the
~27 new members a month this gym registers.

**Until then `EMAIL_PROVIDER=mock` writes each email to
`apps/api/tmp/email-preview/*.html`** so the layout can be opened in a
browser and actually looked at.

**Templates are inline-styled tables, deliberately.** Gmail strips `<style>`
blocks and ignores most modern CSS, so a stylesheet that looks right in a
browser arrives as unstyled text. A test asserts no template contains a
`<style>` block.

**Template values are HTML-escaped; the plain-text part is not.** A member
called "Raj & Sons" would otherwise corrupt the markup, and an unescaped
value is an injection route. But `&amp;` in a plain-text email is just wrong,
so `renderEmailTemplate(..., escape = false)` covers the text part.

**An empty `EMAIL_FROM_ADDRESS=` in .env used to block server startup** —
`z.string().email()` rejects the empty string. It is now preprocessed to
undefined: an unconfigured optional channel must never stop the API booting.

**Registration creates a payment but NO invoice**, so most new members have
no receipt to attach. The welcome email attaches one only when an invoice
already exists and sends without it otherwise, rather than promising an
attachment it cannot deliver. Raising an invoice at registration would change
how money documents are numbered — worth deciding deliberately, not as a side
effect of adding email.

## Draggable nav marker

**The nav marker is a draggable iOS-style segmented control.** Grab the
cream pill, slide it along the bar, release on an item to go there. The page
changes ONLY ON RELEASE — navigating live as it passed each item loaded every
page it crossed (five mounts and five fetches to reach one destination).

**THE MARKER IS TWO LAYERS.** A single element cannot satisfy both
requirements, and three arrangements were tried before this one:

  1. Lozenge behind the labels — cannot be grabbed, the link on top swallows
     the pointerdown and the drag never starts.
  2. Lozenge on top carrying the active icon and label — draggable, but the
     label physically leaves its slot, so the bar showed a hole AND the
     active label rendered twice.
  3. Re-dispatching a synthetic pointerdown from the link to the lozenge —
     Framer ignores it.

What works: an EMPTY lozenge at `z-0` that travels behind every label, plus
a transparent drag handle at `z-30` above everything whose only job is to
catch the pointer. Both are driven by the same `handleX` motion value so they
can never drift apart. Nothing is duplicated and nothing leaves its slot.

**Both the resting active item and the mid-drag `targeted` item use
`text-primary-foreground`.** The lozenge is behind them, so they are reading
dark-on-cream; nav grey on cream is barely legible. The active item reverts
to nav grey during a drag, because by then the lozenge has moved away and
dark text on the dark bar is invisible — that bug made the item look deleted
and left an apparent hole in the bar.

**Marker width is FROZEN at drag start** (`dragWidthRef`). Items are
different widths and the target changes as you drag; letting the marker
resize mid-gesture moves its own centre, shifting the coordinate space the
pointer is measured against. The marker drifted from the thumb and landed one
or two items short. `dragLimits` is computed from the first item's width for
the same reason.

**All items go `pointerEvents: none` mid-drag**, or crossing one steals the
pointer capture and the gesture dies partway across the bar.

**Verified:** drag across the bar, click, keyboard Enter, reduced motion,
icon-only mode below `xl`, and overdrag past the last item (clamped).

## Audit trail & registration receipts

**Member changes are audited.** Registration, edit, soft-delete and QR
rotation all write to `audit_logs` with who, when, and a before/after diff.
`GET /members/:id/history` reads it back (owner and manager only). Nothing
wrote to the table before this — it existed in the schema and stayed empty.

**Audit writes NEVER throw.** An audit failure must not roll back the member
edit that triggered it: losing the record of a change is bad, losing the
change itself while the receptionist believes it saved is worse.

**Only the CHANGED fields are stored.** Whole-row snapshots make the trail
unreadable — a phone correction would show forty identical fields and one
different one. `diffRecords` also drops `qrToken` and `passwordHash`: a trail
holding a live QR token hands anyone with read access a working gym pass.
10 tests cover it, including dates (two Date objects for the same instant are
never `===`, so a naive compare logs a change on every save).

**The audit trail is readable in the UI.** A History tab on the member
profile, owner and manager only, matching the API. It shows a timeline of who
changed what with the old value struck through. Demo mode serves a sample
trail from `buildMemberHistory`, so it can be reviewed before Supabase is
connected.

**Audit values are formatted by FIELD NAME, not by type.** Money is stored in
paise and read as "100000" for ₹1,000 until `formatAuditValue` special-cased
the `*Paise` suffix; phone numbers were unspaced. Both were caught by looking
at the rendered tab, not by any test.

**Registration now issues a numbered receipt.** It used to create a payment
with no invoice, so a member paid ₹4,000 and had no document — and the
welcome email had no PDF to attach. `issueReceipt` was extracted from the
payments service to `invoices/receipt-issuer.ts` and is shared by both paths,
so one gap-free sequence serves the desk and the payments screen alike.

**The receipt is issued INSIDE the registration transaction.** The document
number comes from a row-locked `UPDATE ... RETURNING` sequence; issuing it
outside would let a number be consumed by a payment that then rolls back,
leaving a permanent gap in the book.

## SegmentedControl

**Every filter now uses the nav bar's draggable marker** — period filter,
chart accent, members Joined/Expiring, leads view. One component in
`components/common/segmented-control.tsx`; see the nav notes above for why
the marker is two layers.

**Framer's `animate` prop cannot drive a controlled motion value.** With
`style={{ x }}` the element's `animate={{ x }}` silently loses, and the
marker stays wherever it was dropped. Every move goes through the imperative
`animate(x, target, SPRING)` instead. This was the bug where the pill sat
stranded between two items.

**`dragConstraints` as `{left, right}` is measured from the element's own
layout position**, not the rail. The handle is `absolute left-0`, so its
origin is already the rail's left edge — passing page coordinates there
clamps the marker into a range it can never leave.


## VERIFIED AGAINST THE LIVE DATABASE — 23 September 2026

Supabase is connected (project `ptcrhgqkrrhhjvguhyqh`, ap-south-1), the
migration is applied, and the seed has run. Demo mode is OFF.

All 13 end-to-end checks pass against real Postgres:

  - Owner login, dashboard reads 200 seeded members
  - Registration issues `RCPT/2026-27/0001`
  - A second payment issues `0002` — gap-free
  - `MEMBER_REGISTERED`, `MEMBER_UPDATED`, `MEMBER_DELETED` all recorded
  - An edit stores ONLY the changed field
  - Email and WhatsApp both queued and SENT on registration and on payment
  - All nine pages render with no console errors

**`DIRECT_URL` uses the SESSION pooler (5432), not "Direct connection".**
Supabase's direct route needs IPv6, which most Indian networks lack. The
session pooler is IPv4-proxied and runs migrations identically.

**One real bug the live run caught:** every audit entry read
`phone, updatedAt`. Prisma maintains `updatedAt` on every write, so it
appeared in the diff of every single edit and buried the one field that
actually changed. `updatedAt`, `createdAt` and `deletedAt` are now redacted
alongside the credentials. Two tests cover it. No amount of typechecking
would have found this — it needed a real row.

## Legacy member import (6,500 records)

The owner's previous software holds ~6,500 members to bring across. The
PARSER is built and tested; the upload UI and the database writer are not,
because they should be shaped around the real export rather than a guess.

**Decisions already taken with the owner:**
- Export arrives as Excel/CSV.
- Missing date of birth or gender → import anyway, tag incomplete, fill in as
  members visit. Nothing is dropped for a field the old system never had.
- Members and their CURRENT membership only. Past payment history stays in
  the old system; importing it would mean mapping receipt numbers and dates
  into a live gap-free sequence.

**DATES ARE DAY-FIRST.** "01/02/2024" is 1 February. Reading a file the wrong
way round shifts every expiry by months — wrong renewal reminders, revenue in
the wrong period, and no error anywhere. `detectDateOrder` scans the whole
column and reports `ambiguous` rather than guessing when every value fits
both readings; the importer must then ASK.

**Lapsed members import as EXPIRED, not ACTIVE.** 6,500 historical members
all marked active would make every retention and churn figure meaningless
from the first day. Status follows the expiry date.

**Phone validation reuses `INDIAN_MOBILE_PATTERN`, not a length check.** A
landline like "040 23456789" strips to ten digits and passes a naive length
test, importing a member nobody can ever contact. Caught by a test.

**Duplicates are reported, never auto-merged.** Families genuinely share a
phone number at a gym; the owner decides.

**Still to build:** CSV upload endpoint, the preview screen, and the batched
writer. Ask for 5–10 real rows first — the column names and date format
decide the rest.

## Handover to the client's Supabase account

Full procedure in **`docs/HANDOVER.md`** — dump/restore, photos, secrets,
accounts, verification, rollback.

Three things that procedure exists to catch, because each is silent:

**Member photos do not travel with the database.** Only the path is stored
(`/uploads/members/abc.jpg`); the files sit on disk under
`apps/api/uploads/` and must be copied separately or every photo breaks.

**The seed creates EIGHT live logins, all on `Password123`** — owner,
manager, receptionist and five trainers. The trainers are the easy ones to
miss; they are seeded as demo staff but are real `User` rows with a real
password. All eight must be deleted before the client logs in.

**JWT secrets must be rotated.** Keeping the developer's
`JWT_ACCESS_SECRET` means every token ever issued still authenticates
against the client's live system.

`VITE_DEMO_MODE` lives in `apps/web/.env.local`, not the root `.env`, and
Vite inlines it at build time — changing it without rebuilding does nothing.

## Receipt PDF

**Both payment paths now email the member their receipt PDF.** Registration
already did; recording a payment sent SMS only, so a member who paid at the
desk got no document. Sent whenever the member has an email address, with no
per-payment toggle — email costs nothing and needs no DLT approval.

**The receipt carries a watermark, the gym logo, and the membership period.**
The period matters most: without it a member has proof they paid but no
record of what they paid FOR, which is the first thing checked when a
renewal date is disputed.

**Watermark opacity is 0.028 at 240px, and that is deliberate.** At the
instinctive 0.05/320px the logo's own wordmark stayed legible and sat
directly behind the line items. A watermark that can be READ competes with
the figures — and a member photocopying the receipt at tax time gets an
unreadable document. Verified by rendering, not by reasoning.

**`drawWatermark` runs FIRST.** PDF has no z-index, only draw order, so
anything drawn before the watermark would be painted over. It is also
wrapped in `save`/`restore` because opacity and transform are document-level
state in PDFKit — leaking either tints or rotates everything afterwards.

**To look at the receipt without a database:**

```
npx vitest run tests/pdf/preview.manual.test.ts --workspace=apps/api
```

Writes `apps/api/tmp/receipt-preview.pdf` using a mocked Prisma. Chromium
will not render a `file://` PDF — rasterise it with pdf.js if you need an
image.

## WhatsApp channel

**Registration and payment now send email + WhatsApp. The welcome SMS is
OPT-IN** (`sendWelcomeSms` defaults to false). Indian transactional SMS needs
DLT registration to deliver at all; WhatsApp and email reach the member today
at no setup cost. The SMS code and the Messages screen are untouched — only
the automatic welcome changed.

**WhatsApp runs on `mock` until Meta business verification completes.**
Messages are logged, not sent. Switching to `meta` is an env change and a
restart, same pattern as email.

**Meta numbers template variables POSITIONALLY ({{1}}, {{2}}), and that is
the dangerous part.** A missing value does not error — it shifts every later
variable up by one, and the member gets a plausible message with their plan
where their name belongs. `toWhatsAppParameters` emits an empty string to
hold the position rather than dropping it. A test covers exactly this.

**The blocker to be aware of:** a WhatsApp Business number must NOT already
be registered on the consumer WhatsApp app. The number the gym currently
messages members from cannot be reused without deleting that WhatsApp
account first. Worth checking before promising a date.

**Templates must be submitted under category UTILITY**, not MARKETING —
cheaper, and not subject to the per-user frequency cap that would throttle
receipts.

**Receipt links no longer 500 in demo mode.** The member profile used a
plain `<a href>` to `/api/invoices/:id/pdf`, which the browser fetches
itself and the demo axios adapter never sees. It now shows the same guard as
the Reports download.

## PDF downloads need `openPdf`, never `window.open`

Both PDF routes answered **401** in the browser. The access token is held in
a module variable — deliberately, so an XSS cannot read it — and a new tab
is a fresh document that carries no Authorization header. The tab showed
raw JSON instead of a receipt.

`lib/open-pdf.ts` fetches the bytes through axios (token attached), then
opens an object URL. Use it for every future PDF route.

Two details in there worth keeping:
  - An API error still arrives as a Blob when `responseType: 'blob'`, so the
    helper checks the MIME type and surfaces the real message.
  - The object URL is revoked on a 60s timer, not immediately: revoking
    before the new tab has read it yields a blank viewer, and no event
    reliably fires when it has.

## Member import — BUILT AND WORKING

`/members/import`. Owner and manager only.

Verified end to end against a deliberately messy CSV: quoted commas,
formatted phones, a landline, a missing name, a missing DOB and a duplicate
number. All nine columns auto-matched ("Member Name", "Mobile No",
"Valid Till", "Package"); the landline and the nameless row were rejected;
the duplicate was flagged rather than merged.

**The CSV is parsed IN THE BROWSER and posted as JSON.** No file upload, so
the preview returns in one round trip and there is no multer dependency.

**`lib/parse-csv.ts` is a real parser, not `split(',')`.** An address like
`"12-3, Main Road"` splits into two columns under the naive approach, every
later field shifts left, and phone numbers land in the email column. On
6,500 rows nobody notices until a member complains. 10 tests.

**Writes are BATCHED at 50, not one transaction.** 6,500 rows in a single
transaction holds locks for minutes against a pooled Supabase connection and
times out; worse, one bad row at 6,400 discards everything before it. A
failed batch costs at most 50 rows and the report names them.

**NO payment or invoice is created for imported members.** The money was
taken in the old system; raising a receipt here would invent a transaction
and corrupt every revenue figure. Membership dates come across, money does
not.

**Imported members are tagged in `notes`** with what the old system was
missing, so the front desk sees it when the member is standing there.

## Notifications — email + WhatsApp, SMS opt-in

**Gmail SMTP is LIVE.** Real emails send from theahmedalii82@gmail.com.
Verified end to end: a registration sent the welcome email with the receipt
PDF attached, and Gmail accepted it.

**Registration now sends WhatsApp + email automatically; SMS is a checkbox,
off by default.** The registration form previously hardcoded
`sendWelcomeSms: true`, which overrode the schema default — a form value
always wins over a schema default, so both had to change.

**`/notifications/reminders` sends one reminder over the channels the owner
picks.** Expiry or dues, any combination of WhatsApp / email / SMS.
Channels fail INDEPENDENTLY and the response names what happened per
channel per member: "42 reminders sent" is not a useful answer when eleven
went nowhere. A member with no email is reported as `skipped`, not failed —
that tells the owner who to ask for an address.

**Email and WhatsApp retry workers now run.** Only SMS retried before, so a
message that failed once sat as FAILED forever and the member never heard
from the gym.

**A password change needs an API restart.** The SMTP credential is read at
boot; editing `.env` while the server runs leaves the old one in memory.
That is what caused the one DEAD welcome email — not a code fault.

## Plan mix follows the report filter

It was the one chart that did not. Revenue, member growth and payment modes
were all scoped; `getDistribution()` took no range and always counted
currently-ACTIVE memberships, so it showed the same 94 members whatever
period was selected — a chart that looked filtered and was not.

**With a range it now counts memberships SOLD in that window, by start
date, whatever their status is now.** A membership sold in March and since
expired still counts as a March sale; filtering by current status would make
past periods shrink every time you looked at them.

**Without a range it keeps the live active mix**, which is what "All time"
should show. The caption switches between "Plans sold · This month" and
"Active memberships" so the chart always says which it is.

## Deployment — see docs/DEPLOYMENT.md

Vercel (web) + Render (API) + Supabase (database, already live).

**Two things were hardcoded for local development and would have broken a
deploy.** Both are fixed:

1. `api-client.ts` had `baseURL: '/api'`, which only works because the Vite
   dev proxy forwards it. On Vercel there is no proxy, so a relative path
   hits the static host and 404s. `VITE_API_URL` now carries the absolute
   URL, falling back to '/api' locally.

2. The refresh cookie used `sameSite: 'lax'`, which a browser will NOT send
   cross-site. With the web app and API on different hosts, every user would
   have been silently logged out the moment the 15-minute access token
   expired. Production now uses `'none'`, which requires `secure: true` —
   hence both hosts must be HTTPS.

**The API needs a long-running process**, not serverless: the background
workers (expiry sync, notification retries) must stay alive. That is why
Render rather than Vercel functions.
