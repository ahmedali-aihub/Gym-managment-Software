/**
 * Members the front desk should fix, written to backups/member-issues.csv.
 *
 * These are problems carried over from FitGymSoftware, not created by the
 * import: the records were imported as they were, so the gym can correct
 * them with the member present instead of us guessing.
 *
 * Missing dates of birth are deliberately not a row of their own: nine in
 * ten old members never had one, and listing them would bury the problems
 * that matter. They are counted in the summary and flagged in the notes.
 *
 *   npx tsx scripts/legacy-fitgym/member-issues.ts
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { BACKUPS, loadLegacy } from './transform.js';

const csv = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

const { members } = loadLegacy();

const byPhone = new Map<string, string[]>();
for (const m of members) {
  if (!m.phone) continue;
  byPhone.set(m.phone, [...(byPhone.get(m.phone) ?? []), m.memberId]);
}

const counts = new Map<string, number>();
const rows: (string | number)[][] = [];
for (const m of members) {
  const issues: string[] = [];
  if (!m.phone) issues.push('no phone number');
  else if (m.warnings.some((w) => w.includes('not a valid'))) issues.push('phone is not a valid 10-digit mobile');
  const sharing = (byPhone.get(m.phone) ?? []).filter((id) => id !== m.memberId);
  // Families share a number legitimately; listed so the desk can tell a
  // family from the same person registered twice.
  if (m.phone && sharing.length) issues.push(`phone shared with #${sharing.join(', #')}`);
  if (m.memberships.length === 0) issues.push('no memberships in old system');
  if (/\d/.test(m.fullName) || m.fullName.replace(/[^a-z]/gi, '').length < 3) issues.push('name looks wrong');
  const due = m.memberships.filter((s) => s.status === 'ACTIVE').reduce((n, s) => n + s.duePaise, 0);
  if (due > 0) issues.push(`active membership with ₹${due / 100} due`);
  if (issues.length === 0) continue;

  for (const i of issues) {
    const kind = i.replace(/#.*|₹\d+/g, '…');
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const latest = m.memberships.at(-1);
  rows.push([
    m.memberId, m.fullName, m.phone, m.status,
    latest ? `${latest.planName} until ${latest.endDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}` : '',
    m.dateOfBirth.getFullYear() === 1900 ? 'yes' : 'no',
    issues.join('; '),
  ]);
}

const header = ['member_number', 'name', 'phone_as_in_old_system', 'status', 'latest_membership', 'missing_dob', 'issues'];
const out = path.join(BACKUPS, 'member-issues.csv');
writeFileSync(out, [header, ...rows].map((r) => r.map(csv).join(',')).join('\n') + '\n');

console.log(`${rows.length} member(s) with issues written to ${out}`);
for (const [kind, n] of counts) console.log(`  ${n} × ${kind}`);
console.log(`  (${members.filter((m) => m.dateOfBirth.getFullYear() === 1900).length} members have no date of birth — not listed individually)`);
