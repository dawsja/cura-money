import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatMoney, currentYearMonth } from '../lib/format';
import { BarChart3, ChevronDown, ChevronRight } from 'lucide-react';
import { MonthPicker } from '../components/MonthPicker';
import { Progress } from '../components/ui/progress';
import { BudgetSummaryBox } from '../components/BudgetSummaryBox';
import { PaydownBudgetSection, type PaydownBudgetRow, type PaydownBudgetMeta, type PlannedCellStatus } from '../components/PaydownBudgetSection';
import clsx from 'clsx';

interface MainCategory {
  id: string;
  name: string;
  type: 'income' | 'expense' | 'transfer';
  icon?: string;
  subCategories: { id: string; name: string; planned: number; icon?: string }[];
}
interface BudgetRow { subCategoryId: string; planned: number; }
interface Transaction {
  id: string;
  date: string;
  category: string;
  subCategory?: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer';
  splits?: TransactionSplit[];
}
interface TransactionSplit {
  amount: number;
  category: string;
  subCategory: string;
  type: Transaction['type'];
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

export function Budget() {
  const qc = useQueryClient();
  const [ym, setYm] = useState(currentYearMonth());
  const [liveOverrides, setLiveOverrides] = useState<Map<string, number>>(new Map());
  const [paydownLive, setPaydownLive] = useState<Map<string, number>>(new Map());
  const [budgetStatuses, setBudgetStatuses] = useState<Map<string, PlannedCellStatus>>(new Map());
  const [paydownStatuses, setPaydownStatuses] = useState<Map<string, PlannedCellStatus>>(new Map());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const liveOverridesRef = useRef(liveOverrides);
  const paydownLiveRef = useRef(paydownLive);
  const budgetInFlight = useRef(new Set<string>());
  const paydownInFlight = useRef(new Set<string>());

  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get<MainCategory[]>('/api/categories') });
  const budgets = useQuery({
    queryKey: ['budget', ym],
    queryFn: () => api.get<BudgetRow[]>(`/api/budget/${ym}`),
  });
  const txns = useQuery({ queryKey: ['transactions'], queryFn: () => api.get<Transaction[]>('/api/transactions') });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api.get<Account[]>('/api/accounts') });
  const paydownSnapshot = useQuery<PaydownSnapshotResponse>({
    queryKey: ['paydown', 'snapshot', ym],
    queryFn: () => api.get<PaydownSnapshotResponse>(`/api/paydown/snapshot/${ym}`),
  });

  const setBudget = useMutation({
    mutationFn: (input: { subCategoryId: string; yearMonth: string; planned: number }) =>
      api.post('/api/budget', input),
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
    for (const t of txns.data ?? []) {
      if (!t.date.startsWith(ym)) continue;
      for (const allocation of t.splits?.length ? t.splits : [t]) {
        if (allocation.type !== 'income') continue;
        const key = actualKey(allocation.category, allocation.subCategory);
        m.set(key, (m.get(key) ?? 0) + allocation.amount);
      }
    }
    return m;
  }, [txns.data, ym]);

  const spentMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of txns.data ?? []) {
      if (!t.date.startsWith(ym)) continue;
      for (const allocation of t.splits?.length ? t.splits : [t]) {
        if (allocation.type !== 'expense') continue;
        const key = actualKey(allocation.category, allocation.subCategory);
        m.set(key, (m.get(key) ?? 0) + allocation.amount);
      }
    }
    return m;
  }, [txns.data, ym]);

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
    return { plannedIncome, earnedIncome, plannedExpense, spentExpense, plannedDebt };
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
      await setBudget.mutateAsync({ subCategoryId: id, yearMonth: ym, planned: live });
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

  const incomeCats = (cats.data ?? []).filter((c) => c.type === 'income');
  const expenseCats = (cats.data ?? []).filter((c) => c.type === 'expense');
  const loading = cats.isLoading || budgets.isLoading || txns.isLoading || accounts.isLoading || paydownSnapshot.isLoading;
  const failed = cats.isError || budgets.isError || txns.isError || accounts.isError || paydownSnapshot.isError;
  const retry = () => {
    void Promise.all([cats.refetch(), budgets.refetch(), txns.refetch(), accounts.refetch(), paydownSnapshot.refetch()]);
  };

  return (
    <div className="space-y-4 lg:h-full lg:flex lg:flex-col">
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
             main scroll. Desktop: two-column layout with the budget table
             scrolling independently and the summary pinned on the right. */
        <div className="lg:flex-1 lg:min-h-0 flex flex-col lg:flex-row gap-4 lg:gap-6">
        {/* Summary box — appears first on mobile, right column on desktop */}
        <div className="shrink-0 lg:order-2 lg:w-96">
          <BudgetSummaryBox
            plannedIncome={totals.plannedIncome}
            earnedIncome={totals.earnedIncome}
            plannedExpense={totals.plannedExpense}
            spentExpense={totals.spentExpense}
            plannedDebt={totals.plannedDebt}
            loading={false}
            onJumpToPaydown={jumpToPaydown}
          />
        </div>

        <div className="flex-1 min-w-0 lg:overflow-y-auto space-y-6 lg:pr-1">
          <>
              {incomeCats.length > 0 ? (
                <BudgetSection
                  title="Income"
                  cats={incomeCats}
                  plannedMap={mergedPlanned}
                  amountMap={earnedMap}
                  amountType="earned"
                  collapsed={collapsed}
                  onToggleCollapsed={toggleCollapsed}
                  onLiveChange={setLiveOverride}
                  onLiveCommit={(id) => commitOverride(id, 'income')}
                  onLiveReset={clearLiveOverride}
                  statuses={budgetStatuses}
                  yearMonth={ym}
                />
              ) : (
                <div className="card text-sm fg-muted text-center">
                  <BarChart3 className="h-5 w-5 inline mr-1 fg-muted" /> No income categories yet. Add some on the Categories page.
                </div>
              )}

              {expenseCats.length === 0 ? (
                <div className="card text-sm fg-muted text-center">
                  <BarChart3 className="h-5 w-5 inline mr-1 fg-muted" /> No expense categories yet. Add some on the Categories page.
                </div>
              ) : (
                expenseCats.map((cat) => (
                  <BudgetSection
                    key={cat.id}
                    title={cat.name}
                    cats={[cat]}
                    plannedMap={mergedPlanned}
                    amountMap={spentMap}
                    amountType="spent"
                    collapsed={collapsed}
                    onToggleCollapsed={toggleCollapsed}
                    onLiveChange={setLiveOverride}
                    onLiveCommit={(id) => commitOverride(id, 'expense')}
                    onLiveReset={clearLiveOverride}
                    statuses={budgetStatuses}
                    yearMonth={ym}
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
              />
          </>
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
  amountType: 'earned' | 'spent';
  collapsed: Set<string>;
  onToggleCollapsed: (id: string) => void;
  onLiveChange: (id: string, value: number) => void;
  onLiveCommit: (id: string) => void;
  onLiveReset: (id: string) => void;
  statuses: Map<string, PlannedCellStatus>;
  yearMonth: string;
}

function BudgetSection({
  title,
  cats,
  plannedMap,
  amountMap,
  amountType,
  collapsed,
  onToggleCollapsed,
  onLiveChange,
  onLiveCommit,
  onLiveReset,
  statuses,
  yearMonth,
}: BudgetSectionProps) {
  const isCollapsed = collapsed.has(title);
  const allSubs = cats.flatMap((c) => c.subCategories.map((sub) => ({ sub, categoryName: c.name })));
  const totalPlanned = allSubs.reduce((s, x) => s + (plannedMap.get(x.sub.id) ?? x.sub.planned), 0);
  const totalAmount = allSubs.reduce((s, x) => s + (amountMap.get(actualKey(x.categoryName, x.sub.name)) ?? 0), 0);
  const totalRemaining = totalPlanned - totalAmount;
  const isIncome = amountType === 'earned';

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
        </div>
      </button>

      {!isCollapsed && (
        <div className="px-2 sm:px-4 pb-3 pt-1">
          {/* Mobile: card-list layout. Desktop: full table. */}
          <div className="sm:hidden divide-y divide-slate-100 dark:divide-slate-700">
            {allSubs.map(({ sub, categoryName }, index) => {
              const planned = plannedMap.get(sub.id) ?? sub.planned;
              const amount = amountMap.get(actualKey(categoryName, sub.name)) ?? 0;
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
                    <span className="text-sm fg-primary font-medium truncate">{sub.name}</span>
                    <span className={clsx(
                      'text-sm font-semibold tabular-nums shrink-0',
                      remaining < 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-emerald-600 dark:text-emerald-400',
                    )}>
                      {formatMoney(remaining)}
                    </span>
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
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v)) onLiveChange(sub.id, v);
                        }}
                        onBlur={() => onLiveCommit(sub.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') onLiveCommit(sub.id);
                          if (e.key === 'Escape') onLiveReset(sub.id);
                        }}
                        className="w-20 text-right tabular-nums rounded border border-default bg-surface fg-primary px-1.5 py-1 text-xs focus:border-amber-500 focus:outline-none disabled:cursor-wait disabled:opacity-60"
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
                <span className={clsx(
                  'text-sm font-semibold',
                  totalRemaining < 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-emerald-600 dark:text-emerald-400',
                )}>
                  {formatMoney(totalRemaining)}
                </span>
              </div>
            </div>
          </div>

          {/* Desktop table — unchanged */}
          <table className="hidden sm:table w-full text-sm table-fixed">
            <colgroup>
              <col />
              <col className="w-40" />
              <col className="w-32" />
              <col className="w-32" />
              <col className="w-32" />
            </colgroup>
            <thead>
              <tr className="text-left text-xs uppercase fg-muted">
                <th className="py-1">Sub-category</th>
                <th className="py-1"></th>
                <th className="py-1 text-right pl-6">Planned</th>
                <th className="py-1 text-right pl-10">Actual</th>
                <th className="py-1 text-right pl-6">Remaining</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {allSubs.map(({ sub, categoryName }, index) => {
                const planned = plannedMap.get(sub.id) ?? sub.planned;
                const amount = amountMap.get(actualKey(categoryName, sub.name)) ?? 0;
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
                    <td className="py-2 fg-primary">{sub.name}</td>
                    <td className="py-2 pr-2">
                      {showProgress && (
                        <Progress
                          value={progressPct}
                          tone={isIncome ? 'emerald' : progressTone}
                          className="w-full"
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
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v)) onLiveChange(sub.id, v);
                        }}
                        onBlur={() => onLiveCommit(sub.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') onLiveCommit(sub.id);
                          if (e.key === 'Escape') onLiveReset(sub.id);
                        }}
                        className="w-28 text-right tabular-nums rounded border border-default bg-surface fg-primary px-2 py-1 text-sm focus:border-amber-500 focus:outline-none disabled:cursor-wait disabled:opacity-60"
                      />
                      <CellFeedback status={status} onRetry={() => onLiveCommit(sub.id)} />
                    </td>
                    <td className="py-2 text-right pl-10">
                      <div className="tabular-nums fg-secondary">{formatMoney(amount)}</div>
                    </td>
                    <td className={clsx(
                      'py-2 text-right font-semibold tabular-nums pl-6',
                      remaining < 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-emerald-600 dark:text-emerald-400',
                    )}>
                      {formatMoney(remaining)}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td className="py-2 font-semibold fg-primary">Total {title}</td>
                <td className="py-2"></td>
                <td className="py-2 text-right font-semibold tabular-nums fg-secondary pl-6">{formatMoney(totalPlanned)}</td>
                <td className="py-2 text-right font-semibold tabular-nums fg-secondary pl-10">{formatMoney(totalAmount)}</td>
                <td className={clsx(
                  'py-2 text-right font-semibold tabular-nums pl-6',
                  totalRemaining < 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-emerald-600 dark:text-emerald-400',
                )}>
                  {formatMoney(totalRemaining)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CellFeedback({ status, onRetry }: { status?: PlannedCellStatus; onRetry: () => void }) {
  if (!status) return null;
  if (status === 'error') {
    return (
      <span className="block text-xs text-rose-600 dark:text-rose-400 mt-0.5">
        Error{' '}
        <button type="button" className="underline" onMouseDown={(e) => e.preventDefault()} onClick={onRetry}>Retry</button>
      </span>
    );
  }
  return <span aria-live="polite" className={clsx('block text-xs mt-0.5', status === 'saved' ? 'text-emerald-600 dark:text-emerald-400' : 'fg-muted')}>{status === 'saving' ? 'Saving…' : 'Saved'}</span>;
}
