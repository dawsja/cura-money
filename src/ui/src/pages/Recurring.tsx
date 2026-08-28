/**
 * Recurring — automatic detection of recurring charges.
 *
 * Scans past transactions for charges from the same merchant on the
 * same account repeated on a regular schedule. Amount follows the
 * latest charge so a price change updates the existing row. Surfaces
 * subscriptions, memberships, and recurring bills to help users stay
 * on top of recurring charges, catch fraud, or cancel unused services.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { currencySymbol, formatMoney, formatDate, todayLocalISO } from '../lib/format';
import { RefreshCw, AlertCircle, CalendarDays, CreditCard, Tag, X, Plus, Pencil, Trash2, Check, Ellipsis } from 'lucide-react';
import clsx from 'clsx';
import { Dialog } from '../components/ui/dialog';

type Frequency = 'weekly' | 'monthly' | 'yearly';

interface RecurringCharge {
  merchant: string;
  amount: number;
  frequency: Frequency;
  occurrences: number;
  lastDate: string;
  category: string;
  account: string;
  accountId?: string;
  nextDate: string;
  daysUntil: number;
  comingSoon: boolean;
  /** True for user-defined entries (editable/deletable rather than dismissible). */
  manual?: boolean;
  /** Stable id for manual entries; absent on auto-detected charges. */
  id?: string;
}

interface ManualDraft {
  merchant: string;
  amount: string;
  frequency: Frequency;
  account: string;
  category: string;
  anchorDate: string;
}

const FREQUENCY_LABEL: Record<string, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

const FREQUENCY_BADGE: Record<string, string> = {
  weekly: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  monthly: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  yearly: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
};

/** Normalize any frequency to a monthly burn rate. */
function monthlyBurn(c: RecurringCharge): number {
  if (c.frequency === 'weekly') return c.amount * 52 / 12;
  if (c.frequency === 'monthly') return c.amount;
  return c.amount / 12;
}

/** Annual cost for a single charge. */
function annualCost(c: RecurringCharge): number {
  if (c.frequency === 'weekly') return c.amount * 52;
  if (c.frequency === 'monthly') return c.amount * 12;
  return c.amount;
}

function recurringKey(merchant: string, account: string): string {
  return `${merchant.toLowerCase()}|${account.toLowerCase()}`;
}

function daysLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

export function Recurring() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<RecurringCharge[]>({
    queryKey: ['recurring'],
    queryFn: () => api.get('/api/recurring'),
  });

  // `null` = closed; `'new'` = create; otherwise the manual charge being edited.
  const [editing, setEditing] = useState<RecurringCharge | 'new' | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['recurring'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const saveManual = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: unknown }) =>
      id ? api.patch(`/api/recurring/manual/${id}`, body) : api.post('/api/recurring/manual', body),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
  });

  const deleteManual = useMutation({
    mutationFn: (id: string) => api.delete(`/api/recurring/manual/${id}`),
    onSuccess: invalidate,
  });

  const dismiss = useMutation({
    mutationFn: (charge: { merchant: string; amount: number; account: string; accountId?: string }) =>
      api.post('/api/recurring/dismiss', charge),
    onMutate: async (charge) => {
      await qc.cancelQueries({ queryKey: ['recurring'] });
      const prev = qc.getQueryData<RecurringCharge[]>(['recurring']);
      if (prev) {
        const key = recurringKey(charge.merchant, charge.accountId ?? charge.account);
        qc.setQueryData<RecurringCharge[]>(
          ['recurring'],
          prev.filter((c) => recurringKey(c.merchant, c.accountId ?? c.account) !== key),
        );
      }
      return { prev };
    },
    onError: (_err, _charge, ctx) => {
      if (ctx?.prev) qc.setQueryData(['recurring'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['recurring'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Monthly = equivalent monthly burn of every charge (wk x 52/12 + mo + qtr/3 + yr/12).
  // Yearly = sum of annualized costs — always monthlyTotal * 12 (within float).
  const monthlyTotal = data?.reduce((sum, c) => sum + monthlyBurn(c), 0) ?? 0;
  const yearlyEstimate = data?.reduce((sum, c) => sum + annualCost(c), 0) ?? 0;
  const comingUpCount = data?.filter((charge) => charge.comingSoon).length ?? 0;
  const sortedCharges = data ? [...data].sort((a, b) => {
    if (a.comingSoon !== b.comingSoon) return a.comingSoon ? -1 : 1;
    if (a.comingSoon && b.comingSoon) return a.daysUntil - b.daysUntil;
    return 0;
  }) : undefined;
  const chargeSections = sortedCharges ? [
    {
      id: 'due-soon',
      title: 'Due soon',
      description: 'Charges approaching their expected date',
      charges: sortedCharges.filter((charge) => charge.comingSoon),
    },
    {
      id: 'later',
      title: 'Later',
      description: 'The rest of your recurring schedule',
      charges: sortedCharges.filter((charge) => !charge.comingSoon),
    },
  ].filter((section) => section.charges.length > 0) : [];

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center fg-muted">
        <RefreshCw className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center fg-muted gap-2">
        <AlertCircle className="h-5 w-5 text-rose-500" />
        <span>Failed to load recurring charges.</span>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 md:p-6">
      {/* Header */}
      <div data-onboarding-target="recurring-summary" className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold fg-primary">Recurring</h1>
          <p className="text-sm fg-secondary mt-1">
            Automatically detected charges plus any you add yourself. Review these to catch unused subscriptions or unexpected charges.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="btn-primary flex shrink-0 items-center gap-2"
        >
          <Plus className="h-4 w-4" /> Add recurring
        </button>
      </div>
      {dismiss.isError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-300" role="alert">
          Could not dismiss the recurring charge: {dismiss.error.message}
        </div>
      )}
      {deleteManual.isError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-300" role="alert">
          Could not delete the recurring entry: {deleteManual.error.message}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(12rem,1fr)]">
        <div className="rounded-xl bg-surface border border-default p-4 sm:p-5">
          <p className="text-xs font-medium fg-tertiary uppercase tracking-wide">Recurring spend</p>
          <div className="mt-2 flex items-end gap-3">
            <p className="text-2xl font-bold fg-primary tabular-nums">{formatMoney(monthlyTotal)}</p>
            <p className="pb-0.5 text-sm fg-secondary">per month</p>
          </div>
          <p className="mt-1 text-xs fg-tertiary">
            {formatMoney(yearlyEstimate)} estimated per year
          </p>
        </div>
        <div className="rounded-xl bg-surface border border-default p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium fg-tertiary uppercase tracking-wide">Due soon</p>
            <CalendarDays className="h-4 w-4 text-sky-700 dark:text-sky-300" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-bold fg-primary tabular-nums">{comingUpCount}</p>
          <p className="mt-1 text-xs fg-tertiary">
            {comingUpCount === 1 ? 'charge needs attention' : 'charges need attention'}
          </p>
        </div>
      </div>

      {/* Recurring charges list */}
      {data && data.length === 0 ? (
        <div className="rounded-xl bg-surface border border-default p-8 text-center">
          <RefreshCw className="h-10 w-10 fg-tertiary mx-auto mb-3" />
          <p className="fg-secondary text-sm">No recurring charges detected yet.</p>
          <p className="fg-tertiary text-xs mt-1">
            As more transactions come in, recurring patterns will appear here automatically — or add one manually with <span className="font-semibold">Add recurring</span>.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {chargeSections.map((section) => (
            <section key={section.id} aria-labelledby={`${section.id}-heading`}>
              <div className="mb-2 flex items-end justify-between gap-3 px-1">
                <div>
                  <h2 id={`${section.id}-heading`} className="text-sm font-semibold fg-primary">{section.title}</h2>
                  <p className="text-xs fg-tertiary">{section.description}</p>
                </div>
                <span className="text-xs tabular-nums fg-muted">{section.charges.length}</span>
              </div>

              <div className="divide-y divide-[color:var(--border-default)] rounded-xl border border-default bg-surface">
                {section.charges.map((charge) => (
                  <div
                    key={recurringKey(charge.merchant, charge.accountId ?? charge.account)}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-3 p-4 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h3 className="min-w-0 truncate text-sm font-semibold fg-primary">{charge.merchant}</h3>
                        <span
                          className={clsx(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                            FREQUENCY_BADGE[charge.frequency],
                          )}
                        >
                          {FREQUENCY_LABEL[charge.frequency]}
                        </span>
                        {charge.manual && (
                          <span className="inline-flex items-center rounded-full border border-default bg-canvas-subtle px-2 py-0.5 text-xs font-medium fg-muted">
                            Manual
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs fg-tertiary">
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <CreditCard className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">{charge.account}</span>
                        </span>
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <Tag className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">{charge.category}</span>
                        </span>
                        {!charge.manual && (
                          <span className="inline-flex items-center gap-1">
                            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                            {charge.occurrences} times
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="col-start-1 row-start-2 sm:col-start-2 sm:row-start-1">
                      <p className={clsx(
                        'inline-flex items-center gap-1 text-sm font-medium',
                        charge.comingSoon ? 'text-sky-700 dark:text-sky-300' : 'fg-secondary',
                      )}>
                        <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
                        {daysLabel(charge.daysUntil)}
                      </p>
                      <p className="mt-0.5 text-xs fg-tertiary">{formatDate(charge.nextDate)}</p>
                    </div>

                    <div className="col-start-2 row-span-2 row-start-1 flex items-center justify-end gap-2 self-center sm:col-start-3 sm:row-span-1">
                      <div className="text-right">
                        <p className="text-base font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                          {formatMoney(charge.amount)}
                        </p>
                        <p className="text-xs tabular-nums fg-tertiary">
                          {formatMoney(annualCost(charge))}/yr
                        </p>
                      </div>

                      <details className="relative">
                        <summary
                          className="close-button flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-lg [&::-webkit-details-marker]:hidden"
                          aria-label={`Actions for ${charge.merchant}`}
                        >
                          <Ellipsis className="h-5 w-5" aria-hidden="true" />
                        </summary>
                        <div className="absolute right-0 z-20 mt-1 min-w-44 rounded-lg border border-default bg-surface p-1 shadow-xl">
                          {charge.manual ? (
                            <>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.currentTarget.closest('details')?.removeAttribute('open');
                                  setEditing(charge);
                                }}
                                className="close-button flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm"
                              >
                                <Pencil className="h-4 w-4" aria-hidden="true" />
                                Edit recurring
                              </button>
                              <button
                                type="button"
                                onClick={() => charge.id && deleteManual.mutate(charge.id)}
                                disabled={deleteManual.isPending}
                                className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-900/30"
                              >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                                Delete recurring
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => dismiss.mutate({
                                merchant: charge.merchant,
                                amount: charge.amount,
                                account: charge.account,
                                accountId: charge.accountId,
                              })}
                              disabled={dismiss.isPending}
                              className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-900/30"
                            >
                              <X className="h-4 w-4" aria-hidden="true" />
                              Remove from recurring
                            </button>
                          )}
                        </div>
                      </details>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {editing && (
        <ManualRecurringModal
          key={editing === 'new' ? 'new' : editing.id}
          charge={editing === 'new' ? null : editing}
          saving={saveManual.isPending}
          error={saveManual.error?.message ?? null}
          onClose={() => {
            if (!saveManual.isPending) {
              saveManual.reset();
              setEditing(null);
            }
          }}
          onSave={(draft) => {
            const id = editing === 'new' ? undefined : editing.id;
            saveManual.mutate({
              id,
              body: {
                merchant: draft.merchant.trim(),
                amount: Number(draft.amount),
                frequency: draft.frequency,
                account: draft.account.trim(),
                category: draft.category.trim(),
                anchorDate: draft.anchorDate,
              },
            });
          }}
        />
      )}
    </div>
  );
}

/**
 * Create / edit a manual recurring entry. Manual entries cover
 * subscriptions and bills that don't have matching transactions yet, so
 * every field is user-supplied. `anchorDate` is any one real occurrence;
 * the server projects the next due date forward from it.
 */
function ManualRecurringModal({
  charge,
  saving,
  error,
  onClose,
  onSave,
}: {
  charge: RecurringCharge | null;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (draft: ManualDraft) => void;
}) {
  const isEdit = charge !== null;
  const [draft, setDraft] = useState<ManualDraft>({
    merchant: charge?.merchant ?? '',
    amount: charge ? String(charge.amount) : '',
    frequency: charge?.frequency ?? 'monthly',
    account: charge?.account ?? '',
    category: charge?.category ?? '',
    anchorDate: charge?.nextDate ?? todayLocalISO(),
  });

  const amountNum = Number(draft.amount);
  const canSave =
    draft.merchant.trim().length > 0
    && draft.account.trim().length > 0
    && draft.category.trim().length > 0
    && Number.isFinite(amountNum)
    && amountNum > 0
    && /^\d{4}-\d{2}-\d{2}$/.test(draft.anchorDate);

  return (
    <Dialog
      aria-label={isEdit ? 'Edit recurring entry' : 'Add recurring entry'}
      onClose={onClose}
      closeDisabled={saving}
      contentClassName="card w-full max-w-sm"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold fg-primary">{isEdit ? 'Edit recurring' : 'Add recurring'}</h3>
        <button type="button" onClick={onClose} disabled={saving} className="close-button rounded-lg p-2 disabled:opacity-50" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave && !saving) onSave(draft);
        }}
      >
        <label className="block">
          <span className="text-sm fg-secondary">Merchant</span>
          <input
            value={draft.merchant}
            onChange={(e) => setDraft((d) => ({ ...d, merchant: e.target.value }))}
            placeholder="e.g. Netflix"
            maxLength={120}
            className={`mt-1 w-full ${MODAL_INPUT_CLS}`}
            required
            autoFocus
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm fg-secondary">Amount</span>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 fg-muted text-sm">{currencySymbol()}</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={draft.amount}
                onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
                placeholder="0"
                className={`w-full ${MODAL_INPUT_CLS} pl-7 pr-3 tabular-nums`}
                required
              />
            </div>
          </label>
          <label className="block">
            <span className="text-sm fg-secondary">Frequency</span>
            <select
              value={draft.frequency}
              onChange={(e) => setDraft((d) => ({ ...d, frequency: e.target.value as Frequency }))}
              className={`mt-1 w-full ${MODAL_INPUT_CLS}`}
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
        </div>

        <label className="block">
          <span className="text-sm fg-secondary">Next due date</span>
          <input
            type="date"
            value={draft.anchorDate}
            onChange={(e) => setDraft((d) => ({ ...d, anchorDate: e.target.value }))}
            className={`mt-1 w-full ${MODAL_INPUT_CLS}`}
            required
          />
          <span className="mt-1 block text-[10px] fg-muted">Any real charge date works — the schedule projects forward from it.</span>
        </label>

        <label className="block">
          <span className="text-sm fg-secondary">Account</span>
          <input
            value={draft.account}
            onChange={(e) => setDraft((d) => ({ ...d, account: e.target.value }))}
            placeholder="e.g. Chase Credit"
            maxLength={120}
            className={`mt-1 w-full ${MODAL_INPUT_CLS}`}
            required
          />
        </label>

        <label className="block">
          <span className="text-sm fg-secondary">Category</span>
          <input
            value={draft.category}
            onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
            placeholder="e.g. Subscriptions"
            maxLength={120}
            className={`mt-1 w-full ${MODAL_INPUT_CLS}`}
            required
          />
        </label>

        {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} disabled={saving} className="px-3 py-2 text-sm fg-tertiary hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={!canSave || saving} className="btn-primary flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed">
            <Check className="h-4 w-4" /> {saving ? 'Saving…' : isEdit ? 'Save' : 'Add'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const MODAL_INPUT_CLS = 'rounded-lg border border-default bg-surface fg-primary placeholder-slate-400 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none';
