import { foreignKey, index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { transactions } from './transactions';

/** Provider identities retained when a pending transaction becomes posted under a new ID. */
export const simpleFinTransactionAliases = pgTable(
  'simplefin_transaction_aliases',
  {
    userId: text('user_id').notNull(),
    externalId: text('external_id').notNull(),
    transactionId: text('transaction_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    primaryKey: primaryKey({ columns: [t.userId, t.externalId] }),
    transactionIdx: index('idx_simplefin_transaction_aliases_transaction').on(t.userId, t.transactionId),
    tenantTransactionFk: foreignKey({
      columns: [t.userId, t.transactionId],
      foreignColumns: [transactions.userId, transactions.id],
      name: 'simplefin_transaction_aliases_user_transaction_fk',
    }).onDelete('cascade'),
  }),
);
