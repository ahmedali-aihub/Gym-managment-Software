import { formatDateTime, formatPhone } from '@azf/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  MessageSquare,
  Phone,
  Save,
  UserPlus,
  XCircle,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { MemberAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator, Textarea } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, getErrorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  LEAD_STATUSES,
  SOURCE_LABELS,
  STATUS_LABELS,
  type LeadRow,
  type LeadStatus,
} from './leads-page';

const ACTIVITY_TYPES = [
  { value: 'CALL', label: 'Called' },
  { value: 'VISIT', label: 'Visited' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'SMS', label: 'SMS' },
  { value: 'NOTE', label: 'Note' },
] as const;

/**
 * Lead detail and follow-up.
 *
 * The primary action is logging what happened and setting the NEXT contact
 * date — those two together are what keeps a pipeline alive. Status changes
 * are secondary; a lead moves along because someone spoke to them, not
 * because a dropdown changed.
 */
export function LeadDetailDialog({
  lead,
  open,
  onOpenChange,
}: {
  lead: LeadRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [activityType, setActivityType] =
    React.useState<(typeof ACTIVITY_TYPES)[number]['value']>('CALL');
  const [summary, setSummary] = React.useState('');
  const [followUpAt, setFollowUpAt] = React.useState('');
  const [lostReason, setLostReason] = React.useState('');
  const [showLost, setShowLost] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;

    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 3);

    setActivityType('CALL');
    setSummary('');
    setFollowUpAt(nextWeek.toISOString().slice(0, 10));
    setLostReason('');
    setShowLost(false);
  }, [open, lead?.id]);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['leads'] });
    void queryClient.invalidateQueries({ queryKey: ['lead-stats'] });
  }

  const logActivity = useMutation({
    mutationFn: async () => {
      await api.post(`/leads/${lead!.id}/activity`, {
        type: activityType,
        summary,
        followUpAt: followUpAt || undefined,
      });
    },
    onSuccess: () => {
      invalidate();
      toast.success('Logged', {
        description: followUpAt
          ? 'Next follow-up scheduled.'
          : 'No follow-up date set.',
      });
      onOpenChange(false);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const changeStatus = useMutation({
    mutationFn: async (status: LeadStatus) => {
      await api.post(`/leads/${lead!.id}/status`, {
        status,
        followUpAt: followUpAt || undefined,
        lostReason: status === 'LOST' ? lostReason : undefined,
      });
    },
    onSuccess: (_result, status) => {
      invalidate();
      toast.success(`Moved to ${STATUS_LABELS[status].toLowerCase()}`);
      if (status === 'LOST' || status === 'CONVERTED') onOpenChange(false);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  if (!lead) return null;

  const isClosed = lead.status === 'CONVERTED' || lead.status === 'LOST';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <MemberAvatar name={lead.fullName} className="size-12" />
            <div className="min-w-0 flex-1">
              <DialogTitle>{lead.fullName}</DialogTitle>
              <DialogDescription className="mt-0.5">
                <a
                  href={`tel:+91${lead.phone}`}
                  className="hover:text-primary hover:underline"
                >
                  {formatPhone(lead.phone)}
                </a>
                {' · '}
                {SOURCE_LABELS[lead.source] ?? lead.source}
              </DialogDescription>
            </div>
            <Badge
              variant={lead.status === 'CONVERTED' ? 'success' : 'default'}
              size="sm"
            >
              {STATUS_LABELS[lead.status]}
            </Badge>
          </div>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          {/* Context */}
          {(lead.interestedIn ?? lead.quotedPlan ?? lead.notes) && (
            <div className="space-y-1.5 rounded-xl bg-muted/50 px-4 py-3 text-[13px]">
              {lead.interestedIn && (
                <p>
                  <span className="text-muted-foreground">Wants: </span>
                  {lead.interestedIn}
                </p>
              )}
              {lead.quotedPlan && (
                <p>
                  <span className="text-muted-foreground">Quoted: </span>
                  {lead.quotedPlan.name}
                </p>
              )}
              {lead.notes && (
                <p className="text-muted-foreground">{lead.notes}</p>
              )}
            </div>
          )}

          {lead.status === 'LOST' && lead.lostReason && (
            <div className="rounded-xl bg-destructive/[0.07] px-4 py-3">
              <p className="text-[12px] font-semibold text-destructive">
                Marked lost
              </p>
              <p className="mt-0.5 text-[13px] text-destructive/90">
                {lead.lostReason}
              </p>
            </div>
          )}

          {!isClosed && (
            <>
              {/* Log contact */}
              <div className="space-y-3">
                <Label className="text-[13px]">What happened?</Label>

                <div className="flex flex-wrap gap-1.5">
                  {ACTIVITY_TYPES.map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => setActivityType(type.value)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
                        activityType === type.value
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>

                <Textarea
                  rows={2}
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  placeholder="Said they will visit on Saturday…"
                />

                <div className="space-y-1.5">
                  <Label className="text-[13px]">Call back on</Label>
                  <Input
                    type="date"
                    value={followUpAt}
                    onChange={(event) => setFollowUpAt(event.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Leaving this blank removes them from the follow-up list.
                  </p>
                </div>

                <Button
                  onClick={() => logActivity.mutate()}
                  loading={logActivity.isPending}
                  disabled={!summary.trim()}
                  className="w-full"
                >
                  <Save />
                  Log and schedule
                </Button>
              </div>

              <Separator />

              {/* Move along the pipeline */}
              <div className="space-y-2">
                <Label className="text-[13px]">Move to</Label>
                <Select
                  value={lead.status}
                  onValueChange={(value) => {
                    if (value === 'LOST') {
                      setShowLost(true);
                      return;
                    }
                    changeStatus.mutate(value as LeadStatus);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_STATUSES.filter((s) => s !== 'CONVERTED').map(
                      (status) => (
                        <SelectItem key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>

              {showLost && (
                <div className="space-y-2 rounded-xl bg-destructive/[0.07] px-4 py-3">
                  <Label required className="text-[13px] text-destructive">
                    Why were they lost?
                  </Label>
                  <Input
                    value={lostReason}
                    onChange={(event) => setLostReason(event.target.value)}
                    placeholder="Too expensive, joined elsewhere…"
                  />
                  {/* Recording why matters: five leads lost to price is a
                      pricing problem, five lost to timing is not. */}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => changeStatus.mutate('LOST')}
                      loading={changeStatus.isPending}
                      disabled={!lostReason.trim()}
                    >
                      <XCircle />
                      Mark lost
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowLost(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* History */}
          {lead.activities.length > 0 && (
            <>
              <Separator />
              <div>
                <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  History
                </p>
                <div className="space-y-2.5">
                  {lead.activities.slice(0, 8).map((activity, index) => (
                    <div key={index} className="flex gap-2.5">
                      <div className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px]">{activity.summary}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatDateTime(activity.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="mt-5 sm:justify-between">
          <Button variant="ghost" size="sm" asChild>
            <a href={`tel:+91${lead.phone}`}>
              <Phone />
              Call
            </a>
          </Button>

          {!isClosed && (
            <Button
              size="sm"
              onClick={() => {
                // Registration is a separate flow; the lead is linked once
                // the member exists.
                onOpenChange(false);
                navigate('/members/new');
                toast.info('Register them as a member', {
                  description: `${lead.fullName} · ${formatPhone(lead.phone)}`,
                });
              }}
            >
              <UserPlus />
              Convert to member
            </Button>
          )}

          {lead.status === 'CONVERTED' && (
            <span className="flex items-center gap-1.5 text-[13px] text-success">
              <CheckCircle2 className="size-4" />
              Joined the gym
            </span>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { MessageSquare };
