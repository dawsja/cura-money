/**
 * Budget roll-forward: at the start of each new month, seed the upcoming
 * month's planned amounts from the most recent override in `monthly_budgets`
 * for each user. If a month is already populated, skip it (idempotent).
 */
import { db } from '@/db/client';
import { user as authUser } from '@/db/schema/auth';
import { monthlyBudgets } from '@/db/schema/monthly_budgets';
import { latestBudgetsUpTo } from '@/routes/budget';
import { logger } from '@/lib/logger';

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function previousYearMonth(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface RollforwardReport {
  usersProcessed: number;
  rowsInserted: number;
}

export async function runBudgetRollforward(): Promise<RollforwardReport> {
  const target = currentYearMonth();
  const upTo = previousYearMonth();
  const report: RollforwardReport = { usersProcessed: 0, rowsInserted: 0 };

  const users = await db.select({ id: authUser.id }).from(authUser);
  for (const u of users) {
    report.usersProcessed++;
    const latest = await latestBudgetsUpTo(u.id, upTo);
    if (latest.size === 0) continue;

    for (const [subCategoryId, planned] of latest) {
      // Insert with ON CONFLICT DO NOTHING — never overwrite a manual override.
      const inserted = await db
        .insert(monthlyBudgets)
        .values({ userId: u.id, subCategoryId, yearMonth: target, planned, updatedAt: new Date() })
        .onConflictDoNothing({
          target: [monthlyBudgets.userId, monthlyBudgets.subCategoryId, monthlyBudgets.yearMonth],
        })
        .returning({ subCategoryId: monthlyBudgets.subCategoryId });
      if (inserted.length > 0) report.rowsInserted++;
    }
  }
  logger.info({ report, target }, 'budget-rollforward: done');
  return report;
}

if (import.meta.main) {
  runBudgetRollforward()
    .then((r) => {
      logger.info({ r }, 'budget-rollforward: result');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err }, 'budget-rollforward: failed');
      process.exit(1);
    });
}

