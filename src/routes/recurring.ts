/**
 * /api/recurring — detect recurring charges from transaction history.
 *
 * Analyzes past transactions to find charges from the same merchant at
 * the same amount that repeat across multiple months (subscriptions,
 * memberships, recurring bills). Helps users identify fraud or forgotten
 * subscriptions.
 */
import { Hono } from 'hono';
import { getRecurringCharges } from '@/db/queries';
import { userId } from '@/lib/tenant';
import { safe } from '@/lib/errors';

export const recurringRoutes = new Hono();

recurringRoutes.get(
  '/',
  safe(async (c) => c.json(await getRecurringCharges(userId(c)))),
);
