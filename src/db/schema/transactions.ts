import { sql } from 'drizzle-orm';
import { pgTable, text, boolean, bigint, date, timestamp, index, unique, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { transactionTypeEnum } from './categories';

/**
 * Transactions — the core ledger entry. `external_id` is unique per user
 * to support tenant-scoped SimpleFIN sync dedupe (`sf-<simplefin-tx-id>`).
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
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    sourceDate: date('source_date'),
    dateUserModified: boolean('date_user_modified').notNull().default(false),
    merchant: text('merchant').notNull(),
    category: text('category').notNull(),
    subCategory: text('sub_category'),
    // Stable ledger identity. `account` remains a display snapshot for
    // compatibility and for rows whose legacy name could not be backfilled.
    accountId: text('account_id'),
    account: text('account').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    type: transactionTypeEnum('type').notNull(),
    notes: text('notes'),
    externalId: text('external_id'),
    needsReview: boolean('needs_review').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_transactions_user').on(t.userId),
    dateIdx: index('idx_transactions_date').on(t.date),
    userDateIdx: index('idx_transactions_user_date').on(t.userId, t.date),
    userAccountIdx: index('idx_transactions_user_account').on(t.userId, t.accountId),
    externalIdx: uniqueIndex('idx_transactions_user_external').on(t.userId, t.externalId),
    userIdUnique: unique('transactions_user_id_id_unique').on(t.userId, t.id),
    amountSafeInteger: check(
      'transactions_amount_cents_safe_integer',
      sql`${t.amountCents} BETWEEN 0 AND 9007199254740991`,
    ),
    // Hot path: "does this user have transactions awaiting review?" and
    // "fetch the review queue". The compound index supports both with a
    // single row-scan; the order matches the WHERE clause that
    // `pendingReviewCount` / `listReviewQueue` emit.
    userNeedsReviewIdx: index('idx_transactions_user_needs_review').on(t.userId, t.needsReview),
  }),
);

export type TransactionRow = typeof transactions.$inferSelect;
export type NewTransactionRow = typeof transactions.$inferInsert;
