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
import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { currencySymbol, formatMoney, currentYearMonth, timeAgo } from '../lib/format';
import { Dialog } from '../components/ui/dialog';
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
import { AsyncQueryState } from '../components/ui/AsyncQueryState';

type Method = 'planned' | 'avalanche' | 'snowball';

interface PaydownAccount {
  id: string;
  name: string;
  type: 'checking' | 'savings' | 'credit' | 'investment' | 'loan' | 'uncategorized';
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

// Persist the savings-calculator scenario so leaving Pay down and
// coming back keeps the same extras / method / chart. Matches the
// theme + sidebar localStorage pattern (UI preference, not server data).
const SCENARIO_KEY = 'cura.paydown.scenario';

interface StoredScenario {
  method: Method;
  monthlyExtra: string;
  oneTimeExtra: string;
  showSim: boolean;
}

interface SavedScenario {
  method: Method;
  monthlyExtra: number;
  oneTimeExtra: number;
}

interface SavedPaydownSnapshot {
  rows: Array<{
    accountId: string;
    accountName: string;
    type: 'credit' | 'loan';
    apr: number;
    planned: number;
    actual: number;
    remaining: number;
  }>;
  meta: { syncedAt: string | null; rowCount: number };
}

interface SaveToBudgetResult {
  ok: boolean;
  rowCount: number;
  syncedAt: string;
  scenario: SavedScenario;
  snapshot: SavedPaydownSnapshot;
}

interface SaveToBudgetInput extends SavedScenario {
  yearMonth: string;
}

const DEFAULT_SCENARIO: StoredScenario = {
  method: 'avalanche',
  monthlyExtra: '',
  oneTimeExtra: '',
  showSim: false,
};

function loadScenario(): StoredScenario {
  try {
    const raw = localStorage.getItem(SCENARIO_KEY);
    if (!raw) return DEFAULT_SCENARIO;
    const parsed = JSON.parse(raw) as Partial<StoredScenario>;
    const method: Method =
      parsed.method === 'planned' || parsed.method === 'avalanche' || parsed.method === 'snowball'
        ? parsed.method
        : DEFAULT_SCENARIO.method;
    return {
      method,
      monthlyExtra: typeof parsed.monthlyExtra === 'string' ? parsed.monthlyExtra : '',
      oneTimeExtra: typeof parsed.oneTimeExtra === 'string' ? parsed.oneTimeExtra : '',
      showSim: Boolean(parsed.showSim),
    };
  } catch {
    return DEFAULT_SCENARIO;
  }
}

function saveScenario(scenario: StoredScenario): void {
  try {
    localStorage.setItem(SCENARIO_KEY, JSON.stringify(scenario));
  } catch {
    /* private mode — calculator still works for the session */
  }
}

function parseExtraPayment(value: string): number | null {
  if (value.trim() === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

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
  const [toast, setToast] = useState<{
    rowCount: number;
    ym: string;
    scenario: SavedScenario;
  } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Baseline projection — "Planned" with no extras. Drives the chart
  // when no simulation is active.
  const baseline = useQuery({
    queryKey: ['paydown', 'projection'],
    queryFn: () => api.get<PaydownProjection>('/api/paydown/projection'),
  });

  // Calculator state. Hydrated from localStorage so navigating away
  // (or a full reload) restores the last scenario — extra payments,
  // method, and whether the sim chart was active.
  const [scenario, setScenario] = useState<StoredScenario>(() => loadScenario());
  const scenarioEdited = useRef(false);
  const { method, monthlyExtra, oneTimeExtra, showSim } = scenario;
  const setMethod = (m: Method) => {
    scenarioEdited.current = true;
    setScenario((s) => ({ ...s, method: m }));
  };
  const setMonthlyExtra = (v: string) => {
    scenarioEdited.current = true;
    setScenario((s) => ({ ...s, monthlyExtra: v }));
  };
  const setOneTimeExtra = (v: string) => {
    scenarioEdited.current = true;
    setScenario((s) => ({ ...s, oneTimeExtra: v }));
  };
  const setShowSim = (v: boolean) => {
    scenarioEdited.current = true;
    setScenario((s) => ({ ...s, showSim: v }));
  };
  const monthlyExtraNum = parseExtraPayment(monthlyExtra) ?? 0;
  const oneTimeExtraNum = parseExtraPayment(oneTimeExtra) ?? 0;

  // Keep the stored scenario in sync with the live calculator.
  useEffect(() => {
    saveScenario(scenario);
  }, [scenario]);

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['paydown'] }),
  });

  const currentYm = currentYearMonth();
  const hasAnyLiabilityAccount = (accounts.data ?? []).some((a) => a.balance > 0);

  const savedScenario = useQuery<{ scenario: SavedScenario | null }>({
    queryKey: ['paydown', 'scenario', currentYm],
    queryFn: () => api.get<{ scenario: SavedScenario | null }>(`/api/paydown/scenario/${currentYm}`),
  });
  const hydratedSavedScenario = useRef(false);
  useEffect(() => {
    if (hydratedSavedScenario.current || !savedScenario.isSuccess) return;
    hydratedSavedScenario.current = true;
    if (scenarioEdited.current || !savedScenario.data.scenario) return;
    const saved = savedScenario.data.scenario;
    setScenario({
      method: saved.method,
      monthlyExtra: String(saved.monthlyExtra),
      oneTimeExtra: String(saved.oneTimeExtra),
      showSim: saved.monthlyExtra > 0 || saved.oneTimeExtra > 0 || saved.method !== 'planned',
    });
  }, [savedScenario.data, savedScenario.isSuccess]);

  // Snapshot metadata for the current month — drives the "Last synced" badge
  // below the H1 and the Budget page's Pay down modal.
  const snapshotMeta = useQuery<{ syncedAt: string | null; rowCount: number } | null>({
    queryKey: ['paydown', 'snapshot-meta', currentYm],
    queryFn: () =>
      api.get<{ rows: unknown[]; meta: { syncedAt: string | null; rowCount: number } }>(`/api/paydown/snapshot/${currentYm}`).then((d) => d.meta),
    enabled: hasAnyLiabilityAccount,
  });

  const syncToBudget = useMutation({
    mutationFn: async (input: SaveToBudgetInput) => {
      const result = await api.post<SaveToBudgetResult>('/api/paydown/sync', input);
      const expectedMonthly = input.method === 'planned' ? 0 : input.monthlyExtra;
      const expectedOneTime = input.method === 'planned' ? 0 : input.oneTimeExtra;
      if (
        result.scenario.method !== input.method
        || result.scenario.monthlyExtra !== expectedMonthly
        || result.scenario.oneTimeExtra !== expectedOneTime
      ) {
        throw new Error('The saved paydown scenario did not match the calculator values. Please try again.');
      }
      return result;
    },
    onSuccess: (result) => {
      setSyncError(null);
      scenarioEdited.current = false;
      setScenario({
        method: result.scenario.method,
        monthlyExtra: String(result.scenario.monthlyExtra),
        oneTimeExtra: String(result.scenario.oneTimeExtra),
        showSim: result.scenario.method !== 'planned',
      });
      qc.setQueryData(['paydown', 'scenario', currentYm], { scenario: result.scenario });
      qc.setQueryData(['paydown', 'snapshot', currentYm], result.snapshot);
      qc.invalidateQueries({ queryKey: ['paydown'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['budget'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
      setToast({ rowCount: result.rowCount, ym: currentYm, scenario: result.scenario });
    },
    onError: (error) => {
      setSyncError(error.message || 'Failed to save to budget. Please try again.');
    },
  });

  const saveToBudget = () => {
    const parsedMonthly = parseExtraPayment(monthlyExtra);
    const parsedOneTime = parseExtraPayment(oneTimeExtra);
    if (parsedMonthly === null || parsedOneTime === null) {
      setSyncError('Extra payments must be valid amounts of zero or more.');
      return;
    }
    syncToBudget.mutate({
      yearMonth: currentYm,
      method,
      monthlyExtra: method === 'planned' ? 0 : parsedMonthly,
      oneTimeExtra: method === 'planned' ? 0 : parsedOneTime,
    });
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!syncError) return;
    const t = setTimeout(() => setSyncError(null), 5000);
    return () => clearTimeout(t);
  }, [syncError]);

  if (accounts.isLoading || baseline.isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold fg-primary">Pay down</h1>
        <AsyncQueryState status="loading" title="Loading your paydown plan…" message="Fetching debt accounts and the baseline projection." />
      </div>
    );
  }

  if (accounts.isError || baseline.isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold fg-primary">Pay down</h1>
        <AsyncQueryState
          status="error"
          title="Could not load your paydown plan"
          message="Debt accounts or the baseline projection are unavailable, so payoff amounts are hidden."
          onRetry={() => void Promise.all([accounts.refetch(), baseline.refetch()])}
          retrying={accounts.isFetching || baseline.isFetching}
        />
      </div>
    );
  }

  const editing = baseline.data ?? EMPTY;
  const active = !simulation.isError ? simulation.data ?? (showSim ? null : editing) : null;
  const projection = active ?? editing;
  const isSimulated = !!(showSim && simulation.data && !simulation.isError);

  // Single clear path so banner, modal, and chart Clear button all
  // reset to the same baseline state. The useEffect above writes the
  // cleared values to localStorage so a return visit stays cleared.
  const clearSimulation = () => {
    scenarioEdited.current = true;
    setScenario({
      method: 'planned',
      monthlyExtra: '',
      oneTimeExtra: '',
      showSim: false,
    });
  };

  const methodLabel = method === 'planned' ? 'Planned payments' : method === 'avalanche' ? 'Debt avalanche' : 'Debt snowball';

  // Per-account list — merged from DB accounts + projection results.
  // We need the projection's payoff month / interest, so we index by id.
  const byId = new Map<string, PaydownAccountResult>();
  for (const r of projection.perAccount) byId.set(r.accountId, r);

  // SVG chart.
  const accList = accounts.data ?? [];
  const hasAnyDebt = accList.some((a) => a.balance > 0);
  const accountColor = (idx: number) => {
    const palette = [
      'var(--chart-category-1)',
      'var(--chart-category-2)',
      'var(--chart-category-3)',
      'var(--chart-category-4)',
      'var(--chart-category-5)',
      'var(--chart-category-6)',
      'var(--chart-category-7)',
      'var(--chart-category-8)',
    ];
    return palette[idx % palette.length];
  };

  // An account is "unpayable" when it's included in the paydown plan
  // and has a balance but neither a minimum nor a planned payment.
  // Without any payment the planned-method projection runs flat for
  // the full 40-year horizon and the chart never produces a payoff
  // date. Detect this so we can render ∞ + a "set a minimum payment"
  // banner instead of a chart that looks broken.
  const unpayableAccounts = accList.filter(
    (a) => a.includeInPaydown && a.balance > 0 && (a.minPayment || 0) <= 0 && (a.plannedPayment || 0) <= 0,
  );
  const unpayableIds = new Set(unpayableAccounts.map((a) => a.id));
  const hasUnpayable = unpayableAccounts.length > 0;
  // debtFreeMonth is null either because an account is unpayable OR
  // because the 40-year horizon ran out (e.g. negative amortization at
  // minimums). Distinguish the two so the sub-text is accurate.
  const beyondHorizon = !hasUnpayable && projection.debtFreeMonth === null && projection.timeline.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div data-onboarding-target="paydown-summary" className="min-w-0">
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
              onClick={saveToBudget}
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
        <div className="app-toast fixed z-50 max-w-sm rounded-lg border border-default bg-surface shadow-lg px-4 py-3 text-sm flex items-start gap-3">
          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="fg-primary">
              {toast.rowCount === 0
                ? 'No accounts included — toggle Include on at least one card to snapshot.'
                : `Saved ${toast.rowCount} ${toast.rowCount === 1 ? 'account' : 'accounts'} to Budget for ${monthShort(toast.ym)}.`}
            </div>
            {toast.rowCount > 0 && toast.scenario.method !== 'planned' && (
              <div className="text-xs fg-muted mt-0.5">
                {toast.scenario.method === 'snowball' ? 'Debt snowball' : 'Debt avalanche'}
                {toast.scenario.monthlyExtra > 0 ? ` · ${formatMoney(toast.scenario.monthlyExtra)}/month extra` : ''}
                {toast.scenario.oneTimeExtra > 0 ? ` · ${formatMoney(toast.scenario.oneTimeExtra)} one-time` : ''}
              </div>
            )}
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
            className="close-button rounded-md p-1"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {syncError && (
        <div className="app-toast fixed z-50 max-w-sm rounded-lg border border-rose-300 dark:border-rose-700 bg-surface shadow-lg px-4 py-3 text-sm flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 fg-primary">{syncError}</div>
          <button
            type="button"
            onClick={() => setSyncError(null)}
            className="close-button rounded-md p-1"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {showSim && simulation.isLoading && (
        <AsyncQueryState
          status="loading"
          title="Calculating this scenario…"
          message="The baseline plan remains visible until the simulation is ready."
        />
      )}

      {showSim && simulation.isError && (
        <AsyncQueryState
          status="error"
          title="Could not calculate this scenario"
          message="The values below are from your baseline plan, not the requested simulation."
          onRetry={() => void simulation.refetch()}
          retrying={simulation.isFetching}
        />
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
              label={beyondHorizon ? 'Interest (40 years)' : 'Projected interest'}
              sub={beyondHorizon ? 'Projection horizon only' : isSimulated ? 'Under this scenario' : 'Total interest to pay'}
              value={formatMoney(projection.totalInterest)}
              tone="rose"
            />
            <SummaryCard
              icon={<Banknote className="h-4 w-4" />}
              label={beyondHorizon ? 'Paid (40 years)' : 'Total P + I'}
              sub={beyondHorizon ? 'Projection horizon only' : 'Principal + interest'}
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
                          style={{ backgroundColor: a.includeInPaydown ? accountColor(i) : 'var(--chart-excluded)' }}
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
                          onSave={async (patch) => {
                            await patchAccount.mutateAsync({ id: a.id, patch });
                          }}
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
    <>
      <div className="overflow-x-auto pb-2" aria-hidden="true">
        <div style={{ minWidth: chartWidth }}>
          <ChartContainer config={chartConfig} className="h-[360px]" aria-hidden={true}>
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
              {accounts.map((a) => (
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
      <details className="mt-3 border-t border-default pt-3">
        <summary className="cursor-pointer text-xs font-medium fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
          View projection data
        </summary>
        <p className="mt-2 text-xs fg-muted">
          {formatMoney(projection.startingTotal)} total debt
          {projection.debtFreeMonth
            ? `, projected debt-free ${monthLong(projection.debtFreeMonth)}.`
            : ', with no payoff date in this projection.'}
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-max text-left text-xs">
            <caption className="sr-only">Monthly total debt, account balances, and baseline comparison</caption>
            <thead className="fg-muted">
              <tr className="border-b border-default">
                <th scope="col" className="py-2 pr-3 font-medium">Month</th>
                <th scope="col" className="py-2 px-3 text-right font-medium">Total debt</th>
                {accounts.map((account) => (
                  <th key={account.id} scope="col" className="py-2 px-3 text-right font-medium">{account.name}</th>
                ))}
                {isSimulated && <th scope="col" className="py-2 pl-3 text-right font-medium">Baseline total</th>}
              </tr>
            </thead>
            <tbody className="fg-secondary">
              {chartData.map((point) => (
                <tr key={String(point.month)} className="border-b border-default last:border-0">
                  <th scope="row" className="py-2 pr-3 font-medium fg-primary">{monthLong(String(point.month))}</th>
                  <td className="py-2 px-3 text-right tabular-nums">{formatMoney(Number(point.total))}</td>
                  {accounts.map((account) => (
                    <td key={account.id} className="py-2 px-3 text-right tabular-nums">
                      {point[account.id] === null ? 'Paid off' : formatMoney(Number(point[account.id] ?? 0))}
                    </td>
                  ))}
                  {isSimulated && (
                    <td className="py-2 pl-3 text-right tabular-nums">
                      {point.baseline === undefined ? 'Not available' : formatMoney(Number(point.baseline))}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
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
  onSave: (patch: { interestRate: number; minPayment: number; plannedPayment: number }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  // Preserve up to 4 decimal places on the way in — the old toFixed(2)
  // was silently rounding 6.375% to 6.38% the moment the modal opened.
  const [apr, setApr] = useState(String(Number((account.interestRate * 100).toFixed(4))));
  const [min, setMin] = useState(String(account.minPayment));
  const [planned, setPlanned] = useState(String(account.plannedPayment));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Credit / loan accounts require a non-zero minimum payment or the
  // paydown chart never produces a payoff date. Disable Save until the
  // user enters something > 0 and surface the reason inline.
  const minNum = Number(min) || 0;
  const plannedNum = Number(planned) || 0;
  const requiresMin = account.type === 'credit' || account.type === 'loan';
  const plannedBelowMin = plannedNum > 0 && plannedNum < minNum;
  const canSave = (!requiresMin || minNum > 0) && !plannedBelowMin;
  const openEditor = () => {
    setApr(String(Number((account.interestRate * 100).toFixed(4))));
    setMin(String(account.minPayment));
    setPlanned(String(account.plannedPayment));
    setSaveError(null);
    setOpen(true);
  };
  const closeEditor = () => {
    if (!saving) setOpen(false);
  };
  if (!open) {
    return (
      <button
        type="button"
        onClick={openEditor}
        className="edit-icon-button rounded-lg p-1.5"
        title="Edit account details"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    );
  }
  const INPUT_CLS = 'rounded-lg border border-default bg-surface fg-primary placeholder-slate-400 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none';
  return (
    <Dialog
      aria-label={`Edit ${account.name}`}
      aria-busy={saving}
      onClose={closeEditor}
      closeDisabled={saving}
      contentClassName="card w-full max-w-sm"
    >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold fg-primary">Edit {account.name}</h3>
          <button type="button" onClick={closeEditor} disabled={saving} className="close-button rounded-lg p-2 disabled:opacity-50" aria-label="Close account details">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!canSave || saving) return;
            const aprNum = (Number(apr) || 0) / 100;
            setSaveError(null);
            setSaving(true);
            try {
              await onSave({ interestRate: aprNum, minPayment: minNum, plannedPayment: plannedNum });
              setOpen(false);
            } catch (error) {
              setSaveError(error instanceof Error && error.message ? error.message : 'Could not save account details. Please try again.');
            } finally {
              setSaving(false);
            }
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
              disabled={saving}
              className={`mt-1 w-full ${INPUT_CLS} tabular-nums`}
            />
            <span className="text-[10px] fg-muted">Set to 0 for 0% APR (e.g. intro rate, paid-in-full card)</span>
          </label>
          <label className="block">
            <span className="text-sm fg-secondary">Minimum monthly payment</span>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 fg-muted text-sm">{currencySymbol()}</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={min}
                onChange={(e) => setMin(e.target.value)}
                disabled={saving}
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
              <span className="absolute left-3 top-1/2 -translate-y-1/2 fg-muted text-sm">{currencySymbol()}</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={planned}
                onChange={(e) => setPlanned(e.target.value)}
                disabled={saving}
                placeholder="0"
                aria-invalid={plannedBelowMin}
                className={`w-full ${INPUT_CLS} pl-7 pr-3 ${plannedBelowMin ? 'border-rose-400 dark:border-rose-500' : ''}`}
              />
            </div>
            {plannedBelowMin ? (
              <span className="text-[10px] text-rose-600 dark:text-rose-400">Planned payment must be at least the minimum.</span>
            ) : (
              <span className="text-[10px] fg-muted">Leave 0 to use the minimum. Only set if you plan to pay more than the minimum.</span>
            )}
          </label>
          {saveError && (
            <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{saveError}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={closeEditor} disabled={saving} className="px-3 py-2 text-sm fg-tertiary hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={!canSave || saving} className="btn-primary flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed">
              <Check className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
    </Dialog>
  );
}
