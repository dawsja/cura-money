import { pgTable, text, doublePrecision, timestamp, index } from 'drizzle-orm/pg-core';

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
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    target: doublePrecision('target').notNull(),
    // Starting value entered by the user at goal creation. We don't
    // reference it in the progress bar (the account balance drives
    // progress), but we keep it so the user can see "you've saved $X
    // since you created this goal" if they want.
    startingValue: doublePrecision('starting_value').notNull().default(0),
    // The account whose balance the progress bar tracks. Set when the
    // goal is created; nullable so a deleted account doesn't blow up
    // reads — callers should treat null as "account gone, hide progress".
    accountId: text('account_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_goals_user').on(t.userId),
  }),
);

export type GoalRow = typeof goals.$inferSelect;
export type NewGoalRow = typeof goals.$inferInsert;