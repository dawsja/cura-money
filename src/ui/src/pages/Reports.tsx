/**
 * Reports — the financial snapshot.
 *
 *   1. Cash Flow Over Time (stacked area: income vs expense)
 *   2. Net Worth Over Time (area)
 *   3. Spending by Category (donut, single month)
 *   4. Top Merchants (horizontal bar, range-driven)
 *   5. Spending Trends by Category (stacked bar, range-driven)
 *   6. Monthly Spending Pace (multi-line, single month)
 *
 * The math lives server-side in src/db/queries.ts; this page is a
 * pure renderer. A single global range selector at the top drives
 * charts 1, 2, 4, and 5. Charts 3 and 6 carry their own month
 * picker because they're inherently single-month views.
 *
 * Transfers and hidden accounts are filtered out at the server (Hard
 * Rule #14) so every chart agrees with the Dashboard's totals.
 */
import { useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { formatMoney, currentYearMonth } from '../lib/format';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  formatShortMoney,
  type ChartConfig,
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
  XAxis,
  YAxis,
} from '../components/ui/chart';
import { Dialog } from '../components/ui/dialog';
import { MonthPicker } from '../components/MonthPicker';
import { SummaryCard } from '../components/SummaryCard';
import { SortableWidgetList } from '../components/SortableWidgetList';
import clsx from 'clsx';
import { AlertCircle, Archive, Download, FileSpreadsheet, Wallet, TrendingUp, TrendingDown, Receipt, Check, Pencil, X } from 'lucide-react';

type Range = '1m' | '3m' | '6m' | '1y' | 'all';
const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: '1m', label: '1M' },
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
];

interface CashFlowPoint { month: string; income: number; expense: number; net: number; }
interface NetWorthPoint { month: string; netWorth: number; }
interface CategorySpend { category: string; total: number; }
interface MerchantTotal { merchant: string; total: number; count: number; }
interface SpendingTrendResult {
  categories: Array<{ key: string; name: string }>;
  series: Array<Record<string, string | number>>;
}
interface SpendingPaceResult {
  month: string;
  previousMonth: string;
  budget: number;
  series: Array<{ day: number; current: number | null; previous: number; budgetPace: number }>;
}
interface RetentionPolicy {
  enabled: boolean;
  days: number;
  cutoffDate: string | null;
  description: string;
}

const DEFAULT_REPORT_ORDER = [
  'summary',
  'cash-flow',
  'spending-trends',
  'spending-pace',
  'net-worth',
  'spending-by-category',
  'top-merchants',
] as const;
type ReportWidgetId = (typeof DEFAULT_REPORT_ORDER)[number];
interface ReportLayout { order: ReportWidgetId[]; hidden: ReportWidgetId[]; }

const REPORT_WIDGET_LABELS: Record<ReportWidgetId, string> = {
  summary: 'Summary',
  'cash-flow': 'Cash flow over time',
  'net-worth': 'Net worth over time',
  'spending-by-category': 'Spending by category',
  'top-merchants': 'Top merchants',
  'spending-trends': 'Spending trends by category',
  'spending-pace': 'Monthly spending pace',
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthShort(ym: string): string {
  const [, m] = ym.split('-');
  return MONTH_NAMES[Number(m) - 1] ?? '';
}
function monthYear(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTH_NAMES[Number(m) - 1] ?? ''} ${y}`;
}

function monthBounds(ym: string): { from: string; to: string } {
  const [year, month] = ym.split('-').map(Number);
  const to = new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10);
  return { from: `${ym}-01`, to };
}

function reportRangeBounds(range: Range, firstMonth: string | undefined, cutoffDate: string | null | undefined) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const offsets: Record<Exclude<Range, 'all'>, number> = { '1m': 0, '3m': 2, '6m': 5, '1y': 11 };
  const from = range === 'all' && firstMonth
    ? `${firstMonth}-01`
    : new Date(Date.UTC(year, month - (range === 'all' ? 0 : offsets[range]), 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  return { from: cutoffDate && cutoffDate > from ? cutoffDate : from, to };
}

function transactionUrl(filters: { from: string; to: string; types?: 'income' | 'expense'; category?: string; merchant?: string }) {
  const params = new URLSearchParams({ from: filters.from, to: filters.to, reviewed: 'true' });
  if (filters.types) params.set('types', filters.types);
  if (filters.category) params.set('category', filters.category);
  if (filters.merchant) params.set('merchant', filters.merchant);
  return `/transactions?${params.toString()}`;
}

/**
 * Pie slice palette — drawn from the project's semantic colors
 * (amber/emerald/rose/sky/violet) so the chart stays inside the
 * existing design language. Slate shades fill in past the first five
 * slices. Stable across re-renders so a slice's color doesn't shift
 * as data changes.
 */
const SLICE_PALETTE = [
  'var(--chart-category-1)',
  'var(--chart-category-2)',
  'var(--chart-category-3)',
  'var(--chart-category-4)',
  'var(--chart-category-5)',
  'var(--chart-category-6)',
  'var(--chart-category-7)',
  'var(--chart-category-8)',
];

export function Reports() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>('6m');
  const [spendingMonth, setSpendingMonth] = useState(currentYearMonth());
  const [editing, setEditing] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [draftOrder, setDraftOrder] = useState<ReportWidgetId[]>([...DEFAULT_REPORT_ORDER]);
  const [draftHidden, setDraftHidden] = useState<ReportWidgetId[]>([]);

  const cashFlow = useQuery({
    queryKey: ['reports', 'cash-flow', range],
    queryFn: () => api.get<CashFlowPoint[]>(`/api/reports/cash-flow?range=${range}`),
  });
  const netWorth = useQuery({
    queryKey: ['reports', 'net-worth', range],
    queryFn: () => api.get<NetWorthPoint[]>(`/api/reports/net-worth?range=${range}`),
  });
  const spending = useQuery({
    queryKey: ['reports', 'spending-by-category', spendingMonth],
    queryFn: () => api.get<CategorySpend[]>(`/api/reports/spending-by-category?month=${spendingMonth}`),
  });
  const topMerchants = useQuery({
    queryKey: ['reports', 'top-merchants', range],
    queryFn: () => api.get<MerchantTotal[]>(`/api/reports/top-merchants?range=${range}`),
  });
  const spendingTrends = useQuery({
    queryKey: ['reports', 'spending-trends', range],
    queryFn: () => api.get<SpendingTrendResult>(`/api/reports/spending-trends?range=${range}`),
  });
  const spendingPace = useQuery({
    queryKey: ['reports', 'spending-pace', spendingMonth],
    queryFn: () => api.get<SpendingPaceResult>(`/api/reports/spending-pace?month=${spendingMonth}`),
  });
  const retention = useQuery({
    queryKey: ['data', 'retention'],
    queryFn: () => api.get<RetentionPolicy>('/api/data/retention'),
  });
  const layout = useQuery({
    queryKey: ['reports', 'layout'],
    queryFn: () => api.get<ReportLayout>('/api/reports/layout'),
  });
  const saveLayout = useMutation({
    mutationFn: (next: ReportLayout) => api.put<ReportLayout>('/api/reports/layout', next),
    onSuccess: (saved) => {
      queryClient.setQueryData(['reports', 'layout'], saved);
      setEditing(false);
    },
  });
  const savedOrder = layout.data?.order ?? [...DEFAULT_REPORT_ORDER];
  const savedHidden = layout.data?.hidden ?? [];
  const startEditing = () => {
    if (!layout.data) return;
    setDraftOrder([...savedOrder]);
    setDraftHidden([...savedHidden]);
    saveLayout.reset();
    setEditing(true);
  };
  const cancelEditing = () => {
    setDraftOrder([...savedOrder]);
    setDraftHidden([...savedHidden]);
    saveLayout.reset();
    setEditing(false);
  };
  const toggleHidden = (widget: ReportWidgetId) => {
    setDraftHidden((current) => current.includes(widget) ? current.filter((id) => id !== widget) : [...current, widget]);
  };

  const totalIncome = (cashFlow.data ?? []).reduce((s, p) => s + p.income, 0);
  const totalExpense = (cashFlow.data ?? []).reduce((s, p) => s + p.expense, 0);
  const totalNet = totalIncome - totalExpense;
  const latestNetWorth = netWorth.data && netWorth.data.length > 0 ? netWorth.data[netWorth.data.length - 1]!.netWorth : 0;
  const firstNetWorth = netWorth.data && netWorth.data.length > 0 ? netWorth.data[0]!.netWorth : 0;
  const netWorthDelta = latestNetWorth - firstNetWorth;
  const spendingTotal = (spending.data ?? []).reduce((s, c) => s + c.total, 0);
  const firstRangeMonth = cashFlow.data?.[0]?.month
    ?? (spendingTrends.data?.series[0]?.month ? String(spendingTrends.data.series[0].month) : undefined)
    ?? netWorth.data?.[0]?.month;
  const rangeBounds = reportRangeBounds(range, firstRangeMonth, retention.data?.cutoffDate);
  const drilldown = (filters: Parameters<typeof transactionUrl>[0]) => navigate(transactionUrl(filters));
  const renderWidget = (widget: ReportWidgetId) => {
    if (widget === 'summary') {
      if (cashFlow.isPending || netWorth.isPending) return <SummarySkeleton />;
      if (cashFlow.isError || netWorth.isError) {
        return <WidgetError message="Could not load the report summary." onRetry={() => void Promise.all([cashFlow.refetch(), netWorth.refetch()])} />;
      }
      return (
        <div className="summary-scroll grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard icon={<TrendingUp className="h-4 w-4" />} label="Income" sub="Over this range" tone="emerald" value={formatMoney(totalIncome)} />
          <SummaryCard icon={<TrendingDown className="h-4 w-4" />} label="Spending" sub="Out-of-pocket" tone="rose" value={formatMoney(totalExpense)} />
          <SummaryCard icon={<Receipt className="h-4 w-4" />} label="Net cash flow" sub={totalNet >= 0 ? 'Saved' : 'Overspent'} tone={totalNet >= 0 ? 'emerald' : 'rose'} value={`${totalNet >= 0 ? '+' : '−'}${formatMoney(Math.abs(totalNet))}`} />
          <SummaryCard icon={<Wallet className="h-4 w-4" />} label="Estimated net worth" sub={`${netWorthDelta >= 0 ? '+' : '−'}${formatMoney(Math.abs(netWorthDelta))} reconstructed change`} value={formatMoney(latestNetWorth)} tone={latestNetWorth >= 0 ? 'slate' : 'rose'} />
        </div>
      );
    }
    if (widget === 'cash-flow') {
      return (
        <section className="card flex-1">
          <ChartHeader title="Cash flow over time" subtitle="Income vs. expense, by month" />
          <CashFlowChart data={cashFlow.data ?? []} loading={cashFlow.isPending} error={cashFlow.isError} onRetry={() => void cashFlow.refetch()} onDrilldown={drilldown} />
        </section>
      );
    }
    if (widget === 'net-worth') {
      return (
        <section className="card flex-1">
          <ChartHeader title="Estimated net worth over time" subtitle="Reconstructed from today’s account balances by reversing monthly income and spending; not historical balance snapshots" />
          <NetWorthChart data={netWorth.data ?? []} loading={netWorth.isPending} error={netWorth.isError} onRetry={() => void netWorth.refetch()} />
        </section>
      );
    }
    if (widget === 'spending-by-category') {
      return (
        <section className="card flex-1">
          <ChartHeader title="Spending by category" subtitle={spending.data ? `${monthYear(spendingMonth)} — ${formatMoney(spendingTotal)} total` : monthYear(spendingMonth)} right={<MonthPicker value={spendingMonth} onChange={setSpendingMonth} />} />
          <SpendingDonut data={spending.data ?? []} loading={spending.isPending} error={spending.isError} onRetry={() => void spending.refetch()} month={spendingMonth} onDrilldown={drilldown} />
        </section>
      );
    }
    if (widget === 'top-merchants') {
      return (
        <section className="card flex-1">
          <ChartHeader title="Top merchants" subtitle="Where the most money went" />
          <TopMerchantsChart data={topMerchants.data ?? []} loading={topMerchants.isPending} error={topMerchants.isError} onRetry={() => void topMerchants.refetch()} bounds={rangeBounds} onDrilldown={drilldown} />
        </section>
      );
    }
    if (widget === 'spending-trends') {
      return (
        <section className="card flex-1">
          <ChartHeader title="Spending trends by category" subtitle="How your largest expense categories change over time" />
          <SpendingTrendsChart data={spendingTrends.data} loading={spendingTrends.isPending} error={spendingTrends.isError} onRetry={() => void spendingTrends.refetch()} onDrilldown={drilldown} />
        </section>
      );
    }
    return (
      <section className="card flex-1">
        <ChartHeader title="Monthly spending pace" subtitle={`${monthYear(spendingMonth)} compared with ${spendingPace.data ? monthYear(spendingPace.data.previousMonth) : 'the prior month'}`} right={<MonthPicker value={spendingMonth} onChange={setSpendingMonth} />} />
        <SpendingPaceChart data={spendingPace.data} loading={spendingPace.isPending} error={spendingPace.isError} onRetry={() => void spendingPace.refetch()} onDrilldown={drilldown} />
      </section>
    );
  };

  const displayedOrder = editing ? draftOrder : savedOrder;
  const displayedHidden = new Set(editing ? draftHidden : savedHidden);
  const visibleDisplayedOrder = displayedOrder.filter((widget) => !displayedHidden.has(widget));
  const reportItemClass = (widget: ReportWidgetId) => {
    if (widget !== 'spending-by-category' && widget !== 'top-merchants') return 'flex flex-col lg:col-span-2';
    const index = visibleDisplayedOrder.indexOf(widget);
    const neighbor = widget === 'spending-by-category' ? 'top-merchants' : 'spending-by-category';
    return visibleDisplayedOrder[index - 1] === neighbor || visibleDisplayedOrder[index + 1] === neighbor
      ? 'flex flex-col'
      : 'flex flex-col lg:col-span-2';
  };

  return (
    <div className="space-y-6">
      <div data-onboarding-target="reports-header" className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center">
            <h1 className="text-2xl font-bold fg-primary">Reports</h1>
            {!editing && (
              <button type="button" onClick={startEditing} disabled={!layout.data} className="edit-icon-button inline-flex h-11 w-11 items-center justify-center rounded-lg disabled:cursor-wait disabled:opacity-50" aria-label="Edit reports layout" title="Edit reports layout">
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="text-sm fg-tertiary mt-1">Trends, breakdowns, and comparisons across your money. Transfers are excluded from every chart.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!editing && (
            <button
              type="button"
              onClick={() => setExportOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-default bg-surface fg-secondary hover:border-amber-500 hover:text-amber-700 dark:hover:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              aria-label="Export data"
              title="Export data"
            >
              <Download className="h-4 w-4" />
            </button>
          )}
          {editing && (
            <>
              <button type="button" onClick={cancelEditing} disabled={saveLayout.isPending} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-default px-3 text-sm font-medium fg-secondary hover:bg-surface disabled:opacity-50">
                <X className="h-4 w-4" /> Cancel
              </button>
              <button type="button" onClick={() => layout.data && saveLayout.mutate({ order: draftOrder, hidden: draftHidden })} disabled={saveLayout.isPending || !layout.data} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-amber-500 px-3 text-sm font-semibold text-slate-900 hover:bg-amber-600 disabled:opacity-50">
                <Check className="h-4 w-4" /> {saveLayout.isPending ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
          <div className="flex w-full flex-col items-end gap-1 md:w-auto">
            <RangeSelector value={range} onChange={setRange} />
            {range === 'all' && <p className="max-w-sm text-right text-xs fg-muted">All-range drilldowns begin at the first displayed report month because reports do not expose the exact first transaction date.</p>}
          </div>
        </div>
      </div>
      {layout.isError && (
        <p className="text-sm text-rose-600 dark:text-rose-400">
          Could not load the reports layout.{' '}
          <button type="button" onClick={() => void layout.refetch()} className="underline">Retry</button>
        </p>
      )}
      {saveLayout.isError && <p className="text-sm text-rose-600 dark:text-rose-400">Could not save the reports layout. Please try again.</p>}

      <SortableWidgetList
        order={displayedOrder}
        labels={REPORT_WIDGET_LABELS}
        editing={editing}
        onReorder={setDraftOrder}
        renderWidget={renderWidget}
        className="grid gap-6 lg:grid-cols-2"
        itemClassName={reportItemClass}
        hidden={displayedHidden}
        onToggleHidden={editing ? toggleHidden : undefined}
      />
      {exportOpen && (
        <ExportModal
          retention={retention.data}
          retentionLoading={retention.isPending}
          retentionError={retention.isError}
          onRetryRetention={() => void retention.refetch()}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
}

// ---- Sub-components -------------------------------------------------------

function ExportModal({
  retention,
  retentionLoading,
  retentionError,
  onRetryRetention,
  onClose,
}: {
  retention: RetentionPolicy | undefined;
  retentionLoading: boolean;
  retentionError: boolean;
  onRetryRetention: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  const download = () => window.setTimeout(onClose, 0);

  return (
    <Dialog
      aria-labelledby={titleId}
      onClose={onClose}
      initialFocusRef={firstLinkRef}
      overlayClassName="dialog-overlay--dim"
      contentClassName="card w-full max-w-lg"
    >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-lg font-semibold fg-primary">Export your data</h2>
            <p className="mt-1 text-sm fg-muted">Choose what you want to download.</p>
          </div>
          <button type="button" onClick={onClose} className="close-button flex h-11 w-11 shrink-0 items-center justify-center rounded-lg" aria-label="Close export dialog">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <a
            ref={firstLinkRef}
            href="/api/data/transactions.csv"
            download
            onClick={download}
            className="group rounded-xl border border-default bg-canvas-subtle p-4 transition-colors hover:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <FileSpreadsheet className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            <span className="mt-3 block text-sm font-semibold fg-primary group-hover:text-amber-700 dark:group-hover:text-amber-300">Transactions CSV</span>
            <span className="mt-1 block text-xs fg-muted">A spreadsheet-ready ledger of all transactions.</span>
          </a>
          <a
            href="/api/data/export.json"
            download
            onClick={download}
            className="group rounded-xl border border-default bg-canvas-subtle p-4 transition-colors hover:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <Archive className="h-6 w-6 text-sky-700 dark:text-sky-300" />
            <span className="mt-3 block text-sm font-semibold fg-primary group-hover:text-amber-700 dark:group-hover:text-amber-300">Full JSON archive</span>
            <span className="mt-1 block text-xs fg-muted">Accounts, transactions, budgets, goals, rules, and settings.</span>
          </a>
        </div>

        <div className="mt-4 rounded-lg border border-default bg-canvas-subtle px-3 py-2 text-xs fg-muted" aria-live="polite">
          {retentionLoading && <p>Checking data retention policy…</p>}
          {retentionError && (
            <p className="text-rose-600 dark:text-rose-400">
              Retention policy unavailable.{' '}
              <button type="button" onClick={onRetryRetention} className="underline">Retry</button>
            </p>
          )}
          {retention && <p>{retention.description}</p>}
        </div>
    </Dialog>
  );
}

function RangeSelector({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  // Mobile: a full-width segmented control with comfortable touch
  // targets. Desktop (md+) keeps the original compact inline pills.
  return (
    <div className="flex w-full rounded-lg border border-default bg-surface p-1 gap-1 md:inline-flex md:w-auto">
      {RANGE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={clsx(
            'flex-1 min-h-10 px-3 py-1.5 text-xs font-medium rounded-md transition-colors md:flex-none md:min-h-0',
            value === opt.value
              ? 'bg-amber-500 text-slate-900'
              : 'fg-tertiary hover:bg-slate-100 dark:hover:bg-slate-700',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ChartHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div>
        <h2 className="text-lg font-semibold fg-primary">{title}</h2>
        {subtitle && <p className="text-xs fg-muted mt-0.5">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <AlertCircle className="h-8 w-8 text-amber-500 mb-2" />
      <p className="text-sm fg-muted">{message}</p>
    </div>
  );
}

function WidgetError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-rose-500/30 py-10 text-center">
      <AlertCircle className="mb-2 h-8 w-8 text-rose-500" />
      <p className="text-sm fg-secondary">{message}</p>
      <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-lg border border-default px-4 text-sm font-medium fg-primary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">Retry</button>
    </div>
  );
}

function SummarySkeleton() {
  return <div className="summary-scroll grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <ChartSkeleton key={index} height={112} />)}</div>;
}

function DrilldownDetails({ children }: { children: React.ReactNode }) {
  return (
    <details className="mt-3 border-t border-default pt-3">
      <summary className="cursor-pointer text-xs font-medium fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">View matching transactions</summary>
      <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto">{children}</div>
    </details>
  );
}

function ChartDataDetails({
  summary,
  caption,
  headers,
  rows,
}: {
  summary: string;
  caption: string;
  headers: string[];
  rows: Array<{ key: string; cells: React.ReactNode[] }>;
}) {
  return (
    <details className="mt-3 border-t border-default pt-3">
      <summary className="focus-ring cursor-pointer text-xs font-medium fg-secondary">{summary}</summary>
      <div className="mt-2 max-h-64 overflow-auto">
        <table className="w-full min-w-max text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead className="fg-muted">
            <tr className="border-b border-default">
              {headers.map((header, index) => <th key={header} scope="col" className={clsx('py-2 font-medium', index === 0 ? 'pr-3' : 'px-3 text-right')}>{header}</th>)}
            </tr>
          </thead>
          <tbody className="fg-secondary">
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-default last:border-0">
                {row.cells.map((cell, index) => index === 0
                  ? <th key={index} scope="row" className="py-2 pr-3 font-medium fg-primary">{cell}</th>
                  : <td key={index} className="px-3 py-2 text-right tabular-nums">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function DrilldownButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="min-h-11 rounded-md border border-default px-2.5 py-1.5 text-xs fg-secondary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">{label}</button>;
}

function ChartSkeleton({ height = 280 }: { height?: number }) {
  return <div className="w-full rounded-lg bg-slate-100 dark:bg-slate-700/50 animate-pulse" style={{ height }} />;
}

// ---- 1. Cash Flow Chart --------------------------------------------------

function CashFlowChart({ data, loading, error, onRetry, onDrilldown }: { data: CashFlowPoint[]; loading: boolean; error: boolean; onRetry: () => void; onDrilldown: (filters: Parameters<typeof transactionUrl>[0]) => void }) {
  if (loading) return <ChartSkeleton />;
  if (error) return <WidgetError message="Could not load cash flow." onRetry={onRetry} />;
  if (data.length === 0) return <EmptyState message="No transactions yet. Add some to see your cash flow." />;
  const hasAnyActivity = data.some((p) => p.income > 0 || p.expense > 0);
  if (!hasAnyActivity) return <EmptyState message="No income or expenses in this range." />;

  const config: ChartConfig = {
    income: { label: 'Income', color: 'var(--chart-income)' },
    expense: { label: 'Expense', color: 'var(--chart-expense)' },
    net: { label: 'Net', color: 'var(--chart-net)' },
  };

  return (
    <>
    <ChartContainer config={config} className="h-[280px]" aria-hidden={true}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="cf-income-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-income)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="var(--chart-income)" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="cf-expense-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-expense)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="var(--chart-expense)" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="month"
          tickFormatter={monthShort}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={formatShortMoney}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              config={config}
              labelFormatter={(l) => monthYear(String(l))}
            />
          }
        />
        <Area
          type="monotone"
          dataKey="income"
          stroke="var(--chart-income)"
          strokeWidth={2}
          fill="url(#cf-income-grad)"
          stackId="1"
        />
        <Area
          type="monotone"
          dataKey="expense"
          stroke="var(--chart-expense)"
          strokeWidth={2}
          fill="url(#cf-expense-grad)"
          stackId="2"
        />
      </AreaChart>
    </ChartContainer>
    <ChartDataDetails
      summary="View cash flow data"
      caption="Monthly income, expenses, and signed net cash flow"
      headers={['Month', 'Income', 'Expense', 'Net cash flow']}
      rows={data.map((point) => ({ key: point.month, cells: [monthYear(point.month), formatMoney(point.income), formatMoney(point.expense), formatMoney(point.net)] }))}
    />
    <DrilldownDetails>
      {data.flatMap((point) => {
        const bounds = monthBounds(point.month);
        return ([['income', point.income], ['expense', point.expense]] as const).map(([type, amount]) => (
          <DrilldownButton key={`${point.month}-${type}`} label={`${monthYear(point.month)} ${type} (${formatMoney(amount)})`} onClick={() => onDrilldown({ ...bounds, types: type })} />
        ));
      })}
    </DrilldownDetails>
    </>
  );
}

// ---- 2. Net Worth Chart --------------------------------------------------

function NetWorthChart({ data, loading, error, onRetry }: { data: NetWorthPoint[]; loading: boolean; error: boolean; onRetry: () => void }) {
  if (loading) return <ChartSkeleton />;
  if (error) return <WidgetError message="Could not load the net worth estimate." onRetry={onRetry} />;
  if (data.length === 0) return <EmptyState message="No accounts yet. Add an account to track net worth." />;

  const config: ChartConfig = {
    netWorth: { label: 'Net worth', color: 'var(--chart-net-worth-positive)' },
  };

  const minimum = Math.min(...data.map((point) => point.netWorth));
  const maximum = Math.max(...data.map((point) => point.netWorth));
  const hasNegative = minimum < 0;
  const hasPositive = maximum > 0;
  const zeroOffset = hasNegative && hasPositive ? (maximum / (maximum - minimum)) * 100 : hasNegative ? 0 : 100;

  return (
    <>
      <div aria-hidden="true">
          <ChartContainer config={config} className="h-[280px]" aria-hidden={true}>
          <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="nw-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset={`${zeroOffset}%`} stopColor="var(--chart-net-worth-positive)" stopOpacity={0.4} />
                <stop offset={`${zeroOffset}%`} stopColor="var(--chart-net-worth-negative)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="var(--chart-net-worth-negative)" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="nw-stroke" x1="0" y1="0" x2="0" y2="1">
                <stop offset={`${zeroOffset}%`} stopColor="var(--chart-net-worth-positive)" />
                <stop offset={`${zeroOffset}%`} stopColor="var(--chart-net-worth-negative)" />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="month" tickFormatter={monthShort} tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" />
            <YAxis tickFormatter={formatShortMoney} tickLine={false} axisLine={false} width={56} />
            <ChartTooltip content={<ChartTooltipContent config={config} labelFormatter={(l) => monthYear(String(l))} />} />
            <Area type="monotone" dataKey="netWorth" stroke="url(#nw-stroke)" strokeWidth={2} fill="url(#nw-fill)" />
          </AreaChart>
        </ChartContainer>
      </div>
      <details className="mt-3 border-t border-default pt-3">
        <summary className="cursor-pointer text-xs font-medium fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">View net worth data</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Estimated net worth by month</caption>
            <thead className="fg-muted">
              <tr className="border-b border-default">
                <th scope="col" className="py-2 pr-3 font-medium">Month</th>
                <th scope="col" className="py-2 pl-3 text-right font-medium">Estimated net worth</th>
              </tr>
            </thead>
            <tbody className="fg-secondary">
              {data.map((point) => (
                <tr key={point.month} className="border-b border-default last:border-0">
                  <th scope="row" className="py-2 pr-3 font-medium fg-primary">{monthYear(point.month)}</th>
                  <td className={clsx('py-2 pl-3 text-right tabular-nums', point.netWorth < 0 && 'text-rose-600 dark:text-rose-400')}>{formatMoney(point.netWorth)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function SpendingTrendsChart({ data, loading, error, onRetry, onDrilldown }: { data: SpendingTrendResult | undefined; loading: boolean; error: boolean; onRetry: () => void; onDrilldown: (filters: Parameters<typeof transactionUrl>[0]) => void }) {
  if (loading) return <ChartSkeleton />;
  if (error) return <WidgetError message="Could not load spending trends." onRetry={onRetry} />;
  if (!data || data.categories.length === 0) return <EmptyState message="No category spending in this range." />;

  const config: ChartConfig = {};
  data.categories.forEach((category, index) => {
    config[category.key] = { label: category.name, color: SLICE_PALETTE[index % SLICE_PALETTE.length]! };
  });
  return (
    <div className="space-y-3">
       <ChartContainer config={config} className="h-[300px]" aria-hidden={true}>
        <BarChart data={data.series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="month" tickFormatter={monthShort} tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" />
          <YAxis tickFormatter={formatShortMoney} tickLine={false} axisLine={false} width={56} />
          <ChartTooltip content={<ChartTooltipContent config={config} labelFormatter={(label) => monthYear(String(label))} />} />
          {data.categories.map((category, index) => (
            <Bar key={category.key} dataKey={category.key} stackId="spending" fill={SLICE_PALETTE[index % SLICE_PALETTE.length]} />
          ))}
        </BarChart>
       </ChartContainer>
       <ChartDataDetails
         summary="View spending trend data"
         caption="Monthly spending by category"
         headers={['Month', ...data.categories.map((category) => category.name)]}
         rows={data.series.map((point) => {
           const month = String(point.month);
           return { key: month, cells: [monthYear(month), ...data.categories.map((category) => formatMoney(Number(point[category.key] ?? 0)))] };
         })}
       />
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {data.categories.map((category, index) => (
          <li key={category.key} className="flex items-center gap-1.5 text-xs fg-secondary">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SLICE_PALETTE[index % SLICE_PALETTE.length] }} />
            {category.name}
          </li>
        ))}
      </ul>
      <DrilldownDetails>
        {data.series.flatMap((point) => data.categories
          .filter((category) => category.name.toLowerCase() !== 'other')
          .map((category) => {
            const month = String(point.month);
            return <DrilldownButton key={`${month}-${category.key}`} label={`${monthYear(month)} · ${category.name}`} onClick={() => onDrilldown({ ...monthBounds(month), types: 'expense', category: category.name })} />;
          }))}
      </DrilldownDetails>
    </div>
  );
}

function SpendingPaceChart({ data, loading, error, onRetry, onDrilldown }: { data: SpendingPaceResult | undefined; loading: boolean; error: boolean; onRetry: () => void; onDrilldown: (filters: Parameters<typeof transactionUrl>[0]) => void }) {
  if (loading) return <ChartSkeleton />;
  if (error) return <WidgetError message="Could not load spending pace." onRetry={onRetry} />;
  if (!data || (!data.series.some((point) => Number(point.current) > 0 || point.previous > 0) && data.budget === 0)) {
    return <EmptyState message="No spending or budget is available for this month." />;
  }
  const config: ChartConfig = {
    current: { label: monthYear(data.month), color: 'var(--chart-expense)' },
    previous: { label: monthYear(data.previousMonth), color: 'var(--chart-comparison)' },
    budgetPace: { label: 'Budget pace', color: 'var(--chart-income)' },
  };
  return (
    <>
    <ChartContainer config={config} className="h-[280px]" aria-hidden={true}>
      <LineChart data={data.series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="day" tickFormatter={(day) => `Day ${day}`} tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" />
        <YAxis tickFormatter={formatShortMoney} tickLine={false} axisLine={false} width={56} />
        <ChartTooltip content={<ChartTooltipContent config={config} labelFormatter={(day) => `Day ${day}`} />} />
        <Line dataKey="previous" type="monotone" stroke="var(--color-previous)" strokeWidth={2} dot={false} />
        <Line dataKey="budgetPace" type="monotone" stroke="var(--color-budgetPace)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
        <Line dataKey="current" type="monotone" stroke="var(--color-current)" strokeWidth={2.5} dot={false} />
      </LineChart>
    </ChartContainer>
    <ChartDataDetails
      summary="View spending pace data"
      caption={`Daily cumulative spending pace for ${monthYear(data.month)} and ${monthYear(data.previousMonth)}`}
      headers={['Day', monthYear(data.month), monthYear(data.previousMonth), 'Budget pace']}
      rows={data.series.map((point) => ({
        key: String(point.day),
        cells: [`Day ${point.day}`, point.current === null ? 'Not available' : formatMoney(point.current), formatMoney(point.previous), formatMoney(point.budgetPace)],
      }))}
    />
    <DrilldownDetails>
      <DrilldownButton label={monthYear(data.month)} onClick={() => onDrilldown({ ...monthBounds(data.month), types: 'expense' })} />
      <DrilldownButton label={monthYear(data.previousMonth)} onClick={() => onDrilldown({ ...monthBounds(data.previousMonth), types: 'expense' })} />
    </DrilldownDetails>
    </>
  );
}

// ---- 4. Spending Donut ---------------------------------------------------

function SpendingDonut({ data, loading, error, onRetry, month, onDrilldown }: { data: CategorySpend[]; loading: boolean; error: boolean; onRetry: () => void; month: string; onDrilldown: (filters: Parameters<typeof transactionUrl>[0]) => void }) {
  if (loading) return <ChartSkeleton height={280} />;
  if (error) return <WidgetError message="Could not load category spending." onRetry={onRetry} />;
  if (data.length === 0) return <EmptyState message="No spending recorded for this month." />;

  const config: ChartConfig = {};
  data.forEach((c, i) => {
    config[c.category] = { label: c.category, color: SLICE_PALETTE[i % SLICE_PALETTE.length]! };
  });
  const total = data.reduce((s, c) => s + c.total, 0);

  return (
    <>
    <div className="flex flex-col lg:flex-row gap-4 items-center">
      <ChartContainer config={config} className="h-[240px] flex-1 min-w-0" aria-hidden={true}>
        <PieChart>
          <ChartTooltip
            content={
              <ChartTooltipContent
                config={config}
                hideLabel
                valueFormatter={(v) => `${formatMoney(v)} (${((v / total) * 100).toFixed(0)}%)`}
              />
            }
          />
          <Pie
            data={data}
            dataKey="total"
            nameKey="category"
            innerRadius={55}
            outerRadius={90}
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((c, i) => (
              <Cell key={c.category} fill={SLICE_PALETTE[i % SLICE_PALETTE.length]} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <ul className="space-y-1.5 w-full lg:w-[180px] shrink-0">
        {data.slice(0, 6).map((c, i) => (
          <li key={c.category} className="flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: SLICE_PALETTE[i % SLICE_PALETTE.length] }}
            />
            <span className="flex-1 truncate fg-secondary">{c.category}</span>
            <span className="tabular-nums fg-primary font-medium">{formatMoney(c.total)}</span>
          </li>
        ))}
        {data.length > 6 && (
          <li className="text-xs fg-muted pl-4.5">+{data.length - 6} more</li>
        )}
      </ul>
    </div>
    <ChartDataDetails
      summary="View category spending data"
      caption={`Spending by category for ${monthYear(month)}`}
      headers={['Category', 'Spend', 'Share']}
      rows={data.map((category) => ({
        key: category.category,
        cells: [category.category, formatMoney(category.total), `${((category.total / total) * 100).toFixed(1)}%`],
      }))}
    />
    <DrilldownDetails>
      {data.map((category) => <DrilldownButton key={category.category} label={category.category} onClick={() => onDrilldown({ ...monthBounds(month), types: 'expense', category: category.category })} />)}
    </DrilldownDetails>
    </>
  );
}

// ---- 4. Top Merchants ----------------------------------------------------

function TopMerchantsChart({ data, loading, error, onRetry, bounds, onDrilldown }: { data: MerchantTotal[]; loading: boolean; error: boolean; onRetry: () => void; bounds: { from: string; to: string }; onDrilldown: (filters: Parameters<typeof transactionUrl>[0]) => void }) {
  if (loading) return <ChartSkeleton height={Math.max(280, data.length * 32)} />;
  if (error) return <WidgetError message="Could not load top merchants." onRetry={onRetry} />;
  if (data.length === 0) return <EmptyState message="No merchant spending in this range." />;

  const config: ChartConfig = {
    total: { label: 'Spend', color: 'var(--chart-merchant)' },
  };
  // Reverse so the largest sits at the top of the horizontal bar chart.
  const reversed = [...data].reverse();
  const height = Math.max(280, data.length * 36);

  return (
    <>
    <ChartContainer config={config} style={{ height }} aria-hidden={true}>
      <BarChart
        data={reversed}
        layout="vertical"
        margin={{ top: 4, right: 12, left: 0, bottom: 0 }}
      >
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis
          type="number"
          tickFormatter={formatShortMoney}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="merchant"
          tickLine={false}
          axisLine={false}
          width={100}
          tick={{ fontSize: 11 }}
          interval={0}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              config={config}
              hideLabel
              valueFormatter={(v) => formatMoney(v)}
            />
          }
        />
        <Bar dataKey="total" fill="var(--chart-merchant)" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartContainer>
    <ChartDataDetails
      summary="View merchant spending data"
      caption="Top merchant spending and transaction counts"
      headers={['Merchant', 'Spend', 'Transactions']}
      rows={data.map((merchant) => ({ key: merchant.merchant, cells: [merchant.merchant, formatMoney(merchant.total), merchant.count] }))}
    />
    <DrilldownDetails>
      {data.map((merchant) => <DrilldownButton key={merchant.merchant} label={merchant.merchant} onClick={() => onDrilldown({ ...bounds, types: 'expense', merchant: merchant.merchant })} />)}
    </DrilldownDetails>
    </>
  );
}
