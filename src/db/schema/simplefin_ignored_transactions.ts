import { pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth';

/**
 * Provider identities the user has deleted. SimpleFIN sync skips these
 * so a later poll cannot recreate a transaction the user removed.
 */
export const simpleFinIgnoredTransactions = pgTable(
  'simplefin_ignored_transactions',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    primaryKey: primaryKey({ columns: [t.userId, t.externalId] }),
  }),
);
