import { pgTable, text, doublePrecision, timestamp, index, foreignKey } from 'drizzle-orm/pg-core';
import { categories } from './categories';

/**
 * Sub-categories — children of a main category. Cascade-deleted with the parent.
 */
export const subCategories = pgTable(
  'sub_categories',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    mainCategoryId: text('main_category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    planned: doublePrecision('planned').notNull().default(0),
    icon: text('icon'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_sub_categories_user').on(t.userId),
    mainIdx: index('idx_sub_categories_main').on(t.mainCategoryId),
  }),
);

export type SubCategoryRow = typeof subCategories.$inferSelect;
export type NewSubCategoryRow = typeof subCategories.$inferInsert;
