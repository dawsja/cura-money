import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, index, foreignKey, check } from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { user } from './auth';
import { numericNumber } from './numeric-number';

/**
 * Savings goals — "save up for X" targets watched against an account.
 *
 * `current` is the user's starting value at goal-creation time (or after
 * they edit it); the live progress is the watched account's current
 * `balance`. We don't store a snapshot of the account balance — the
 * account row is the source of truth for live balance, and the goal row
 * carries the user's intent (target amount + starting offset).
 */
export const goals = pgTable(
  'goals',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    target: numericNumber('target', { precision: 16, scale: 2 }).notNull(),
    // Starting value entered by the user at goal creation. We don't
    // reference it in the progress bar (the account balance drives
    // progress), but we keep it so the user can see "you've saved $X
    // since you created this goal" if they want.
    startingValue: numericNumber('starting_value', { precision: 16, scale: 2 }).notNull().default(0),
    // The account whose balance the progress bar tracks. Set when the
    // goal is created; nullable so a deleted account doesn't blow up
    // reads — callers should treat null as "account gone, hide progress".
    accountId: text('account_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_goals_user').on(t.userId),
    tenantAccountFk: foreignKey({
      columns: [t.userId, t.accountId],
      foreignColumns: [accounts.userId, accounts.id],
      name: 'goals_user_account_fk',
    }),
    targetRange: check(
      'goals_target_range',
      sql`${t.target} > 0 AND ${t.target} <= 90000000000000`,
    ),
    startingValueRange: check(
      'goals_starting_value_range',
      sql`${t.startingValue} BETWEEN 0 AND 90000000000000`,
    ),
  }),
);

export type GoalRow = typeof goals.$inferSelect;
export type NewGoalRow = typeof goals.$inferInsert;
