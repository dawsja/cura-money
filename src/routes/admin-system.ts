import { Hono } from 'hono';
import { z } from 'zod';
import { checkForContainerUpdate } from '@/lib/container-update';
import { badRequest, safe } from '@/lib/errors';
import { requireAdmin } from '@/lib/tenant';

export const adminSystemRoutes = new Hono();

const updateQuerySchema = z.object({
  refresh: z.literal('true').optional(),
});

adminSystemRoutes.get(
  '/update',
  safe(async (c) => {
    requireAdmin(c);
    const query = updateQuerySchema.safeParse(c.req.query());
    if (!query.success) return badRequest(c, 'refresh must be "true" when provided');
    return c.json(await checkForContainerUpdate(query.data.refresh === 'true'));
  }),
);
