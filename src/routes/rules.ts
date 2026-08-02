/**
 * /api/rules — CRUD on user-defined categorization rules.
 *
 * Rules are "always set this merchant to this category" mappings. The
 * SimpleFIN import + manual add paths consult `findRuleForMerchant` so
 * the user only categorises a given merchant once. The Transactions
 * page consults it too, to decide whether to show the "Create rule?"
 * prompt after an inline category change.
 *
 * `POST /api/rules/:id/run` re-applies a single rule to every existing
 * transaction in the user's ledger (the ▶ button on the Rules page).
 * Forward-only by design — newly created rules only apply to
 * transactions categorized AFTER they exist, unless the user
 * explicitly clicks Run.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import {
  applyRuleToAllMatchingTransactions,
  createRule,
  deleteRule,
  editRule,
  listRules,
} from '@/db/queries';
import { userId, routeParam } from '@/lib/tenant';
import { badRequest, safe } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const ruleRoutes = new Hono();

const MatchType = z.literal('exact').default('exact');

const AddSchema = z.object({
  matchType: MatchType.optional(),
  matchValue: z.string().min(1).max(255),
  category: z.string().min(1).max(120),
  subCategory: z.string().max(120).optional(),
});

// Editable fields — matchValue is included so the user can rename a
// rule's merchant pattern (e.g. "STARBUCKS #1234" → "Starbucks").
// `subCategory` accepts `null` to clear the sub-category on a rule.
const EditSchema = z.object({
  matchValue: z.string().min(1).max(255).optional(),
  category: z.string().min(1).max(120).optional(),
  subCategory: z.string().max(120).nullable().optional(),
});

ruleRoutes.get(
  '/',
  safe(async (c) => c.json(await listRules(userId(c)))),
);

ruleRoutes.post(
  '/',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = AddSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    const rule = await createRule(userId(c), parsed.data);
    return c.json(rule, 201);
  }),
);

ruleRoutes.patch(
  '/:id',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = EditSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    await editRule(userId(c), routeParam(c, 'id'), parsed.data);
    return c.json({ ok: true });
  }),
);

ruleRoutes.delete(
  '/:id',
  safe(async (c) => {
    await deleteRule(userId(c), routeParam(c, 'id'));
    return c.json({ ok: true });
  }),
);

/**
 * Re-apply a rule to every existing matching transaction in the user's
 * ledger. The "▶ Run" button on the Rules page — useful when the user
 * creates a rule and wants to re-categorise their back history without
 * waiting for the next import.
 */
ruleRoutes.post(
  '/:id/run',
  safe(async (c) => {
    try {
      const result = await applyRuleToAllMatchingTransactions(userId(c), routeParam(c, 'id'));
      return c.json({ ok: true, updated: result.updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.warn({ err: message }, 'rule run failed');
      return badRequest(c, message, 'rule_run_failed');
    }
  }),
);
