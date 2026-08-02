/**
 * NotificationBell — left of the profile menu in the header. Always
 * visible; badge appears only when there's at least one transaction
 * awaiting review. Clicking opens the carousel modal.
 */
import { Bell } from 'lucide-react';
import { clsx } from 'clsx';
import { useReviews } from './ReviewsProvider';

export function NotificationBell() {
  const { count, openModal } = useReviews();
  return (
    <button
      type="button"
      onClick={openModal}
      aria-label={
        count > 0
          ? `${count} transaction${count === 1 ? '' : 's'} need review`
          : 'No transactions need review'
      }
      className={clsx(
        'relative inline-flex items-center justify-center rounded-lg p-2 transition-colors',
        count > 0
          ? 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-900/50'
          : 'fg-muted hover:fg-secondary hover:bg-slate-100 dark:hover:bg-slate-700',
      )}
    >
      <Bell className="h-5 w-5" />
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold tabular-nums bg-amber-500 text-slate-900 tabular-nums shadow-sm"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}
