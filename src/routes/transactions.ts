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
 *                                       fuzzy-matches merchant /
 *                                       category / sub / account
 *                                       (alias-aware) / notes / amount
 *                                       (multi-token, case-insensitive,
 *                                       punctuation-tolerant).
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
  updateFullTransaction,
  deleteTransaction,
  replaceTransactionSplits,
  categoryAssignmentExists,
  bulkAssignTransactions,
} from '@/db/queries';
import { userId, routeParam } from '@/lib/tenant';
import { badRequest, safe } from '@/lib/errors';
import { dollarsToCents } from '@/lib/money';

export const transactionRoutes = new Hono();

const TxType = z.enum(['income', 'expense', 'transfer']);
const AccountFilterSchema = z.array(z.string().min(1).max(500)).max(100);

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

const DollarAmount = z
  .number()
  .finite()
  .min(0)
  .refine((value) => {
    try {
      dollarsToCents(value);
      return true;
    } catch {
      return false;
    }
  }, 'amount must have at most 2 decimal places and be within the supported range');

const PositiveDollarAmount = z
  .number()
  .finite()
  .positive()
  .refine((value) => {
    try {
      dollarsToCents(value);
      return true;
    } catch {
      return false;
    }
  }, 'amount must have at most 2 decimal places and be within the supported range');

const AddSchema = z.object({
  date: z.string().refine(isCalendarDate, 'date must be a real calendar date in YYYY-MM-DD format'),
  merchant: z.string().min(1).max(255),
  category: z.string().min(1).max(120),
  subCategory: z.string().min(1).max(120),
  account: z.string().min(1).max(120),
  accountId: z.string().min(1).max(500).optional(),
  amount: DollarAmount,
  type: TxType,
  notes: z.string().max(2000).optional(),
});
const EditSchema = AddSchema.partial();
const FullUpdateSchema = z.object({
  transaction: EditSchema,
  splits: z.array(z.object({
    amount: PositiveDollarAmount,
    category: z.string().min(1).max(120),
    subCategory: z.string().min(1).max(120),
    type: TxType,
  })).max(100).refine((splits) => splits.length === 0 || splits.length >= 2, {
    message: 'splits must be empty or contain at least two allocations',
  }),
});
const ReplaceSplitsSchema = z.object({
  splits: z.array(z.object({
    amountCents: z.number().int().safe().positive(),
    category: z.string().min(1).max(120),
    subCategory: z.string().min(1).max(120),
    type: TxType,
  })).max(100),
});
const BulkAssignmentSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100).refine(
    (ids) => new Set(ids).size === ids.length,
    'ids must not contain duplicates',
  ),
  expected: z.object({
    type: TxType,
    category: z.string().min(1).max(120),
    subCategory: z.string().min(1).max(120),
  }),
  type: TxType,
  category: z.string().min(1).max(120),
  subCategory: z.string().min(1).max(120),
});

/**
 * Parse a numeric query param. Returns `undefined` for missing / empty
 * strings (no filter) and `null` for malformed values (caller should
 * 400). Lets us distinguish "the user didn't set this filter" from
 * "the user sent garbage".
 */
function parseAmountParam(value: string | undefined): number | undefined | null {
  if (value === undefined || value === '') return undefined;
  try {
    return dollarsToCents(value);
  } catch {
    return null;
  }
}

function parseFilters(c: import('hono').Context) {
  const q = c.req.query('q');
  const typesRaw = c.req.query('types');
  const accountsRaw = c.req.query('accounts');
  const accountIdsRaw = c.req.query('accountIds');
  const accountModeRaw = c.req.query('accountMode');
  // Legacy single-account param still accepted for back-compat.
  const account = c.req.query('account');
  const category = c.req.query('category');
  const subCategory = c.req.query('subCategory');
  const merchant = c.req.query('merchant');
  const reviewedRaw = c.req.query('reviewed');
  const minAmountCents = parseAmountParam(c.req.query('minAmount'));
  const maxAmountCents = parseAmountParam(c.req.query('maxAmount'));
  if (minAmountCents === null)
    return {
      error: 'minAmount must have at most 2 decimal places and be within the supported range',
    } as const;
  if (maxAmountCents === null)
    return {
      error: 'maxAmount must have at most 2 decimal places and be within the supported range',
    } as const;

  let reviewed: boolean | undefined;
  if (reviewedRaw !== undefined) {
    if (reviewedRaw !== 'true' && reviewedRaw !== 'false') {
      return { error: 'reviewed must be true or false' } as const;
    }
    reviewed = reviewedRaw === 'true';
  }

  const fromRaw = c.req.query('from');
  const toRaw = c.req.query('to');
  let fromDate: string | undefined;
  let toDate: string | undefined;
  if (fromRaw) {
    if (!isCalendarDate(fromRaw))
      return {
        error: 'from must be a real calendar date in YYYY-MM-DD format',
      } as const;
    fromDate = fromRaw;
  }
  if (toRaw) {
    if (!isCalendarDate(toRaw))
      return {
        error: 'to must be a real calendar date in YYYY-MM-DD format',
      } as const;
    toDate = toRaw;
  }

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

  let accounts: string[] | undefined;
  let accountIds: string[] | undefined;
  if (accountIdsRaw) {
    const rawJson: unknown = (() => {
      try {
        return JSON.parse(accountIdsRaw);
      } catch {
        return null;
      }
    })();
    const parsed = AccountFilterSchema.safeParse(rawJson);
    if (!parsed.success) return { error: 'accountIds must be an array of account IDs' } as const;
    if (parsed.data.length > 0) accountIds = parsed.data;
  }
  if (accountsRaw) {
    if (accountsRaw.trimStart().startsWith('[')) {
      const rawJson: unknown = (() => {
        try {
          return JSON.parse(accountsRaw);
        } catch {
          return null;
        }
      })();
      const parsed = AccountFilterSchema.safeParse(rawJson);
      if (!parsed.success) return { error: 'accounts must be an array of account names' } as const;
      if (parsed.data.length > 0) accounts = parsed.data;
    } else {
      // Keep accepting the previous comma-separated format for existing
      // bookmarked transaction-filter URLs.
      const parsed = accountsRaw
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
      if (parsed.length > 0) accounts = parsed;
    }
  } else if (account) {
    accounts = [account];
  }

  let accountMode: 'include' | 'exclude' | undefined;
  if (accountModeRaw === 'exclude' || accountModeRaw === 'include') {
    accountMode = accountModeRaw;
  } else if (accounts && accounts.length > 0) {
    accountMode = 'include';
  }

  return {
    filters: {
      types,
      accountIds,
      accounts,
      accountMode,
      category: category || undefined,
      subCategory: subCategory || undefined,
      merchant: merchant || undefined,
      minAmountCents,
      maxAmountCents,
      q: q || undefined,
      fromDate,
      toDate,
      reviewed,
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
    if (!Number.isSafeInteger(limit) || limit < 1) return badRequest(c, 'limit must be a positive integer');
    if (!Number.isSafeInteger(offset) || offset < 0) return badRequest(c, 'offset must be a non-negative integer');
    const parsed = parseFilters(c);
    if ('error' in parsed) return badRequest(c, parsed.error ?? 'invalid filter');
    return c.json(
      await listTransactions(userId(c), {
        limit,
        offset,
        filters: parsed.filters,
      }),
    );
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
    if (!(await categoryAssignmentExists(userId(c), parsed.data.category, parsed.data.subCategory))) {
      return badRequest(c, 'subCategory must belong to category');
    }
    const tx = await addTransaction(userId(c), parsed.data);
    return c.json(tx, 201);
  }),
);

transactionRoutes.patch(
  '/bulk-assignment',
  safe(async (c) => {
    const parsed = BulkAssignmentSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    const updated = await bulkAssignTransactions(userId(c), parsed.data);
    return c.json({ updated });
  }),
);

transactionRoutes.patch(
  '/:id',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = EditSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    const changesAssignment =
      parsed.data.type !== undefined || parsed.data.category !== undefined || parsed.data.subCategory !== undefined;
    if (changesAssignment) {
      if (!parsed.data.category || !parsed.data.subCategory) {
        return badRequest(c, 'category and subCategory are required when changing an assignment');
      }
      if (!(await categoryAssignmentExists(userId(c), parsed.data.category, parsed.data.subCategory))) {
        return badRequest(c, 'subCategory must belong to category');
      }
    }
    await editTransaction(userId(c), routeParam(c, 'id'), parsed.data);
    // Rule creation is explicit and handled by /api/rules/from-transaction.
    return c.json({ ok: true });
  }),
);

transactionRoutes.put(
  '/:id/full',
  safe(async (c) => {
    const parsed = FullUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    const transaction = await updateFullTransaction(userId(c), routeParam(c, 'id'), {
      transaction: parsed.data.transaction,
      splits: parsed.data.splits.map(({ amount, ...split }) => ({
        ...split,
        amountCents: dollarsToCents(amount),
      })),
    });
    return c.json(transaction);
  }),
);

transactionRoutes.put(
  '/:id/splits',
  safe(async (c) => {
    const parsed = ReplaceSplitsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    const splits = await replaceTransactionSplits(userId(c), routeParam(c, 'id'), parsed.data.splits);
    return c.json({ splits });
  }),
);

transactionRoutes.delete(
  '/:id',
  safe(async (c) => {
    await deleteTransaction(userId(c), routeParam(c, 'id'));
    return c.json({ ok: true });
  }),
);
