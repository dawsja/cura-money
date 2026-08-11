/**
 * /api/reports — read-only pre-aggregated series for the Reports page.
 *
 * Each endpoint takes a `range` (1m / 3m / 6m / 1y / all) or a `month`
 * (YYYY-MM) and returns the shape the chart needs. The server is the
 * source of truth for the math so the client just renders. All
 * cash-ledger responses exclude transfers where applicable and activity from
 * known hidden, investment, or uncategorized accounts. Activity whose account
 * was deleted remains historical ledger data.
 *
 * Range tokens are resolved relative to "today" (UTC) so the chart
 * boundaries are stable across timezones. When retention is enabled, ranges
 * are clamped to the same centrally computed cutoff used by cleanup.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import {
  getCashFlowSeries,
  getNetWorthSeries,
  getSpendingByCategory,
  getTopMerchants,
  getBudgetVsActual,
  getSetting,
  setSetting,
  getSpendingCategoryTrends,
  getSpendingPace,
  getEarliestReportDate,
} from '@/db/queries';
import { userId } from '@/lib/tenant';
import { badRequest, safe } from '@/lib/errors';
import { retentionPolicy } from '@/lib/retention';

export const reportRoutes = new Hono();

const Range = z.enum(['1m', '3m', '6m', '1y', 'all']);
const MonthParam = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM');
const REPORT_LAYOUT_KEY = 'report_widget_order';
const ReportWidgetId = z.enum([
  'summary',
  'cash-flow',
  'spending-trends',
  'spending-pace',
  'net-worth',
  'spending-by-category',
  'top-merchants',
]);
const DEFAULT_REPORT_ORDER = ReportWidgetId.options;
const ReportLayout = z
  .object({
    order: z.array(ReportWidgetId).length(DEFAULT_REPORT_ORDER.length),
    hidden: z.array(ReportWidgetId).max(DEFAULT_REPORT_ORDER.length),
  })
  .refine(
    ({ order, hidden }) =>
      new Set(order).size === DEFAULT_REPORT_ORDER.length && new Set(hidden).size === hidden.length,
    'layout must contain every report widget exactly once without duplicate hidden widgets',
  );

function parseStoredReportLayout(raw: string | null): z.infer<typeof ReportLayout> {
  if (!raw) return { order: [...DEFAULT_REPORT_ORDER], hidden: [] };
  try {
    const json: unknown = JSON.parse(raw);
    const stored = Array.isArray(json)
      ? { order: z.array(z.string()).parse(json), hidden: [] }
      : z
          .object({
            order: z.array(z.string()),
            hidden: z.array(z.string()).optional(),
          })
          .parse(json);
    const validIds = new Set<string>(DEFAULT_REPORT_ORDER);
    const order = [...new Set(stored.order.filter((id) => validIds.has(id)))] as z.infer<typeof ReportWidgetId>[];
    for (const id of DEFAULT_REPORT_ORDER) if (!order.includes(id)) order.push(id);
    const hidden = [...new Set((stored.hidden ?? []).filter((id) => validIds.has(id)))] as z.infer<
      typeof ReportWidgetId
    >[];
    return { order, hidden };
  } catch {
    return { order: [...DEFAULT_REPORT_ORDER], hidden: [] };
  }
}

/**
 * Inclusive [fromDate, toDate] in 'YYYY-MM-DD' for the given range
 * token. `toDate` is end-of-today’s month for the reporting window so
 * that "1m" includes the full in-progress month. `all` starts at the user's
 * earliest accepted transaction. Every range is clamped when retention is on.
 */
async function resolveRange(
  user: string,
  range: z.infer<typeof Range>,
  now: Date = new Date(),
): Promise<{ fromDate: string; toDate: string }> {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const retentionFloor = retentionPolicy(now).cutoffDate;

  // toDate = last day of the current month (inclusive).
  const endOfThisMonth = new Date(Date.UTC(y, m + 1, 0));
  const toDate = endOfThisMonth.toISOString().slice(0, 10);

  let startMonthOffset: number;
  switch (range) {
    case '1m':
      startMonthOffset = 0;
      break;
    case '3m':
      startMonthOffset = 2;
      break;
    case '6m':
      startMonthOffset = 5;
      break;
    case '1y':
      startMonthOffset = 11;
      break;
    case 'all':
      startMonthOffset = 0;
      break;
  }

  const start = new Date(Date.UTC(y, m - startMonthOffset, 1));
  let fromDate = range === 'all'
    ? (await getEarliestReportDate(user)) ?? start.toISOString().slice(0, 10)
    : start.toISOString().slice(0, 10);
  if (retentionFloor && fromDate < retentionFloor) fromDate = retentionFloor;
  return { fromDate, toDate };
}

reportRoutes.get(
  '/layout',
  safe(async (c) => {
    const raw = await getSetting(userId(c), REPORT_LAYOUT_KEY);
    return c.json(parseStoredReportLayout(raw));
  }),
);

reportRoutes.put(
  '/layout',
  safe(async (c) => {
    const parsed = ReportLayout.safeParse(await c.req.json());
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid report layout');

    await setSetting(userId(c), REPORT_LAYOUT_KEY, JSON.stringify(parsed.data));
    return c.json(parsed.data);
  }),
);

reportRoutes.get(
  '/cash-flow',
  safe(async (c) => {
    const parsed = Range.safeParse(c.req.query('range') ?? '6m');
    if (!parsed.success) return badRequest(c, 'range must be one of 1m, 3m, 6m, 1y, all');
    const uid = userId(c);
    const { fromDate, toDate } = await resolveRange(uid, parsed.data);
    return c.json(await getCashFlowSeries(uid, fromDate, toDate));
  }),
);

reportRoutes.get(
  '/net-worth',
  safe(async (c) => {
    const parsed = Range.safeParse(c.req.query('range') ?? '6m');
    if (!parsed.success) return badRequest(c, 'range must be one of 1m, 3m, 6m, 1y, all');
    const uid = userId(c);
    const { fromDate, toDate } = await resolveRange(uid, parsed.data);
    return c.json(await getNetWorthSeries(uid, fromDate, toDate));
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
  '/spending-trends',
  safe(async (c) => {
    const parsed = Range.safeParse(c.req.query('range') ?? '6m');
    if (!parsed.success) return badRequest(c, 'range must be one of 1m, 3m, 6m, 1y, all');
    const uid = userId(c);
    const { fromDate, toDate } = await resolveRange(uid, parsed.data);
    return c.json(await getSpendingCategoryTrends(uid, fromDate, toDate));
  }),
);

reportRoutes.get(
  '/spending-pace',
  safe(async (c) => {
    const month = c.req.query('month');
    if (!month || !MonthParam.safeParse(month).success) {
      return badRequest(c, 'month query param must be YYYY-MM');
    }
    return c.json(await getSpendingPace(userId(c), month));
  }),
);

reportRoutes.get(
  '/top-merchants',
  safe(async (c) => {
    const parsed = Range.safeParse(c.req.query('range') ?? '6m');
    if (!parsed.success) return badRequest(c, 'range must be one of 1m, 3m, 6m, 1y, all');
    const uid = userId(c);
    const { fromDate, toDate } = await resolveRange(uid, parsed.data);
    return c.json(await getTopMerchants(uid, fromDate, toDate));
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
