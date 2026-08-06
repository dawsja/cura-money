/**
 * SummaryCard — small stat tile used on Dashboard / Paydown / Reports.
 *
 *   <SummaryCard
 *     label="Net worth"
 *     sub="Sum of all accounts"
 *     tone="slate"
 *     icon={<Wallet className="h-4 w-4" />}
 *     value="$24,500"
 *   />
 *
 * Tone classes use the palette accent hues and shift
 * brightness so they stay readable on slate-800 cards. The 4 tones
 * are calibrated to pass WCAG AA in both modes — don't introduce a
 * 5th without rechecking https://webaim.org/resources/contrastchecker/.
 */
import type { ReactNode } from 'react';
import clsx from 'clsx';

export type SummaryTone = 'slate' | 'emerald' | 'amber' | 'rose' | 'violet';

export function toneTextClass(tone: SummaryTone): string {
  switch (tone) {
    case 'rose': return 'text-rose-600 dark:text-rose-400';
    case 'amber': return 'text-amber-700 dark:text-amber-400';
    case 'emerald': return 'text-emerald-600 dark:text-emerald-400';
    case 'violet': return 'text-violet-600 dark:text-violet-400';
    case 'slate': return 'fg-primary';
  }
}

export function SummaryCard({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: SummaryTone;
  icon?: ReactNode;
}) {
  return (
    <div className="card space-y-1">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider fg-muted">{label}</div>
        {icon && <div className="fg-muted">{icon}</div>}
      </div>
      <div className={clsx('text-2xl font-bold tabular-nums', toneTextClass(tone))}>
        {value}
      </div>
      {sub && <div className="text-[10px] uppercase tracking-wider fg-muted">{sub}</div>}
    </div>
  );
}
