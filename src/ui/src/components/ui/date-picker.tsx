/**
 * Single-date popover picker (shadcn Calendar + Popover pattern, no
 * react-day-picker dependency). Trigger is an outline button showing
 * a long local date; the panel is a month grid with prev/next.
 *
 * Values are ledger dates: `YYYY-MM-DD` strings, never UTC-shifted.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { Button } from './button';
import { formatDateLong, parseLocalDate, toLocalISODate, todayLocalISO } from '../../lib/format';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_LABEL = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (ymd: string) => void;
  disabled?: boolean;
  className?: string;
  /** Accessible name for the trigger. */
  'aria-label'?: string;
}

export function DatePicker({
  value,
  onChange,
  disabled = false,
  className,
  'aria-label': ariaLabel = 'Pick a date',
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = parseLocalDate(value);
  const [view, setView] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setView(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }, [open, value]); // eslint-disable-line react-hooks/exhaustive-deps -- re-anchor view when opening / value changes

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const today = todayLocalISO();
  const year = view.getFullYear();
  const month = view.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const pick = (day: number) => {
    const ymd = toLocalISODate(new Date(year, month, day));
    onChange(ymd);
    setOpen(false);
  };

  const label = Number.isNaN(selected.getTime()) ? 'Pick a date' : formatDateLong(value);

  return (
    <div ref={rootRef} className={clsx('relative', className)}>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-empty={Number.isNaN(selected.getTime()) || !value ? 'true' : undefined}
        className={clsx(
          'w-full justify-between text-left font-normal',
          (!value || Number.isNaN(selected.getTime())) && 'fg-muted',
        )}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="Calendar"
          className="absolute left-0 top-full z-50 mt-1 w-auto rounded-lg border border-default bg-surface p-3 shadow-lg"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Previous month"
              onClick={() => setView(new Date(year, month - 1, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-[9rem] text-center text-sm font-semibold fg-primary tabular-nums">
              {MONTH_LABEL.format(view)}
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Next month"
              onClick={() => setView(new Date(year, month + 1, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] font-medium fg-muted mb-1">
            {WEEKDAYS.map((d) => (
              <div key={d} className="h-7 flex items-center justify-center">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, i) => {
              if (day === null) {
                return <div key={`e-${i}`} className="h-11 w-11 md:h-8 md:w-8" />;
              }
              const ymd = toLocalISODate(new Date(year, month, day));
              const isSelected = ymd === value;
              const isToday = ymd === today;
              return (
                <button
                  key={ymd}
                  type="button"
                  onClick={() => pick(day)}
                  className={clsx(
                    'h-11 w-11 rounded-md text-sm tabular-nums transition-colors md:h-8 md:w-8',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500',
                    isSelected
                      ? 'bg-amber-500 text-slate-900 font-semibold'
                      : isToday
                        ? 'border border-amber-500 fg-primary hover:bg-amber-50 dark:hover:bg-amber-900/30'
                        : 'fg-primary hover:bg-slate-100 dark:hover:bg-slate-700',
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange(today);
                setOpen(false);
              }}
            >
              Today
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
