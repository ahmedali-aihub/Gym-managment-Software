-- Force a password change on next login.
--
-- Added because every staff account's password hash was publicly readable
-- while Row-Level Security was disabled on every table (see the previous
-- migration and docs/SECURITY-NOTES.md). bcrypt hashes are crackable
-- offline given enough time, so rotation is not optional — the app layer
-- sets this true for all eight existing accounts as part of this fix.

ALTER TABLE "public"."users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
