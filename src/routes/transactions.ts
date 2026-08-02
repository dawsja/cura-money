/**
 * /api/transactions — full CRUD on transactions.
 *
 * Three read endpoints:
 *   - `GET /api/transactions`        — full list, used by Budget and
 *                                       Dashboard to compute aggregates
 *                                       over the whole window.
 *   - `GET /api/transactions/page`   — paginated subset + total count,
 *                                       used by the Transactions page.
 *                                       Supports structured filters
 *                                       (type / account / category /
 *                                       merchant / amount range) plus
 *                                       a free-text `q` parameter that
 *                                       does substring matching against
 *                                       merchant / category / sub /
 *                                       account (alias-aware).
 *   - `GET /api/transactions/merchants` — distinct merchant names,
 *                                          drives the merchant filter
 *                                          dropdown on the Transactions
 *                                          page.
 *
 * Splitting the two list endpoints means we don't have to refactor
 * every aggregate caller when adding pagination; the existing full-list
 * shape is preserved bit-for-bit.
 *
 * The smart-categoriser suggestion is exposed via the simplefin route
 * after a sync; here we just store what the user gave us.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import {
  getAllTransactions,
  listTransactions,
  getDistinctMerchants,
  addTransaction,
  editTransaction,
  deleteTransaction,
  findRuleForMerchant,
} from '@/db/queries';
import { userId, routeParam } from '@/lib/tenant';
import { badRequest, safe } from '@/lib/errors';

export const transactionRoutes = new Hono();

const TxType = z.enum(['income', 'expense', 'transfer']);

const AddSchema = z.object({
  date: z.string().min(1),
  merchant: z.string().min(1).max(255),
  category: z.string().min(1).max(120),
  subCategory: z.string().max(120).optional(),
  account: z.string().min(1).max(120),
  amount: z.number().finite(),
  type: TxType,
  notes: z.string().max(2000).optional(),
});
const EditSchema = AddSchema.partial();

/**
 * Parse a numeric query param. Returns `undefined` for missing / empty
 * strings (no filter) and `null` for malformed values (caller should
 * 400). Lets us distinguish "the user didn't set this filter" from
 * "the user sent garbage".
 */
function parseNumParam(value: string | undefined): number | undefined | null {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseFilters(c: import('hono').Context) {
  const q = c.req.query('q');
  const typesRaw = c.req.query('types');
  const account = c.req.query('account');
  const category = c.req.query('category');
  const subCategory = c.req.query('subCategory');
  const merchant = c.req.query('merchant');
  const minAmount = parseNumParam(c.req.query('minAmount'));
  const maxAmount = parseNumParam(c.req.query('maxAmount'));
  if (minAmount === null) return { error: 'minAmount must be a number' } as const;
  if (maxAmount === null) return { error: 'maxAmount must be a number' } as const;

  // `types` is a comma-separated list. Empty / undefined means "no
  // type filter" (NOT "match nothing"); reject values that aren't
  // part of the enum so a typo in the URL doesn't silently return
  // an empty page.
  let types: ('income' | 'expense' | 'transfer')[] | undefined;
  if (typesRaw) {
    const parsed = typesRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (parsed.length > 0) {
      const validated = TxType.array().safeParse(parsed);
      if (!validated.success) {
        return { error: 'types contains invalid value' } as const;
      }
      types = validated.data;
    }
  }

  return {
    filters: {
      types,
      account: account || undefined,
      category: category || undefined,
      subCategory: subCategory || undefined,
      merchant: merchant || undefined,
      minAmount,
      maxAmount,
      q: q || undefined,
    },
  } as const;
}

transactionRoutes.get(
  '/',
  safe(async (c) => c.json(await getAllTransactions(userId(c)))),
);

transactionRoutes.get(
  '/page',
  safe(async (c) => {
    const rawLimit = c.req.query('limit');
    const rawOffset = c.req.query('offset');
    const limit = rawLimit !== undefined ? Number(rawLimit) : 25;
    const offset = rawOffset !== undefined ? Number(rawOffset) : 0;
    if (!Number.isFinite(limit) || limit < 1) return badRequest(c, 'limit must be a positive integer');
    if (!Number.isFinite(offset) || offset < 0) return badRequest(c, 'offset must be a non-negative integer');
    const parsed = parseFilters(c);
    if ('error' in parsed) return badRequest(c, parsed.error ?? 'invalid filter');
    return c.json(await listTransactions(userId(c), { limit, offset, filters: parsed.filters }));
  }),
);

transactionRoutes.get(
  '/merchants',
  safe(async (c) => c.json(await getDistinctMerchants(userId(c)))),
);

transactionRoutes.post(
  '/',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = AddSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    // Apply any matching user rule to category/subCategory — rules win
    // over what the user typed so a rule for "Whole Foods Market" is
    // never silently overridden by a one-off typo. The user can edit
    // the transaction after creation if they want a one-off override.
    const ruleMatch = await findRuleForMerchant(userId(c), parsed.data.merchant);
    const txInput = ruleMatch
      ? { ...parsed.data, category: ruleMatch.category, subCategory: ruleMatch.subCategory ?? parsed.data.subCategory }
      : parsed.data;
    const tx = await addTransaction(userId(c), txInput);
    return c.json(tx, 201);
  }),
);

transactionRoutes.patch(
  '/:id',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = EditSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    const { ruleCreated } = await editTransaction(userId(c), routeParam(c, 'id'), parsed.data);
    // `ruleCreated` lets the client skip the "Create rule?" popup
    // for inline edits on previously-pending rows — the server
    // already trained the rule on the user's behalf, so a duplicate
    // prompt would just be noise (and a duplicate POST).
    return c.json({ ok: true, ruleCreated });
  }),
);

transactionRoutes.delete(
  '/:id',
  safe(async (c) => {
    await deleteTransaction(userId(c), routeParam(c, 'id'));
    return c.json({ ok: true });
  }),
);
