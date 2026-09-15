import { ArrowUpRight } from 'lucide-react';
import { Progress } from './ui/progress';
import { Card, CardContent, CardHeader } from './ui/card';
import { Button } from './ui/button';
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
  const expenseRemaining = plannedExpense - spentExpense;
  const debtRemaining = plannedDebt - actualDebt;
  const debtPct = plannedDebt > 0 ? Math.min(100, (actualDebt / plannedDebt) * 100) : 0;
  const debtBarTone = actualDebt > plannedDebt ? 'rose' : actualDebt >= plannedDebt * 0.7 ? 'amber' : 'emerald';
  const debtRemainingClass = debtRemaining < 0
    ? 'text-rose-600 dark:text-rose-400'
    : debtRemaining > 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-muted-foreground';
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
    <Card className="overflow-hidden py-0 gap-0">
      <CardHeader className={clsx('px-5 py-6 text-center', headerBg)}>
        <div className={clsx('text-3xl font-bold tabular-nums', headerText)}>
          {overAssigned ? '−' : ''}{formatMoney(Math.abs(leftToBudget), true)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">Left to budget</div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5 p-5">
        <SummaryRow
          label="Income"
          planned={plannedIncome}
          actual={earnedIncome}
          actualLabel="earned"
          barTone="emerald"
        />
        <SummaryRow
          label="Expenses"
          planned={plannedExpense}
          actual={spentExpense}
          remaining={expenseRemaining}
          actualLabel="spent"
          barTone="rose"
        />
        <Button
          type="button"
          variant="ghost"
          onClick={onJumpToPaydown}
          disabled={!onJumpToPaydown}
          className={clsx(
            'group h-auto w-[calc(100%+1rem)] justify-start whitespace-normal rounded-lg p-2 -m-2',
            onJumpToPaydown && 'cursor-pointer',
          )}
        >
          <div className="w-full text-left">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="flex items-center gap-1 text-sm font-medium text-foreground">
                Pay down
                {onJumpToPaydown && (
                  <ArrowUpRight data-icon="inline-end" className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">{formatMoney(plannedDebt, true)} planned</span>
            </div>
            <Progress value={debtPct} tone={debtBarTone} />
            <div className="mt-1.5 flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">{formatMoney(actualDebt, true)} assigned</span>
              {plannedDebt > 0 && (
                <span className={clsx('tabular-nums', debtRemainingClass)}>
                  {debtRemainingPrefix}{formatMoney(Math.abs(debtRemaining), true)} remaining
                </span>
              )}
            </div>
          </div>
        </Button>
      </CardContent>

      {loading && (
        <div className="px-5 pb-3 text-center text-[10px] uppercase tracking-wider text-muted-foreground">
          Loading…
        </div>
      )}
    </Card>
  );
}

function SummaryRow({
  label,
  planned,
  actual,
  remaining,
  actualLabel,
  barTone,
}: {
  label: string;
  planned: number;
  actual: number;
  remaining?: number;
  actualLabel: string;
  barTone: 'emerald' | 'rose';
}) {
  const pct = planned > 0 ? Math.min(100, (actual / planned) * 100) : 0;
  const remainingClass = remaining != null && remaining < 0
    ? 'text-rose-600 dark:text-rose-400'
    : remaining != null && remaining > 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-muted-foreground';
  const remainingPrefix = remaining != null && remaining < 0 ? '−' : '';

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{formatMoney(planned, true)} planned</span>
      </div>
      <Progress value={pct} tone={barTone} />
      <div className="mt-1.5 flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{formatMoney(actual, true)} {actualLabel}</span>
        {remaining != null && (
          <span className={clsx('tabular-nums', remainingClass)}>
            {remainingPrefix}{formatMoney(Math.abs(remaining), true)} remaining
          </span>
        )}
      </div>
    </div>
  );
}
