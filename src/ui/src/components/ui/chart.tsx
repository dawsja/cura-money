/**
 * shadcn-style chart primitives — thin wrapper over `recharts` that:
 *   1. Declares a per-series color via CSS variables (`--color-{key}`)
 *      so light/dark mode swaps automatically. The `<ChartStyle>` block
 *      emits the variables based on the `ChartConfig` passed in.
 *   2. Exposes `ChartContainer` as a styled div that wraps the chart
 *      in the project's `card` surface so it matches the rest of the UI.
 *   3. Re-exports `ChartTooltip` (Recharts' Tooltip) and ships a
 *      `ChartTooltipContent` that knows how to render a labeled list
 *      of series values, skipping zero-value rows so paid-off
 *      accounts don't clutter the hover while preserving negatives.
 *
 * Usage mirrors the shadcn example:
 *
 *   const cfg: ChartConfig = {
 *     total:    { label: 'Total',    color: 'var(--chart-total)' },
 *     baseline: { label: 'Baseline', color: 'var(--chart-baseline)' },
 *     ...Object.fromEntries(accounts.map((a, i) => [a.id, { label: a.name, color: palette[i] }])),
 *   };
 *   <ChartContainer config={cfg} className="h-[360px]">
 *     <LineChart data={data}>
 *       <CartesianGrid vertical={false} />
 *       <XAxis dataKey="month" />
 *       <YAxis />
 *       <ChartTooltip content={<ChartTooltipContent config={cfg} />} />
 *       <Line dataKey="total" stroke="var(--color-total)" />
 *     </LineChart>
 *   </ChartContainer>
 */
import { useId, type ReactElement } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { currencySymbol, formatMoney } from '../../lib/format';

export interface ChartConfig {
  [seriesKey: string]: {
    label: string;
    color: string;
  };
}

/**
 * Container that sets up the CSS variables and lays the chart on the
 * project's `card` surface. Pass any sizing through `className`
 * (e.g. `h-[360px]` or `aspect-video`).
 *
 * The inner Recharts element should be a `<LineChart>` (or other
 * Recharts root) — we don't enforce a specific child type because
 * Recharts types its children with a discriminated union that's
 * awkward to forward.
 */
export function ChartContainer({
  config,
  className,
  style,
  'aria-hidden': ariaHidden,
  children,
}: {
  config: ChartConfig;
  className?: string;
  style?: React.CSSProperties;
  'aria-hidden'?: boolean;
  children: React.ReactNode;
}) {
  const id = useId().replace(/:/g, '');
  const chartId = `chart-${id}`;
  return (
    <div
      data-chart={chartId}
      aria-hidden={ariaHidden}
      style={style}
      className={`card flex justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-[var(--chart-axis)] [&_.recharts-cartesian-grid_line]:stroke-[var(--chart-grid)] [&_.recharts-tooltip-cursor]:stroke-[var(--chart-axis)] ${className ?? ''}`}
    >
      <ChartStyle id={chartId} config={config} />
      <ResponsiveContainer width="100%" height="100%">
        {children as ReactElement}
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Emit `:root { --color-{key}: {color}; }` for every entry in the
 * config. The shadcn pattern — components reference `var(--color-X)`
 * in their `stroke` / `fill` props, and we set the variable on the
 * chart's wrapper so the cascade keeps the value scoped.
 */
function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const rules = Object.entries(config)
    .map(([key, c]) => `  --color-${key}: ${c.color};`)
    .join('\n');
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `[data-chart="${id}"] {\n${rules}\n}\n.dark [data-chart="${id}"] {\n${rules}\n}`,
      }}
    />
  );
}

export const ChartTooltip = Tooltip;

interface TooltipPayloadEntry {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string;
  color?: string;
}

/**
 * Props for `ChartTooltipContent`. Recharts 3.x passes these via the
 * `content` render-prop pattern, but typing it as a forwarded
 * `TooltipProps` is awkward because the official type doesn't expose
 * `payload` / `label` as direct props. We define the shape we
 * actually use.
 */
export interface ChartTooltipContentProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string | number;
  config: ChartConfig;
  valueFormatter?: (v: number) => string;
  labelFormatter?: (l: string | number) => string;
  hideLabel?: boolean;
}

/**
 * Labeled-list tooltip. Renders the X-axis label as the title, then
 * one row per series with its configured color dot and a
 * tabular-number formatted dollar value. Rows where the value is 0
 * or `null`/`undefined` are hidden — that keeps paid-off accounts
 * from cluttering the hover on a 30-year timeline.
 *
 * `valueFormatter` defaults to `formatMoney` (no decimals) — pass a
 * different one for non-currency charts. `labelFormatter` lets the
 * caller prettify the X-axis label (e.g. "2026-07" → "Jul 2026")
 * without rewriting the data shape.
 */
export function ChartTooltipContent({
  active,
  payload,
  label,
  config,
  valueFormatter = (v: number) => formatMoney(v),
  labelFormatter,
  hideLabel = false,
}: ChartTooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const items = payload.filter((p) =>
    typeof p.value === 'number' && Number.isFinite(p.value) && p.value !== 0,
  );
  if (items.length === 0) return null;
  const labelText = label !== undefined ? (labelFormatter ? labelFormatter(label) : String(label)) : undefined;
  return (
    <div
      className="rounded-lg border bg-[var(--chart-tooltip-bg)] text-[var(--chart-tooltip-fg)] shadow-lg p-3 text-xs min-w-[180px]"
      style={{ borderColor: 'var(--chart-tooltip-border)' }}
    >
      {!hideLabel && labelText !== undefined && (
        <div className="font-semibold mb-2">{labelText}</div>
      )}
      <div className="space-y-1">
        {items.map((p) => {
          const key = String(p.name ?? p.dataKey ?? '');
          const meta = config[key];
          if (!meta) return null;
          const v = typeof p.value === 'number' ? p.value : 0;
          return (
            <div key={key} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: p.color ?? meta.color }}
                />
                <span style={{ color: 'var(--chart-tooltip-muted)' }}>{meta.label}</span>
              </span>
              <span className="tabular-nums font-medium">
                {valueFormatter(v)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Compact currency formatter for chart axes & ticks. Switches to $K / $M
 * once values exceed $10,000 so the labels don't push the chart into 9
 * characters of "$1,234,567". Rounds to one decimal in the compact form
 * so axis labels don't jostle horizontally.
 */
export function formatShortMoney(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const sym = currencySymbol();
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${sign}${sym}${(abs / 1_000).toFixed(0)}K`;
  if (abs >= 1_000) return `${sign}${sym}${(abs / 1_000).toFixed(1)}K`;
  return formatMoney(n, true);
}

/**
 * Re-export the most common Recharts pieces under the shadcn naming
 * so the consuming code reads like the example even though we're
 * not pulling in the full shadcn dependency.
 */
export {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
};
