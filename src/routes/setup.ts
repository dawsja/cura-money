/**
 * First-run setup wizard endpoints. Mounted at /api/setup/* and is the ONLY
 * set of routes callable while `bootstrap_completed = false` (see guard.ts).
 *
 *   GET  /api/setup/status              — public, no auth
 *   POST /api/setup/bootstrap-admin     — public (gated by token)
 *   POST /api/setup/configure-oidc      — public (only after admin exists)
 *   POST /api/setup/test-oidc           — public (used by the wizard's final step)
 *   POST /api/setup/complete            — public (mark wizard done)
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  status as setupStatus,
  bootstrapAdmin,
  configureOidc,
  markBootstrapComplete,
} from '@/auth/setup';
import { invalidateSetupCache } from '@/lib/guard';
import { db } from '@/db/client';
import { user } from '@/db/schema/auth';
import { badRequest, conflict, safe, serverError } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const setupRoutes = new Hono();

const BootstrapAdminSchema = z.object({
  token: z.string().min(8),
  email: z.string().email(),
  password: z.string().min(12).max(256),
  name: z.string().min(1).max(120),
});

const ConfigureOidcSchema = z.object({
  providerId: z.string().min(1).max(64),
  discoveryUrl: z.string().url(),
  clientId: z.string().min(1).max(256),
  clientSecret: z.string().min(1).max(1024),
  scopes: z.array(z.string()).optional(),
});

setupRoutes.get(
  '/status',
  safe(async (c) => c.json(await setupStatus())),
);

setupRoutes.post(
  '/bootstrap-admin',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = BootstrapAdminSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    try {
      const result = await bootstrapAdmin(parsed.data);
      invalidateSetupCache();
      return c.json({ ok: true, userId: result.userId });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      if (message === 'invalid_or_expired_bootstrap_token') {
        return badRequest(c, 'Invalid or expired bootstrap token', 'invalid_token');
      }
      if (message === 'admin_already_exists') {
        return conflict(c, 'An admin already exists; sign in instead.', 'admin_exists');
      }
      if (message === 'serialization_failure_retry') {
        return conflict(c, 'Concurrent bootstrap attempt; please retry.', 'retry');
      }
      logger.error({ err }, 'bootstrap-admin failed');
      return serverError(c);
    }
  }),
);

setupRoutes.post(
  '/configure-oidc',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ConfigureOidcSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    try {
      const result = await configureOidc(parsed.data);
      invalidateSetupCache();
      return c.json({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      if (message.startsWith('discovery_doc_unreachable_')) {
        return badRequest(c, `OIDC discovery doc unreachable: ${message}`, 'discovery_unreachable');
      }
      if (message === 'discovery_doc_missing_endpoints') {
        return badRequest(c, 'Discovery doc missing authorization_endpoint or token_endpoint', 'invalid_discovery');
      }
      logger.error({ err }, 'configure-oidc failed');
      return serverError(c);
    }
  }),
);

setupRoutes.post(
  '/test-oidc',
  safe(async (c) => {
    // Lightweight sanity: confirm an admin exists and an OIDC provider row is set.
    const admins = await db.select({ id: user.id }).from(user).where(eq(user.role, 'admin')).limit(1);
    if (admins.length === 0) {
      return badRequest(c, 'No admin exists; complete the admin step first.', 'no_admin');
    }
    const s = await setupStatus();
    if (!s.oidcConfigured) {
      return badRequest(c, 'OIDC not yet configured.', 'oidc_not_configured');
    }
    return c.json({ ok: true });
  }),
);

setupRoutes.post(
  '/complete',
  safe(async (c) => {
    // OIDC is no longer required — the wizard's "Skip for now" button lets
    // the first admin sign in with email/password and add a provider later
    // from /admin/settings. Only the admin-existence check remains.
    const admins = await db.select({ id: user.id }).from(user).where(eq(user.role, 'admin')).limit(1);
    if (admins.length === 0) {
      return badRequest(c, 'At least one admin must exist before completing setup.', 'admin_required');
    }
    try {
      await markBootstrapComplete();
      invalidateSetupCache();
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof Error && /serialization|could not serialize/.test(err.message)) {
        return conflict(c, 'Concurrent completion attempt; please retry.', 'retry');
      }
      logger.error({ err }, 'complete-setup failed');
      return serverError(c);
    }
  }),
);

