import { pgTable, text, doublePrecision, integer, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

/**
 * Monthly paydown snapshots — per-account planned debt payment keyed
 * by year-month. Populated when the user clicks "Save to Budget" on
 * the Pay down page; read by the Budget page's Pay down modal to show
 * planned per-account for the selected month.
 *
 * Same composite-PK shape as `monthly_budgets`. No FK on `account_id`
 * so the snapshot survives account deletion — the modal filters
 * hidden/deleted accounts at read time so the user can un-hide
 * without losing their plan.
 */
export const monthlyPaydown = pgTable(
  'monthly_paydown',
  {
    userId: text('user_id').notNull(),
    accountId: text('account_id').notNull(),
    yearMonth: text('year_month').notNull(),
    planned: doublePrecision('planned').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.accountId, t.yearMonth] }),
    userIdx: index('idx_monthly_paydown_user').on(t.userId),
  }),
);

export type MonthlyPaydownRow = typeof monthlyPaydown.$inferSelect;
export type NewMonthlyPaydownRow = typeof monthlyPaydown.$inferInsert;

/**
 * "When did the user last bulk-sync the month" — one row per
 * (user, year_month). Updated alongside `monthly_paydown` by the
 * Save-to-Budget endpoint. Read by the Budget modal to render
 * "Last synced: 5m ago".
 *
 * Kept separate from `monthly_paydown.updated_at` so a per-account
 * edit doesn't masquerade as a bulk sync (which is what the UI's
 * "via Pay down page" wording is signalling).
 */
export const monthlyPaydownSnapshots = pgTable(
  'monthly_paydown_snapshots',
  {
    userId: text('user_id').notNull(),
    yearMonth: text('year_month').notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    rowCount: integer('row_count').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.yearMonth] }),
    userIdx: index('idx_monthly_paydown_snapshots_user').on(t.userId),
  }),
);

export type MonthlyPaydownSnapshotRow = typeof monthlyPaydownSnapshots.$inferSelect;
export type NewMonthlyPaydownSnapshotRow = typeof monthlyPaydownSnapshots.$inferInsert;
