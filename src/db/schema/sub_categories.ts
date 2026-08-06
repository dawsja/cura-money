import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, index, foreignKey, unique, check } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { categories } from './categories';
import { numericNumber } from './numeric-number';

/**
 * Sub-categories — children of a main category. Cascade-deleted with the parent.
 */
export const subCategories = pgTable(
  'sub_categories',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    mainCategoryId: text('main_category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    planned: numericNumber('planned', { precision: 16, scale: 2 }).notNull().default(0),
    icon: text('icon'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_sub_categories_user').on(t.userId),
    mainIdx: index('idx_sub_categories_main').on(t.mainCategoryId),
    userIdUnique: unique('sub_categories_user_id_id_unique').on(t.userId, t.id),
    tenantCategoryFk: foreignKey({
      columns: [t.userId, t.mainCategoryId],
      foreignColumns: [categories.userId, categories.id],
      name: 'sub_categories_user_category_fk',
    }).onDelete('cascade'),
    plannedRange: check(
      'sub_categories_planned_range',
      sql`${t.planned} BETWEEN 0 AND 90000000000000`,
    ),
  }),
);

export type SubCategoryRow = typeof subCategories.$inferSelect;
export type NewSubCategoryRow = typeof subCategories.$inferInsert;
