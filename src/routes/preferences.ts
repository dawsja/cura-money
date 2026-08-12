/**
 * /api/preferences — per-user UI preferences that aren't tied to a
 * dedicated table. Currently just the display currency, stored in the
 * settings KV under `display_currency`.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { getSetting, setSetting } from '@/db/queries';
import { userId } from '@/lib/tenant';
import { badRequest, safe } from '@/lib/errors';
import { DISPLAY_CURRENCY_KEY, isSupportedCurrency, resolveCurrency } from '@/lib/currency';

export const preferenceRoutes = new Hono();

preferenceRoutes.get(
  '/',
  safe(async (c) => {
    const raw = await getSetting(userId(c), DISPLAY_CURRENCY_KEY);
    return c.json({ currency: resolveCurrency(raw) });
  }),
);

const preferencesSchema = z.object({ currency: z.string() });

preferenceRoutes.put(
  '/',
  safe(async (c) => {
    const parsed = preferencesSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || !isSupportedCurrency(parsed.data.currency)) {
      return badRequest(c, 'unsupported currency');
    }
    await setSetting(userId(c), DISPLAY_CURRENCY_KEY, parsed.data.currency);
    return c.json({ currency: parsed.data.currency });
  }),
);
