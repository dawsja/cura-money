/**
 * /api/notifications — bell dropdown feed.
 *
 *   GET  /                 → { reviews: { count }, upcoming: [...] }
 *   POST /clear            → dismiss all currently visible items from
 *                            the bell (does NOT bulk-skip reviews)
 *
 * Upcoming charges are derived from recurring detection (lastDate +
 * frequency). Lead windows are monthly 7d, quarterly 14d, and yearly 30d;
 * recently overdue charges remain visible for 7d.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { pendingReviewNotificationState, getSetting, setSetting } from '@/db/queries';
import { userId } from '@/lib/tenant';
import { safe } from '@/lib/errors';
import { loadActiveRecurringCharges, recurringKey } from '@/services/recurring';

export const notificationRoutes = new Hono();

const DISMISSED_KEY = 'dismissed_notifications';
const OVERDUE_NOTIFY_WINDOW_DAYS = 7;

const DismissedStateSchema = z.object({
  reviewsClearedThroughIdentity: z.string().optional().catch(undefined),
  // A legacy count is consumed once and upgraded to an identity watermark;
  // counts alone must not suppress a later generation of reviews.
  reviewsClearedAtCount: z.number().optional().catch(undefined),
  upcoming: z.array(z.string()).catch([]),
});

type DismissedState = z.infer<typeof DismissedStateSchema>;

function upcomingDismissKey(merchant: string, amount: number, account: string, nextDate: string): string {
  return `${recurringKey(merchant, amount, account)}|${nextDate}`;
}

function legacyUpcomingDismissKey(merchant: string, amount: number, nextDate: string): string {
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
  const [year, month, day] = lastDate.split('-').map(Number) as [number, number, number];
  const months = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12;
  const targetMonth = month - 1 + months;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = targetMonth % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(targetYear, normalizedMonth, Math.min(day, lastDay), 12));
  return d.toISOString().slice(0, 10);
}

function daysUntil(nextDate: string, now = new Date()): number {
  const [year, month, day] = nextDate.split('-').map(Number) as [number, number, number];
  const next = Date.UTC(year, month - 1, day);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return (next - today) / 86_400_000;
}

function isInNotifyWindow(days: number, frequency: 'monthly' | 'quarterly' | 'yearly'): boolean {
  if (days < -OVERDUE_NOTIFY_WINDOW_DAYS) return false;
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

async function migrateLegacyReviewDismissal(
  uid: string,
  dismissed: DismissedState,
  reviewState: { count: number; latestIdentity?: string },
): Promise<DismissedState> {
  if (typeof dismissed.reviewsClearedAtCount !== 'number') return dismissed;
  const preserveLegacyClear = reviewState.count > 0
    && reviewState.count <= dismissed.reviewsClearedAtCount
    && !!reviewState.latestIdentity;
  const upgraded: DismissedState = {
    reviewsClearedThroughIdentity: dismissed.reviewsClearedThroughIdentity
      ?? (preserveLegacyClear ? reviewState.latestIdentity : undefined),
    upcoming: dismissed.upcoming,
  };
  await setSetting(uid, DISMISSED_KEY, JSON.stringify(upgraded));
  return upgraded;
}

notificationRoutes.get(
  '/',
  safe(async (c) => {
    const uid = userId(c);
    const [reviewState, dismissed, merged] = await Promise.all([
      pendingReviewNotificationState(uid),
      getDismissed(uid),
      loadActiveRecurringCharges(uid),
    ]);

    const upgradedDismissed = await migrateLegacyReviewDismissal(uid, dismissed, reviewState);
    const dismissedUpcoming = new Set(upgradedDismissed.upcoming);
    const upcoming: UpcomingNotification[] = [];
    for (const ch of merged) {
      const nextDate = estimateNextCharge(ch.lastDate, ch.frequency);
      const days = daysUntil(nextDate);
      if (!isInNotifyWindow(days, ch.frequency)) continue;
      const key = upcomingDismissKey(ch.merchant, ch.amount, ch.accountId ?? ch.account, nextDate);
      if (dismissedUpcoming.has(key) || dismissedUpcoming.has(legacyUpcomingDismissKey(ch.merchant, ch.amount, nextDate))) {
        continue;
      }
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

    const reviewsDismissed = reviewState.count > 0
      && !!reviewState.latestIdentity
      && !!upgradedDismissed.reviewsClearedThroughIdentity
      && reviewState.latestIdentity <= upgradedDismissed.reviewsClearedThroughIdentity;

    return c.json({
      reviews: {
        count: reviewState.count,
        visible: reviewState.count > 0 && !reviewsDismissed,
      },
      upcoming,
      badgeCount:
        (reviewState.count > 0 && !reviewsDismissed ? 1 : 0) + upcoming.length,
    });
  }),
);

notificationRoutes.post(
  '/clear',
  safe(async (c) => {
    const uid = userId(c);
    const [reviewState, dismissed, merged] = await Promise.all([
      pendingReviewNotificationState(uid),
      getDismissed(uid),
      loadActiveRecurringCharges(uid),
    ]);

    const upcomingKeys = new Set(dismissed.upcoming);
    for (const ch of merged) {
      const nextDate = estimateNextCharge(ch.lastDate, ch.frequency);
      const days = daysUntil(nextDate);
      if (!isInNotifyWindow(days, ch.frequency)) continue;
      upcomingKeys.add(upcomingDismissKey(ch.merchant, ch.amount, ch.accountId ?? ch.account, nextDate));
    }

    const next: DismissedState = {
      reviewsClearedThroughIdentity: reviewState.latestIdentity,
      upcoming: [...upcomingKeys],
    };
    await setSetting(uid, DISMISSED_KEY, JSON.stringify(next));
    return c.json({ ok: true });
  }),
);
