/**
 * ReviewCarouselModal — one-at-a-time review flow for the bell.
 *
 * One slide per pending transaction. Each slide lets the user pick
 * a category / sub-category / type (matching the inline picker on
 * the Transactions page) and confirm with "Categorize", or accept
 * the imported suggestion without creating a rule.
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
 *   - Completion is based on the server's canonical pending count, not
 *     the loaded row slice or current slide index.
 *
 * Keyboard:
 *   - Escape  → close
 *   - ←/→     → prev / next slide (without dispatching)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import { formatMoney, formatDate } from '../lib/format';
import {
  confirmReviewedTransactionRule,
  createReviewedTransactionRule,
  type ReviewDecisionResult,
  type ReviewRule,
  type ReviewTransaction,
} from '../lib/reviews';
import { ConfirmDialog } from './ui/confirm-dialog';
import { Dialog } from './ui/dialog';

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
  pendingCount: number;
  completedCount: number;
  isLoading: boolean;
  queueError: string | null;
  isMutating: boolean;
  onRetryQueue: () => Promise<void>;
  onClose: () => void;
  onDecide: (
    id: string,
    payload: {
      action: 'skip' | 'categorize';
      category?: string;
      subCategory?: string | null;
      type?: TxType;
    },
  ) => Promise<ReviewDecisionResult>;
  onSkipAll: () => Promise<void>;
}

export function ReviewCarouselModal({
  queue,
  pendingCount,
  completedCount,
  isLoading,
  queueError,
  isMutating,
  onRetryQueue,
  onClose,
  onDecide,
  onSkipAll,
}: ReviewCarouselModalProps) {
  const queryClient = useQueryClient();
  const [idx, setIdx] = useState(0);
  // Per-id edit cache. Cleared when the modal resets (queue empty +
  // remount).
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [err, setErr] = useState<string | null>(null);
  const [rememberRules, setRememberRules] = useState<Record<string, boolean>>({});
  const [ruleConfirmation, setRuleConfirmation] = useState<{
    transactionId: string;
    rule: ReviewRule;
  } | null>(null);
  const [ruleOperation, setRuleOperation] = useState<{
    transactionId: string;
    status: 'pending' | 'error';
    error?: string;
  } | null>(null);
  const [confirmAcceptAll, setConfirmAcceptAll] = useState(false);

  // Categories are a sibling concern — same query as the Transactions
  // page, shared via React Query so the cache is hot as soon as the
  // user has visited any page.
  const cats = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<MainCategory[]>('/api/categories'),
    staleTime: 60_000,
  });

  // Keep the same position when the current row is removed, but clamp to
  // the new last row when the user accepts the final visible slide.
  useEffect(() => {
    if (queue.length === 0) {
      setIdx(0);
      return;
    }
    setIdx((current) => Math.min(current, queue.length - 1));
  }, [queue.length]);

  const currentIdx = Math.min(idx, Math.max(0, queue.length - 1));
  const slide = queue[currentIdx] ?? null;
  const edit = slide ? edits[slide.id] ?? defaultEdit(slide) : null;

  // Arrow navigation is modal-local; Escape and focus containment live in
  // Overlay so nested confirmation dialogs do not also close this modal.
  useEffect(() => {
    if (ruleConfirmation || ruleOperation || confirmAcceptAll) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
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
  }, [confirmAcceptAll, idx, queue.length, ruleConfirmation, ruleOperation]);

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
    try {
      await onDecide(slide.id, { action: 'skip' });
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : 'Could not accept the suggestion');
    }
  }, [slide, isMutating, onDecide]);

  const handleSkipAll = useCallback(async () => {
    if (isMutating || queue.length === 0) return;
    setErr(null);
    try {
      await onSkipAll();
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : 'Could not accept all suggestions');
      throw caught;
    }
  }, [isMutating, queue.length, onSkipAll]);

  const createScopedRule = useCallback(async (transactionId: string) => {
    setRuleOperation({ transactionId, status: 'pending' });
    try {
      const ruleResult = await createReviewedTransactionRule(transactionId);
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      setRuleOperation(null);
      if (ruleResult.status === 'confirmation_required') {
        setRuleConfirmation({ transactionId, rule: ruleResult.rule });
      }
    } catch (caught) {
      setRuleOperation({
        transactionId,
        status: 'error',
        error: caught instanceof Error ? caught.message : 'unknown error',
      });
    }
  }, [queryClient]);

  const handleCategorize = useCallback(async () => {
    if (!slide || isMutating) return;
    if (!edit?.category || !edit.subCategory) return;
    setErr(null);
    try {
      await onDecide(slide.id, {
        action: 'categorize',
        category: edit.category,
        subCategory: edit.subCategory || null,
        type: edit.type,
      });
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : 'Could not save');
      return;
    }
    if (rememberRules[slide.id] === true) {
      await createScopedRule(slide.id);
    }
  }, [slide, edit, isMutating, onDecide, rememberRules, createScopedRule]);

  const isLoadingFirst = isLoading && !queueError;
  const isFinished = !isLoading && pendingCount === 0 && completedCount > 0 && !isMutating;
  const total = completedCount + pendingCount;

  // Dedupe and filter categories by the current edit's type — the
  // Transactions page renders the same filter (type-scoped groupings).
  const visibleCats = useMemo(() => {
    if (!edit || !cats.data) return [];
    return cats.data.filter((c) => c.type === edit.type || c.name === 'Pay down goals');
  }, [cats.data, edit]);

  // A type change can invalidate the selected leaf, so clear the full
  // assignment rather than leaving a sub-category under the wrong parent.
  useEffect(() => {
    if (!edit || !cats.data) return;
    const valid = visibleCats.some((c) =>
      c.name === edit.category && c.subCategories.some((s) => s.name === edit.subCategory),
    );
    if ((edit.category || edit.subCategory) && !valid) {
      updateEdit(slide!.id, { category: '', subCategory: '' });
    }
  }, [cats.data, edit?.type, edit?.category, edit?.subCategory, edit, slide, updateEdit, visibleCats]);

  // ----- Render branches ---------------------------------------------------

  if (ruleConfirmation) {
    return (
      <ConfirmDialog
        title={ruleConfirmation.rule.accountId ? 'Update existing scoped rule?' : 'Narrow existing broad rule?'}
        confirmLabel={ruleConfirmation.rule.accountId ? 'Update rule' : 'Narrow rule'}
        onConfirm={async () => {
          const result = await confirmReviewedTransactionRule(ruleConfirmation.transactionId, ruleConfirmation.rule);
          if (result.status === 'confirmation_required') {
            setRuleConfirmation({ transactionId: ruleConfirmation.transactionId, rule: result.rule });
            throw new Error('The matching rule changed. Review the updated rule and confirm again.');
          }
          queryClient.invalidateQueries({ queryKey: ['rules'] });
        }}
        onClose={() => setRuleConfirmation(null)}
      >
        <p>
          The existing rule for <span className="font-medium fg-primary">{ruleConfirmation.rule.matchValue}</span>{' '}
          currently sets {ruleConfirmation.rule.category}
          {ruleConfirmation.rule.subCategory ? ` › ${ruleConfirmation.rule.subCategory}` : ''}.
        </p>
        <p>Confirming replaces it with the reviewed transaction&apos;s scoped conditions and assignment.</p>
      </ConfirmDialog>
    );
  }

  if (confirmAcceptAll) {
    return (
      <ConfirmDialog
        title="Accept all suggestions?"
        confirmLabel={`Accept all ${pendingCount} suggestion${pendingCount === 1 ? '' : 's'}`}
        onConfirm={async () => {
          await handleSkipAll();
          setConfirmAcceptAll(false);
        }}
        onClose={() => setConfirmAcceptAll(false)}
      >
        <p>
          This will accept the imported category and type for {pendingCount} pending transaction{pendingCount === 1 ? '' : 's'} without creating rules.
        </p>
      </ConfirmDialog>
    );
  }

  if (ruleOperation) {
    return (
      <Overlay
        onClose={() => { if (ruleOperation.status === 'error') setRuleOperation(null); }}
        closeDisabled={ruleOperation.status === 'pending'}
      >
        <div className="card w-full max-w-md space-y-3">
          <h3 className="text-lg font-semibold fg-primary">
            {ruleOperation.status === 'pending' ? 'Creating scoped rule' : 'Rule was not created'}
          </h3>
          {ruleOperation.status === 'pending' ? (
            <p className="text-sm fg-secondary">The transaction is saved. Checking existing rules…</p>
          ) : (
            <>
              <p className="text-sm fg-secondary">
                The transaction was saved, but its rule failed: {ruleOperation.error}
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setRuleOperation(null)} className="px-3 py-2 text-sm fg-tertiary">
                  Continue without rule
                </button>
                <button
                  type="button"
                  onClick={() => void createScopedRule(ruleOperation.transactionId)}
                  className="btn-primary"
                >
                  Retry
                </button>
              </div>
            </>
          )}
        </div>
      </Overlay>
    );
  }

  if (isLoadingFirst) {
    return (
      <Overlay onClose={onClose}>
        <div className="card w-full max-w-lg">
          <div className="text-sm fg-muted">Loading review queue…</div>
        </div>
      </Overlay>
    );
  }

  if (queueError && queue.length === 0) {
    return (
      <Overlay onClose={onClose}>
        <div className="card w-full max-w-lg space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold fg-primary">Review queue unavailable</h3>
            <CloseButton onClose={onClose} />
          </div>
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{queueError}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm fg-tertiary">Close</button>
            <button type="button" onClick={() => void onRetryQueue()} className="btn-primary">Retry</button>
          </div>
        </div>
      </Overlay>
    );
  }

  if (queue.length === 0 && pendingCount === 0 && completedCount === 0) {
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
          {err && <p className="text-sm text-rose-600 dark:text-rose-400">{err}</p>}
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
            You've reviewed {completedCount} transaction{completedCount === 1 ? '' : 's'}.
          </p>
          {err && <p className="text-sm text-rose-600 dark:text-rose-400">{err}</p>}
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

  if (queue.length === 0) {
    return (
      <Overlay onClose={onClose}>
        <div className="card w-full max-w-lg space-y-3">
          <div className="text-sm fg-muted">Loading the next pending transactions…</div>
          {queueError && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{queueError}</p>}
          {queueError && <button type="button" onClick={() => void onRetryQueue()} className="btn-primary">Retry</button>}
        </div>
      </Overlay>
    );
  }

  // Active slide.
  return (
    <Overlay onClose={onClose} closeDisabled={isMutating}>
      <div className="card w-full max-w-lg flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold fg-primary">
            Review transactions
            <span className="ml-2 text-xs fg-muted tabular-nums">
              {completedCount} completed · {pendingCount} remaining · {total} total
            </span>
          </h3>
          <CloseButton onClose={onClose} disabled={isMutating} />
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

              <label className="flex items-start gap-2 rounded-lg border border-default bg-surface px-3 py-2 text-sm fg-secondary">
                <input
                  type="checkbox"
                  checked={rememberRules[slide.id] === true}
                  onChange={(event) => setRememberRules((current) => ({
                    ...current,
                    [slide.id]: event.target.checked,
                  }))}
                  disabled={isMutating}
                  className="mt-0.5 h-4 w-4 accent-amber-500"
                />
                <span>
                  {slide.sourceClassificationTrusted
                    ? 'Create a scoped rule using this transaction\'s account, original type, and original category.'
                    : 'Create an account-scoped rule. Original type/category was not retained for this older transaction.'}
                </span>
              </label>

              <label className="block">
                <span className="text-xs fg-secondary uppercase tracking-wide">
                  Category
                </span>
                <select
                  value={edit.category && edit.subCategory
                    ? JSON.stringify({ category: edit.category, subCategory: edit.subCategory })
                    : ''}
                  onChange={(e) => {
                    if (!e.target.value) {
                      updateEdit(slide.id, { category: '', subCategory: '' });
                      return;
                    }
                    const selected = JSON.parse(e.target.value) as { category: string; subCategory: string };
                    updateEdit(slide.id, selected);
                  }}
                  disabled={isMutating || (!cats.data && (cats.isLoading || cats.isError))}
                  className={`mt-1 w-full ${INPUT_CLS}`}
                >
                  <option value="">{cats.isLoading ? 'Loading categories…' : 'Pick a category…'}</option>
                  {visibleCats.map((c) => (
                    <optgroup key={c.id} label={c.name}>
                      {c.subCategories.map((s) => (
                        <option
                          key={s.id}
                          value={JSON.stringify({ category: c.name, subCategory: s.name })}
                        >
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {cats.isError && (
                  <span className="mt-1 flex items-center justify-between gap-2 text-xs text-rose-600 dark:text-rose-400">
                    Categories could not be loaded.
                    <button type="button" onClick={() => void cats.refetch()} className="underline">Retry</button>
                  </span>
                )}
              </label>

              {err && (
                <p className="text-sm text-rose-600 dark:text-rose-400">{err}</p>
              )}
              {queueError && (
                <p role="alert" className="flex items-center justify-between gap-2 text-sm text-rose-600 dark:text-rose-400">
                  {queueError}
                  <button type="button" onClick={() => void onRetryQueue()} className="underline">Retry queue</button>
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-default">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setIdx((p) => Math.max(0, p - 1))}
                  disabled={currentIdx === 0 || isMutating}
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
                  disabled={currentIdx >= queue.length - 1 || isMutating}
                  aria-label="Next transaction"
                  className="p-2 rounded-lg fg-muted hover:fg-secondary hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmAcceptAll(true)}
                  disabled={isMutating || pendingCount === 0}
                  className="px-3 py-2 text-sm fg-tertiary hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  Accept all suggestions
                </button>
                <button
                  type="button"
                  onClick={handleSkip}
                  disabled={isMutating}
                  className="px-3 py-2 text-sm fg-tertiary hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  Accept suggestion
                </button>
                <button
                  type="button"
                  onClick={handleCategorize}
                  disabled={isMutating || !edit.category || !edit.subCategory}
                  className={clsx(
                    'btn-primary flex items-center gap-1',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                >
                  <Check className="h-4 w-4" />
                  {isMutating ? 'Saving…' : rememberRules[slide.id] ? 'Categorize, create rule & next' : 'Categorize & next'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Dots row */}
        <div className="flex items-center justify-center gap-1 mt-4">
          {queue.map((transaction, i) => (
            <button
              key={transaction.id}
              type="button"
              onClick={() => setIdx(i)}
              aria-label={`Go to transaction ${i + 1}`}
              className={clsx(
                'h-1.5 rounded-full transition-all',
                i === currentIdx
                  ? 'w-6 bg-amber-500'
                  : i < currentIdx
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

function Overlay({ children, onClose, closeDisabled = false }: { children: React.ReactNode; onClose: () => void; closeDisabled?: boolean }) {
  return (
    <Dialog
      aria-label="Review transactions"
      onClose={onClose}
      closeDisabled={closeDisabled}
      contentClassName="flex w-full max-w-lg justify-center"
    >
      {children}
    </Dialog>
  );
}

function CloseButton({ onClose, disabled = false }: { onClose: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClose}
      disabled={disabled}
      className="close-button rounded-lg p-2 disabled:opacity-50"
      aria-label="Close"
    >
      <X className="h-4 w-4" />
    </button>
  );
}
