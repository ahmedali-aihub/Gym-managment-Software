/**
 * Dry run of the FitGymSoftware import: prints the plan list, totals and
 * warnings, and writes a few complete sample members to
 * backups/fitgym/preview.json. Reads only the export; never the database.
 *
 *   npx tsx scripts/legacy-fitgym/preview.ts [oldMemberId ...]
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { BACKUPS, loadLegacy, type MemberRow } from './transform.js';

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

const { plans, members, stats } = loadLegacy();

console.log('PLANS');
for (const p of plans) {
  console.log(
    [
      p.isActive ? 'active  ' : 'inactive',
      p.name.padEnd(28),
      p.type.padEnd(11),
      `${p.durationDays}d`.padEnd(5),
      rupees(p.pricePaise).padEnd(8),
      `(${p.priceSource})`.padEnd(19),
      `sold ${p.timesSold}`.padEnd(10),
      p.firstSold ? `${p.firstSold} → ${p.lastSold}` : '',
    ].join(' '),
  );
}

console.log('\nTOTALS');
for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${k.endsWith('Paise') ? rupees(v) : v}`);

const warningCounts = new Map<string, number>();
for (const m of members)
  for (const w of m.warnings) {
    const kind = w.replace(/".*"/, '"…"');
    warningCounts.set(kind, (warningCounts.get(kind) ?? 0) + 1);
  }
console.log('\nWARNINGS');
for (const [w, n] of warningCounts) console.log(`  ${n} × ${w}`);

// Five members that between them exercise every mapping path, unless
// specific old IDs were asked for.
const requested = process.argv.slice(2);
const pick = (pred: (m: MemberRow) => boolean, taken: Set<string>) =>
  members.find((m) => !taken.has(m.memberId) && pred(m));
const samples: MemberRow[] = [];
if (requested.length) {
  samples.push(...members.filter((m) => requested.includes(m.memberId)));
} else {
  const taken = new Set<string>();
  const preds: ((m: MemberRow) => boolean)[] = [
    (m) => m.status === 'ACTIVE' && !!m.photoSourceUrl && m.memberships.length >= 4,
    (m) => m.memberships.some((s) => s.freezeStartDate),
    (m) => m.memberships.some((s) => s.duePaise > 0) && m.memberships.some((s) => s.discountPaise > 0),
    (m) => m.memberships.some((s) => s.planName.includes('GENERAL')) && m.memberships.some((s) => s.planName.startsWith('FITNESS')),
    (m) => m.dateOfBirth.getFullYear() > 1900 && !!m.emergencyContactPhone,
  ];
  for (const pred of preds) {
    const m = pick(pred, taken) ?? pick(() => true, taken);
    if (m) {
      samples.push(m);
      taken.add(m.memberId);
    }
  }
}

const out = path.join(BACKUPS, 'fitgym/preview.json');
writeFileSync(out, JSON.stringify({ stats, plans, samples }, null, 1));
console.log(`\nSamples (${samples.map((s) => '#' + s.memberId).join(', ')}) written to ${out}`);
