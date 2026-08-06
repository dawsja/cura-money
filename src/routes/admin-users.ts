/**
 * /api/admin/users — list + mutate users.
 *
 * GET    /api/admin/users          → all users with their provider info
 * PATCH  /api/admin/users/:id      → update a user's role (admin/user)
 * DELETE /api/admin/users/:id      → delete a user and all of their data
 *
 * Admin-only. The PATCH and DELETE handlers refuse to mutate/delete the
 * last admin (overall, or last of a viable auth path) so the operator
 * can't lock themselves out of the app.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { getAllUsers, deleteUserWithData, updateUserRole, type AdminUserRow } from '@/db/queries';
import { isLocalAuthDisabled } from '@/auth/local_auth';
import { getAuth } from '@/auth';
import { db } from '@/db/client';
import { user as authUser } from '@/db/schema/auth';
import { eq } from 'drizzle-orm';
import { requireAdmin, routeParam } from '@/lib/tenant';
import { safe, notFound, badRequest } from '@/lib/errors';

export const adminUserRoutes = new Hono();

const createBody = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(12).max(256),
});

adminUserRoutes.post(
  '/',
  safe(async (c) => {
    requireAdmin(c);
    const parsed = createBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    const result = await getAuth().api.signUpEmail({
      body: parsed.data,
      headers: new Headers(),
    });
    if (!result.user?.id) throw new Error('user creation failed');
    await db
      .update(authUser)
      .set({ emailVerified: true, role: null })
      .where(eq(authUser.id, result.user.id));
    return c.json({ id: result.user.id, name: result.user.name, email: result.user.email, role: null }, 201);
  }),
);

adminUserRoutes.get(
  '/',
  safe(async (c) => {
    requireAdmin(c);
    const localAuthDisabled = await isLocalAuthDisabled();
    const rows = await getAllUsers(localAuthDisabled);
    return c.json(rows satisfies AdminUserRow[]);
  }),
);

const patchBody = z.object({
  role: z.enum(['admin', 'user']),
});

adminUserRoutes.patch(
  '/:id',
  safe(async (c) => {
    requireAdmin(c);
    const id = routeParam(c, 'id');
    const parsed = patchBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return badRequest(c, 'role must be "admin" or "user"');
    try {
      const result = await updateUserRole(id, parsed.data.role);
      return c.json({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'update failed';
      if (/not found/i.test(message)) return notFound(c, message);
      return badRequest(c, message);
    }
  }),
);

adminUserRoutes.delete(
  '/:id',
  safe(async (c) => {
    requireAdmin(c);
    const id = routeParam(c, 'id');
    try {
      const { deletedRows } = await deleteUserWithData(id);
      return c.json({ ok: true, deletedRows });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'delete failed';
      if (/not found/i.test(message)) return notFound(c, message);
      return badRequest(c, message);
    }
  }),
);
