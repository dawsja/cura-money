/**
 * Retention cleanup. Deletes transactions and budget rows older than
 * the start of the previous calendar year so the DB only keeps the
 * current year + previous year of history.
 *
 * Examples:
 *   - On 2026-03-15 the cutoff is 2025-01-01 → transactions with
 *     date < 2025-01-01 and monthly_budgets with yearMonth < '2025-01'
 *     get deleted.
 *   - On 2026-01-10 (still in the previous-year window) the cutoff is
 *     still 2025-01-01, so all of 2025 is preserved — a user looking
 *     back 6 months on 2026-01-10 still sees Jul-Dec 2025.
 *
 * The job is idempotent (a no-op when nothing matches) and runs both
 * on app boot (so a fresh deploy cleans up immediately) and on a daily
 * cron (so the cutoff advances as the calendar year rolls over).
 *
 * `monthly_budgets` is purged by yearMonth string comparison so the
 * composite PK deletes cleanly; the index is on (user_id, sub_category_id,
 * year_month) so the per-user lookup is cheap.
 */
import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { transactions } from '@/db/schema/transactions';
import { monthlyBudgets } from '@/db/schema/monthly_budgets';
import { user as authUser } from '@/db/schema/auth';
import { logger } from '@/lib/logger';

export interface RetentionReport {
  cutoffDate: string;
  cutoffYearMonth: string;
  transactionsDeleted: number;
  budgetsDeleted: number;
}

/**
 * Returns January 1 of (currentYear - 1) in 'YYYY-MM-DD' form. The
 * retention window is [Jan 1 of previous year, today].
 */
function previousYearCutoff(now: Date = new Date()): string {
  const y = now.getUTCFullYear() - 1;
  return `${y}-01-01`;
}

function previousYearMonthCutoff(now: Date = new Date()): string {
  const y = now.getUTCFullYear() - 1;
  return `${y}-01`;
}

/**
 * Purge old data across every user. We can't do a single DELETE
 * without a WHERE user_id = $1 because retention is per-user data
 * (account/category/transaction rows all carry user_id).
 *
 * Two-pass: collect affected user IDs first so we can log a count
 * before the DELETE actually fires — useful for the "did this even
 * run?" sanity check.
 */
export async function runRetention(now: Date = new Date()): Promise<RetentionReport> {
  const cutoffDate = previousYearCutoff(now);
  const cutoffYearMonth = previousYearMonthCutoff(now);

  const report: RetentionReport = {
    cutoffDate,
    cutoffYearMonth,
    transactionsDeleted: 0,
    budgetsDeleted: 0,
  };

  // Total counts before delete — pure SELECT, cheap.
  const txCountRows = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(transactions)
    .where(lt(transactions.date, cutoffDate));
  const txCount = txCountRows[0]?.count ?? 0;

  const bdCountRows = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(monthlyBudgets)
    .where(lt(monthlyBudgets.yearMonth, cutoffYearMonth));
  const bdCount = bdCountRows[0]?.count ?? 0;

  if (txCount === 0 && bdCount === 0) {
    logger.info({ cutoffDate, cutoffYearMonth }, 'retention: nothing to purge');
    return report;
  }

  // Per-user delete so we don't accidentally scan the whole table.
  // CASCADE on the FK side wouldn't help here — neither table has a
  // FK relationship to `user.id`; the column is just an indexed
  // identifier. Indexed by user_id via idx_transactions_user and the
  // PK on monthly_budgets includes user_id, so the WHERE is cheap.
  const users = await db.select({ id: authUser.id }).from(authUser);
  for (const u of users) {
    const txRes = await db
      .delete(transactions)
      .where(and(eq(transactions.userId, u.id), lt(transactions.date, cutoffDate)))
      .returning({ id: transactions.id });
    report.transactionsDeleted += txRes.length;

    const bdRes = await db
      .delete(monthlyBudgets)
      .where(and(eq(monthlyBudgets.userId, u.id), lt(monthlyBudgets.yearMonth, cutoffYearMonth)))
      .returning({ subCategoryId: monthlyBudgets.subCategoryId });
    report.budgetsDeleted += bdRes.length;
  }

  logger.info({ report, txCount, bdCount }, 'retention: purged');
  return report;
}

if (import.meta.main) {
  runRetention()
    .then((r) => {
      logger.info({ r }, 'retention: result');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err }, 'retention: failed');
      process.exit(1);
    });
}
