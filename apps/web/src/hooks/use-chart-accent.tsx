import * as React from 'react';

/**
 * Chart accent themes.
 *
 * Every chart reads `--chart-accent` and `--chart-contrast` rather than a
 * hardcoded colour, so switching the accent repaints all five charts at once
 * without touching a single component.
 *
 * Both palettes were VALIDATED with the dataviz skill's checker against both
 * surfaces before being added here. Neither was chosen by eye:
 *
 *   Bronze  dark  ΔE 20.0 deutan · 21.5 normal · contrast 5.15:1 / 4.80:1
 *           light ΔE 19.5 deutan · 21.2 normal · contrast 4.59:1 / 3.35:1
 *   Wine    dark  ΔE 18.6 deutan · 29.9 normal · all six checks pass
 *           light ΔE 17.3 deutan · 26.8 normal · all six checks pass
 *
 * The companion hue is deliberately COOL in both themes. Diverging poles
 * must read as opposite, and a red/green pair — the obvious choice for
 * growth vs shrinkage — measured ΔE 0.8 under deuteranopia. Indistinguishable.
 */

export type ChartAccent = 'bronze' | 'wine';

interface AccentDefinition {
  key: ChartAccent;
  label: string;
  /** Shown in the switcher, in each mode. */
  swatch: { light: string; dark: string };
}

export const CHART_ACCENTS: AccentDefinition[] = [
  {
    key: 'bronze',
    label: 'Bronze',
    swatch: { light: 'hsl(36 64% 37%)', dark: 'hsl(34 52% 47%)' },
  },
  {
    key: 'wine',
    label: 'Wine',
    // Kept in lockstep with the `[data-chart-accent='wine']` block in
    // globals.css — a swatch that previews a colour the chart will not
    // paint is worse than no swatch.
    swatch: { light: 'hsl(346 60% 36%)', dark: 'hsl(349 54% 49%)' },
  },
];

interface ChartAccentContextValue {
  accent: ChartAccent;
  setAccent: (accent: ChartAccent) => void;
  toggle: () => void;
}

const ChartAccentContext =
  React.createContext<ChartAccentContextValue | null>(null);

const STORAGE_KEY = 'azf-chart-accent';

export function ChartAccentProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [accent, setAccentState] = React.useState<ChartAccent>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'bronze' || stored === 'wine') return stored;
      // 'red' was the earlier name for this palette. Anyone who already
      // chose it keeps their choice instead of being silently reset to
      // bronze — a renamed key must not look like a lost preference.
      if (stored === 'red') return 'wine';
    } catch {
      // Storage blocked (private mode); fall through to the default.
    }
    return 'bronze';
  });

  // A data attribute on <html> rather than inline styles: the CSS carries
  // both palettes, so the swap is one attribute change and the browser
  // repaints without React re-rendering a single chart.
  React.useEffect(() => {
    document.documentElement.setAttribute('data-chart-accent', accent);
    // Rewrite the stored value so a migrated 'red' settles to 'wine'
    // rather than being re-migrated on every future load.
    try {
      localStorage.setItem(STORAGE_KEY, accent);
    } catch {
      // Storage blocked; the attribute above is what actually matters.
    }
  }, [accent]);

  const setAccent = React.useCallback((next: ChartAccent) => {
    setAccentState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference will not persist; the session still works.
    }
  }, []);

  const toggle = React.useCallback(() => {
    setAccent(accent === 'bronze' ? 'wine' : 'bronze');
  }, [accent, setAccent]);

  const value = React.useMemo(
    () => ({ accent, setAccent, toggle }),
    [accent, setAccent, toggle],
  );

  return (
    <ChartAccentContext.Provider value={value}>
      {children}
    </ChartAccentContext.Provider>
  );
}

export function useChartAccent(): ChartAccentContextValue {
  const context = React.useContext(ChartAccentContext);
  if (!context) {
    throw new Error(
      'useChartAccent must be used within a ChartAccentProvider',
    );
  }
  return context;
}
