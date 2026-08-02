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
import { z } from 'zod';
import { getRecurringCharges, getSetting, setSetting } from '@/db/queries';
import { userId } from '@/lib/tenant';
import { safe, badRequest } from '@/lib/errors';

export const recurringRoutes = new Hono();

const DISMISSED_KEY = 'dismissed_recurring';

/** Build the canonical key for a recurring charge (merchant|amount). */
function recurringKey(merchant: string, amount: number): string {
  return `${merchant.toLowerCase()}|${Math.round(amount * 100) / 100}`;
}

async function getDismissedSet(uid: string): Promise<Set<string>> {
  const raw = await getSetting(uid, DISMISSED_KEY);
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

recurringRoutes.get(
  '/',
  safe(async (c) => {
    const uid = userId(c);
    const [charges, dismissed, marked] = await Promise.all([
      getRecurringCharges(uid),
      getDismissedSet(uid),
      getMarkedRecurring(uid),
    ]);
    // Filter out dismissed auto-detected charges
    const filtered = charges.filter(
      (ch) => !dismissed.has(recurringKey(ch.merchant, ch.amount)),
    );
    // Merge user-marked recurring items. If an auto-detected charge
    // already covers the same merchant+amount, override its frequency
    // with the user's preference. Otherwise, add the user-marked entry
    // as a new item.
    const autoKeys = new Set(filtered.map((ch) => recurringKey(ch.merchant, ch.amount)));
    for (const m of marked) {
      const key = recurringKey(m.merchant, m.amount);
      if (dismissed.has(key)) continue;
      const existing = filtered.find((ch) => recurringKey(ch.merchant, ch.amount) === key);
      if (existing) {
        existing.frequency = m.frequency;
      } else {
        filtered.push({
          merchant: m.merchant,
          amount: m.amount,
          frequency: m.frequency,
          occurrences: 1,
          lastDate: new Date().toISOString().slice(0, 10),
          category: '',
          account: '',
        });
      }
    }
    return c.json(filtered);
  }),
);

const DismissSchema = z.object({
  merchant: z.string().min(1),
  amount: z.number().finite(),
});

const MarkSchema = z.object({
  merchant: z.string().min(1),
  amount: z.number().finite(),
  frequency: z.enum(['monthly', 'yearly']),
});

recurringRoutes.post(
  '/dismiss',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = DismissSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    const uid = userId(c);
    const dismissed = await getDismissedSet(uid);
    dismissed.add(recurringKey(parsed.data.merchant, parsed.data.amount));
    await setSetting(uid, DISMISSED_KEY, JSON.stringify([...dismissed]));
    return c.json({ ok: true });
  }),
);

recurringRoutes.post(
  '/restore',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = DismissSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    const uid = userId(c);
    const dismissed = await getDismissedSet(uid);
    dismissed.delete(recurringKey(parsed.data.merchant, parsed.data.amount));
    await setSetting(uid, DISMISSED_KEY, JSON.stringify([...dismissed]));
    return c.json({ ok: true });
  }),
);

const MARKED_KEY = 'marked_recurring';

interface MarkedRecurring {
  merchant: string;
  amount: number;
  frequency: 'monthly' | 'yearly';
}

async function getMarkedRecurring(uid: string): Promise<MarkedRecurring[]> {
  const raw = await getSetting(uid, MARKED_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as MarkedRecurring[];
  } catch {
    return [];
  }
}

recurringRoutes.post(
  '/mark',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = MarkSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    const uid = userId(c);
    const existing = await getMarkedRecurring(uid);
    const key = recurringKey(parsed.data.merchant, parsed.data.amount);
    // Replace if already exists, otherwise append
    const filtered = existing.filter(
      (m) => recurringKey(m.merchant, m.amount) !== key,
    );
    filtered.push(parsed.data);
    await setSetting(uid, MARKED_KEY, JSON.stringify(filtered));
    // Also remove from dismissed if it was previously dismissed
    const dismissed = await getDismissedSet(uid);
    if (dismissed.has(key)) {
      dismissed.delete(key);
      await setSetting(uid, DISMISSED_KEY, JSON.stringify([...dismissed]));
    }
    return c.json({ ok: true });
  }),
);
