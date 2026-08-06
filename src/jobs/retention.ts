/**
 * Opt-in retention cleanup. RETENTION_DAYS=0 (the default) preserves all
 * history. Positive values delete transactions and budget overrides older
 * than the computed rolling cutoff.
 *
 * `monthly_budgets` is purged by yearMonth string comparison. Both deletes
 * commit atomically.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { logger } from '@/lib/logger';
import { retentionPolicy } from '@/lib/retention';

export interface RetentionReport {
  enabled: boolean;
  days: number;
  cutoffDate: string | null;
  cutoffYearMonth: string | null;
  transactionsDeleted: number;
  budgetsDeleted: number;
}

interface RetentionCounts extends Record<string, unknown> {
  transactionsDeleted: number;
  budgetsDeleted: number;
}

/**
 * Purge all matching rows in one transaction. Direct date predicates include
 * rows whose user has already been removed and avoid loading every deleted row
 * or doing separate pre-count scans.
 */
export async function runRetention(now: Date = new Date()): Promise<RetentionReport> {
  const policy = retentionPolicy(now);

  const report: RetentionReport = {
    ...policy,
    transactionsDeleted: 0,
    budgetsDeleted: 0,
  };
  if (!policy.enabled || !policy.cutoffDate || !policy.cutoffYearMonth) {
    logger.info({ report }, 'retention: disabled');
    return report;
  }

  const rows = await db.transaction(async (tx) => tx.execute<RetentionCounts>(sql`
    WITH carried_budgets AS (
      INSERT INTO monthly_budgets (user_id, sub_category_id, year_month, planned, updated_at)
      SELECT DISTINCT ON (user_id, sub_category_id)
        user_id, sub_category_id, ${policy.cutoffYearMonth}, planned, NOW()
      FROM monthly_budgets
      WHERE year_month < ${policy.cutoffYearMonth}
      ORDER BY user_id, sub_category_id, year_month DESC
      ON CONFLICT (user_id, sub_category_id, year_month) DO NOTHING
      RETURNING 1
    ), deleted_transactions AS (
      DELETE FROM transactions WHERE date < ${policy.cutoffDate}::date RETURNING 1
    ), deleted_budgets AS (
      DELETE FROM monthly_budgets WHERE year_month < ${policy.cutoffYearMonth} RETURNING 1
    )
    SELECT
      (SELECT count(*)::int FROM deleted_transactions) AS "transactionsDeleted",
      (SELECT count(*)::int FROM deleted_budgets) AS "budgetsDeleted"
    FROM (SELECT count(*) FROM carried_budgets) AS carried
  `));
  const deleted = rows[0];
  report.transactionsDeleted = deleted?.transactionsDeleted ?? 0;
  report.budgetsDeleted = deleted?.budgetsDeleted ?? 0;

  logger.info({ report }, 'retention: purged');
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
