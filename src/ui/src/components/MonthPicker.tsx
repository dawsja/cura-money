/**
 * MonthPicker — the budget/reports month navigator, redesigned to the
 * Monarch-style "clean separated buttons" look:
 *
 *   [ ‹ ]   [ Jul 2026 ]   [ › ]   [ Today ]
 *
 * Each control is its own bordered button (or static pill for the
 * month label) with `gap-2` between them, so nothing is fused into a
 * single chunky pill. The `Today` button only renders when the user
 * has navigated away from the current month, so the picker stays
 * compact on first load.
 *
 * Variants:
 *   - Arrow buttons → `outline` + `icon` size (matches the rest of the
 *     toolbar controls in Transactions/Categories).
 *   - Month label → static border + bg-surface + tabular-nums, same
 *     height (`h-9`) as the outline Button so the three controls line
 *     up.
 *   - `Today` → `ghost` so it doesn't fight the navigation arrows for
 *     attention, but still clearly clickable (hover bg + fg shift).
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './ui/button';
import { currentYearMonth, shiftYearMonth } from '../lib/format';

interface MonthPickerProps {
  value: string; // 'YYYY-MM'
  onChange: (ym: string) => void;
  /** Override "today" — useful for tests / SSR. Defaults to now(). */
  today?: string;
  /** Hide the "Today" button. Defaults to false (shown when off-current). */
  hideToday?: boolean;
  /** Disable the prev/next buttons. */
  disabled?: boolean;
}

export function MonthPicker({ value, onChange, today, hideToday = false, disabled = false }: MonthPickerProps) {
  const todayYm = today ?? currentYearMonth();
  const isCurrent = value === todayYm;
  const [y, m] = value.split('-');
  const label = `${MONTH_NAMES[Number(m) - 1]} ${y}`;

  return (
    <div role="group" aria-label="Month selector" className="flex w-full items-center gap-2 sm:w-auto">
      <Button
        variant="outline"
        size="icon"
        aria-label="Previous month"
        disabled={disabled}
        onClick={() => onChange(shiftYearMonth(value, -1))}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <div
        aria-label={`Selected month: ${label}`}
        className="inline-flex h-11 min-w-0 flex-1 items-center justify-center rounded-md border border-default bg-surface px-3 text-sm font-medium tabular-nums fg-primary sm:h-9 sm:min-w-[140px] sm:flex-none sm:px-4"
      >
        {label}
      </div>

      <Button
        variant="outline"
        size="icon"
        aria-label="Next month"
        disabled={disabled}
        onClick={() => onChange(shiftYearMonth(value, 1))}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>

      {!hideToday && !isCurrent && (
        <Button
          variant="ghost"
          size="default"
          className="ml-0 sm:ml-2"
          onClick={() => onChange(todayYm)}
        >
          Today
        </Button>
      )}
    </div>
  );
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
