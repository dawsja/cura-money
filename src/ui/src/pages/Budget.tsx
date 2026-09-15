import { useState, useMemo, useCallback, useId, useRef } from 'react';
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { formatDate, formatMoney, currentYearMonth } from '../lib/format';
import { ArrowRight, BarChart3, Check, ChevronDown, ChevronRight, ExternalLink, Layers3, ReceiptText, Search, Undo2 } from 'lucide-react';
import { MonthPicker } from '../components/MonthPicker';
import { Progress } from '../components/ui/progress';
import { BudgetSummaryBox } from '../components/BudgetSummaryBox';
import { PaydownBudgetSection, type PaydownBudgetRow, type PaydownBudgetMeta, type PlannedCellStatus } from '../components/PaydownBudgetSection';
import clsx from 'clsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../components/ui/input-group';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Alert, AlertAction, AlertDescription } from '../components/ui/alert';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty';
import { Checkbox } from '../components/ui/checkbox';
import { Field, FieldGroup, FieldLabel } from '../components/ui/field';
import { Badge } from '../components/ui/badge';
import { Spinner } from '../components/ui/spinner';
import { AsyncQueryState } from '../components/ui/AsyncQueryState';

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
const PLANNED_INPUT_CLS = 'min-h-11 w-28 text-right tabular-nums sm:h-9 sm:min-h-0';

export function Budget() {
  const qc = useQueryClient();
  const [ym, setYm] = useState(currentYearMonth());
  const [liveOverrides, setLiveOverrides] = useState<Map<string, number>>(new Map());
  const [paydownLive, setPaydownLive] = useState<Map<string, number>>(new Map());
  const [budgetStatuses, setBudgetStatuses] = useState<Map<string, PlannedCellStatus>>(new Map());
  const [paydownStatuses, setPaydownStatuses] = useState<Map<string, PlannedCellStatus>>(new Map());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drilldown, setDrilldown] = useState<BudgetDrilldown | null>(null);
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
        toast('Budget saved for this month.', {
          description: 'Apply this amount to future months?',
          duration: 8000,
          action: {
            label: 'Apply',
            onClick: () => {
              applyFuture.mutate(
                { subCategoryId: id, yearMonth: ym, revision: result.revision },
                {
                  onSuccess: () => {
                    void qc.invalidateQueries({ queryKey: ['budget'] });
                  },
                  onError: (error) => toast.error((error as Error).message),
                },
              );
            },
          },
          cancel: {
            label: 'Not now',
            onClick: () => {},
          },
        });
      }
    } catch {
      setBudgetStatuses((prev) => new Map(prev).set(key, 'error'));
    } finally {
      budgetInFlight.current.delete(key);
    }
  }, [serverPlannedMap, setBudget, applyFuture, qc, ym, clearLiveOverride]);

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
    <div className="flex flex-col gap-4">
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-foreground">Budget</h1>
        <MonthPicker value={ym} onChange={setYm} />
      </div>

      {loading ? (
        <AsyncQueryState status="loading" title="Loading…" />
      ) : failed ? (
        <AsyncQueryState
          status="error"
          title="Budget data could not be loaded."
          onRetry={retry}
        />
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

        <div className="min-w-0 flex-1 flex flex-col gap-6">
          <>
              {refreshFailed && (
                <Alert variant="destructive">
                  <AlertDescription>This month could not be refreshed.</AlertDescription>
                  <AlertAction>
                    <Button type="button" size="sm" variant="outline" onClick={retry}>Retry</Button>
                  </AlertAction>
                </Alert>
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
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon"><BarChart3 /></EmptyMedia>
        <EmptyTitle>No {type} categories yet</EmptyTitle>
        <EmptyDescription>
          <Link to="/categories">Add some on the Categories page.</Link>
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
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
    <Card className="gap-0 py-0">
      <CardHeader className="p-0">
        <Button
          type="button"
          variant="ghost"
          onClick={() => onToggleCollapsed(title)}
          className={clsx(
            'h-auto w-full justify-between rounded-t-xl px-4 py-2 whitespace-normal',
            headerBg,
          )}
          aria-expanded={!isCollapsed}
        >
          <CardTitle className="flex items-center gap-2">
            {isCollapsed ? <ChevronRight data-icon="inline-start" className="text-muted-foreground" /> : <ChevronDown data-icon="inline-start" className="text-muted-foreground" />}
            {title}
          </CardTitle>
          <div className="flex items-baseline gap-3 text-sm tabular-nums sm:gap-6">
            <div className="hidden sm:block">
              <span className="mr-2 text-xs uppercase tracking-wider text-muted-foreground">Planned</span>
              <span className="font-semibold text-foreground">{formatMoney(totalPlanned)}</span>
            </div>
            <div className="hidden sm:block">
              <span className="mr-2 text-xs uppercase tracking-wider text-muted-foreground">Actual</span>
              <span className="font-semibold text-foreground">{formatMoney(totalAmount)}</span>
            </div>
            {isIncome ? (
              <div className="sm:hidden">
                <span className="mr-1 text-xs uppercase tracking-wider text-muted-foreground">Actual</span>
                <span className="font-semibold text-foreground">{formatMoney(totalAmount)}</span>
              </div>
            ) : (
              <div>
                <span className="mr-1 text-xs uppercase tracking-wider text-muted-foreground sm:mr-2">Left</span>
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
        </Button>
      </CardHeader>

      {!isCollapsed && (
        <CardContent className="px-2 pt-1 pb-3 sm:px-4">
          {/* Mobile: card-list layout. Desktop: full table. */}
          <div className="divide-y sm:hidden">
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
                <div key={sub.id} className="flex flex-col gap-1.5 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Button
                      type="button"
                      variant="link"
                      onClick={() => onOpenDrilldown({ category: categoryName, subCategory: sub.name, type: isIncome ? 'income' : 'expense' })}
                      title={`View transactions for ${sub.name}`}
                      className="inline-flex h-auto min-w-0 items-center justify-start gap-1 px-0 text-left text-sm font-medium text-foreground"
                    >
                      <span className="truncate">{sub.name}</span>
                      {txnCount > 0 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{txnCount}</span>}
                      <ChevronRight data-icon="inline-end" className="text-muted-foreground" aria-hidden="true" />
                    </Button>
                    {isIncome ? (
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                        {formatMoney(amount)}
                      </span>
                    ) : (
                      <span className={clsx(
                        'shrink-0 text-sm font-semibold tabular-nums',
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
                      <span className="text-muted-foreground">Planned</span>
                      <Input
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
                    <span className="tabular-nums text-muted-foreground">
                      {formatMoney(amount)} {amountType}
                    </span>
                  </div>
                </div>
              );
            })}
            {/* Mobile totals row */}
            <div className="flex items-center justify-between gap-2 py-2.5">
              <span className="text-sm font-semibold text-foreground">Total</span>
              <div className="flex items-center gap-3 text-xs tabular-nums">
                <span className="text-muted-foreground">{formatMoney(totalPlanned)} planned</span>
                {isIncome ? (
                  <span className="text-sm font-semibold text-foreground">{formatMoney(totalAmount)}</span>
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
          <table className="hidden w-full table-fixed text-sm sm:table">
            <colgroup>
              <col />
              <col className="w-32" />
              <col className="w-32" />
              {!isIncome && <col className="w-32" />}
            </colgroup>
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="py-1">Sub-category</th>
                <th className="py-1 pl-6 text-right">Planned</th>
                <th className="py-1 pl-10 text-right">Actual</th>
                {!isIncome && <th className="py-1 pl-6 text-right">Remaining</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
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
                    <td className="py-2 text-foreground">
                      <Button
                        type="button"
                        variant="link"
                        onClick={() => onOpenDrilldown({ category: categoryName, subCategory: sub.name, type: isIncome ? 'income' : 'expense' })}
                        title={`View transactions for ${sub.name}`}
                        className="inline-flex h-auto max-w-full items-center justify-start gap-1 px-0 text-left"
                      >
                        <span className="truncate">{sub.name}</span>
                        {txnCount > 0 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{txnCount}</span>}
                        <ChevronRight data-icon="inline-end" className="text-muted-foreground" aria-hidden="true" />
                      </Button>
                      {showProgress && (
                        <Progress
                          value={progressPct}
                          tone={isIncome ? 'emerald' : progressTone}
                          className="mt-1.5 max-w-xs"
                        />
                      )}
                    </td>
                    <td className="py-2 pl-6 text-right">
                      <Input
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
                    <td className="py-2 pl-10 text-right">
                      <div className="tabular-nums text-muted-foreground">{formatMoney(amount)}</div>
                    </td>
                    {!isIncome && (
                      <td className={clsx(
                        'py-2 pl-6 text-right font-semibold tabular-nums',
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
                <td className="py-2 font-semibold text-foreground">Total {title}</td>
                <td className="py-2 pl-6 text-right font-semibold tabular-nums text-muted-foreground">{formatMoney(totalPlanned)}</td>
                <td className="py-2 pl-10 text-right font-semibold tabular-nums text-muted-foreground">{formatMoney(totalAmount)}</td>
                {!isIncome && (
                  <td className={clsx(
                    'py-2 pl-6 text-right font-semibold tabular-nums',
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
        </CardContent>
      )}
    </Card>
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
      open
      onOpenChange={(open) => {
        if (!open) closeViewer();
      }}
    >
      <DialogContent
        aria-busy={isPending}
        showCloseButton={!isPending}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        onEscapeKeyDown={(event) => { if (isPending) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (isPending) event.preventDefault(); }}
      >
        <DialogHeader className="border-b p-4 pr-12 sm:p-5 sm:pr-12">
          <DialogTitle className="truncate">{selection.subCategory}</DialogTitle>
          <DialogDescription>{selection.category} · {monthLabel}</DialogDescription>
        </DialogHeader>

        <div className="border-b bg-muted/40 px-4 py-3 sm:px-5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{rows.length} transaction{rows.length === 1 ? '' : 's'}</span>
            <span className="font-semibold tabular-nums text-foreground">{formatMoney(total)} {selection.type === 'income' ? 'earned' : 'spent'}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {eligibleIds.length > 0 && (
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => {
                  setSelectMode((current) => !current);
                  setSelectedIds(new Set());
                }}
              >
                {selectMode ? 'Exit select' : 'Select transactions'}
              </Button>
            )}
            {selectMode && (
              <Button
                type="button"
                variant="ghost"
                disabled={isPending}
                onClick={() => setSelectedIds(allEligibleSelected ? new Set() : new Set(eligibleIds))}
              >
                {allEligibleSelected ? 'Clear eligible' : 'Select all eligible'}
              </Button>
            )}
            <Button variant="link" asChild className="ml-auto">
              <Link to={transactionHref()}>
                View all in Transactions <ExternalLink data-icon="inline-end" />
              </Link>
            </Button>
          </div>
          {selectMode && <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">{visibleSelectedCount} selected · Split transactions are not eligible.</p>}
        </div>

        {(lastMove || undoError) && (
          <Alert variant={undoError ? 'destructive' : 'default'} className="rounded-none border-x-0 border-t-0">
            <AlertDescription>
              {undoError ?? `${lastMove?.ids.length ?? 0} transaction${lastMove?.ids.length === 1 ? '' : 's'} moved.`}
            </AlertDescription>
            {lastMove && (
              <AlertAction>
                <Button
                  ref={undoRef}
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
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
                  {undoPending ? <Spinner data-icon="inline-start" /> : <Undo2 data-icon="inline-start" />}
                  {undoPending ? 'Undoing…' : 'Undo'}
                </Button>
              </AlertAction>
            )}
          </Alert>
        )}

        <div className="min-h-0 overflow-y-auto">
          {rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><ReceiptText /></EmptyMedia>
                <EmptyTitle>No transactions</EmptyTitle>
                <EmptyDescription>Nothing currently contributes to this subcategory for {monthLabel}.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="divide-y">
              {rows.map((row) => {
                const checked = selectedIds.has(row.id);
                return (
                  <li key={row.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                    {selectMode && !row.hasSplits && (
                      <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg">
                        <Checkbox
                          checked={checked}
                          disabled={isPending}
                          onCheckedChange={() => toggleSelected(row.id)}
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
                          <p className="truncate text-sm font-medium text-foreground">{row.merchant || 'Unknown merchant'}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(row.date)} · {row.account || 'Unknown account'}</p>
                        </div>
                        {!row.hasSplits && !selectMode && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={isPending}
                            onClick={() => openMove([row.id])}
                            aria-label={`Move ${row.merchant || 'unknown merchant'} transaction to another category`}
                            title="Move to another category"
                          >
                            <ArrowRight />
                          </Button>
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
                            <Badge variant="outline">
                              <Layers3 data-icon="inline-start" /> Split
                            </Badge>
                            <span className="text-xs text-muted-foreground">{formatMoney(row.amount)} allocated of {formatMoney(row.parentAmount)}</span>
                            <Button variant="link" asChild className="ml-auto">
                              <Link to={transactionHref(row.merchant || undefined)}>
                                Open split <ExternalLink data-icon="inline-end" />
                              </Link>
                            </Button>
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
          <DialogFooter className="mx-0 mb-0">
            <Button
              type="button"
              disabled={isPending}
              className="w-full sm:ml-auto sm:w-auto"
              onClick={() => openMove(eligibleIds.filter((id) => selectedIds.has(id)))}
            >
              Move {visibleSelectedCount} transaction{visibleSelectedCount === 1 ? '' : 's'}
              <ArrowRight data-icon="inline-end" />
            </Button>
          </DialogFooter>
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
      </DialogContent>
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
      open
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
    >
      <DialogContent
        aria-busy={isPending}
        showCloseButton={!isPending}
        className="flex w-full max-w-lg flex-col overflow-hidden sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => { if (isPending) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (isPending) event.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>Move {count} transaction{count === 1 ? '' : 's'}</DialogTitle>
          <DialogDescription>Choose the new budget category. Split transactions cannot be moved here.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${titleId}-category-search`}>Find a destination</FieldLabel>
            <InputGroup className="h-11">
              <InputGroupAddon>
                <Search aria-hidden="true" />
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
              />
            </InputGroup>
          </Field>
        </FieldGroup>
        <div
          role="radiogroup"
          aria-label="Destination category"
          className="max-h-[min(50vh,22rem)] min-h-32 overflow-y-auto overscroll-contain rounded-lg border bg-muted/30 p-2"
        >
          {filteredCategories.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No categories match your search.</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : filteredCategories.map((category) => (
            <section key={category.id} className="mb-3 last:mb-0" aria-labelledby={`${titleId}-${category.id}`}>
              <h4 id={`${titleId}-${category.id}`} className="px-2 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {category.name}
              </h4>
              <div className="flex flex-col gap-1">
                {category.subCategories.map((subCategory) => {
                  const selected = destination?.category === category.name && destination.subCategory === subCategory.name;
                  return (
                    <Button
                      key={subCategory.id}
                      type="button"
                      variant="ghost"
                      role="radio"
                      aria-checked={selected}
                      disabled={isPending}
                      onClick={() => setDestination({ category: category.name, subCategory: subCategory.name })}
                      className={clsx(
                        'h-auto min-h-11 w-full justify-between px-3 py-2 text-left whitespace-normal',
                        selected
                          ? 'bg-amber-100 font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                          : '',
                      )}
                    >
                      <span>{subCategory.name}</span>
                      {selected && <Check className="shrink-0" aria-hidden="true" />}
                    </Button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        {destination && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Moving to <span className="font-semibold text-foreground">{destination.category} › {destination.subCategory}</span>
          </p>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!destination || isPending}
            onClick={() => { if (destination) void onSave(destination); }}
          >
            {isPending && <Spinner data-icon="inline-start" />}
            {isPending ? 'Moving…' : 'Save move'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CellFeedback({ status, onRetry }: { status?: PlannedCellStatus; onRetry: () => void }) {
  if (status !== 'error') return null;
  return (
    <span className="mt-0.5 block text-xs text-destructive">
      Error{' '}
      <Button type="button" variant="link" size="sm" className="h-auto px-0" onMouseDown={(e) => e.preventDefault()} onClick={onRetry}>Retry</Button>
    </span>
  );
}
