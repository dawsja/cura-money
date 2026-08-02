import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import { netWorthContribution, isLiability } from '../lib/accounting';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, TrendingUp, TrendingDown, Wallet, ArrowLeftRight, ChevronRight } from 'lucide-react';
import { SummaryCard } from '../components/SummaryCard';
import clsx from 'clsx';

interface Account { id: string; name: string; type: string; balance: number; institution?: string; }
interface Transaction {
  id: string;
  date: string;
  merchant: string;
  category: string;
  subCategory?: string;
  account: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer';
}

/** Visual styling for a transaction type — kept in one place so the
 *  Dashboard "Recent" list, the Transactions table, and anywhere else
 *  we render a tx all agree. */
function txTypeStyle(type: Transaction['type']): { sign: string; amount: string } {
  if (type === 'income') return { sign: '+', amount: 'text-emerald-600 dark:text-emerald-400' };
  if (type === 'expense') return { sign: '−', amount: 'text-rose-600 dark:text-rose-400' };
  return { sign: '⇄', amount: 'text-slate-600 dark:text-slate-400' };
}

export function Dashboard() {
  const navigate = useNavigate();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const toggleSection = (key: string) =>
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api.get<Account[]>('/api/accounts') });
  const txns = useQuery({
    queryKey: ['transactions'],
    queryFn: () => api.get<Transaction[]>('/api/transactions'),
  });

  // Sum *signed* contributions so credit cards + loans subtract from
  // net worth. `a.balance` is always stored positive — see
  // `netWorthContribution` in `lib/accounting.ts` for the convention.
  const totalBalance = accounts.data?.reduce((s, a) => s + netWorthContribution(a), 0) ?? 0;
  const last30 = txns.data?.filter((t) => Date.now() - new Date(t.date).getTime() < 30 * 86400_000) ?? [];
  // Transfers are excluded from cash-flow totals — they reallocate money
  // between two of the user's own accounts and don't change net worth.
  const income = last30.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = last30.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const transferCount = last30.filter((t) => t.type === 'transfer').length;

  // Assets vs Liabilities breakdown
  const assetAccounts = accounts.data?.filter((a) => !isLiability(a.type)) ?? [];
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold fg-primary">Dashboard</h1>

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard
          label="Net worth"
          sub="Sum of all accounts"
          tone={totalBalance >= 0 ? 'slate' : 'rose'}
          icon={<Wallet className="h-4 w-4" />}
          value={formatMoney(totalBalance)}
        />
        <SummaryCard
          label="Income (30d)"
          sub="Deposits (transfers excluded)"
          tone="emerald"
          icon={<TrendingUp className="h-4 w-4" />}
          value={formatMoney(income)}
        />
        <SummaryCard
          label="Spending (30d)"
          sub="Out-of-pocket expenses"
          tone="rose"
          icon={<TrendingDown className="h-4 w-4" />}
          value={formatMoney(expense)}
        />
      </div>


      <section className="card">
        <h2 className="text-lg font-semibold fg-primary mb-4">Assets & Liabilities</h2>
        <div className="grid gap-6 md:grid-cols-2">
          {/* Assets */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold fg-primary">Assets</span>
              <span className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatMoney(totalAssets)}</span>
            </div>
            <ul className="space-y-1 pl-3">
              <ExpandableSubcategory
                label="Cash"
                total={cashTotal}
                accounts={cashAccounts}
                expanded={expandedSections.has('cash')}
                onToggle={() => toggleSection('cash')}
              />
              <ExpandableSubcategory
                label="Investments"
                total={investmentTotal}
                accounts={investmentAccounts}
                expanded={expandedSections.has('investments')}
                onToggle={() => toggleSection('investments')}
              />
            </ul>
          </div>
          {/* Liabilities */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold fg-primary">Liabilities</span>
              <span className="text-sm font-semibold tabular-nums text-rose-600 dark:text-rose-400">{formatMoney(totalLiabilities)}</span>
            </div>
            <ul className="space-y-1 pl-3">
              <ExpandableSubcategory
                label="Credit Cards"
                total={creditTotal}
                accounts={creditAccounts}
                expanded={expandedSections.has('credit')}
                onToggle={() => toggleSection('credit')}
              />
              <ExpandableSubcategory
                label="Loans"
                total={loanTotal}
                accounts={loanAccounts}
                expanded={expandedSections.has('loans')}
                onToggle={() => toggleSection('loans')}
              />
            </ul>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold fg-primary">Accounts</h2>
          <button onClick={() => navigate('/accounts')} className="text-sm text-amber-700 dark:text-amber-400 hover:underline flex items-center gap-1">
            Manage <ArrowRight className="h-3 w-3" />
          </button>
        </div>
        <ul className="divide-y divide-slate-100 dark:divide-slate-700">
          {accounts.data?.slice(0, 4).map((a) => (
            <li key={a.id} className="flex justify-between py-2 text-sm">
              <div>
                <div className="font-medium fg-primary">{a.name}</div>
                <div className="text-xs fg-muted">{a.institution ?? a.type}</div>
              </div>
              <div className="font-semibold tabular-nums fg-primary">{formatMoney(a.balance)}</div>
            </li>
          ))}
          {accounts.data?.length === 0 && (
            <li className="py-4 text-sm fg-muted text-center">No accounts yet. Add one to get started.</li>
          )}
        </ul>
      </section>

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
          {txns.data?.slice(0, 4).map((t) => {
            const style = txTypeStyle(t.type);
            return (
              <li key={t.id} className="flex justify-between py-2 text-sm">
                <div>
                  <div className="font-medium flex items-center gap-1.5 fg-primary">
                    {t.type === 'transfer' && <ArrowLeftRight className="h-3 w-3 fg-muted" />}
                    {t.merchant}
                  </div>
                  <div className="text-xs fg-muted">
                    {t.date} · {t.category}{t.subCategory ? ` › ${t.subCategory}` : ''} · {t.account}
                  </div>
                </div>
                <div className={clsx('font-semibold tabular-nums', style.amount)}>
                  {style.sign}{formatMoney(t.amount)}
                </div>
              </li>
            );
          })}
          {txns.data?.length === 0 && (
            <li className="py-4 text-sm fg-muted text-center">No transactions yet.</li>
          )}
        </ul>
      </section>
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
        className="flex items-center justify-between text-sm w-full py-1 group"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-1 fg-muted">
          <ChevronRight
            className={clsx(
              'h-3 w-3 transition-transform duration-150',
              expanded && 'rotate-90',
            )}
          />
          {label}
        </span>
        <span className="tabular-nums fg-primary">{formatMoney(total)}</span>
      </button>
      {expanded && accounts.length > 0 && (
        <ul className="pl-5 space-y-0.5 pb-1">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between text-xs">
              <span className="fg-tertiary truncate mr-2">{a.name}</span>
              <span className="tabular-nums fg-secondary shrink-0">{formatMoney(a.balance)}</span>
            </li>
          ))}
        </ul>
      )}
      {expanded && accounts.length === 0 && (
        <p className="pl-5 text-xs fg-tertiary pb-1">No accounts</p>
      )}
    </li>
  );
}
