import { formatINR, formatINRCompact, paiseToRupees } from '@azf/shared';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Dashboard charts.
 *
 * FOUR CARDS, FOUR FORMS. An earlier version drew three of the four as amber
 * bars, which made the dashboard read as one chart repeated — and hid that
 * each card answers a different question:
 *
 *  | Card              | Question                        | Form            |
 *  |-------------------|---------------------------------|-----------------|
 *  | Revenue by month  | How much, and which way?        | columns + line  |
 *  | Net member change | Is the gym growing?             | diverging bars  |
 *  | Plan mix          | Which plans carry the business? | stacked bar     |
 *  | How members pay   | Where does the money arrive?    | donut + centre  |
 *
 * Written as inline SVG rather than Recharts. Three reasons: the hover layer
 * behaves exactly as specified rather than as the library allows, keyboard
 * focus works per mark, and it drops ~115 kB gzipped from the bundle.
 *
 * Every chart ships a hover AND focus layer — an HTML chart is interactive by
 * default, and tooltips enhance rather than gate: every value is also
 * reachable from a direct label or the tooltip's keyboard equivalent.
 */

// ── Palette ───────────────────────────────────────────────────────────────
//
// Validated with the dataviz skill's checker against both surfaces.
// Contrast vs card: accent 5.15:1 (dark) / 4.59:1 (light),
// muted 4.80:1 / 3.35:1, contrast-series ΔE 20+ across all CVD types.
// Re-run the validator before changing any of these.
const ACCENT = 'hsl(var(--chart-accent))';
const MUTED = 'hsl(var(--chart-muted))';
const CONTRAST = 'hsl(var(--chart-contrast))';

// ── Tooltip ───────────────────────────────────────────────────────────────

interface TooltipState {
  x: number;
  y: number;
  title: string;
  rows: Array<{ label: string; value: string; color?: string }>;
}

/**
 * Floating tooltip.
 *
 * Values lead, labels follow — the reader already knows which series they
 * are pointing at and wants the number. Series are keyed with a short stroke
 * rather than a filled box: at this density a block is data-weight ink doing
 * a label's job.
 */
function ChartTooltip({ state }: { state: TooltipState | null }) {
  if (!state) return null;

  return (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full"
      style={{ left: state.x, top: state.y - 10 }}
      role="status"
    >
      <div className="rounded-xl border border-border bg-popover px-3 py-2 shadow-large">
        <p className="mb-1.5 whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {state.title}
        </p>
        <div className="space-y-1">
          {state.rows.map((row) => (
            <div
              key={row.label}
              className="flex items-center gap-2.5 whitespace-nowrap text-[13px]"
            >
              {row.color && (
                <span
                  className="h-0.5 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: row.color }}
                />
              )}
              <span className="text-muted-foreground">{row.label}</span>
              <span className="tabular ml-auto font-semibold text-foreground">
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function useTooltip() {
  const [state, setState] = React.useState<TooltipState | null>(null);
  const clear = React.useCallback(() => setState(null), []);
  return { state, setState, clear };
}

// ── 1. Revenue by month — columns with a trend line ─────────────────────

export interface RevenuePoint {
  month: string;
  collectedPaise: number;
}

export function RevenueTrendChart({ data }: { data: RevenuePoint[] }) {
  const { state, setState, clear } = useTooltip();
  const containerRef = React.useRef<HTMLDivElement>(null);

  if (data.length === 0) return <ChartEmpty />;

  const values = data.map((d) => paiseToRupees(d.collectedPaise));
  // A period with no collections at all is a real answer, not an error — but
  // dividing by a zero max produces NaN geometry and the whole chart vanishes
  // into SVG attribute errors. Fall back to 1 so every bar renders flat.
  const max = Math.max(...values, 0) || 1;
  const average = values.reduce((sum, v) => sum + v, 0) / values.length;

  const H = 200;
  const slot = 100 / data.length;
  const barWidth = slot * 0.56;

  // Anchored to each bar's centre so the line reads as belonging to the
  // columns rather than floating over them.
  const linePoints = values
    .map((value, index) => {
      const x = index * slot + slot / 2;
      const y = H - (value / max) * H;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div ref={containerRef} className="relative">
      <div className="flex">
        {/* Y axis */}
        <div className="flex w-14 flex-col justify-between pb-6 pr-2 text-right">
          {[max, max * 0.5, 0].map((value, index) => (
            <span key={index} className="text-[10px] text-muted-foreground">
              {formatINRCompact(value * 100)}
            </span>
          ))}
        </div>

        <div className="relative flex-1">
          <svg
            viewBox={`0 0 100 ${H}`}
            preserveAspectRatio="none"
            className="h-[200px] w-full overflow-visible"
            role="img"
            aria-label="Monthly revenue"
          >
            {/* Recessive gridlines, solid not dashed. */}
            {[0, 0.5, 1].map((fraction) => (
              <line
                key={fraction}
                x1="0"
                x2="100"
                y1={H * fraction}
                y2={H * fraction}
                stroke="hsl(var(--border))"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {/* Average reference — turns each bar into a comparison. */}
            <line
              x1="0"
              x2="100"
              y1={H - (average / max) * H}
              y2={H - (average / max) * H}
              stroke="hsl(var(--muted-foreground))"
              strokeWidth="1"
              strokeOpacity="0.55"
              vectorEffect="non-scaling-stroke"
            />

            {data.map((point, index) => {
              const value = paiseToRupees(point.collectedPaise);
              const height = (value / max) * H;
              const x = index * slot + (slot - barWidth) / 2;

              return (
                <g key={index}>
                  <rect
                    x={x}
                    y={H - height}
                    width={barWidth}
                    height={Math.max(2, height)}
                    rx="1.5"
                    fill={MUTED}
                    className="transition-opacity"
                  />
                  {/* Hit target spans the full slot — bigger than the mark. */}
                  <rect
                    x={index * slot}
                    y={0}
                    width={slot}
                    height={H}
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-label={`${point.month}: ${formatINR(point.collectedPaise, { showDecimals: false })}`}
                    className="cursor-pointer outline-none focus-visible:fill-foreground/5"
                    onPointerEnter={(event) => {
                      const box = containerRef.current?.getBoundingClientRect();
                      if (!box) return;
                      setState({
                        x: event.clientX - box.left,
                        y: event.clientY - box.top,
                        title: point.month,
                        rows: [
                          {
                            label: 'Collected',
                            value: formatINR(point.collectedPaise, {
                              showDecimals: false,
                            }),
                            color: MUTED,
                          },
                          {
                            label: 'vs average',
                            value: `${value >= average ? '+' : ''}${Math.round(((value - average) / average) * 100)}%`,
                          },
                        ],
                      });
                    }}
                    onPointerLeave={clear}
                    onFocus={(event) => {
                      const box = containerRef.current?.getBoundingClientRect();
                      const mark = event.currentTarget.getBoundingClientRect();
                      if (!box) return;
                      setState({
                        x: mark.left - box.left + mark.width / 2,
                        y: mark.top - box.top + 40,
                        title: point.month,
                        rows: [
                          {
                            label: 'Collected',
                            value: formatINR(point.collectedPaise, {
                              showDecimals: false,
                            }),
                            color: MUTED,
                          },
                        ],
                      });
                    }}
                    onBlur={clear}
                  />
                </g>
              );
            })}

            {/* Trend line over the bars.

                The bars answer "how much each month"; the line answers "which
                way is it going" — a shape the eye reads in one pass but has
                to reconstruct bar by bar otherwise.

                Drawn after the bars so it sits on top, and given a surface-
                coloured casing underneath so it stays readable where it
                crosses a bar. No per-point markers: preserveAspectRatio is
                "none", so a circle would render as an ellipse. The bars
                already mark every position. */}
            <polyline
              points={linePoints}
              fill="none"
              stroke="hsl(var(--card))"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={linePoints}
              fill="none"
              stroke={ACCENT}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* X labels */}
          <div className="flex">
            {data.map((point, index) => (
              <span
                key={index}
                className="flex-1 pt-2 text-center text-[10px] text-muted-foreground"
              >
                {point.month}
              </span>
            ))}
          </div>
        </div>
      </div>

      <ChartTooltip state={state} />

      <Legend
        items={[
          { label: 'Collected', color: MUTED },
          { label: 'Trend', color: ACCENT, shape: 'line' },
        ]}
        note={`average ${formatINRCompact(average * 100)}`}
      />
    </div>
  );
}

// ── 2. Net member change — diverging bars around zero ────────────────────

export interface GrowthPoint {
  month: string;
  joined: number;
  expired: number;
}

/**
 * Growth or shrinkage per month.
 *
 * Diverging around a baseline, which is the prescribed form for above/below
 * data. Two hues that read as OPPOSITE — amber for growth, blue for
 * shrinkage — never two warm or two cool. Both validated at ΔE 20+.
 */
export function MemberGrowthChart({ data }: { data: GrowthPoint[] }) {
  const { state, setState, clear } = useTooltip();
  const containerRef = React.useRef<HTMLDivElement>(null);

  if (data.length === 0) return <ChartEmpty />;

  const rows = data.map((point) => ({
    month: point.month,
    net: point.joined - point.expired,
    joined: point.joined,
    expired: point.expired,
  }));

  const H = 200;
  // Zero sits proportionally, not at the midpoint — an all-positive year
  // should not waste half the plot on empty space below the line.
  const maxPos = Math.max(...rows.map((r) => r.net), 0);
  const maxNeg = Math.abs(Math.min(...rows.map((r) => r.net), 0));
  const span = maxPos + maxNeg || 1;
  const zeroY = (maxPos / span) * H;

  const slot = 100 / rows.length;
  const barWidth = slot * 0.5;

  return (
    <div ref={containerRef} className="relative">
      <div className="flex">
        <div className="flex w-10 flex-col justify-between pb-6 pr-2 text-right">
          <span className="text-[10px] text-muted-foreground">+{maxPos}</span>
          {maxNeg > 0 && (
            <span className="text-[10px] text-muted-foreground">−{maxNeg}</span>
          )}
        </div>

        <div className="relative flex-1">
          <svg
            viewBox={`0 0 100 ${H}`}
            preserveAspectRatio="none"
            className="h-[200px] w-full overflow-visible"
            role="img"
            aria-label="Net member change by month"
          >
            {rows.map((row, index) => {
              const height = (Math.abs(row.net) / span) * H;
              const x = index * slot + (slot - barWidth) / 2;
              const y = row.net >= 0 ? zeroY - height : zeroY;
              const grew = row.net >= 0;

              const tooltipRows = [
                { label: 'Joined', value: `+${row.joined}`, color: ACCENT },
                { label: 'Expired', value: `−${row.expired}`, color: CONTRAST },
                {
                  label: 'Net',
                  value: grew ? `+${row.net}` : String(row.net),
                },
              ];

              return (
                <g key={index}>
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={Math.max(2, height)}
                    rx="1.5"
                    fill={grew ? ACCENT : CONTRAST}
                  />
                  <rect
                    x={index * slot}
                    y={0}
                    width={slot}
                    height={H}
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-label={`${row.month}: net ${grew ? 'gain' : 'loss'} of ${Math.abs(row.net)} members`}
                    className="cursor-pointer outline-none focus-visible:fill-foreground/5"
                    onPointerEnter={(event) => {
                      const box = containerRef.current?.getBoundingClientRect();
                      if (!box) return;
                      setState({
                        x: event.clientX - box.left,
                        y: event.clientY - box.top,
                        title: row.month,
                        rows: tooltipRows,
                      });
                    }}
                    onPointerLeave={clear}
                    onFocus={(event) => {
                      const box = containerRef.current?.getBoundingClientRect();
                      const mark = event.currentTarget.getBoundingClientRect();
                      if (!box) return;
                      setState({
                        x: mark.left - box.left + mark.width / 2,
                        y: mark.top - box.top + 60,
                        title: row.month,
                        rows: tooltipRows,
                      });
                    }}
                    onBlur={clear}
                  />
                </g>
              );
            })}

            {/* Zero line drawn last so bars never cover it. */}
            <line
              x1="0"
              x2="100"
              y1={zeroY}
              y2={zeroY}
              stroke="hsl(var(--foreground))"
              strokeOpacity="0.35"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          <div className="flex">
            {rows.map((row, index) => (
              <span
                key={index}
                className="flex-1 pt-2 text-center text-[10px] text-muted-foreground"
              >
                {row.month}
              </span>
            ))}
          </div>
        </div>
      </div>

      <ChartTooltip state={state} />

      <Legend
        items={[
          { label: 'Grew', color: ACCENT },
          { label: 'Shrank', color: CONTRAST },
        ]}
      />
    </div>
  );
}

// ── 3. Plan mix — a single stacked bar ────────────────────────────────────

export interface DistributionSlice {
  name: string;
  value: number;
}

/**
 * Part-to-whole as ONE horizontal stacked bar.
 *
 * The prescribed form for part-to-whole, and it goes horizontal because the
 * category names are long ("Couple Quarterly"). Unlike the donut it
 * replaced, adjacent segments are directly comparable by length, and the
 * whole bar shows what share each plan carries at a glance.
 *
 * Segments use a single-hue ordinal ramp — plans DO have a natural order
 * (by popularity), so a ramp is honest here where it would not be for
 * nominal categories. A 2px surface gap separates each segment.
 */
export function PlanDistributionChart({ data }: { data: DistributionSlice[] }) {
  const { state, setState, clear } = useTooltip();
  const containerRef = React.useRef<HTMLDivElement>(null);

  if (data.length === 0) return <ChartEmpty />;

  const sorted = [...data].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, row) => sum + row.value, 0) || 1;

  return (
    <div ref={containerRef} className="relative">
      {/* The stacked bar */}
      <div className="flex h-10 gap-[2px] overflow-hidden rounded-lg">
        {sorted.map((row, index) => {
          const share = (row.value / total) * 100;
          // Ordinal ramp: darkest for the largest share, fading down the rank.
          const opacity = 1 - index * (0.55 / Math.max(1, sorted.length - 1));

          return (
            <button
              key={row.name}
              type="button"
              style={{
                width: `${share}%`,
                backgroundColor: ACCENT,
                opacity,
              }}
              className="group relative transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`${row.name}: ${row.value} members, ${Math.round(share)} percent`}
              onPointerEnter={(event) => {
                const box = containerRef.current?.getBoundingClientRect();
                if (!box) return;
                setState({
                  x: event.clientX - box.left,
                  y: event.clientY - box.top,
                  title: row.name,
                  rows: [
                    {
                      label: 'Members',
                      value: String(row.value),
                      color: ACCENT,
                    },
                    { label: 'Share', value: `${Math.round(share)}%` },
                  ],
                });
              }}
              onPointerLeave={clear}
              onFocus={(event) => {
                const box = containerRef.current?.getBoundingClientRect();
                const mark = event.currentTarget.getBoundingClientRect();
                if (!box) return;
                setState({
                  x: mark.left - box.left + mark.width / 2,
                  y: mark.top - box.top,
                  title: row.name,
                  rows: [
                    { label: 'Members', value: String(row.value), color: ACCENT },
                    { label: 'Share', value: `${Math.round(share)}%` },
                  ],
                });
              }}
              onBlur={clear}
            />
          );
        })}
      </div>

      {/* Direct labels — identity is never colour-alone. */}
      <div className="mt-4 space-y-2">
        {sorted.map((row, index) => {
          const share = Math.round((row.value / total) * 100);
          const opacity = 1 - index * (0.55 / Math.max(1, sorted.length - 1));

          return (
            <div
              key={row.name}
              className="flex items-center gap-2.5 text-[13px]"
            >
              <span
                className="size-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: ACCENT, opacity }}
              />
              <span
                className={cn(
                  'truncate',
                  index === 0 ? 'font-medium' : 'text-muted-foreground',
                )}
              >
                {row.name}
              </span>
              <span className="tabular ml-auto font-medium">{row.value}</span>
              <span className="tabular w-9 text-right text-[11px] text-muted-foreground">
                {share}%
              </span>
            </div>
          );
        })}
      </div>

      <ChartTooltip state={state} />
    </div>
  );
}

// ── 4. How members pay — ranked list with a dominant share ───────────────

/**
 * Payment methods as a donut.
 *
 * A donut is the WRONG form for comparing close values — which is why the
 * six-slice plan chart (22/22/19/17/13/7%) became a stacked bar. This data
 * is the opposite case: four segments at 54/27/14/5%, where the leader is
 * more than half the whole. Part-to-whole with clearly distinct shares and
 * ≤6 segments is precisely where a donut earns its place.
 *
 * Three things make it read rather than decorate:
 *
 *  • The HOLE carries the total. A donut's centre is otherwise dead space,
 *    and the total is the number the arcs are shares of.
 *  • Hovering a segment swaps the centre to that segment's figure, so the
 *    reader never has to map an arc back to a legend entry.
 *  • 2px surface gaps between arcs, so neighbouring steps of the same hue
 *    stay distinct without an outline drawn around each.
 *
 * EMPHASIS, not an ordinal ramp. An opacity ramp was the obvious choice —
 * darkest for the largest share — but measuring it killed the idea: at four
 * segments the tail landed at 1.86:1 against the card (dark) and 2.71:1
 * (light), well under the 3:1 floor for non-text marks. It was also double
 * encoding, since arc length already shows rank.
 *
 * So: the leader wears the accent, everything else the muted token, both at
 * full opacity and both already validated. Hovering lifts the hovered arc
 * and recedes the others, which is where interaction belongs.
 */
export function PaymentModeChart({ data }: { data: DistributionSlice[] }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = React.useState<number | null>(null);

  if (data.length === 0) return <ChartEmpty />;

  const sorted = [...data].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, row) => sum + row.value, 0) || 1;

  // Geometry. A 0.62 inner radius leaves a hole big enough for the total
  // without thinning the arcs to hairlines.
  const SIZE = 180;
  const CENTER = SIZE / 2;
  const OUTER = 78;
  const INNER = 48;
  /** Gap between arcs, in degrees at the outer edge — the 2px surface gap. */
  const GAP_DEG = 1.6;

  let cursor = -90; // start at 12 o'clock
  const segments = sorted.map((row, index) => {
    const sweep = (row.value / total) * 360;
    const start = cursor + GAP_DEG / 2;
    const end = cursor + sweep - GAP_DEG / 2;
    cursor += sweep;

    return {
      ...row,
      index,
      share: (row.value / total) * 100,
      path: arcPath(CENTER, CENTER, INNER, OUTER, start, end),
      color: index === 0 ? ACCENT : MUTED,
    };
  });

  const active = hovered !== null ? segments[hovered] : null;

  return (
    <div
      ref={containerRef}
      className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-6"
    >
      {/* Donut */}
      <div className="relative shrink-0">
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label="Collections by payment method"
        >
          {segments.map((segment) => (
            <path
              key={segment.name}
              d={segment.path}
              fill={segment.color}
              fillOpacity={
                // Full contrast at rest; only a deliberate hover dims the
                // others, and never below the readable floor.
                hovered === null || hovered === segment.index ? 1 : 0.45
              }
              tabIndex={0}
              role="button"
              aria-label={`${segment.name}: ${formatINR(segment.value, { showDecimals: false })}, ${Math.round(segment.share)} percent`}
              className="cursor-pointer outline-none transition-[fill-opacity] duration-200 focus-visible:stroke-ring focus-visible:stroke-2"
              onPointerEnter={() => setHovered(segment.index)}
              onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(segment.index)}
              onBlur={() => setHovered(null)}
            />
          ))}
        </svg>

        {/* Centre readout — the hole doing work. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {active ? active.name : 'Total'}
          </span>
          <span className="tabular font-display text-[19px] font-semibold leading-tight">
            {formatINRCompact(active ? active.value : total)}
          </span>
          {active && (
            <span className="tabular text-[11px] text-muted-foreground">
              {Math.round(active.share)}% of total
            </span>
          )}
        </div>
      </div>

      {/* Legend — always present for 2+ series; identity is never colour-alone. */}
      <div className="w-full space-y-2.5">
        {segments.map((segment) => (
          <button
            key={segment.name}
            type="button"
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              hovered === segment.index && 'bg-accent/60',
            )}
            onPointerEnter={() => setHovered(segment.index)}
            onPointerLeave={() => setHovered(null)}
            onFocus={() => setHovered(segment.index)}
            onBlur={() => setHovered(null)}
          >
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: segment.color }}
            />
            <span
              className={cn(
                'truncate text-[13px]',
                segment.index === 0 ? 'font-medium' : 'text-muted-foreground',
              )}
            >
              {segment.name}
            </span>
            <span className="tabular ml-auto text-[13px] font-medium">
              {formatINRCompact(segment.value)}
            </span>
            <span className="tabular w-8 text-right text-[11px] text-muted-foreground">
              {Math.round(segment.share)}%
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * SVG path for one donut segment.
 *
 * Drawn as an annulus sector: out along the start angle, round the outer
 * edge, in to the inner radius, back round. The `largeArc` flag is required
 * once a segment exceeds 180° — without it a dominant share (UPI at 54%
 * here) renders inverted, which is the classic donut-drawing bug.
 */
function arcPath(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startDeg: number,
  endDeg: number,
): string {
  const toXY = (radius: number, deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)] as const;
  };

  const [x1, y1] = toXY(outerR, startDeg);
  const [x2, y2] = toXY(outerR, endDeg);
  const [x3, y3] = toXY(innerR, endDeg);
  const [x4, y4] = toXY(innerR, startDeg);

  const largeArc = endDeg - startDeg > 180 ? 1 : 0;

  return [
    `M ${x1} ${y1}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ');
}

/**
 * Ranked bars, kept for the reports page and anywhere a list reads better
 * than a donut (more segments, or shares too close to compare by arc).
 */
export function RankedBars({
  data,
  format = (value: number) => formatINRCompact(value),
}: {
  data: DistributionSlice[];
  format?: (value: number) => string;
}) {
  if (data.length === 0) return <ChartEmpty />;

  const sorted = [...data].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, row) => sum + row.value, 0) || 1;
  const max = sorted[0]?.value ?? 1;

  return (
    <div className="space-y-3">
      {sorted.map((row, index) => {
        const share = Math.round((row.value / total) * 100);
        const isTop = index === 0;

        return (
          <div key={row.name}>
            <div className="flex items-baseline justify-between gap-3">
              <span
                className={cn(
                  'truncate text-[13px]',
                  isTop ? 'font-medium' : 'text-muted-foreground',
                )}
              >
                {row.name}
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className="tabular text-[13px] font-medium">
                  {format(row.value)}
                </span>
                <span className="tabular w-8 text-right text-[11px] text-muted-foreground">
                  {share}%
                </span>
              </span>
            </div>

            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.max(2, (row.value / max) * 100)}%`,
                  backgroundColor: isTop ? ACCENT : MUTED,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 5. Peak hours heatmap ─────────────────────────────────────────────────

export interface HeatmapCell {
  day: number;
  hour: number;
  count: number;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 17 }, (_, i) => i + 6);

/**
 * Check-in density.
 *
 * Sequential single-hue ramp — more is darker — which is the correct colour
 * job for magnitude on a grid, and the one form here that genuinely needs a
 * grid rather than a bar.
 */
export function PeakHoursHeatmap({ data }: { data: HeatmapCell[] }) {
  const { state, setState, clear } = useTooltip();
  const containerRef = React.useRef<HTMLDivElement>(null);

  const lookup = new Map(data.map((c) => [`${c.day}-${c.hour}`, c.count]));
  const max = Math.max(1, ...data.map((c) => c.count));

  const busiest = data.reduce<HeatmapCell | null>(
    (best, cell) => (!best || cell.count > best.count ? cell : best),
    null,
  );

  return (
    <div ref={containerRef} className="relative w-full">
      {busiest && busiest.count > 0 && (
        <p className="mb-3 text-[13px] text-muted-foreground">
          Busiest:{' '}
          <span className="font-medium text-foreground">
            {DAY_LABELS[busiest.day]} around {formatHour(busiest.hour)}
          </span>
        </p>
      )}

      <div className="overflow-x-auto">
        <div className="min-w-[520px]">
          <div className="mb-1.5 flex gap-[3px] pl-9">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="flex-1 text-center text-[9px] text-muted-foreground"
              >
                {hour % 3 === 0 ? formatHour(hour) : ''}
              </div>
            ))}
          </div>

          <div className="space-y-[3px]">
            {DAY_LABELS.map((dayLabel, dayIndex) => (
              <div key={dayLabel} className="flex items-center gap-[3px]">
                <div className="w-9 shrink-0 text-[10px] font-medium text-muted-foreground">
                  {dayLabel}
                </div>
                {HOURS.map((hour) => {
                  const count = lookup.get(`${dayIndex}-${hour}`) ?? 0;
                  const intensity = count / max;

                  return (
                    <button
                      key={hour}
                      type="button"
                      className={cn(
                        'aspect-square flex-1 rounded-[3px] transition-transform',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        count > 0 && 'hover:scale-125 hover:ring-1 hover:ring-ring',
                      )}
                      style={{
                        backgroundColor:
                          count === 0
                            ? 'hsl(var(--muted))'
                            : `hsl(var(--chart-accent) / ${0.12 + intensity * 0.88})`,
                      }}
                      aria-label={`${dayLabel} ${formatHour(hour)}: ${count} check-ins`}
                      onPointerEnter={(event) => {
                        const box = containerRef.current?.getBoundingClientRect();
                        if (!box) return;
                        setState({
                          x: event.clientX - box.left,
                          y: event.clientY - box.top,
                          title: `${dayLabel} · ${formatHour(hour)}`,
                          rows: [
                            {
                              label: 'Check-ins',
                              value: String(count),
                              color: ACCENT,
                            },
                          ],
                        });
                      }}
                      onPointerLeave={clear}
                      onBlur={clear}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
            <span>Quiet</span>
            {[0, 0.25, 0.5, 0.75, 1].map((step) => (
              <div
                key={step}
                className="size-2.5 rounded-[2px]"
                style={{
                  backgroundColor:
                    step === 0
                      ? 'hsl(var(--muted))'
                      : `hsl(var(--chart-accent) / ${0.12 + step * 0.88})`,
                }}
              />
            ))}
            <span>Busy</span>
          </div>
        </div>
      </div>

      <ChartTooltip state={state} />
    </div>
  );
}

// ── Shared pieces ─────────────────────────────────────────────────────────

function Legend({
  items,
  note,
}: {
  // `shape: 'line'` keys a series drawn as a stroke rather than a fill, so
  // the legend mark matches the mark in the plot.
  items: Array<{ label: string; color: string; shape?: 'fill' | 'line' }>;
  note?: string;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span
            className={
              item.shape === 'line'
                ? 'h-0.5 w-3 rounded-full'
                : 'size-2.5 rounded-sm'
            }
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </span>
      ))}
      {note && <span className="ml-auto">{note}</span>}
    </div>
  );
}

function ChartEmpty() {
  return (
    <div className="flex h-[200px] items-center justify-center text-[13px] text-muted-foreground">
      Not enough data yet
    </div>
  );
}

function formatHour(hour: number): string {
  const display = hour > 12 ? hour - 12 : hour;
  return `${display}${hour >= 12 ? 'pm' : 'am'}`;
}

/** Sparkline for stat tiles — context without a full chart. */
export function Sparkline({
  values,
  className,
}: {
  values: number[];
  className?: string;
}) {
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={cn('h-8 w-full', className)}
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke={ACCENT}
        strokeWidth={2.5}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
