import {
  Gender,
  INDIAN_MOBILE_PATTERN,
  MemberStatus,
  normalizePhone,
} from '@azf/shared';

/**
 * Parsing and validation for a legacy member import.
 *
 * Built BEFORE the real export arrived, against the rules the schema already
 * enforces. Column mapping is deliberately flexible because old gym software
 * names things unpredictably — "Mobile", "Phone No", "Contact" all mean the
 * same thing, and guessing wrong on 6,500 rows is not recoverable by hand.
 *
 * NOTHING HERE WRITES TO THE DATABASE. It turns a spreadsheet into a report
 * of what WOULD happen, so the whole import can be reviewed before a single
 * row is inserted. Importing blind and discovering row 3,000 was malformed
 * means unpicking a half-finished import from a live system.
 */

export interface RawRow {
  [column: string]: string | undefined;
}

export type RowSeverity = 'ok' | 'warning' | 'error';

export interface RowIssue {
  field: string;
  message: string;
  severity: 'warning' | 'error';
}

export interface ParsedMember {
  rowNumber: number;
  severity: RowSeverity;
  issues: RowIssue[];
  /** Null when the row cannot be imported at all. */
  member: {
    fullName: string;
    phone: string;
    email: string | null;
    dateOfBirth: Date | null;
    gender: Gender | null;
    joinedAt: Date | null;
    membershipEnd: Date | null;
    planName: string | null;
    status: MemberStatus;
    notes: string | null;
    /** Set when DOB or gender had to be guessed; drives the "incomplete" tag. */
    incompleteFields: string[];
  } | null;
}

/**
 * Column aliases, lower-cased and stripped of punctuation.
 *
 * Ordered by confidence: "date of birth" beats "dob" only because an exact
 * phrase is less likely to collide with something else in a wide export.
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  fullName: ['full name', 'name', 'member name', 'membername', 'customer name'],
  phone: ['phone', 'mobile', 'phone no', 'mobile no', 'contact', 'contact no', 'phone number', 'mobile number'],
  email: ['email', 'email id', 'e mail', 'email address'],
  dateOfBirth: ['date of birth', 'dob', 'birth date', 'birthdate'],
  gender: ['gender', 'sex'],
  joinedAt: ['joined', 'join date', 'joining date', 'date of joining', 'doj', 'registration date', 'start date'],
  membershipEnd: ['expiry', 'expiry date', 'end date', 'valid till', 'valid upto', 'expires', 'due date'],
  planName: ['plan', 'package', 'membership', 'membership type', 'plan name', 'scheme'],
  notes: ['notes', 'remarks', 'comment', 'comments'],
};

function canonical(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Map the file's headers onto our fields.
 *
 * Returned so the UI can SHOW the mapping before importing — a silent
 * mismatch that puts expiry dates into the joined-date column produces a
 * plausible-looking import that is entirely wrong.
 */
export function mapColumns(headers: string[]): {
  mapping: Record<string, string>;
  unmapped: string[];
} {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const match = headers.find(
      (header) => !used.has(header) && aliases.includes(canonical(header)),
    );
    if (match) {
      mapping[field] = match;
      used.add(match);
    }
  }

  return {
    mapping,
    unmapped: headers.filter((header) => !used.has(header)),
  };
}

/**
 * Parse a date from legacy software.
 *
 * DAY-FIRST, ALWAYS. "01/02/2024" is 1 February in India and 2 January in
 * the US, and every Indian gym system writes day-first. Getting this
 * backwards across 6,500 expiry dates would silently shift memberships by
 * months — wrong renewal reminders, wrong revenue, and no error to notice.
 *
 * Returns null rather than guessing when the value is unreadable; the caller
 * decides whether that is fatal for the row.
 */
export function parseLegacyDate(value: string | undefined): Date | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;

  // ISO (yyyy-mm-dd) is unambiguous — take it as written.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) {
    return buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  // dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(text);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);

    // Two-digit years: 90 means 1990 (a birth date), 25 means 2025.
    if (year < 100) year += year > 50 ? 1900 : 2000;

    // The one case day-first cannot be right. A US-formatted file would put
    // the month first, and a value above 12 in the first position proves
    // this row at least is day-first — but if the FIRST number is <= 12 and
    // the SECOND is > 12, the file is month-first and the caller must know.
    if (day > 12 && month > 12) return null;

    return buildDate(year, month, day);
  }

  // "12 Jan 2024" / "12-Jan-24"
  const named = /^(\d{1,2})[\s\-]([A-Za-z]{3,})[\s\-](\d{2,4})$/.exec(text);
  if (named) {
    const month = MONTHS.indexOf(named[2]!.slice(0, 3).toLowerCase()) + 1;
    if (month === 0) return null;
    let year = Number(named[3]);
    if (year < 100) year += year > 50 ? 1900 : 2000;
    return buildDate(year, month, Number(named[1]));
  }

  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Local midnight, and null if the parts are not a real calendar date. */
function buildDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Local, not UTC: `new Date('2024-02-01')` is 05:30 IST on the 1st, which
  // shifts every date in the file back by half a day.
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null; // e.g. 31 February
  }
  return date;
}

/**
 * Detect whether the file is month-first rather than day-first.
 *
 * Scans the whole column: if ANY row has a first number above 12, the file
 * is day-first. If none do but some SECOND numbers exceed 12, it is
 * month-first and every date must be read the other way round.
 *
 * Worth doing over the whole file rather than per row, because a column of
 * dates that are all <= 12/12 is genuinely ambiguous and the answer has to
 * come from somewhere.
 */
export function detectDateOrder(
  values: Array<string | undefined>,
): 'day-first' | 'month-first' | 'ambiguous' {
  let firstOver12 = false;
  let secondOver12 = false;

  for (const value of values) {
    const match = /^(\d{1,2})[/\-.](\d{1,2})[/\-.]\d{2,4}$/.exec(
      (value ?? '').trim(),
    );
    if (!match) continue;
    if (Number(match[1]) > 12) firstOver12 = true;
    if (Number(match[2]) > 12) secondOver12 = true;
  }

  if (firstOver12 && !secondOver12) return 'day-first';
  if (secondOver12 && !firstOver12) return 'month-first';
  return 'ambiguous';
}

function parseGender(value: string | undefined): Gender | null {
  const text = (value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (['m', 'male', 'man'].includes(text)) return Gender.MALE;
  if (['f', 'female', 'woman'].includes(text)) return Gender.FEMALE;
  if (['o', 'other', 'others'].includes(text)) return Gender.OTHER;
  return null;
}

/**
 * A placeholder date of birth for records the old system never captured.
 *
 * 1 January 1900 is deliberately absurd: it can never be mistaken for a real
 * birth date, it sorts to the top of any "check these" list, and it keeps
 * the member out of birthday reminders. A plausible fake date would quietly
 * become permanent.
 */
export const PLACEHOLDER_DOB = new Date(1900, 0, 1);

export function parseRow(
  row: RawRow,
  mapping: Record<string, string>,
  rowNumber: number,
  options: { dateOrder?: 'day-first' | 'month-first' } = {},
): ParsedMember {
  const issues: RowIssue[] = [];
  const incompleteFields: string[] = [];

  const get = (field: string): string | undefined => {
    const column = mapping[field];
    return column ? row[column]?.trim() : undefined;
  };

  const readDate = (field: string): Date | null => {
    const raw = get(field);
    if (!raw) return null;

    // A month-first file is swapped before parsing, so the day-first parser
    // below stays the single implementation.
    if (options.dateOrder === 'month-first') {
      const parts = /^(\d{1,2})([/\-.])(\d{1,2})([/\-.])(\d{2,4})$/.exec(raw);
      if (parts) {
        return parseLegacyDate(`${parts[3]}${parts[2]}${parts[1]}${parts[4]}${parts[5]}`);
      }
    }
    return parseLegacyDate(raw);
  };

  // ── Name: the one field with no possible fallback ──────────────────
  const fullName = get('fullName');
  if (!fullName) {
    issues.push({
      field: 'fullName',
      message: 'No name — the row cannot be imported',
      severity: 'error',
    });
    return { rowNumber, severity: 'error', issues, member: null };
  }

  // ── Phone ──────────────────────────────────────────────────────────
  const rawPhone = get('phone') ?? '';
  const phone = normalizePhone(rawPhone);
  if (!rawPhone) {
    issues.push({
      field: 'phone',
      message: 'No phone number — cannot send reminders to this member',
      severity: 'error',
    });
  } else if (!INDIAN_MOBILE_PATTERN.test(phone)) {
    // The app's own pattern, not a length check. Indian mobiles start 6–9,
    // so a landline like "040 23456789" strips to ten digits and would pass
    // a naive length test — importing a member nobody can ever contact.
    issues.push({
      field: 'phone',
      message: `"${rawPhone}" is not a valid Indian mobile — possibly a landline`,
      severity: 'error',
    });
  }

  // ── Date of birth ──────────────────────────────────────────────────
  let dateOfBirth = readDate('dateOfBirth');
  if (!dateOfBirth) {
    if (get('dateOfBirth')) {
      issues.push({
        field: 'dateOfBirth',
        message: `Could not read "${get('dateOfBirth')}" as a date`,
        severity: 'warning',
      });
    }
    dateOfBirth = null;
    incompleteFields.push('dateOfBirth');
  } else if (dateOfBirth > new Date()) {
    issues.push({
      field: 'dateOfBirth',
      message: 'Date of birth is in the future',
      severity: 'warning',
    });
    dateOfBirth = null;
    incompleteFields.push('dateOfBirth');
  }

  // ── Gender ─────────────────────────────────────────────────────────
  const gender = parseGender(get('gender'));
  if (!gender) incompleteFields.push('gender');

  // ── Dates that drive renewals ──────────────────────────────────────
  const joinedAt = readDate('joinedAt');
  const membershipEnd = readDate('membershipEnd');

  if (get('membershipEnd') && !membershipEnd) {
    issues.push({
      field: 'membershipEnd',
      message: `Could not read expiry "${get('membershipEnd')}"`,
      severity: 'warning',
    });
  }

  if (joinedAt && membershipEnd && membershipEnd < joinedAt) {
    issues.push({
      field: 'membershipEnd',
      message: 'Expiry is before the joining date',
      severity: 'warning',
    });
  }

  // Status follows the expiry date, so the dashboard tells the truth from
  // day one rather than showing every historical member as active.
  const status: MemberStatus = membershipEnd
    ? membershipEnd >= startOfToday()
      ? MemberStatus.ACTIVE
      : MemberStatus.EXPIRED
    : MemberStatus.EXPIRED;

  if (!membershipEnd) {
    issues.push({
      field: 'membershipEnd',
      message: 'No expiry date — imported as expired, renew on next visit',
      severity: 'warning',
    });
  }

  const hasError = issues.some((issue) => issue.severity === 'error');
  const severity: RowSeverity = hasError
    ? 'error'
    : issues.length > 0
      ? 'warning'
      : 'ok';

  return {
    rowNumber,
    severity,
    issues,
    member: hasError
      ? null
      : {
          fullName,
          phone,
          email: get('email') || null,
          dateOfBirth,
          gender,
          joinedAt,
          membershipEnd,
          planName: get('planName') || null,
          status,
          notes: get('notes') || null,
          incompleteFields,
        },
  };
}

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Find rows that describe the same person.
 *
 * Phone is the key, because names are spelled inconsistently across years of
 * front-desk entry. Families genuinely DO share a number, so duplicates are
 * reported rather than dropped — the owner decides.
 */
export function findDuplicates(
  rows: ParsedMember[],
): Array<{ phone: string; rowNumbers: number[] }> {
  const byPhone = new Map<string, number[]>();

  for (const row of rows) {
    const phone = row.member?.phone;
    if (!phone || phone.length !== 10) continue;
    byPhone.set(phone, [...(byPhone.get(phone) ?? []), row.rowNumber]);
  }

  return [...byPhone.entries()]
    .filter(([, rowNumbers]) => rowNumbers.length > 1)
    .map(([phone, rowNumbers]) => ({ phone, rowNumbers }));
}

export interface ImportSummary {
  total: number;
  ready: number;
  warnings: number;
  errors: number;
  duplicates: number;
  incomplete: number;
  activeAfterImport: number;
  expiredAfterImport: number;
}

export function summarise(rows: ParsedMember[]): ImportSummary {
  const duplicates = findDuplicates(rows);

  return {
    total: rows.length,
    ready: rows.filter((r) => r.severity === 'ok').length,
    warnings: rows.filter((r) => r.severity === 'warning').length,
    errors: rows.filter((r) => r.severity === 'error').length,
    duplicates: duplicates.reduce(
      (sum, group) => sum + group.rowNumbers.length,
      0,
    ),
    incomplete: rows.filter(
      (r) => (r.member?.incompleteFields.length ?? 0) > 0,
    ).length,
    activeAfterImport: rows.filter(
      (r) => r.member?.status === MemberStatus.ACTIVE,
    ).length,
    expiredAfterImport: rows.filter(
      (r) => r.member?.status === MemberStatus.EXPIRED,
    ).length,
  };
}
