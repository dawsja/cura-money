/**
 * Auth-app router. The heavy lifting is done by Better Auth at /api/auth/*.
 * These routes are thin helpers used by the SPA (current user, sign-out).
 *
 * Admin-only auth endpoints (local-auth toggle) live in
 * `src/routes/admin-auth.ts` under `/api/admin/auth/*` so they're
 * mounted AFTER the guard middleware. This router stays public and
 * is mounted BEFORE the guard.
 */
import { Hono } from 'hono';
import { getAuth, isLocalAuthDisabled, listActiveProviders } from '@/auth';
import { safe, unauthorized } from '@/lib/errors';
import { invalidateSetupCache } from '@/lib/guard';
import { userHasCredential } from '@/db/queries';
import { env } from '@/lib/env';
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/db/demo-reset';

export const authRoutes = new Hono();

authRoutes.get(
  '/me',
  safe(async (c) => {
    const session = await getAuth().api.getSession({ headers: c.req.raw.headers });
    if (!session) return unauthorized(c);
    // `hasCredential` is true when the user has an email/password
    // account row. The Settings page uses this to decide whether to
    // show the "Change password" section — OIDC-only users can't
    // change their password here (they don't have one).
    const hasCredential = await userHasCredential(session.user.id);
    return c.json({
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role: (session.user as { role?: string }).role ?? 'user',
        hasCredential,
      },
    });
  }),
);

authRoutes.post(
  '/sign-out',
  safe(async (c) => {
    // Tell Better Auth to delete the session row in the DB. Note: calling
    // the .api method does NOT propagate the cookie-clearing Set-Cookie
    // headers back to this Hono response — the internal ctx.setCookie
    // calls land in Better Auth's internal context and get discarded.
    // We have to expire the cookies ourselves below; otherwise the
    // cookieCache's `session_data` cookie survives in the browser and
    // /api/auth-app/me keeps returning the user for up to `cookieCache.maxAge`.
    await getAuth().api.signOut({ headers: c.req.raw.headers });
    invalidateSetupCache();

    // Mirror the cookie-clearing logic from Better Auth's deleteSessionCookie:
    //   - sessionToken cookie (the signed session id)
    //   - sessionData cookie (the cookieCache) — THIS is the one that
    //     makes "click sign out → still see protected layout" happen.
    // We use Hono's setCookie with maxAge=0 + matching path + sameSite
    // so the browser actually drops them.
    const isProd = env.NODE_ENV === 'production';
    // The cookie names use the `__Secure-` prefix in production (because
    // `useSecureCookies: env.NODE_ENV === 'production'` is set in config).
    const sessionTokenName = isProd ? '__Secure-better-auth.session_token' : 'better-auth.session_token';
    const sessionDataName = isProd ? '__Secure-better-auth.session_data' : 'better-auth.session_data';

    c.header(
      'Set-Cookie',
      `${sessionTokenName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${isProd ? '; Secure' : ''}`,
      { append: true },
    );
    c.header(
      'Set-Cookie',
      `${sessionDataName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${isProd ? '; Secure' : ''}`,
      { append: true },
    );

    return c.json({ ok: true });
  }),
);

/**
 * Public list of active OIDC providers — used by the sign-in page to
 * render "Sign in with <providerId>" buttons. Returns only the public
 * surface (providerId, displayName) — never secrets or discovery URLs.
 */
authRoutes.get(
  '/oidc-providers',
  safe(async (c) => {
    const providers = await listActiveProviders();
    return c.json(
      providers.map((p) => ({
        providerId: p.providerId,
        displayName: prettifyProviderId(p.providerId),
      })),
    );
  }),
);

function prettifyProviderId(id: string): string {
  return id
    .split(/[-_]/g)
    .map((s) => (s ? s[0]!.toUpperCase() + s.slice(1) : s))
    .join(' ');
}

/**
 * Single public endpoint the sign-in page consumes to decide what to
 * render: a single object carrying the OIDC providers AND the
 * local-auth-disabled flag. Combining them avoids a torn-read where the
 * sign-in form renders against a stale flag (the two queries live on
 * different tables).
 */
authRoutes.get(
  '/auth-options',
  safe(async (c) => {
    if (env.DEMO_MODE) {
      return c.json({
        localAuthDisabled: false,
        providers: [],
        demoMode: true,
        demoCredentials: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
      });
    }
    const [providers, localAuthDisabled] = await Promise.all([
      listActiveProviders(),
      isLocalAuthDisabled(),
    ]);
    return c.json({
      localAuthDisabled,
      demoMode: false,
      providers: providers.map((p) => ({
        providerId: p.providerId,
        displayName: prettifyProviderId(p.providerId),
      })),
    });
  }),
);

// ---- Admin: local auth toggle --------------------------------------------
//
// See src/routes/admin-auth.ts → mounted at /api/admin/auth/* (after
// the guard).
