import { ArrowUpRight } from 'lucide-react';
import { Progress } from './ui/progress';
import { formatMoney } from '../lib/format';
import clsx from 'clsx';

export interface BudgetSummaryBoxProps {
  plannedIncome: number;
  earnedIncome: number;
  plannedExpense: number;
  spentExpense: number;
  plannedDebt: number;
  actualDebt: number;
  loading?: boolean;
  onJumpToPaydown?: () => void;
}

export function BudgetSummaryBox({
  plannedIncome,
  earnedIncome,
  plannedExpense,
  spentExpense,
  plannedDebt,
  actualDebt,
  loading,
  onJumpToPaydown,
}: BudgetSummaryBoxProps) {
  const leftToBudget = Math.round(plannedIncome - plannedExpense - plannedDebt);
  const overAssigned = leftToBudget < 0;
  const balanced = leftToBudget === 0;
  const incomeRemaining = plannedIncome - earnedIncome;
  const expenseRemaining = plannedExpense - spentExpense;
  const debtRemaining = plannedDebt - actualDebt;
  const debtPct = plannedDebt > 0 ? Math.min(100, (actualDebt / plannedDebt) * 100) : 0;
  const debtBarTone = actualDebt > plannedDebt ? 'rose' : actualDebt >= plannedDebt * 0.7 ? 'amber' : 'emerald';
  const debtRemainingClass = debtRemaining < 0
    ? 'text-rose-600 dark:text-rose-400'
    : debtRemaining > 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'fg-muted';
  const debtRemainingPrefix = debtRemaining < 0 ? '−' : '';

  const headerBg = balanced
    ? 'bg-sky-50 dark:bg-sky-900/20'
    : overAssigned
      ? 'bg-rose-50 dark:bg-rose-900/20'
      : 'bg-emerald-50 dark:bg-emerald-900/20';
  const headerText = balanced
    ? 'text-sky-700 dark:text-sky-300'
    : overAssigned
      ? 'text-rose-700 dark:text-rose-300'
      : 'text-emerald-700 dark:text-emerald-300';

  return (
    <div className="card overflow-hidden">
      <div className={clsx('px-5 py-6 text-center', headerBg)}>
        <div className={clsx('text-3xl font-bold tabular-nums', headerText)}>
          {overAssigned ? '−' : ''}{formatMoney(Math.abs(leftToBudget), true)}
        </div>
        <div className="mt-1 text-xs fg-muted">Left to budget</div>
      </div>

      <div className="p-5 space-y-5">
        <SummaryRow
          label="Income"
          planned={plannedIncome}
          actual={earnedIncome}
          remaining={incomeRemaining}
          actualLabel="earned"
          showRemaining={plannedIncome > 0}
          barTone="emerald"
        />
        <SummaryRow
          label="Expenses"
          planned={plannedExpense}
          actual={spentExpense}
          remaining={expenseRemaining}
          actualLabel="spent"
          showRemaining
          barTone="rose"
        />
        <button
          type="button"
          onClick={onJumpToPaydown}
          className={clsx(
            'group w-[calc(100%+1rem)] text-left rounded-lg p-2 -m-2 transition-colors',
            onJumpToPaydown && 'hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500',
          )}
          disabled={!onJumpToPaydown}
        >
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-sm font-medium fg-primary flex items-center gap-1">
              Pay down
              {onJumpToPaydown && (
                <ArrowUpRight className="h-3 w-3 fg-muted opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </span>
            <span className="text-xs tabular-nums fg-muted">{formatMoney(plannedDebt, true)} planned</span>
          </div>
          <Progress value={debtPct} tone={debtBarTone} />
          <div className="mt-1.5 flex items-baseline justify-between text-xs">
            <span className="fg-secondary">{formatMoney(actualDebt, true)} assigned</span>
            {plannedDebt > 0 && (
              <span className={clsx('tabular-nums', debtRemainingClass)}>
                {debtRemainingPrefix}{formatMoney(Math.abs(debtRemaining), true)} remaining
              </span>
            )}
          </div>
        </button>
      </div>

      {loading && (
        <div className="px-5 pb-3 text-[10px] uppercase tracking-wider fg-muted text-center">
          Loading…
        </div>
      )}
    </div>
  );
}

function SummaryRow({
  label,
  planned,
  actual,
  remaining,
  actualLabel,
  showRemaining,
  barTone,
}: {
  label: string;
  planned: number;
  actual: number;
  remaining: number;
  actualLabel: string;
  showRemaining: boolean;
  barTone: 'emerald' | 'rose';
}) {
  const pct = planned > 0 ? Math.min(100, (actual / planned) * 100) : 0;
  const remainingClass = remaining < 0
    ? 'text-rose-600 dark:text-rose-400'
    : remaining > 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'fg-muted';
  const remainingPrefix = remaining < 0 ? '−' : '';

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-sm font-medium fg-primary">{label}</span>
        <span className="text-xs tabular-nums fg-muted">{formatMoney(planned, true)} planned</span>
      </div>
      <Progress value={pct} tone={barTone} />
      <div className="mt-1.5 flex items-baseline justify-between text-xs">
        <span className="fg-secondary">{formatMoney(actual, true)} {actualLabel}</span>
        {showRemaining && (
          <span className={clsx('tabular-nums', remainingClass)}>
            {remainingPrefix}{formatMoney(Math.abs(remaining), true)} remaining
          </span>
        )}
      </div>
    </div>
  );
}
