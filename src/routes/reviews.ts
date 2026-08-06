/**
 * /api/reviews — bell + carousel review flow.
 *
 * Two endpoints:
 *   - `GET  /api/reviews/queue`     → `{ count, rows }`. The bell polls
 *                                       `count` every 30s; the modal
 *                                       fetches `rows` once when it
 *                                       opens.
 *   - `POST /api/reviews/:id/decision` → resolve one item:
 *                                       `{ action: 'skip' | 'categorize',
 *                                          category?, subCategory?, type? }`.
 *
 * Categorize decisions require a leaf sub-category that belongs to the
 * supplied main category. Empty patches (`action: 'skip'`) just clear
 * the flag.
 *
 * When a previously-pending row is categorized, the data layer
 * (`markTransactionReviewed`) auto-trains a rule on the
 * merchant → category mapping so the next import of the same
 * merchant skips the review queue. Skip actions do NOT create a
 * rule — the user didn't make a categorization decision.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import {
  listReviewQueue,
  pendingReviewCount,
  markTransactionReviewed,
  skipAllPendingReviews,
  categoryAssignmentExists,
} from '@/db/queries';
import { userId, routeParam } from '@/lib/tenant';
import { badRequest, notFound, safe } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const reviewRoutes = new Hono();

const DecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('skip') }),
  z.object({
    action: z.literal('categorize'),
    category: z.string().min(1).max(120),
    subCategory: z.string().min(1).max(120),
    type: z.enum(['income', 'expense', 'transfer']).optional(),
  }),
]);

reviewRoutes.get(
  '/queue',
  safe(async (c) => {
    const rawLimit = c.req.query('limit');
    const parsedLimit = rawLimit !== undefined ? Number(rawLimit) : 100;
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 200)
        : 100;
    const rows = await listReviewQueue(userId(c), { limit });
    const count = await pendingReviewCount(userId(c));
    return c.json({ count, rows });
  }),
);

// POST /api/reviews/skip-all — bulk-clear needs_review for every pending
// transaction. Must be registered before /:id/decision so "skip-all" is
// not captured as an id.
reviewRoutes.post(
  '/skip-all',
  safe(async (c) => {
    const uid = userId(c);
    const cleared = await skipAllPendingReviews(uid);
    logger.info({ event: 'review.skip_all', userId: uid, cleared }, 'skipped all reviews');
    return c.json({ ok: true, cleared });
  }),
);

reviewRoutes.post(
  '/:id/decision',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = DecisionSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    }
    const uid = userId(c);
    const id = routeParam(c, 'id');
    if (
      parsed.data.action === 'categorize'
      && !await categoryAssignmentExists(uid, parsed.data.category, parsed.data.subCategory)
    ) {
      return badRequest(c, 'subCategory must belong to category');
    }

    // `skip` is a pure flag-clear — empty patch. `categorize` applies
    // whatever the user picked (in the same call) and clears the flag.
    const patch =
      parsed.data.action === 'categorize'
        ? {
            category: parsed.data.category,
            subCategory: parsed.data.subCategory,
            type: parsed.data.type,
          }
        : {};

    const result = await markTransactionReviewed(uid, id, patch);
    if (!result) {
      return notFound(c, 'transaction not found');
    }
    logger.info(
      {
        event: 'review.decision',
        userId: uid,
        transactionId: id,
        action: parsed.data.action,
      },
      'reviewed',
    );
    return c.json({ ok: true, row: result });
  }),
);
