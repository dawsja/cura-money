import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, primaryKey, foreignKey, index, check } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { subCategories } from './sub_categories';
import { numericNumber } from './numeric-number';

/**
 * Monthly budgets — per-sub-category planned amount, keyed by year-month.
 * Composite primary key on (user, sub_category, year_month). The "forward
 * propagation" cron job in src/jobs/budget-rollforward.ts carries the
 * previous month's value forward when no explicit override is set.
 */
export const monthlyBudgets = pgTable(
  'monthly_budgets',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    subCategoryId: text('sub_category_id').notNull(),
    yearMonth: text('year_month').notNull(), // 'YYYY-MM'
    planned: numericNumber('planned', { precision: 16, scale: 2 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.subCategoryId, t.yearMonth] }),
    yearMonthIdx: index('idx_monthly_budgets_year_month').on(t.yearMonth),
    tenantSubCategoryFk: foreignKey({
      columns: [t.userId, t.subCategoryId],
      foreignColumns: [subCategories.userId, subCategories.id],
      name: 'monthly_budgets_user_sub_category_fk',
    }).onDelete('cascade'),
    yearMonthFormat: check('monthly_budgets_year_month_format', sql`${t.yearMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    plannedRange: check(
      'monthly_budgets_planned_range',
      sql`${t.planned} BETWEEN 0 AND 90000000000000`,
    ),
  }),
);

export type MonthlyBudgetRow = typeof monthlyBudgets.$inferSelect;
export type NewMonthlyBudgetRow = typeof monthlyBudgets.$inferInsert;
