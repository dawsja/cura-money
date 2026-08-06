import { Hono } from 'hono';
import { z } from 'zod';
import { getSetting, setSetting } from '@/db/queries';
import { userId } from '@/lib/tenant';
import { badRequest, safe } from '@/lib/errors';

export const dashboardRoutes = new Hono();

const DASHBOARD_LAYOUT_KEY = 'dashboard_widget_order';
const WidgetId = z.enum(['summary', 'assets-liabilities', 'accounts', 'recent-transactions']);
const DEFAULT_ORDER = WidgetId.options;
const Layout = z.object({
  order: z.array(WidgetId).length(DEFAULT_ORDER.length),
  hidden: z.array(WidgetId).max(DEFAULT_ORDER.length),
}).refine(
  ({ order, hidden }) => new Set(order).size === DEFAULT_ORDER.length && new Set(hidden).size === hidden.length,
  'layout must contain every dashboard widget exactly once without duplicate hidden widgets',
);

function parseStoredLayout(raw: string | null): z.infer<typeof Layout> {
  if (!raw) return { order: [...DEFAULT_ORDER], hidden: [] };
  try {
    const json: unknown = JSON.parse(raw);
    const stored = Array.isArray(json)
      ? { order: z.array(z.string()).parse(json), hidden: [] }
      : z.object({ order: z.array(z.string()), hidden: z.array(z.string()).optional() }).parse(json);
    const validIds = new Set<string>(DEFAULT_ORDER);
    const order = [...new Set(stored.order.filter((id) => validIds.has(id)))] as z.infer<typeof WidgetId>[];
    for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
    const hidden = [...new Set((stored.hidden ?? []).filter((id) => validIds.has(id)))] as z.infer<typeof WidgetId>[];
    return { order, hidden };
  } catch {
    return { order: [...DEFAULT_ORDER], hidden: [] };
  }
}

dashboardRoutes.get(
  '/layout',
  safe(async (c) => {
    const raw = await getSetting(userId(c), DASHBOARD_LAYOUT_KEY);
    return c.json(parseStoredLayout(raw));
  }),
);

dashboardRoutes.put(
  '/layout',
  safe(async (c) => {
    const parsed = Layout.safeParse(await c.req.json());
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid dashboard layout');

    await setSetting(userId(c), DASHBOARD_LAYOUT_KEY, JSON.stringify(parsed.data));
    return c.json(parsed.data);
  }),
);
