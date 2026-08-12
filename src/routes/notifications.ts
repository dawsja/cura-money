/**
 * /api/notifications — bell dropdown feed.
 *
 *   GET  /                 → { reviews: { count }, upcoming: [...] }
 *   POST /clear            → dismiss all currently visible items from
 *                            the bell (does NOT bulk-skip reviews)
 *
 * Upcoming charges are derived from recurring detection (lastDate +
 * frequency). Lead windows are weekly 2d, monthly 7d, quarterly 14d, and yearly 30d;
 * recently overdue charges remain visible for 7d.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { pendingReviewNotificationState, getSetting, setSetting } from '@/db/queries';
import { userId } from '@/lib/tenant';
import { safe } from '@/lib/errors';
import {
  loadActiveRecurringCharges,
  recurringKey,
  recurringSchedule,
  type RecurringFrequency,
} from '@/services/recurring';

export const notificationRoutes = new Hono();

const DISMISSED_KEY = 'dismissed_notifications';

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

export interface UpcomingNotification {
  key: string;
  merchant: string;
  amount: number;
  frequency: RecurringFrequency;
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
      const { nextDate, daysUntil, comingSoon } = recurringSchedule(ch.lastDate, ch.frequency);
      if (!comingSoon) continue;
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
        daysUntil,
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
      const { nextDate, comingSoon } = recurringSchedule(ch.lastDate, ch.frequency);
      if (!comingSoon) continue;
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
