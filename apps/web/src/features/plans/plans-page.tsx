import { PLAN_TYPE_LABELS, formatINR, type PlanType } from '@azf/shared';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Check, Dumbbell, Plus, Snowflake, Users } from 'lucide-react';
import * as React from 'react';
import { EmptyState, ErrorState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { PlanEditorDialog, type EditablePlan } from './plan-editor-dialog';

interface Plan {
  id: string;
  name: string;
  description: string | null;
  type: PlanType;
  durationDays: number;
  pricePaise: number;
  joiningFeePaise: number;
  maxFreezeDays: number;
  features: string[];
  isActive: boolean;
}

interface Distribution {
  planId: string;
  planName: string;
  count: number;
}

/**
 * Plans.
 *
 * Presented as cards rather than a table: a plan is a product with a price
 * and a feature list, and staff choosing one at the desk read it the way a
 * customer would, not as a spreadsheet row.
 */
export function PlansPage() {
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<EditablePlan | null>(null);

  function openEditor(plan: EditablePlan | null) {
    setEditing(plan);
    setEditorOpen(true);
  }

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['plans'],
    queryFn: async () => {
      const response = await api.get<{ data: Plan[] }>('/plans/active');
      return response.data.data;
    },
  });

  const { data: distribution } = useQuery({
    queryKey: ['plan-distribution'],
    queryFn: async () => {
      const response = await api.get<{ data: Distribution[] }>(
        '/plans/distribution',
      );
      return response.data.data;
    },
    // Distribution is a nice-to-have; a failure must not blank the page.
    retry: false,
  });

  const memberCount = new Map(
    distribution?.map((d) => [d.planId, d.count]) ?? [],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-[28px]">
            Plans
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Membership plans offered at the gym
          </p>
        </div>

        <Button size="sm" onClick={() => openEditor(null)}>
          <Plus />
          New plan
        </Button>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-72 rounded-2xl" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <Card>
          <EmptyState
            icon={Dumbbell}
            title="No plans yet"
            description="Create your first membership plan to start registering members."
            action={
              <Button onClick={() => openEditor(null)}>
                <Plus />
                Create a plan
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((plan, index) => {
            const members = memberCount.get(plan.id) ?? 0;

            return (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.3,
                  delay: Math.min(index * 0.05, 0.3),
                }}
              >
                <Card className="flex h-full flex-col">
                  <CardContent className="flex flex-1 flex-col pt-6">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-display text-base font-semibold tracking-tight">
                          {plan.name}
                        </h3>
                        <Badge variant="secondary" size="sm" className="mt-1.5">
                          {PLAN_TYPE_LABELS[plan.type]}
                        </Badge>
                      </div>

                      {members > 0 && (
                        <div className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                          <Users className="size-3" />
                          <span className="tabular">{members}</span>
                        </div>
                      )}
                    </div>

                    <div className="mt-4">
                      <span className="tabular font-display text-[28px] font-semibold leading-none tracking-tight">
                        {formatINR(plan.pricePaise, { showDecimals: false })}
                      </span>
                      <span className="ml-1.5 text-sm text-muted-foreground">
                        / {plan.durationDays} days
                      </span>
                    </div>

                    {plan.joiningFeePaise > 0 && (
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        +{' '}
                        {formatINR(plan.joiningFeePaise, {
                          showDecimals: false,
                        })}{' '}
                        one-time joining fee
                      </p>
                    )}

                    {plan.description && (
                      <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                        {plan.description}
                      </p>
                    )}

                    <Separator className="my-4" />

                    <ul className="flex-1 space-y-2">
                      {plan.features.map((feature) => (
                        <li
                          key={feature}
                          className="flex items-start gap-2 text-[13px]"
                        >
                          <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                          <span className="text-muted-foreground">
                            {feature}
                          </span>
                        </li>
                      ))}
                    </ul>

                    {plan.maxFreezeDays > 0 && (
                      <div className="mt-4 flex items-center gap-1.5 rounded-lg bg-info/[0.08] px-2.5 py-1.5 text-[12px] text-info">
                        <Snowflake className="size-3.5" />
                        {plan.maxFreezeDays} freeze days included
                      </div>
                    )}

                    <div className="mt-5 flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => openEditor(plan)}
                      >
                        Edit
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      <PlanEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        plan={editing}
      />
    </div>
  );
}
