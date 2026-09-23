import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Upload,
  Users,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ErrorState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SegmentedControl } from '@/components/common/segmented-control';
import { api, getErrorMessage } from '@/lib/api-client';
import { parseCsv } from '@/lib/parse-csv';
import { cn } from '@/lib/utils';

/**
 * Import members from the gym's previous software.
 *
 * THREE STAGES, deliberately: choose a file, review what would happen, then
 * commit. Importing thousands of rows blind and discovering row 3,000 was
 * malformed means unpicking a half-finished import from a live database —
 * so nothing is written until the owner has seen the report.
 *
 * The CSV is parsed in the browser and posted as JSON. That avoids a file
 * upload entirely and makes the preview a single round trip.
 */

interface RowIssue {
  field: string;
  message: string;
  severity: 'warning' | 'error';
}

interface ParsedRow {
  rowNumber: number;
  severity: 'ok' | 'warning' | 'error';
  issues: RowIssue[];
  member: {
    fullName: string;
    phone: string;
    status: string;
    membershipEnd: string | null;
    incompleteFields: string[];
  } | null;
}

interface PreviewData {
  mapping: Record<string, string>;
  unmapped: string[];
  detectedDateOrder: 'day-first' | 'month-first' | 'ambiguous';
  appliedDateOrder: 'day-first' | 'month-first';
  summary: {
    total: number;
    ready: number;
    warnings: number;
    errors: number;
    duplicates: number;
    incomplete: number;
    activeAfterImport: number;
    expiredAfterImport: number;
  };
  duplicatesInFile: Array<{ phone: string; rowNumbers: number[] }>;
  alreadyInDatabase: string[];
  rows: ParsedRow[];
}

const FIELD_LABELS: Record<string, string> = {
  fullName: 'Name',
  phone: 'Phone',
  email: 'Email',
  dateOfBirth: 'Date of birth',
  gender: 'Gender',
  joinedAt: 'Joined',
  membershipEnd: 'Expiry',
  planName: 'Plan',
  notes: 'Notes',
};

export function ImportPage() {
  const navigate = useNavigate();

  const [file, setFile] = React.useState<File | null>(null);
  const [parsed, setParsed] = React.useState<{
    headers: string[];
    rows: Array<Record<string, string>>;
  } | null>(null);
  const [dateOrder, setDateOrder] = React.useState<'day-first' | 'month-first'>(
    'day-first',
  );
  const [preview, setPreview] = React.useState<PreviewData | null>(null);
  const [committed, setCommitted] = React.useState<{
    imported: number;
    skipped: number;
    failed: Array<{ rowNumber: number; reason: string }>;
  } | null>(null);

  const previewMutation = useMutation({
    mutationFn: async (order: 'day-first' | 'month-first') => {
      if (!parsed) throw new Error('No file loaded');
      const response = await api.post<{ data: PreviewData }>(
        '/import/preview',
        { headers: parsed.headers, rows: parsed.rows, dateOrder: order },
      );
      return response.data.data;
    },
    onSuccess: (data) => {
      setPreview(data);
      setDateOrder(data.appliedDateOrder);
    },
    onError: (error) =>
      toast.error('Could not read the file', {
        description: getErrorMessage(error),
      }),
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!parsed) throw new Error('No file loaded');
      const response = await api.post<{
        data: { imported: number; skipped: number; failed: Array<{ rowNumber: number; reason: string }> };
      }>('/import/commit', {
        headers: parsed.headers,
        rows: parsed.rows,
        dateOrder,
      });
      return response.data.data;
    },
    onSuccess: (data) => {
      setCommitted(data);
      toast.success(`${data.imported} members imported`);
    },
    onError: (error) =>
      toast.error('Import failed', { description: getErrorMessage(error) }),
  });

  async function handleFile(selected: File) {
    setFile(selected);
    setPreview(null);
    setCommitted(null);

    const text = await selected.text();
    const result = parseCsv(text);

    if (result.rows.length === 0) {
      toast.error('That file has no rows', {
        description: 'Check it is a CSV exported from the old software.',
      });
      return;
    }

    setParsed(result);
  }

  // Preview automatically once a file is read — the owner asked to import,
  // not to press a second button.
  React.useEffect(() => {
    if (parsed && !preview && !previewMutation.isPending) {
      previewMutation.mutate(dateOrder);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Import members
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bring members across from your previous software. Nothing is saved
          until you review and confirm.
        </p>
      </div>

      {/* ── 1. Choose a file ──────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-6">
          <label
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl',
              'border-2 border-dashed border-border px-6 py-10 text-center',
              'transition-colors hover:border-primary/50 hover:bg-muted/30',
            )}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => {
                const selected = event.target.files?.[0];
                if (selected) void handleFile(selected);
              }}
            />
            <FileSpreadsheet className="size-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">
                {file ? file.name : 'Choose a CSV file'}
              </p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {parsed
                  ? `${parsed.rows.length} rows, ${parsed.headers.length} columns`
                  : 'Export from the old system as CSV, then select it here'}
              </p>
            </div>
          </label>
        </CardContent>
      </Card>

      {previewMutation.isPending && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Reading {parsed?.rows.length} rows…
          </CardContent>
        </Card>
      )}

      {previewMutation.isError && (
        <ErrorState
          error={previewMutation.error}
          onRetry={() => previewMutation.mutate(dateOrder)}
        />
      )}

      {/* ── 2. Review ─────────────────────────────────────────────── */}
      {preview && !committed && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Rows in file" value={preview.summary.total} />
            <Stat
              label="Ready to import"
              value={preview.summary.ready + preview.summary.warnings}
              tone="success"
            />
            <Stat
              label="Cannot import"
              value={preview.summary.errors}
              tone={preview.summary.errors > 0 ? 'destructive' : 'default'}
            />
            <Stat
              label="Missing details"
              value={preview.summary.incomplete}
              tone={preview.summary.incomplete > 0 ? 'warning' : 'default'}
            />
          </div>

          {/* Date order — the single most dangerous setting here. */}
          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Date format</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {preview.detectedDateOrder === 'ambiguous'
                      ? 'Could not tell from this file — every date fits both readings. Please confirm.'
                      : `Detected ${preview.detectedDateOrder.replace('-', ' ')} from the dates in the file.`}
                  </p>
                </div>

                <SegmentedControl
                  options={[
                    { value: 'day-first', label: 'DD/MM/YYYY' },
                    { value: 'month-first', label: 'MM/DD/YYYY' },
                  ]}
                  value={dateOrder}
                  onChange={(next) => {
                    setDateOrder(next as typeof dateOrder);
                    previewMutation.mutate(next as typeof dateOrder);
                  }}
                  ariaLabel="Date format"
                  size="sm"
                />
              </div>

              {preview.detectedDateOrder === 'ambiguous' && (
                <p className="rounded-lg bg-warning/10 px-3 py-2 text-[12px] text-warning-foreground">
                  Getting this wrong shifts every membership expiry by months.
                  Check a member you know: does the date below look right?
                  {preview.rows.find((r) => r.member?.membershipEnd) && (
                    <span className="ml-1 font-medium">
                      {preview.rows.find((r) => r.member?.membershipEnd)!.member!.fullName}
                      {' expires '}
                      {new Date(
                        preview.rows.find((r) => r.member?.membershipEnd)!.member!
                          .membershipEnd!,
                      ).toLocaleDateString('en-IN')}
                    </span>
                  )}
                </p>
              )}
            </CardContent>
          </Card>

          {/* What the columns were matched to. */}
          <Card>
            <CardContent className="pt-6">
              <p className="mb-3 text-sm font-semibold">Columns matched</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(preview.mapping).map(([field, column]) => (
                  <span
                    key={field}
                    className="rounded-full border border-border px-2.5 py-1 text-[12px]"
                  >
                    <span className="text-muted-foreground">
                      {FIELD_LABELS[field] ?? field}
                    </span>
                    {' ← '}
                    <span className="font-medium">{column}</span>
                  </span>
                ))}
              </div>

              {preview.unmapped.length > 0 && (
                <p className="mt-3 text-[12px] text-muted-foreground">
                  Ignored: {preview.unmapped.join(', ')}
                </p>
              )}
            </CardContent>
          </Card>

          {/* After import — the honest picture. */}
          <Card>
            <CardContent className="pt-6">
              <p className="mb-3 text-sm font-semibold">After importing</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Row
                  label="Active members"
                  value={preview.summary.activeAfterImport}
                />
                <Row
                  label="Expired members"
                  value={preview.summary.expiredAfterImport}
                />
              </div>
              <p className="mt-3 text-[12px] text-muted-foreground">
                Members whose membership has already lapsed are imported as
                expired, so your dashboard shows the truth from day one.
              </p>
            </CardContent>
          </Card>

          {(preview.summary.errors > 0 ||
            preview.duplicatesInFile.length > 0 ||
            preview.alreadyInDatabase.length > 0) && (
            <Card>
              <CardContent className="space-y-3 pt-6">
                <p className="text-sm font-semibold">Needs your attention</p>

                {preview.summary.errors > 0 && (
                  <Problem
                    icon={AlertTriangle}
                    title={`${preview.summary.errors} rows cannot be imported`}
                    detail="Usually a missing name, or a landline instead of a mobile. These are skipped; the rest still import."
                  />
                )}

                {preview.duplicatesInFile.length > 0 && (
                  <Problem
                    icon={Users}
                    title={`${preview.duplicatesInFile.length} phone numbers appear more than once`}
                    detail="Families often share a number, so these are imported as separate members. Merge them later if they are duplicates."
                  />
                )}

                {preview.alreadyInDatabase.length > 0 && (
                  <Problem
                    icon={Users}
                    title={`${preview.alreadyInDatabase.length} phone numbers already exist here`}
                    detail="These will be added again as new members. Check them before importing if you have already entered some by hand."
                  />
                )}

                <div className="max-h-56 space-y-1.5 overflow-y-auto pt-1">
                  {preview.rows
                    .filter((r) => r.severity === 'error')
                    .slice(0, 50)
                    .map((r) => (
                      <div key={r.rowNumber} className="text-[12px]">
                        <span className="tabular text-muted-foreground">
                          Row {r.rowNumber}
                        </span>
                        {' — '}
                        {r.issues.map((i) => i.message).join('; ')}
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => commitMutation.mutate()}
              disabled={commitMutation.isPending}
            >
              <Upload />
              {commitMutation.isPending
                ? 'Importing…'
                : `Import ${preview.summary.ready + preview.summary.warnings} members`}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setFile(null);
                setParsed(null);
                setPreview(null);
              }}
            >
              Choose a different file
            </Button>
          </div>
        </>
      )}

      {/* ── 3. Done ───────────────────────────────────────────────── */}
      {committed && (
        <Card>
          <CardContent className="space-y-4 py-8 text-center">
            <CheckCircle2 className="mx-auto size-10 text-success" />
            <div>
              <p className="font-display text-xl font-semibold">
                {committed.imported} members imported
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {committed.skipped > 0 && `${committed.skipped} skipped. `}
                {committed.failed.length > 0
                  ? `${committed.failed.length} failed — see below.`
                  : 'Everything that could be imported was.'}
              </p>
            </div>

            {committed.failed.length > 0 && (
              <div className="mx-auto max-h-40 max-w-md space-y-1 overflow-y-auto text-left text-[12px]">
                {committed.failed.slice(0, 30).map((f) => (
                  <div key={f.rowNumber}>
                    Row {f.rowNumber}: {f.reason}
                  </div>
                ))}
              </div>
            )}

            <Button onClick={() => navigate('/members')}>
              <Users />
              View members
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'success' | 'warning' | 'destructive';
}) {
  const tones = {
    default: 'text-foreground',
    success: 'text-success',
    warning: 'text-warning',
    destructive: 'text-destructive',
  } as const;

  return (
    <Card className="p-4">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          'tabular mt-1 font-display text-2xl font-semibold',
          tones[tone],
        )}
      >
        {value}
      </p>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between rounded-lg bg-muted/40 px-3 py-2">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="tabular font-semibold">{value}</span>
    </div>
  );
}

function Problem({
  icon: Icon,
  title,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div>
        <p className="text-[13px] font-medium">{title}</p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
