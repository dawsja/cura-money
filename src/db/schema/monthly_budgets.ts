import { pgTable, text, doublePrecision, timestamp, primaryKey } from 'drizzle-orm/pg-core';

/**
 * Monthly budgets — per-sub-category planned amount, keyed by year-month.
 * Composite primary key on (user, sub_category, year_month). The "forward
 * propagation" cron job in src/jobs/budget-rollforward.ts carries the
 * previous month's value forward when no explicit override is set.
 */
export const monthlyBudgets = pgTable(
  'monthly_budgets',
  {
    userId: text('user_id').notNull(),
    subCategoryId: text('sub_category_id').notNull(),
    yearMonth: text('year_month').notNull(), // 'YYYY-MM'
    planned: doublePrecision('planned').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.subCategoryId, t.yearMonth] }),
  }),
);

export type MonthlyBudgetRow = typeof monthlyBudgets.$inferSelect;
export type NewMonthlyBudgetRow = typeof monthlyBudgets.$inferInsert;
