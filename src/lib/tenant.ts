/**
 * Per-user scoping helpers. Every data-layer function MUST take a userId
 * and pass it to Drizzle's `.where(eq(table.userId, userId))`.
 *
 * The guard middleware in src/lib/guard.ts puts the authenticated user on
 * the Hono context. Use these helpers to get a typed id from a route.
 */
import type { Context } from 'hono';

export type AuthedVariables = {
  user: { id: string; email: string; name: string; role?: string | null };
  session: { id: string; token: string; expiresAt: Date };
};

export type AppEnv = { Variables: AuthedVariables };

export function userId(c: Context<{ Variables: AuthedVariables }>): string {
  const id = c.get('user')?.id;
  if (!id) throw new Error('userId() called outside an authenticated route');
  return id;
}

/**
 * Hono's `c.req.param('id')` types as `string | undefined` because the
 * route schema is dynamic. In practice the param is always present on
 * a route like `/:id`, so this helper asserts and returns `string`.
 * Throws a 400-ish Error if the param is missing (which would indicate
 * a bug in the route definition).
 */
export function routeParam(c: Context, name: string): string {
  const v = c.req.param(name);
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`route param ${name} missing`);
  }
  return v;
}

/**
 * Returns the authenticated user from the Hono context, throwing if the
 * caller isn't on an authenticated route. Use this for handlers that need
 * the full user record (e.g. admin checks); the `userId(c)` shortcut is
 * preferred for resource routes that just need the id.
 */
export function currentUser(c: Context<{ Variables: AuthedVariables }>): AuthedVariables['user'] {
  const u = c.get('user');
  if (!u) throw new Error('currentUser() called outside an authenticated route');
  return u;
}

/**
 * Throws a 403 if the authenticated user isn't an admin. The error
 * propagates up to the `safe()` wrapper in lib/errors.ts and becomes a
 * 403 JSON response. Call as the first line of any admin-only route.
 */
export function requireAdmin(c: Context<{ Variables: AuthedVariables }>): void {
  const u = currentUser(c);
  if (u.role !== 'admin') {
    const err = new Error('admin role required') as Error & { status?: number };
    err.status = 403;
    throw err;
  }
}
