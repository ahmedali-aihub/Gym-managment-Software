import { ROLE_LABELS, Role } from '@azf/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  CheckCircle2,
  MessageSquare,
  Receipt,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/auth-context';
import { api } from '@/lib/api-client';
import { isDemoMode } from '@/lib/demo-mode';
import { cn } from '@/lib/utils';

interface ProviderStatus {
  provider: string;
  ok: boolean;
  message: string;
}

/**
 * Settings.
 *
 * Read-only for now: it shows what the system is configured to do, which is
 * the question staff actually ask ("are SMS going out?", "do receipts have
 * GST on them?"). Editing these is a Phase 3 concern — showing wrong values
 * would be worse than showing none.
 */
export function SettingsPage() {
  const { user } = useAuth();

  const { data: sms, isLoading } = useQuery({
    queryKey: ['sms-provider'],
    queryFn: async () => {
      const response = await api.get<{ data: ProviderStatus }>('/sms/provider');
      return response.data.data;
    },
    retry: false,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-[28px]">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How this system is currently configured
        </p>
      </div>

      {/* Gym identity */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Building2 className="size-4 text-muted-foreground" />
            <CardTitle className="text-base">Gym</CardTitle>
          </div>
          <CardDescription>Printed on receipts and messages</CardDescription>
        </CardHeader>

        <CardContent>
          <dl className="space-y-3 text-sm">
            <Row label="Name" value="A to Z Fitness" />
            <Row label="Address" value="Mehdipatnam, Hyderabad, Telangana 500028" />
            <Row label="State code" value="36 (Telangana)" />
          </dl>
        </CardContent>
      </Card>

      {/* Tax */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Receipt className="size-4 text-muted-foreground" />
            <CardTitle className="text-base">Tax</CardTitle>
          </div>
          <CardDescription>
            Determines whether documents are receipts or tax invoices
          </CardDescription>
        </CardHeader>

        <CardContent>
          <dl className="space-y-3 text-sm">
            <Row
              label="GST registered"
              value={<Badge variant="secondary">No</Badge>}
            />
            <Row label="Document type" value="Receipt (RCPT/FY/NNNN)" />
            <Row label="Tax applied" value="None" />
          </dl>

          <Separator className="my-4" />

          <p className="text-[13px] leading-relaxed text-muted-foreground">
            A to Z Fitness is below the ₹20 lakh GST threshold, so documents
            are issued as plain receipts with no tax component. The schema is
            already GST-ready — when you cross the threshold, setting{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
              GST_REGISTERED=true
            </code>{' '}
            and adding a GSTIN switches these to tax invoices with CGST + SGST
            at 18%. No code change, no migration, and receipt numbering
            continues rather than restarting.
          </p>
        </CardContent>
      </Card>

      {/* SMS */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-4 text-muted-foreground" />
            <CardTitle className="text-base">SMS</CardTitle>
          </div>
          <CardDescription>
            Delivery provider and DLT configuration
          </CardDescription>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-3/4" />
            </div>
          ) : (
            <>
              <dl className="space-y-3 text-sm">
                <Row
                  label="Provider"
                  value={
                    <Badge variant={sms?.ok ? 'success' : 'warning'}>
                      {sms?.provider ?? (isDemoMode ? 'MOCK' : 'Unknown')}
                    </Badge>
                  }
                />
                <Row
                  label="Status"
                  value={
                    <span
                      className={cn(
                        'flex items-center gap-1.5',
                        sms?.ok ? 'text-success' : 'text-warning',
                      )}
                    >
                      {sms?.ok ? (
                        <CheckCircle2 className="size-3.5" />
                      ) : (
                        <XCircle className="size-3.5" />
                      )}
                      {sms?.ok ? 'Configured' : 'Needs attention'}
                    </span>
                  }
                />
              </dl>

              <Separator className="my-4" />

              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {sms?.message ??
                  'Messages are logged and visible in the UI, but nothing is delivered to real phones.'}
              </p>

              <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                Transactional SMS in India must match a DLT-approved template
                registered with the telecom regulator. Text that deviates is
                dropped by the operator with no error returned, so the system
                fails loudly at send time when a template ID is missing rather
                than recording a success for a message nobody received.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Access */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" />
            <CardTitle className="text-base">Your access</CardTitle>
          </div>
        </CardHeader>

        <CardContent>
          <dl className="space-y-3 text-sm">
            <Row label="Signed in as" value={user?.fullName ?? '—'} />
            <Row label="Email" value={user?.email ?? '—'} />
            <Row
              label="Role"
              value={
                <Badge variant="default">
                  {user ? ROLE_LABELS[user.role] : '—'}
                </Badge>
              }
            />
          </dl>

          <Separator className="my-4" />

          <div className="space-y-2 text-[13px]">
            <p className="font-medium">What each role can do</p>
            <ul className="space-y-1.5 text-muted-foreground">
              <li>
                <strong className="font-medium text-foreground">
                  {ROLE_LABELS[Role.OWNER]}
                </strong>{' '}
                — everything, including refunds and retiring plans
              </li>
              <li>
                <strong className="font-medium text-foreground">
                  {ROLE_LABELS[Role.MANAGER]}
                </strong>{' '}
                — members, payments, plans, reports and bulk messaging
              </li>
              <li>
                <strong className="font-medium text-foreground">
                  {ROLE_LABELS[Role.RECEPTIONIST]}
                </strong>{' '}
                — register members, take payments, send individual messages
              </li>
              <li>
                <strong className="font-medium text-foreground">
                  {ROLE_LABELS[Role.TRAINER]}
                </strong>{' '}
                — view assigned members and their progress
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
