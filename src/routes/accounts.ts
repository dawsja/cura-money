/**
 * /api/accounts — CRUD on a user's accounts.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import {
  getAllAccounts,
  getAccount,
  addAccount,
  editAccount,
  deleteAccount,
  setAccountHidden,
} from '@/db/queries';
import { userId, routeParam } from '@/lib/tenant';
import { badRequest, safe } from '@/lib/errors';

export const accountRoutes = new Hono();

const AccountType = z.enum(['checking', 'savings', 'credit', 'investment', 'loan']);
// Base object — kept as a plain ZodObject so the PATCH schema can call
// `.partial()` on it.
const BaseSchema = z.object({
  name: z.string().min(1).max(120),
  type: AccountType,
  balance: z.number().finite(),
  institution: z.string().max(120).optional(),
  // Pay-down fields are optional on the generic add/edit endpoint so
  // existing clients keep working. The paydown page has its own
  // dedicated endpoint for these.
  interestRate: z.number().finite().min(0).max(1).optional(),
  minPayment: z.number().finite().min(0).optional(),
  plannedPayment: z.number().finite().min(0).optional(),
  includeInPaydown: z.boolean().optional(),
});
// `hidden` and `alias` are PATCH-only — we never create a new account
// as hidden, and the alias defaults to NULL until the user sets one.
// The UI's Hide/Unhide buttons POST to dedicated endpoints, but they
// can also PATCH `{ hidden: true|false }`. Alias is set via PATCH
// (empty string clears the alias back to NULL).
const EditSchema = BaseSchema.partial().extend({
  hidden: z.boolean().optional(),
  alias: z.string().max(120).nullable().optional(),
});

accountRoutes.get(
  '/',
  safe(async (c) => {
    // `?includeHidden=true` is for the Accounts page's "Show hidden"
    // toggle. Every other consumer (dashboard, transactions, paydown)
    // wants the default which filters hidden out.
    const includeHidden = c.req.query('includeHidden') === 'true';
    return c.json(await getAllAccounts(userId(c), { includeHidden }));
  }),
);

accountRoutes.post(
  '/',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    // Account creation accepts the basic fields only — name, type,
    // balance, and institution. Paydown fields (interestRate,
    // minPayment, plannedPayment) default to 0 if omitted; the
    // Paydown page has its own dedicated endpoint for editing them
    // and its calculator filters out accounts that lack a minPayment
    // so an under-specified debt account doesn't blow up the projection.
    const parsed = BaseSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    const acc = await addAccount(userId(c), {
      name: parsed.data.name,
      type: parsed.data.type,
      balance: parsed.data.balance,
      institution: parsed.data.institution,
      interestRate: parsed.data.interestRate ?? 0,
      minPayment: parsed.data.minPayment ?? 0,
      plannedPayment: parsed.data.plannedPayment ?? 0,
      includeInPaydown: parsed.data.includeInPaydown ?? true,
      hidden: false,
      alias: undefined,
    });
    return c.json(acc, 201);
  }),
);

accountRoutes.patch(
  '/:id',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = EditSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    // Enforce the same credit/loan min-payment rule on PATCH, including
    // the case where the patch changes `type` to credit/loan on an
    // account that previously had minPayment = 0.
    if (parsed.data.type !== undefined || parsed.data.minPayment !== undefined) {
      const existing = await getAccount(userId(c), routeParam(c, 'id'));
      if (existing) {
        const nextType = parsed.data.type ?? existing.type;
        const nextMin = parsed.data.minPayment ?? existing.minPayment;
        if ((nextType === 'credit' || nextType === 'loan') && nextMin <= 0) {
          return badRequest(
            c,
            'Credit and loan accounts require a minimum payment greater than 0',
          );
        }
      }
    }
    await editAccount(userId(c), routeParam(c, 'id'), parsed.data);
    return c.json({ ok: true });
  }),
);

accountRoutes.delete(
  '/:id',
  safe(async (c) => {
    await deleteAccount(userId(c), routeParam(c, 'id'));
    return c.json({ ok: true });
  }),
);

// Dedicated hide/unhide endpoint. The PATCH route above already accepts
// `{ hidden: true }` but a dedicated endpoint is easier for the UI to
// call and keeps the intent explicit in logs.
accountRoutes.post(
  '/:id/hide',
  safe(async (c) => {
    await setAccountHidden(userId(c), routeParam(c, 'id'), true);
    return c.json({ ok: true });
  }),
);

accountRoutes.post(
  '/:id/unhide',
  safe(async (c) => {
    await setAccountHidden(userId(c), routeParam(c, 'id'), false);
    return c.json({ ok: true });
  }),
);
