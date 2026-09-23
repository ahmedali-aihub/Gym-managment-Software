# Handover checklist

Moving A to Z Fitness OS from the developer's Supabase account to the gym
owner's, with the live data.

Written for whoever performs the handover. Work top to bottom — the ordering
matters in two places, and both are called out.

---

## Before you start

**Take a backup of the source database.** Everything below is reversible only
if this exists.

```bash
pg_dump "$SOURCE_DIRECT_URL" -Fc --no-owner --no-privileges -f azf-full.dump
```

Use the **DIRECT_URL** (port 5432), not the pooler. The pooler cannot run the
statements `pg_dump` needs and fails partway through, leaving a dump file
that looks complete and is not.

Keep this file until the handover is confirmed working — not on the laptop
you are handing over.

---

## 1. The client creates their Supabase project

They create it, not you. It holds their members' names and phone numbers, so
it should sit under their billing and their control from the moment it
exists.

Ask them for:

- `DATABASE_URL` — Connection string → **Transaction pooler** (port 6543),
  which must end `?pgbouncer=true&connection_limit=1`
- `DIRECT_URL` — Connection string → **Direct connection** (port 5432)

Region: **ap-south-1 (Mumbai)** for a Hyderabad gym. A US region adds
roughly 250ms to every query for no benefit.

---

## 2. Create the tables in their project

```bash
# .env pointed at the CLIENT's project
npx prisma migrate deploy --workspace=apps/api
```

`migrate deploy`, not `migrate dev`. The latter can prompt to reset the
database, which on a client's project is the last thing you want.

Verify before continuing. `\dt` is a psql meta-command and will not run
through Prisma, so use plain SQL:

```bash
psql "$CLIENT_DIRECT_URL" -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1;"
```

Expect **19 tables**, including `audit_logs`, `email_logs`, `invoices`,
`member_sequences` and `invoice_sequences`.

Without psql installed, the Supabase dashboard's Table Editor shows the same
thing.

---

## 3. Move the data

```bash
pg_dump "$SOURCE_DIRECT_URL" --data-only --no-owner --no-privileges \
  -Fc -f azf-data.dump

pg_restore -d "$CLIENT_DIRECT_URL" --data-only --no-owner --no-privileges \
  --disable-triggers azf-data.dump
```

`--disable-triggers` matters: without it the restore fails on foreign keys,
because `pg_dump` does not order rows to satisfy them.

**Check the sequences afterwards.** Member IDs and receipt numbers come from
counter tables, not Postgres sequences, so they travel with the data — but
confirm it, because a reset counter would reissue numbers that already exist:

```sql
SELECT * FROM member_sequences;
SELECT * FROM invoice_sequences;
```

`lastSequence` must match the highest number actually in use.

---

## 4. Copy the member photos — THE EASY ONE TO FORGET

The database stores only a path (`/uploads/members/abc.jpg`). The image files
live on the server's disk and **a database transfer does not move them**.
Every member photo shows as broken until they are copied.

```bash
rsync -av apps/api/uploads/ user@new-server:/path/to/apps/api/uploads/
```

Verify by opening any member with a photo.

---

## 5. Rotate every secret

If the client's deployment keeps the developer's secrets, every token ever
issued still authenticates against their live system.

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Generate a **different** value for each:

- [ ] `JWT_ACCESS_SECRET`
- [ ] `JWT_REFRESH_SECRET`

Rotating these logs everyone out, which is the intended effect.

Also replace, if configured:

- [ ] `SMTP_PASSWORD` — must be the client's Gmail App Password, not the
      developer's
- [ ] `EMAIL_FROM_ADDRESS` — the gym's address, not the developer's
- [ ] `MSG91_AUTH_KEY` / `TWILIO_AUTH_TOKEN` / `FAST2SMS_API_KEY`
- [ ] `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`

---

## 6. Fix the accounts — DO THIS BEFORE THE CLIENT LOGS IN

The seed creates **EIGHT** accounts, every one sharing the password
`Password123`:

| Email | Role |
|---|---|
| owner@atozfitness.in | OWNER |
| manager@atozfitness.in | MANAGER |
| reception@atozfitness.in | RECEPTIONIST |
| imran@atozfitness.in | TRAINER |
| rakesh@atozfitness.in | TRAINER |
| swathi@atozfitness.in | TRAINER |
| vikram@atozfitness.in | TRAINER |
| deepika@atozfitness.in | TRAINER |

The five trainers are easy to miss — they are seeded as demo staff, but they
are real `User` rows with a real password, and each is a live login into the
client's member data.

List them all before deleting, so none is left behind:

```sql
SELECT email, role FROM users ORDER BY role;
```

1. [ ] Create the owner's real account with their own email and password
2. [ ] Log in as them and confirm OWNER access
3. [ ] **Delete** all eight seeded accounts — not deactivate
4. [ ] Delete the developer's own account
5. [ ] Create real staff accounts, each with their own password

Never leave a shared login. The audit trail records who changed what, and it
is worthless if three people use one account.

---

## 7. Turn off demo mode

In **`apps/web/.env.local`** (not the root `.env` — the web app reads its
own file):

```
VITE_DEMO_MODE=false
```

Rebuild afterwards. Vite inlines this at build time, so changing it without
rebuilding has no effect on a deployed site.

With it on, the app serves fixtures and writes nothing. The banner says so,
but check anyway — the failure looks like "the software forgets everything".

---

## 8. Set up backups

**The Supabase free tier has no automatic backups.** For a gym's only record
of who has paid, that is not a tenable position.

Either:

- **Upgrade to Pro** (~$25/month) for daily automatic backups, or
- **Schedule a `pg_dump`** to run daily and keep the output off-site

Whichever, restore one at least once before you call it done. An untested
backup is a hope, not a backup.

---

## 9. Verify, in this order

Against the client's live database:

1. [ ] Log in as the owner
2. [ ] Dashboard shows the real member counts
3. [ ] Open a member — photo loads, history shows
4. [ ] Register a test member → check `invoices` has an `RCPT/...` row and
       `audit_logs` has `MEMBER_REGISTERED`
5. [ ] Edit that member's phone → one audit row, containing only the phone
6. [ ] Take a payment → receipt number increments with no gap
7. [ ] Download the PDF report
8. [ ] **Delete the test member**
9. [ ] Welcome email arrives, if email is configured

Steps 4–6 are the paths that have never run against a real database. Do not
skip them.

---

## 10. Hand over

- [ ] Client has their Supabase login and knows they own the project
- [ ] Owner credentials handed over privately, not by email
- [ ] They know how to add staff accounts
- [ ] They know backups exist and where
- [ ] Developer access removed, or explicitly agreed as support

---

## Rolling back

If something is wrong after the switch, the source project is untouched:
point `.env` back at it and restart. Nothing in this procedure deletes from
the source.

That is only true while the source project still exists. **Keep it for at
least a month** after handover.
