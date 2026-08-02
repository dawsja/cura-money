import { ChevronDown, ChevronRight, CreditCard, Banknote, Save } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatMoney, timeAgo } from '../lib/format';
import { Progress } from './ui/progress';
import clsx from 'clsx';

export interface PaydownBudgetRow {
  accountId: string;
  accountName: string;
  type: 'credit' | 'loan';
  apr: number;
  planned: number;
  actual: number;
  remaining: number;
}

export interface PaydownBudgetMeta {
  syncedAt: string | null;
  rowCount: number;
}

export function PaydownBudgetSection({
  title = 'Pay down',
  rows,
  meta,
  collapsed,
  onToggleCollapsed,
  id,
}: {
  title?: string;
  rows: PaydownBudgetRow[];
  meta: PaydownBudgetMeta;
  collapsed: Set<string>;
  onToggleCollapsed: (id: string) => void;
  id?: string;
}) {
  const navigate = useNavigate();
  const isCollapsed = collapsed.has(title);
  const totalPlanned = rows.reduce((s, r) => s + r.planned, 0);
  const totalActual = rows.reduce((s, r) => s + r.actual, 0);
  const totalRemaining = totalPlanned - totalActual;

  return (
    <section id={id} className="card">
      <button
        type="button"
        onClick={() => onToggleCollapsed(title)}
        className="w-full flex items-center justify-between px-4 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-t-lg"
        aria-expanded={!isCollapsed}
      >
        <h2 className="text-base font-semibold fg-primary flex items-center gap-2">
          {isCollapsed ? <ChevronRight className="h-4 w-4 fg-muted" /> : <ChevronDown className="h-4 w-4 fg-muted" />}
          {title}
        </h2>
        <div className="flex items-center gap-3 sm:gap-6">
          {meta.syncedAt && (
            <span className="hidden sm:inline text-xs fg-muted tabular-nums">
              Last synced: <span className="fg-secondary">{timeAgo(meta.syncedAt)}</span>
            </span>
          )}
          <div className="flex items-baseline gap-3 sm:gap-6 text-sm tabular-nums">
            <div className="hidden sm:block">
              <span className="fg-muted text-xs uppercase tracking-wider mr-2">Planned</span>
              <span className="font-semibold fg-primary">{formatMoney(totalPlanned)}</span>
            </div>
            <div className="hidden sm:block">
              <span className="fg-muted text-xs uppercase tracking-wider mr-2">Actual</span>
              <span className="font-semibold fg-primary">{formatMoney(totalActual)}</span>
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
        </div>
      </button>

      {!isCollapsed && (
        <div className="px-2 sm:px-4 pb-3 pt-1">
          {rows.length === 0 ? (
            <EmptyState onSyncClick={() => navigate('/paydown')} synced={!!meta.syncedAt} />
          ) : (
            <>
              {/* Mobile card-list layout */}
              <div className="sm:hidden divide-y divide-slate-100 dark:divide-slate-700">
                {rows.map((r) => {
                  const showProgress = r.planned > 0;
                  const pct = showProgress ? Math.min(100, (r.actual / r.planned) * 100) : 0;
                  return (
                    <div key={r.accountId} className="py-2.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm fg-primary font-medium flex items-center gap-1.5 truncate">
                          {r.type === 'credit' ? (
                            <CreditCard className="h-3.5 w-3.5 fg-muted shrink-0" />
                          ) : (
                            <Banknote className="h-3.5 w-3.5 fg-muted shrink-0" />
                          )}
                          {r.accountName}
                        </span>
                        <span className={clsx(
                          'text-sm font-semibold tabular-nums shrink-0',
                          r.remaining < 0
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-emerald-600 dark:text-emerald-400',
                        )}>
                          {r.remaining < 0 ? '−' : ''}{formatMoney(Math.abs(r.remaining))}
                        </span>
                      </div>
                      {showProgress && (
                        <Progress value={pct} tone="slate" className="w-full" />
                      )}
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="fg-muted tabular-nums">{(r.apr * 100).toFixed(2)}% APR</span>
                        <span className="fg-secondary tabular-nums">
                          {formatMoney(r.planned)} planned · {formatMoney(r.actual)} actual
                        </span>
                      </div>
                    </div>
                  );
                })}
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
                      {totalRemaining < 0 ? '−' : ''}{formatMoney(Math.abs(totalRemaining))}
                    </span>
                  </div>
                </div>
              </div>

              {/* Desktop table */}
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
                  <th className="py-1">Account</th>
                  <th className="py-1"></th>
                  <th className="py-1 text-right pl-6">Planned</th>
                  <th className="py-1 text-right pl-10">Actual</th>
                  <th className="py-1 text-right pl-6">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {rows.map((r) => {
                  const showProgress = r.planned > 0;
                  const pct = showProgress ? Math.min(100, (r.actual / r.planned) * 100) : 0;
                  return (
                    <tr key={r.accountId}>
                      <td className="py-2 fg-primary">
                        <div className="flex items-center gap-2">
                          {r.type === 'credit' ? (
                            <CreditCard className="h-3.5 w-3.5 fg-muted shrink-0" />
                          ) : (
                            <Banknote className="h-3.5 w-3.5 fg-muted shrink-0" />
                          )}
                          <span>{r.accountName}</span>
                        </div>
                        <div className="text-xs fg-muted mt-0.5 ml-5 tabular-nums">
                          {(r.apr * 100).toFixed(2)}% APR
                        </div>
                      </td>
                      <td className="py-2 pr-2">
                        {showProgress && (
                          <Progress value={pct} tone="slate" className="w-full" />
                        )}
                      </td>
                      <td className="py-2 text-right pl-6">
                        <div className="tabular-nums fg-secondary">{formatMoney(r.planned)}</div>
                      </td>
                      <td className="py-2 text-right pl-10">
                        <div className="tabular-nums fg-secondary">{formatMoney(r.actual)}</div>
                      </td>
                      <td className={clsx(
                        'py-2 text-right font-semibold tabular-nums pl-6',
                        r.remaining < 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400',
                      )}>
                        {r.remaining < 0 ? '−' : ''}{formatMoney(Math.abs(r.remaining))}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td className="py-2 font-semibold fg-primary">Total {title}</td>
                  <td className="py-2"></td>
                  <td className="py-2 text-right font-semibold tabular-nums fg-secondary pl-6">{formatMoney(totalPlanned)}</td>
                  <td className="py-2 text-right font-semibold tabular-nums fg-secondary pl-10">{formatMoney(totalActual)}</td>
                  <td className={clsx(
                    'py-2 text-right font-semibold tabular-nums pl-6',
                    totalRemaining < 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-emerald-600 dark:text-emerald-400',
                  )}>
                    {totalRemaining < 0 ? '−' : ''}{formatMoney(Math.abs(totalRemaining))}
                  </td>
                </tr>
              </tbody>
            </table>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function EmptyState({ onSyncClick, synced }: { onSyncClick: () => void; synced: boolean }) {
  return (
    <div className="py-6 text-center text-sm fg-muted space-y-3">
      <div>
        <div className="font-semibold fg-primary mb-1">No debt accounts included yet</div>
        <p>
          Add a credit card or loan on the Accounts page, then enable Include on the Pay down page.
        </p>
        {synced && (
          <p className="text-xs fg-muted mt-1">A snapshot exists for this month but no accounts are currently included.</p>
        )}
      </div>
      <button
        type="button"
        onClick={onSyncClick}
        className="inline-flex items-center gap-1.5 rounded-md border border-default bg-surface fg-primary px-3 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
      >
        <Save className="h-3.5 w-3.5" /> Open Pay down page
      </button>
    </div>
  );
}
