/**
 * /api/recurring — detect recurring charges from transaction history.
 *
 * Analyzes past transactions to find charges from the same merchant at
 * the same amount that repeat across multiple months (subscriptions,
 * memberships, recurring bills). Helps users identify fraud or forgotten
 * subscriptions.
 *
 * Users can dismiss detected charges they don't want to see. Dismissed
 * keys are stored in the per-user settings KV store as a JSON array
 * under the `dismissed_recurring` key.
 */
import { Hono } from 'hono';
import { getRecurringTransactionMetadata, resolveRecurringTransactionMetadata } from '@/db/queries';
import { userId } from '@/lib/tenant';
import { safe, badRequest } from '@/lib/errors';
import {
  dismissRecurring,
  loadActiveRecurringCharges,
  markRecurringRequestSchema,
  markRecurring,
  recurringIdentitySchema,
  recurringSchedule,
  restoreRecurring,
  unmarkRecurring,
} from '@/services/recurring';

export const recurringRoutes = new Hono();

recurringRoutes.get(
  '/',
  safe(async (c) => {
    const charges = await loadActiveRecurringCharges(userId(c));
    return c.json(charges.map((charge) => ({
      ...charge,
      ...recurringSchedule(charge.lastDate, charge.frequency),
    })));
  }),
);

recurringRoutes.post(
  '/dismiss',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = recurringIdentitySchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    await dismissRecurring(userId(c), parsed.data.merchant, parsed.data.amount, parsed.data.account, parsed.data.accountId);
    return c.json({ ok: true });
  }),
);

recurringRoutes.post(
  '/restore',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = recurringIdentitySchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    await restoreRecurring(userId(c), parsed.data.merchant, parsed.data.amount, parsed.data.account, parsed.data.accountId);
    return c.json({ ok: true });
  }),
);

recurringRoutes.post(
  '/mark',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = markRecurringRequestSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    const uid = userId(c);
    const latest = 'transactionId' in parsed.data
      ? await getRecurringTransactionMetadata(uid, parsed.data.transactionId)
      : await resolveRecurringTransactionMetadata(uid, {
          merchant: parsed.data.merchant,
          amount: parsed.data.amount,
          account: parsed.data.account,
          accountId: parsed.data.accountId,
        });
    if (!latest) return badRequest(c, 'transaction not found');
    await markRecurring(uid, {
      merchant: latest.merchant,
      amount: latest.amount,
      account: latest.account,
      accountId: latest.accountId,
      frequency: parsed.data.frequency,
      lastDate: latest.lastDate,
      category: latest.category,
    });
    return c.json({ ok: true });
  }),
);

// POST /api/recurring/unmark — remove a user mark AND dismiss so
// auto-detect cannot resurrect the charge. Prefer /dismiss from the
// UI for "None"; this path stays safe for older clients.
recurringRoutes.post(
  '/unmark',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = recurringIdentitySchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    await unmarkRecurring(userId(c), parsed.data.merchant, parsed.data.amount, parsed.data.account, parsed.data.accountId);
    return c.json({ ok: true });
  }),
);
