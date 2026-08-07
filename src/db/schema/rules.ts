import { sql } from 'drizzle-orm';
import { foreignKey, pgTable, text, timestamp, index, integer, unique } from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { user } from './auth';
import { transactionTypeEnum } from './categories';

/**
 * Categorization rules have explicit match conditions and an assignment.
 * Existing merchant-only rows keep nullable conditions and therefore remain
 * broad; rules created from a transaction include its source account, type,
 * and category so similarly named activity on another account is unaffected.
 *
 * `matchType` is currently always `'exact'` at the storage layer; actual
 * matching is exact-or-prefix (see `src/lib/merchant-match.ts`) so a rule
 * for "Starbucks" also catches "STARBUCKS #12345". `matchValue` stores the
 * merchant string verbatim for display. Nullable source fields are wildcards.
 * `category`, `subCategory`, and `type` are the assignment to apply.
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
    normalizedMatchValue: text('normalized_match_value').generatedAlwaysAs(
      sql`lower(regexp_replace(btrim("match_value"), '\\s+', ' ', 'g'))`,
    ),
    accountId: text('account_id'),
    sourceType: transactionTypeEnum('source_type'),
    sourceCategory: text('source_category'),
    sourceSubCategory: text('source_sub_category'),
    category: text('category').notNull(),
    subCategory: text('sub_category'),
    type: transactionTypeEnum('type'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (t) => ({
    // Hot path: list/filter by user. Matching is done in app code over
    // the user's (typically small) rule set, so a plain user index is
    // enough — we no longer rely on equality on match_value alone.
    userMerchantIdx: index('idx_rules_user_merchant').on(t.userId, t.matchValue),
    userAccountIdx: index('idx_rules_user_account').on(t.userId, t.accountId),
    normalizedScopeUnique: unique('rules_user_normalized_scope_unique').on(
      t.userId,
      t.normalizedMatchValue,
      t.accountId,
      t.sourceType,
      t.sourceCategory,
      t.sourceSubCategory,
    ).nullsNotDistinct(),
    tenantAccountFk: foreignKey({
      columns: [t.userId, t.accountId],
      foreignColumns: [accounts.userId, accounts.id],
      name: 'rules_user_account_fk',
    }).onDelete('cascade'),
  }),
);

export type RuleRow = typeof rules.$inferSelect;
export type NewRuleRow = typeof rules.$inferInsert;
