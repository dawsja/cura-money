/**
 * Recurring — automatic detection of recurring charges.
 *
 * Scans past transactions for charges from the same merchant at the
 * same amount repeated on a regular schedule. Surfaces subscriptions,
 * memberships, and recurring bills to help users stay on top of
 * recurring charges, catch fraud, or cancel unused services.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatMoney, formatDate } from '../lib/format';
import { RefreshCw, AlertCircle, Calendar, CreditCard, Tag, X } from 'lucide-react';
import clsx from 'clsx';

interface RecurringCharge {
  merchant: string;
  amount: number;
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  occurrences: number;
  lastDate: string;
  category: string;
  account: string;
  accountId?: string;
}

const FREQUENCY_LABEL: Record<string, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

const FREQUENCY_BADGE: Record<string, string> = {
  weekly: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  monthly: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  quarterly: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  yearly: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};

/** Normalize any frequency to a monthly burn rate. */
function monthlyBurn(c: RecurringCharge): number {
  if (c.frequency === 'weekly') return c.amount * 52 / 12;
  if (c.frequency === 'monthly') return c.amount;
  if (c.frequency === 'quarterly') return c.amount / 3;
  return c.amount / 12;
}

/** Annual cost for a single charge. */
function annualCost(c: RecurringCharge): number {
  if (c.frequency === 'weekly') return c.amount * 52;
  if (c.frequency === 'monthly') return c.amount * 12;
  if (c.frequency === 'quarterly') return c.amount * 4;
  return c.amount;
}

function recurringKey(merchant: string, amount: number, account: string): string {
  return `${merchant.toLowerCase()}|${Math.round(amount * 100) / 100}|${account.toLowerCase()}`;
}

export function Recurring() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<RecurringCharge[]>({
    queryKey: ['recurring'],
    queryFn: () => api.get('/api/recurring'),
  });

  const dismiss = useMutation({
    mutationFn: (charge: { merchant: string; amount: number; account: string; accountId?: string }) =>
      api.post('/api/recurring/dismiss', charge),
    onMutate: async (charge) => {
      await qc.cancelQueries({ queryKey: ['recurring'] });
      const prev = qc.getQueryData<RecurringCharge[]>(['recurring']);
      if (prev) {
        const key = recurringKey(charge.merchant, charge.amount, charge.accountId ?? charge.account);
        qc.setQueryData<RecurringCharge[]>(
          ['recurring'],
          prev.filter((c) => recurringKey(c.merchant, c.amount, c.accountId ?? c.account) !== key),
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
      <div data-onboarding-target="recurring-summary">
        <h1 className="text-2xl font-bold fg-primary">Recurring</h1>
        <p className="text-sm fg-secondary mt-1">
          Automatically detected charges that repeat on a regular schedule. Review these to catch unused subscriptions or unexpected charges.
        </p>
      </div>
      {dismiss.isError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-300" role="alert">
          Could not dismiss the recurring charge: {dismiss.error.message}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl bg-surface border border-default p-4">
          <p className="text-xs font-medium fg-tertiary uppercase tracking-wide">Monthly Total</p>
          <p className="text-xl font-semibold fg-primary mt-1">{formatMoney(monthlyTotal)}</p>
        </div>
        <div className="rounded-xl bg-surface border border-default p-4">
          <p className="text-xs font-medium fg-tertiary uppercase tracking-wide">Yearly Estimate</p>
          <p className="text-xl font-semibold fg-primary mt-1">{formatMoney(yearlyEstimate)}</p>
        </div>
        <div className="rounded-xl bg-surface border border-default p-4">
          <p className="text-xs font-medium fg-tertiary uppercase tracking-wide">Detected Charges</p>
          <p className="text-xl font-semibold fg-primary mt-1">{data?.length ?? 0}</p>
        </div>
      </div>

      {/* Recurring charges list */}
      {data && data.length === 0 ? (
        <div className="rounded-xl bg-surface border border-default p-8 text-center">
          <RefreshCw className="h-10 w-10 fg-tertiary mx-auto mb-3" />
          <p className="fg-secondary text-sm">No recurring charges detected yet.</p>
          <p className="fg-tertiary text-xs mt-1">
            As more transactions come in, recurring patterns will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {data?.map((charge) => (
            <div
              key={recurringKey(charge.merchant, charge.amount, charge.accountId ?? charge.account)}
              className="rounded-xl bg-surface border border-default p-4 flex flex-col sm:flex-row sm:items-center gap-3 hover:border-amber-500/40 transition-colors"
            >
              {/* Left: merchant + meta */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold fg-primary truncate">{charge.merchant}</h3>
                  <span
                    className={clsx(
                      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                      FREQUENCY_BADGE[charge.frequency],
                    )}
                  >
                    {FREQUENCY_LABEL[charge.frequency]}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs fg-tertiary">
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    Last: {formatDate(charge.lastDate)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <CreditCard className="h-3.5 w-3.5" />
                    {charge.account}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Tag className="h-3.5 w-3.5" />
                    {charge.category}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <RefreshCw className="h-3.5 w-3.5" />
                    {charge.occurrences} times
                  </span>
                </div>
              </div>

              {/* Right: amount + dismiss */}
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <p className="text-base font-semibold text-rose-600 dark:text-rose-400">
                    {formatMoney(charge.amount)}
                  </p>
                  <p className="text-xs fg-tertiary">
                    {formatMoney(annualCost(charge))}/yr
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => dismiss.mutate({
                    merchant: charge.merchant,
                    amount: charge.amount,
                    account: charge.account,
                    accountId: charge.accountId,
                  })}
                  disabled={dismiss.isPending}
                  className="flex h-11 w-11 items-center justify-center rounded-lg fg-tertiary hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors disabled:opacity-50"
                  aria-label={`Dismiss ${charge.merchant}`}
                  title="Remove from recurring"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
