/**
 * Reports — the five-chart financial snapshot.
 *
 *   1. Cash Flow Over Time (stacked area: income vs expense)
 *   2. Net Worth Over Time (area)
 *   3. Spending by Category (donut, single month)
 *   4. Top Merchants (horizontal bar, range-driven)
 *   5. Budget vs Actual (grouped bar, single month)
 *
 * The math lives server-side in src/db/queries.ts; this page is a
 * pure renderer. A single global range selector at the top drives
 * charts 1, 2, and 4. Charts 3 and 5 carry their own month picker
 * because they're inherently single-month views.
 *
 * Transfers and hidden accounts are filtered out at the server (Hard
 * Rule #14) so every chart agrees with the Dashboard's totals.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatMoney, currentYearMonth } from '../lib/format';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  formatShortMoney,
  type ChartConfig,
} from '../components/ui/chart';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from '../components/ui/chart';
import { MonthPicker } from '../components/MonthPicker';
import { SummaryCard } from '../components/SummaryCard';
import clsx from 'clsx';
import { AlertCircle, Wallet, TrendingUp, TrendingDown, Receipt } from 'lucide-react';

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
interface BudgetRow { category: string; planned: number; actual: number; }

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthShort(ym: string): string {
  const [, m] = ym.split('-');
  return MONTH_NAMES[Number(m) - 1] ?? '';
}
function monthYear(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTH_NAMES[Number(m) - 1] ?? ''} ${y}`;
}

/**
 * Pie slice palette — drawn from the project's semantic colors
 * (amber/emerald/rose/sky/violet) so the chart stays inside the
 * existing design language. Slate shades fill in past the first five
 * slices. Stable across re-renders so a slice's color doesn't shift
 * as data changes.
 */
const SLICE_PALETTE = [
  '#f59e0b', // amber-500
  '#10b981', // emerald-500
  '#ef4444', // rose-500
  '#0ea5e9', // sky-500
  '#8b5cf6', // violet-500
  '#64748b', // slate-500
  '#475569', // slate-600
  '#94a3b8', // slate-400
];

export function Reports() {
  const [range, setRange] = useState<Range>('6m');
  const [spendingMonth, setSpendingMonth] = useState(currentYearMonth());
  const [budgetMonth, setBudgetMonth] = useState(currentYearMonth());

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
  const budget = useQuery({
    queryKey: ['reports', 'budget-vs-actual', budgetMonth],
    queryFn: () => api.get<BudgetRow[]>(`/api/reports/budget-vs-actual?month=${budgetMonth}`),
  });

  const totalIncome = (cashFlow.data ?? []).reduce((s, p) => s + p.income, 0);
  const totalExpense = (cashFlow.data ?? []).reduce((s, p) => s + p.expense, 0);
  const totalNet = totalIncome - totalExpense;
  const latestNetWorth = netWorth.data && netWorth.data.length > 0 ? netWorth.data[netWorth.data.length - 1]!.netWorth : 0;
  const firstNetWorth = netWorth.data && netWorth.data.length > 0 ? netWorth.data[0]!.netWorth : 0;
  const netWorthDelta = latestNetWorth - firstNetWorth;
  const spendingTotal = (spending.data ?? []).reduce((s, c) => s + c.total, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold fg-primary">Reports</h1>
          <p className="text-sm fg-tertiary mt-1">
            Trends, breakdowns, and comparisons across your money. Transfers are excluded from every chart.
          </p>
        </div>
        <RangeSelector value={range} onChange={setRange} />
      </div>

      {/* Cash Flow + Net Worth summary cards */}
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Income"
          sub="Over this range"
          tone="emerald"
          value={formatMoney(totalIncome)}
        />
        <SummaryCard
          icon={<TrendingDown className="h-4 w-4" />}
          label="Spending"
          sub="Out-of-pocket"
          tone="rose"
          value={formatMoney(totalExpense)}
        />
        <SummaryCard
          icon={<Receipt className="h-4 w-4" />}
          label="Net cash flow"
          sub={totalNet >= 0 ? 'Saved' : 'Overspent'}
          tone={totalNet >= 0 ? 'emerald' : 'rose'}
          value={`${totalNet >= 0 ? '+' : '−'}${formatMoney(Math.abs(totalNet))}`}
        />
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />}
          label="Net worth"
          sub={`${netWorthDelta >= 0 ? '+' : '−'}${formatMoney(Math.abs(netWorthDelta))} this range`}
          value={formatMoney(latestNetWorth)}
          tone={latestNetWorth >= 0 ? 'slate' : 'rose'}
        />
      </div>

      {/* 1. Cash Flow */}
      <section className="card">
        <ChartHeader title="Cash flow over time" subtitle="Income vs. expense, by month" />
        <CashFlowChart data={cashFlow.data ?? []} loading={cashFlow.isLoading} />
      </section>

      {/* 2. Net Worth */}
      <section className="card">
        <ChartHeader title="Net worth over time" subtitle="Sum of all accounts, month-end" />
        <NetWorthChart data={netWorth.data ?? []} loading={netWorth.isLoading} />
      </section>

      {/* 3. Spending by Category + 4. Top Merchants */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <ChartHeader
            title="Spending by category"
            subtitle={`${monthYear(spendingMonth)} — ${formatMoney(spendingTotal)} total`}
            right={<MonthPicker value={spendingMonth} onChange={setSpendingMonth} />}
          />
          <SpendingDonut data={spending.data ?? []} loading={spending.isLoading} />
        </section>

        <section className="card">
          <ChartHeader title="Top merchants" subtitle="Where the most money went" />
          <TopMerchantsChart data={topMerchants.data ?? []} loading={topMerchants.isLoading} />
        </section>
      </div>

      {/* 5. Budget vs Actual */}
      <section className="card">
        <ChartHeader
          title="Budget vs. actual"
          subtitle={`${monthYear(budgetMonth)} — per main category`}
          right={<MonthPicker value={budgetMonth} onChange={setBudgetMonth} />}
        />
        <BudgetVsActualChart data={budget.data ?? []} loading={budget.isLoading} />
      </section>
    </div>
  );
}

// ---- Sub-components -------------------------------------------------------

function RangeSelector({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-default bg-surface p-1 gap-1">
      {RANGE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={clsx(
            'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
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

function ChartSkeleton({ height = 280 }: { height?: number }) {
  return <div className="w-full rounded-lg bg-slate-100 dark:bg-slate-700/50 animate-pulse" style={{ height }} />;
}

// ---- 1. Cash Flow Chart --------------------------------------------------

function CashFlowChart({ data, loading }: { data: CashFlowPoint[]; loading: boolean }) {
  if (loading) return <ChartSkeleton />;
  if (data.length === 0) return <EmptyState message="No transactions yet. Add some to see your cash flow." />;
  const hasAnyActivity = data.some((p) => p.income > 0 || p.expense > 0);
  if (!hasAnyActivity) return <EmptyState message="No income or expenses in this range." />;

  const config: ChartConfig = {
    income: { label: 'Income', color: '#10b981' },
    expense: { label: 'Expense', color: '#ef4444' },
    net: { label: 'Net', color: '#f59e0b' },
  };

  return (
    <ChartContainer config={config} className="h-[280px]">
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="cf-income-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="cf-expense-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#ef4444" stopOpacity={0.05} />
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
          stroke="#10b981"
          strokeWidth={2}
          fill="url(#cf-income-grad)"
          stackId="1"
        />
        <Area
          type="monotone"
          dataKey="expense"
          stroke="#ef4444"
          strokeWidth={2}
          fill="url(#cf-expense-grad)"
          stackId="2"
        />
      </AreaChart>
    </ChartContainer>
  );
}

// ---- 2. Net Worth Chart --------------------------------------------------

function NetWorthChart({ data, loading }: { data: NetWorthPoint[]; loading: boolean }) {
  if (loading) return <ChartSkeleton />;
  if (data.length === 0) return <EmptyState message="No accounts yet. Add an account to track net worth." />;

  const config: ChartConfig = {
    netWorth: { label: 'Net worth', color: '#0ea5e9' },
  };

  // Split the area at zero — a clean emerald fill above 0, rose below —
  // so the user sees at a glance whether they're in the red.
  const allPositive = data.every((p) => p.netWorth >= 0);

  return (
    <ChartContainer config={config} className="h-[280px]">
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="nw-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={allPositive ? '#0ea5e9' : '#10b981'} stopOpacity={0.4} />
            <stop offset="100%" stopColor={allPositive ? '#0ea5e9' : '#10b981'} stopOpacity={0.05} />
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
          dataKey="netWorth"
          stroke={allPositive ? '#0ea5e9' : '#10b981'}
          strokeWidth={2}
          fill="url(#nw-grad)"
        />
      </AreaChart>
    </ChartContainer>
  );
}

// ---- 3. Spending Donut ---------------------------------------------------

function SpendingDonut({ data, loading }: { data: CategorySpend[]; loading: boolean }) {
  if (loading) return <ChartSkeleton height={280} />;
  if (data.length === 0) return <EmptyState message="No spending recorded for this month." />;

  const config: ChartConfig = {};
  data.forEach((c, i) => {
    config[c.category] = { label: c.category, color: SLICE_PALETTE[i % SLICE_PALETTE.length]! };
  });
  const total = data.reduce((s, c) => s + c.total, 0);

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-center">
      <ChartContainer config={config} className="h-[240px] flex-1 min-w-0">
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
  );
}

// ---- 4. Top Merchants ----------------------------------------------------

function TopMerchantsChart({ data, loading }: { data: MerchantTotal[]; loading: boolean }) {
  if (loading) return <ChartSkeleton height={Math.max(280, data.length * 32)} />;
  if (data.length === 0) return <EmptyState message="No merchant spending in this range." />;

  const config: ChartConfig = {
    total: { label: 'Spend', color: '#8b5cf6' },
  };
  // Reverse so the largest sits at the top of the horizontal bar chart.
  const reversed = [...data].reverse();
  const height = Math.max(280, data.length * 36);

  return (
    <ChartContainer config={config} style={{ height }}>
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
        <Bar dataKey="total" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

// ---- 5. Budget vs Actual -------------------------------------------------

function BudgetVsActualChart({ data, loading }: { data: BudgetRow[]; loading: boolean }) {
  if (loading) return <ChartSkeleton height={Math.max(280, data.length * 32)} />;
  if (data.length === 0) return <EmptyState message="No budget set for this month, and no spending recorded." />;

  const config: ChartConfig = {
    planned: { label: 'Planned', color: '#94a3b8' },
    actual: { label: 'Actual', color: '#f59e0b' },
  };
  const height = Math.max(280, data.length * 40);

  return (
    <ChartContainer config={config} style={{ height }}>
      <BarChart
        data={data}
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
          dataKey="category"
          tickLine={false}
          axisLine={false}
          width={120}
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
        <Bar dataKey="planned" fill="#94a3b8" radius={[0, 4, 4, 0]} />
        <Bar dataKey="actual" fill="#f59e0b" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
