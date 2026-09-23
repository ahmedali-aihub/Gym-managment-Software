import { useTheme } from '@/hooks/use-theme';
import {
  CHART_ACCENTS,
  useChartAccent,
  type ChartAccent,
} from '@/hooks/use-chart-accent';
import { SegmentedControl } from '@/components/common/segmented-control';

/**
 * Chart accent switcher.
 *
 * A segmented control rather than a dropdown: there are two options, the
 * swatches show the result directly, and hiding a binary choice behind a
 * menu costs a click for nothing.
 *
 * The swatch renders in the CURRENT mode's step, so the button previews what
 * you will actually get — the dark palette is re-stepped for its surface,
 * not an automatic flip of the light one.
 */
export function AccentSwitcher({ className }: { className?: string }) {
  const { accent, setAccent } = useChartAccent();
  const { resolvedTheme } = useTheme();

  const options = CHART_ACCENTS.map((option) => {
    const colour =
      resolvedTheme === 'dark' ? option.swatch.dark : option.swatch.light;

    return {
      value: option.key,
      label: option.label,
      // The swatch rides in the icon slot so it travels with the label, and
      // keeps its own colour rather than inheriting the segment's text.
      icon: () => (
        <span
          className="size-3 rounded-full ring-1 ring-inset ring-foreground/20"
          style={{ backgroundColor: colour }}
        />
      ),
    };
  });

  return (
    <SegmentedControl
      options={options}
      value={accent}
      onChange={(next) => setAccent(next as ChartAccent)}
      ariaLabel="Chart colour"
      size="sm"
      className={className}
    />
  );
}
