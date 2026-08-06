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
import { badRequest, conflict, forbidden, safe, serverError, unauthorized } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getAuth } from '@/auth';
import { verifyBootstrapToken } from '@/auth/setup';
import { assertSecureOidcConfiguration } from '@/lib/oidc-url';
import { db } from '@/db/client';
import { user } from '@/db/schema/auth';
import { checkSetupRateLimit } from '@/lib/setup-rate-limit';

export const setupRoutes = new Hono();

const BootstrapAdminSchema = z.object({
  token: z.string().min(8),
  email: z.string().email(),
  password: z.string().min(12).max(256),
  name: z.string().min(1).max(120),
});

const ConfigureOidcSchema = z.object({
  token: z.string().min(8).optional(),
  providerId: z.string().min(1).max(64),
  discoveryUrl: z.string().url(),
  clientId: z.string().min(1).max(256),
  clientSecret: z.string().min(1).max(1024),
  scopes: z.array(z.string()).optional(),
});

const SetupMutationSchema = z.object({ token: z.string().min(8).optional() });

function enforceSetupRateLimit(c: Parameters<typeof badRequest>[0]): Response | null {
  const result = checkSetupRateLimit(c.req.raw);
  if (result.allowed) return null;
  c.header('retry-after', String(result.retryAfter));
  return c.json({ error: 'Too many setup attempts; try again later.', code: 'rate_limited' }, 429);
}

async function authorizeSetupMutation(request: Request, token?: string): Promise<'token' | 'admin' | null> {
  if (token && await verifyBootstrapToken(token)) return 'token';
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user?.id) return null;
  const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, session.user.id)).limit(1);
  return row?.role === 'admin' ? 'admin' : null;
}

setupRoutes.get(
  '/status',
  safe(async (c) => c.json(await setupStatus())),
);

setupRoutes.post(
  '/bootstrap-admin',
  safe(async (c) => {
    const limited = enforceSetupRateLimit(c);
    if (limited) return limited;
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
    if ((await setupStatus()).bootstrapCompleted) return forbidden(c, 'setup is already complete');
    const limited = enforceSetupRateLimit(c);
    if (limited) return limited;
    const body = await c.req.json().catch(() => null);
    const parsed = ConfigureOidcSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    if (!await authorizeSetupMutation(c.req.raw, parsed.data.token)) return unauthorized(c);
    try {
      assertSecureOidcConfiguration(c.req.raw);
      const { token: _token, ...provider } = parsed.data;
      const result = await configureOidc(provider);
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
      if (message.startsWith('discovery_') || /^(authorization_endpoint|token_endpoint|userinfo_endpoint|jwks_uri)_/.test(message)) {
        return badRequest(c, 'OIDC discovery and endpoint URLs must use HTTPS and resolve only to public addresses.', 'invalid_discovery');
      }
      if (message.endsWith('_https_required') || message.endsWith('_invalid_url')) {
        return badRequest(c, 'OIDC discovery and callback/base URLs must use HTTPS. HTTP is allowed only for localhost during development.', 'https_required');
      }
      logger.error({ err }, 'configure-oidc failed');
      return serverError(c);
    }
  }),
);

setupRoutes.post(
  '/test-oidc',
  safe(async (c) => {
    if ((await setupStatus()).bootstrapCompleted) return forbidden(c, 'setup is already complete');
    const limited = enforceSetupRateLimit(c);
    if (limited) return limited;
    const body = await c.req.json().catch(() => ({}));
    const parsed = SetupMutationSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    if (!await authorizeSetupMutation(c.req.raw, parsed.data.token)) return unauthorized(c);
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
    if ((await setupStatus()).bootstrapCompleted) return forbidden(c, 'setup is already complete');
    const limited = enforceSetupRateLimit(c);
    if (limited) return limited;
    const body = await c.req.json().catch(() => ({}));
    const parsed = SetupMutationSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    const authorization = await authorizeSetupMutation(c.req.raw, parsed.data.token);
    if (!authorization) return unauthorized(c);
    try {
      await markBootstrapComplete();
      invalidateSetupCache();
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof Error && err.message === 'admin_required') {
        return forbidden(c, 'At least one admin must exist before completing setup.');
      }
      if (err instanceof Error && /serialization|could not serialize/.test(err.message)) {
        return conflict(c, 'Concurrent completion attempt; please retry.', 'retry');
      }
      logger.error({ err }, 'complete-setup failed');
      return serverError(c);
    }
  }),
);
