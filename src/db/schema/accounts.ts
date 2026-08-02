import { pgEnum, pgTable, text, doublePrecision, boolean, timestamp, index } from 'drizzle-orm/pg-core';

export const accountTypeEnum = pgEnum('account_type', [
  'checking',
  'savings',
  'credit',
  'investment',
  'loan',
]);

/**
 * Accounts — checking, savings, credit, investment, loan.
 * The id is a string (we keep the current "acc-<timestamp>" convention so
 * historical data and SimpleFIN-prefixed ids survive).
 *
 * Pay-down fields (interestRate, minPayment, plannedPayment,
 * includeInPaydown) are only meaningful for `credit` and `loan` types but
 * live on the row for simplicity — the calculator ignores them for
 * non-debt accounts.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    type: accountTypeEnum('type').notNull(),
    balance: doublePrecision('balance').notNull().default(0),
    institution: text('institution'),
    // Annual percentage rate as a decimal (0.18 = 18% APR). 0 is valid
    // (e.g. 0% intro APR or paid-in-full credit card).
    interestRate: doublePrecision('interest_rate').notNull().default(0),
    // Minimum monthly principal+interest payment the issuer requires.
    // Do NOT include tax/insurance — those aren't part of pay-down math.
    minPayment: doublePrecision('min_payment').notNull().default(0),
    // User-chosen "I plan to pay this much" override. If zero, the
    // calculator uses minPayment. Negative balances (paid off) get
    // ignored entirely.
    plannedPayment: doublePrecision('planned_payment').notNull().default(0),
    // Per-account opt-out. A "credit card you pay in full each month"
    // would set this to false to exclude it from the projection.
    includeInPaydown: boolean('include_in_paydown').notNull().default(true),
    // User-set "hide this account" flag. Hidden accounts are excluded
    // from the accounts list, dashboard net-worth, transactions, budget,
    // and paydown views. For SimpleFIN-synced accounts the flag also
    // gates the sync: if the row exists with hidden=true, the next sync
    // skips the upsert AND its transactions, so the account won't come
    // back. Unhide to resume syncing.
    hidden: boolean('hidden').notNull().default(false),
    // User-set display alias. NULL means "use the canonical name".
    // SimpleFIN sync never overwrites this — `upsertAccount` only
    // touches name/type/balance/institution on conflict — so the alias
    // survives every re-sync. The Transactions page resolves the alias
    // on read, so renaming flows through to historical transactions
    // without rewriting the ledger.
    alias: text('alias'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_accounts_user').on(t.userId),
  }),
);

export type AccountRow = typeof accounts.$inferSelect;
export type NewAccountRow = typeof accounts.$inferInsert;
