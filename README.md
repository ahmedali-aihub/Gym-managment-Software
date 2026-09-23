# A to Z Fitness OS

Gym management platform for **A to Z Fitness**, Mehdipatnam, Hyderabad.

Members, memberships, payments, receipts and SMS — built for how an Indian
neighbourhood gym actually runs: rupees, `dd/MM/yyyy` dates, DLT-compliant
SMS, and a front desk where someone is waiting while you type.

---

## Requirements

- **Node.js 20+** (`node -v`)
- **A Supabase project** (free tier is fine) — or any PostgreSQL 14+ database

No local PostgreSQL or Docker installation is needed.

## Setup

### 1. Install

```bash
npm install
```

### 2. Create the database

Sign in at [supabase.com](https://supabase.com) and create a project.
Choose the **Mumbai (ap-south-1)** region — it is the closest to Hyderabad,
and the round-trip latency is noticeable from a front desk.

Then open **Project Settings → Database → Connection string** and copy both:

| Supabase label | Port | Used for |
|---|---|---|
| Transaction pooler | 6543 | the running app |
| Direct connection | 5432 | migrations |

Prisma needs both. The pooler cannot run migrations, because it does not
support the prepared statements that DDL requires.

> Supabase is used **only as a PostgreSQL database**. Auth, Row Level Security
> and the Supabase client SDK are deliberately not used — this project has its
> own JWT auth, and running two auth systems side by side invites the kind of
> bug where a user is signed out of one and not the other. Everything stays
> portable to any Postgres host.

### 3. Configure

```bash
cp .env.example .env
```

Fill in `DATABASE_URL` and `DIRECT_URL` with the two strings above, then
generate the JWT secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Run it twice — `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must differ. The
server refuses to start if they match.

### 4. Create the schema and seed

```bash
npm run db:migrate     # create tables
npm run db:seed        # 200 demo members
```

### 5. Run

```bash
npm run dev
```

API on [localhost:4000](http://localhost:4000), web on
[localhost:5173](http://localhost:5173).

### Demo sign-in

Password for all seeded accounts: **`Password123`**

| Role | Email |
|---|---|
| Owner | `owner@atozfitness.in` |
| Manager | `manager@atozfitness.in` |
| Receptionist | `reception@atozfitness.in` |
| Trainer | `imran@atozfitness.in` |

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API + web, both watching |
| `npm run build` | Build everything |
| `npm test` | Run the test suite |
| `npm run typecheck` | Typecheck all workspaces |
| `npm run db:migrate` | Create/apply migrations |
| `npm run db:seed` | Reseed demo data (destructive) |
| `npm run db:studio` | Browse the database in Prisma Studio |
| `npm run db:reset` | Drop, recreate, reseed (destructive) |

---

## Project layout

```
packages/shared/     Types, Zod schemas, formatters — imported by BOTH sides
apps/api/            Express + Prisma backend
  src/modules/       Feature slices: auth, members, plans, payments, sms
  src/services/      SMS providers, photo storage, QR generation
  prisma/            Schema, migrations, seed
apps/web/            React + Vite frontend
docs/                Architecture, phases, security notes
```

`packages/shared` holds every Zod schema, imported by the API for request
validation *and* by the web app for form validation. One definition means the
form cannot drift out of step with what the server will accept.

Modules are sliced by feature rather than by layer: everything about payments
lives in one folder instead of being scattered across `controllers/`,
`services/` and `models/`.

---

## Configuration

### Tax

A to Z Fitness is **not currently GST registered**, so documents are issued as
plain receipts (`RCPT/2026-27/0001`) with no tax component.

The schema and the billing code are already GST-capable. On crossing the ₹20 lakh
threshold, set:

```env
GST_REGISTERED=true
GSTIN=36XXXXXXXXXXXZX
GST_RATE=18
```

Documents then become tax invoices (`INV/...`) with CGST + SGST split, using
SAC 999723. No code changes, no migration.

Receipt numbering continues through the change rather than restarting, which
is what an auditor expects to see.

### SMS

The default provider is `mock`: messages are written to the database and shown
in the UI, and **nothing is sent to a real phone**. It simulates latency and
failures, so the retry path and the failed-message queue get exercised during
normal development.

To go live with MSG91:

```env
SMS_PROVIDER=msg91
MSG91_AUTH_KEY=...
MSG91_TEMPLATE_WELCOME=...        # DLT-approved template ID
DLT_ENTITY_ID=...
```

Twilio and Fast2SMS adapters are included and switch the same way.

> **On DLT:** transactional SMS in India must match a template registered with
> the telecom regulator. Text that deviates from the approved template is
> dropped by the operator *with no error returned* — so the provider fails
> loudly at send time when a template ID is missing, rather than recording a
> success for a message nobody received.

### Payments

Razorpay is wired but inactive (`PAYMENT_PROVIDER=mock`). Add
`RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` and switch to `razorpay` when
ready.

---

## Notes for whoever works on this next

**Money is integer paise. Never floats.** `0.1 + 0.2 !== 0.3` in IEEE-754, and
a gym reconciling cash at closing time cannot absorb the drift. Rupees exist
only at the UI boundary, via `formatINR()`. Every monetary column is `Int`.

**Dates display as `dd/MM/yyyy`.** Not the US `MM/dd/yyyy`, which silently
misreads 05/09 as 5th September. A 30-day plan starting 01/09 expires 30/09
inclusive — the way staff and members actually count it.

**Membership prices are copied at purchase, not referenced.** When a plan's
price rises, existing members keep what they paid on their receipts.

**Member IDs and receipt numbers come from counter rows, not `MAX()+1`.**
Allocated by an atomic `UPDATE ... RETURNING` inside the enclosing
transaction, so two simultaneous registrations cannot collide — and a rollback
does not leave a gap in the sequence.

**SMS failures never roll back what triggered them.** The message row is
written *before* delivery is attempted, and the send happens after the
transaction commits. A gateway outage must not undo a registration the member
already paid for.

**Payment amounts are recomputed server-side.** The client never says what is
owed. `idempotencyKey` guards the real front-desk failure: a double-click
creating two receipts for one handover of cash.

More detail in [`docs/SECURITY-NOTES.md`](docs/SECURITY-NOTES.md) and
[`docs/PHASES.md`](docs/PHASES.md).

---

## Tests

```bash
npm test
```

Covers the two areas where a bug costs real money or loses messages:

- **Billing** — proration, discounts, refunds, partial payments, balance
  arithmetic. Includes a regression test for a rounding bug that shortchanged
  members by 20 paise on every mid-cycle upgrade.
- **SMS** — retry with exponential backoff, permanent-vs-transient error
  classification, the dead-letter queue, and segment counting. One test exists
  solely to catch a `₹` symbol entering a template: a single non-GSM-7
  character cuts the segment limit from 160 characters to 70 and silently
  doubles the per-message cost.
- **HTTP** — auth guards, validation shape, error contract.
