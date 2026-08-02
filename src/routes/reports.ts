/**
 * /api/reports — read-only pre-aggregated series for the Reports page.
 *
 * Each endpoint takes a `range` (1m / 3m / 6m / 1y / all) or a `month`
 * (YYYY-MM) and returns the shape the chart needs. The server is the
 * source of truth for the math so the client just renders. All
 * responses exclude transfers and hidden-account transactions (Hard
 * Rule #14).
 *
 * Range tokens are resolved relative to "today" (UTC) so the chart
 * boundaries are stable across timezones. The retention sweep keeps
 * the data window at most current-year + previous-year, so a 1y range
 * in early January spans Dec of the previous year to now.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import {
  getCashFlowSeries,
  getNetWorthSeries,
  getSpendingByCategory,
  getTopMerchants,
  getBudgetVsActual,
} from '@/db/queries';
import { userId } from '@/lib/tenant';
import { badRequest, safe } from '@/lib/errors';

export const reportRoutes = new Hono();

const Range = z.enum(['1m', '3m', '6m', '1y', 'all']);
const MonthParam = z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM');

/**
 * Inclusive [fromDate, toDate] in 'YYYY-MM-DD' for the given range
 * token. `toDate` is end-of-today’s month for the reporting window so
 * that "1m" includes the full in-progress month. `all` is bounded by
 * the retention policy (current year + previous year) — the server
 * caps the lower bound at 1 Jan of (currentYear - 1) so the chart
 * can't pull data outside the retention window.
 */
function resolveRange(range: z.infer<typeof Range>, now: Date = new Date()): { fromDate: string; toDate: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const retentionFloor = `${y - 1}-01-01`;

  // toDate = last day of the current month (inclusive).
  const endOfThisMonth = new Date(Date.UTC(y, m + 1, 0));
  const toDate = endOfThisMonth.toISOString().slice(0, 10);

  let startMonthOffset: number;
  switch (range) {
    case '1m': startMonthOffset = 0; break;
    case '3m': startMonthOffset = 2; break;
    case '6m': startMonthOffset = 5; break;
    case '1y': startMonthOffset = 11; break;
    case 'all': startMonthOffset = 24; break; // 2 years back is the ceiling; the loop clamps to retention floor
  }

  const start = new Date(Date.UTC(y, m - startMonthOffset, 1));
  let fromDate = start.toISOString().slice(0, 10);
  if (fromDate < retentionFloor) fromDate = retentionFloor;
  return { fromDate, toDate };
}

reportRoutes.get(
  '/cash-flow',
  safe(async (c) => {
    const parsed = Range.safeParse(c.req.query('range') ?? '6m');
    if (!parsed.success) return badRequest(c, 'range must be one of 1m, 3m, 6m, 1y, all');
    const { fromDate, toDate } = resolveRange(parsed.data);
    return c.json(await getCashFlowSeries(userId(c), fromDate, toDate));
  }),
);

reportRoutes.get(
  '/net-worth',
  safe(async (c) => {
    const parsed = Range.safeParse(c.req.query('range') ?? '6m');
    if (!parsed.success) return badRequest(c, 'range must be one of 1m, 3m, 6m, 1y, all');
    const { fromDate, toDate } = resolveRange(parsed.data);
    return c.json(await getNetWorthSeries(userId(c), fromDate, toDate));
  }),
);

reportRoutes.get(
  '/spending-by-category',
  safe(async (c) => {
    const month = c.req.query('month');
    if (!month || !MonthParam.safeParse(month).success) {
      return badRequest(c, 'month query param must be YYYY-MM');
    }
    return c.json(await getSpendingByCategory(userId(c), month));
  }),
);

reportRoutes.get(
  '/top-merchants',
  safe(async (c) => {
    const parsed = Range.safeParse(c.req.query('range') ?? '6m');
    if (!parsed.success) return badRequest(c, 'range must be one of 1m, 3m, 6m, 1y, all');
    const { fromDate, toDate } = resolveRange(parsed.data);
    return c.json(await getTopMerchants(userId(c), fromDate, toDate));
  }),
);

reportRoutes.get(
  '/budget-vs-actual',
  safe(async (c) => {
    const month = c.req.query('month');
    if (!month || !MonthParam.safeParse(month).success) {
      return badRequest(c, 'month query param must be YYYY-MM');
    }
    return c.json(await getBudgetVsActual(userId(c), month));
  }),
);
