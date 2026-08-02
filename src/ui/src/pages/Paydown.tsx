/**
 * Paydown — Monarch-style debt paydown dashboard.
 *
 *   - Summary cards (current principal, projected interest, total P&I,
 *     debt-free month).
 *   - Color-coded projection chart (one line per active account + a
 *     dotted "baseline" for the current plan when simulating).
 *   - Savings calculator: method (Planned / Avalanche / Snowball) +
 *     monthly extra + one-time extra. Recomputes live.
 *   - Per-account list: name, balance, APR, min/planned, include toggle.
 *   - "Manage" modal to bulk-toggle includeInPaydown.
 *
 *   The calculator runs server-side via /api/paydown/simulate (or
 *   /api/paydown/projection for the no-simulation case). We always
 *   re-fetch on calculator change rather than computing in the browser
 *   so the server is the single source of truth for the math.
 */
import { useState, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { formatMoney, currentYearMonth, timeAgo } from '../lib/format';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '../components/ui/chart';
import {
  CreditCard,
  Banknote,
  TrendingDown,
  Calendar,
  X,
  Check,
  Pencil,
  AlertTriangle,
  ArrowUpRight,
  Save,
} from 'lucide-react';
import { SummaryCard } from '../components/SummaryCard';
import { SavingsCalculatorPanel } from '../components/SavingsCalculatorPanel';
import clsx from 'clsx';

type Method = 'planned' | 'avalanche' | 'snowball';

interface PaydownAccount {
  id: string;
  name: string;
  type: 'checking' | 'savings' | 'credit' | 'investment' | 'loan';
  balance: number;
  institution?: string;
  interestRate: number;
  minPayment: number;
  plannedPayment: number;
  includeInPaydown: boolean;
}

interface PaydownAccountResult {
  accountId: string;
  name: string;
  startingBalance: number;
  apr: number;
  payoffMonth: string | null;
  monthsToPayoff: number | null;
  totalInterest: number;
  totalPaid: number;
}

interface PaydownPoint {
  month: string;
  totalDebt: number;
  byAccount: Record<string, number>;
}

interface PaydownProjection {
  method: Method;
  params: { method: Method; monthlyExtra: number; oneTimeExtra: number };
  startingTotal: number;
  totalInterest: number;
  totalPaid: number;
  monthsToDebtFree: number | null;
  debtFreeMonth: string | null;
  perAccount: PaydownAccountResult[];
  timeline: PaydownPoint[];
  baselineTimeline: PaydownPoint[];
  baselineTotalInterest: number;
  baselineMonthsToDebtFree: number | null;
  baselineDebtFreeMonth: string | null;
}

const EMPTY: PaydownProjection = {
  method: 'planned',
  params: { method: 'planned', monthlyExtra: 0, oneTimeExtra: 0 },
  startingTotal: 0,
  totalInterest: 0,
  totalPaid: 0,
  monthsToDebtFree: null,
  debtFreeMonth: null,
  perAccount: [],
  timeline: [],
  baselineTimeline: [],
  baselineTotalInterest: 0,
  baselineMonthsToDebtFree: null,
  baselineDebtFreeMonth: null,
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthShort(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${y.slice(2)}`;
}
function monthLong(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

export function Paydown() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [toast, setToast] = useState<{ rowCount: number; ym: string } | null>(null);

  // Baseline projection — "Planned" with no extras. Drives the chart
  // when no simulation is active.
  const baseline = useQuery({
    queryKey: ['paydown', 'projection'],
    queryFn: () => api.get<PaydownProjection>('/api/paydown/projection'),
  });

  // Calculator state. The user toggles a method or enters an extra
  // payment and we re-run the simulation.
  const [method, setMethod] = useState<Method>('avalanche');
  const [monthlyExtra, setMonthlyExtra] = useState('');
  const [oneTimeExtra, setOneTimeExtra] = useState('');
  const [showSim, setShowSim] = useState(false);
  const monthlyExtraNum = Number(monthlyExtra) || 0;
  const oneTimeExtraNum = Number(oneTimeExtra) || 0;
  const simulation = useQuery({
    queryKey: ['paydown', 'simulate', method, monthlyExtraNum, oneTimeExtraNum],
    queryFn: () =>
      api.post<PaydownProjection>('/api/paydown/simulate', {
        method,
        monthlyExtra: monthlyExtraNum,
        oneTimeExtra: oneTimeExtraNum,
      }),
    enabled: showSim,
  });

  const accounts = useQuery({
    queryKey: ['paydown', 'accounts'],
    queryFn: () => api.get<PaydownAccount[]>('/api/paydown/accounts'),
  });

  const patchAccount = useMutation({
    mutationFn: (input: { id: string; patch: Partial<PaydownAccount> }) =>
      api.patch(`/api/paydown/account/${input.id}`, input.patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['paydown'] });
    },
  });

  const currentYm = currentYearMonth();
  const hasAnyLiabilityAccount = (accounts.data ?? []).some((a) => a.balance > 0);

  // Snapshot metadata for the current month — drives the "Last synced" badge
  // below the H1 and the Budget page's Pay down modal.
  const snapshotMeta = useQuery<{ syncedAt: string | null; rowCount: number } | null>({
    queryKey: ['paydown', 'snapshot-meta', currentYm],
    queryFn: () =>
      api.get<{ rows: unknown[]; meta: { syncedAt: string | null; rowCount: number } }>(`/api/paydown/snapshot/${currentYm}`).then((d) => d.meta),
    enabled: hasAnyLiabilityAccount,
  });

  const syncToBudget = useMutation({
    mutationFn: (yearMonth: string) => {
      // When a scenario is active, ship method + extras so the server
      // can allocate the extra payment to the priority account under the
      // chosen method (Monarch-style Save to Budget).
      const scenarioActive = showSim;
      return api.post<{ ok: boolean; rowCount: number; syncedAt: string }>('/api/paydown/sync', {
        yearMonth,
        ...(scenarioActive && {
          method,
          monthlyExtra: monthlyExtraNum,
          oneTimeExtra: oneTimeExtraNum,
        }),
      });
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['paydown'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setToast({ rowCount: result.rowCount, ym: currentYm });
    },
  });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const editing = baseline.data ?? EMPTY;
  const active = simulation.data ?? (showSim ? null : editing);
  const projection = active ?? editing;
  const isSimulated = !!(showSim && simulation.data);

  // Single clear path so banner, modal, and chart Clear button all
  // reset to the same baseline state.
  const clearSimulation = () => {
    setShowSim(false);
    setMonthlyExtra('');
    setOneTimeExtra('');
    setMethod('planned');
  };

  const methodLabel = method === 'planned' ? 'Planned payments' : method === 'avalanche' ? 'Debt avalanche' : 'Debt snowball';

  // Per-account list — merged from DB accounts + projection results.
  // We need the projection's payoff month / interest, so we index by id.
  const byId = new Map<string, PaydownAccountResult>();
  for (const r of editing.perAccount) byId.set(r.accountId, r);

  // SVG chart.
  const accList = accounts.data ?? [];
  const hasAnyDebt = accList.some((a) => a.balance > 0);
  const accountColor = (idx: number) => {
    const palette = ['#f59e0b', '#0ea5e9', '#10b981', '#8b5cf6', '#ef4444', '#ec4899', '#14b8a6', '#f97316'];
    return palette[idx % palette.length];
  };

  // An account is "unpayable" when it's included in the paydown plan
  // and has a balance but neither a minimum nor a planned payment.
  // Without any payment the planned-method projection runs flat for
  // the full 60-month horizon and the chart never produces a payoff
  // date. Detect this so we can render ∞ + a "set a minimum payment"
  // banner instead of a chart that looks broken.
  const unpayableAccounts = accList.filter(
    (a) => a.includeInPaydown && a.balance > 0 && (a.minPayment || 0) <= 0 && (a.plannedPayment || 0) <= 0,
  );
  const unpayableIds = new Set(unpayableAccounts.map((a) => a.id));
  const hasUnpayable = unpayableAccounts.length > 0;
  // debtFreeMonth is null either because an account is unpayable OR
  // because the 60-month horizon ran out (e.g. a 30-year mortgage at
  // minimums). Distinguish the two so the sub-text is accurate.
  const beyondHorizon = !hasUnpayable && projection.debtFreeMonth === null && projection.timeline.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold fg-primary">Pay down</h1>
          <p className="text-sm fg-tertiary max-w-xl mt-1">
            Every credit card and loan is a goal. Set your interest rates
            and minimums, then experiment with payoff methods to see how
            much you can save.
          </p>
          <p className="text-xs fg-muted mt-2">
            Syncs your paydown plan to the Budget page for this month.
            {snapshotMeta.data?.syncedAt && (
              <> · Last synced: <span className="fg-secondary tabular-nums">{timeAgo(snapshotMeta.data.syncedAt)}</span></>
            )}
          </p>
        </div>
        {hasAnyDebt && (
          <div className="flex flex-col items-end gap-1 shrink-0">
            <button
              type="button"
              onClick={() => syncToBudget.mutate(currentYm)}
              disabled={syncToBudget.isPending}
              className="btn-primary inline-flex items-center gap-2 disabled:opacity-50 min-h-[44px]"
              title={`Snapshot every included credit/loan account's planned payment for ${monthShort(currentYm)} into the Budget page`}
            >
              <Save className="h-4 w-4" />
              {syncToBudget.isPending ? 'Saving…' : 'Save to Budget'}
            </button>
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border border-default bg-surface shadow-lg px-4 py-3 text-sm flex items-start gap-3">
          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="fg-primary">
              {toast.rowCount === 0
                ? 'No accounts included — toggle Include on at least one card to snapshot.'
                : `Saved ${toast.rowCount} ${toast.rowCount === 1 ? 'account' : 'accounts'} to Budget for ${monthShort(toast.ym)}.`}
            </div>
            {toast.rowCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setToast(null);
                  navigate('/budget');
                }}
                className="mt-1 inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 hover:underline"
              >
                Open Budget <ArrowUpRight className="h-3 w-3" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="fg-muted hover:fg-secondary"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {!hasAnyDebt && (
        <div className="card text-sm fg-tertiary">
          <div className="font-semibold mb-1">No debt accounts yet</div>
          <p>
            Add a credit card or loan on the <a href="/accounts" className="underline">Accounts page</a>
            {' '}and it'll show up here automatically. The pay-down
            dashboard tracks every liability you owe on.
          </p>
        </div>
      )}

      {hasAnyDebt && (
        <>
          {/* Method banner — only when a scenario is active. Matches the
             Monarch-style "Utilizing the X Method" strip. */}
          {isSimulated && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/30 px-4 py-2.5">
              <div className="text-sm text-rose-900 dark:text-rose-100 min-w-0">
                <span className="fg-muted">Utilizing the </span>
                <span className="font-semibold capitalize">{methodLabel}</span>
                {monthlyExtraNum > 0 && (
                  <span className="fg-muted"> with {formatMoney(monthlyExtraNum)} monthly extra</span>
                )}
                {oneTimeExtraNum > 0 && (
                  <span className="fg-muted"> + {formatMoney(oneTimeExtraNum)} one-time</span>
                )}
              </div>
              <button
                type="button"
                onClick={clearSimulation}
                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/50 min-h-[36px] shrink-0"
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </button>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid gap-3 md:grid-cols-4">
            <SummaryCard
              icon={<Banknote className="h-4 w-4" />}
              label="Current debt"
              sub="Across all accounts"
              value={formatMoney(projection.startingTotal)}
              tone="slate"
            />
            <SummaryCard
              icon={<TrendingDown className="h-4 w-4" />}
              label="Projected interest"
              sub={isSimulated ? 'Under this scenario' : 'Total interest to pay'}
              value={formatMoney(projection.totalInterest)}
              tone="rose"
            />
            <SummaryCard
              icon={<Banknote className="h-4 w-4" />}
              label="Total P + I"
              sub="Principal + interest"
              value={formatMoney(projection.totalPaid)}
              tone="amber"
            />
            <SummaryCard
              icon={<Calendar className="h-4 w-4" />}
              label="Debt-free"
              sub={
                hasUnpayable
                  ? 'Cannot calculate — set a minimum payment'
                  : beyondHorizon
                    ? 'Beyond 40 years at this rate'
                    : projection.debtFreeMonth
                      ? 'Projected payoff month'
                      : 'Never under this plan'
              }
              value={
                hasUnpayable || beyondHorizon
                  ? '∞'
                  : projection.debtFreeMonth
                    ? monthLong(projection.debtFreeMonth)
                    : '—'
              }
              tone={hasUnpayable || beyondHorizon ? 'amber' : 'emerald'}
            />
          </div>

          {/* Chart */}
          <section className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Payoff projection</h2>
              {isSimulated && (
                <span className="text-xs fg-muted">
                  {methodLabel}
                  {monthlyExtraNum > 0 && ` · ${formatMoney(monthlyExtraNum)}/mo`}
                  {oneTimeExtraNum > 0 && ` + ${formatMoney(oneTimeExtraNum)} one-time`}
                </span>
              )}
            </div>
            {hasUnpayable && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-900/30 p-3 text-xs text-amber-800 dark:text-amber-200 mb-3">
                <div className="font-semibold mb-1 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Cannot calculate payoff
                </div>
                <p>
                  {unpayableAccounts.length === 1 ? (
                    <>
                      <span className="font-medium">{unpayableAccounts[0]!.name}</span> has no minimum or planned payment.
                    </>
                  ) : (
                    <>
                      {unpayableAccounts.length} accounts have no minimum or planned payment: {unpayableAccounts.map((a) => a.name).join(', ')}.
                    </>
                  )}
                  {' '}Set a minimum payment on each to project a payoff date.
                </p>
              </div>
            )}
            <PayoffChart
              accounts={accList.filter((a) => a.includeInPaydown)}
              projection={projection}
              isSimulated={isSimulated}
              colorOf={accountColor}
            />
          </section>

          {/* Per-account list + calculator panel */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <section className="card lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold fg-primary">Your debt accounts</h2>
                <span className="text-xs fg-muted">
                  {accList.filter((a) => a.includeInPaydown).length} of {accList.length} included
                </span>
              </div>
              <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                {accList.map((a, i) => {
                  const r = byId.get(a.id);
                  return (
                    <li key={a.id} className="py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: a.includeInPaydown ? accountColor(i) : '#cbd5e1' }}
                          title={a.includeInPaydown ? 'Included' : 'Excluded'}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm flex items-center gap-2 fg-primary">
                            {a.type === 'credit' ? <CreditCard className="h-3.5 w-3.5 fg-muted" /> : <Banknote className="h-3.5 w-3.5 fg-muted" />}
                            {a.name}
                          </div>
                          <div className="text-xs fg-muted mt-0.5">
                            <span className="text-rose-600 dark:text-rose-400 font-medium">−{formatMoney(a.balance)}</span> · {(a.interestRate * 100).toFixed(2)}% APR
                            {a.includeInPaydown && unpayableIds.has(a.id) && (
                              <>
                                {' · '}
                                <span className="text-amber-700 dark:text-amber-400 font-medium">∞ no payment set</span>
                              </>
                            )}
                            {r?.payoffMonth && a.includeInPaydown && !unpayableIds.has(a.id) && (
                              <> · payoff {monthShort(r.payoffMonth)}</>
                            )}
                            {r && a.includeInPaydown && r.totalInterest > 0 && (
                              <> · {formatMoney(r.totalInterest)} interest</>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => patchAccount.mutate({ id: a.id, patch: { includeInPaydown: !a.includeInPaydown } })}
                          className={clsx(
                            'rounded-lg px-2.5 py-1.5 text-xs font-medium',
                            a.includeInPaydown
                              ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600',
                          )}
                        >
                          {a.includeInPaydown ? 'Included' : 'Excluded'}
                        </button>
                        <AccountEditModal
                          account={a}
                          onSave={(patch) => patchAccount.mutate({ id: a.id, patch })}
                        />
                      </div>
                    </li>
                  );
                })}
                {accList.length === 0 && (
                  <li className="py-6 text-center text-sm fg-muted">
                    No credit cards or loans. Add one to start tracking paydown.
                  </li>
                )}
              </ul>
            </section>

            <div className="lg:col-span-1">
              <SavingsCalculatorPanel
                method={method}
                setMethod={setMethod}
                monthlyExtra={monthlyExtra}
                setMonthlyExtra={setMonthlyExtra}
                oneTimeExtra={oneTimeExtra}
                setOneTimeExtra={setOneTimeExtra}
                setShowSim={setShowSim}
                isSimulated={isSimulated}
                projection={
                  isSimulated && simulation.data
                    ? {
                        baselineTotalInterest: simulation.data.baselineTotalInterest,
                        totalInterest: simulation.data.totalInterest,
                        baselineDebtFreeMonth: simulation.data.baselineDebtFreeMonth,
                        debtFreeMonth: simulation.data.debtFreeMonth,
                      }
                    : null
                }
                monthlyExtraNum={monthlyExtraNum}
                oneTimeExtraNum={oneTimeExtraNum}
                formatMoney={formatMoney}
                ymToMonths={ymToMonths}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Convert "YYYY-MM" to a month count from a fixed origin so we can diff
// two months safely (handles wrap-around year boundaries).
function ymToMonths(ym: string): number {
  const [y, m] = ym.split('-');
  return Number(y) * 12 + Number(m);
}

function PayoffChart({
  accounts,
  projection,
  isSimulated,
  colorOf,
}: {
  accounts: PaydownAccount[];
  projection: PaydownProjection;
  isSimulated: boolean;
  colorOf: (i: number) => string;
}) {
  const fullPoints = projection.timeline;
  if (fullPoints.length === 0) {
    return <div className="py-10 text-center text-sm fg-muted">No data yet.</div>;
  }
  if (accounts.length === 0) {
    return (
      <div className="py-10 text-center text-sm fg-muted">
        No accounts included in paydown. Toggle one in the list below.
      </div>
    );
  }

  // Per-account payoff index, used to break the line at the payoff
  // month. After the account hits zero we set the value to `null` and
  // `connectNulls={false}` so the line stops there — no flat-at-zero
  // trails across a 30-year mortgage.
  const payoffIdx = new Map<string, number>();
  for (const r of projection.perAccount) {
    if (r.payoffMonth === null) continue;
    const idx = fullPoints.findIndex((p) => p.month === r.payoffMonth);
    if (idx >= 0) payoffIdx.set(r.accountId, idx);
  }

  // Flatten the per-account balances into the row shape Recharts wants.
  // One column per account, plus `total` and (when simulated) `baseline`.
  const chartData = fullPoints.map((p, i) => {
    const row: Record<string, string | number | null> = {
      month: p.month,
      total: p.totalDebt,
    };
    for (const a of accounts) {
      const paidIdx = payoffIdx.get(a.id);
      row[a.id] = paidIdx !== undefined && i > paidIdx ? null : (p.byAccount[a.id] ?? 0);
    }
    if (isSimulated) {
      const bp = projection.baselineTimeline[i];
      if (bp) row.baseline = bp.totalDebt;
    }
    return row;
  });

  // Chart config: one entry per series. Colors reference CSS variables
  // so light/dark mode flips automatically (see styles.css).
  const chartConfig: ChartConfig = {
    total: { label: 'Total debt', color: 'var(--chart-total)' },
    baseline: { label: 'Baseline', color: 'var(--chart-baseline)' },
  };
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i]!;
    chartConfig[a.id] = { label: a.name, color: colorOf(i) };
  }

  // Vertical "debt-free" markers — one per account that gets paid off
  // inside the timeline. The tooltip already shows the exact month; the
  // line is just a visual cue.
  const payoffMarkers = projection.perAccount
    .filter((r) => r.payoffMonth !== null)
    .map((r) => ({ accountId: r.accountId, month: r.payoffMonth! }));

  // X-axis label format: year-only when the range is long enough that
  // month labels would crowd. Recharts' `minTickGap` handles the actual
  // stride — we just decide the text format.
  const firstMonth = fullPoints[0]!.month;
  const lastMonth = fullPoints[fullPoints.length - 1]!.month;
  const yearRange = Number(lastMonth.slice(0, 4)) - Number(firstMonth.slice(0, 4));
  const xTickFormatter = (value: string) =>
    yearRange > 5 ? value.slice(0, 4) : monthShort(value);

  // Chart width: long timelines get a wider canvas so the line has room
  // to breathe. Short timelines snap to 600px and fit without scrolling.
  // The wrapper's `overflow-x-auto` kicks in when the chart exceeds the
  // container — no "show full" toggle needed.
  const chartWidth = Math.max(600, chartData.length * 5);

  return (
    <div className="overflow-x-auto pb-2">
      <div style={{ minWidth: chartWidth }}>
        <ChartContainer config={chartConfig} className="h-[360px]">
          <LineChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 10 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              interval="preserveStartEnd"
              tickFormatter={xTickFormatter}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => formatTick(Number(v))}
              width={60}
            />
            <ChartTooltip
              cursor={{ stroke: 'var(--chart-axis)', strokeWidth: 1, strokeDasharray: '2 3' }}
              content={<ChartTooltipContent config={chartConfig} />}
            />
            {isSimulated && (
              <Line
                type="natural"
                dataKey="baseline"
                stroke="var(--color-baseline)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
              />
            )}
            <Line
              type="natural"
              dataKey="total"
              stroke="var(--color-total)"
              strokeWidth={2.5}
              dot={false}
            />
            {accounts.map((a, i) => (
              <Line
                key={a.id}
                type="natural"
                dataKey={a.id}
                stroke={`var(--color-${a.id})`}
                strokeWidth={1.5}
                dot={false}
                opacity={0.55}
                connectNulls={false}
              />
            ))}
            {payoffMarkers.map((m) => (
              <ReferenceLine
                key={m.accountId}
                x={m.month}
                stroke="var(--chart-grid)"
                strokeDasharray="2 3"
                label={{
                  value: monthShort(m.month),
                  position: 'top',
                  fontSize: 9,
                  fill: 'var(--chart-axis)',
                }}
              />
            ))}
          </LineChart>
        </ChartContainer>
      </div>
    </div>
  );
}

function formatTick(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}

// ---- Account edit modal -------------------------------------------------

function AccountEditModal({
  account,
  onSave,
}: {
  account: PaydownAccount;
  onSave: (patch: { interestRate: number; minPayment: number; plannedPayment: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  // Preserve up to 4 decimal places on the way in — the old toFixed(2)
  // was silently rounding 6.375% to 6.38% the moment the modal opened.
  const [apr, setApr] = useState(String(Number((account.interestRate * 100).toFixed(4))));
  const [min, setMin] = useState(String(account.minPayment));
  const [planned, setPlanned] = useState(String(account.plannedPayment));
  // Credit / loan accounts require a non-zero minimum payment or the
  // paydown chart never produces a payoff date. Disable Save until the
  // user enters something > 0 and surface the reason inline.
  const minNum = Number(min) || 0;
  const requiresMin = account.type === 'credit' || account.type === 'loan';
  const canSave = !requiresMin || minNum > 0;
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg p-1.5 fg-muted hover:bg-slate-100 dark:hover:bg-slate-700 hover:fg-secondary"
        title="Edit account details"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    );
  }
  const INPUT_CLS = 'rounded-lg border border-default bg-surface fg-primary placeholder-slate-400 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
      <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold fg-primary">Edit {account.name}</h3>
          <button onClick={() => setOpen(false)} className="fg-muted hover:fg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSave) return;
            const aprNum = (Number(apr) || 0) / 100;
            const planNum = Number(planned) || 0;
            onSave({ interestRate: aprNum, minPayment: minNum, plannedPayment: planNum });
            setOpen(false);
          }}
          className="space-y-3"
        >
          <label className="block">
            <span className="text-sm fg-secondary">Interest rate / APR (%)</span>
            <input
              type="number"
              step="0.0001"
              min="0"
              max="100"
              value={apr}
              onChange={(e) => setApr(e.target.value)}
              className={`mt-1 w-full ${INPUT_CLS} tabular-nums`}
            />
            <span className="text-[10px] fg-muted">Set to 0 for 0% APR (e.g. intro rate, paid-in-full card)</span>
          </label>
          <label className="block">
            <span className="text-sm fg-secondary">Minimum monthly payment</span>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 fg-muted text-sm">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={min}
                onChange={(e) => setMin(e.target.value)}
                aria-invalid={requiresMin && minNum <= 0}
                className={`w-full ${INPUT_CLS} pl-7 pr-3 ${requiresMin && minNum <= 0 ? 'border-rose-400 dark:border-rose-500' : ''}`}
              />
            </div>
            {requiresMin && minNum <= 0 ? (
              <span className="text-[10px] text-rose-600 dark:text-rose-400">Required — credit and loan accounts need a minimum payment to project a payoff.</span>
            ) : (
              <span className="text-[10px] fg-muted">Principal + interest only. Don't include tax/insurance.</span>
            )}
          </label>
          <label className="block">
            <span className="text-sm fg-secondary">Planned monthly payment <span className="fg-muted font-normal">(optional)</span></span>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 fg-muted text-sm">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={planned}
                onChange={(e) => setPlanned(e.target.value)}
                placeholder="0"
                className={`w-full ${INPUT_CLS} pl-7 pr-3`}
              />
            </div>
            <span className="text-[10px] fg-muted">Leave 0 to use the minimum. Only set if you plan to pay more than the minimum.</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-sm fg-tertiary hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">
              Cancel
            </button>
            <button type="submit" disabled={!canSave} className="btn-primary flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed">
              <Check className="h-4 w-4" /> Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
