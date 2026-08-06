/**
 * Typed wrappers around /api/reviews/* endpoints. Mirrors the pattern
 * of `lib/auth.ts` — thin functions so callers don't have to remember
 * the URL paths. The queue fetch includes both `count` (cheap, polled
 * by the bell every 30s) and `rows` (full shape, fetched once when
 * the modal opens) so we only need a single network call.
 */
import { api } from './api';

export interface ReviewTransaction {
  id: string;
  date: string;
  merchant: string;
  category: string;
  subCategory?: string;
  account: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer';
  notes?: string;
}

export interface ReviewQueue {
  count: number;
  rows: ReviewTransaction[];
}

export type ReviewAction = 'skip' | 'categorize';

export interface ReviewDecision {
  action: ReviewAction;
  category?: string;
  subCategory?: string | null;
  type?: 'income' | 'expense' | 'transfer';
}

export function fetchReviewQueue(limit = 100): Promise<ReviewQueue> {
  return api.get<ReviewQueue>(`/api/reviews/queue?limit=${limit}`);
}

export interface ReviewDecisionResult {
  ok: true;
  row: ReviewTransaction;
}

export function decideReview(
  id: string,
  decision: ReviewDecision,
): Promise<ReviewDecisionResult> {
  return api.post<ReviewDecisionResult>(`/api/reviews/${id}/decision`, decision);
}

export function skipAllReviews(): Promise<{ ok: true; cleared: number }> {
  return api.post<{ ok: true; cleared: number }>('/api/reviews/skip-all', {});
}
