import { Role } from '@azf/shared';
import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../middleware/error.middleware.js';
import { actorFromRequest } from '../../services/audit/audit.service.js';
import { importService } from './import.service.js';
import {
  detectDateOrder,
  findDuplicates,
  mapColumns,
  parseRow,
  summarise,
  type ParsedMember,
  type RawRow,
} from './parse-import.js';

const router = Router();

// Importing thousands of members rewrites the gym's whole roster. Owner and
// manager only — this is not a front-desk action.
router.use(authenticate);
router.use(requireRole(Role.OWNER, Role.MANAGER));

/**
 * Preview an import WITHOUT writing anything.
 *
 * The browser parses the CSV and posts rows as JSON, so there is no file
 * upload and the preview returns in one round trip. The response is a report
 * of what WOULD happen — importing 6,500 rows blind and discovering row
 * 3,000 was malformed means unpicking a half-finished import from a live
 * database.
 */
router.post(
  '/preview',
  asyncHandler(async (req, res) => {
    const { headers, rows, dateOrder } = req.body as {
      headers: string[];
      rows: RawRow[];
      dateOrder?: 'day-first' | 'month-first';
    };

    const { mapping, unmapped } = mapColumns(headers ?? []);

    // Detected across the WHOLE column, not per row: a file where every
    // value fits both readings is genuinely ambiguous and the importer must
    // ask rather than guess.
    const dateColumn = mapping.membershipEnd ?? mapping.joinedAt;
    const detected = dateColumn
      ? detectDateOrder((rows ?? []).map((r) => r[dateColumn]))
      : 'ambiguous';

    const order = dateOrder ?? (detected === 'month-first' ? 'month-first' : 'day-first');

    const parsed: ParsedMember[] = (rows ?? []).map((row, index) =>
      // +2: row 1 is the header, and spreadsheets are 1-indexed, so this
      // matches what the owner sees in Excel.
      parseRow(row, mapping, index + 2, { dateOrder: order }),
    );

    const phones = parsed
      .map((p) => p.member?.phone)
      .filter((p): p is string => Boolean(p));
    const existingPhones = await importService.findExistingPhones(phones);

    res.json({
      success: true,
      data: {
        mapping,
        unmapped,
        detectedDateOrder: detected,
        appliedDateOrder: order,
        summary: summarise(parsed),
        duplicatesInFile: findDuplicates(parsed),
        alreadyInDatabase: existingPhones,
        rows: parsed,
      },
    });
  }),
);

/** Commit an import. Takes the same rows the preview reported on. */
router.post(
  '/commit',
  asyncHandler(async (req, res) => {
    const { headers, rows, dateOrder, skipRows } = req.body as {
      headers: string[];
      rows: RawRow[];
      dateOrder?: 'day-first' | 'month-first';
      skipRows?: number[];
    };

    const { mapping } = mapColumns(headers ?? []);
    const parsed: ParsedMember[] = (rows ?? []).map((row, index) =>
      parseRow(row, mapping, index + 2, {
        dateOrder: dateOrder ?? 'day-first',
      }),
    );

    const result = await importService.importMembers(parsed, {
      skipRows,
      actor: actorFromRequest(req),
      createdById: req.user?.sub ?? null,
    });

    res.json({ success: true, data: result });
  }),
);

export { router as importRoutes };
