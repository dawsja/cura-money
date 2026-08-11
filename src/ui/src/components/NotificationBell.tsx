/**
 * NotificationBell — left of the profile menu. Opens a ProfileMenu-style
 * dropdown with review + upcoming subscription charge notices. Clear
 * dismisses items from the bell only (does not bulk-skip reviews).
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CreditCard, Receipt } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import { useReviews } from './ReviewsProvider';

interface NotificationsResponse {
  reviews: { count: number; visible: boolean };
  upcoming: {
    key: string;
    merchant: string;
    amount: number;
    frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
    nextDate: string;
    daysUntil: number;
  }[];
  badgeCount: number;
}

function daysLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export function NotificationBell() {
  const qc = useQueryClient();
  const { openModal } = useReviews();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const notifQ = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationsResponse>('/api/notifications'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const clearMut = useMutation({
    mutationFn: () => api.post<{ ok: true }>('/api/notifications/clear', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const badge = notifQ.data?.badgeCount ?? 0;
  const reviews = notifQ.data?.reviews;
  const upcoming = notifQ.data?.upcoming ?? [];
  const hasItems = (reviews?.visible ?? false) || upcoming.length > 0;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={
          badge > 0
            ? `${badge} notification${badge === 1 ? '' : 's'}`
            : 'Notifications'
        }
        className={clsx(
          'group relative inline-flex h-11 w-11 items-center justify-center rounded-xl',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500',
        )}
      >
        <span
          className={clsx(
            'inline-flex h-9 w-9 items-center justify-center rounded-xl transition-colors',
            badge > 0
              ? 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 group-hover:bg-amber-100 dark:group-hover:bg-amber-900/50'
              : 'fg-muted group-hover:fg-secondary group-hover:bg-slate-100 dark:group-hover:bg-slate-700',
          )}
        >
          <Bell className="h-5 w-5" />
        </span>
        {badge > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-0.5 right-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold tabular-nums bg-amber-500 text-slate-900 shadow-sm"
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={clsx(
            'absolute right-0 mt-2 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl shadow-lg z-40',
            'bg-surface border border-default ring-1 ring-black/5 dark:ring-white/10',
          )}
        >
          <div className="px-4 py-3 border-b border-default">
            <h3 className="text-sm font-semibold fg-primary">Notifications</h3>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {!hasItems && (
              <div className="px-4 py-6 text-sm fg-muted text-center">
                You&apos;re all caught up
              </div>
            )}

            {reviews?.visible && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  openModal();
                }}
                className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors border-b border-default"
              >
                <Receipt className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-sm fg-primary font-medium">
                    You have {reviews.count} transaction{reviews.count === 1 ? '' : 's'} that need to be reviewed
                  </div>
                  <div className="text-xs fg-muted mt-0.5">Tap to review</div>
                </div>
              </button>
            )}

            {upcoming.map((u) => (
              <div
                key={u.key}
                role="menuitem"
                className="flex items-start gap-3 px-4 py-3 border-b border-default last:border-b-0"
              >
                <CreditCard className="h-4 w-4 text-violet-600 dark:text-violet-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-sm fg-primary font-medium truncate">
                    {u.merchant} charge coming up
                  </div>
                  <div className="text-xs fg-muted mt-0.5">
                    {formatMoney(u.amount)} · {daysLabel(u.daysUntil)}
                    <span className="fg-tertiary"> · {u.frequency}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="px-4 py-2.5 border-t border-default flex items-center justify-start">
            <button
              type="button"
              disabled={!hasItems || clearMut.isPending}
              onClick={() => clearMut.mutate()}
              className="text-xs font-medium fg-muted hover:text-amber-700 dark:hover:text-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {clearMut.isPending ? 'Clearing…' : 'Clear'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
