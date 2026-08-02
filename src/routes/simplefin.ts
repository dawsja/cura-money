/**
 * /api/simplefin — claim a setup token, sync accounts/transactions, set
 * the per-user enabled-account list.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import {
  claimSetupToken,
  syncSimpleFinToDatabase,
  getEnabledSimpleFinAccountIds,
  setEnabledSimpleFinAccountIds,
} from '@/lib/simplefin';
import { setSetting, getSetting } from '@/db/queries';
import { userId } from '@/lib/tenant';
import { badRequest, safe } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const simplefinRoutes = new Hono();

const ClaimSchema = z.object({ setupToken: z.string().min(8) });
const SyncSchema = z.object({
  selectedAccountIds: z.array(z.string()).optional(),
});

simplefinRoutes.get(
  '/status',
  safe(async (c) => {
    const uid = userId(c);
    const accessUrl = await getSetting(uid, 'simplefin_access_url');
    const lastSync = await getSetting(uid, 'simplefin_last_sync');
    const enabled = await getEnabledSimpleFinAccountIds(uid);
    return c.json({
      connected: !!accessUrl,
      lastSync,
      enabledAccountIds: enabled,
    });
  }),
);

simplefinRoutes.post(
  '/claim',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ClaimSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    try {
      const accessUrl = await claimSetupToken(parsed.data.setupToken);
      await setSetting(userId(c), 'simplefin_access_url', accessUrl);
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.warn({ err: message }, 'simplefin claim failed');
      return badRequest(c, message, 'claim_failed');
    }
  }),
);

simplefinRoutes.delete(
  '/disconnect',
  safe(async (c) => {
    const uid = userId(c);
    await setSetting(uid, 'simplefin_access_url', '');
    await setSetting(uid, 'simplefin_enabled_account_ids', '[]');
    return c.json({ ok: true });
  }),
);

simplefinRoutes.post(
  '/sync',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = SyncSchema.safeParse(body ?? {});
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    try {
      const result = await syncSimpleFinToDatabase(userId(c), parsed.data.selectedAccountIds);
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.warn({ err: message }, 'simplefin sync failed');
      return badRequest(c, message, 'sync_failed');
    }
  }),
);

simplefinRoutes.put(
  '/enabled-accounts',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const ids = (body as { ids?: unknown } | null)?.ids;
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) {
      return badRequest(c, 'ids must be string[]');
    }
    await setEnabledSimpleFinAccountIds(userId(c), ids as string[]);
    return c.json({ ok: true });
  }),
);
