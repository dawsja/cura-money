/**
 * /api/budget — read + set monthly planned budgets.
 *
 * Carry-forward rule (from the original app): updating the planned budget
 * for month M updates M and removes all overrides for months > M. Reading
 * month M returns the most recent override with yearMonth <= M, so a value
 * set in July automatically applies to August, September, … until the user
 * sets a new override. This keeps the table small (only explicit edits are
 * stored) while letting the user push a single change forward through time
 * and preview future months before any roll-forward cron has run.
 *
 * The "budget-rollforward" cron in src/jobs/budget-rollforward.ts is kept
 * as a physical-row seeder for any future feature that expects rows to
 * exist for every month — GET does not depend on it.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '@/db/client';
import { monthlyBudgets } from '@/db/schema/monthly_budgets';
import { latestBudgetsUpTo } from '@/db/budget-repository';
import { userId, routeParam } from '@/lib/tenant';
import { badRequest, safe } from '@/lib/errors';
import { subCategoryExists } from '@/db/queries';
import { moneyAmount } from '@/lib/money';

export const budgetRoutes = new Hono();
const YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'yearMonth must be YYYY-MM');

const SetSchema = z.object({
  subCategoryId: z.string().min(1),
  yearMonth: YearMonth,
  planned: moneyAmount,
});

budgetRoutes.get(
  '/:yearMonth',
  safe(async (c) => {
    const ym = routeParam(c, 'yearMonth');
    if (!YearMonth.safeParse(ym).success) return badRequest(c, 'yearMonth must be YYYY-MM');
    const latest = await latestBudgetsUpTo(userId(c), ym);
    return c.json(
      Array.from(latest, ([subCategoryId, planned]) => ({
        subCategoryId,
        planned,
      })),
    );
  }),
);

budgetRoutes.post(
  '/',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = SetSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    const { subCategoryId, yearMonth, planned } = parsed.data;
    const uid = userId(c);
    if (!(await subCategoryExists(uid, subCategoryId)))
      return badRequest(c, 'subCategoryId must belong to the current user');

    await db.transaction(async (tx) => {
      // Remove future overrides (> yearMonth) for this subCategory so the
      // new planned amount carries forward to M+1, M+2, ...
      await tx
        .delete(monthlyBudgets)
        .where(
          and(
            eq(monthlyBudgets.userId, uid),
            eq(monthlyBudgets.subCategoryId, subCategoryId),
            gt(monthlyBudgets.yearMonth, yearMonth),
          ),
        );
      // Upsert this month.
      await tx
        .insert(monthlyBudgets)
        .values({
          userId: uid,
          subCategoryId,
          yearMonth,
          planned,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [monthlyBudgets.userId, monthlyBudgets.subCategoryId, monthlyBudgets.yearMonth],
          set: { planned, updatedAt: new Date() },
        });
    });
    return c.json({ ok: true });
  }),
);
