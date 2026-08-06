import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { transactionTypeEnum } from './categories';

/**
 * Categorization rules — user-defined "always set this merchant to this
 * category/sub-category/type" mappings. Applied at import time (SimpleFIN +
 * manual add) and consulted by the Transactions page to decide whether
 * to prompt for a new rule after an inline category change.
 *
 * `matchType` is currently always `'exact'` at the storage layer; actual
 * matching is exact-or-prefix (see `src/lib/merchant-match.ts`) so a rule
 * for "Starbucks" also catches "STARBUCKS #12345". `matchValue` stores the
 * merchant string verbatim for display. Optional `type` remembers a user
 * type correction (e.g. transfer → expense) for future imports; NULL
 * means leave type to the smart categoriser / amount sign.
 */
export const rules = pgTable(
  'rules',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    matchType: text('match_type').notNull().default('exact'),
    matchValue: text('match_value').notNull(),
    category: text('category').notNull(),
    subCategory: text('sub_category'),
    type: transactionTypeEnum('type'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Hot path: list/filter by user. Matching is done in app code over
    // the user's (typically small) rule set, so a plain user index is
    // enough — we no longer rely on equality on match_value alone.
    userMerchantIdx: index('idx_rules_user_merchant').on(t.userId, t.matchValue),
    normalizedMerchantUnique: uniqueIndex('idx_rules_user_normalized_merchant').on(
      t.userId,
      sql`lower(regexp_replace(btrim(${t.matchValue}), '\\s+', ' ', 'g'))`,
    ),
  }),
);

export type RuleRow = typeof rules.$inferSelect;
export type NewRuleRow = typeof rules.$inferInsert;
