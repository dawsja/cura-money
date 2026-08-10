/**
 * /api/simplefin — claim a setup token and sync accounts/transactions.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import {
  claimSetupToken,
  publicSimpleFinError,
  sealSimpleFinAccessUrl,
  SimpleFinError,
  syncSimpleFinToDatabase,
} from '@/lib/simplefin';
import { deleteSetting, setSetting, getSetting } from '@/db/queries';
import { userId } from '@/lib/tenant';
import { badRequest, conflict, safe } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';

export const simplefinRoutes = new Hono();

simplefinRoutes.use('*', async (c, next) => {
  if (!env.DEMO_MODE || c.req.method === 'GET') return next();
  return c.json({ error: 'Bank connections are disabled for demo purposes.', code: 'demo_mode' }, 403);
});

const ClaimSchema = z.object({ setupToken: z.string().min(8) });
const SyncSchema = z.object({
  // When true, ignore simplefin_last_sync and re-run the 6-month
  // chunked backfill. Safe to repeat — imports dedupe on external_id.
  fullSync: z.boolean().optional(),
});

function simpleFinFailureResponse(c: import('hono').Context, message: string, code: string): Response {
  if (code === 'rate_limited') return c.json({ error: message, code }, 429);
  if (code === 'timeout') return c.json({ error: message, code }, 504);
  if (['network_error', 'dns_failed', 'api_rejected', 'invalid_response', 'response_too_large'].includes(code)) {
    return c.json({ error: message, code }, 502);
  }
  return badRequest(c, message, code);
}

simplefinRoutes.get(
  '/status',
  safe(async (c) => {
    const uid = userId(c);
    const accessUrl = await getSetting(uid, 'simplefin_access_url');
    const lastSync = await getSetting(uid, 'simplefin_last_sync');
    const lastAttempt = await getSetting(uid, 'simplefin_last_attempt');
    const lastError = await getSetting(uid, 'simplefin_last_error');
    return c.json({
      demoMode: env.DEMO_MODE,
      connected: !!accessUrl,
      lastSync,
      lastAttempt,
      lastError: lastError || null,
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
      const uid = userId(c);
      await setSetting(uid, 'simplefin_access_url', sealSimpleFinAccessUrl(accessUrl));
      // New claim always starts a fresh 6-month backfill on next sync.
      await setSetting(uid, 'simplefin_last_sync', '');
      await deleteSetting(uid, 'simplefin_account_id_map');
      await setSetting(uid, 'simplefin_legacy_account_migration_complete', 'true');
      await deleteSetting(uid, 'simplefin_enabled_account_ids');
      await deleteSetting(uid, 'simplefin_last_error');
      await deleteSetting(uid, 'simplefin_last_attempt');
      return c.json({ ok: true });
    } catch (err) {
      const failure = publicSimpleFinError(err);
      logger.warn({ code: failure.code }, 'simplefin claim failed');
      return simpleFinFailureResponse(c, failure.message, failure.code);
    }
  }),
);

simplefinRoutes.delete(
  '/disconnect',
  safe(async (c) => {
    const uid = userId(c);
    await setSetting(uid, 'simplefin_access_url', '');
    await deleteSetting(uid, 'simplefin_enabled_account_ids');
    await deleteSetting(uid, 'simplefin_account_id_map');
    await setSetting(uid, 'simplefin_last_sync', '');
    await deleteSetting(uid, 'simplefin_last_error');
    await deleteSetting(uid, 'simplefin_last_attempt');
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
      const result = await syncSimpleFinToDatabase(userId(c), {
        fullSync: parsed.data.fullSync === true,
      });
      return c.json(result);
    } catch (err) {
      const failure = publicSimpleFinError(err);
      await setSetting(userId(c), 'simplefin_last_error', failure.message);
      logger.warn({ code: failure.code }, 'simplefin sync failed');
      if (err instanceof SimpleFinError && err.code === 'sync_in_progress') {
        return conflict(c, failure.message, failure.code);
      }
      return simpleFinFailureResponse(c, failure.message, failure.code);
    }
  }),
);
