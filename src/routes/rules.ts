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
 * `POST /api/rules/run-all` does the same for every rule in one pass
 * (best match wins, same as import). Forward-only by design — newly
 * created rules only apply to transactions categorized AFTER they
 * exist, unless the user explicitly clicks Run / Run all.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import {
  applyAllRulesToMatchingTransactions,
  applyRuleToAllMatchingTransactions,
  createRule,
  deleteRule,
  editRule,
  listRules,
  categoryAssignmentExists,
} from '@/db/queries';
import { userId, routeParam } from '@/lib/tenant';
import { badRequest, safe } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const ruleRoutes = new Hono();

const MatchType = z.literal('exact').default('exact');

const TxType = z.enum(['income', 'expense', 'transfer']);

const AddSchema = z.object({
  matchType: MatchType.optional(),
  matchValue: z.string().min(1).max(255),
  category: z.string().min(1).max(120),
  subCategory: z.string().min(1).max(120),
  type: TxType.optional(),
});

// Editable fields — matchValue is included so the user can rename a
// rule's merchant pattern (e.g. "STARBUCKS #1234" → "Starbucks").
// Existing category-only rules remain readable, but any assignment edit
// must provide a valid main + leaf pair. `type` accepts null to clear it.
const EditSchema = z.object({
  matchValue: z.string().min(1).max(255).optional(),
  category: z.string().min(1).max(120).optional(),
  subCategory: z.string().min(1).max(120).optional(),
  type: TxType.nullable().optional(),
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
    if (!await categoryAssignmentExists(userId(c), parsed.data.category, parsed.data.subCategory)) {
      return badRequest(c, 'subCategory must belong to category');
    }
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
    const changesAssignment = parsed.data.category !== undefined || parsed.data.subCategory !== undefined;
    if (changesAssignment) {
      if (!parsed.data.category || !parsed.data.subCategory) {
        return badRequest(c, 'category and subCategory are required when changing an assignment');
      }
      if (!await categoryAssignmentExists(userId(c), parsed.data.category, parsed.data.subCategory)) {
        return badRequest(c, 'subCategory must belong to category');
      }
    }
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
 * Re-apply every rule to matching transactions in one pass. Registered
 * before `/:id/run` so "run-all" is not captured as an id.
 */
ruleRoutes.post(
  '/run-all',
  safe(async (c) => {
    try {
      const result = await applyAllRulesToMatchingTransactions(userId(c));
      return c.json({ ok: true, updated: result.updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.warn({ err: message }, 'rule run-all failed');
      return badRequest(c, message, 'rule_run_all_failed');
    }
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
