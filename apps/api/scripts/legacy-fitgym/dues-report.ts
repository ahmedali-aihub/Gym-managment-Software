/**
 * Members whose balance differs between the old dashboard and the receipts,
 * written to backups/dues-differences.csv for the owner to check with the
 * client.
 *
 * The import goes by the receipts. The old system also stores a balance on
 * each membership, and that is what its "Pending Balance" dashboard adds up;
 * on a couple of hundred memberships it disagrees with the receipts the same
 * system holds. Members whose paid-in-full status has no receipt behind it
 * are listed too, since their payment was recorded on the owner's say-so.
 *
 *   npx tsx scripts/legacy-fitgym/dues-report.ts
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { BACKUPS, loadLegacy } from './transform.js';

const rupees = (paise: number) => (paise / 100).toFixed(0);
const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const csv = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

const { members } = loadLegacy();
const rows: (string | number)[][] = [];
let oldTotal = 0;
let receiptTotal = 0;

for (const m of members) {
  const old = m.memberships.reduce((n, s) => n + s.oldBalancePaise, 0);
  const due = m.memberships.reduce((n, s) => n + s.duePaise, 0);
  const unreceipted = m.memberships.filter((s) => s.payments.some((p) => p.receiptNumber === null));
  if (old === due && unreceipted.length === 0) continue;

  oldTotal += old;
  receiptTotal += due;
  const reasons: string[] = [];
  if (old !== due) reasons.push('old balance differs from receipts');
  if (unreceipted.length) reasons.push('marked paid in old system, no receipt found; imported as paid');

  const details = m.memberships
    .filter((s) => s.oldBalancePaise !== s.duePaise || unreceipted.includes(s))
    .map((s) => {
      const paid = s.payments.reduce((n, p) => n + p.amountPaise, 0);
      return `${s.planName} ${day(s.startDate)} to ${day(s.endDate)} (${s.status}): price ${rupees(s.totalPaise)}, ` +
        `paid ${rupees(paid)}, old balance ${rupees(s.oldBalancePaise)}, by receipts ${rupees(s.duePaise)}`;
    })
    .join(' | ');

  rows.push([m.memberId, m.fullName, m.phone, rupees(old), rupees(due), rupees(due - old), reasons.join('; '), details]);
}

rows.sort((a, b) => Number(a[0]) - Number(b[0]));
const header = ['member_number', 'name', 'phone', 'old_dashboard_balance_rs', 'balance_by_receipts_rs',
  'difference_rs', 'reason', 'memberships'];
const out = path.join(BACKUPS, 'dues-differences.csv');
writeFileSync(out, [header, ...rows].map((r) => r.map(csv).join(',')).join('\n') + '\n');

console.log(`${rows.length} member(s) listed in ${out}`);
console.log(`  old dashboard total for them: ₹${rupees(oldTotal)}; by receipts: ₹${rupees(receiptTotal)}`);
