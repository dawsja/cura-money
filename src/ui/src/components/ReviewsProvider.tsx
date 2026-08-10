/**
 * ReviewsProvider — owns the bell + carousel review state.
 *
 * Architecture:
 *   - One tiny polling query for the count (`['reviews', 'count']`).
 *     Drives the bell badge with low bandwidth — refreshes every 30s.
 *   - The full queue (`['reviews', 'queue']`) only fetches when the
 *     modal is open. Re-opens reuse the cached data.
 *   - Decisions drop rows optimistically, roll back on failure, and only
 *     celebrate after the server confirms the final queued item.
 *   - The modal is mounted as a child so it renders inside the
 *     portal-free DOM tree. Internal state (slide index, edit copy)
 *     lives in the modal itself.
 *
 * Render once at the authenticated app root (App.tsx). Children read
 * state via `useReviews()`.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import {
  decideReview,
  fetchReviewQueue,
  skipAllReviews,
  type ReviewTransaction,
} from '../lib/reviews';
import { ReviewCarouselModal } from './ReviewCarouselModal';

interface ReviewsContextValue {
  /** 0-or-more pending count. Drives the bell badge. */
  count: number;
  /** True until the initial pending-count request resolves. */
  isLoading: boolean;
  /** Refresh the count before deciding that a newly imported queue is empty. */
  refreshCount: () => Promise<boolean>;
  /** True while the modal is mounted. */
  isOpen: boolean;
  /** Open the carousel (fetches the queue on first open). No-op when count = 0. */
  openModal: () => void;
  /** Close — remaining items stay in the queue. */
  closeModal: () => void;
}

const ReviewsContext = createContext<ReviewsContextValue | null>(null);

export function ReviewsProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  // Bumped every time we want to celebrate (so the toast effect fires
  // even when the previous one is still on screen).
  const [celebratedKey, setCelebratedKey] = useState<number | null>(null);

  // Cheap polled count — the only network traffic when the modal is
  // closed. 30s matches the cron cadence so a fresh sync shows up in
  // the badge within one poll.
  const countQ = useQuery({
    queryKey: ['reviews', 'count'],
    queryFn: async () => (await fetchReviewQueue(1)).count,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const count = countQ.data ?? 0;

  // Full queue — only fetched when the modal is open.
  const queueQ = useQuery({
    queryKey: ['reviews', 'queue'],
    queryFn: () => fetchReviewQueue(100),
    enabled: isOpen,
    staleTime: 60_000,
  });

  const openModal = useCallback(() => {
    if (count === 0 && !isOpen) {
      // Still allow opening an empty queue so the user can confirm
      // "nothing to review" — keeps the UX predictable.
    }
    setIsOpen(true);
  }, [count, isOpen]);

  const closeModal = useCallback(() => setIsOpen(false), []);
  const refetchCount = countQ.refetch;
  const refreshCount = useCallback(async () => {
    const result = await refetchCount();
    return !result.isError;
  }, [refetchCount]);
  const dismissCelebration = useCallback(() => setCelebratedKey(null), []);

  const decision = useMutation({
    mutationFn: (vars: {
      id: string;
      payload: Parameters<typeof decideReview>[1];
    }) => decideReview(vars.id, vars.payload),
    // We do optimistic queue + count updates for instant feedback, but
    // `onSuccess` also reconciles and decides whether to celebrate.
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ['reviews', 'queue'] });
      const prevQueue = qc.getQueryData<{
        count: number;
        rows: ReviewTransaction[];
      }>(['reviews', 'queue']);
      const prevCount = qc.getQueryData<number>(['reviews', 'count']);
      if (prevQueue) {
        const nextRows = prevQueue.rows.filter((r) => r.id !== id);
        qc.setQueryData(['reviews', 'queue'], {
          count: Math.max(0, prevQueue.count - 1),
          rows: nextRows,
        });
      }
      if (typeof prevCount === 'number') {
        qc.setQueryData(['reviews', 'count'], Math.max(0, prevCount - 1));
      }
      return { prevQueue, prevCount };
    },
    onError: (_err, _vars, ctx) => {
      // Roll back optimistic updates on failure.
      if (ctx?.prevQueue) {
        qc.setQueryData(['reviews', 'queue'], ctx.prevQueue);
      }
      if (typeof ctx?.prevCount === 'number') {
        qc.setQueryData(['reviews', 'count'], ctx.prevCount);
      }
    },
    onSuccess: (_data, _vars, context) => {
      qc.invalidateQueries({ queryKey: ['reviews', 'count'] });
      qc.invalidateQueries({ queryKey: ['reviews', 'queue'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['budget'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      if (context?.prevCount === 1) setCelebratedKey(Date.now());
    },
  });

  const onDecide = useCallback(
    async (id: string, payload: Parameters<typeof decideReview>[1]) => {
      return decision.mutateAsync({ id, payload });
    },
    [decision],
  );

  const skipAll = useMutation({
    mutationFn: () => skipAllReviews(),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['reviews'] });
      const prevQueue = qc.getQueryData<{ count: number; rows: ReviewTransaction[] }>(['reviews', 'queue']);
      const prevCount = qc.getQueryData<number>(['reviews', 'count']);
      qc.setQueryData(['reviews', 'queue'], { count: 0, rows: [] });
      qc.setQueryData(['reviews', 'count'], 0);
      return { prevQueue, prevCount };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevQueue) qc.setQueryData(['reviews', 'queue'], ctx.prevQueue);
      if (typeof ctx?.prevCount === 'number') qc.setQueryData(['reviews', 'count'], ctx.prevCount);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['budget'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      setCelebratedKey(Date.now());
    },
  });

  const onSkipAll = useCallback(async () => {
    await skipAll.mutateAsync();
  }, [skipAll]);

  // Auto-dismiss the celebration toast after 4s.
  useEffect(() => {
    if (celebratedKey === null) return;
    const t = setTimeout(() => dismissCelebration(), 4000);
    return () => clearTimeout(t);
  }, [celebratedKey, dismissCelebration]);

  const value = useMemo<ReviewsContextValue>(
    () => ({ count, isLoading: countQ.isLoading, refreshCount, isOpen, openModal, closeModal }),
    [count, countQ.isLoading, refreshCount, isOpen, openModal, closeModal],
  );

  return (
    <ReviewsContext.Provider value={value}>
      {children}
      {isOpen && (
        <ReviewCarouselModal
          queue={queueQ.data?.rows ?? []}
          isLoading={queueQ.isLoading && !queueQ.data}
          onClose={closeModal}
          onDecide={onDecide}
          onSkipAll={onSkipAll}
          isMutating={decision.isPending || skipAll.isPending}
        />
      )}
      {celebratedKey !== null && (
        <CelebrationToast onDismiss={dismissCelebration} />
      )}
    </ReviewsContext.Provider>
  );
}

export function useReviews(): ReviewsContextValue {
  const ctx = useContext(ReviewsContext);
  if (!ctx) {
    throw new Error('useReviews() called outside <ReviewsProvider>');
  }
  return ctx;
}

/**
 * "You're all caught up" toast. Bottom-right, single-slot,
 * auto-dismissing after 4s (matches Paydown/Rules/Transactions toasts).
 */
function CelebrationToast({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      role="status"
      className="app-toast fixed z-50 max-w-sm rounded-lg border border-default bg-surface shadow-lg px-4 py-3 text-sm flex items-start gap-3"
    >
      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="fg-primary">You're all caught up 🎉</div>
        <div className="fg-muted text-xs mt-0.5">
          Every transaction has been reviewed.
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="close-button rounded-md p-1"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
