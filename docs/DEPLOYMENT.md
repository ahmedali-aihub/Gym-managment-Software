# Deployment

One host, one push, no monthly fee.

| Piece | Where |
|---|---|
| The React app | Vercel — static files on a CDN |
| The API | Vercel — one serverless function at `/api/*` |
| The database | Supabase, already live |

Both halves come from the same repo and deploy together. `git push` ships
everything.

---

## Why there is still an API at all

The app talks to Supabase through a small server rather than directly from
the browser. Three things make that necessary, and none of them is a
preference:

**Secrets.** `SMTP_PASSWORD` and `WHATSAPP_ACCESS_TOKEN` would ship inside
the JavaScript bundle. Anyone who opened the site could read them and send
email as the gym — Google would suspend the account within days.

**Gap-free receipt numbers.** The sequence is allocated under a database row
lock, so two receptionists taking payment in the same second get `0007` and
`0008`. Read-then-write from two browsers gives both of them `0007`, and
you find out when the accountant asks which ₹4,000 is which.

**The audit trail.** An entry the client can choose not to write is not an
audit trail.

Everything else — reading members, filtering, charts — could run in the
browser. It goes through the same API because one code path is cheaper to
maintain than two.

---

## 1. Import the project

1. **vercel.com** → **Add New** → **Project**
2. Import `ahmedali-aihub/Gym-managment-Software`
3. Leave every build setting **as it is**. `vercel.json` in the repo root
   already sets the build command, the output directory and the `/api/*`
   routing.

---

## 2. Environment variables

Add these in **Settings → Environment Variables**. Copy the values from your
local `.env`.

```
NODE_ENV=production

DATABASE_URL=<Supabase transaction pooler, port 6543>
DIRECT_URL=<Supabase session pooler, port 5432>

SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key, NOT the anon key>

JWT_ACCESS_SECRET=<generate a NEW one>
JWT_REFRESH_SECRET=<generate a NEW one>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
BCRYPT_ROUNDS=12

EMAIL_PROVIDER=smtp
EMAIL_ENABLED=true
EMAIL_FROM_NAME=A to Z Fitness
EMAIL_FROM_ADDRESS=<your gmail>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<your gmail>
SMTP_PASSWORD=<16-char app password>

WHATSAPP_PROVIDER=mock
WHATSAPP_ENABLED=true

GYM_NAME=A to Z Fitness
GYM_ADDRESS_LINE1=Mehdipatnam
GYM_ADDRESS_LINE2=Hyderabad, Telangana 500028
GYM_PHONE=<gym phone>
GYM_EMAIL=<gym email>
GYM_STATE_CODE=36

CRON_SECRET=<generate one>
VITE_DEMO_MODE=false
```

**Generate fresh JWT secrets for production.** Reusing the development ones
means any token ever issued on your laptop authenticates against the live
system:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**`VITE_DEMO_MODE=false` is not optional.** With it on, the app serves
sample data and writes nothing. The failure looks like "the software forgets
everything".

**`VITE_API_URL` is deliberately NOT set.** The app and the API share an
origin here, so the default `/api` is correct. Setting it would point the
app at a host that does not exist.

---

## 3. Deploy

Press **Deploy**. First build takes 3–5 minutes.

---

## 4. Verify, in this order

Open the URL and work down. Stop at the first failure — each step depends on
the one before.

1. [ ] The login page loads, not a blank screen
2. [ ] Log in as the owner
3. [ ] The dashboard shows real member counts, and **no demo-mode banner**
4. [ ] Open a member — the profile and history load
5. [ ] Register a test member → a receipt number appears
6. [ ] **Register one with a photo, wait a minute, reload the profile** — the photo is still there. If it vanished, the Supabase keys are missing and it went to disk.
7. [ ] The welcome email arrives with the PDF attached
8. [ ] Download the report PDF
9. [ ] **Delete the test member**

**A blank page** usually means the build failed — check the Vercel build log.

**"Demo mode" banner showing** means `VITE_DEMO_MODE` was not set to
`false` before the build. Vite inlines it at BUILD time, so change it and
redeploy; a restart alone does nothing.

---

## Scheduled work

Two jobs run on Vercel Cron, configured in `vercel.json`:

| Job | When | Why |
|---|---|---|
| `/api/cron/sync-expiry` | Daily, 01:00 | Marks lapsed memberships expired. Without it, "active members" keeps counting everyone who lapsed overnight. |
| `/api/cron/retry-notifications` | Every 30 min | Retries failed emails and WhatsApp messages. |

Both refuse any request without `CRON_SECRET` as a bearer token — they are
public URLs, and an open retry endpoint is something to hammer.

**Vercel Cron needs a Pro plan.** On the free tier the endpoints exist but
nothing calls them: memberships stay marked active after they lapse, and
failed notifications are not retried. For a demo that is fine. Before the
gym relies on it, either upgrade or point a free scheduler
(cron-job.org) at those two URLs with the same bearer token.

---

## Member photos

Photos go to **Supabase Storage**, not the server's disk. This matters on
Vercel: a serverless function has no persistent filesystem, so a photo
written locally disappears when the instance recycles — usually within
minutes, showing a broken image with no error logged anywhere.

The bucket `member-photos` is created automatically at boot. Two variables
make it work, both in the list above:

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

**The service role key bypasses row-level security.** It is read only by the
server and must never be prefixed `VITE_` — that would bundle it into the
JavaScript sent to every browser.

With neither set, photos fall back to local disk. That is the development
path; on Vercel it loses photos silently.

**If you have photos from before this change**, move them across once:

```bash
npm run photos:migrate -w apps/api             # report what would move
npm run photos:migrate -w apps/api -- --commit # move them
```

It only touches photos still on disk, so running it twice is harmless.

---

## Redeploying

Vercel watches `main`. `git push` deploys.

**A schema change needs a migration first**, and Vercel does not run one:

```bash
# locally, pointed at the production database
npx prisma migrate deploy --workspace=apps/api
```

Run it BEFORE pushing code that uses the new column, or the live API queries
a column that does not exist.

---

## Going to production

The free tier is fine for showing the client. Before the gym depends on it:

**Supabase Pro, ~$25/month.** The free tier has NO automatic backups. For a
gym's only record of who has paid, that is not a position to be in.

**Vercel Pro, ~$20/month** — only if you want the cron jobs running on
Vercel. A free external scheduler does the same job.

**A custom domain.** `gym.atozfitness.in` rather than the Vercel URL. Free
on both; it is a DNS record.
