import { sql } from 'drizzle-orm';
import { pgTable, text, integer, timestamp, primaryKey, index, check } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { numericNumber } from './numeric-number';

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
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    yearMonth: text('year_month').notNull(),
    planned: numericNumber('planned', { precision: 16, scale: 2 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.accountId, t.yearMonth] }),
    userIdx: index('idx_monthly_paydown_user').on(t.userId),
    yearMonthFormat: check('monthly_paydown_year_month_format', sql`${t.yearMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    plannedRange: check(
      'monthly_paydown_planned_range',
      sql`${t.planned} BETWEEN 0 AND 90000000000000`,
    ),
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
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    yearMonth: text('year_month').notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    rowCount: integer('row_count').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.yearMonth] }),
    userIdx: index('idx_monthly_paydown_snapshots_user').on(t.userId),
    yearMonthFormat: check(
      'monthly_paydown_snapshots_year_month_format',
      sql`${t.yearMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
    rowCountRange: check('monthly_paydown_snapshots_row_count_range', sql`${t.rowCount} >= 0`),
  }),
);

export type MonthlyPaydownSnapshotRow = typeof monthlyPaydownSnapshots.$inferSelect;
export type NewMonthlyPaydownSnapshotRow = typeof monthlyPaydownSnapshots.$inferInsert;
