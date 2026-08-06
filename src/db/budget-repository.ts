import { and, desc, eq, lte } from 'drizzle-orm';
import { db } from '@/db/client';
import { monthlyBudgets } from '@/db/schema/monthly_budgets';

/** Fetch the latest override per sub-category for months through `upTo`. */
export async function latestBudgetsUpTo(userId: string, upTo: string): Promise<Map<string, number>> {
  const rows = await db
    .select({
      subCategoryId: monthlyBudgets.subCategoryId,
      planned: monthlyBudgets.planned,
    })
    .from(monthlyBudgets)
    .where(and(eq(monthlyBudgets.userId, userId), lte(monthlyBudgets.yearMonth, upTo)))
    .orderBy(desc(monthlyBudgets.yearMonth));

  const latest = new Map<string, number>();
  for (const row of rows) {
    if (!latest.has(row.subCategoryId)) latest.set(row.subCategoryId, row.planned);
  }
  return latest;
}
