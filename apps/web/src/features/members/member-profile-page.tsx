import {
  MEMBER_STATUS_LABELS,
  PAYMENT_MODE_LABELS,
  Role,
  formatDate,
  formatDateTime,
  formatINR,
  formatPhone,
  calculateAge,
  relativeExpiry,
  daysUntil,
  type MemberStatus,
  type PaymentMode,
} from '@azf/shared';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/auth-context';
import { isDemoMode } from '@/lib/demo-mode';
import { openPdf } from '@/lib/open-pdf';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  CalendarDays,
  CreditCard,
  Mail,
  MapPin,
  Send,
  Phone,
  History,
  QrCode,
  Receipt,
  RefreshCw,
  Snowflake,
  Sun,
  User,
  Wallet,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EmptyState, ErrorState } from '@/components/common/states';
import { MemberAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { RecordPaymentDialog } from '@/features/payments/record-payment-dialog';
import { api, getErrorMessage } from '@/lib/api-client';
import { FreezeDialog } from './member-dialogs';
import { NotifyDialog } from './notify-dialog';
import { RenewDialog, UnfreezeDialog } from './renew-dialog';
import { cn } from '@/lib/utils';

interface MemberProfile {
  id: string;
  memberId: string;
  fullName: string;
  phone: string;
  email: string | null;
  dateOfBirth: string;
  gender: string;
  photoUrl: string | null;
  addressLine1: string | null;
  city: string;
  pincode: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  goals: string[];
  medicalNotes: string | null;
  status: MemberStatus;
  joinedAt: string;
  qrDataUrl: string;
  balance: {
    totalBilledPaise: number;
    totalPaidPaise: number;
    balanceDuePaise: number;
  };
  memberships: Array<{
    id: string;
    startDate: string;
    endDate: string;
    status: string;
    totalPaise: number;
    plan: { name: string };
  }>;
  payments: Array<{
    id: string;
    amountPaise: number;
    mode: PaymentMode;
    paidAt: string;
    reference: string | null;
    invoice: { id: string; invoiceNumber: string } | null;
  }>;
  attendance: Array<{
    id: string;
    checkInAt: string;
    checkOutAt: string | null;
  }>;
}

const STATUS_VARIANTS: Record<
  MemberStatus,
  'success' | 'destructive' | 'info' | 'secondary'
> = {
  ACTIVE: 'success',
  EXPIRED: 'destructive',
  FROZEN: 'info',
  CANCELLED: 'secondary',
};

/**
 * Open a receipt PDF.
 *
 * Goes through `openPdf`, which fetches the bytes with the auth token
 * attached. A plain `window.open` opens a new document that carries no
 * Authorization header — the access token lives in memory by design — so
 * the route answered 401 and the tab showed raw JSON instead of a receipt.
 */
async function openReceipt(invoiceId: string): Promise<void> {
  if (isDemoMode) {
    toast.info('Receipt PDFs need the API running', {
      description: 'Connect a database and start the server to generate them.',
    });
    return;
  }

  try {
    await openPdf(`/invoices/${invoiceId}/pdf`);
  } catch (error) {
    toast.error('Could not open the receipt', {
      description: getErrorMessage(error),
    });
  }
}

export function MemberProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasRole } = useAuth();

  // Mirrors the API, which refuses /history to other roles.
  const canSeeHistory = hasRole(Role.OWNER, Role.MANAGER);

  const [paymentOpen, setPaymentOpen] = React.useState(false);
  const [freezeOpen, setFreezeOpen] = React.useState(false);
  const [smsOpen, setSmsOpen] = React.useState(false);
  const [renewOpen, setRenewOpen] = React.useState(false);
  const [unfreezeOpen, setUnfreezeOpen] = React.useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['member', id],
    queryFn: async () => {
      const response = await api.get<{ data: MemberProfile }>(`/members/${id}`);
      return response.data.data;
    },
    enabled: Boolean(id),
  });

  if (error) {
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }

  if (isLoading || !data) return <ProfileSkeleton />;

  const currentMembership = data.memberships.find(
    (m) => m.status === 'ACTIVE' || m.status === 'FROZEN',
  );

  const daysLeft = currentMembership ? daysUntil(currentMembership.endDate) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate('/members')}
          aria-label="Back to members"
        >
          <ArrowLeft />
        </Button>
        <h1 className="font-display text-xl font-semibold tracking-tight">
          Member profile
        </h1>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* ── Identity card ───────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col items-center text-center">
                <MemberAvatar
                  name={data.fullName}
                  photoUrl={data.photoUrl}
                  className="size-20"
                />

                <h2 className="mt-3 font-display text-lg font-semibold tracking-tight">
                  {data.fullName}
                </h2>

                <p className="tabular mt-0.5 font-mono text-[13px] text-muted-foreground">
                  {data.memberId}
                </p>

                <Badge
                  variant={STATUS_VARIANTS[data.status]}
                  dot
                  className="mt-2.5"
                >
                  {MEMBER_STATUS_LABELS[data.status]}
                </Badge>
              </div>

              <Separator className="my-5" />

              <dl className="space-y-3 text-[13px]">
                <InfoRow icon={Phone} label="Phone">
                  <a
                    href={`tel:+91${data.phone}`}
                    className="hover:text-primary hover:underline"
                  >
                    {formatPhone(data.phone)}
                  </a>
                </InfoRow>

                {data.email && (
                  <InfoRow icon={Mail} label="Email">
                    <span className="break-all">{data.email}</span>
                  </InfoRow>
                )}

                <InfoRow icon={User} label="Age">
                  {calculateAge(data.dateOfBirth)} years
                </InfoRow>

                <InfoRow icon={CalendarDays} label="Joined">
                  {formatDate(data.joinedAt)}
                </InfoRow>

                {data.addressLine1 && (
                  <InfoRow icon={MapPin} label="Address">
                    {data.addressLine1}
                    {data.pincode ? `, ${data.pincode}` : ''}
                  </InfoRow>
                )}
              </dl>

              {data.emergencyContactName && (
                <>
                  <Separator className="my-5" />
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Emergency contact
                    </p>
                    <p className="mt-1.5 text-[13px] font-medium">
                      {data.emergencyContactName}
                      {data.emergencyContactRelation && (
                        <span className="font-normal text-muted-foreground">
                          {' '}
                          · {data.emergencyContactRelation}
                        </span>
                      )}
                    </p>
                    {data.emergencyContactPhone && (
                      <p className="text-[13px] text-muted-foreground">
                        {formatPhone(data.emergencyContactPhone)}
                      </p>
                    )}
                  </div>
                </>
              )}

              {data.medicalNotes && (
                <>
                  <Separator className="my-5" />
                  <div className="rounded-lg bg-warning/[0.08] px-3 py-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-warning">
                      Medical notes
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-warning/90">
                      {data.medicalNotes}
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* ── Main column ─────────────────────────────────────────────── */}
        <div className="space-y-5 lg:col-span-2">
          {/* Status strip */}
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Current plan"
              value={currentMembership?.plan.name ?? 'None'}
              sub={
                currentMembership
                  ? relativeExpiry(currentMembership.endDate)
                  : 'No active membership'
              }
              tone={
                daysLeft !== null && daysLeft <= 7 ? 'warning' : 'default'
              }
            />
            <StatCard
              label="Total paid"
              value={formatINR(data.balance.totalPaidPaise, {
                showDecimals: false,
              })}
              sub={`of ${formatINR(data.balance.totalBilledPaise, {
                showDecimals: false,
              })} billed`}
              tone="success"
            />
            <StatCard
              label="Balance due"
              value={formatINR(data.balance.balanceDuePaise, {
                showDecimals: false,
              })}
              sub={
                data.balance.balanceDuePaise > 0
                  ? 'Outstanding'
                  : 'Fully settled'
              }
              tone={data.balance.balanceDuePaise > 0 ? 'destructive' : 'success'}
            />
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => setPaymentOpen(true)}
              disabled={data.balance.balanceDuePaise === 0}
              title={
                data.balance.balanceDuePaise === 0
                  ? 'This member has no outstanding balance'
                  : undefined
              }
            >
              <CreditCard />
              Record payment
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => setSmsOpen(true)}
            >
              <Send />
              Send reminder
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => setRenewOpen(true)}
            >
              <RefreshCw />
              Renew
            </Button>

            {currentMembership &&
              (currentMembership.status === 'FROZEN' ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setUnfreezeOpen(true)}
                >
                  <Sun />
                  Resume
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setFreezeOpen(true)}
                >
                  <Snowflake />
                  Freeze
                </Button>
              ))}
          </div>

          {/* Tabs */}
          <Tabs defaultValue="payments">
            <TabsList>
              <TabsTrigger value="payments">
                <Receipt />
                Payments
              </TabsTrigger>
              <TabsTrigger value="attendance">
                <CalendarDays />
                Attendance
              </TabsTrigger>
              <TabsTrigger value="pass">
                <QrCode />
                QR pass
              </TabsTrigger>
              {/* Management information, not something the front desk needs
                  while serving a queue — and the API refuses it for other
                  roles, so showing the tab would only produce an error. */}
              {canSeeHistory && (
                <TabsTrigger value="history">
                  <History />
                  History
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="payments">
              <Card>
                {data.payments.length === 0 ? (
                  <EmptyState
                    icon={Wallet}
                    title="No payments recorded"
                    description="Payments appear here once collected."
                    className="py-12"
                  />
                ) : (
                  <div className="divide-y divide-border">
                    {data.payments.map((payment) => (
                      <div
                        key={payment.id}
                        className="flex items-center gap-3 px-5 py-3.5"
                      >
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success/10">
                          <Receipt className="size-4 text-success" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">
                            {PAYMENT_MODE_LABELS[payment.mode]}
                            {payment.reference && (
                              <span className="font-normal text-muted-foreground">
                                {' '}
                                · {payment.reference}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatDateTime(payment.paidAt)}
                            {payment.invoice && (
                              <>
                                {' · '}
                                <button
                                  type="button"
                                  onClick={() =>
                                    void openReceipt(payment.invoice!.id)
                                  }
                                  className="underline underline-offset-2 transition-colors hover:text-primary"
                                >
                                  {payment.invoice.invoiceNumber}
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        <span className="tabular shrink-0 font-semibold text-success">
                          +{formatINR(payment.amountPaise, {
                            showDecimals: false,
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </TabsContent>

            <TabsContent value="attendance">
              <Card>
                {data.attendance.length === 0 ? (
                  <EmptyState
                    icon={CalendarDays}
                    title="No visits recorded"
                    description="Check-ins appear here as the member scans in."
                    className="py-12"
                  />
                ) : (
                  <div className="divide-y divide-border">
                    {data.attendance.slice(0, 20).map((visit) => (
                      <div
                        key={visit.id}
                        className="flex items-center gap-3 px-5 py-3"
                      >
                        <div className="size-2 shrink-0 rounded-full bg-primary" />
                        <div className="flex-1 text-sm">
                          {formatDateTime(visit.checkInAt)}
                        </div>
                        {visit.checkOutAt && (
                          <span className="text-xs text-muted-foreground">
                            {Math.round(
                              (new Date(visit.checkOutAt).getTime() -
                                new Date(visit.checkInAt).getTime()) /
                                60_000,
                            )}{' '}
                            min
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </TabsContent>

            <TabsContent value="pass">
              <Card>
                <CardContent className="flex flex-col items-center py-10">
                  {data.qrDataUrl ? (
                    <>
                      <div className="rounded-2xl border border-border bg-white p-4">
                        <img
                          src={data.qrDataUrl}
                          alt={`Check-in QR code for ${data.memberId}`}
                          className="size-48"
                        />
                      </div>
                      <p className="tabular mt-4 font-mono text-sm font-medium">
                        {data.memberId}
                      </p>
                      <p className="mt-1 max-w-xs text-center text-[12px] leading-relaxed text-muted-foreground">
                        Scan at the front desk to check in. Rotate the code if
                        the member's pass is ever shared.
                      </p>
                    </>
                  ) : (
                    <EmptyState
                      icon={QrCode}
                      title="No QR pass"
                      description="A pass is generated when the member is registered."
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {canSeeHistory && (
              <TabsContent value="history">
                <MemberHistory memberId={data.id} />
              </TabsContent>
            )}
          </Tabs>

          {/* Membership history */}
          <Card>
            <CardContent className="pt-6">
              <h3 className="mb-4 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                Membership history
              </h3>

              {data.memberships.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No memberships on record
                </p>
              ) : (
                <div className="space-y-3">
                  {data.memberships.map((membership) => (
                    <div
                      key={membership.id}
                      className="flex items-center gap-3 rounded-xl border border-border px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">
                          {membership.plan.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(membership.startDate)} –{' '}
                          {formatDate(membership.endDate)}
                        </div>
                      </div>

                      <span className="tabular text-sm font-medium">
                        {formatINR(membership.totalPaise, {
                          showDecimals: false,
                        })}
                      </span>

                      <Badge
                        variant={
                          membership.status === 'ACTIVE'
                            ? 'success'
                            : 'secondary'
                        }
                        size="sm"
                      >
                        {membership.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Dialogs */}
      <RecordPaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        member={data}
        balanceDuePaise={data.balance.balanceDuePaise}
      />

      <NotifyDialog
        open={smsOpen}
        onOpenChange={setSmsOpen}
        member={data}
        expiryDate={currentMembership?.endDate ?? null}
        balanceDuePaise={data.balance.balanceDuePaise}
      />

      <FreezeDialog
        open={freezeOpen}
        onOpenChange={setFreezeOpen}
        member={data}
        membershipId={currentMembership?.id ?? null}
        currentEndDate={currentMembership?.endDate ?? null}
        maxFreezeDays={30}
      />

      <RenewDialog
        open={renewOpen}
        onOpenChange={setRenewOpen}
        member={data}
        currentPlanId={null}
        currentEndDate={currentMembership?.endDate ?? null}
      />

      <UnfreezeDialog
        open={unfreezeOpen}
        onOpenChange={setUnfreezeOpen}
        member={data}
        membershipId={currentMembership?.id ?? null}
        freezeStartDate={null}
        currentEndDate={currentMembership?.endDate ?? null}
      />
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <dt className="sr-only">{label}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub: string;
  tone?: 'default' | 'success' | 'warning' | 'destructive';
}) {
  const toneStyles = {
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
          'tabular mt-1.5 font-display text-lg font-semibold tracking-tight',
          toneStyles[tone],
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
    </Card>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-6">
          <div className="flex flex-col items-center gap-3">
            <Skeleton className="size-20 rounded-full" />
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="mt-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </Card>

        <div className="space-y-5 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-11 w-64 rounded-xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

/**
 * Change history for one member.
 *
 * Reads the audit trail: who changed what, and when. Entries show ONLY the
 * fields that changed, because that is all the API stores — a whole-row
 * snapshot would make a phone correction look like forty edits.
 *
 * Fetched lazily by the tab rather than with the profile: most visits to a
 * member are to take a payment, not to investigate one, and the trail grows
 * without bound.
 */
interface AuditEntry {
  id: string;
  action: string;
  actorName: string | null;
  actorRole: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

const ACTION_LABELS: Record<string, string> = {
  MEMBER_REGISTERED: 'Registered',
  MEMBER_UPDATED: 'Details edited',
  MEMBER_DELETED: 'Removed',
  MEMBER_QR_ROTATED: 'QR pass reissued',
};

/** Turn a stored field name into something a gym owner would recognise. */
const FIELD_LABELS: Record<string, string> = {
  fullName: 'Name',
  phone: 'Phone',
  email: 'Email',
  dateOfBirth: 'Date of birth',
  gender: 'Gender',
  goals: 'Focus',
  medicalNotes: 'Medical notes',
  notes: 'Notes',
  trainerId: 'Trainer',
  addressLine1: 'Address',
  city: 'City',
  pincode: 'Pincode',
  emergencyContactName: 'Emergency contact',
  emergencyContactPhone: 'Emergency phone',
  status: 'Status',
  amountPaidPaise: 'Amount paid',
  totalPaise: 'Total',
  plan: 'Plan',
  memberId: 'Member ID',
};

/**
 * Render one audit value the way the rest of the app would show it.
 *
 * The field name decides the treatment: money is stored in paise and would
 * otherwise read as "100000" for ₹1,000, and a raw phone number is harder to
 * check against a screen than a spaced one.
 */
function formatAuditValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ') || '—';

  // Paise → rupees. The suffix is how the API names every money field.
  if (field.endsWith('Paise') && typeof value === 'number') {
    return formatINR(value, { showDecimals: false });
  }

  if (field.toLowerCase().includes('phone')) {
    return formatPhone(String(value));
  }

  if (typeof value === 'number') return String(value);

  const text = String(value);
  // ISO timestamps are stored as strings; show them the Indian way.
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return formatDate(text);
  return text;
}

function MemberHistory({ memberId }: { memberId: string }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['member-history', memberId],
    queryFn: async () => {
      const response = await api.get<{ data: AuditEntry[] }>(
        `/members/${memberId}/history`,
      );
      return response.data.data;
    },
  });

  if (error) {
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-xl" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={History}
          title="No changes recorded"
          description="Edits to this member will appear here with who made them."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <ol className="space-y-4">
          {data.map((entry) => {
            const changed = Object.keys(entry.after ?? {});

            return (
              <li
                key={entry.id}
                className="relative border-l border-border pl-4"
              >
                <span
                  className="absolute -left-[3px] top-1.5 size-1.5 rounded-full bg-primary"
                  aria-hidden
                />

                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="text-[13px] font-semibold">
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </p>
                  <p className="tabular text-[11px] text-muted-foreground">
                    {formatDateTime(entry.createdAt)}
                  </p>
                </div>

                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {entry.actorName ?? 'Unknown user'}
                  {entry.actorRole ? ` · ${entry.actorRole.toLowerCase()}` : ''}
                </p>

                {changed.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {changed.map((field) => (
                      <div
                        key={field}
                        className="flex flex-wrap items-baseline gap-x-2 text-[12px]"
                      >
                        <span className="text-muted-foreground">
                          {FIELD_LABELS[field] ?? field}
                        </span>
                        {/* The old value only exists on an edit; a
                            registration has nothing to compare against. */}
                        {entry.before && field in entry.before && (
                          <>
                            <span className="text-muted-foreground line-through">
                              {formatAuditValue(field, entry.before[field])}
                            </span>
                            <span className="text-muted-foreground">→</span>
                          </>
                        )}
                        <span className="font-medium">
                          {formatAuditValue(field, entry.after?.[field])}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
