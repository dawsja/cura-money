/**
 * /api/goals — CRUD on a user's savings goals.
 *
 * The watched account's balance is the source of truth for live
 * progress — we don't snapshot it on the goal row. Reads (`GET /`) join
 * the latest balance in `db/queries.ts → getAllGoals` so the UI gets
 * the freshest figure on every fetch.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { addGoal, deleteGoal, editGoal, getAllGoals } from '@/db/queries';
import { userId, routeParam } from '@/lib/tenant';
import { badRequest, safe } from '@/lib/errors';

export const goalRoutes = new Hono();

const AddSchema = z.object({
  name: z.string().min(1).max(120),
  target: z.number().finite().positive(),
  startingValue: z.number().finite().min(0).default(0),
  // accountId is required at creation — a goal without an account has
  // no progress to show. Nullable on edit so the user can detach.
  accountId: z.string().min(1),
});

const EditSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  target: z.number().finite().positive().optional(),
  startingValue: z.number().finite().min(0).optional(),
  accountId: z.string().min(1).nullable().optional(),
});

goalRoutes.get(
  '/',
  safe(async (c) => c.json(await getAllGoals(userId(c)))),
);

goalRoutes.post(
  '/',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = AddSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    const goal = await addGoal(userId(c), parsed.data);
    return c.json(goal, 201);
  }),
);

goalRoutes.patch(
  '/:id',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = EditSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    await editGoal(userId(c), routeParam(c, 'id'), parsed.data);
    return c.json({ ok: true });
  }),
);

goalRoutes.delete(
  '/:id',
  safe(async (c) => {
    await deleteGoal(userId(c), routeParam(c, 'id'));
    return c.json({ ok: true });
  }),
);