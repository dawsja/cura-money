/**
 * ReviewCarouselModal — one-at-a-time review flow for the bell.
 *
 * One slide per pending transaction. Each slide lets the user pick
 * a category / sub-category / type (matching the inline picker on
 * the Transactions page) and confirm with "Categorize", or bypass
 * the prompt with "Skip".
 *
 * Internal state:
 *   - `idx`     — current slide index. Auto-advances on a successful
 *                  decision so the user clicks once to dispatch.
 *   - `editState` — a per-id cache of the user's edits. Carries over
 *                    between slides (typing for slide 2 doesn't affect
 *                    slide 3's defaults) and resets `idx` when the
 *                    user manually prev/next without dispatching.
 *
 * Empty-state handling:
 *   - `queue.length === 0` from the moment the modal opens: render
 *     an info panel ("nothing to review") with a Close button. This
 *     covers the transient state during the queue fetch.
 *   - `idx >= queue.length` after dispatches: render the "All done"
 *     celebration close-out with the emerald Check icon and a "Done"
 *     primary button. Closes via the close handler.
 *
 * Keyboard:
 *   - Escape  → close
 *   - ←/→     → prev / next slide (without dispatching)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import { formatMoney, formatDate } from '../lib/format';
import { type ReviewTransaction } from '../lib/reviews';

const INPUT_CLS =
  'rounded-lg border border-default bg-surface fg-primary placeholder-slate-400 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none';

type TxType = 'income' | 'expense' | 'transfer';

interface MainCategory {
  id: string;
  name: string;
  type: TxType;
  subCategories: { id: string; name: string }[];
}

interface EditState {
  category: string;
  subCategory: string;
  type: TxType;
}

const TYPE_LABEL: Record<TxType, string> = {
  income: 'Income',
  expense: 'Expense',
  transfer: 'Transfer',
};
const TYPE_SIGN: Record<TxType, string> = {
  income: '+',
  expense: '−',
  transfer: '⇄',
};
const TYPE_COLOR: Record<TxType, string> = {
  income: 'text-emerald-600 dark:text-emerald-400',
  expense: 'text-rose-600 dark:text-rose-400',
  transfer: 'text-slate-600 dark:text-slate-400',
};

function defaultEdit(tx: ReviewTransaction): EditState {
  return {
    category: tx.category,
    subCategory: tx.subCategory ?? '',
    type: tx.type,
  };
}

export interface ReviewCarouselModalProps {
  queue: ReviewTransaction[];
  isLoading: boolean;
  isMutating: boolean;
  onClose: () => void;
  onDecide: (
    id: string,
    payload: { action: 'skip' | 'categorize'; category?: string; subCategory?: string | null; type?: TxType },
  ) => Promise<void>;
}

export function ReviewCarouselModal({
  queue,
  isLoading,
  isMutating,
  onClose,
  onDecide,
}: ReviewCarouselModalProps) {
  const [idx, setIdx] = useState(0);
  // Per-id edit cache. Cleared when the modal resets (queue empty +
  // remount).
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [err, setErr] = useState<string | null>(null);

  // Categories are a sibling concern — same query as the Transactions
  // page, shared via React Query so the cache is hot as soon as the
  // user has visited any page.
  const cats = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<MainCategory[]>('/api/categories'),
    staleTime: 60_000,
  });

  // When the queue shape changes, keep the user's place only if the
  // current index is still in range. We don't want to reset to 0 on
  // every optimistic dispatch — that would scroll the user backwards.
  // A shape change from "queue grew" (a fresh sync added items while
  // open) keeps idx where it is.
  const lastQueueLenRef = useRef<number>(queue.length);
  useEffect(() => {
    if (queue.length === 0) {
      setIdx(0);
      return;
    }
    if (lastQueueLenRef.current > queue.length) {
      // Queue shrank (the user dispatched the current slide). Bump
      // `idx` to the same position in the new shortened list, which
      // happens to be the next slide — i.e. auto-advance.
      setIdx((p) => Math.min(p, queue.length));
    } else if (idx >= queue.length) {
      setIdx(Math.max(0, queue.length - 1));
    }
    lastQueueLenRef.current = queue.length;
  }, [queue.length, idx]);

  const slide = idx < queue.length ? queue[idx] : null;
  const edit = slide ? edits[slide.id] ?? defaultEdit(slide) : null;

  // Keyboard handlers. Bound only while the modal is mounted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowLeft') {
        setIdx((p) => Math.max(0, p - 1));
      }
      if (e.key === 'ArrowRight') {
        if (idx >= queue.length - 1) return;
        setIdx((p) => p + 1);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [idx, queue.length, onClose]);

  const updateEdit = useCallback(
    (id: string, patch: Partial<EditState>) => {
      setEdits((prev) => {
        const base = prev[id] ?? defaultEdit(queue.find((q) => q.id === id)!);
        return { ...prev, [id]: { ...base, ...patch } };
      });
    },
    [queue],
  );

  const handleSkip = useCallback(async () => {
    if (!slide || isMutating) return;
    setErr(null);
    await onDecide(slide.id, { action: 'skip' });
    setIdx((p) => p + 1);
  }, [slide, isMutating, onDecide]);

  const handleCategorize = useCallback(async () => {
    if (!slide || isMutating) return;
    if (!edit) return;
    setErr(null);
    try {
      await onDecide(slide.id, {
        action: 'categorize',
        category: edit.category,
        subCategory: edit.subCategory || null,
        type: edit.type,
      });
      setIdx((p) => p + 1);
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : 'Could not save');
    }
  }, [slide, edit, isMutating, onDecide]);

  const isLoadingFirst = isLoading && queue.length === 0;
  const isFinished = !isLoadingFirst && idx >= queue.length && queue.length > 0;
  const total = queue.length;

  // Dedupe and filter categories by the current edit's type — the
  // Transactions page renders the same filter (type-scoped groupings).
  const visibleCats = useMemo(() => {
    if (!edit || !cats.data) return [];
    return cats.data.filter((c) => c.type === edit.type);
  }, [cats.data, edit]);

  const subOptions = useMemo(() => {
    const found = visibleCats.find((c) => c.name === edit?.category);
    return found?.subCategories ?? [];
  }, [visibleCats, edit?.category]);

  // When the user changes type or main category, clear the sub-category
  // if it doesn't fit the new bucket.
  useEffect(() => {
    if (!edit) return;
    if (subOptions.length === 0 && edit.subCategory !== '') {
      updateEdit(slide!.id, { subCategory: '' });
      return;
    }
    if (
      edit.subCategory &&
      !subOptions.some((s) => s.name === edit.subCategory)
    ) {
      updateEdit(slide!.id, { subCategory: '' });
    }
  }, [edit?.type, edit?.category, subOptions, edit?.subCategory, edit, slide, updateEdit]);

  // ----- Render branches ---------------------------------------------------

  if (isLoadingFirst) {
    return (
      <Overlay onClose={onClose}>
        <div className="card w-full max-w-lg">
          <div className="text-sm fg-muted">Loading review queue…</div>
        </div>
      </Overlay>
    );
  }

  if (queue.length === 0) {
    return (
      <Overlay onClose={onClose}>
        <div className="card w-full max-w-lg space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold fg-primary">All caught up</h3>
            <CloseButton onClose={onClose} />
          </div>
          <p className="text-sm fg-secondary">
            Nothing here right now. New SimpleFIN imports will land here for
            confirmation before they show up on your dashboard.
          </p>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="btn-primary">
              Got it
            </button>
          </div>
        </div>
      </Overlay>
    );
  }

  if (isFinished) {
    return (
      <Overlay onClose={onClose}>
        <div className="card w-full max-w-lg space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold fg-primary">All caught up</h3>
            <CloseButton onClose={onClose} />
          </div>
          <p className="text-sm fg-secondary">
            You've reviewed {total} transaction{total === 1 ? '' : 's'}.
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="btn-primary flex items-center gap-2"
            >
              <Check className="h-4 w-4" />
              Done
            </button>
          </div>
        </div>
      </Overlay>
    );
  }

  // Active slide.
  return (
    <Overlay onClose={onClose}>
      <div className="card w-full max-w-lg flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold fg-primary">
            Review transactions
            <span className="ml-2 text-xs fg-muted tabular-nums">
              {Math.min(idx + 1, total)} / {total}
            </span>
          </h3>
          <CloseButton onClose={onClose} />
        </div>

        {slide && edit && (
          <div className="space-y-4">
            <div className="space-y-1">
              <div className="text-xs fg-muted">{formatDate(slide.date)}</div>
              <div className="text-xl font-semibold fg-primary leading-tight">
                {slide.merchant}
              </div>
              <div className="text-sm fg-tertiary">{slide.account}</div>
            </div>

            <div className="flex items-baseline gap-3">
              <div
                className={clsx(
                  'text-2xl font-semibold tabular-nums',
                  TYPE_COLOR[edit.type],
                )}
              >
                {TYPE_SIGN[edit.type]}
                {formatMoney(slide.amount)}
              </div>
            </div>

            {slide.notes && (
              <div className="text-sm fg-tertiary border-l-2 border-default pl-3">
                {slide.notes}
              </div>
            )}

            {/* Editor */}
            <div className="grid grid-cols-1 gap-3">
              <label className="block">
                <span className="text-xs fg-secondary uppercase tracking-wide">
                  Type
                </span>
                {/* Three pill buttons in a single row below the label,
                    matching the layout the other form fields use
                    (label on top, control below). `flex` (not inline-
                    flex) keeps the row on its own line. */}
                <div className="mt-1 flex gap-1.5">
                  {(['income', 'expense', 'transfer'] as TxType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => updateEdit(slide.id, { type: t })}
                      disabled={isMutating}
                      className={clsx(
                        'flex-1 inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50',
                        edit.type === t
                          ? 'bg-amber-500 text-slate-900 border-amber-500'
                          : 'bg-surface fg-secondary border-default hover:border-amber-500 hover:text-amber-700 dark:hover:text-amber-400',
                      )}
                    >
                      {TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
              </label>

              <label className="block">
                <span className="text-xs fg-secondary uppercase tracking-wide">
                  Category
                </span>
                <select
                  value={edit.category}
                  onChange={(e) =>
                    updateEdit(slide.id, { category: e.target.value, subCategory: '' })
                  }
                  disabled={isMutating}
                  className={`mt-1 w-full ${INPUT_CLS}`}
                >
                  <option value="">Pick a category…</option>
                  {visibleCats.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              {subOptions.length > 0 && (
                <label className="block">
                  <span className="text-xs fg-secondary uppercase tracking-wide">
                    Sub-category <span className="fg-muted">(optional)</span>
                  </span>
                  <select
                    value={edit.subCategory}
                    onChange={(e) =>
                      updateEdit(slide.id, { subCategory: e.target.value })
                    }
                    disabled={isMutating}
                    className={`mt-1 w-full ${INPUT_CLS}`}
                  >
                    <option value="">No sub-category</option>
                    {subOptions.map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {err && (
                <p className="text-sm text-rose-600 dark:text-rose-400">{err}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-default">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setIdx((p) => Math.max(0, p - 1))}
                  disabled={idx === 0 || isMutating}
                  aria-label="Previous transaction"
                  className="p-2 rounded-lg fg-muted hover:fg-secondary hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setIdx((p) => Math.min(queue.length - 1, p + 1))
                  }
                  disabled={idx >= queue.length - 1 || isMutating}
                  aria-label="Next transaction"
                  className="p-2 rounded-lg fg-muted hover:fg-secondary hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSkip}
                  disabled={isMutating}
                  className="px-3 py-2 text-sm fg-tertiary hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={handleCategorize}
                  disabled={isMutating || !edit.category}
                  className={clsx(
                    'btn-primary flex items-center gap-1',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                >
                  <Check className="h-4 w-4" />
                  {isMutating ? 'Saving…' : 'Categorize & next'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Dots row */}
        <div className="flex items-center justify-center gap-1 mt-4">
          {Array.from({ length: total }).map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIdx(i)}
              aria-label={`Go to transaction ${i + 1}`}
              className={clsx(
                'h-1.5 rounded-full transition-all',
                i === idx
                  ? 'w-6 bg-amber-500'
                  : i < idx
                    ? 'w-1.5 bg-amber-300 dark:bg-amber-700'
                    : 'w-1.5 bg-slate-200 dark:bg-slate-700',
              )}
            />
          ))}
        </div>
      </div>
    </Overlay>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Review transactions"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="fg-muted hover:fg-secondary"
      aria-label="Close"
    >
      <X className="h-4 w-4" />
    </button>
  );
}
