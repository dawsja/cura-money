import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { currentYearMonth, formatMoney } from '../lib/format';
import { formatAccountBalance, netWorthContribution, isLiability } from '../lib/accounting';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowLeftRight,
  ChevronRight,
  Check,
  Pencil,
  X,
  Calendar,
  BellRing,
} from 'lucide-react';
import { SummaryCard } from '../components/SummaryCard';
import { SortableWidgetList } from '../components/SortableWidgetList';
import { Progress } from '../components/ui/progress';
import { GoalProgressBar } from '../components/GoalProgressBar';
import clsx from 'clsx';
import { AsyncQueryState } from '../components/ui/AsyncQueryState';
import { useReviews } from '../components/ReviewsProvider';

interface Account { id: string; name: string; type: string; balance: number; institution?: string; }
interface DashboardTransaction {
  id: string;
  date: string;
  merchant: string;
  category: string;
  subCategory?: string;
  account: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer';
}
interface DashboardActivity {
  income: number;
  expense: number;
  transferCount: number;
  recent: DashboardTransaction[];
}

interface RecurringCharge {
  merchant: string;
  amount: number;
  frequency: 'weekly' | 'monthly' | 'yearly';
  nextDate: string;
  daysUntil: number;
  comingSoon: boolean;
  account: string;
  accountId?: string;
}

interface Goal {
  id: string;
  name: string;
  target: number;
  startingValue: number;
  accountId: string | null;
  accountBalance: number | null;
  accountName: string | null;
}

interface MainCategory {
  id: string;
  name: string;
  type: 'income' | 'expense' | 'transfer';
  subCategories: { id: string; name: string; planned: number }[];
}

interface BudgetRow { subCategoryId: string; planned: number; }
interface BudgetActivityRow {
  category: string;
  subCategory: string;
  type: 'income' | 'expense';
  actual: number;
}

const DEFAULT_WIDGET_ORDER = [
  'budget',
  'coming-up',
  'save-up',
  'summary',
  'assets-liabilities',
  'recent-transactions',
  'accounts',
] as const;
type WidgetId = (typeof DEFAULT_WIDGET_ORDER)[number];
const DEFAULT_HIDDEN: WidgetId[] = ['accounts'];
interface DashboardLayout { order: WidgetId[]; hidden: WidgetId[]; }

const WIDGET_LABELS: Record<WidgetId, string> = {
  summary: 'Summary',
  budget: 'This month',
  'coming-up': 'Coming up',
  'save-up': 'Save up',
  'assets-liabilities': 'Assets & Liabilities',
  accounts: 'Accounts',
  'recent-transactions': 'Recent transactions',
};

const actualKey = (category: string, subCategory?: string) => `${category}\0${subCategory ?? category}`;

function withAllWidgets(order: WidgetId[]): WidgetId[] {
  const next = order.filter((id) => (DEFAULT_WIDGET_ORDER as readonly string[]).includes(id));
  for (const id of DEFAULT_WIDGET_ORDER) {
    if (next.includes(id)) continue;
    const defaultIdx = DEFAULT_WIDGET_ORDER.indexOf(id);
    let insertAt = next.length;
    for (let i = defaultIdx - 1; i >= 0; i--) {
      const prevPos = next.indexOf(DEFAULT_WIDGET_ORDER[i]!);
      if (prevPos !== -1) {
        insertAt = prevPos + 1;
        break;
      }
    }
    next.splice(insertAt, 0, id);
  }
  return next;
}

/** Visual styling for a transaction type — kept in one place so the
 *  Dashboard "Recent" list, the Transactions table, and anywhere else
 *  we render a tx all agree. */
function txTypeStyle(type: DashboardTransaction['type']): { sign: string; amount: string } {
  if (type === 'income') return { sign: '+', amount: 'text-emerald-600 dark:text-emerald-400' };
  if (type === 'expense') return { sign: '−', amount: 'text-rose-600 dark:text-rose-400' };
  return { sign: '⇄', amount: 'text-slate-600 dark:text-slate-400' };
}

function daysLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reviews = useReviews();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [draftOrder, setDraftOrder] = useState<WidgetId[]>([...DEFAULT_WIDGET_ORDER]);
  const [draftHidden, setDraftHidden] = useState<WidgetId[]>([]);
  const toggleSection = (key: string) =>
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api.get<Account[]>('/api/accounts') });
  const activity = useQuery({
    queryKey: ['dashboard', 'activity'],
    queryFn: () => api.get<DashboardActivity>('/api/dashboard/activity'),
  });
  const layout = useQuery({
    queryKey: ['dashboard', 'layout'],
    queryFn: () => api.get<DashboardLayout>('/api/dashboard/layout'),
  });
  const ym = currentYearMonth();
  const recurring = useQuery({
    queryKey: ['recurring'],
    queryFn: () => api.get<RecurringCharge[]>('/api/recurring'),
  });
  const goals = useQuery({
    queryKey: ['goals'],
    queryFn: () => api.get<Goal[]>('/api/goals'),
  });
  const cats = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<MainCategory[]>('/api/categories'),
  });
  const budgets = useQuery({
    queryKey: ['budget', ym],
    queryFn: () => api.get<BudgetRow[]>(`/api/budget/${ym}`),
  });
  const budgetActivity = useQuery({
    queryKey: ['budget', 'activity', ym],
    queryFn: () => api.get<{ yearMonth: string; rows: BudgetActivityRow[] }>(`/api/budget/${ym}/activity`),
  });
  const saveLayout = useMutation({
    mutationFn: (next: DashboardLayout) => api.put<DashboardLayout>('/api/dashboard/layout', next),
    onSuccess: (saved) => {
      queryClient.setQueryData(['dashboard', 'layout'], saved);
      setEditing(false);
    },
  });

  const savedOrder = withAllWidgets(layout.data?.order ?? [...DEFAULT_WIDGET_ORDER]);
  const savedHidden = (layout.data?.hidden ?? DEFAULT_HIDDEN).filter((id) => (DEFAULT_WIDGET_ORDER as readonly string[]).includes(id));
  const startEditing = () => {
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
  const toggleHidden = (widget: WidgetId) => {
    setDraftHidden((current) => current.includes(widget) ? current.filter((id) => id !== widget) : [...current, widget]);
  };

  const monthBudget = useMemo(() => {
    const plannedBySub = new Map<string, number>();
    for (const c of cats.data ?? []) {
      for (const s of c.subCategories) plannedBySub.set(s.id, s.planned);
    }
    for (const b of budgets.data ?? []) plannedBySub.set(b.subCategoryId, b.planned);

    const spentByKey = new Map<string, number>();
    for (const row of budgetActivity.data?.rows ?? []) {
      if (row.type !== 'expense') continue;
      spentByKey.set(actualKey(row.category, row.subCategory), row.actual);
    }

    let plannedExpense = 0;
    let spentExpense = 0;
    const categories: { key: string; name: string; planned: number; spent: number }[] = [];
    for (const c of cats.data ?? []) {
      if (c.type !== 'expense') continue;
      for (const s of c.subCategories) {
        const planned = plannedBySub.get(s.id) ?? s.planned;
        const spent = spentByKey.get(actualKey(c.name, s.name)) ?? 0;
        plannedExpense += planned;
        spentExpense += spent;
        if (planned > 0) categories.push({ key: s.id, name: s.name, planned, spent });
      }
    }
    categories.sort((a, b) => (b.spent / b.planned) - (a.spent / a.planned) || b.spent - a.spent);
    return {
      plannedExpense,
      spentExpense,
      remaining: plannedExpense - spentExpense,
      hotspots: categories.slice(0, 3),
    };
  }, [cats.data, budgets.data, budgetActivity.data]);

  const upcomingCharges = useMemo(() => {
    const charges = recurring.data ?? [];
    const soon = charges.filter((c) => c.comingSoon).sort((a, b) => a.daysUntil - b.daysUntil);
    if (soon.length > 0) return soon.slice(0, 4);
    return [...charges].sort((a, b) => a.daysUntil - b.daysUntil).slice(0, 4);
  }, [recurring.data]);

  const goalRows = useMemo(() => {
    const list = goals.data ?? [];
    const active = list.filter((goal) => goal.accountBalance === null || goal.accountBalance < goal.target);
    return (active.length > 0 ? active : list).slice(0, 3);
  }, [goals.data]);

  if (accounts.isLoading || activity.isLoading || layout.isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold fg-primary">Home</h1>
        <AsyncQueryState status="loading" title="Loading Home…" message="Fetching accounts and recent transactions." />
      </div>
    );
  }

  if (accounts.isError || activity.isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold fg-primary">Home</h1>
        <AsyncQueryState
          status="error"
          title="Could not load Home"
          message="Account and transaction data is unavailable, so financial totals are hidden."
          onRetry={() => void Promise.all([accounts.refetch(), activity.refetch()])}
          retrying={accounts.isFetching || activity.isFetching}
        />
      </div>
    );
  }

  // Sum *signed* contributions so credit cards + loans subtract from
  // net worth. `a.balance` is always stored positive — see
  // `netWorthContribution` in `lib/accounting.ts` for the convention.
  const totalBalance = accounts.data?.reduce((s, a) => s + netWorthContribution(a), 0) ?? 0;
  const income = activity.data?.income ?? 0;
  const expense = activity.data?.expense ?? 0;
  const transferCount = activity.data?.transferCount ?? 0;

  // Assets vs Liabilities breakdown
  const assetAccounts = accounts.data?.filter((a) => a.type !== 'uncategorized' && !isLiability(a.type)) ?? [];
  const liabilityAccounts = accounts.data?.filter((a) => isLiability(a.type)) ?? [];
  const totalAssets = assetAccounts.reduce((s, a) => s + Math.abs(a.balance), 0);
  const totalLiabilities = liabilityAccounts.reduce((s, a) => s + Math.abs(a.balance), 0);
  const cashAccounts = assetAccounts.filter((a) => a.type === 'checking' || a.type === 'savings');
  const investmentAccounts = assetAccounts.filter((a) => a.type === 'investment');
  const creditAccounts = liabilityAccounts.filter((a) => a.type === 'credit');
  const loanAccounts = liabilityAccounts.filter((a) => a.type === 'loan');
  const cashTotal = cashAccounts.reduce((s, a) => s + Math.abs(a.balance), 0);
  const investmentTotal = investmentAccounts.reduce((s, a) => s + Math.abs(a.balance), 0);
  const creditTotal = creditAccounts.reduce((s, a) => s + Math.abs(a.balance), 0);
  const loanTotal = loanAccounts.reduce((s, a) => s + Math.abs(a.balance), 0);

  const renderWidget = (widget: WidgetId) => {
    if (widget === 'summary') {
      return (
        <div className="summary-scroll grid grid-cols-1 gap-3 md:grid-cols-3">
          <SummaryCard label="Net worth" sub="Sum of all accounts" tone={totalBalance >= 0 ? 'slate' : 'rose'} icon={<Wallet className="h-4 w-4" />} value={formatMoney(totalBalance)} />
          <SummaryCard label="Income (30d)" sub="Deposits (transfers excluded)" tone="emerald" icon={<TrendingUp className="h-4 w-4" />} value={formatMoney(income)} />
          <SummaryCard label="Spending (30d)" sub="Out-of-pocket expenses" tone="rose" icon={<TrendingDown className="h-4 w-4" />} value={formatMoney(expense)} />
        </div>
      );
    }

    if (widget === 'budget') {
      const budgetLoading = cats.isLoading || budgets.isLoading || budgetActivity.isLoading;
      const budgetError = cats.isError || budgets.isError || budgetActivity.isError;
      const pct = monthBudget.plannedExpense > 0
        ? (monthBudget.spentExpense / monthBudget.plannedExpense) * 100
        : 0;
      const over = monthBudget.remaining < 0;
      return (
        <section className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold fg-primary">This month</h2>
            <button type="button" onClick={() => navigate('/budget')} className="text-sm text-amber-700 dark:text-amber-400 hover:underline flex items-center gap-1">
              Budget <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          {budgetLoading ? (
            <p className="py-4 text-sm fg-muted text-center">Loading this month's budget...</p>
          ) : budgetError ? (
            <p className="py-4 text-sm text-rose-600 dark:text-rose-400 text-center">Could not load this month's budget.</p>
          ) : monthBudget.plannedExpense <= 0 && monthBudget.spentExpense <= 0 ? (
            <EmptyAction message="No expense budget this month." action="Set budget" onClick={() => navigate('/budget')} />
          ) : (
            <div className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wider fg-muted">Left to spend</p>
                  <p className={clsx('text-2xl font-bold tabular-nums', over ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')}>
                    {over ? '−' : ''}{formatMoney(Math.abs(monthBudget.remaining))}
                  </p>
                </div>
                <div className="text-right text-xs fg-muted tabular-nums">
                  {formatMoney(monthBudget.spentExpense)} of {formatMoney(monthBudget.plannedExpense)}
                </div>
              </div>
              <Progress
                value={pct}
                tone={over ? 'rose' : monthBudget.spentExpense >= monthBudget.plannedExpense * 0.7 ? 'amber' : 'emerald'}
              />
              {monthBudget.hotspots.length > 0 && (
                <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                  {monthBudget.hotspots.map((row) => {
                    const rowOver = row.spent > row.planned;
                    return (
                      <li key={row.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="truncate fg-primary">{row.name}</span>
                        <span className={clsx('shrink-0 tabular-nums', rowOver ? 'text-rose-600 dark:text-rose-400' : 'fg-secondary')}>
                          {formatMoney(row.spent)} / {formatMoney(row.planned)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </section>
      );
    }

    if (widget === 'coming-up') {
      return (
        <section className="card flex h-full flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold fg-primary">Coming up</h2>
            <button type="button" onClick={() => navigate('/recurring')} className="text-sm text-amber-700 dark:text-amber-400 hover:underline flex items-center gap-1">
              Recurring <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          {recurring.isLoading ? (
            <p className="py-4 text-sm fg-muted text-center">Loading upcoming charges…</p>
          ) : recurring.isError ? (
            <p className="py-4 text-sm text-rose-600 dark:text-rose-400 text-center">Could not load upcoming charges.</p>
          ) : upcomingCharges.length === 0 ? (
            <EmptyAction message="No upcoming charges." action="See recurring" onClick={() => navigate('/recurring')} />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-700">
              {upcomingCharges.map((charge) => (
                <li key={`${charge.merchant}|${charge.accountId ?? charge.account}|${charge.nextDate}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium fg-primary truncate">{charge.merchant}</div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs fg-muted">
                      <Calendar className="h-3 w-3" />
                      {daysLabel(charge.daysUntil)}
                    </div>
                  </div>
                  <div className="shrink-0 font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                    {formatMoney(charge.amount)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      );
    }

    if (widget === 'save-up') {
      return (
        <section className="card flex h-full flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold fg-primary">Save up</h2>
            <button type="button" onClick={() => navigate('/saveup')} className="text-sm text-amber-700 dark:text-amber-400 hover:underline flex items-center gap-1">
              Goals <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          {goals.isLoading ? (
            <p className="py-4 text-sm fg-muted text-center">Loading savings goals…</p>
          ) : goals.isError ? (
            <p className="py-4 text-sm text-rose-600 dark:text-rose-400 text-center">Could not load savings goals.</p>
          ) : goalRows.length === 0 ? (
            <EmptyAction message="No savings goals yet." action="Add a goal" onClick={() => navigate('/saveup')} />
          ) : (
            <ul className="space-y-3">
              {goalRows.map((goal) => {
                const current = goal.accountBalance ?? 0;
                const hasAccount = goal.accountBalance !== null;
                const pct = hasAccount && goal.target > 0 ? Math.min(100, (Math.max(0, current) / goal.target) * 100) : 0;
                const reached = hasAccount && current >= goal.target;
                return (
                  <li key={goal.id}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium fg-primary truncate">{goal.name}</span>
                      <span className={clsx('shrink-0 tabular-nums', reached ? 'text-emerald-600 dark:text-emerald-400' : 'fg-secondary')}>
                        {hasAccount ? `${formatMoney(current)} / ${formatMoney(goal.target)}` : 'No account'}
                      </span>
                    </div>
                    <GoalProgressBar className="mt-1.5" value={pct} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      );
    }

    if (widget === 'assets-liabilities') {
      return (
        <section className="card">
          <h2 className="text-lg font-semibold fg-primary mb-4">Assets & Liabilities</h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold fg-primary">Assets</span>
                <span className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatMoney(totalAssets)}</span>
              </div>
              <ul className="space-y-1 pl-3">
                <ExpandableSubcategory label="Cash" total={cashTotal} accounts={cashAccounts} expanded={expandedSections.has('cash')} onToggle={() => toggleSection('cash')} />
                <ExpandableSubcategory label="Investments" total={investmentTotal} accounts={investmentAccounts} expanded={expandedSections.has('investments')} onToggle={() => toggleSection('investments')} />
              </ul>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold fg-primary">Liabilities</span>
                <span className="text-sm font-semibold tabular-nums text-rose-600 dark:text-rose-400">{formatMoney(totalLiabilities)}</span>
              </div>
              <ul className="space-y-1 pl-3">
                <ExpandableSubcategory label="Credit Cards" total={creditTotal} accounts={creditAccounts} expanded={expandedSections.has('credit')} onToggle={() => toggleSection('credit')} />
                <ExpandableSubcategory label="Loans" total={loanTotal} accounts={loanAccounts} expanded={expandedSections.has('loans')} onToggle={() => toggleSection('loans')} />
              </ul>
            </div>
          </div>
        </section>
      );
    }

    if (widget === 'accounts') {
      return (
        <section className="card flex h-full flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold fg-primary">Accounts</h2>
            <button onClick={() => navigate('/accounts')} className="text-sm text-amber-700 dark:text-amber-400 hover:underline flex items-center gap-1">
              Manage <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">
            {accounts.data?.slice(0, 4).map((a) => {
              const balance = formatAccountBalance(a, formatMoney);
              return (
                <li key={a.id} className="flex justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium fg-primary truncate">{a.name}</div>
                    <div className="text-xs fg-muted truncate">{a.institution ?? a.type}</div>
                  </div>
                  <div className={clsx('shrink-0 font-semibold tabular-nums', balance.colorClass)}>{balance.text}</div>
                </li>
              );
            })}
            {accounts.data?.length === 0 && (
              <li>
                <EmptyAction message="No accounts yet." action="Add an account" onClick={() => navigate('/accounts')} />
              </li>
            )}
          </ul>
        </section>
      );
    }

    return (
      <section className="card flex h-full flex-col">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-3">
          <h2 className="text-lg font-semibold fg-primary">Recent transactions</h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs fg-muted">
            {transferCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <ArrowLeftRight className="h-3 w-3 shrink-0" /> {transferCount} transfer{transferCount === 1 ? '' : 's'} (excluded from totals)
              </span>
            )}
            <button onClick={() => navigate('/transactions')} className="text-sm text-amber-700 dark:text-amber-400 hover:underline flex items-center gap-1">
              View all <ArrowRight className="h-3 w-3 shrink-0" />
            </button>
          </div>
        </div>
        <ul className="divide-y divide-slate-100 dark:divide-slate-700">
          {activity.data?.recent.map((t) => {
            const style = txTypeStyle(t.type);
            return (
              <li key={t.id} className="flex justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-1.5 fg-primary">
                    {t.type === 'transfer' && <ArrowLeftRight className="h-3 w-3 shrink-0 fg-muted" />}
                    <span className="truncate">{t.merchant}</span>
                  </div>
                  <div className="text-xs fg-muted truncate">{t.date} · {t.category}{t.subCategory ? ` › ${t.subCategory}` : ''} · {t.account}</div>
                </div>
                <div className={clsx('shrink-0 font-semibold tabular-nums', style.amount)}>{style.sign}{formatMoney(t.amount)}</div>
              </li>
            );
          })}
          {activity.data?.recent.length === 0 && <li className="py-4 text-sm fg-muted text-center">No transactions yet.</li>}
        </ul>
      </section>
    );
  };

  const displayedOrder = editing ? draftOrder : savedOrder;
  const displayedHidden = new Set(editing ? draftHidden : savedHidden);
  const visibleDisplayedOrder = displayedOrder.filter((widget) => !displayedHidden.has(widget));
  const PAIR_NEIGHBOR: Partial<Record<WidgetId, WidgetId>> = {
    'coming-up': 'save-up',
    'save-up': 'coming-up',
    accounts: 'recent-transactions',
    'recent-transactions': 'accounts',
  };
  const dashboardItemClass = (widget: WidgetId) => {
    const neighbor = PAIR_NEIGHBOR[widget];
    if (!neighbor) return 'flex flex-col min-w-0 md:col-span-2';
    const index = visibleDisplayedOrder.indexOf(widget);
    return visibleDisplayedOrder[index - 1] === neighbor || visibleDisplayedOrder[index + 1] === neighbor
      ? 'flex flex-col min-w-0 min-h-0'
      : 'flex flex-col min-w-0 md:col-span-2';
  };

  return (
    <div className="space-y-6">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
        <div className="flex items-center max-md:flex-1">
          <h1 className="text-2xl font-bold fg-primary">Home</h1>
          {!editing && (
            // On mobile the page h1 is hidden (the app bar owns the title),
            // so the pencil moves to the right edge like a native Edit action.
            <button type="button" onClick={startEditing} disabled={layout.isLoading} className="edit-icon-button inline-flex h-11 w-11 items-center justify-center rounded-lg disabled:cursor-wait disabled:opacity-50 max-md:ml-auto" aria-label="Edit home layout" title="Edit home layout">
              <Pencil className="h-4 w-4" />
            </button>
          )}
        </div>
        {editing && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={cancelEditing} disabled={saveLayout.isPending} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-default px-3 text-sm font-medium fg-secondary hover:bg-surface disabled:opacity-50">
              <X className="h-4 w-4" /> Cancel
            </button>
            <button type="button" onClick={() => saveLayout.mutate({ order: draftOrder, hidden: draftHidden })} disabled={saveLayout.isPending} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-amber-500 px-3 text-sm font-semibold text-slate-900 hover:bg-amber-600 disabled:opacity-50">
              <Check className="h-4 w-4" /> {saveLayout.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
      {saveLayout.isError && <p className="text-sm text-rose-600 dark:text-rose-400">Could not save the home layout. Please try again.</p>}
      {!editing && reviews.count > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm fg-primary">
            <BellRing className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              You have {reviews.count} transaction{reviews.count === 1 ? '' : 's'} to review. They are not counted in this month&apos;s leftover yet.
            </span>
          </div>
          <button
            type="button"
            onClick={reviews.openModal}
            className="text-sm font-semibold text-amber-700 dark:text-amber-400 hover:underline shrink-0"
          >
            Review now →
          </button>
        </div>
      )}

      <SortableWidgetList
        order={displayedOrder}
        labels={WIDGET_LABELS}
        editing={editing}
        onReorder={setDraftOrder}
        renderWidget={renderWidget}
        className="grid grid-cols-1 gap-6 md:grid-cols-2"
        itemClassName={dashboardItemClass}
        hidden={displayedHidden}
        onToggleHidden={editing ? toggleHidden : undefined}
      />
    </div>
  );
}

function EmptyAction({
  message,
  action,
  onClick,
}: {
  message: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-4 text-center">
      <p className="text-sm fg-muted">{message}</p>
      <button
        type="button"
        onClick={onClick}
        className="text-sm font-semibold text-amber-700 dark:text-amber-400 hover:underline"
      >
        {action}
      </button>
    </div>
  );
}

function ExpandableSubcategory({
  label,
  total,
  accounts,
  expanded,
  onToggle,
}: {
  label: string;
  total: number;
  accounts: Account[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-between text-sm w-full py-1.5 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-1.5 font-medium fg-primary">
          <ChevronRight
            className={clsx(
              'h-3.5 w-3.5 shrink-0 fg-secondary transition-transform duration-150',
              expanded && 'rotate-90',
            )}
          />
          {label}
        </span>
        <span className="tabular-nums font-medium fg-primary">{formatMoney(total)}</span>
      </button>
      {expanded && accounts.length > 0 && (
        <ul className="pl-5 space-y-1 pb-1">
          {accounts.map((a) => {
            const balance = formatAccountBalance(a, formatMoney);
            return (
              <li key={a.id} className="flex items-center justify-between text-xs">
                <span className="fg-secondary truncate mr-2">{a.name}</span>
                <span className={clsx('tabular-nums shrink-0', balance.colorClass)}>{balance.text}</span>
              </li>
            );
          })}
        </ul>
      )}
      {expanded && accounts.length === 0 && (
        <p className="pl-5 text-xs fg-muted pb-1">No accounts</p>
      )}
    </li>
  );
}
