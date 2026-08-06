/**
 * Savings calculator — inline panel beside the Pay down chart and
 * accounts list. The calculator is always visible (Monarch-style)
 * instead of a modal so the inputs keep focus while typing and the
 * saved scenario is plainly visible next to the projection.
 *
 * State (method, monthlyExtra, oneTimeExtra, showSim) is owned by the
 * parent page so the page header's "Save to Budget" button can read
 * the same scenario the user just configured. The parent also persists
 * that scenario to localStorage so leaving and returning to Pay down
 * restores the inputs, payoff dates, and chart.
 */
import { Calculator } from 'lucide-react';
import clsx from 'clsx';

type Method = 'planned' | 'avalanche' | 'snowball';

interface MethodOption {
  value: Method;
  label: string;
  description: string;
}

const METHOD_OPTIONS: MethodOption[] = [
  {
    value: 'planned',
    label: 'Planned payments',
    description: "Pay the scheduled minimum or planned amount on each debt without redirecting freed-up payments to other debts as they're paid off.",
  },
  {
    value: 'avalanche',
    label: 'Debt avalanche',
    description: 'Target the highest-interest debt first and roll each completed payment into the next highest-interest balance to minimize total interest paid.',
  },
  {
    value: 'snowball',
    label: 'Debt snowball',
    description: 'Pay off the smallest balances first to build momentum, rolling each eliminated payment into the next smallest debt.',
  },
];

interface SavingsCalculatorPanelProps {
  method: Method;
  setMethod: (m: Method) => void;
  monthlyExtra: string;
  setMonthlyExtra: (v: string) => void;
  oneTimeExtra: string;
  setOneTimeExtra: (v: string) => void;
  setShowSim: (v: boolean) => void;
  isSimulated: boolean;
  projection: {
    baselineTotalInterest: number;
    totalInterest: number;
    baselineDebtFreeMonth: string | null;
    debtFreeMonth: string | null;
  } | null;
  monthlyExtraNum: number;
  oneTimeExtraNum: number;
  formatMoney: (n: number) => string;
  ymToMonths: (ym: string) => number;
}

export function SavingsCalculatorPanel({
  method,
  setMethod,
  monthlyExtra,
  setMonthlyExtra,
  oneTimeExtra,
  setOneTimeExtra,
  setShowSim,
  isSimulated,
  projection,
  monthlyExtraNum,
  oneTimeExtraNum,
  formatMoney,
  ymToMonths,
}: SavingsCalculatorPanelProps) {
  return (
    <aside className="card">
      <div className="flex items-center gap-2 mb-1">
        <Calculator className="h-4 w-4 fg-tertiary" />
        <h2 className="text-base font-semibold fg-primary">Savings calculator</h2>
      </div>
      <p className="text-xs fg-muted mb-4">
        Try different payoff methods. Extra payments are only applied
        for Avalanche and Snowball.
      </p>

      <div className="space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wider fg-muted mb-2">Method</div>
          <div role="radiogroup" aria-label="Payoff method" className="space-y-2">
            {METHOD_OPTIONS.map((opt) => {
              const selected = method === opt.value;
              return (
                <label
                  key={opt.value}
                  className={clsx(
                    'block rounded-lg border p-3 cursor-pointer transition-colors',
                    selected
                      ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/30'
                      : 'border-default hover:border-strong',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="payoff-method"
                      value={opt.value}
                      checked={selected}
                      onChange={() => {
                        setMethod(opt.value);
                        setShowSim(true);
                      }}
                      className="mt-0.5 accent-amber-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className={clsx('text-sm font-medium', selected ? 'fg-primary' : 'fg-secondary')}>
                        {opt.label}
                      </div>
                      <div className="text-xs fg-muted mt-0.5">{opt.description}</div>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs fg-muted">Additional monthly payment</span>
            <div className="relative mt-1">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 fg-muted text-sm">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={monthlyExtra}
                onChange={(e) => {
                  setMonthlyExtra(e.target.value);
                  setShowSim(true);
                }}
                placeholder="0"
                className="w-full rounded border border-default bg-surface fg-primary placeholder-slate-400 pl-6 pr-2 py-2 text-sm focus:border-amber-500 focus:outline-none tabular-nums"
              />
            </div>
          </label>
          <label className="block">
            <span className="text-xs fg-muted">Additional one-time payment</span>
            <div className="relative mt-1">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 fg-muted text-sm">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={oneTimeExtra}
                onChange={(e) => {
                  setOneTimeExtra(e.target.value);
                  setShowSim(true);
                }}
                placeholder="0"
                className="w-full rounded border border-default bg-surface fg-primary placeholder-slate-400 pl-6 pr-2 py-2 text-sm focus:border-amber-500 focus:outline-none tabular-nums"
              />
            </div>
          </label>
        </div>

        {isSimulated && projection && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/30 p-3 text-xs text-amber-800 dark:text-amber-200">
            <div className="font-semibold mb-1 capitalize">
              {method === 'planned' ? 'Planned payments' : method === 'avalanche' ? 'Debt avalanche' : 'Debt snowball'}
              {monthlyExtraNum > 0 ? ` with ${formatMoney(monthlyExtraNum)}/mo extra` : ''}
              {oneTimeExtraNum > 0 ? ` + ${formatMoney(oneTimeExtraNum)} one-time` : ''}
            </div>
            {projection.baselineTotalInterest > 0 && (
              <div>
                Saves {formatMoney(Math.max(0, projection.baselineTotalInterest - projection.totalInterest))} in interest vs. baseline
              </div>
            )}
            {projection.baselineDebtFreeMonth && projection.debtFreeMonth && projection.baselineDebtFreeMonth !== projection.debtFreeMonth && (
              <div>
                Debt-free{' '}
                {(() => {
                  const baseMonths = ymToMonths(projection.baselineDebtFreeMonth);
                  const newMonths = ymToMonths(projection.debtFreeMonth);
                  const diff = baseMonths - newMonths;
                  return diff > 0 ? `${diff} months earlier` : `${-diff} months later`;
                })()}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
