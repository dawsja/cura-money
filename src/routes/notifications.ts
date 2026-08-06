/**
 * /api/notifications — bell dropdown feed.
 *
 *   GET  /                 → { reviews: { count }, upcoming: [...] }
 *   POST /clear            → dismiss all currently visible items from
 *                            the bell (does NOT bulk-skip reviews)
 *
 * Upcoming charges are derived from recurring detection (lastDate +
 * frequency). Windows: monthly ≤7d, quarterly ≤14d, yearly ≤30d.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { pendingReviewCount, getSetting, setSetting } from '@/db/queries';
import { userId } from '@/lib/tenant';
import { safe } from '@/lib/errors';
import { loadActiveRecurringCharges, recurringKey } from '@/services/recurring';

export const notificationRoutes = new Hono();

const DISMISSED_KEY = 'dismissed_notifications';

const DismissedStateSchema = z.object({
  reviewsClearedAtCount: z.number().optional().catch(undefined),
  upcoming: z.array(z.string()).catch([]),
});

type DismissedState = z.infer<typeof DismissedStateSchema>;

function upcomingDismissKey(merchant: string, amount: number, nextDate: string): string {
  return `${recurringKey(merchant, amount)}|${nextDate}`;
}

async function getDismissed(uid: string): Promise<DismissedState> {
  const raw = await getSetting(uid, DISMISSED_KEY);
  if (!raw) return { upcoming: [] };
  try {
    const parsed = DismissedStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : { upcoming: [] };
  } catch {
    return { upcoming: [] };
  }
}

function estimateNextCharge(lastDate: string, frequency: 'monthly' | 'quarterly' | 'yearly'): string {
  const d = new Date(`${lastDate}T12:00:00`);
  if (frequency === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (frequency === 'quarterly') d.setMonth(d.getMonth() + 3);
  else d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function daysUntil(nextDate: string, now = new Date()): number {
  const next = new Date(`${nextDate}T12:00:00`);
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  return (next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
}

function isInNotifyWindow(days: number, frequency: 'monthly' | 'quarterly' | 'yearly'): boolean {
  // Include overdue / due today (days <= 0) so missed charges still surface.
  if (days > 30 && frequency === 'yearly') return false;
  if (frequency === 'monthly') return days <= 7;
  if (frequency === 'quarterly') return days <= 14;
  return days <= 30;
}

export interface UpcomingNotification {
  key: string;
  merchant: string;
  amount: number;
  frequency: 'monthly' | 'quarterly' | 'yearly';
  nextDate: string;
  daysUntil: number;
}

notificationRoutes.get(
  '/',
  safe(async (c) => {
    const uid = userId(c);
    const [reviewCount, dismissed, merged] = await Promise.all([
      pendingReviewCount(uid),
      getDismissed(uid),
      loadActiveRecurringCharges(uid),
    ]);

    const dismissedUpcoming = new Set(dismissed.upcoming);
    const upcoming: UpcomingNotification[] = [];
    for (const ch of merged) {
      const nextDate = estimateNextCharge(ch.lastDate, ch.frequency);
      const days = daysUntil(nextDate);
      if (!isInNotifyWindow(days, ch.frequency)) continue;
      const key = upcomingDismissKey(ch.merchant, ch.amount, nextDate);
      if (dismissedUpcoming.has(key)) continue;
      upcoming.push({
        key,
        merchant: ch.merchant,
        amount: ch.amount,
        frequency: ch.frequency,
        nextDate,
        daysUntil: Math.round(days),
      });
    }
    upcoming.sort((a, b) => a.daysUntil - b.daysUntil || b.amount - a.amount);

    const reviewsDismissed =
      typeof dismissed.reviewsClearedAtCount === 'number' &&
      reviewCount > 0 &&
      reviewCount <= dismissed.reviewsClearedAtCount;

    return c.json({
      reviews: {
        count: reviewCount,
        visible: reviewCount > 0 && !reviewsDismissed,
      },
      upcoming,
      badgeCount:
        (reviewCount > 0 && !reviewsDismissed ? 1 : 0) + upcoming.length,
    });
  }),
);

notificationRoutes.post(
  '/clear',
  safe(async (c) => {
    const uid = userId(c);
    const [reviewCount, dismissed, merged] = await Promise.all([
      pendingReviewCount(uid),
      getDismissed(uid),
      loadActiveRecurringCharges(uid),
    ]);

    const upcomingKeys = new Set(dismissed.upcoming);
    for (const ch of merged) {
      const nextDate = estimateNextCharge(ch.lastDate, ch.frequency);
      const days = daysUntil(nextDate);
      if (!isInNotifyWindow(days, ch.frequency)) continue;
      upcomingKeys.add(upcomingDismissKey(ch.merchant, ch.amount, nextDate));
    }

    const next: DismissedState = {
      reviewsClearedAtCount: reviewCount,
      upcoming: [...upcomingKeys],
    };
    await setSetting(uid, DISMISSED_KEY, JSON.stringify(next));
    return c.json({ ok: true });
  }),
);
