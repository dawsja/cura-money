/**
 * /api/rules — CRUD on user-defined categorization rules.
 *
 * Rules combine merchant matching with optional source account, type, and
 * category conditions. SimpleFIN and historical runs use the same
 * deterministic resolver; manually entered transactions keep the category
 * selected by the user.
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
  createRuleFromTransaction,
  deleteRule,
  editRule,
  getAccount,
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
  accountId: z.string().min(1).max(500).optional(),
  sourceType: TxType.optional(),
  sourceCategory: z.string().min(1).max(120).optional(),
  sourceSubCategory: z.string().min(1).max(120).optional(),
  category: z.string().min(1).max(120),
  subCategory: z.string().min(1).max(120),
  type: TxType,
}).refine((value) => (value.sourceCategory === undefined) === (value.sourceSubCategory === undefined), {
  message: 'sourceCategory and sourceSubCategory must be provided together',
  path: ['sourceCategory'],
});

// Editable fields — matchValue is included so the user can rename a
// rule's merchant pattern (e.g. "STARBUCKS #1234" → "Starbucks").
// Existing category-only rules remain readable, but any assignment edit
// must provide a valid main + leaf pair. `type` accepts null to clear it.
const EditSchema = z.object({
  expectedVersion: z.number().int().positive(),
  matchValue: z.string().min(1).max(255).optional(),
  accountId: z.string().min(1).max(500).nullable().optional(),
  sourceType: TxType.nullable().optional(),
  sourceCategory: z.string().min(1).max(120).nullable().optional(),
  sourceSubCategory: z.string().min(1).max(120).nullable().optional(),
  category: z.string().min(1).max(120).optional(),
  subCategory: z.string().min(1).max(120).optional(),
  type: TxType.nullable().optional(),
}).refine((value) => {
  if (value.sourceCategory === undefined && value.sourceSubCategory === undefined) return true;
  if (value.sourceCategory === null && value.sourceSubCategory === null) return true;
  return typeof value.sourceCategory === 'string' && typeof value.sourceSubCategory === 'string';
}, {
  message: 'sourceCategory and sourceSubCategory must be changed together',
  path: ['sourceCategory'],
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
    if (parsed.data.accountId && !await getAccount(userId(c), parsed.data.accountId)) {
      return badRequest(c, 'accountId must belong to the user');
    }
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
    if (parsed.data.accountId && !await getAccount(userId(c), parsed.data.accountId)) {
      return badRequest(c, 'accountId must belong to the user');
    }
    const changesAssignment = parsed.data.category !== undefined || parsed.data.subCategory !== undefined;
    if (changesAssignment) {
      if (!parsed.data.category || !parsed.data.subCategory) {
        return badRequest(c, 'category and subCategory are required when changing an assignment');
      }
      if (!await categoryAssignmentExists(userId(c), parsed.data.category, parsed.data.subCategory)) {
        return badRequest(c, 'subCategory must belong to category');
      }
    }
    const { expectedVersion, ...patch } = parsed.data;
    return c.json(await editRule(userId(c), routeParam(c, 'id'), patch, expectedVersion));
  }),
);

ruleRoutes.post(
  '/from-transaction/:transactionId',
  safe(async (c) => {
    const parsed = z.object({
      replaceRuleId: z.string().min(1).max(500).optional(),
      expectedVersion: z.number().int().positive().optional(),
    })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    return c.json(await createRuleFromTransaction(
      userId(c),
      routeParam(c, 'transactionId'),
      parsed.data.replaceRuleId,
      parsed.data.expectedVersion,
    ));
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
