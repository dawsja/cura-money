/**
 * Data layer. Every function takes `userId` as the first argument and
 * filters by `user_id` on every read/write. The guard middleware on the
 * root app puts an authenticated user on the Hono context; routes call
 * `userId(c)` from `@/lib/tenant` and pass it in.
 *
 * Functions are organized by resource: accounts, categories, sub-categories,
 * transactions, goals, monthly_budgets, settings.
 */
import { and, asc, desc, eq, gte, inArray, like, lte, notInArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from './client';
import { accounts } from './schema/accounts';
import { categories } from './schema/categories';
import { subCategories } from './schema/sub_categories';
import { transactions } from './schema/transactions';
import { monthlyBudgets } from './schema/monthly_budgets';
import { settings } from './schema/settings';
import { goals } from './schema/goals';
import { monthlyPaydown, monthlyPaydownSnapshots } from './schema/monthly_paydown';
import { rules } from './schema/rules';
import { account as authAccount, user as authUser } from './schema/auth';
import { INITIAL_CATEGORIES } from './seed';
import { priorityOrder, type PaydownMethod } from '@/lib/paydown';

// ---- Shared types ---------------------------------------------------------
export type AccountType = 'checking' | 'savings' | 'credit' | 'investment' | 'loan';
// `transfer` covers credit card payments, account-to-account moves, and
// any other transaction where money moves between two of the user's own
// accounts. Transfers are excluded from income/expense totals because
// they don't change net worth — they just reallocate it.
export type TransactionType = 'income' | 'expense' | 'transfer';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  institution?: string;
  // Pay-down fields — only meaningful for credit/loan accounts but live
  // on every account for simplicity.
  interestRate: number;
  minPayment: number;
  plannedPayment: number;
  includeInPaydown: boolean;
  // `hidden` removes the account from every read view (dashboard,
  // accounts list, transactions, budget, paydown) and from SimpleFIN
  // sync. Survives a sync because the sync helper checks the existing
  // row before writing.
  hidden: boolean;
  // User-set display alias. NULL means "use the canonical name". Never
  // touched by SimpleFIN sync, so the user's chosen name persists
  // across every re-sync. Resolved at read time in the Transactions
  // page so renaming flows through to historical transactions.
  alias?: string | null;
}
export interface SubCategory {
  id: string;
  name: string;
  planned: number;
  icon?: string;
}
export interface MainCategory {
  id: string;
  name: string;
  type: TransactionType;
  icon?: string;
  sortOrder: number;
  subCategories: SubCategory[];
}
export interface Transaction {
  id: string;
  date: string;
  merchant: string;
  category: string;
  subCategory?: string;
  account: string;
  amount: number;
  type: TransactionType;
  notes?: string;
}

// ---- First-time user seeding ---------------------------------------------

export async function seedInitialCategoriesIfEmpty(userId: string): Promise<void> {
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.userId, userId))
    .limit(1);
  if (existing.length > 0) return;

  for (const cat of INITIAL_CATEGORIES) {
    // The seed-time IDs in `INITIAL_CATEGORIES` (e.g. "cat-income") are
    // stable for documentation but not unique across users — they collide on
    // the global primary key. Prefix with a per-user token so each user gets
    // a private copy of the default tree.
    const mainId = `${userId}__${cat.id}`;
    await db.insert(categories).values({
      id: mainId,
      userId,
      name: cat.name,
      type: cat.type,
    });
    if (cat.subCategories.length > 0) {
      await db.insert(subCategories).values(
        cat.subCategories.map((sub) => ({
          id: `${userId}__${sub.id}`,
          userId,
          mainCategoryId: mainId,
          name: sub.name,
          planned: sub.planned,
        })),
      );
    }
  }
}

// ---- Accounts -----------------------------------------------------------

export async function getAllAccounts(
  userId: string,
  options?: { includeHidden?: boolean },
): Promise<Account[]> {
  // Default hides hidden accounts — every consumer (dashboard, accounts
  // list, transactions filter, paydown) wants them out. The Accounts
  // page opts in with `includeHidden: true` to render a "Show hidden"
  // section so the user can un-hide.
  const where = options?.includeHidden
    ? eq(accounts.userId, userId)
    : and(eq(accounts.userId, userId), eq(accounts.hidden, false));
  const rows = await db
    .select()
    .from(accounts)
    .where(where)
    .orderBy(asc(accounts.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    balance: r.balance,
    institution: r.institution ?? undefined,
    interestRate: r.interestRate,
    minPayment: r.minPayment,
    plannedPayment: r.plannedPayment,
    includeInPaydown: r.includeInPaydown,
    hidden: r.hidden,
    alias: r.alias ?? undefined,
  }));
}

/**
 * Fetch a single account by id, scoped to the user. Returns null if the
 * row doesn't exist (or belongs to a different user). Used by PATCH
 * handlers that need to know the existing type/balance before applying
 * a patch (e.g. the credit/loan min-payment validation in the accounts
 * and paydown routes).
 */
export async function getAccount(userId: string, id: string): Promise<Account | null> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.id, id)))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    balance: row.balance,
    institution: row.institution ?? undefined,
    interestRate: row.interestRate,
    minPayment: row.minPayment,
    plannedPayment: row.plannedPayment,
    includeInPaydown: row.includeInPaydown,
    hidden: row.hidden,
    alias: row.alias ?? undefined,
  };
}

export async function addAccount(userId: string, acc: Omit<Account, 'id'>): Promise<Account> {
  const id = `acc-${nanoid(10)}`;
  await db.insert(accounts).values({
    id,
    userId,
    name: acc.name,
    type: acc.type,
    balance: acc.balance,
    institution: acc.institution ?? null,
    interestRate: acc.interestRate,
    minPayment: acc.minPayment,
    plannedPayment: acc.plannedPayment,
    includeInPaydown: acc.includeInPaydown,
    hidden: acc.hidden,
  });
  return { ...acc, id };
}

export async function editAccount(
  userId: string,
  id: string,
  patch: Partial<Account>,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.id, id)))
    .limit(1);
  if (!existing) return;
  await db
    .update(accounts)
    .set({
      name: patch.name ?? existing.name,
      type: patch.type ?? existing.type,
      balance: patch.balance ?? existing.balance,
      institution: patch.institution !== undefined ? (patch.institution ?? null) : existing.institution,
      interestRate: patch.interestRate ?? existing.interestRate,
      minPayment: patch.minPayment ?? existing.minPayment,
      plannedPayment: patch.plannedPayment ?? existing.plannedPayment,
      includeInPaydown: patch.includeInPaydown ?? existing.includeInPaydown,
      hidden: patch.hidden ?? existing.hidden,
      // `alias` uses the explicit `undefined` check (same shape as
      // `institution`) so a missing field is a no-op. `null` or an
      // empty string both clear the alias back to NULL. The UI sends
      // "" when the user blanks the input; the schema also accepts
      // `null` for callers that prefer to be explicit.
      alias:
        patch.alias === undefined
          ? existing.alias
          : patch.alias === null || patch.alias === ''
            ? null
            : patch.alias,
    })
    .where(and(eq(accounts.userId, userId), eq(accounts.id, id)));
}

/**
 * Patch just the pay-down fields for an account. Used by the paydown
 * calculator panel — keeps the patch shape focused so the route doesn't
 * have to accept every Account field.
 */
export async function editAccountPaydown(
  userId: string,
  id: string,
  patch: {
    interestRate?: number;
    minPayment?: number;
    plannedPayment?: number;
    includeInPaydown?: boolean;
  },
): Promise<void> {
  const [existing] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.id, id)))
    .limit(1);
  if (!existing) return;
  await db
    .update(accounts)
    .set({
      interestRate: patch.interestRate ?? existing.interestRate,
      minPayment: patch.minPayment ?? existing.minPayment,
      plannedPayment: patch.plannedPayment ?? existing.plannedPayment,
      includeInPaydown: patch.includeInPaydown ?? existing.includeInPaydown,
    })
    .where(and(eq(accounts.userId, userId), eq(accounts.id, id)));
}

/** All liability accounts (credit + loan), regardless of includeInPaydown. */
export async function getLiabilityAccounts(userId: string): Promise<Account[]> {
  const rows = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        // IN ('credit', 'loan') via two or-chains. Drizzle's `inArray`
        // works too but we keep this portable.
        // We do the filter in JS to keep the query simple.
      ),
    )
    .orderBy(asc(accounts.name));
  return rows
    .filter((r) => (r.type === 'credit' || r.type === 'loan') && !r.hidden)
    .map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      balance: r.balance,
      institution: r.institution ?? undefined,
      interestRate: r.interestRate,
      minPayment: r.minPayment,
      plannedPayment: r.plannedPayment,
      includeInPaydown: r.includeInPaydown,
      hidden: r.hidden,
      alias: r.alias ?? undefined,
    }));
}

export async function deleteAccount(userId: string, id: string): Promise<void> {
  await db.delete(accounts).where(and(eq(accounts.userId, userId), eq(accounts.id, id)));
}

/**
 * Toggle the `hidden` flag for one account. Hidden accounts are excluded
 * from every read view and from SimpleFIN sync (the sync helper checks
 * the existing row and skips the upsert). Row stays in the table so
 * the user can un-hide later.
 */
export async function setAccountHidden(
  userId: string,
  id: string,
  hidden: boolean,
): Promise<void> {
  await db
    .update(accounts)
    .set({ hidden })
    .where(and(eq(accounts.userId, userId), eq(accounts.id, id)));
}

export async function deleteSimpleFinAccountsNotIn(
  userId: string,
  allowedAccountIds: string[],
): Promise<void> {
  const rows = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), like(accounts.id, 'simplefin-%')));
  for (const r of rows) {
    const rawSfId = r.id.replace(/^simplefin-/, '');
    if (!allowedAccountIds.includes(rawSfId) && !allowedAccountIds.includes(r.id)) {
      await db.delete(transactions).where(and(eq(transactions.userId, userId), eq(transactions.account, r.name)));
      await db.delete(accounts).where(and(eq(accounts.userId, userId), eq(accounts.id, r.id)));
    }
  }
}

export async function upsertAccount(
  userId: string,
  acc: { id: string; name: string; type: AccountType; balance: number; institution?: string },
): Promise<Account> {
  await db
    .insert(accounts)
    .values({
      id: acc.id,
      userId,
      name: acc.name,
      type: acc.type,
      balance: acc.balance,
      institution: acc.institution ?? null,
      // Paydown fields default to safe values for new accounts. Existing
      // accounts are NOT touched on these fields by the upsert (we only
      // update name/type/balance/institution on conflict).
      interestRate: 0,
      minPayment: 0,
      plannedPayment: 0,
      includeInPaydown: true,
      // Newly created SimpleFIN accounts are always visible. The sync
      // helper skips the upsert when the row already exists with
      // hidden=true (see `syncSimpleFinToDatabase`), so the user's hide
      // choice survives subsequent syncs.
      hidden: false,
    })
    .onConflictDoUpdate({
      target: accounts.id,
      set: {
        name: acc.name,
        type: acc.type,
        balance: acc.balance,
        institution: acc.institution ?? null,
      },
    });
  return {
    id: acc.id,
    name: acc.name,
    type: acc.type,
    balance: acc.balance,
    institution: acc.institution,
    interestRate: 0,
    minPayment: 0,
    plannedPayment: 0,
    includeInPaydown: true,
    hidden: false,
  };
}

// ---- Categories + Sub-categories ----------------------------------------

export async function getAllCategories(userId: string): Promise<MainCategory[]> {
  await seedInitialCategoriesIfEmpty(userId);
  const [mainRows, subRows] = await Promise.all([
    // Stable order: user-defined `sortOrder` first (drag-to-reorder),
    // then `name` as a tiebreaker. Both Budget and the Categories page
    // render this list in the same order.
    db
      .select()
      .from(categories)
      .where(eq(categories.userId, userId))
      .orderBy(asc(categories.sortOrder), asc(categories.name)),
    db.select().from(subCategories).where(eq(subCategories.userId, userId)),
  ]);
  const subMap = new Map<string, SubCategory[]>();
  for (const s of subRows) {
    const list = subMap.get(s.mainCategoryId) ?? [];
    list.push({ id: s.id, name: s.name, planned: s.planned, icon: s.icon ?? undefined });
    subMap.set(s.mainCategoryId, list);
  }
  return mainRows.map((m) => ({
    id: m.id,
    name: m.name,
    type: m.type,
    icon: m.icon ?? undefined,
    sortOrder: m.sortOrder,
    subCategories: subMap.get(m.id) ?? [],
  }));
}

export async function addMainCategory(
  userId: string,
  name: string,
  type: TransactionType,
  icon = 'Folder',
): Promise<MainCategory> {
  const id = `cat-${nanoid(10)}`;
  // New categories go to the end of the list. We pick max(sortOrder)+1
  // scoped to this user so the order stays compact and we don't have
  // to renumber anything else. A race here is harmless — the loser
  // of the SELECT-then-INSERT just gets the same number, and the next
  // reorder call evens things out.
  const [top] = await db
    .select({ sortOrder: categories.sortOrder })
    .from(categories)
    .where(eq(categories.userId, userId))
    .orderBy(sql`${categories.sortOrder} DESC`)
    .limit(1);
  const nextOrder = (top?.sortOrder ?? -1) + 1;
  await db.insert(categories).values({ id, userId, name, type, icon, sortOrder: nextOrder });
  return { id, name, type, icon, sortOrder: nextOrder, subCategories: [] };
}

export async function editMainCategory(userId: string, id: string, name: string): Promise<void> {
  await db
    .update(categories)
    .set({ name })
    .where(and(eq(categories.userId, userId), eq(categories.id, id)));
}

export async function deleteMainCategory(userId: string, id: string): Promise<void> {
  await db.delete(categories).where(and(eq(categories.userId, userId), eq(categories.id, id)));
}

/**
 * Persist a new user-defined ordering for the user's main categories.
 * `orderedIds[0]` becomes sortOrder 0, `orderedIds[1]` becomes 1, etc.
 * Categories not in the list keep their existing order (we only touch
 * the ones the user moved, so a partial reorder is safe).
 *
 * We use one UPDATE per id rather than a CASE expression to keep the
 * SQL portable and the per-row order obvious in pg logs.
 */
export async function reorderMainCategories(
  userId: string,
  orderedIds: string[],
): Promise<void> {
  // De-dupe + drop ids that don't belong to this user. The route layer
  // is the source of truth for membership; this is defense in depth.
  const unique = Array.from(new Set(orderedIds));
  for (let i = 0; i < unique.length; i++) {
    await db
      .update(categories)
      .set({ sortOrder: i })
      .where(and(eq(categories.userId, userId), eq(categories.id, unique[i]!)));
  }
}

export async function addSubCategory(
  userId: string,
  mainCategoryId: string,
  name: string,
  planned: number,
): Promise<SubCategory> {
  const id = `sub-${nanoid(10)}`;
  await db.insert(subCategories).values({ id, userId, mainCategoryId, name, planned });
  return { id, name, planned };
}

export async function editSubCategory(
  userId: string,
  mainCategoryId: string,
  subCategoryId: string,
  name: string,
  planned: number,
): Promise<void> {
  await db
    .update(subCategories)
    .set({ name, planned })
    .where(
      and(
        eq(subCategories.userId, userId),
        eq(subCategories.id, subCategoryId),
        eq(subCategories.mainCategoryId, mainCategoryId),
      ),
    );
}

export async function deleteSubCategory(userId: string, subCategoryId: string): Promise<void> {
  await db
    .delete(subCategories)
    .where(and(eq(subCategories.userId, userId), eq(subCategories.id, subCategoryId)));
}

// ---- Transactions -------------------------------------------------------

export async function getAllTransactions(userId: string): Promise<Transaction[]> {
  // Transactions store the account as a name (not an id), so we
  // resolve display + visibility in one pass via an in-memory map of
  // { name → { hidden, alias } }. Per-user account lists are tiny
  // (typically < 10 rows) so this is cheaper than a NOT EXISTS
  // subquery, and it lets the user's alias flow through to historical
  // transactions without rewriting the ledger.
  const meta = new Map<string, { hidden: boolean; alias: string | null }>();
  for (const r of await db
    .select({ name: accounts.name, hidden: accounts.hidden, alias: accounts.alias })
    .from(accounts)
    .where(eq(accounts.userId, userId))) {
    meta.set(r.name, { hidden: r.hidden, alias: r.alias ?? null });
  }
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.date), desc(transactions.id));
  return rows
    // Drop transactions whose account is hidden.
    .filter((r) => !meta.get(r.account)?.hidden)
    .map((r) => ({
      id: r.id,
      date: r.date,
      merchant: r.merchant,
      category: r.category,
      subCategory: r.subCategory ?? undefined,
      // Resolve alias on read so renaming flows through to every
      // historical transaction. Falls back to the raw account name
      // when no alias is set or the account no longer exists.
      account: meta.get(r.account)?.alias || r.account,
      amount: r.amount,
      type: r.type,
      notes: r.notes ?? undefined,
    }));
}

/**
 * Filters accepted by `listTransactions`. Every field is optional;
 * unset fields mean "no filter on this dimension". Designed for the
 * Transactions page filter popover.
 *
 *   - `types`       — multi-select (income / expense / transfer). Empty
 *                     array means "no type filter" (NOT "match nothing").
 *   - `account`     — exact account name match (NOT alias — the alias
 *                     is a display-only override).
 *   - `category`    — main category name. When `subCategory` is also
 *                     set, both must match.
 *   - `subCategory` — sub-category name, paired with `category`.
 *   - `merchant`    — exact merchant name (the dropdown is populated
 *                     from `getDistinctMerchants`, which returns the
 *                     exact set the user has in their ledger).
 *   - `minAmount` /
 *     `maxAmount`   — inclusive range; either may be omitted.
 *   - `q`           — free-text substring match against merchant,
 *                     category, sub-category, and account name (alias
 *                     resolved server-side so the user can search by
 *                     their renamed account label).
 */
export interface TransactionFilters {
  types?: TransactionType[];
  account?: string;
  category?: string;
  subCategory?: string;
  merchant?: string;
  minAmount?: number;
  maxAmount?: number;
  q?: string;
}

/**
 * Paginated transaction list for the Transactions page. Returns
 * `{ rows, total }` so the client can render "Page X of Y" without a
 * second round-trip.
 *
 * Pagination is applied AFTER the hidden-account + filter WHERE so the
 * `total` matches what the user actually sees. We use SQL `NOT IN
 * (hidden names)` rather than in-memory filtering because LIMIT/OFFSET
 * in SQL has to know the filtered count up front to land on the right
 * row.
 *
 * `limit` is clamped to [1, 100] and `offset` is clamped to [0, total]
 * so a malformed query param can't blow up the query or the page.
 */
export async function listTransactions(
  userId: string,
  options: { limit?: number; offset?: number; filters?: TransactionFilters } = {},
): Promise<{ rows: Transaction[]; total: number }> {
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 25)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const filters = options.filters ?? {};

  // Build the { name → { hidden, alias } } map once. Reused for the
  // count + the page query so the alias resolution stays identical
  // to `getAllTransactions`.
  const metaRows = await db
    .select({ name: accounts.name, hidden: accounts.hidden, alias: accounts.alias })
    .from(accounts)
    .where(eq(accounts.userId, userId));
  const meta = new Map<string, { hidden: boolean; alias: string | null }>();
  for (const r of metaRows) meta.set(r.name, { hidden: r.hidden, alias: r.alias ?? null });
  const hiddenNames = Array.from(meta.entries()).filter(([, v]) => v.hidden).map(([k]) => k);

  // Build the filter WHERE clauses. Each push is a separate condition
  // joined with AND; empty arrays / empty strings are skipped (not
  // treated as "match nothing").
  const conds = [eq(transactions.userId, userId)];
  if (hiddenNames.length > 0) conds.push(notInArray(transactions.account, hiddenNames));
  if (filters.types && filters.types.length > 0) conds.push(inArray(transactions.type, filters.types));
  if (filters.account) conds.push(eq(transactions.account, filters.account));
  if (filters.category) conds.push(eq(transactions.category, filters.category));
  if (filters.subCategory) conds.push(eq(transactions.subCategory, filters.subCategory));
  if (filters.merchant) conds.push(eq(transactions.merchant, filters.merchant));
  if (typeof filters.minAmount === 'number' && Number.isFinite(filters.minAmount)) {
    conds.push(gte(transactions.amount, filters.minAmount));
  }
  if (typeof filters.maxAmount === 'number' && Number.isFinite(filters.maxAmount)) {
    conds.push(lte(transactions.amount, filters.maxAmount));
  }
  // Free-text search. Aliases resolve to the underlying account name
  // server-side so a user who renamed "Chase Sapphire" → "Card" can
  // still find those transactions by typing either string. Empty /
  // whitespace-only queries are skipped.
  const q = filters.q?.trim();
  if (q) {
    const needle = `%${q}%`;
    // Resolve the alias to its canonical name so the OR list catches
    // accounts the user has renamed via the alias editor.
    const aliasMatch = Array.from(meta.entries())
      .filter(([, v]) => v.alias?.toLowerCase().includes(q.toLowerCase()))
      .map(([k]) => k);
    const orClauses = [
      like(transactions.merchant, needle),
      like(transactions.category, needle),
      like(transactions.subCategory, needle),
    ];
    if (aliasMatch.length > 0) {
      orClauses.push(inArray(transactions.account, aliasMatch));
    } else {
      orClauses.push(like(transactions.account, needle));
    }
    conds.push(sql`(${sql.join(orClauses, sql` OR `)})`);
  }
  const whereClause = and(...conds);

  // Total count first so we can clamp `offset` before issuing the
  // SELECT — avoids fetching an empty page when the user navigates
  // past the end after adding a transaction.
  const totalRows = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(transactions)
    .where(whereClause);
  const total = totalRows[0]?.count ?? 0;
  const clampedOffset = Math.min(offset, total);

  const dbRows = await db
    .select()
    .from(transactions)
    .where(whereClause)
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(limit)
    .offset(clampedOffset);

  const rows: Transaction[] = dbRows.map((r) => ({
    id: r.id,
    date: r.date,
    merchant: r.merchant,
    category: r.category,
    subCategory: r.subCategory ?? undefined,
    account: meta.get(r.account)?.alias || r.account,
    amount: r.amount,
    type: r.type,
    notes: r.notes ?? undefined,
  }));

  return { rows, total };
}

/**
 * Distinct merchant names from a user's ledger, alphabetically sorted.
 * Drives the merchant filter dropdown on the Transactions page so the
 * user can pick specific merchants instead of typing substrings (the
 * main search bar still handles free-text merchant search).
 */
export async function getDistinctMerchants(userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ merchant: transactions.merchant })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(asc(transactions.merchant));
  return rows.map((r) => r.merchant).filter((m): m is string => m.length > 0);
}

export async function addTransaction(
  userId: string,
  tx: Omit<Transaction, 'id'>,
): Promise<Transaction> {
  const id = `tx-${Date.now()}-${nanoid(4)}`;
  await db.insert(transactions).values({
    id,
    userId,
    date: tx.date,
    merchant: tx.merchant,
    category: tx.category,
    subCategory: tx.subCategory ?? null,
    account: tx.account,
    amount: tx.amount,
    type: tx.type,
    notes: tx.notes ?? null,
    // Manual entry — the user already chose the category and merchant
    // themselves, so there's nothing to "review". Default per schema
    // is FALSE; explicit here for clarity.
    needsReview: false,
  });
  return { ...tx, id };
}

export async function editTransaction(
  userId: string,
  id: string,
  patch: Partial<Transaction>,
): Promise<{ ruleCreated: boolean }> {
  const [existing] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.id, id)))
    .limit(1);
  if (!existing) return { ruleCreated: false };
  // An inline edit on a row that was awaiting review is an
  // implicit acknowledgement — drop it from the queue. The PATCH
  // endpoint is the only path that touches an existing row, and
  // it can only be reached by an authenticated user (per guard.ts).
  const implicitReview = existing.needsReview;
  // Auto-train the rule system when the inline edit changes the
  // category on a row that was awaiting review. Same contract as
  // markTransactionReviewed: every review-style categorization is
  // an opportunity to lock the merchant → category mapping in. The
  // category must actually change (no point creating a rule for
  // the same value the row already had) and the row must have been
  // pending — non-pending inline edits are not part of the review
  // flow and the user can opt in via the "Create rule?" popup.
  const categoryChangedOnPendingRow =
    implicitReview
    && patch.category !== undefined
    && patch.category !== existing.category;
  await db
    .update(transactions)
    .set({
      date: patch.date ?? existing.date,
      merchant: patch.merchant ?? existing.merchant,
      category: patch.category ?? existing.category,
      subCategory: patch.subCategory !== undefined ? (patch.subCategory ?? null) : existing.subCategory,
      account: patch.account ?? existing.account,
      amount: patch.amount ?? existing.amount,
      type: patch.type ?? existing.type,
      notes: patch.notes !== undefined ? (patch.notes ?? null) : existing.notes,
      ...(implicitReview ? { needsReview: false } : {}),
    })
    .where(and(eq(transactions.userId, userId), eq(transactions.id, id)));

  let ruleCreated = false;
  if (categoryChangedOnPendingRow && patch.category) {
    const finalMerchant = patch.merchant ?? existing.merchant;
    const finalSubCategory =
      patch.subCategory !== undefined
        ? patch.subCategory ?? undefined
        : existing.subCategory ?? undefined;
    const result = await createRuleIfMissing(
      userId,
      finalMerchant,
      patch.category,
      finalSubCategory,
    );
    ruleCreated = result.created;
  }
  return { ruleCreated };
}

export async function deleteTransaction(userId: string, id: string): Promise<void> {
  await db.delete(transactions).where(and(eq(transactions.userId, userId), eq(transactions.id, id)));
}

export async function addTransactionWithExternalId(
  userId: string,
  tx: Omit<Transaction, 'id'> & { externalId?: string },
): Promise<Transaction | null> {
  if (tx.externalId) {
    const [existing] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.externalId, tx.externalId))
      .limit(1);
    if (existing) return null;
  }
  const id = `tx-${Date.now()}-${nanoid(4)}`;
  await db.insert(transactions).values({
    id,
    userId,
    date: tx.date,
    merchant: tx.merchant,
    category: tx.category,
    subCategory: tx.subCategory ?? null,
    account: tx.account,
    amount: tx.amount,
    type: tx.type,
    notes: tx.notes ?? null,
    externalId: tx.externalId ?? null,
    // SimpleFIN imports land in the review queue so the user can
    // confirm or correct the smart categoriser's guess before it
    // pollutes the budget/dashboard aggregates. Deduping on
    // external_id means a re-pull never re-flags an existing row.
    needsReview: true,
  });
  return {
    id,
    date: tx.date,
    merchant: tx.merchant,
    category: tx.category,
    subCategory: tx.subCategory,
    account: tx.account,
    amount: tx.amount,
    type: tx.type,
    notes: tx.notes,
  };
}

// ---- Review queue -------------------------------------------------------
//
// The bell badge and the Transactions banner drive off these helpers.
// Counts and rows are filtered to `needs_review = TRUE` for the
// current user. Hidden-account transactions are excluded (the bell
// queue mirrors what the user would see on the Transactions page).

/**
 * Count of this user's transactions awaiting review. Hot path — the
 * bell runs this every 30s via React Query polling. Uses the
 * `(user_id, needs_review)` compound index for a single index-only
 * scan. Hidden-account rows are excluded so the queue mirrors what
 * the user can see on the Transactions page.
 */
export async function pendingReviewCount(userId: string): Promise<number> {
  const meta = new Map<string, boolean>();
  for (const r of await db
    .select({ name: accounts.name, hidden: accounts.hidden })
    .from(accounts)
    .where(eq(accounts.userId, userId))) {
    meta.set(r.name, r.hidden);
  }
  const countRows = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(transactions)
    .where(
      and(eq(transactions.userId, userId), eq(transactions.needsReview, true)),
    );
  const count = countRows[0]?.count ?? 0;
  // Subtract hidden-account rows in memory — typically a small number.
  if (count === 0) return 0;
  const rows = await db
    .select({ account: transactions.account })
    .from(transactions)
    .where(
      and(eq(transactions.userId, userId), eq(transactions.needsReview, true)),
    );
  const visible = rows.filter((r) => !meta.get(r.account)).length;
  return visible;
}

/**
 * List of the user's transactions awaiting review. Same row shape as
 * `getAllTransactions` (alias-aware account display). Ordered newest
 * first so the carousel starts at the most recent item.
 *
 * `limit` clamps to [1, 200]. The UI defaults to 100 to bound the
 * carousel; the bell doesn't use this — it only needs the count.
 */
export async function listReviewQueue(
  userId: string,
  opts: { limit?: number } = {},
): Promise<Transaction[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
  const meta = new Map<string, { hidden: boolean; alias: string | null }>();
  for (const r of await db
    .select({ name: accounts.name, hidden: accounts.hidden, alias: accounts.alias })
    .from(accounts)
    .where(eq(accounts.userId, userId))) {
    meta.set(r.name, { hidden: r.hidden, alias: r.alias ?? null });
  }
  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(eq(transactions.userId, userId), eq(transactions.needsReview, true)),
    )
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(limit);
  return rows
    .filter((r) => !meta.get(r.account)?.hidden)
    .map((r) => ({
      id: r.id,
      date: r.date,
      merchant: r.merchant,
      category: r.category,
      subCategory: r.subCategory ?? undefined,
      account: meta.get(r.account)?.alias || r.account,
      amount: r.amount,
      type: r.type,
      notes: r.notes ?? undefined,
    }));
}

/**
 * Mark a transaction as reviewed. Optionally patch its category,
 * sub-category, and type in the same call — the carousel's "Categorize"
 * button sends the user's pick here in one round-trip; "Skip" sends
 * an empty patch.
 *
 * Atomic SQL UPDATE with `user_id` predicate so a malicious caller
 * can't mark someone else's transaction reviewed. Returns the
 * refreshed row in the same shape as `getAllTransactions`, or null
 * if the row didn't exist / didn't belong to the user.
 */
export async function markTransactionReviewed(
  userId: string,
  id: string,
  patch: { category?: string; subCategory?: string | null; type?: TransactionType } = {},
): Promise<Transaction | null> {
  const [existing] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.id, id)))
    .limit(1);
  if (!existing) return null;

  // Auto-train the rule system on the user's review decision. When
  // the user categorizes a previously-pending row, treat that
  // pick as confirmation that this merchant belongs in this bucket
  // — every future import of the same merchant will be auto-
  // categorized and skip the review queue. Skip the "skip" action
  // (no category provided) and skip when a rule already exists for
  // the merchant (the user has already trained us, don't overwrite
  // any customisation they made via the Rules page).
  if (existing.needsReview && patch.category !== undefined) {
    const finalCategory = patch.category;
    const finalSubCategory =
      patch.subCategory !== undefined
        ? patch.subCategory ?? undefined
        : existing.subCategory ?? undefined;
    await createRuleIfMissing(
      userId,
      existing.merchant,
      finalCategory,
      finalSubCategory,
    );
  }

  const accountMeta = await db
    .select({ hidden: accounts.hidden, alias: accounts.alias })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.name, existing.account)))
    .limit(1);
  await db
    .update(transactions)
    .set({
      needsReview: false,
      category: patch.category ?? existing.category,
      subCategory:
        patch.subCategory !== undefined
          ? patch.subCategory ?? null
          : existing.subCategory,
      type: patch.type ?? existing.type,
    })
    .where(and(eq(transactions.userId, userId), eq(transactions.id, id)));
  return {
    id: existing.id,
    date: existing.date,
    merchant: existing.merchant,
    category: patch.category ?? existing.category,
    subCategory:
      patch.subCategory !== undefined
        ? patch.subCategory ?? undefined
        : existing.subCategory ?? undefined,
    account: accountMeta[0]?.alias || existing.account,
    amount: existing.amount,
    type: patch.type ?? existing.type,
    notes: existing.notes ?? undefined,
  };
}

// ---- Settings (key-value) -----------------------------------------------

export async function getSetting(userId: string, key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, key)))
    .limit(1);
  return row?.value ?? null;
}

export async function setSetting(userId: string, key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ userId, key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [settings.userId, settings.key],
      set: { value, updatedAt: new Date() },
    });
}

export async function deleteSetting(userId: string, key: string): Promise<void> {
  await db.delete(settings).where(and(eq(settings.userId, userId), eq(settings.key, key)));
}

// ---- Monthly paydown snapshots -----------------------------------------
//
// Populated by the Pay down page's "Save to Budget" button. Read by the
// Budget page's Pay down modal to render per-account planned for the
// selected month. Per-month so the user can plan different debt
// payments each month without overwriting the next.

export interface MonthlyPaydownRow {
  accountId: string;
  planned: number;
}

export async function getMonthlyPaydown(userId: string, yearMonth: string): Promise<MonthlyPaydownRow[]> {
  const rows = await db
    .select()
    .from(monthlyPaydown)
    .where(and(eq(monthlyPaydown.userId, userId), eq(monthlyPaydown.yearMonth, yearMonth)));
  return rows.map((r) => ({ accountId: r.accountId, planned: r.planned }));
}

export async function getPaydownSnapshotMeta(
  userId: string,
  yearMonth: string,
): Promise<{ syncedAt: Date; rowCount: number } | null> {
  const [row] = await db
    .select()
    .from(monthlyPaydownSnapshots)
    .where(and(eq(monthlyPaydownSnapshots.userId, userId), eq(monthlyPaydownSnapshots.yearMonth, yearMonth)))
    .limit(1);
  if (!row) return null;
  return { syncedAt: row.syncedAt, rowCount: row.rowCount };
}

/**
 * Snapshot every credit/loan account with `includeInPaydown=true` into
 * `monthly_paydown` for the given month, reading the planned value from
 * `accounts.plannedPayment`. Idempotent — re-running just upserts.
 *
 * Returns the number of accounts snapshotted so the route can surface
 * a useful toast.
 */
export async function syncMonthlyPaydown(userId: string, yearMonth: string): Promise<{ rowCount: number; syncedAt: Date }> {
  const rows = await db
    .select({ id: accounts.id, type: accounts.type, plannedPayment: accounts.plannedPayment, minPayment: accounts.minPayment })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.includeInPaydown, true)));
  const snapshottable = rows.filter((r) => r.type === 'credit' || r.type === 'loan');

  const syncedAt = new Date();

  if (snapshottable.length === 0) {
    // Still record the snapshot so the UI shows "Last synced: just now".
    await db
      .insert(monthlyPaydownSnapshots)
      .values({ userId, yearMonth, syncedAt, rowCount: 0 })
      .onConflictDoUpdate({
        target: [monthlyPaydownSnapshots.userId, monthlyPaydownSnapshots.yearMonth],
        set: { syncedAt, rowCount: 0 },
      });
    return { rowCount: 0, syncedAt };
  }

  await db.transaction(async (tx) => {
    for (const row of snapshottable) {
      // Fall back to minPayment when plannedPayment is 0 — matches the
      // scenario path in syncMonthlyPaydownWithScenario so accounts that
      // rely on the minimum are never snapshotted as $0.
      const planned = row.plannedPayment > 0 ? row.plannedPayment : row.minPayment;
      await tx
        .insert(monthlyPaydown)
        .values({
          userId,
          accountId: row.id,
          yearMonth,
          planned,
          updatedAt: syncedAt,
        })
        .onConflictDoUpdate({
          target: [monthlyPaydown.userId, monthlyPaydown.accountId, monthlyPaydown.yearMonth],
          set: { planned, updatedAt: syncedAt },
        });
    }
    await tx
      .insert(monthlyPaydownSnapshots)
      .values({ userId, yearMonth, syncedAt, rowCount: snapshottable.length })
      .onConflictDoUpdate({
        target: [monthlyPaydownSnapshots.userId, monthlyPaydownSnapshots.yearMonth],
        set: { syncedAt, rowCount: snapshottable.length },
      });
  });

  return { rowCount: snapshottable.length, syncedAt };
}

/**
 * Save-to-Budget under an active scenario. Same shape as
 * `syncMonthlyPaydown` but each account's planned value is computed
 * from the active calculator scenario:
 *
 *   - Priority account (index 0 in the method's order): base + extras,
 *     capped at the current balance so the budget never exceeds what
 *     the user could actually pay this month.
 *   - Other accounts: just their base (plannedPayment or minPayment).
 *   - Planned method: extras are ignored — every account gets base.
 *
 * Reuses `priorityOrder` from `@/lib/paydown` so the account that gets
 * the extra is exactly the account the projection targets. No
 * migration needed — `monthly_paydown` already stores the planned
 * amount per account.
 */
export async function syncMonthlyPaydownWithScenario(
  userId: string,
  yearMonth: string,
  method: PaydownMethod,
  monthlyExtra: number,
  oneTimeExtra: number,
): Promise<{ rowCount: number; syncedAt: Date; allocation: { accountId: string; planned: number }[] }> {
  // Same row shape as `getLiabilityAccounts` but we need balance too
  // for the priority order + the cap. Reuses the same filter logic
  // (includeInPaydown + credit/loan + hidden=false).
  const liabilityRows = await getLiabilityAccounts(userId);

  const active: Parameters<typeof priorityOrder>[1] = liabilityRows
    .filter((a) => a.includeInPaydown && a.balance > 0)
    .map((a) => ({
      id: a.id,
      name: a.name,
      type: (a.type === 'loan' ? 'loan' : 'credit') as 'credit' | 'loan',
      balance: a.balance,
      apr: a.interestRate,
      minPayment: a.minPayment,
      plannedPayment: a.plannedPayment,
      includeInPaydown: a.includeInPaydown,
    }));

  const syncedAt = new Date();

  if (active.length === 0) {
    await db
      .insert(monthlyPaydownSnapshots)
      .values({ userId, yearMonth, syncedAt, rowCount: 0 })
      .onConflictDoUpdate({
        target: [monthlyPaydownSnapshots.userId, monthlyPaydownSnapshots.yearMonth],
        set: { syncedAt, rowCount: 0 },
      });
    return { rowCount: 0, syncedAt, allocation: [] };
  }

  // Priority order under the chosen method (highest APR for avalanche,
  // smallest balance for snowball, empty for planned).
  const balances: Record<string, number> = {};
  for (const a of active) balances[a.id] = a.balance;
  const order = priorityOrder(method, active, balances);
  const priorityId = order[0];

  const allocation: { accountId: string; planned: number }[] = [];
  for (const a of active) {
    const base = a.plannedPayment > 0 ? a.plannedPayment : a.minPayment;
    let planned = base;
    if (a.id === priorityId && method !== 'planned') {
      const desired = base + Math.max(0, monthlyExtra) + Math.max(0, oneTimeExtra);
      // Cap at the remaining balance so the budget never exceeds what
      // the user could pay down this month. Round to cents to keep the
      // stored value clean.
      planned = Math.max(0, Math.min(a.balance, Math.round(desired * 100) / 100));
    }
    allocation.push({ accountId: a.id, planned });
  }

  await db.transaction(async (tx) => {
    for (const row of allocation) {
      await tx
        .insert(monthlyPaydown)
        .values({
          userId,
          accountId: row.accountId,
          yearMonth,
          planned: row.planned,
          updatedAt: syncedAt,
        })
        .onConflictDoUpdate({
          target: [monthlyPaydown.userId, monthlyPaydown.accountId, monthlyPaydown.yearMonth],
          set: { planned: row.planned, updatedAt: syncedAt },
        });
    }
    await tx
      .insert(monthlyPaydownSnapshots)
      .values({ userId, yearMonth, syncedAt, rowCount: allocation.length })
      .onConflictDoUpdate({
        target: [monthlyPaydownSnapshots.userId, monthlyPaydownSnapshots.yearMonth],
        set: { syncedAt, rowCount: allocation.length },
      });
  });

  return { rowCount: allocation.length, syncedAt, allocation };
}

export interface PaydownModalRow {
  accountId: string;
  accountName: string;
  type: 'credit' | 'loan';
  apr: number;
  planned: number;
  actual: number;
  remaining: number;
}

export interface PaydownModalData {
  rows: PaydownModalRow[];
  meta: { syncedAt: Date | null; rowCount: number };
}

/**
 * Read everything the Budget page's Pay down modal needs in one call:
 *   - per-account planned (from `monthly_paydown` snapshot, falling back
 *     to `accounts.plannedPayment` when no snapshot exists yet),
 *   - per-account actual = sum of `type='transfer'` transactions on the
 *     account in the month,
 *   - snapshot metadata (syncedAt + rowCount) for the "Last synced" UI.
 *
 * Hidden accounts are excluded at SQL via the same `includeInPaydown`
 * filter the route already enforces (hidden accounts are silently
 * filtered from every read view per the AGENTS.md rule).
 */
export async function getPaydownModalData(userId: string, yearMonth: string): Promise<PaydownModalData> {
  const monthStart = `${yearMonth}-01`;
  const monthEnd = endOfMonth(yearMonth);

  const liabilityRows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      alias: accounts.alias,
      type: accounts.type,
      interestRate: accounts.interestRate,
      plannedPayment: accounts.plannedPayment,
      minPayment: accounts.minPayment,
      includeInPaydown: accounts.includeInPaydown,
      hidden: accounts.hidden,
    })
    .from(accounts)
    .where(eq(accounts.userId, userId));

  const visible = liabilityRows.filter(
    (r) =>
      (r.type === 'credit' || r.type === 'loan') &&
      !r.hidden &&
      r.includeInPaydown,
  );

  if (visible.length === 0) {
    const meta = await getPaydownSnapshotMeta(userId, yearMonth);
    return {
      rows: [],
      meta: meta ? { syncedAt: meta.syncedAt, rowCount: meta.rowCount } : { syncedAt: null, rowCount: 0 },
    };
  }

  const visibleIds = visible.map((r) => r.id);
  const visibleNames = visible.map((r) => r.name);

  const snapshotRows = await db
    .select()
    .from(monthlyPaydown)
    .where(
      and(
        eq(monthlyPaydown.userId, userId),
        eq(monthlyPaydown.yearMonth, yearMonth),
        inArray(monthlyPaydown.accountId, visibleIds),
      ),
    );
  const snapshotByAccount = new Map(snapshotRows.map((r) => [r.accountId, r.planned]));

  const actualRows = await db
    .select({
      account: transactions.account,
      total: sql<number>`SUM(${transactions.amount})`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.type, 'transfer'),
        gte(transactions.date, monthStart),
        lte(transactions.date, monthEnd),
        inArray(transactions.account, visibleNames),
      ),
    )
    .groupBy(transactions.account);
  const actualByName = new Map(actualRows.map((r) => [r.account, Number(r.total)]));

  const meta = await getPaydownSnapshotMeta(userId, yearMonth);

  const rows: PaydownModalRow[] = visible.map((a) => {
    const planned = snapshotByAccount.get(a.id) ?? (a.plannedPayment > 0 ? a.plannedPayment : a.minPayment);
    const actual = actualByName.get(a.name) ?? 0;
    return {
      accountId: a.id,
      accountName: a.alias ?? a.name,
      type: a.type === 'loan' ? 'loan' : 'credit',
      apr: a.interestRate,
      planned,
      actual,
      remaining: planned - actual,
    };
  });

  return {
    rows,
    meta: meta ? { syncedAt: meta.syncedAt, rowCount: meta.rowCount } : { syncedAt: null, rowCount: 0 },
  };
}

// ---- Goals -------------------------------------------------------------

export interface Goal {
  id: string;
  name: string;
  target: number;
  startingValue: number;
  accountId: string | null;
  // The live balance of the watched account, looked up at read time so
  // the progress bar always reflects the freshest figure. Null when
  // the account was deleted/hidden — the UI renders a notice instead
  // of a progress bar in that case.
  accountBalance: number | null;
  accountName: string | null;
}

/**
 * Fetch every goal for the user, with the watched account's current
 * balance joined in. We do the join in code rather than SQL because:
 *   1. The account might be hidden — we still want to return the goal
 *      (with a NULL balance) so the user can re-attach via edit.
 *   2. The account might be deleted — same story.
 *   3. The set is small (goals are personal; ~5-20 rows typical).
 */
export async function getAllGoals(userId: string): Promise<Goal[]> {
  const [goalRows, accountRows] = await Promise.all([
    db.select().from(goals).where(eq(goals.userId, userId)).orderBy(asc(goals.createdAt)),
    db.select({ id: accounts.id, name: accounts.name, balance: accounts.balance }).from(accounts).where(eq(accounts.userId, userId)),
  ]);
  const byId = new Map<string, { name: string; balance: number }>();
  for (const a of accountRows) byId.set(a.id, { name: a.name, balance: a.balance });
  return goalRows.map((g) => {
    const acc = g.accountId ? byId.get(g.accountId) : undefined;
    return {
      id: g.id,
      name: g.name,
      target: g.target,
      startingValue: g.startingValue,
      accountId: g.accountId,
      accountBalance: acc ? acc.balance : null,
      accountName: acc ? acc.name : null,
    };
  });
}

export async function addGoal(
  userId: string,
  input: { name: string; target: number; startingValue: number; accountId: string | null },
): Promise<Goal> {
  const id = `goal-${nanoid(10)}`;
  await db.insert(goals).values({
    id,
    userId,
    name: input.name,
    target: input.target,
    startingValue: input.startingValue,
    accountId: input.accountId,
  });
  return {
    id,
    name: input.name,
    target: input.target,
    startingValue: input.startingValue,
    accountId: input.accountId,
    // New goal — balance comes from the joined read, not the add.
    accountBalance: null,
    accountName: null,
  };
}

export async function editGoal(
  userId: string,
  id: string,
  patch: { name?: string; target?: number; startingValue?: number; accountId?: string | null },
): Promise<void> {
  const [existing] = await db
    .select()
    .from(goals)
    .where(and(eq(goals.userId, userId), eq(goals.id, id)))
    .limit(1);
  if (!existing) return;
  await db
    .update(goals)
    .set({
      name: patch.name ?? existing.name,
      target: patch.target ?? existing.target,
      startingValue: patch.startingValue ?? existing.startingValue,
      // `accountId` uses the explicit `null` check so the user can
      // detach the goal from its watched account. `undefined` means
      // "don't touch"; `null` means "clear".
      accountId:
        patch.accountId === undefined
          ? existing.accountId
          : patch.accountId === null
            ? null
            : patch.accountId,
    })
    .where(and(eq(goals.userId, userId), eq(goals.id, id)));
}

export async function deleteGoal(userId: string, id: string): Promise<void> {
  await db.delete(goals).where(and(eq(goals.userId, userId), eq(goals.id, id)));
}

// ---- Rules -------------------------------------------------------------
//
// User-defined "always set this merchant to this category" mappings.
// Applied at import time (SimpleFIN + manual add) so the user only has
// to categorise a merchant once. The Transactions page uses
// `findRuleForMerchant` to decide whether to show the "Create rule?"
// prompt after an inline category change — a rule already exists for
// the merchant means the user has already gone through this flow.

export interface Rule {
  id: string;
  matchType: 'exact';
  matchValue: string;
  category: string;
  subCategory?: string;
  createdAt: Date;
}

/** All rules for the user, ordered by creation time. */
export async function listRules(userId: string): Promise<Rule[]> {
  const rows = await db
    .select()
    .from(rules)
    .where(eq(rules.userId, userId))
    .orderBy(asc(rules.matchValue));
  return rows.map((r) => ({
    id: r.id,
    matchType: 'exact',
    matchValue: r.matchValue,
    category: r.category,
    subCategory: r.subCategory ?? undefined,
    createdAt: r.createdAt,
  }));
}

export async function createRule(
  userId: string,
  input: { matchType?: 'exact'; matchValue: string; category: string; subCategory?: string },
): Promise<Rule> {
  const id = `rule-${nanoid(10)}`;
  const matchType = input.matchType ?? 'exact';
  const trimmed = input.matchValue.trim();
  if (!trimmed) throw new Error('matchValue must not be empty');
  await db.insert(rules).values({
    id,
    userId,
    matchType,
    matchValue: trimmed,
    category: input.category,
    subCategory: input.subCategory ?? null,
  });
  return {
    id,
    matchType: 'exact',
    matchValue: trimmed,
    category: input.category,
    subCategory: input.subCategory,
    createdAt: new Date(),
  };
}

export async function editRule(
  userId: string,
  id: string,
  patch: { matchValue?: string; category?: string; subCategory?: string | null },
): Promise<void> {
  const [existing] = await db
    .select()
    .from(rules)
    .where(and(eq(rules.userId, userId), eq(rules.id, id)))
    .limit(1);
  if (!existing) return;
  await db
    .update(rules)
    .set({
      matchValue: patch.matchValue?.trim() ?? existing.matchValue,
      category: patch.category ?? existing.category,
      // `subCategory` uses the explicit `null` check so the user can
      // clear the sub-category on a rule (e.g. promote it to the parent
      // category only). `undefined` means "don't touch".
      subCategory:
        patch.subCategory === undefined
          ? existing.subCategory
          : patch.subCategory === null
            ? null
            : patch.subCategory,
    })
    .where(and(eq(rules.userId, userId), eq(rules.id, id)));
}

export async function deleteRule(userId: string, id: string): Promise<void> {
  await db.delete(rules).where(and(eq(rules.userId, userId), eq(rules.id, id)));
}

/**
 * Auto-train the rule system on a user categorization. Looks up the
 * rule for the given merchant (case-insensitive exact match); if none
 * exists, inserts one with the supplied category / sub-category.
 * Returns `{ created: true, rule }` when a new rule was written and
 * `{ created: false, rule: null }` when an existing rule already
 * covers this merchant.
 *
 * Used by the review flow (`markTransactionReviewed` and the implicit-
 * review path inside `editTransaction`) so the first time the user
 * categorizes a previously-pending transaction, future imports of the
 * same merchant are auto-categorized and skip the review queue
 * altogether. The "if missing" check is the contract: callers do not
 * need to know whether a rule pre-exists, and we never overwrite a
 * rule the user has already customised. Returns the inserted rule so
 * the caller can log it with the same shape used elsewhere.
 */
export async function createRuleIfMissing(
  userId: string,
  matchValue: string,
  category: string,
  subCategory?: string,
): Promise<{ created: boolean; rule: Rule | null }> {
  const trimmed = matchValue.trim();
  if (!trimmed || !category) return { created: false, rule: null };
  const existing = await findRuleForMerchant(userId, trimmed);
  if (existing) return { created: false, rule: null };
  const rule = await createRule(userId, {
    matchType: 'exact',
    matchValue: trimmed,
    category,
    subCategory,
  });
  return { created: true, rule };
}

/**
 * Look up the rule that applies to a given merchant (if any). Case-
 * insensitive `LOWER() = LOWER()` so the user can categorise "Whole
 * Foods Market" and have it match a transaction labelled "WHOLE FOODS
 * MARKET #12345" without separate rules per casing.
 *
 * Used at import time (SimpleFIN + manual add) and by the Transactions
 * popup-trigger check ("does a rule already exist for this merchant?").
 */
export async function findRuleForMerchant(
  userId: string,
  merchant: string,
): Promise<Pick<Rule, 'category' | 'subCategory'> | null> {
  if (!merchant) return null;
  const [row] = await db
    .select({ category: rules.category, subCategory: rules.subCategory })
    .from(rules)
    .where(
      and(
        eq(rules.userId, userId),
        eq(rules.matchType, 'exact'),
        sql`LOWER(${rules.matchValue}) = LOWER(${merchant})`,
      ),
    )
    .limit(1);
  if (!row) return null;
  return { category: row.category, subCategory: row.subCategory ?? undefined };
}

/**
 * Re-apply a single rule to every matching transaction in the user's
 * ledger. The "Run" (▶) button on the Rules page. Returns the number
 * of rows whose category/subCategory was actually changed so the route
 * can show an accurate "Updated N transactions" toast — clicking Run
 * twice in a row reports `0` on the second click, since every
 * matching row already matches.
 *
 * A row is "already adjusted" when its category + subCategory equal
 * the rule's, so we skip those. This is idempotent Run semantics: the
 * user gets truthful feedback and can re-Run freely. Manual edits the
 * user has made to specific transactions (overriding the rule) are
 * preserved — Run won't silently undo them. `IS DISTINCT FROM`
 * handles NULL safely so a rule with no sub-category matches a row
 * with no sub-category (no-op), but a rule with a sub-category
 * updates a row missing one.
 *
 * Match is case-insensitive on `LOWER(merchant) = LOWER(match_value)`
 * so the run catches every spelling variant the user has in their
 * history.
 */
export async function applyRuleToAllMatchingTransactions(
  userId: string,
  ruleId: string,
): Promise<{ updated: number }> {
  const [rule] = await db
    .select()
    .from(rules)
    .where(and(eq(rules.userId, userId), eq(rules.id, ruleId)))
    .limit(1);
  if (!rule) throw new Error('Rule not found');
  const result = await db
    .update(transactions)
    .set({
      category: rule.category,
      subCategory: rule.subCategory,
    })
    .where(
      and(
        eq(transactions.userId, userId),
        sql`LOWER(${transactions.merchant}) = LOWER(${rule.matchValue})`,
        // Skip rows that already match — Run is idempotent.
        sql`(${transactions.category} <> ${rule.category} OR ${transactions.subCategory} IS DISTINCT FROM ${rule.subCategory})`,
      ),
    );
  return { updated: Number(result.count ?? 0) };
}

// ---- Users (admin) ------------------------------------------------------

/** True if this user has a credential (email/password) account row. */
export async function userHasCredential(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: authAccount.id })
    .from(authAccount)
    .where(and(eq(authAccount.userId, userId), eq(authAccount.providerId, 'credential')))
    .limit(1);
  return rows.length > 0;
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: string | null;
  createdAt: Date;
  hasCredential: boolean;
  /** Comma-separated list of provider IDs (e.g. "pocketid,credential"). */
  providers: string;
  /** True when demoting/deleting this admin would lock the operator out. */
  isProtected: boolean;
  /** Why this admin is locked (used for the UI tooltip). */
  protectionReason: AdminProtectionReason | null;
}

export type AdminProtectionReason =
  | 'last_admin'
  | 'last_local_admin'
  | 'last_oidc_admin_when_local_disabled';

/**
 * Single source of truth for the "can this admin be removed?" question.
 * Used by the role-change + delete guards and by the admin UI's lock icon,
 * so the UI and the server can't disagree about who is protected.
 *
 * Rules:
 *   - Non-admin users are never protected.
 *   - The last remaining admin overall is always protected (would leave
 *     the instance with zero admins).
 *   - A local admin is protected when they are the only local admin AND
 *     local auth is still enabled (they are the only recovery path).
 *   - An OIDC admin is protected when they are the only OIDC admin AND
 *     local auth is disabled (they are the only sign-in path).
 */
export function computeIsProtected(
  user: { id: string; role: string | null; hasCredential: boolean },
  allUsers: Array<{ id: string; role: string | null; hasCredential: boolean }>,
  localAuthDisabled: boolean,
): { isProtected: boolean; reason: AdminProtectionReason | null } {
  if (user.role !== 'admin') return { isProtected: false, reason: null };

  const admins = allUsers.filter((u) => u.role === 'admin');
  const localAdmins = admins.filter((u) => u.hasCredential);
  const oidcAdmins = admins.filter((u) => !u.hasCredential);

  const remainingTotal = admins.length - 1;
  if (remainingTotal === 0) return { isProtected: true, reason: 'last_admin' };

  if (user.hasCredential) {
    const remainingLocal = localAdmins.length - 1;
    if (remainingLocal === 0 && !localAuthDisabled) {
      return { isProtected: true, reason: 'last_local_admin' };
    }
  }

  if (!user.hasCredential) {
    const remainingOidc = oidcAdmins.length - 1;
    if (remainingOidc === 0 && localAuthDisabled) {
      return { isProtected: true, reason: 'last_oidc_admin_when_local_disabled' };
    }
  }

  return { isProtected: false, reason: null };
}

/**
 * List every user with their provider(s) and computed protection state.
 * The protection calculation needs `localAuthDisabled` because OIDC admins
 * become the only recovery path once local auth is off.
 */
export async function getAllUsers(localAuthDisabled: boolean): Promise<AdminUserRow[]> {
  const rows = await db
    .select({
      id: authUser.id,
      name: authUser.name,
      email: authUser.email,
      role: authUser.role,
      createdAt: authUser.createdAt,
      providerId: authAccount.providerId,
    })
    .from(authUser)
    .leftJoin(authAccount, eq(authAccount.userId, authUser.id))
    .orderBy(asc(authUser.createdAt));

  // Group providers per user.
  const byId = new Map<string, AdminUserRow>();
  for (const r of rows) {
    let row = byId.get(r.id);
    if (!row) {
      row = {
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        createdAt: r.createdAt,
        hasCredential: false,
        providers: '',
        isProtected: false,
        protectionReason: null,
      };
      byId.set(r.id, row);
    }
    if (r.providerId) {
      if (r.providerId === 'credential') row.hasCredential = true;
      const list = row.providers ? row.providers.split(',') : [];
      if (!list.includes(r.providerId)) list.push(r.providerId);
      row.providers = list.join(',');
    }
  }
  const allUsers = Array.from(byId.values());
  // Compute protection per row in a second pass so each call sees the
  // full roster (the helper needs the full list to count "other admins").
  for (const u of allUsers) {
    const { isProtected, reason } = computeIsProtected(u, allUsers, localAuthDisabled);
    u.isProtected = isProtected;
    u.protectionReason = reason;
  }
  return allUsers;
}

/**
 * Delete a user and all of their data. The financial tables
 * (transactions, accounts, categories, sub_categories, monthly_budgets,
 * settings) have no ON DELETE CASCADE on `user_id`, so we delete them
 * manually first. The auth `user` row cascades to `session` and
 * `account` automatically.
 *
 * Returns the number of rows deleted (summed across all the data
 * tables) so the admin UI can show "deleted 47 rows of data".
 *
 * Throws if `userId` is a protected admin — uses the same
 * `computeIsProtected` helper that the UI shows the lock icon from, so
 * the server can never reach a zero-admin state through delete.
 */
export async function deleteUserWithData(
  userId: string,
  localAuthDisabled: boolean,
): Promise<{ deletedRows: number }> {
  // Refuse to delete a protected admin. The helper encodes the same
  // rules the UI uses for the lock icon: last admin overall, last
  // local admin while local auth is on, or last OIDC admin while
  // local auth is off.
  const targetRows = await db.execute(sql`
    SELECT u.role,
           EXISTS (SELECT 1 FROM "account" a
                   WHERE a.user_id = u.id AND a.provider_id = 'credential') AS "hasCredential"
    FROM "user" u
    WHERE u.id = ${userId}
    LIMIT 1
  `) as { role: string | null; hasCredential: boolean }[];
  const target = targetRows[0];
  if (!target) throw new Error('User not found');
  if (target.role === 'admin') {
    const roster = await getAllUsers(localAuthDisabled);
    const { isProtected, reason } = computeIsProtected(
      { id: userId, role: target.role, hasCredential: target.hasCredential },
      roster,
      localAuthDisabled,
    );
    if (isProtected) {
      throw new Error(protectionMessage(reason));
    }
  }

  // Delete per-user rows from every table that doesn't cascade.
  // Order doesn't matter (we use a single transaction below), but
  // we group them so the count returned is accurate.
  const tx = await db.transaction(async (tx) => {
    let n = 0;
    for (const tbl of [transactions, accounts, categories, subCategories, monthlyBudgets, settings, goals, rules]) {
      const r = await tx.delete(tbl).where(eq(tbl.userId, userId));
      n += Number(r.count ?? 0);
    }
    // Delete the user last. Cascades to session + account (auth).
    const r = await tx.delete(authUser).where(eq(authUser.id, userId));
    n += Number(r.count ?? 0);
    return n;
  });

  return { deletedRows: tx };
}

/**
 * Update a user's role. Used by the admin UI to promote OIDC users to
 * admin (or demote them). Better Auth's admin plugin stores the role on
 * the `user` row as a free-form text column with two meaningful values:
 * `'admin'` and `'user'` (null also means a regular user).
 *
 * Throws if the target user is the last remaining local admin and the
 * caller is trying to demote them — same guard as delete, since only a
 * local (credential-having) admin can recover the instance. OIDC
 * admins can be demoted freely; the local admin stays in charge.
 */
export async function updateUserRole(
  userId: string,
  role: 'admin' | 'user',
  localAuthDisabled: boolean,
): Promise<{ id: string; role: string | null }> {
  if (role !== 'admin' && role !== 'user') {
    throw new Error('role must be "admin" or "user"');
  }
  const targetRows = await db.execute(sql`
    SELECT u.id, u.role,
           EXISTS (SELECT 1 FROM "account" a
                   WHERE a.user_id = u.id AND a.provider_id = 'credential') AS "hasCredential"
    FROM "user" u
    WHERE u.id = ${userId}
    LIMIT 1
  `) as { id: string; role: string | null; hasCredential: boolean }[];
  const target = targetRows[0];
  if (!target) throw new Error('User not found');

  // Demotion guard — uses the same `computeIsProtected` helper the UI
  // uses for the lock icon so the server refuses any demotion that
  // would lock the operator out (zero admins, no recovery path).
  const demoting = target.role === 'admin' && role !== 'admin';
  if (demoting) {
    const roster = await getAllUsers(localAuthDisabled);
    const { isProtected, reason } = computeIsProtected(
      { id: userId, role: target.role, hasCredential: target.hasCredential },
      roster,
      localAuthDisabled,
    );
    if (isProtected) {
      throw new Error(protectionMessage(reason));
    }
  }

  // Better Auth stores null for non-admin users. Treat 'user' as null so
  // the column stays clean.
  const nextRole = role === 'admin' ? 'admin' : null;
  await db
    .update(authUser)
    .set({ role: nextRole, updatedAt: new Date() })
    .where(eq(authUser.id, userId));
  return { id: userId, role: nextRole };
}

/**
 * Human-readable message for a protection reason. Used by the route
 * layer's error path so the toast/error text matches what the UI's
 * lock-icon tooltip says.
 */
function protectionMessage(reason: AdminProtectionReason | null): string {
  switch (reason) {
    case 'last_admin':
      return 'Cannot demote or delete the only admin — promote another user to admin first.';
    case 'last_local_admin':
      return 'Cannot demote or delete the last local admin — promote another user to admin first.';
    case 'last_oidc_admin_when_local_disabled':
      return 'Cannot demote or delete the last OIDC admin while local auth is disabled — promote another OIDC user to admin first.';
    default:
      return 'This user is protected.';
  }
}

// ---- Reports aggregates ---------------------------------------------------
//
// All five functions here are read-only, userId-scoped, and exclude
// transfers + hidden-account transactions by the same convention the
// Dashboard and Budget pages use (Hard Rule #14). The page calls a
// matching endpoint per chart so the client never re-aggregates.

/**
 * Returns 'YYYY-MM-DD' for the last day of `yearMonth`. Uses date math
 * (day 0 of next month) so it handles month-length correctly without a
 * lookup table — leap-year-safe.
 */
function endOfMonth(yearMonth: string): string {
  const [yStr, mStr] = yearMonth.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of this month
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Enumerate every YYYY-MM between `start` and `end` inclusive. Used to
 * pad reports so months with zero activity still appear on the axis.
 */
function eachMonth(start: string, end: string): string[] {
  const out: string[] = [];
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  let y = sy ?? 1970;
  let m = sm ?? 1;
  while (y < (ey ?? 9999) || (y === (ey ?? 9999) && m <= (em ?? 12))) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

// ---- Helpers for the "filter hidden accounts" pattern ---------------------

/**
 * Returns the set of account names that are visible to the user.
 * Transactions whose account column is in this set are the only ones
 * included in report aggregations. Mirrors `getAllTransactions`.
 */
async function visibleAccountNames(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.hidden, false)));
  return new Set(rows.map((r) => r.name));
}

// ---- 1. Cash Flow -------------------------------------------------------

export interface CashFlowPoint {
  month: string;
  income: number;
  expense: number;
  net: number;
}

/**
 * Monthly income vs. expense for the requested range. Transfers are
 * excluded — they don't change net worth. Hidden accounts are excluded.
 *
 * Returns a dense monthly series (zero-filled) so the chart's x-axis
 * doesn't have gaps for months with no activity.
 */
export async function getCashFlowSeries(
  userId: string,
  fromDate: string,
  toDate: string,
): Promise<CashFlowPoint[]> {
  const visible = await visibleAccountNames(userId);
  if (visible.size === 0) return eachMonth(fromDate.slice(0, 7), toDate.slice(0, 7)).map((month) => ({ month, income: 0, expense: 0, net: 0 }));

  const rows = await db
    .select({
      month: sql<string>`to_char(${transactions.date}, 'YYYY-MM')`,
      type: transactions.type,
      total: sql<number>`SUM(${transactions.amount})`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        gte(transactions.date, fromDate),
        lte(transactions.date, toDate),
        // Filter out transfers; in() matches both 'income' and 'expense'.
        inArray(transactions.type, ['income', 'expense']),
        // Hidden-account transactions are excluded at SQL so the SUM
        // never sees them. `inArray` here is the inverse of the
        // `notInArray` pattern used by listTransactions — we keep
        // only transactions whose account is in the visible set.
        inArray(transactions.account, Array.from(visible)),
      ),
    )
    .groupBy(sql`to_char(${transactions.date}, 'YYYY-MM')`, transactions.type)
    .orderBy(sql`to_char(${transactions.date}, 'YYYY-MM')`);

  const byMonth = new Map<string, { income: number; expense: number }>();
  for (const r of rows) {
    const month = r.month;
    const cur = byMonth.get(month) ?? { income: 0, expense: 0 };
    if (r.type === 'income') cur.income += Number(r.total);
    else cur.expense += Number(r.total);
    byMonth.set(month, cur);
  }

  return eachMonth(fromDate.slice(0, 7), toDate.slice(0, 7)).map((month) => {
    const point = byMonth.get(month) ?? { income: 0, expense: 0 };
    return { month, income: point.income, expense: point.expense, net: point.income - point.expense };
  });
}

// ---- 2. Net Worth -------------------------------------------------------

export interface NetWorthPoint {
  month: string;
  netWorth: number;
}

/**
 * Sign convention for net-worth contribution. Mirrors
 * `lib/accounting.ts → netWorthContribution` so the time-series
 * endpoint agrees with the Dashboard's headline number.
 */
function netWorthContributionForAccount(type: string, balance: number): number {
  if (type === 'credit' || type === 'loan') return -balance;
  return balance;
}

/**
 * Monthly net worth for the requested range. Computed by walking
 * transactions forward from the earliest month, adding income and
 * subtracting expenses in each month. The opening balance is
 * "current net worth minus the sum of all transactions in the range",
 * which assumes the user has been using the app continuously; if an
 * account was added mid-range the historical line will have a step
 * change at the month the account first appeared. Acceptable for v1 —
 * capturing periodic balance snapshots would require a new table.
 *
 * Hidden accounts are excluded from the current-net-worth figure.
 * Transfers are excluded from the deltas (they reallocate within own
 * accounts and don't change net worth).
 */
export async function getNetWorthSeries(
  userId: string,
  fromDate: string,
  toDate: string,
): Promise<NetWorthPoint[]> {
  const accountRows = await db
    .select({ type: accounts.type, balance: accounts.balance })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.hidden, false)));
  const currentNetWorth = accountRows.reduce((s, a) => s + netWorthContributionForAccount(a.type, a.balance), 0);

  const visible = await visibleAccountNames(userId);
  if (visible.size === 0) {
    return eachMonth(fromDate.slice(0, 7), toDate.slice(0, 7)).map((month) => ({ month, netWorth: 0 }));
  }

  // Sum of income/expense transactions in the range, grouped by month.
  const txRows = await db
    .select({
      month: sql<string>`to_char(${transactions.date}, 'YYYY-MM')`,
      type: transactions.type,
      amount: transactions.amount,
      account: transactions.account,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        gte(transactions.date, fromDate),
        lte(transactions.date, toDate),
        inArray(transactions.type, ['income', 'expense']),
      ),
    );

  const monthDelta = new Map<string, number>();
  for (const r of txRows) {
    if (!visible.has(r.account)) continue;
    const cur = monthDelta.get(r.month) ?? 0;
    const delta = r.type === 'income' ? r.amount : -r.amount;
    monthDelta.set(r.month, cur + delta);
  }

  // Opening net worth = current_net_worth - sum(all tx deltas in range).
  const totalDelta = Array.from(monthDelta.values()).reduce((s, v) => s + v, 0);
  let opening = currentNetWorth - totalDelta;

  const months = eachMonth(fromDate.slice(0, 7), toDate.slice(0, 7));
  const series: NetWorthPoint[] = [];
  for (const month of months) {
    opening += monthDelta.get(month) ?? 0;
    series.push({ month, netWorth: opening });
  }
  return series;
}

// ---- 3. Spending by Category --------------------------------------------

export interface CategorySpend {
  category: string;
  total: number;
}

/**
 * Total spending per main category for a single month. Includes
 * sub-totals to the main category (the budget UI works at the
 * sub-category level, but the pie chart needs the main category so
 * it doesn't explode into 30 slices). Empty list if no data.
 */
export async function getSpendingByCategory(
  userId: string,
  yearMonth: string,
): Promise<CategorySpend[]> {
  const visible = await visibleAccountNames(userId);
  if (visible.size === 0) return [];

  const monthStart = `${yearMonth}-01`;
  const monthEnd = endOfMonth(yearMonth);

  const rows = await db
    .select({
      category: transactions.category,
      total: sql<number>`SUM(${transactions.amount})`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.type, 'expense'),
        gte(transactions.date, monthStart),
        lte(transactions.date, monthEnd),
        // Hidden-account transactions excluded at SQL — see
        // getCashFlowSeries for the rationale.
        inArray(transactions.account, Array.from(visible)),
      ),
    )
    .groupBy(transactions.category);

  return rows
    .map((r) => ({ category: r.category, total: Number(r.total) }))
    .sort((a, b) => b.total - a.total);
}

// ---- 4. Top Merchants ----------------------------------------------------

export interface MerchantTotal {
  merchant: string;
  total: number;
  count: number;
}

/**
 * Top merchants by total spend in the requested range. Excludes
 * transfers and hidden accounts. Defaults to top 10 to keep the bar
 * chart readable.
 */
export async function getTopMerchants(
  userId: string,
  fromDate: string,
  toDate: string,
  limit = 10,
): Promise<MerchantTotal[]> {
  const visible = await visibleAccountNames(userId);
  if (visible.size === 0) return [];

  const rows = await db
    .select({
      merchant: transactions.merchant,
      total: sql<number>`SUM(${transactions.amount})`,
      count: sql<number>`COUNT(*)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.type, 'expense'),
        gte(transactions.date, fromDate),
        lte(transactions.date, toDate),
        // Hidden-account transactions excluded at SQL — see
        // getCashFlowSeries for the rationale.
        inArray(transactions.account, Array.from(visible)),
      ),
    )
    .groupBy(transactions.merchant)
    .orderBy(sql`SUM(${transactions.amount}) DESC`)
    .limit(limit);

  return rows.map((r) => ({ merchant: r.merchant, total: Number(r.total), count: Number(r.count) }));
}

// ---- 5. Budget vs Actual -----------------------------------------------

export interface BudgetVsActualRow {
  category: string;
  planned: number;
  actual: number;
}

/**
 * Per-main-category planned vs. actual for a single month. Joins
 * `monthlyBudgets` (planned per sub-category) up to the main
 * category via `subCategories`, and sums the user's expense
 * transactions for the month by sub-category, then aggregates to the
 * main category.

 * Categories with no planned budget and no actual spend are skipped
 * to keep the chart focused on what the user is actually tracking.
 */
export async function getBudgetVsActual(
  userId: string,
  yearMonth: string,
): Promise<BudgetVsActualRow[]> {
  const visible = await visibleAccountNames(userId);
  if (visible.size === 0) return [];

  const monthStart = `${yearMonth}-01`;
  const monthEnd = endOfMonth(yearMonth);

  // Map sub-category ID → main category name (filter to expense
  // categories only — income/transfer categories don't get budgets).
  const subRows = await db
    .select({
      subId: subCategories.id,
      mainName: categories.name,
      categoryType: categories.type,
    })
    .from(subCategories)
    .innerJoin(categories, eq(subCategories.mainCategoryId, categories.id))
    .where(and(eq(subCategories.userId, userId), eq(categories.type, 'expense')));
  const subToMain = new Map<string, string>();
  for (const r of subRows) subToMain.set(r.subId, r.mainName);

  // Planned per sub-category for the month.
  const plannedRows = await db
    .select()
    .from(monthlyBudgets)
    .where(and(eq(monthlyBudgets.userId, userId), eq(monthlyBudgets.yearMonth, yearMonth)));

  // Actual per main category for the month. The `category` column on a
  // transaction holds the MAIN category name (not the sub — see schema),
  // so we can group by it directly and skip the sub→main join.
  const actualRows = await db
    .select({
      category: transactions.category,
      total: sql<number>`SUM(${transactions.amount})`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.type, 'expense'),
        gte(transactions.date, monthStart),
        lte(transactions.date, monthEnd),
        // Hidden-account transactions excluded at SQL — see
        // getCashFlowSeries for the rationale.
        inArray(transactions.account, Array.from(visible)),
      ),
    )
    .groupBy(transactions.category);

  // Aggregate to main category.
  const byCategory = new Map<string, { planned: number; actual: number }>();

  for (const p of plannedRows) {
    const main = subToMain.get(p.subCategoryId);
    if (!main) continue;
    const cur = byCategory.get(main) ?? { planned: 0, actual: 0 };
    cur.planned += p.planned;
    byCategory.set(main, cur);
  }

  for (const a of actualRows) {
    const cur = byCategory.get(a.category) ?? { planned: 0, actual: 0 };
    cur.actual += Number(a.total);
    byCategory.set(a.category, cur);
  }

  // Drop entries where both planned and actual are zero.
  const out: BudgetVsActualRow[] = [];
  for (const [category, v] of byCategory) {
    if (v.planned === 0 && v.actual === 0) continue;
    out.push({ category, planned: v.planned, actual: v.actual });
  }
  out.sort((a, b) => Math.max(b.planned, b.actual) - Math.max(a.planned, a.actual));
  return out;
}

// ---- Recurring charges detection ----------------------------------------

export interface RecurringCharge {
  merchant: string;
  amount: number;
  frequency: 'monthly' | 'quarterly' | 'yearly';
  occurrences: number;
  lastDate: string;
  category: string;
  account: string;
}

/**
 * Detect recurring charges by finding transactions from the same merchant
 * with the same amount that appear in multiple months. Groups by
 * merchant + amount (rounded to 2 decimal places) and returns candidates
 * that appear at least 2 times across distinct months.
 */
export async function getRecurringCharges(userId: string): Promise<RecurringCharge[]> {
  // Fetch all expense transactions (recurring charges are expenses), excluding hidden accounts
  const meta = new Map<string, { hidden: boolean; alias: string | null }>();
  for (const r of await db
    .select({ name: accounts.name, hidden: accounts.hidden, alias: accounts.alias })
    .from(accounts)
    .where(eq(accounts.userId, userId))) {
    meta.set(r.name, { hidden: r.hidden, alias: r.alias ?? null });
  }

  const rows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.type, 'expense')))
    .orderBy(desc(transactions.date));

  // Filter hidden accounts and group by merchant + rounded amount
  const groups = new Map<string, { merchant: string; amount: number; dates: string[]; category: string; account: string }>();

  for (const r of rows) {
    if (meta.get(r.account)?.hidden) continue;
    const amount = Math.round(r.amount * 100) / 100;
    const key = `${r.merchant.toLowerCase()}|${amount}`;
    const existing = groups.get(key);
    if (existing) {
      existing.dates.push(r.date);
    } else {
      groups.set(key, {
        merchant: r.merchant,
        amount,
        dates: [r.date],
        category: r.category,
        account: meta.get(r.account)?.alias || r.account,
      });
    }
  }

  const results: RecurringCharge[] = [];

  for (const g of groups.values()) {
    // Get distinct months
    const months = new Set(g.dates.map((d) => d.slice(0, 7)));
    if (months.size < 2) continue;

    // Determine frequency based on average gap between occurrences
    const sortedDates = [...g.dates].sort();
    let totalGapDays = 0;
    for (let i = 1; i < sortedDates.length; i++) {
      const prev = new Date(sortedDates[i - 1]!);
      const curr = new Date(sortedDates[i]!);
      totalGapDays += (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
    }
    const avgGap = totalGapDays / (sortedDates.length - 1);

    let frequency: 'monthly' | 'quarterly' | 'yearly';
    if (avgGap <= 45) frequency = 'monthly';
    else if (avgGap <= 120) frequency = 'quarterly';
    else frequency = 'yearly';

    results.push({
      merchant: g.merchant,
      amount: g.amount,
      frequency,
      occurrences: g.dates.length,
      lastDate: sortedDates[sortedDates.length - 1]!,
      category: g.category,
      account: g.account,
    });
  }

  // Sort by most recent last date, then by amount descending
  results.sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.amount - a.amount);
  return results;
}
