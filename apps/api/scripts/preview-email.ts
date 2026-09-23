/**
 * Render every email template to ./tmp/email-preview and open the folder.
 *
 * Deliberately talks to the TEMPLATES, not to emailService: the service
 * writes a log row first, which needs a database. This script exists so the
 * emails can be reviewed before Supabase is connected — the whole point is to
 * see the layout without any credentials at all.
 *
 *   npm run email:preview --workspace=apps/api
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  EMAIL_TEMPLATES,
  type EmailTemplateDefinition,
  renderEmailTemplate,
} from '@azf/shared';
import { gymConfig } from '../src/config/env.js';

const OUT_DIR = path.resolve('./tmp/email-preview');

/** Gym identity, exactly as emailService merges it in. */
const gym = {
  gymName: gymConfig.name,
  gymAddress: [gymConfig.addressLine1, gymConfig.addressLine2]
    .filter(Boolean)
    .join(', '),
  gymPhone: gymConfig.phone,
  gymEmail: gymConfig.email,
};

/**
 * Realistic sample values.
 *
 * A name with an ampersand and a long name are in here on purpose: those are
 * the two cases that break HTML templates, and a preview of only tidy data
 * proves nothing.
 */
const SAMPLES: Record<string, Record<string, string | number>> = {
  WELCOME: {
    ...gym,
    name: 'Aarav Yadav',
    memberId: 'AZF-2026-0201',
    plan: 'Quarterly',
    startDate: '21/09/2026',
    expiryDate: '20/12/2026',
    amount: '4,000',
  },
  RECEIPT: {
    ...gym,
    name: 'Priya Reddy & Family',
    memberId: 'AZF-2026-0182',
    receiptNo: 'AZF/2026-27/0043',
    paidDate: '21/09/2026',
    mode: 'UPI',
    amount: '7,000',
    balance: '0',
  },
  EXPIRY_REMINDER: {
    ...gym,
    name: 'Mohammed Sohail Ahmed',
    memberId: 'AZF-2026-0117',
    expiryDate: '28/09/2026',
    days: 7,
  },
  PAYMENT_DUE: {
    ...gym,
    name: 'Ramesh Goud',
    memberId: 'AZF-2026-0016',
    amount: '500',
  },
};

/** An index page, so all four can be compared side by side. */
function buildIndex(
  rendered: Array<{ key: string; file: string; subject: string }>,
): string {
  const rows = rendered
    .map(
      (r) => `<li style="margin-bottom:14px;">
  <a href="./${r.file}" style="font-size:16px;font-weight:600;color:#96631f;text-decoration:none;">${r.key}</a>
  <div style="font-size:13px;color:#6f6963;margin-top:2px;">Subject: ${r.subject}</div>
</li>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Email previews</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#faf8f5;margin:0;padding:40px 24px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e7e1d8;border-radius:12px;padding:28px;">
<h1 style="margin:0 0 6px;font-size:22px;color:#2b2926;">Email previews</h1>
<p style="margin:0 0 20px;font-size:14px;color:#6f6963;">
Sample data. Nothing was sent — these are the files the mock provider writes.
</p>
<ul style="list-style:none;padding:0;margin:0;">
${rows}
</ul>
</div>
</body></html>`;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  const rendered: Array<{ key: string; file: string; subject: string }> = [];

  for (const template of Object.values(
    EMAIL_TEMPLATES,
  ) as EmailTemplateDefinition[]) {
    const variables = SAMPLES[template.key] ?? gym;

    const subject = renderEmailTemplate(template.subject, variables, false);
    const html = renderEmailTemplate(template.body, variables);
    const text = renderEmailTemplate(template.text, variables, false);

    // A placeholder that survives rendering would reach a real member as a
    // literal "{{memberId}}" — loud here rather than silent in an inbox.
    const leftover = html.match(/\{\{\w+\}\}/g);
    if (leftover) {
      console.warn(
        `  WARNING  ${template.key} has unsubstituted: ${leftover.join(', ')}`,
      );
    }

    const file = `${template.key.toLowerCase()}.html`;
    await writeFile(path.join(OUT_DIR, file), html, 'utf8');
    await writeFile(
      path.join(OUT_DIR, `${template.key.toLowerCase()}.txt`),
      `Subject: ${subject}\n\n${text}`,
      'utf8',
    );

    rendered.push({ key: template.key, file, subject });
    console.log(`  ${template.key.padEnd(16)} -> ${file}`);
    console.log(`  ${''.padEnd(16)}    Subject: ${subject}`);
  }

  await writeFile(
    path.join(OUT_DIR, 'index.html'),
    buildIndex(rendered),
    'utf8',
  );

  console.log(`\n  ${rendered.length} templates written to:`);
  console.log(`  ${OUT_DIR}`);
  console.log(`\n  Open this in a browser:`);
  console.log(`  ${path.join(OUT_DIR, 'index.html')}\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
