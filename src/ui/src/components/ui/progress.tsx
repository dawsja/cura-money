/**
 * shadcn-style progress bar — a thin horizontal track with a
 * filled portion. `value` is 0-100; values outside that range are
 * clamped for display (the track always shows a sane bar).
 *
 * `tone` picks the fill color so the same component can express
 * different statuses (under budget / approaching / over). The
 * default `amber` matches the rest of the app's accent.
 */
import clsx from 'clsx';

export function Progress({
  value,
  className,
  tone = 'amber',
}: {
  value: number;
  className?: string;
  tone?: 'amber' | 'emerald' | 'rose' | 'slate';
}) {
  const clamped = Math.min(100, Math.max(0, value));
  const fillClass =
    tone === 'emerald'
      ? 'bg-emerald-500'
      : tone === 'rose'
        ? 'bg-rose-500'
        : tone === 'slate'
          ? 'bg-slate-500'
          : 'bg-amber-500';
  return (
    <div
      className={clsx(
        'h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700',
        className,
      )}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={clsx('h-full transition-all duration-300', fillClass)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
