import { ChevronDown, ChevronRight, CreditCard, Banknote, Save } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatMoney, timeAgo } from '../lib/format';
import { Progress } from './ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Alert, AlertAction, AlertDescription } from './ui/alert';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty';
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

export type PlannedCellStatus = 'saving' | 'saved' | 'error';

const PLANNED_INPUT_CLS = 'min-h-11 w-28 text-right tabular-nums sm:h-9 sm:min-h-0 sm:w-24';

export function PaydownBudgetSection({
  title = 'Pay down',
  rows,
  meta,
  collapsed,
  onToggleCollapsed,
  id,
  livePlanned,
  onLiveChange,
  onLiveCommit,
  onLiveReset,
  statuses,
  loading,
  error,
  onRetry,
}: {
  title?: string;
  rows: PaydownBudgetRow[];
  meta: PaydownBudgetMeta;
  collapsed: Set<string>;
  onToggleCollapsed: (id: string) => void;
  id?: string;
  livePlanned?: Map<string, number>;
  onLiveChange?: (accountId: string, value: number) => void;
  onLiveCommit?: (accountId: string) => void;
  onLiveReset?: (accountId: string) => void;
  statuses?: Map<string, PlannedCellStatus | undefined>;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}) {
  const navigate = useNavigate();
  const isCollapsed = collapsed.has(title);
  const displayRows = rows.map((r) => {
    const planned = livePlanned?.get(r.accountId) ?? r.planned;
    return { ...r, planned, remaining: planned - r.actual };
  });
  const totalPlanned = displayRows.reduce((s, r) => s + r.planned, 0);
  const totalActual = displayRows.reduce((s, r) => s + r.actual, 0);
  const totalRemaining = totalPlanned - totalActual;
  const editable = !!onLiveChange && !!onLiveCommit;

  return (
    <Card id={id} className="gap-0 py-0">
      <CardHeader className="p-0">
        <Button
          type="button"
          variant="ghost"
          onClick={() => onToggleCollapsed(title)}
          className="h-auto w-full justify-between rounded-t-xl px-4 py-2 whitespace-normal"
          aria-expanded={!isCollapsed}
        >
          <CardTitle className="flex items-center gap-2">
            {isCollapsed ? <ChevronRight data-icon="inline-start" className="text-muted-foreground" /> : <ChevronDown data-icon="inline-start" className="text-muted-foreground" />}
            {title}
          </CardTitle>
          <div className="flex items-center gap-3 sm:gap-6">
            {meta.syncedAt && (
              <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
                Last synced: <span className="text-foreground">{timeAgo(meta.syncedAt)}</span>
              </span>
            )}
            <div className="flex items-baseline gap-3 text-sm tabular-nums sm:gap-6">
              <div className="hidden sm:block">
                <span className="mr-2 text-xs uppercase tracking-wider text-muted-foreground">Planned</span>
                <span className="font-semibold text-foreground">{formatMoney(totalPlanned)}</span>
              </div>
              <div className="hidden sm:block">
                <span className="mr-2 text-xs uppercase tracking-wider text-muted-foreground">Actual</span>
                <span className="font-semibold text-foreground">{formatMoney(totalActual)}</span>
              </div>
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
            </div>
          </div>
        </Button>
      </CardHeader>

      {!isCollapsed && (
        <CardContent className="px-2 pt-1 pb-3 sm:px-4">
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground" role="status">Loading pay down…</p>
          ) : error ? (
            <Alert variant="destructive">
              <AlertDescription>Pay down data could not be loaded.</AlertDescription>
              {onRetry && (
                <AlertAction>
                  <Button type="button" size="sm" variant="outline" onClick={onRetry}>Retry</Button>
                </AlertAction>
              )}
            </Alert>
          ) : displayRows.length === 0 ? (
            <EmptyState onSyncClick={() => navigate('/paydown')} synced={!!meta.syncedAt} />
          ) : (
            <>
              {/* Mobile card-list layout */}
              <div className="divide-y divide-border sm:hidden">
                {displayRows.map((r) => {
                  const showProgress = r.planned > 0;
                   const pct = showProgress ? Math.min(100, (r.actual / r.planned) * 100) : 0;
                   const tone = r.actual > r.planned ? 'rose' : r.actual >= r.planned * 0.7 ? 'amber' : 'emerald';
                   return (
                    <div key={r.accountId} className="flex flex-col gap-1.5 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                          {r.type === 'credit' ? (
                            <CreditCard className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <Banknote className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          {r.accountName}
                        </span>
                        <span className={clsx(
                          'shrink-0 text-sm font-semibold tabular-nums',
                          r.remaining < 0
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-emerald-600 dark:text-emerald-400',
                        )}>
                          {r.remaining < 0 ? '−' : ''}{formatMoney(Math.abs(r.remaining))}
                        </span>
                      </div>
                      {showProgress && (
                        <Progress value={pct} tone={tone} className="w-full" />
                      )}
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="tabular-nums text-muted-foreground">{(r.apr * 100).toFixed(2)}% APR</span>
                        <span className="flex items-center gap-1 tabular-nums text-muted-foreground">
                          {editable ? (
                            <>
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={r.planned}
                                disabled={statuses?.get(r.accountId) === 'saving'}
                                onFocus={(event) => {
                                  if (event.currentTarget.value === '0') event.currentTarget.select();
                                }}
                                onChange={(e) => {
                                  const v = Number(e.target.value);
                                  if (Number.isFinite(v)) onLiveChange!(r.accountId, v);
                                }}
                                onBlur={() => onLiveCommit!(r.accountId)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') onLiveCommit!(r.accountId);
                                  if (e.key === 'Escape') onLiveReset?.(r.accountId);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className={PLANNED_INPUT_CLS}
                                aria-label={`Planned payment for ${r.accountName}`}
                              />
                              <CellFeedback status={statuses?.get(r.accountId)} onRetry={() => onLiveCommit!(r.accountId)} />
                              <span>planned · {formatMoney(r.actual)} actual</span>
                            </>
                          ) : (
                            <>{formatMoney(r.planned)} planned · {formatMoney(r.actual)} actual</>
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between gap-2 py-2.5">
                  <span className="text-sm font-semibold text-foreground">Total</span>
                  <div className="flex items-center gap-3 text-xs tabular-nums">
                    <span className="text-muted-foreground">{formatMoney(totalPlanned)} planned</span>
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
              <table className="hidden w-full table-fixed text-sm sm:table">
              <colgroup>
                <col />
                <col className="w-32" />
                <col className="w-32" />
                <col className="w-32" />
              </colgroup>
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="py-1">Account</th>
                  <th className="py-1 pl-6 text-right">Planned</th>
                  <th className="py-1 pl-10 text-right">Actual</th>
                  <th className="py-1 pl-6 text-right">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {displayRows.map((r) => {
                  const showProgress = r.planned > 0;
                   const pct = showProgress ? Math.min(100, (r.actual / r.planned) * 100) : 0;
                   const tone = r.actual > r.planned ? 'rose' : r.actual >= r.planned * 0.7 ? 'amber' : 'emerald';
                   return (
                    <tr key={r.accountId}>
                      <td className="py-2 text-foreground">
                        <div className="flex items-center gap-2">
                          {r.type === 'credit' ? (
                            <CreditCard className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <Banknote className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span>{r.accountName}</span>
                        </div>
                        <div className="mt-0.5 ml-5 text-xs tabular-nums text-muted-foreground">
                          {(r.apr * 100).toFixed(2)}% APR
                        </div>
                        {showProgress && (
                          <Progress value={pct} tone={tone} className="mt-1.5 max-w-xs" />
                        )}
                      </td>
                      <td className="py-2 pl-6 text-right">
                        {editable ? (
                          <>
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={r.planned}
                              disabled={statuses?.get(r.accountId) === 'saving'}
                              onFocus={(event) => {
                                if (event.currentTarget.value === '0') event.currentTarget.select();
                              }}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                if (Number.isFinite(v)) onLiveChange!(r.accountId, v);
                              }}
                              onBlur={() => onLiveCommit!(r.accountId)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') onLiveCommit!(r.accountId);
                                if (e.key === 'Escape') onLiveReset?.(r.accountId);
                              }}
                              className={`${PLANNED_INPUT_CLS} ml-auto`}
                              aria-label={`Planned payment for ${r.accountName}`}
                            />
                            <CellFeedback status={statuses?.get(r.accountId)} onRetry={() => onLiveCommit!(r.accountId)} />
                          </>
                        ) : (
                          <div className="tabular-nums text-muted-foreground">{formatMoney(r.planned)}</div>
                        )}
                      </td>
                      <td className="py-2 pl-10 text-right">
                        <div className="tabular-nums text-muted-foreground">{formatMoney(r.actual)}</div>
                      </td>
                      <td className={clsx(
                        'py-2 pl-6 text-right font-semibold tabular-nums',
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
                  <td className="py-2 font-semibold text-foreground">Total {title}</td>
                  <td className="py-2 pl-6 text-right font-semibold tabular-nums text-muted-foreground">{formatMoney(totalPlanned)}</td>
                  <td className="py-2 pl-10 text-right font-semibold tabular-nums text-muted-foreground">{formatMoney(totalActual)}</td>
                  <td className={clsx(
                    'py-2 pl-6 text-right font-semibold tabular-nums',
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
        </CardContent>
      )}
    </Card>
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

function EmptyState({ onSyncClick, synced }: { onSyncClick: () => void; synced: boolean }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No debt accounts included yet</EmptyTitle>
        <EmptyDescription>
          Add a credit card or loan on the Accounts page, then enable Include on the Pay down page.
          {synced && (
            <> A snapshot exists for this month but no accounts are currently included.</>
          )}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" variant="outline" size="sm" onClick={onSyncClick}>
          <Save data-icon="inline-start" /> Open Pay down page
        </Button>
      </EmptyContent>
    </Empty>
  );
}
