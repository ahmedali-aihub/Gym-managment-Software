import { FITNESS_GOALS, FITNESS_GOAL_LABELS, type FitnessGoal } from '@azf/shared';
import {
  Activity,
  Dumbbell,
  Flame,
  HeartPulse,
  Sparkles,
  Stethoscope,
  Target,
  Trophy,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Training-focus filter.
 *
 * Icons rather than plain chips: a receptionist scanning for "who does
 * weight training" recognises a dumbbell faster than they read a word, and
 * the filter row stays compact enough not to push the member list below the
 * fold.
 *
 * Multi-select with OR semantics — picking Weight Loss and Cardio shows
 * members pursuing either, which is what planning a class actually needs.
 */

const GOAL_ICONS: Record<FitnessGoal, React.ComponentType<{ className?: string }>> = {
  WEIGHT_LOSS: Flame,
  MUSCLE_GAIN: Dumbbell,
  GENERAL_FITNESS: Activity,
  STRENGTH: Trophy,
  ENDURANCE: HeartPulse,
  FLEXIBILITY: Sparkles,
  SPORTS_TRAINING: Target,
  REHABILITATION: Stethoscope,
};

export function GoalFilter({
  selected,
  onChange,
  className,
}: {
  selected: FitnessGoal[];
  onChange: (goals: FitnessGoal[]) => void;
  className?: string;
}) {
  function toggle(goal: FitnessGoal) {
    onChange(
      selected.includes(goal)
        ? selected.filter((g) => g !== goal)
        : [...selected, goal],
    );
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="mr-0.5 text-[12px] font-medium text-muted-foreground">
        Focus
      </span>

      {FITNESS_GOALS.map((goal) => {
        const Icon = GOAL_ICONS[goal];
        const active = selected.includes(goal);

        return (
          <button
            key={goal}
            type="button"
            onClick={() => toggle(goal)}
            aria-pressed={active}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:border-ring/40 hover:text-foreground',
            )}
          >
            <Icon className="size-3" />
            {FITNESS_GOAL_LABELS[goal]}
          </button>
        );
      })}

      {selected.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange([])}
          className="h-7 px-2 text-[12px]"
        >
          <X className="size-3" />
          Clear
        </Button>
      )}
    </div>
  );
}

export { GOAL_ICONS };
