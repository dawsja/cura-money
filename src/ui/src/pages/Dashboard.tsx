import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import { formatAccountBalance, netWorthContribution, isLiability } from '../lib/accounting';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, TrendingUp, TrendingDown, Wallet, ArrowLeftRight, ChevronRight, Check, Pencil, X } from 'lucide-react';
import { SummaryCard } from '../components/SummaryCard';
import { SortableWidgetList } from '../components/SortableWidgetList';
import clsx from 'clsx';
import { AsyncQueryState } from '../components/ui/AsyncQueryState';

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

const DEFAULT_WIDGET_ORDER = ['summary', 'assets-liabilities', 'accounts', 'recent-transactions'] as const;
type WidgetId = (typeof DEFAULT_WIDGET_ORDER)[number];
interface DashboardLayout { order: WidgetId[]; hidden: WidgetId[]; }

const WIDGET_LABELS: Record<WidgetId, string> = {
  summary: 'Summary',
  'assets-liabilities': 'Assets & Liabilities',
  accounts: 'Accounts',
  'recent-transactions': 'Recent transactions',
};

/** Visual styling for a transaction type — kept in one place so the
 *  Dashboard "Recent" list, the Transactions table, and anywhere else
 *  we render a tx all agree. */
function txTypeStyle(type: DashboardTransaction['type']): { sign: string; amount: string } {
  if (type === 'income') return { sign: '+', amount: 'text-emerald-600 dark:text-emerald-400' };
  if (type === 'expense') return { sign: '−', amount: 'text-rose-600 dark:text-rose-400' };
  return { sign: '⇄', amount: 'text-slate-600 dark:text-slate-400' };
}

export function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  const saveLayout = useMutation({
    mutationFn: (next: DashboardLayout) => api.put<DashboardLayout>('/api/dashboard/layout', next),
    onSuccess: (saved) => {
      queryClient.setQueryData(['dashboard', 'layout'], saved);
      setEditing(false);
    },
  });

  const savedOrder = layout.data?.order ?? [...DEFAULT_WIDGET_ORDER];
  const savedHidden = layout.data?.hidden ?? [];
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

  if (accounts.isLoading || activity.isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold fg-primary">Dashboard</h1>
        <AsyncQueryState status="loading" title="Loading your dashboard…" message="Fetching accounts and recent transactions." />
      </div>
    );
  }

  if (accounts.isError || activity.isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold fg-primary">Dashboard</h1>
        <AsyncQueryState
          status="error"
          title="Could not load your dashboard"
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
        <div className="grid gap-3 md:grid-cols-3">
          <SummaryCard label="Net worth" sub="Sum of all accounts" tone={totalBalance >= 0 ? 'slate' : 'rose'} icon={<Wallet className="h-4 w-4" />} value={formatMoney(totalBalance)} />
          <SummaryCard label="Income (30d)" sub="Deposits (transfers excluded)" tone="emerald" icon={<TrendingUp className="h-4 w-4" />} value={formatMoney(income)} />
          <SummaryCard label="Spending (30d)" sub="Out-of-pocket expenses" tone="rose" icon={<TrendingDown className="h-4 w-4" />} value={formatMoney(expense)} />
        </div>
      );
    }

    if (widget === 'assets-liabilities') {
      return (
        <section className="card">
          <h2 className="text-lg font-semibold fg-primary mb-4">Assets & Liabilities</h2>
          <div className="grid gap-6 md:grid-cols-2">
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
        <section className="card">
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
                <li key={a.id} className="flex justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium fg-primary">{a.name}</div>
                    <div className="text-xs fg-muted">{a.institution ?? a.type}</div>
                  </div>
                  <div className={clsx('font-semibold tabular-nums', balance.colorClass)}>{balance.text}</div>
                </li>
              );
            })}
            {accounts.data?.length === 0 && <li className="py-4 text-sm fg-muted text-center">No accounts yet. Add one to get started.</li>}
          </ul>
        </section>
      );
    }

    return (
      <section className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold fg-primary">Recent transactions</h2>
          <div className="flex items-center gap-3 text-xs fg-muted">
            {transferCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <ArrowLeftRight className="h-3 w-3" /> {transferCount} transfer{transferCount === 1 ? '' : 's'} (excluded from totals)
              </span>
            )}
            <button onClick={() => navigate('/transactions')} className="text-sm text-amber-700 dark:text-amber-400 hover:underline flex items-center gap-1">
              View all <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
        <ul className="divide-y divide-slate-100 dark:divide-slate-700">
          {activity.data?.recent.map((t) => {
            const style = txTypeStyle(t.type);
            return (
              <li key={t.id} className="flex justify-between py-2 text-sm">
                <div>
                  <div className="font-medium flex items-center gap-1.5 fg-primary">
                    {t.type === 'transfer' && <ArrowLeftRight className="h-3 w-3 fg-muted" />}
                    {t.merchant}
                  </div>
                  <div className="text-xs fg-muted">{t.date} · {t.category}{t.subCategory ? ` › ${t.subCategory}` : ''} · {t.account}</div>
                </div>
                <div className={clsx('font-semibold tabular-nums', style.amount)}>{style.sign}{formatMoney(t.amount)}</div>
              </li>
            );
          })}
          {activity.data?.recent.length === 0 && <li className="py-4 text-sm fg-muted text-center">No transactions yet.</li>}
        </ul>
      </section>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
        <div className="flex items-center">
          <h1 className="text-2xl font-bold fg-primary">Dashboard</h1>
          {!editing && (
            <button type="button" onClick={startEditing} disabled={layout.isLoading} className="edit-icon-button inline-flex h-11 w-11 items-center justify-center rounded-lg disabled:cursor-wait disabled:opacity-50" aria-label="Edit dashboard layout" title="Edit dashboard layout">
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
      {saveLayout.isError && <p className="text-sm text-rose-600 dark:text-rose-400">Could not save the dashboard layout. Please try again.</p>}

      <SortableWidgetList
        order={editing ? draftOrder : savedOrder}
        labels={WIDGET_LABELS}
        editing={editing}
        onReorder={setDraftOrder}
        renderWidget={renderWidget}
        hidden={new Set(editing ? draftHidden : savedHidden)}
        onToggleHidden={editing ? toggleHidden : undefined}
      />
    </div>
  );
}

/**
 * ExpandableSubcategory — a subcategory row (e.g. "Cash", "Loans") that
 * can be expanded to reveal the individual accounts contributing to the
 * total. The arrow rotates 90° when expanded for a clear visual cue.
 */
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
