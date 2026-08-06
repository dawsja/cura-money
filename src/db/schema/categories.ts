import { pgEnum, pgTable, text, integer, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { user } from './auth';

// `transfer` covers credit card payments, account-to-account moves, and
// any other transaction where money moves between two of the user's own
// accounts. Transfers are excluded from income/expense totals because
// they don't change net worth — they just reallocate it.
export const transactionTypeEnum = pgEnum('transaction_type', ['income', 'expense', 'transfer']);

/**
 * Main categories (e.g. "Food & Dining"). Children live in `sub_categories`.
 *
 * `sortOrder` is a per-user ordering field. The user can drag-and-drop
 * main categories on the Categories page; the new order is persisted
 * and respected by the Budget page (which renders the same list).
 */
export const categories = pgTable(
  'categories',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: transactionTypeEnum('type').notNull(),
    icon: text('icon'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_categories_user').on(t.userId),
    userIdUnique: unique('categories_user_id_id_unique').on(t.userId, t.id),
  }),
);

export type CategoryRow = typeof categories.$inferSelect;
export type NewCategoryRow = typeof categories.$inferInsert;
