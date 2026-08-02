import { pgTable, text, boolean, doublePrecision, date, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { transactionTypeEnum } from './categories';

/**
 * Transactions — the core ledger entry. `external_id` is globally unique
 * to support SimpleFIN sync dedupe (matches `sf-<simplefin-tx-id>`).
 *
 * `needs_review` flags SimpleFIN-imported transactions that the user
 * hasn't acknowledged yet. The bell badge + the Transactions banner
 * count rows where this is TRUE. The user can clear it from the review
 * carousel (Skip just clears; Categorize also patches category/sub/type).
 * Manually-entered transactions set it FALSE on insert so the user
 * doesn't have to review the data they just typed in themselves.
 */
export const transactions = pgTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    date: date('date').notNull(),
    merchant: text('merchant').notNull(),
    category: text('category').notNull(),
    subCategory: text('sub_category'),
    account: text('account').notNull(),
    amount: doublePrecision('amount').notNull(),
    type: transactionTypeEnum('type').notNull(),
    notes: text('notes'),
    externalId: text('external_id'),
    needsReview: boolean('needs_review').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_transactions_user').on(t.userId),
    userDateIdx: index('idx_transactions_user_date').on(t.userId, t.date),
    externalIdx: uniqueIndex('idx_transactions_external').on(t.externalId),
    // Hot path: "does this user have transactions awaiting review?" and
    // "fetch the review queue". The compound index supports both with a
    // single row-scan; the order matches the WHERE clause that
    // `pendingReviewCount` / `listReviewQueue` emit.
    userNeedsReviewIdx: index('idx_transactions_user_needs_review').on(t.userId, t.needsReview),
  }),
);

export type TransactionRow = typeof transactions.$inferSelect;
export type NewTransactionRow = typeof transactions.$inferInsert;
