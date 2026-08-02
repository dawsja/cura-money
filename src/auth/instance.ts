/**
 * Auth instance lifecycle.
 *
 * The Better Auth instance is created at boot from the active OIDC
 * providers in the database. Because the genericOAuth plugin registers
 * providers at instantiation, adding a new provider via the admin UI
 * or the setup wizard requires either a restart (the legacy flow) or
 * an explicit `refreshAuth()` call (the v0.1 flow — the wizard and
 * admin endpoints both call it so changes apply without a container
 * restart).
 *
 * Usage:
 *   // in main() after DB / migrations / setup-state are ready
 *   await initAuth();
 *
 *   // in any route handler
 *   const session = await getAuth().api.getSession({ headers: ... });
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { oidcProviders } from '@/db/schema/oidc_providers';
import { createAuth, type Auth, type AuthOidcProvider } from './config';
import { logger } from '@/lib/logger';

let _auth: Auth | null = null;
// Track the provider IDs currently bound to `_auth` so `refreshAuth()`
// can decide whether a rebuild is actually needed. Without this we'd
// either always rebuild (wasteful) or never rebuild (bug — the old
// placeholder that always returned [] forced the latter).
let _activeProviderIds: string[] = [];

async function loadProvidersFromDb(): Promise<AuthOidcProvider[]> {
  const rows = await db
    .select({
      providerId: oidcProviders.providerId,
      discoveryUrl: oidcProviders.discoveryUrl,
      clientId: oidcProviders.clientId,
      clientSecret: oidcProviders.clientSecret,
      scopes: oidcProviders.scopes,
    })
    .from(oidcProviders)
    .where(eq(oidcProviders.isActive, true));

  return rows.map((r) => ({
    providerId: r.providerId,
    discoveryUrl: r.discoveryUrl,
    clientId: r.clientId,
    clientSecret: r.clientSecret,
    scopes: r.scopes ?? ['openid', 'email', 'profile'],
  }));
}

/**
 * Read the current providers from the DB and construct the auth instance.
 * Idempotent; safe to call multiple times but typically called once on
 * boot. Logs the loaded provider IDs at INFO.
 */
export async function initAuth(): Promise<Auth> {
  const providers = await loadProvidersFromDb();
  _auth = createAuth(providers);
  _activeProviderIds = providers.map((p) => p.providerId);
  logger.info(
    { providerCount: providers.length, providerIds: _activeProviderIds },
    'auth: initialised',
  );
  return _auth;
}

/**
 * Return the current auth instance. Throws if initAuth() hasn't been called
 * yet — the boot order in src/index.ts guarantees it's set before any
 * request is served.
 */
export function getAuth(): Auth {
  if (!_auth) {
    throw new Error(
      'getAuth() called before initAuth() — boot order bug in src/index.ts',
    );
  }
  return _auth;
}

/**
 * Re-read providers from the DB and rebuild the auth instance ONLY if the
 * set of active provider IDs actually changed. Returns whether a rebuild
 * happened and the new active provider IDs.
 *
 * In-flight requests keep their reference to the old `_auth` (they hold
 * it via the Hono route closure) and complete normally. New requests
 * pick up the new instance. Existing session cookies continue to work
 * because Better Auth's session lookup is by token in the DB, not by
 * auth instance.
 *
 * Called by:
 *   - setup.ts `configureOidc` (first-run wizard OIDC step)
 *   - admin-oidc.ts add/edit/delete endpoints
 */
export async function refreshAuth(): Promise<{ changed: boolean; providers: string[] }> {
  const providers = await loadProvidersFromDb();
  const next = providers.map((p) => p.providerId);
  const changed =
    next.length !== _activeProviderIds.length ||
    next.some((id, i) => id !== _activeProviderIds[i]);
  if (changed) {
    _auth = createAuth(providers);
    _activeProviderIds = next;
    logger.info(
      { providerIds: next, previousIds: _activeProviderIds },
      'auth: re-initialised (provider set changed)',
    );
  } else {
    logger.debug({ providerIds: next }, 'auth: refresh checked, no change');
  }
  return { changed, providers: next };
}

/** List active providers without rebuilding the instance (cheap DB read). */
export async function listActiveProviders(): Promise<AuthOidcProvider[]> {
  return loadProvidersFromDb();
}
