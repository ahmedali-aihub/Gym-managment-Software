# Deployment

Getting A to Z Fitness OS onto a URL the gym owner can open from anywhere.

Two pieces deploy separately:

| Piece | What it is | Where it goes |
|---|---|---|
| `apps/web` | The React app | Vercel (static files + CDN) |
| `apps/api` | The Express server | Render (a long-running Node process) |

The database is already on Supabase and does not move.

**Why two hosts.** Vercel serves static files brilliantly and sleeps nothing,
but it runs serverless functions, not a persistent server — the background
workers (expiry sync, notification retries) need a process that stays alive.
Render gives that. Both have usable free tiers.

---

## Before you start

- A GitHub account with the repo pushed (already done)
- The Supabase connection strings from `.env`
- 30–40 minutes

**Free tiers sleep.** A Render free service shuts down after 15 minutes idle
and takes ~30 seconds to wake. Fine for a demo; not for a gym at 6am. See
*Going to production* at the end.

---

## 1. Deploy the API to Render

1. **render.com** → sign in with GitHub → **New** → **Web Service**
2. Connect `ahmedali-aihub/Gym-managment-Software`
3. Settings:

   | Field | Value |
   |---|---|
   | Name | `azf-api` |
   | Region | **Singapore** — closest to Hyderabad |
   | Branch | `main` |
   | Root Directory | *(leave blank — it is a monorepo)* |
   | Build Command | `npm install && npm run build --workspace=packages/shared && npx prisma generate --schema apps/api/prisma/schema.prisma && npm run build --workspace=apps/api` |
   | Start Command | `node apps/api/dist/server.js` |

   The build command looks long because order matters: `@azf/shared` must
   compile before the API imports it, and the Prisma client must be
   generated before the API can talk to the database.

4. **Environment** → add every variable from your local `.env`, with these
   changes:

   ```
   NODE_ENV=production
   PORT=10000                       # Render provides this; leave it
   WEB_BASE_URL=https://<your-vercel-url>   # fill in after step 2
   API_BASE_URL=https://azf-api.onrender.com
   ```

   Everything else — `DATABASE_URL`, `DIRECT_URL`, `JWT_*`, `SMTP_*`,
   `EMAIL_*`, `GYM_*` — copies across unchanged.

   **Generate NEW JWT secrets for production.** Reusing the development ones
   means any token ever issued locally works against the live system:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

5. **Create Web Service.** First build takes ~5 minutes.

6. Check the logs for:

   ```
   Database connected
   Email provider: smtp — connected to smtp.gmail.com
   A to Z Fitness API listening
   ```

---

## 2. Deploy the web app to Vercel

1. **vercel.com** → **Add New** → **Project** → import the same repo
2. Settings:

   | Field | Value |
   |---|---|
   | Framework Preset | **Vite** |
   | Root Directory | `apps/web` |
   | Build Command | `cd ../.. && npm install && npm run build --workspace=packages/shared && npm run build --workspace=apps/web` |
   | Output Directory | `dist` |

3. **Environment Variables**:

   ```
   VITE_DEMO_MODE=false
   VITE_API_URL=https://azf-api.onrender.com/api
   ```

   `VITE_DEMO_MODE=false` is not optional. With it on the app serves
   fixtures and writes nothing — the failure looks like "the software
   forgets everything".

   Vite inlines these AT BUILD TIME. Changing one later needs a redeploy,
   not just a restart.

4. **Deploy**, then copy the URL it gives you.

---

## 3. Close the loop

Back in Render → Environment → set `WEB_BASE_URL` to the Vercel URL, and
save. Render restarts automatically.

This is what the API's CORS check uses. Until it matches, every request
from the browser is rejected and the app looks broken with no obvious
reason.

---

## 4. Verify, in this order

Open the Vercel URL and work down. Stop at the first failure — each step
depends on the one before.

1. [ ] The login page loads (not a blank screen)
2. [ ] Log in as the owner
3. [ ] The dashboard shows real member counts, and **no demo-mode banner**
4. [ ] Open a member — the profile and history load
5. [ ] Register a test member → receipt number appears
6. [ ] The welcome email arrives with the PDF attached
7. [ ] Download the report PDF
8. [ ] **Delete the test member**

**A blank page** almost always means `VITE_API_URL` is wrong or missing.
Open the browser console: a CORS error means step 3 was skipped.

**Logged out after ~15 minutes** would mean the refresh cookie is not
crossing hosts. Two things make that work, and both are already in the
code: `sameSite: 'none'` in production (a browser sends a cookie cross-site
under no other value), and `secure: true`, which is why both hosts must be
HTTPS. Vercel and Render both are by default.

---

## Going to production

The free tiers are fine for showing the client. Before the gym depends on
it, three things change:

**Render Starter, ~$7/month.** The free service sleeps after 15 minutes
idle. A receptionist opening the app at 6am waits 30 seconds for it to
wake, every morning.

**Supabase Pro, ~$25/month.** The free tier has NO automatic backups. For a
gym's only record of who has paid, that is not a position to be in. See
`HANDOVER.md`.

**A custom domain.** `gym.atozfitness.in` rather than
`azf-web-xyz.vercel.app`. Both hosts add one free; it is a DNS record.

---

## Redeploying

Both hosts watch `main`. `git push` deploys automatically.

**A schema change needs a migration**, and neither host runs one for you:

```bash
# locally, pointed at the production database
npx prisma migrate deploy --workspace=apps/api
```

Run it BEFORE pushing code that depends on the new column, or the live API
will query a column that does not exist yet.
