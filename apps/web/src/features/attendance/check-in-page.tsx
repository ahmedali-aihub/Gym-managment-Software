import {
  formatINR,
  formatTime,
  MEMBER_STATUS_LABELS,
  type MemberStatus,
} from '@azf/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  LogOut,
  QrCode,
  ScanLine,
  Users,
  XCircle,
} from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { EmptyState } from '@/components/common/states';
import { MemberAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { api, getErrorMessage } from '@/lib/api-client';
import { cn, timeAgo } from '@/lib/utils';

interface CheckInResult {
  attendance: { id: string; checkInAt: string };
  member: {
    id: string;
    memberId: string;
    fullName: string;
    photoUrl: string | null;
    status: MemberStatus;
  };
  membership: {
    planName: string;
    endDate: string;
    daysRemaining: number;
  } | null;
  balanceDuePaise: number;
  warnings: Array<{
    kind: 'EXPIRED' | 'EXPIRING' | 'DUES' | 'FROZEN' | 'ALREADY_IN';
    message: string;
  }>;
}

interface CurrentVisit {
  id: string;
  checkInAt: string;
  member: {
    id: string;
    memberId: string;
    fullName: string;
    photoUrl: string | null;
  };
}

/**
 * Check-in desk.
 *
 * Built for a hardware barcode scanner, which is how gyms actually do this:
 * the scanner types the QR contents and presses Enter. So the input stays
 * focused at all times and submits on Enter — no clicking, no mouse.
 *
 * The same field accepts a typed member ID, because passes get forgotten and
 * phones run out of battery.
 *
 * The result panel is deliberately large and colour-coded. A receptionist
 * glances at it while the member is still walking past; anything requiring
 * careful reading would be ignored.
 */
export function CheckInPage() {
  const queryClient = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [input, setInput] = React.useState('');
  const [result, setResult] = React.useState<CheckInResult | null>(null);

  const { data: current, isLoading } = useQuery({
    queryKey: ['attendance-current'],
    queryFn: async () => {
      const response = await api.get<{ data: CurrentVisit[] }>(
        '/attendance/current',
      );
      return response.data.data;
    },
    refetchInterval: 30_000,
  });

  const { data: stats } = useQuery({
    queryKey: ['attendance-today'],
    queryFn: async () => {
      const response = await api.get<{
        data: { total: number; currentlyIn: number };
      }>('/attendance/today');
      return response.data.data;
    },
    refetchInterval: 30_000,
  });

  const checkIn = useMutation({
    mutationFn: async (value: string) => {
      // A scanner emits the full AZF:MEMBER:... payload; a human types the
      // printed ID. Route on the prefix rather than asking the user which.
      const isQr = value.startsWith('AZF:MEMBER:');

      const response = await api.post<{ data: CheckInResult }>(
        '/attendance/check-in',
        isQr ? { qrPayload: value } : { memberId: value },
      );

      return response.data.data;
    },

    onSuccess: (data) => {
      setResult(data);
      setInput('');

      void queryClient.invalidateQueries({ queryKey: ['attendance-current'] });
      void queryClient.invalidateQueries({ queryKey: ['attendance-today'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });

      inputRef.current?.focus();
    },

    onError: (error) => {
      toast.error(getErrorMessage(error));
      setInput('');
      inputRef.current?.focus();
    },
  });

  const checkOut = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/attendance/${id}/check-out`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['attendance-current'] });
      void queryClient.invalidateQueries({ queryKey: ['attendance-today'] });
      toast.success('Checked out');
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  // Keep focus on the input. A scanner sends keystrokes to whatever is
  // focused, so losing focus means the scan goes nowhere.
  React.useEffect(() => {
    inputRef.current?.focus();

    const onWindowFocus = () => inputRef.current?.focus();
    window.addEventListener('focus', onWindowFocus);
    return () => window.removeEventListener('focus', onWindowFocus);
  }, []);

  // Clear the result after a while so the desk does not show a stale member.
  React.useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), 20_000);
    return () => clearTimeout(timer);
  }, [result]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = input.trim();
    if (value) checkIn.mutate(value);
  }

  const hasBlockingWarning = result?.warnings.some(
    (w) => w.kind === 'EXPIRED' || w.kind === 'FROZEN',
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-[28px]">
            Check-in
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Scan a member pass or type their ID
          </p>
        </div>

        <div className="flex gap-3">
          <MiniStat label="In the gym" value={stats?.currentlyIn} />
          <MiniStat label="Visits today" value={stats?.total} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* ── Scanner ─────────────────────────────────────────────────── */}
        <div className="space-y-5 lg:col-span-3">
          <Card>
            <CardContent className="pt-6">
              <form onSubmit={submit}>
                <Label htmlFor="scan" className="text-[13px]">
                  Member pass or ID
                </Label>

                <div className="mt-2 flex gap-2">
                  <Input
                    id="scan"
                    ref={inputRef}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Scan QR or type AZF-2026-0001"
                    icon={<ScanLine />}
                    autoComplete="off"
                    // Scanners emit characters fast; autocorrect on mobile
                    // would mangle the payload.
                    autoCorrect="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    className="font-mono"
                  />
                  <Button
                    type="submit"
                    loading={checkIn.isPending}
                    disabled={!input.trim()}
                  >
                    <QrCode />
                    <span className="hidden sm:inline">Check in</span>
                  </Button>
                </div>

                <p className="mt-2 text-[12px] text-muted-foreground">
                  The field stays focused, so a barcode scanner works without
                  clicking.
                </p>
              </form>
            </CardContent>
          </Card>

          {/* Result */}
          <AnimatePresence mode="wait">
            {result && (
              <motion.div
                key={result.attendance.id + result.attendance.checkInAt}
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                <Card
                  className={cn(
                    'border-2',
                    hasBlockingWarning
                      ? 'border-destructive/40'
                      : result.warnings.length > 0
                        ? 'border-warning/40'
                        : 'border-success/40',
                  )}
                >
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-4">
                      <MemberAvatar
                        name={result.member.fullName}
                        photoUrl={result.member.photoUrl}
                        className="size-16"
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-display text-xl font-semibold tracking-tight">
                            {result.member.fullName}
                          </h2>
                          <Badge
                            variant={
                              result.member.status === 'ACTIVE'
                                ? 'success'
                                : 'destructive'
                            }
                            size="sm"
                          >
                            {MEMBER_STATUS_LABELS[result.member.status]}
                          </Badge>
                        </div>

                        <p className="tabular mt-0.5 font-mono text-[13px] text-muted-foreground">
                          {result.member.memberId}
                        </p>

                        {result.membership && (
                          <p className="mt-1.5 text-[13px] text-muted-foreground">
                            {result.membership.planName} ·{' '}
                            {result.membership.daysRemaining >= 0
                              ? `${result.membership.daysRemaining} days left`
                              : 'Expired'}
                          </p>
                        )}
                      </div>

                      <div
                        className={cn(
                          'flex size-12 shrink-0 items-center justify-center rounded-full',
                          hasBlockingWarning
                            ? 'bg-destructive/10 text-destructive'
                            : result.warnings.length > 0
                              ? 'bg-warning/10 text-warning'
                              : 'bg-success/10 text-success',
                        )}
                      >
                        {hasBlockingWarning ? (
                          <XCircle className="size-6" />
                        ) : result.warnings.length > 0 ? (
                          <AlertTriangle className="size-6" />
                        ) : (
                          <CheckCircle2 className="size-6" />
                        )}
                      </div>
                    </div>

                    {result.warnings.length > 0 && (
                      <>
                        <Separator className="my-4" />
                        <div className="space-y-2">
                          {result.warnings.map((warning, index) => (
                            <div
                              key={index}
                              className={cn(
                                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px]',
                                warning.kind === 'EXPIRED' ||
                                  warning.kind === 'FROZEN'
                                  ? 'bg-destructive/[0.08] text-destructive'
                                  : 'bg-warning/[0.08] text-warning',
                              )}
                            >
                              <AlertTriangle className="size-3.5 shrink-0" />
                              {warning.message}
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/members/${result.member.id}`}>
                          View profile
                        </Link>
                      </Button>

                      {result.balanceDuePaise > 0 && (
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/members/${result.member.id}`}>
                            Collect{' '}
                            {formatINR(result.balanceDuePaise, {
                              showDecimals: false,
                            })}
                          </Link>
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Currently in ────────────────────────────────────────────── */}
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                In the gym now
              </h3>
              {current && current.length > 0 && (
                <Badge variant="success" size="sm">
                  {current.length}
                </Badge>
              )}
            </div>

            {isLoading ? (
              <div className="space-y-2.5">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="flex items-center gap-2.5">
                    <Skeleton className="size-9 rounded-full" />
                    <Skeleton className="h-4 flex-1" />
                  </div>
                ))}
              </div>
            ) : !current || current.length === 0 ? (
              <EmptyState
                icon={Users}
                title="Nobody checked in"
                description="Members appear here as they scan in."
                className="py-8"
              />
            ) : (
              <div className="max-h-[28rem] space-y-0.5 overflow-y-auto">
                {current.map((visit) => (
                  <div
                    key={visit.id}
                    className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-accent"
                  >
                    <MemberAvatar
                      name={visit.member.fullName}
                      photoUrl={visit.member.photoUrl}
                      className="size-9"
                      showStatus
                    />

                    <Link
                      to={`/members/${visit.member.id}`}
                      className="min-w-0 flex-1"
                    >
                      <p className="truncate text-[13px] font-medium">
                        {visit.member.fullName}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatTime(visit.checkInAt)} ·{' '}
                        {timeAgo(visit.checkInAt)}
                      </p>
                    </Link>

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => checkOut.mutate(visit.id)}
                      className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label={`Check out ${visit.member.fullName}`}
                      title="Check out"
                    >
                      <LogOut />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-2.5 text-center">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      {value === undefined ? (
        <Skeleton className="mx-auto mt-1 h-6 w-8" />
      ) : (
        <p className="tabular mt-0.5 font-display text-xl font-semibold">
          {value}
        </p>
      )}
    </div>
  );
}
