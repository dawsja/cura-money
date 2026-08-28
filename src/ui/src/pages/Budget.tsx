import { useState, useMemo, useCallback, useEffect, useId, useRef } from 'react';
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate, formatMoney, currentYearMonth } from '../lib/format';
import { ArrowRight, BarChart3, Check, ChevronDown, ChevronRight, ExternalLink, Layers3, LoaderCircle, ReceiptText, Search, Undo2, X } from 'lucide-react';
import { MonthPicker } from '../components/MonthPicker';
import { Progress } from '../components/ui/progress';
import { BudgetSummaryBox } from '../components/BudgetSummaryBox';
import { PaydownBudgetSection, type PaydownBudgetRow, type PaydownBudgetMeta, type PlannedCellStatus } from '../components/PaydownBudgetSection';
import clsx from 'clsx';
import { Dialog } from '../components/ui/dialog';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../components/ui/input-group';

interface MainCategory {
  id: string;
  name: string;
  type: 'income' | 'expense' | 'transfer';
  icon?: string;
  subCategories: { id: string; name: string; planned: number; icon?: string }[];
}
interface BudgetRow { subCategoryId: string; planned: number; }
interface BudgetActivityRow {
  category: string;
  subCategory: string;
  type: 'income' | 'expense';
  actual: number;
  transactions: BudgetDrilldownRow[];
}
interface BudgetActivityResponse { yearMonth: string; rows: BudgetActivityRow[]; }
interface BudgetDrilldown {
  category: string;
  subCategory: string;
  type: 'income' | 'expense';
}
interface BudgetDrilldownRow {
  id: string;
  date: string;
  merchant: string;
  account: string;
  amount: number;
  hasSplits: boolean;
  parentAmount: number;
}
interface BulkAssignmentInput {
  ids: string[];
  expected: BudgetDrilldown;
  type: 'income' | 'expense';
  category: string;
  subCategory: string;
}
interface Account {
  id: string;
  name: string;
  type: 'checking' | 'savings' | 'credit' | 'investment' | 'loan' | 'uncategorized';
  balance: number;
  plannedPayment: number;
  minPayment: number;
  includeInPaydown: boolean;
  hidden: boolean;
}

interface PaydownSnapshotResponse {
  rows: PaydownBudgetRow[];
  meta: PaydownBudgetMeta;
}

const PAYDOWN_SECTION_ID = 'paydown-section';
const draftKey = (yearMonth: string, id: string) => `${yearMonth}:${id}`;
const actualKey = (category: string, subCategory?: string) => `${category}\0${subCategory ?? category}`;
const PLANNED_INPUT_CLS = 'min-h-11 w-28 text-right tabular-nums rounded-md border border-control bg-surface fg-primary px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none disabled:cursor-wait disabled:opacity-60 sm:h-9 sm:min-h-0 sm:py-1';

export function Budget() {
  const qc = useQueryClient();
  const [ym, setYm] = useState(currentYearMonth());
  const [liveOverrides, setLiveOverrides] = useState<Map<string, number>>(new Map());
  const [paydownLive, setPaydownLive] = useState<Map<string, number>>(new Map());
  const [budgetStatuses, setBudgetStatuses] = useState<Map<string, PlannedCellStatus>>(new Map());
  const [paydownStatuses, setPaydownStatuses] = useState<Map<string, PlannedCellStatus>>(new Map());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drilldown, setDrilldown] = useState<BudgetDrilldown | null>(null);
  const [futurePrompt, setFuturePrompt] = useState<{
    subCategoryId: string;
    yearMonth: string;
    revision: string;
  } | null>(null);
  const [futureError, setFutureError] = useState<string | null>(null);
  const liveOverridesRef = useRef(liveOverrides);
  const paydownLiveRef = useRef(paydownLive);
  const budgetInFlight = useRef(new Set<string>());
  const paydownInFlight = useRef(new Set<string>());

  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get<MainCategory[]>('/api/categories') });
  const budgets = useQuery({
    queryKey: ['budget', ym],
    queryFn: () => api.get<BudgetRow[]>(`/api/budget/${ym}`),
    placeholderData: keepPreviousData,
  });
  const activity = useQuery({
    queryKey: ['budget', 'activity', ym],
    queryFn: () => api.get<BudgetActivityResponse>(`/api/budget/${ym}/activity`),
    placeholderData: keepPreviousData,
  });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api.get<Account[]>('/api/accounts') });
  const paydownSnapshot = useQuery<PaydownSnapshotResponse>({
    queryKey: ['paydown', 'snapshot', ym],
    queryFn: () => api.get<PaydownSnapshotResponse>(`/api/paydown/snapshot/${ym}`),
  });

  const setBudget = useMutation({
    mutationFn: (input: { subCategoryId: string; yearMonth: string; planned: number }) =>
      api.post<{ ok: true; revision: string }>('/api/budget', input),
  });
  const applyFuture = useMutation({
    mutationFn: (input: { subCategoryId: string; yearMonth: string; revision: string }) =>
      api.post<{ ok: true }>('/api/budget/apply-future', input),
  });

  const setPaydownPlanned = useMutation({
    mutationFn: (input: { accountId: string; yearMonth: string; planned: number }) =>
      api.patch(`/api/paydown/snapshot/${input.yearMonth}/account/${input.accountId}`, { planned: input.planned }),
  });

  const serverPlannedMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cats.data ?? []) for (const s of c.subCategories) m.set(s.id, s.planned);
    for (const b of budgets.data ?? []) m.set(b.subCategoryId, b.planned);
    return m;
  }, [cats.data, budgets.data]);

  const mergedPlanned = useMemo(() => {
    const m = new Map(serverPlannedMap);
    for (const c of cats.data ?? []) {
      for (const s of c.subCategories) {
        const live = liveOverrides.get(draftKey(ym, s.id));
        if (live !== undefined) m.set(s.id, live);
      }
    }
    return m;
  }, [serverPlannedMap, liveOverrides, cats.data, ym]);

  const currentPaydownLive = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of paydownSnapshot.data?.rows ?? []) {
      const live = paydownLive.get(draftKey(ym, row.accountId));
      if (live !== undefined) m.set(row.accountId, live);
    }
    return m;
  }, [paydownLive, paydownSnapshot.data, ym]);

  const earnedMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of activity.data?.rows ?? []) {
      if (row.type !== 'income') continue;
      m.set(actualKey(row.category, row.subCategory), row.actual);
    }
    return m;
  }, [activity.data]);

  const spentMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of activity.data?.rows ?? []) {
      if (row.type !== 'expense') continue;
      m.set(actualKey(row.category, row.subCategory), row.actual);
    }
    return m;
  }, [activity.data]);

  const txnCountMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of activity.data?.rows ?? []) {
      m.set(actualKey(row.category, row.subCategory), row.transactions.length);
    }
    return m;
  }, [activity.data]);

  const drilldownRows = useMemo(() => {
    if (!drilldown) return [];
    return activity.data?.rows.find((row) =>
      row.type === drilldown.type &&
      actualKey(row.category, row.subCategory) === actualKey(drilldown.category, drilldown.subCategory)
    )?.transactions ?? [];
  }, [drilldown, activity.data]);

  useEffect(() => {
    if (!futurePrompt || applyFuture.isPending) return;
    const timeout = setTimeout(() => {
      setFuturePrompt(null);
      setFutureError(null);
    }, 8000);
    return () => clearTimeout(timeout);
  }, [futurePrompt, applyFuture.isPending]);

  const totals = useMemo(() => {
    let plannedIncome = 0;
    let earnedIncome = 0;
    let plannedExpense = 0;
    let spentExpense = 0;
    for (const c of cats.data ?? []) {
      for (const s of c.subCategories) {
        const planned = mergedPlanned.get(s.id) ?? s.planned;
        if (c.type === 'income') {
          plannedIncome += planned;
          earnedIncome += earnedMap.get(actualKey(c.name, s.name)) ?? 0;
        } else if (c.type === 'expense') {
          plannedExpense += planned;
          spentExpense += spentMap.get(actualKey(c.name, s.name)) ?? 0;
        }
      }
    }
    // Prefer the saved paydown snapshot (what "Save to Budget" wrote).
    // Fall back to live account planned/min only when no snapshot rows exist.
    // Apply in-progress paydown live overrides so Left-to-budget tracks edits.
    const snapshotRows = paydownSnapshot.data?.rows ?? [];
    let plannedDebt = 0;
    const actualDebt = snapshotRows.reduce((sum, r) => sum + r.actual, 0);
    if (snapshotRows.length > 0) {
      plannedDebt = snapshotRows.reduce((sum, r) => sum + (currentPaydownLive.get(r.accountId) ?? r.planned), 0);
    } else {
      for (const a of accounts.data ?? []) {
        if (!a.includeInPaydown) continue;
        if (a.type !== 'credit' && a.type !== 'loan') continue;
        if (currentPaydownLive.has(a.id)) {
          plannedDebt += currentPaydownLive.get(a.id)!;
          continue;
        }
        // Zero-balance included debts don't need budgeted payment.
        if (a.balance <= 0) continue;
        plannedDebt += a.plannedPayment > 0 ? a.plannedPayment : a.minPayment ?? 0;
      }
    }
    return { plannedIncome, earnedIncome, plannedExpense, spentExpense, plannedDebt, actualDebt };
  }, [cats.data, mergedPlanned, earnedMap, spentMap, accounts.data, paydownSnapshot.data, currentPaydownLive]);

  const setLiveOverride = useCallback((id: string, value: number) => {
    if (value < 0) return;
    const key = draftKey(ym, id);
    if (budgetInFlight.current.has(key)) return;
    setLiveOverrides((prev) => {
      const next = new Map(prev);
      next.set(key, value);
      liveOverridesRef.current = next;
      return next;
    });
    setBudgetStatuses((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, [ym]);

  const clearLiveOverride = useCallback((id: string) => {
    const key = draftKey(ym, id);
    setLiveOverrides((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      liveOverridesRef.current = next;
      return next;
    });
    setBudgetStatuses((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, [ym]);

  const commitOverride = useCallback(async (id: string, type: 'income' | 'expense') => {
    const key = draftKey(ym, id);
    const live = liveOverridesRef.current.get(key);
    const server = serverPlannedMap.get(id) ?? 0;
    if (live === undefined || budgetInFlight.current.has(key)) return;
    if (live === server) {
      clearLiveOverride(id);
      return;
    }
    budgetInFlight.current.add(key);
    setBudgetStatuses((prev) => new Map(prev).set(key, 'saving'));
    try {
      setFuturePrompt((current) => current?.subCategoryId === id && current.yearMonth === ym ? null : current);
      setFutureError(null);
      const result = await setBudget.mutateAsync({ subCategoryId: id, yearMonth: ym, planned: live });
      await qc.invalidateQueries({ queryKey: ['budget', ym] }, { throwOnError: true });
      window.dispatchEvent(new CustomEvent('cura:onboarding-budget-saved', { detail: { type } }));
      if (liveOverridesRef.current.get(key) === live) {
        setLiveOverrides((prev) => {
          const next = new Map(prev);
          next.delete(key);
          liveOverridesRef.current = next;
          return next;
        });
        setBudgetStatuses((prev) => new Map(prev).set(key, 'saved'));
        setFuturePrompt({ subCategoryId: id, yearMonth: ym, revision: result.revision });
      }
    } catch {
      setBudgetStatuses((prev) => new Map(prev).set(key, 'error'));
    } finally {
      budgetInFlight.current.delete(key);
    }
  }, [serverPlannedMap, setBudget, qc, ym, clearLiveOverride]);

  const setPaydownLiveOverride = useCallback((accountId: string, value: number) => {
    if (value < 0) return;
    const key = draftKey(ym, accountId);
    if (paydownInFlight.current.has(key)) return;
    setPaydownLive((prev) => {
      const next = new Map(prev);
      next.set(key, value);
      paydownLiveRef.current = next;
      return next;
    });
    setPaydownStatuses((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, [ym]);

  const resetPaydownOverride = useCallback((accountId: string) => {
    const key = draftKey(ym, accountId);
    setPaydownLive((prev) => {
      const next = new Map(prev);
      next.delete(key);
      paydownLiveRef.current = next;
      return next;
    });
    setPaydownStatuses((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, [ym]);

  const commitPaydownOverride = useCallback(async (accountId: string) => {
    const key = draftKey(ym, accountId);
    const live = paydownLiveRef.current.get(key);
    const server = (paydownSnapshot.data?.rows ?? []).find((r) => r.accountId === accountId)?.planned ?? 0;
    if (live === undefined || paydownInFlight.current.has(key)) return;
    if (live === server) {
      resetPaydownOverride(accountId);
      return;
    }
    paydownInFlight.current.add(key);
    setPaydownStatuses((prev) => new Map(prev).set(key, 'saving'));
    try {
      await setPaydownPlanned.mutateAsync({ accountId, yearMonth: ym, planned: live });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['paydown', 'snapshot', ym] }, { throwOnError: true }),
        qc.invalidateQueries({ queryKey: ['accounts'] }, { throwOnError: true }),
      ]);
      if (paydownLiveRef.current.get(key) === live) {
        setPaydownLive((prev) => {
          const next = new Map(prev);
          next.delete(key);
          paydownLiveRef.current = next;
          return next;
        });
        setPaydownStatuses((prev) => new Map(prev).set(key, 'saved'));
      }
    } catch {
      setPaydownStatuses((prev) => new Map(prev).set(key, 'error'));
    } finally {
      paydownInFlight.current.delete(key);
    }
  }, [paydownSnapshot.data, setPaydownPlanned, qc, ym, resetPaydownOverride]);

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const jumpToPaydown = useCallback(() => {
    document.getElementById(PAYDOWN_SECTION_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const closeDrilldown = useCallback(() => setDrilldown(null), []);

  const incomeCats = (cats.data ?? []).filter((c) => c.type === 'income');
  const expenseCats = (cats.data ?? []).filter((c) => c.type === 'expense');
  const hasWorkspace = !!cats.data && !!accounts.data && !!budgets.data && !!activity.data;
  const loading = !hasWorkspace && (cats.isLoading || budgets.isLoading || activity.isLoading || accounts.isLoading);
  const failed = !hasWorkspace && (cats.isError || budgets.isError || activity.isError || accounts.isError);
  const refreshFailed = hasWorkspace && (budgets.isError || activity.isError);
  const retry = () => {
    void Promise.all([cats.refetch(), budgets.refetch(), activity.refetch(), accounts.refetch(), paydownSnapshot.refetch()]);
  };

  return (
    <div className="space-y-4">
      <div className="shrink-0 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold fg-primary">Budget</h1>
        <MonthPicker value={ym} onChange={setYm} />
      </div>

      {loading ? (
        <div className="card text-sm fg-muted text-center">Loading…</div>
      ) : failed ? (
        <div className="card text-center space-y-3" role="alert">
          <p className="text-sm fg-secondary">Budget data could not be loaded.</p>
          <button type="button" onClick={retry} className="btn-primary px-3 py-1.5 text-sm">Retry</button>
        </div>
      ) : (
        /* Mobile: single-column flow (summary then sections) inside the
             main scroll. Desktop: two-column layout with the leftover
             panel sticky so it stays in view while assigning lower groups. */
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
        <div className="shrink-0 lg:sticky lg:top-8 lg:order-2 lg:w-96">
          <BudgetSummaryBox
            plannedIncome={totals.plannedIncome}
            earnedIncome={totals.earnedIncome}
            plannedExpense={totals.plannedExpense}
            spentExpense={totals.spentExpense}
            plannedDebt={totals.plannedDebt}
            actualDebt={totals.actualDebt}
            loading={false}
            onJumpToPaydown={jumpToPaydown}
          />
        </div>

        <div className="min-w-0 flex-1 space-y-6">
          <>
              {refreshFailed && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-300" role="alert">
                  <span>This month could not be refreshed.</span>
                  <button type="button" onClick={retry} className="font-semibold hover:underline">Retry</button>
                </div>
              )}
              {incomeCats.length > 0 ? (
                <BudgetSection
                  title="Income"
                  cats={incomeCats}
                  plannedMap={mergedPlanned}
                  amountMap={earnedMap}
                  countMap={txnCountMap}
                  amountType="earned"
                  collapsed={collapsed}
                  onToggleCollapsed={toggleCollapsed}
                  onLiveChange={setLiveOverride}
                  onLiveCommit={(id) => commitOverride(id, 'income')}
                  onLiveReset={clearLiveOverride}
                  statuses={budgetStatuses}
                  yearMonth={ym}
                  onOpenDrilldown={setDrilldown}
                />
              ) : (
                <EmptyCategoriesCard type="income" />
              )}

              {expenseCats.length === 0 ? (
                <EmptyCategoriesCard type="expense" />
              ) : (
                expenseCats.map((cat) => (
                  <BudgetSection
                    key={cat.id}
                    title={cat.name}
                    cats={[cat]}
                    plannedMap={mergedPlanned}
                    amountMap={spentMap}
                    countMap={txnCountMap}
                    amountType="spent"
                    collapsed={collapsed}
                    onToggleCollapsed={toggleCollapsed}
                    onLiveChange={setLiveOverride}
                    onLiveCommit={(id) => commitOverride(id, 'expense')}
                    onLiveReset={clearLiveOverride}
                    statuses={budgetStatuses}
                    yearMonth={ym}
                    onOpenDrilldown={setDrilldown}
                  />
                ))
              )}

              <PaydownBudgetSection
                id={PAYDOWN_SECTION_ID}
                rows={paydownSnapshot.data?.rows ?? []}
                meta={paydownSnapshot.data?.meta ?? { syncedAt: null, rowCount: 0 }}
                collapsed={collapsed}
                onToggleCollapsed={toggleCollapsed}
                livePlanned={currentPaydownLive}
                onLiveChange={setPaydownLiveOverride}
                onLiveCommit={commitPaydownOverride}
                onLiveReset={resetPaydownOverride}
                statuses={new Map((paydownSnapshot.data?.rows ?? []).map((row) => [row.accountId, paydownStatuses.get(draftKey(ym, row.accountId))]))}
                loading={paydownSnapshot.isLoading && !paydownSnapshot.data}
                error={paydownSnapshot.isError && !paydownSnapshot.data}
                onRetry={() => void paydownSnapshot.refetch()}
              />
          </>
        </div>
        </div>
      )}
      {drilldown && (
        <BudgetTransactionsModal
          selection={drilldown}
          rows={drilldownRows}
          yearMonth={ym}
          categories={cats.data ?? []}
          onClose={closeDrilldown}
        />
      )}
      {futurePrompt && (
        <div className="app-toast fixed z-[60] max-w-sm rounded-lg border border-default bg-surface shadow-lg px-4 py-3 text-sm" role="status">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium fg-primary">Budget saved for this month.</p>
              <p className="mt-1 fg-secondary">Apply this amount to future months?</p>
              {futureError && <p className="mt-2 text-rose-600 dark:text-rose-400" role="alert">{futureError}</p>}
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  className="text-sm font-medium fg-secondary hover:underline"
                  disabled={applyFuture.isPending}
                  onClick={() => { setFuturePrompt(null); setFutureError(null); }}
                >
                  Not now
                </button>
                <button
                  type="button"
                  className="btn-primary px-3 py-1.5 text-sm"
                  disabled={applyFuture.isPending}
                  onClick={() => {
                    const prompt = futurePrompt;
                    setFutureError(null);
                    applyFuture.mutate(prompt, {
                      onSuccess: () => {
                        void qc.invalidateQueries({ queryKey: ['budget'] });
                        setFuturePrompt((current) => current?.revision === prompt.revision ? null : current);
                      },
                      onError: (error) => setFutureError((error as Error).message),
                    });
                  }}
                >
                  {applyFuture.isPending ? 'Applying…' : 'Apply'}
                </button>
              </div>
            </div>
            <button type="button" className="close-button flex h-8 w-8 items-center justify-center rounded-lg" aria-label="Dismiss" onClick={() => setFuturePrompt(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface BudgetSectionProps {
  title: string;
  cats: MainCategory[];
  plannedMap: Map<string, number>;
  amountMap: Map<string, number>;
  countMap: Map<string, number>;
  amountType: 'earned' | 'spent';
  collapsed: Set<string>;
  onToggleCollapsed: (id: string) => void;
  onLiveChange: (id: string, value: number) => void;
  onLiveCommit: (id: string) => void;
  onLiveReset: (id: string) => void;
  statuses: Map<string, PlannedCellStatus>;
  yearMonth: string;
  onOpenDrilldown: (selection: BudgetDrilldown) => void;
}

function EmptyCategoriesCard({ type }: { type: 'income' | 'expense' }) {
  return (
    <div className="card text-center text-sm fg-muted">
      <BarChart3 className="mr-1 inline h-5 w-5 fg-muted" />
      No {type} categories yet.{' '}
      <Link to="/categories" className="font-medium text-amber-700 hover:underline dark:text-amber-300">
        Add some on the Categories page.
      </Link>
    </div>
  );
}

function BudgetSection({
  title,
  cats,
  plannedMap,
  amountMap,
  countMap,
  amountType,
  collapsed,
  onToggleCollapsed,
  onLiveChange,
  onLiveCommit,
  onLiveReset,
  statuses,
  yearMonth,
  onOpenDrilldown,
}: BudgetSectionProps) {
  const isCollapsed = collapsed.has(title);
  const allSubs = cats.flatMap((c) => c.subCategories.map((sub) => ({ sub, categoryName: c.name })));
  const totalPlanned = allSubs.reduce((s, x) => s + (plannedMap.get(x.sub.id) ?? x.sub.planned), 0);
  const totalAmount = allSubs.reduce((s, x) => s + (amountMap.get(actualKey(x.categoryName, x.sub.name)) ?? 0), 0);
  const isIncome = amountType === 'earned';
  const totalRemaining = totalPlanned - totalAmount;

  const headerBg = title === 'Income' ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : '';

  return (
    <section className="card">
      <button
        type="button"
        onClick={() => onToggleCollapsed(title)}
        className={clsx(
          'w-full flex items-center justify-between px-4 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-t-lg',
          headerBg,
        )}
        aria-expanded={!isCollapsed}
      >
        <h2 className="text-base font-semibold fg-primary flex items-center gap-2">
          {isCollapsed ? <ChevronRight className="h-4 w-4 fg-muted" /> : <ChevronDown className="h-4 w-4 fg-muted" />}
          {title}
        </h2>
        <div className="flex items-baseline gap-3 sm:gap-6 text-sm tabular-nums">
          <div className="hidden sm:block">
            <span className="fg-muted text-xs uppercase tracking-wider mr-2">Planned</span>
            <span className="font-semibold fg-primary">{formatMoney(totalPlanned)}</span>
          </div>
          <div className="hidden sm:block">
            <span className="fg-muted text-xs uppercase tracking-wider mr-2">Actual</span>
            <span className="font-semibold fg-primary">{formatMoney(totalAmount)}</span>
          </div>
          {isIncome ? (
            <div className="sm:hidden">
              <span className="fg-muted text-xs uppercase tracking-wider mr-1">Actual</span>
              <span className="font-semibold fg-primary">{formatMoney(totalAmount)}</span>
            </div>
          ) : (
            <div>
              <span className="fg-muted text-xs uppercase tracking-wider mr-1 sm:mr-2">Left</span>
              <span className={clsx(
                'font-semibold',
                totalRemaining < 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-emerald-600 dark:text-emerald-400',
              )}>
                {formatMoney(totalRemaining)}
              </span>
            </div>
          )}
        </div>
      </button>

      {!isCollapsed && (
        <div className="px-2 sm:px-4 pb-3 pt-1">
          {/* Mobile: card-list layout. Desktop: full table. */}
          <div className="sm:hidden divide-y divide-slate-100 dark:divide-slate-700">
            {allSubs.map(({ sub, categoryName }, index) => {
              const planned = plannedMap.get(sub.id) ?? sub.planned;
              const amount = amountMap.get(actualKey(categoryName, sub.name)) ?? 0;
              const txnCount = countMap.get(actualKey(categoryName, sub.name)) ?? 0;
              const status = statuses.get(draftKey(yearMonth, sub.id));
              const remaining = planned - amount;
              const showProgress = planned > 0;
              const progressPct = showProgress ? Math.min(100, (amount / planned) * 100) : 0;
              const progressTone: 'emerald' | 'amber' | 'rose' =
                amount > planned
                  ? 'rose'
                  : amount >= planned * 0.7
                    ? 'amber'
                    : 'emerald';
              return (
                <div key={sub.id} className="py-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenDrilldown({ category: categoryName, subCategory: sub.name, type: isIncome ? 'income' : 'expense' })}
                      title={`View transactions for ${sub.name}`}
                      className="inline-flex min-w-0 cursor-pointer items-center gap-1 text-left text-sm font-medium fg-primary hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:text-amber-300"
                    >
                      <span className="truncate">{sub.name}</span>
                      {txnCount > 0 && <span className="shrink-0 text-xs tabular-nums fg-muted">{txnCount}</span>}
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 fg-muted" aria-hidden="true" />
                    </button>
                    {isIncome ? (
                      <span className="text-sm font-semibold tabular-nums shrink-0 fg-primary">
                        {formatMoney(amount)}
                      </span>
                    ) : (
                      <span className={clsx(
                        'text-sm font-semibold tabular-nums shrink-0',
                        remaining < 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400',
                      )}>
                        {formatMoney(remaining)}
                      </span>
                    )}
                  </div>
                  {showProgress && (
                    <Progress
                      value={progressPct}
                      tone={isIncome ? 'emerald' : progressTone}
                      className="w-full"
                    />
                  )}
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1">
                      <span className="fg-muted">Planned</span>
                      <input
                        data-onboarding-target={index === 0 ? (isIncome ? 'budget-plan-income' : 'budget-plan-expense') : undefined}
                        type="number"
                        min={0}
                        step="0.01"
                        value={planned}
                        disabled={status === 'saving'}
                        onFocus={(event) => {
                          if (event.currentTarget.value === '0') event.currentTarget.select();
                        }}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v)) onLiveChange(sub.id, v);
                        }}
                        onBlur={() => onLiveCommit(sub.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') onLiveCommit(sub.id);
                          if (e.key === 'Escape') onLiveReset(sub.id);
                        }}
                        className={PLANNED_INPUT_CLS}
                      />
                      <CellFeedback status={status} onRetry={() => onLiveCommit(sub.id)} />
                    </div>
                    <span className="fg-secondary tabular-nums">
                      {formatMoney(amount)} {amountType}
                    </span>
                  </div>
                </div>
              );
            })}
            {/* Mobile totals row */}
            <div className="py-2.5 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold fg-primary">Total</span>
              <div className="flex items-center gap-3 text-xs tabular-nums">
                <span className="fg-secondary">{formatMoney(totalPlanned)} planned</span>
                {isIncome ? (
                  <span className="text-sm font-semibold fg-primary">{formatMoney(totalAmount)}</span>
                ) : (
                  <span className={clsx(
                    'text-sm font-semibold',
                    totalRemaining < 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-emerald-600 dark:text-emerald-400',
                  )}>
                    {formatMoney(totalRemaining)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Desktop table — unchanged */}
          <table className="hidden sm:table w-full text-sm table-fixed">
            <colgroup>
              <col />
              <col className="w-32" />
              <col className="w-32" />
              {!isIncome && <col className="w-32" />}
            </colgroup>
            <thead>
              <tr className="text-left text-xs uppercase fg-muted">
                <th className="py-1">Sub-category</th>
                <th className="py-1 text-right pl-6">Planned</th>
                <th className="py-1 text-right pl-10">Actual</th>
                {!isIncome && <th className="py-1 text-right pl-6">Remaining</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {allSubs.map(({ sub, categoryName }, index) => {
                const planned = plannedMap.get(sub.id) ?? sub.planned;
                const amount = amountMap.get(actualKey(categoryName, sub.name)) ?? 0;
                const txnCount = countMap.get(actualKey(categoryName, sub.name)) ?? 0;
                const status = statuses.get(draftKey(yearMonth, sub.id));
                const remaining = planned - amount;
                const showProgress = planned > 0;
                const progressPct = showProgress ? Math.min(100, (amount / planned) * 100) : 0;
                const progressTone: 'emerald' | 'amber' | 'rose' =
                  amount > planned
                    ? 'rose'
                    : amount >= planned * 0.7
                      ? 'amber'
                      : 'emerald';
                return (
                  <tr key={sub.id}>
                    <td className="py-2 fg-primary">
                      <button
                        type="button"
                        onClick={() => onOpenDrilldown({ category: categoryName, subCategory: sub.name, type: isIncome ? 'income' : 'expense' })}
                        title={`View transactions for ${sub.name}`}
                        className="inline-flex max-w-full cursor-pointer items-center gap-1 text-left hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:text-amber-300"
                      >
                        <span className="truncate">{sub.name}</span>
                        {txnCount > 0 && <span className="shrink-0 text-xs tabular-nums fg-muted">{txnCount}</span>}
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 fg-muted" aria-hidden="true" />
                      </button>
                      {showProgress && (
                        <Progress
                          value={progressPct}
                          tone={isIncome ? 'emerald' : progressTone}
                          className="mt-1.5 max-w-xs"
                        />
                      )}
                    </td>
                    <td className="py-2 text-right pl-6">
                      <input
                        data-onboarding-target={index === 0 ? (isIncome ? 'budget-plan-income' : 'budget-plan-expense') : undefined}
                        type="number"
                        min={0}
                        step="0.01"
                        value={planned}
                        disabled={status === 'saving'}
                        onFocus={(event) => {
                          if (event.currentTarget.value === '0') event.currentTarget.select();
                        }}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v)) onLiveChange(sub.id, v);
                        }}
                        onBlur={() => onLiveCommit(sub.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') onLiveCommit(sub.id);
                          if (e.key === 'Escape') onLiveReset(sub.id);
                        }}
                        className={PLANNED_INPUT_CLS}
                      />
                      <CellFeedback status={status} onRetry={() => onLiveCommit(sub.id)} />
                    </td>
                    <td className="py-2 text-right pl-10">
                      <div className="tabular-nums fg-secondary">{formatMoney(amount)}</div>
                    </td>
                    {!isIncome && (
                      <td className={clsx(
                        'py-2 text-right font-semibold tabular-nums pl-6',
                        remaining < 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400',
                      )}>
                        {formatMoney(remaining)}
                      </td>
                    )}
                  </tr>
                );
              })}
              <tr>
                <td className="py-2 font-semibold fg-primary">Total {title}</td>
                <td className="py-2 text-right font-semibold tabular-nums fg-secondary pl-6">{formatMoney(totalPlanned)}</td>
                <td className="py-2 text-right font-semibold tabular-nums fg-secondary pl-10">{formatMoney(totalAmount)}</td>
                {!isIncome && (
                  <td className={clsx(
                    'py-2 text-right font-semibold tabular-nums pl-6',
                    totalRemaining < 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-emerald-600 dark:text-emerald-400',
                  )}>
                    {formatMoney(totalRemaining)}
                  </td>
                )}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function BudgetTransactionsModal({
  selection,
  rows,
  yearMonth,
  categories,
  onClose,
}: {
  selection: BudgetDrilldown;
  rows: BudgetDrilldownRow[];
  yearMonth: string;
  categories: MainCategory[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [moveIds, setMoveIds] = useState<string[] | null>(null);
  const [lastMove, setLastMove] = useState<BulkAssignmentInput | null>(null);
  const [movePending, setMovePending] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [undoPending, setUndoPending] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const [year, month] = yearMonth.split('-').map(Number);
  const monthLabel = new Date(year ?? 0, (month ?? 1) - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const eligibleIds = useMemo(() => rows.filter((row) => !row.hasSplits).map((row) => row.id), [rows]);
  const allEligibleSelected = eligibleIds.length > 0 && eligibleIds.every((id) => selectedIds.has(id));
  const visibleSelectedCount = eligibleIds.filter((id) => selectedIds.has(id)).length;
  const financialQueryKeys = ['transactions', 'reviews', 'accounts', 'dashboard', 'budget', 'reports', 'paydown', 'recurring', 'notifications', 'goals', 'simplefin'];

  const invalidateFinancialQueries = async () => {
    await Promise.all(financialQueryKeys.map((key) => qc.invalidateQueries({ queryKey: [key] })));
  };
  const move = useMutation({
    mutationFn: (input: BulkAssignmentInput) =>
      api.patch<{ updated: number }>('/api/transactions/bulk-assignment', input),
  });
  const undo = useMutation({
    mutationFn: (input: BulkAssignmentInput) =>
      api.patch<{ updated: number }>('/api/transactions/bulk-assignment', input),
  });
  const isPending = movePending || undoPending;
  const transactionHref = (merchant?: string) => {
    const lastDay = new Date(year ?? 0, month ?? 1, 0).getDate();
    const params = new URLSearchParams({
      types: selection.type,
      category: selection.category,
      subCategory: selection.subCategory,
      from: `${yearMonth}-01`,
      to: `${yearMonth}-${String(lastDay).padStart(2, '0')}`,
      reviewed: 'true',
    });
    if (merchant) params.set('merchant', merchant);
    return `/transactions?${params.toString()}`;
  };
  const openMove = (ids: string[]) => {
    if (isPending) return;
    move.reset();
    setMoveError(null);
    setMoveIds(ids);
  };
  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const closeViewer = () => {
    if (!isPending) onClose();
  };

  return (
    <Dialog
      aria-labelledby={titleId}
      aria-busy={isPending}
      onClose={closeViewer}
      closeDisabled={isPending}
      initialFocusRef={closeRef}
      overlayClassName="dialog-overlay--dim"
      contentClassName="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-default bg-surface shadow-2xl"
    >
        <div className="flex items-start justify-between gap-3 border-b border-default p-4 sm:p-5">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-lg font-semibold fg-primary">{selection.subCategory}</h2>
            <p className="mt-1 text-sm fg-muted">{selection.category} · {monthLabel}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={closeViewer}
            disabled={isPending}
            className="close-button flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
            aria-label="Close transaction details"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-default bg-canvas-subtle px-4 py-3 sm:px-5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="fg-secondary">{rows.length} transaction{rows.length === 1 ? '' : 's'}</span>
            <span className="font-semibold tabular-nums fg-primary">{formatMoney(total)} {selection.type === 'income' ? 'earned' : 'spent'}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {eligibleIds.length > 0 && (
              <button
                type="button"
                disabled={isPending}
                className="flex h-11 items-center rounded-lg border border-default bg-surface px-3 text-sm font-medium fg-secondary hover:fg-primary"
                onClick={() => {
                  setSelectMode((current) => !current);
                  setSelectedIds(new Set());
                }}
              >
                {selectMode ? 'Exit select' : 'Select transactions'}
              </button>
            )}
            {selectMode && (
              <button
                type="button"
                disabled={isPending}
                className="flex h-11 items-center rounded-lg px-3 text-sm font-medium fg-secondary hover:fg-primary"
                onClick={() => setSelectedIds(allEligibleSelected ? new Set() : new Set(eligibleIds))}
              >
                {allEligibleSelected ? 'Clear eligible' : 'Select all eligible'}
              </button>
            )}
            <Link
              to={transactionHref()}
              className="ml-auto inline-flex h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-amber-700 hover:underline dark:text-amber-300"
            >
              View all in Transactions <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          {selectMode && <p className="mt-2 text-xs fg-muted" aria-live="polite">{visibleSelectedCount} selected · Split transactions are not eligible.</p>}
        </div>

        {(lastMove || undoError) && (
          <div className="flex items-center justify-between gap-3 border-b border-default px-4 py-3 text-sm sm:px-5" role={undoError ? 'alert' : 'status'}>
            <span className={undoError ? 'text-rose-600 dark:text-rose-400' : 'fg-secondary'}>
              {undoError ?? `${lastMove?.ids.length ?? 0} transaction${lastMove?.ids.length === 1 ? '' : 's'} moved.`}
            </span>
            {lastMove && (
              <button
                ref={undoRef}
                type="button"
                disabled={isPending}
                className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-amber-700 hover:underline disabled:cursor-wait disabled:opacity-60 dark:text-amber-300"
                onClick={async () => {
                  undo.reset();
                  setUndoError(null);
                  setUndoPending(true);
                  try {
                    const result = await undo.mutateAsync(lastMove);
                    if (result.updated !== lastMove.ids.length) throw new Error('Not all transactions could be restored. Refresh and try again.');
                    await invalidateFinancialQueries();
                    setLastMove(null);
                  } catch (error) {
                    setUndoError((error as Error).message);
                  } finally {
                    setUndoPending(false);
                  }
                }}
              >
                {undoPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Undo2 className="h-4 w-4" aria-hidden="true" />}
                {undoPending ? 'Undoing…' : 'Undo'}
              </button>
            )}
          </div>
        )}

        <div className="min-h-0 overflow-y-auto">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center px-5 py-12 text-center">
              <ReceiptText className="h-8 w-8 fg-muted" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium fg-primary">No transactions</p>
              <p className="mt-1 text-xs fg-muted">Nothing currently contributes to this subcategory for {monthLabel}.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-700">
              {rows.map((row) => {
                const checked = selectedIds.has(row.id);
                return (
                  <li key={row.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                    {selectMode && !row.hasSplits && (
                      <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isPending}
                          onChange={() => toggleSelected(row.id)}
                          className="h-5 w-5 accent-amber-600 disabled:cursor-wait disabled:opacity-50"
                          aria-label={`Select ${row.merchant || 'unknown merchant'} transaction from ${formatDate(row.date)}`}
                        />
                      </label>
                    )}
                    {selectMode && row.hasSplits && <span className="w-11 shrink-0" aria-hidden="true" />}
                    <div className="min-w-0 flex-1">
                      <div className={clsx(
                        'grid items-center gap-2',
                        !row.hasSplits && !selectMode
                          ? 'grid-cols-[minmax(0,1fr)_2.75rem_auto]'
                          : 'grid-cols-[minmax(0,1fr)_auto]',
                      )}>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium fg-primary">{row.merchant || 'Unknown merchant'}</p>
                          <p className="mt-0.5 text-xs fg-muted">{formatDate(row.date)} · {row.account || 'Unknown account'}</p>
                        </div>
                        {!row.hasSplits && !selectMode && (
                          <button
                            type="button"
                            disabled={isPending}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-full fg-secondary hover:bg-slate-100 hover:fg-primary disabled:cursor-wait disabled:opacity-50 dark:hover:bg-slate-700"
                            onClick={() => openMove([row.id])}
                            aria-label={`Move ${row.merchant || 'unknown merchant'} transaction to another category`}
                            title="Move to another category"
                          >
                            <ArrowRight className="h-5 w-5" aria-hidden="true" />
                          </button>
                        )}
                        <span className={clsx(
                          'shrink-0 text-right text-sm font-semibold tabular-nums',
                          selection.type === 'income'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400',
                        )}>
                          {selection.type === 'income' ? '+' : '−'}{formatMoney(row.amount)}
                        </span>
                      </div>
                      {row.hasSplits && (
                        <div className="mt-2 flex min-h-11 flex-wrap items-center gap-2">
                          <>
                            <span className="inline-flex items-center gap-1 rounded-full border border-default bg-canvas-subtle px-2 py-1 text-xs font-semibold fg-secondary">
                              <Layers3 className="h-3.5 w-3.5" aria-hidden="true" /> Split
                            </span>
                            <span className="text-xs fg-muted">{formatMoney(row.amount)} allocated of {formatMoney(row.parentAmount)}</span>
                            <Link
                              to={transactionHref(row.merchant || undefined)}
                              className="ml-auto inline-flex h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-amber-700 hover:underline dark:text-amber-300"
                            >
                              Open split <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            </Link>
                          </>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selectMode && visibleSelectedCount > 0 && (
          <div className="sticky bottom-0 border-t border-default bg-surface p-3 sm:p-4">
            <button
              type="button"
              disabled={isPending}
              className="btn-primary flex h-11 w-full items-center justify-center gap-2 px-4 text-sm sm:ml-auto sm:w-auto"
              onClick={() => openMove(eligibleIds.filter((id) => selectedIds.has(id)))}
            >
              Move {visibleSelectedCount} transaction{visibleSelectedCount === 1 ? '' : 's'} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {moveIds && (
          <MoveTransactionsDialog
            count={moveIds.length}
            type={selection.type}
            categories={categories}
            currentCategory={selection.category}
            currentSubCategory={selection.subCategory}
            isPending={movePending}
            error={moveError}
            onClose={() => { if (!movePending) setMoveIds(null); }}
            onSave={async (destination) => {
              const ids = moveIds;
              setMoveError(null);
              setMovePending(true);
              try {
                const destinationAssignment = { type: selection.type, ...destination };
                const result = await move.mutateAsync({ ids, expected: selection, ...destinationAssignment });
                if (result.updated !== ids.length) throw new Error('Not all transactions could be moved. Refresh and try again.');
                setLastMove({ ids, expected: destinationAssignment, ...selection });
                setUndoError(null);
                setSelectedIds(new Set());
                setSelectMode(false);
                setMoveIds(null);
                await invalidateFinancialQueries();
                window.requestAnimationFrame(() => undoRef.current?.focus());
              } catch (error) {
                setMoveError((error as Error).message);
              } finally {
                setMovePending(false);
              }
            }}
          />
        )}
    </Dialog>
  );
}

function MoveTransactionsDialog({
  count,
  type,
  categories,
  currentCategory,
  currentSubCategory,
  isPending,
  error,
  onClose,
  onSave,
}: {
  count: number;
  type: 'income' | 'expense';
  categories: MainCategory[];
  currentCategory: string;
  currentSubCategory: string;
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (destination: { category: string; subCategory: string }) => Promise<void>;
}) {
  const titleId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [destination, setDestination] = useState<{ category: string; subCategory: string } | null>(null);
  const visibleCategories = categories
    .filter((category) => category.type === type || category.name === 'Pay down goals')
    .map((category) => ({
      ...category,
      subCategories: category.subCategories.filter((subCategory) =>
        category.name !== currentCategory || subCategory.name !== currentSubCategory),
    }))
    .filter((category) => category.subCategories.length > 0);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredCategories = visibleCategories
    .map((category) => ({
      ...category,
      subCategories: category.subCategories.filter((subCategory) =>
        !normalizedSearch
        || category.name.toLocaleLowerCase().includes(normalizedSearch)
        || subCategory.name.toLocaleLowerCase().includes(normalizedSearch)),
    }))
    .filter((category) => category.subCategories.length > 0);

  return (
    <Dialog
      aria-labelledby={titleId}
      aria-busy={isPending}
      onClose={onClose}
      closeDisabled={isPending}
      initialFocusRef={searchRef}
      overlayClassName="dialog-overlay--dim"
      contentClassName="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-default bg-surface shadow-2xl"
    >
      <div className="border-b border-default p-4 sm:p-5">
        <h3 id={titleId} className="text-lg font-semibold fg-primary">Move {count} transaction{count === 1 ? '' : 's'}</h3>
        <p className="mt-1 text-sm fg-muted">Choose the new budget category. Split transactions cannot be moved here.</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:p-5">
        <label htmlFor={`${titleId}-category-search`} className="text-sm font-medium fg-secondary">Find a destination</label>
        <InputGroup className="h-11 disabled:cursor-wait">
          <InputGroupAddon>
            <Search className="h-4 w-4" aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            ref={searchRef}
            id={`${titleId}-category-search`}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search categories"
            autoComplete="off"
            disabled={isPending}
            className="disabled:cursor-wait disabled:opacity-60"
          />
        </InputGroup>
        <div
          role="radiogroup"
          aria-label="Destination category"
          className="max-h-[min(50vh,22rem)] min-h-32 overflow-y-auto overscroll-contain rounded-lg border border-default bg-canvas-subtle p-2"
        >
          {filteredCategories.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm fg-muted">No categories match your search.</p>
          ) : filteredCategories.map((category) => (
            <section key={category.id} className="mb-3 last:mb-0" aria-labelledby={`${titleId}-${category.id}`}>
              <h4 id={`${titleId}-${category.id}`} className="px-2 py-1 text-xs font-semibold uppercase tracking-wide fg-muted">
                {category.name}
              </h4>
              <div className="space-y-1">
                {category.subCategories.map((subCategory) => {
                  const selected = destination?.category === category.name && destination.subCategory === subCategory.name;
                  return (
                    <button
                      key={subCategory.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={isPending}
                      onClick={() => setDestination({ category: category.name, subCategory: subCategory.name })}
                      className={clsx(
                        'flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:cursor-wait disabled:opacity-60',
                        selected
                          ? 'bg-amber-100 font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                          : 'fg-primary hover:bg-slate-100 dark:hover:bg-slate-700',
                      )}
                    >
                      <span>{subCategory.name}</span>
                      {selected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        {destination && (
          <p className="text-xs fg-secondary" aria-live="polite">
            Moving to <span className="font-semibold fg-primary">{destination.category} › {destination.subCategory}</span>
          </p>
        )}
        {error && <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">{error}</p>}
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-default p-4 sm:flex-row sm:justify-end">
        <button
          type="button"
          disabled={isPending}
          onClick={onClose}
          className="flex h-11 items-center justify-center rounded-lg border border-default px-4 text-sm font-medium fg-secondary disabled:cursor-wait disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!destination || isPending}
          onClick={() => { if (destination) void onSave(destination); }}
          className="btn-primary flex h-11 items-center justify-center gap-2 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {isPending ? 'Moving…' : 'Save move'}
        </button>
      </div>
    </Dialog>
  );
}

function CellFeedback({ status, onRetry }: { status?: PlannedCellStatus; onRetry: () => void }) {
  if (status !== 'error') return null;
  return (
    <span className="block text-xs text-rose-600 dark:text-rose-400 mt-0.5">
      Error{' '}
      <button type="button" className="underline" onMouseDown={(e) => e.preventDefault()} onClick={onRetry}>Retry</button>
    </span>
  );
}
