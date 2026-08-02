import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatMoney, currentYearMonth } from '../lib/format';
import { BarChart3, ChevronDown, ChevronRight } from 'lucide-react';
import { MonthPicker } from '../components/MonthPicker';
import { Progress } from '../components/ui/progress';
import { BudgetSummaryBox } from '../components/BudgetSummaryBox';
import { PaydownBudgetSection, type PaydownBudgetRow, type PaydownBudgetMeta } from '../components/PaydownBudgetSection';
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
}
interface Account {
  id: string;
  name: string;
  type: 'checking' | 'savings' | 'credit' | 'investment' | 'loan';
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

export function Budget() {
  const qc = useQueryClient();
  const [ym, setYm] = useState(currentYearMonth());
  const [liveOverrides, setLiveOverrides] = useState<Map<string, number>>(new Map());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budget', ym] }),
  });

  const serverPlannedMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cats.data ?? []) for (const s of c.subCategories) m.set(s.id, s.planned);
    for (const b of budgets.data ?? []) m.set(b.subCategoryId, b.planned);
    return m;
  }, [cats.data, budgets.data]);

  const mergedPlanned = useMemo(() => {
    const m = new Map(serverPlannedMap);
    for (const [k, v] of liveOverrides) m.set(k, v);
    return m;
  }, [serverPlannedMap, liveOverrides]);

  const earnedMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of txns.data ?? []) {
      if (t.type !== 'income') continue;
      if (!t.date.startsWith(ym)) continue;
      const key = t.subCategory ?? t.category;
      m.set(key, (m.get(key) ?? 0) + t.amount);
    }
    return m;
  }, [txns.data, ym]);

  const spentMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of txns.data ?? []) {
      if (t.type !== 'expense') continue;
      if (!t.date.startsWith(ym)) continue;
      const key = t.subCategory ?? t.category;
      m.set(key, (m.get(key) ?? 0) + t.amount);
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
          earnedIncome += earnedMap.get(s.name) ?? 0;
        } else if (c.type === 'expense') {
          plannedExpense += planned;
          spentExpense += spentMap.get(s.name) ?? 0;
        }
      }
    }
    const snapshotByAccount = new Map(
      (paydownSnapshot.data?.rows ?? []).map((r) => [r.accountId, r.planned]),
    );
    let plannedDebt = 0;
    for (const a of accounts.data ?? []) {
      if (!a.includeInPaydown) continue;
      if (a.type !== 'credit' && a.type !== 'loan') continue;
      plannedDebt += snapshotByAccount.get(a.id) ?? (a.plannedPayment > 0 ? a.plannedPayment : a.minPayment ?? 0);
    }
    return { plannedIncome, earnedIncome, plannedExpense, spentExpense, plannedDebt };
  }, [cats.data, mergedPlanned, earnedMap, spentMap, accounts.data, paydownSnapshot.data]);

  const setLiveOverride = useCallback((id: string, value: number) => {
    setLiveOverrides((prev) => {
      const next = new Map(prev);
      next.set(id, value);
      return next;
    });
  }, []);

  const clearLiveOverride = useCallback((id: string) => {
    setLiveOverrides((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const commitOverride = useCallback((id: string) => {
    const live = liveOverrides.get(id);
    const server = serverPlannedMap.get(id) ?? 0;
    if (live !== undefined && live !== server) {
      setBudget.mutate({ subCategoryId: id, yearMonth: ym, planned: live });
    }
    clearLiveOverride(id);
  }, [liveOverrides, serverPlannedMap, setBudget, ym, clearLiveOverride]);

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
  const loading = cats.isLoading || budgets.isLoading || txns.isLoading || accounts.isLoading;

  return (
    <div className="space-y-4 lg:h-full lg:flex lg:flex-col">
      <div className="shrink-0 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold fg-primary">Budget</h1>
        <MonthPicker value={ym} onChange={setYm} />
      </div>

      {/* Mobile: single-column flow (summary then sections) inside the
          main scroll. Desktop: two-column layout with the budget table
          scrolling independently and the summary pinned on the right. */}
      <div className="lg:flex-1 lg:min-h-0 flex flex-col lg:flex-row gap-4 lg:gap-6">
        {/* Summary box — appears first on mobile, right column on desktop */}
        <div className="shrink-0 lg:order-2 lg:w-96">
          <BudgetSummaryBox
            plannedIncome={totals.plannedIncome}
            earnedIncome={totals.earnedIncome}
            plannedExpense={totals.plannedExpense}
            spentExpense={totals.spentExpense}
            plannedDebt={totals.plannedDebt}
            loading={loading && (cats.data ?? []).length === 0}
            onJumpToPaydown={jumpToPaydown}
          />
        </div>

        <div className="flex-1 min-w-0 lg:overflow-y-auto space-y-6 lg:pr-1">
          {loading && (cats.data ?? []).length === 0 ? (
            <div className="card text-sm fg-muted text-center">Loading…</div>
          ) : (
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
                  onLiveCommit={commitOverride}
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
                    onLiveCommit={commitOverride}
                  />
                ))
              )}

              <PaydownBudgetSection
                id={PAYDOWN_SECTION_ID}
                rows={paydownSnapshot.data?.rows ?? []}
                meta={paydownSnapshot.data?.meta ?? { syncedAt: null, rowCount: 0 }}
                collapsed={collapsed}
                onToggleCollapsed={toggleCollapsed}
              />
            </>
          )}
        </div>
      </div>
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
}: BudgetSectionProps) {
  const isCollapsed = collapsed.has(title);
  const allSubs = cats.flatMap((c) => c.subCategories);
  const totalPlanned = allSubs.reduce((s, x) => s + (plannedMap.get(x.id) ?? x.planned), 0);
  const totalAmount = allSubs.reduce((s, x) => s + (amountMap.get(x.name) ?? 0), 0);
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
            {allSubs.map((sub) => {
              const planned = plannedMap.get(sub.id) ?? sub.planned;
              const amount = amountMap.get(sub.name) ?? 0;
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
                        type="number"
                        value={planned}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v)) onLiveChange(sub.id, v);
                        }}
                        onBlur={() => onLiveCommit(sub.id)}
                        className="w-20 text-right tabular-nums rounded border border-default bg-surface fg-primary px-1.5 py-1 text-xs focus:border-amber-500 focus:outline-none"
                      />
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
              {allSubs.map((sub) => {
                const planned = plannedMap.get(sub.id) ?? sub.planned;
                const amount = amountMap.get(sub.name) ?? 0;
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
                        type="number"
                        value={planned}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v)) onLiveChange(sub.id, v);
                        }}
                        onBlur={() => onLiveCommit(sub.id)}
                        className="w-28 text-right tabular-nums rounded border border-default bg-surface fg-primary px-2 py-1 text-sm focus:border-amber-500 focus:outline-none"
                      />
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
