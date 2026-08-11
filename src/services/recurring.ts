import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { settings } from '@/db/schema/settings';
import {
  getRecurringCharges,
  getSetting,
  resolveRecurringTransactionMetadata,
  type RecurringCharge,
} from '@/db/queries';

export const DISMISSED_RECURRING_KEY = 'dismissed_recurring';
export const MARKED_RECURRING_KEY = 'marked_recurring';

export const recurringIdentitySchema = z.object({
  merchant: z.string().min(1),
  amount: z.number().finite(),
  account: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
});

export const markedRecurringSchema = recurringIdentitySchema.extend({
  account: z.string().min(1),
  frequency: z.enum(['monthly', 'yearly']),
  lastDate: z.string().date(),
  category: z.string().min(1),
});

const legacyMarkedRecurringSchema = z.object({
  merchant: z.string().min(1),
  amount: z.number().finite(),
  frequency: z.enum(['monthly', 'yearly']),
});
const transactionMarkRequestSchema = z.object({
  transactionId: z.string().min(1),
  frequency: z.enum(['monthly', 'yearly']),
});
const legacyMarkRequestSchema = legacyMarkedRecurringSchema.extend({
  account: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
});
export const markRecurringRequestSchema = z.union([transactionMarkRequestSchema, legacyMarkRequestSchema]);

const dismissedRecurringSchema = z.array(z.string());
const persistedMarkedRecurringSchema = z.union([markedRecurringSchema, legacyMarkedRecurringSchema]);
const markedRecurringListSchema = z.array(persistedMarkedRecurringSchema);

export type MarkedRecurring = z.infer<typeof markedRecurringSchema>;
type PersistedMarkedRecurring = z.infer<typeof persistedMarkedRecurringSchema>;

interface RecurringPreferences {
  dismissed: Set<string>;
  marked: PersistedMarkedRecurring[];
}

export function recurringKey(merchant: string, amount: number, account?: string): string {
  const base = `${merchant.toLowerCase()}|${Math.round(amount * 100) / 100}`;
  return account ? `${base}|${account.toLowerCase()}` : base;
}

function markedAccount(marked: PersistedMarkedRecurring): string | undefined {
  return 'account' in marked ? (marked.accountId ?? marked.account) : undefined;
}

function chargeAccount(charge: RecurringCharge & { accountId?: string }): string {
  return charge.accountId ?? charge.account;
}

function isDismissed(preferences: RecurringPreferences, merchant: string, amount: number, account: string): boolean {
  return preferences.dismissed.has(recurringKey(merchant, amount))
    || preferences.dismissed.has(recurringKey(merchant, amount, account));
}

function sameRecurring(
  item: PersistedMarkedRecurring,
  merchant: string,
  amount: number,
  account?: string,
): boolean {
  const itemAccount = markedAccount(item);
  if (!itemAccount || !account) return recurringKey(item.merchant, item.amount) === recurringKey(merchant, amount);
  return recurringKey(item.merchant, item.amount, itemAccount) === recurringKey(merchant, amount, account);
}

function parseJson<T>(raw: string | null, schema: z.ZodType<T>, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

function parsePreferences(dismissedRaw: string | null, markedRaw: string | null): RecurringPreferences {
  return {
    dismissed: new Set(parseJson(dismissedRaw, dismissedRecurringSchema, [])),
    marked: parseJson(markedRaw, markedRecurringListSchema, []),
  };
}

export async function getRecurringPreferences(userId: string): Promise<RecurringPreferences> {
  const [dismissedRaw, markedRaw] = await Promise.all([
    getSetting(userId, DISMISSED_RECURRING_KEY),
    getSetting(userId, MARKED_RECURRING_KEY),
  ]);
  return parsePreferences(dismissedRaw, markedRaw);
}

function persistedMarkKey(marked: PersistedMarkedRecurring): string {
  return recurringKey(marked.merchant, marked.amount, markedAccount(marked));
}

async function refreshMarkedRecurring(
  userId: string,
  marked: PersistedMarkedRecurring[],
): Promise<PersistedMarkedRecurring[]> {
  // This also upgrades account-less legacy marks before auto-detection has
  // enough occurrences to produce its own row.
  const refreshed = await Promise.all(marked.map(async (item) => {
    const metadata = await resolveRecurringTransactionMetadata(userId, {
      merchant: item.merchant,
      amount: item.amount,
      account: 'account' in item ? item.account : undefined,
      accountId: 'accountId' in item ? item.accountId : undefined,
    });
    return metadata ? { ...metadata, frequency: item.frequency } satisfies MarkedRecurring : item;
  }));

  if (JSON.stringify(refreshed) !== JSON.stringify(marked)) {
    const byOriginalKey = new Map(marked.map((item, index) => [persistedMarkKey(item), refreshed[index]!]));
    await mutateRecurringPreferences(userId, (current) => {
      let changed = false;
      current.marked = current.marked.map((item) => {
        const replacement = byOriginalKey.get(persistedMarkKey(item));
        if (!replacement) return item;
        const next = { ...replacement, frequency: item.frequency };
        if (JSON.stringify(next) !== JSON.stringify(item)) changed = true;
        return next;
      });
      return { writeDismissed: false, writeMarked: changed };
    });
  }
  return refreshed;
}

export async function loadActiveRecurringCharges(userId: string): Promise<(RecurringCharge & { accountId?: string })[]> {
  const [charges, preferences] = await Promise.all([getRecurringCharges(userId), getRecurringPreferences(userId)]);
  const markedItems = await refreshMarkedRecurring(userId, preferences.marked);
  const merged: (RecurringCharge & { accountId?: string })[] = charges.filter(
    (charge) => !isDismissed(preferences, charge.merchant, charge.amount, chargeAccount(charge)),
  );

  for (const marked of markedItems) {
    const account = markedAccount(marked);
    if (account && isDismissed(preferences, marked.merchant, marked.amount, account)) continue;
    const existing = merged.filter((charge) => {
      if (!account) return recurringKey(charge.merchant, charge.amount) === recurringKey(marked.merchant, marked.amount);
      const baseMatches = recurringKey(charge.merchant, charge.amount)
        === recurringKey(marked.merchant, marked.amount);
      return baseMatches && (
        account === chargeAccount(charge)
        || ('account' in marked && marked.account.toLowerCase() === charge.account.toLowerCase())
      );
    });
    if (existing.length > 0) {
      for (const charge of existing) {
        charge.frequency = marked.frequency;
        if ('account' in marked) {
          if (marked.lastDate >= charge.lastDate) {
            charge.lastDate = marked.lastDate;
            charge.category = marked.category;
          }
          if (marked.accountId) charge.accountId = marked.accountId;
        }
      }
    } else if ('account' in marked) {
      merged.push({
        merchant: marked.merchant,
        amount: marked.amount,
        frequency: marked.frequency,
        occurrences: 1,
        lastDate: marked.lastDate,
        category: marked.category,
        account: marked.account,
        accountId: marked.accountId,
      });
    }
  }
  return merged;
}

type PreferenceMutation = (preferences: RecurringPreferences) => {
  writeDismissed: boolean;
  writeMarked: boolean;
};

async function mutateRecurringPreferences(userId: string, mutate: PreferenceMutation): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`cura-recurring:${userId}`}))`);
    const rows = await tx
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(
        and(
          eq(settings.userId, userId),
          inArray(settings.key, [DISMISSED_RECURRING_KEY, MARKED_RECURRING_KEY]),
        ),
      );
    const values = new Map(rows.map((row) => [row.key, row.value]));
    const preferences = parsePreferences(
      values.get(DISMISSED_RECURRING_KEY) ?? null,
      values.get(MARKED_RECURRING_KEY) ?? null,
    );
    const writes = mutate(preferences);
    const now = new Date();
    const updates: { userId: string; key: string; value: string; updatedAt: Date }[] = [];
    if (writes.writeDismissed) {
      updates.push({
        userId,
        key: DISMISSED_RECURRING_KEY,
        value: JSON.stringify([...preferences.dismissed]),
        updatedAt: now,
      });
    }
    if (writes.writeMarked) {
      updates.push({ userId, key: MARKED_RECURRING_KEY, value: JSON.stringify(preferences.marked), updatedAt: now });
    }
    if (updates.length === 0) return;
    await tx
      .insert(settings)
      .values(updates)
      .onConflictDoUpdate({
        target: [settings.userId, settings.key],
        set: { value: sql`excluded.value`, updatedAt: now },
      });
  });
}

export async function dismissRecurring(
  userId: string,
  merchant: string,
  amount: number,
  account?: string,
  accountId?: string,
): Promise<void> {
  const accountIdentity = accountId ?? account;
  const key = recurringKey(merchant, amount, accountIdentity);
  await mutateRecurringPreferences(userId, (preferences) => {
    preferences.dismissed.add(key);
    const markedLength = preferences.marked.length;
    preferences.marked = preferences.marked.filter((item) => !sameRecurring(item, merchant, amount, accountIdentity));
    return { writeDismissed: true, writeMarked: preferences.marked.length !== markedLength };
  });
}

export async function restoreRecurring(
  userId: string,
  merchant: string,
  amount: number,
  account?: string,
  accountId?: string,
): Promise<void> {
  await mutateRecurringPreferences(userId, (preferences) => {
    preferences.dismissed.delete(recurringKey(merchant, amount));
    if (accountId ?? account) preferences.dismissed.delete(recurringKey(merchant, amount, accountId ?? account));
    if (account) preferences.dismissed.delete(recurringKey(merchant, amount, account));
    return { writeDismissed: true, writeMarked: false };
  });
}

export async function markRecurring(userId: string, marked: MarkedRecurring): Promise<void> {
  const account = marked.accountId ?? marked.account;
  const key = recurringKey(marked.merchant, marked.amount, account);
  await mutateRecurringPreferences(userId, (preferences) => {
    preferences.marked = preferences.marked.filter((item) => !sameRecurring(item, marked.merchant, marked.amount, account));
    preferences.marked.push(marked);
    const removedAccountId = preferences.dismissed.delete(key);
    const removedAccount = preferences.dismissed.delete(recurringKey(marked.merchant, marked.amount, marked.account));
    const removedLegacy = preferences.dismissed.delete(recurringKey(marked.merchant, marked.amount));
    const wasDismissed = removedAccountId || removedAccount || removedLegacy;
    return { writeDismissed: wasDismissed, writeMarked: true };
  });
}

export async function unmarkRecurring(
  userId: string,
  merchant: string,
  amount: number,
  account?: string,
  accountId?: string,
): Promise<void> {
  const accountIdentity = accountId ?? account;
  const key = recurringKey(merchant, amount, accountIdentity);
  await mutateRecurringPreferences(userId, (preferences) => {
    preferences.marked = preferences.marked.filter((item) => !sameRecurring(item, merchant, amount, accountIdentity));
    preferences.dismissed.add(key);
    return { writeDismissed: true, writeMarked: true };
  });
}
