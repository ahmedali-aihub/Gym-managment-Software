-- Enable Row-Level Security on every table.
--
-- WHY THIS WAS URGENT. Supabase auto-generates a public REST API
-- (PostgREST) over every table in the public schema, reachable at
-- https://<project>.supabase.co/rest/v1/<table> using the anon key — the
-- same key that ships inside this app's own JavaScript bundle, visible to
-- any visitor's browser.
--
-- With RLS disabled, that API served every row with NO authentication at
-- all: full member records (name, phone, address, date of birth, emergency
-- contact), payment and invoice history, staff accounts including bcrypt
-- password hashes, and refresh-token records. Confirmed live before this
-- migration: a plain curl with only the public anon key returned real
-- member rows and a staff password hash.
--
-- WHY THIS DOES NOT BREAK THE APP. This application never talks to that
-- REST API. It connects straight to Postgres via Prisma, authenticated as
-- the `postgres` role, which carries rolbypassrls = true — confirmed
-- against the live database before writing this migration. Enabling RLS
-- with zero policies denies the `anon` and `authenticated` roles (which
-- PostgREST uses and which do NOT have that bypass) by default, while
-- leaving this app's own connection completely unaffected. No policies are
-- written on purpose: nothing should ever reach this data through
-- Supabase's public API, only through this API server.
--
-- _prisma_migrations is included. There is no reason Prisma's own
-- migration-history table should be world-readable either, and Prisma's
-- CLI connects as the same bypass-RLS role, so this changes nothing about
-- how migrations run.

ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."trainer_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."membership_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."invoice_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."member_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."sms_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."email_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."whatsapp_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."lead_activities" ENABLE ROW LEVEL SECURITY;

-- _prisma_migrations is deliberately NOT altered here. Prisma creates that
-- table itself outside of any migration file, before the first migration
-- ever runs — so a fresh environment's shadow database (used to validate
-- new migrations) does not have it yet at this point, and this statement
-- fails with "relation does not exist" the moment anyone tries to add
-- another migration. Production already has the table and was handled once,
-- by hand, directly — see docs/SECURITY-NOTES.md.
