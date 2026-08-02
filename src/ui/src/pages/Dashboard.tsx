import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import { netWorthContribution } from '../lib/accounting';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, TrendingUp, TrendingDown, Wallet, PiggyBank, ArrowLeftRight } from 'lucide-react';
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
  const net30 = income - expense;
  const transferCount = last30.filter((t) => t.type === 'transfer').length;

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

      <div className="grid gap-3 md:grid-cols-2">
        <SummaryCard
          label="Net (30d)"
          sub={net30 >= 0 ? 'Cash flow is positive' : 'Cash flow is negative'}
          tone={net30 >= 0 ? 'emerald' : 'rose'}
          value={`${net30 >= 0 ? '+' : '−'}${formatMoney(Math.abs(net30))}`}
        />
        <SummaryCard
          label="Accounts"
          sub={`${accounts.data?.length ?? 0} tracked`}
          value={String(accounts.data?.length ?? 0)}
          tone="slate"
          icon={<PiggyBank className="h-4 w-4" />}
        />
      </div>

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
          {txns.data?.slice(0, 8).map((t) => {
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
