import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * Categorization rules — user-defined "always set this merchant to this
 * category/sub-category" mappings. Applied at import time (SimpleFIN +
 * manual add) and consulted by the Transactions page to decide whether
 * to prompt for a new rule after an inline category change.
 *
 * `matchType` is currently always `'exact'` (case-insensitive). The
 * column is in the schema to keep the door open for `contains` /
 * `regex` later without another migration. `matchValue` stores the
 * merchant string verbatim so a rule the user created stays stable
 * even if other transactions for that merchant use slightly different
 * capitalisation — we compare with `LOWER()` on both sides at read time.
 */
export const rules = pgTable(
  'rules',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    matchType: text('match_type').notNull().default('exact'),
    matchValue: text('match_value').notNull(),
    category: text('category').notNull(),
    subCategory: text('sub_category'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Hot path: "does this user have a rule for this merchant?" — index
    // on (user_id, match_value) lets the lookup stay a single-row read.
    userMerchantIdx: index('idx_rules_user_merchant').on(t.userId, t.matchValue),
  }),
);

export type RuleRow = typeof rules.$inferSelect;
export type NewRuleRow = typeof rules.$inferInsert;
