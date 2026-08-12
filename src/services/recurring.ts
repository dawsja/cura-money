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
  frequency: z.enum(['weekly', 'monthly', 'yearly']),
  lastDate: z.string().date(),
  category: z.string().min(1),
});

const legacyMarkedRecurringSchema = z.object({
  merchant: z.string().min(1),
  amount: z.number().finite(),
  frequency: z.enum(['weekly', 'monthly', 'yearly']),
});
const transactionMarkRequestSchema = z.object({
  transactionId: z.string().min(1),
  frequency: z.enum(['weekly', 'monthly', 'yearly']),
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

export type RecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

const OVERDUE_NOTIFY_WINDOW_DAYS = 7;

export function recurringSchedule(
  lastDate: string,
  frequency: RecurringFrequency,
  now = new Date(),
): { nextDate: string; daysUntil: number; comingSoon: boolean } {
  const [year, month, day] = lastDate.split('-').map(Number) as [number, number, number];
  let nextDate: string;
  if (frequency === 'weekly') {
    nextDate = new Date(Date.UTC(year, month - 1, day + 7, 12)).toISOString().slice(0, 10);
  } else {
    const months = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12;
    const targetMonth = month - 1 + months;
    const targetYear = year + Math.floor(targetMonth / 12);
    const normalizedMonth = targetMonth % 12;
    const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
    nextDate = new Date(Date.UTC(targetYear, normalizedMonth, Math.min(day, lastDay), 12)).toISOString().slice(0, 10);
  }

  const [nextYear, nextMonth, nextDay] = nextDate.split('-').map(Number) as [number, number, number];
  const next = Date.UTC(nextYear, nextMonth - 1, nextDay);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysUntil = Math.round((next - today) / 86_400_000);
  const leadDays = frequency === 'weekly' ? 2 : frequency === 'monthly' ? 7 : frequency === 'quarterly' ? 14 : 30;

  return {
    nextDate,
    daysUntil,
    comingSoon: daysUntil >= -OVERDUE_NOTIFY_WINDOW_DAYS && daysUntil <= leadDays,
  };
}

interface RecurringPreferences {
  dismissed: Set<string>;
  marked: PersistedMarkedRecurring[];
}

export function recurringKey(merchant: string, amount: number, account?: string): string {
  const base = `${merchant.toLowerCase()}|${Math.round(amount * 100) / 100}`;
  return account ? `${base}|${account.toLowerCase()}` : base;
}

function recurringMerchantKey(merchant: string, account?: string): string {
  const m = merchant.toLowerCase();
  return account ? `${m}|${account.toLowerCase()}` : m;
}

function roundedAmount(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function markedAccount(marked: PersistedMarkedRecurring): string | undefined {
  return 'account' in marked ? (marked.accountId ?? marked.account) : undefined;
}

function chargeAccount(charge: RecurringCharge & { accountId?: string }): string {
  return charge.accountId ?? charge.account;
}

function parseDismissedKey(key: string): { merchant: string; amount?: number; account?: string } | null {
  const parts = key.split('|');
  if (parts.length === 2) {
    const amount = Number(parts[1]);
    if (Number.isFinite(amount)) return { merchant: parts[0]!, amount };
    return { merchant: parts[0]!, account: parts[1] };
  }
  if (parts.length >= 3) {
    const amount = Number(parts[1]);
    const account = parts.slice(2).join('|');
    if (Number.isFinite(amount)) return { merchant: parts[0]!, amount, account };
    return { merchant: parts[0]!, account: parts.slice(1).join('|') };
  }
  if (parts.length === 1 && parts[0]) return { merchant: parts[0] };
  return null;
}

function dismissKeyMatches(key: string, merchant: string, amount: number, account: string): boolean {
  const parsed = parseDismissedKey(key);
  if (!parsed || parsed.merchant !== merchant.toLowerCase()) return false;
  if (parsed.account) return parsed.account === account.toLowerCase();
  return parsed.amount === roundedAmount(amount);
}

function isDismissed(preferences: RecurringPreferences, merchant: string, amount: number, account: string): boolean {
  for (const key of preferences.dismissed) {
    if (dismissKeyMatches(key, merchant, amount, account)) return true;
  }
  return false;
}

function removeMatchingDismissed(
  dismissed: Set<string>,
  merchant: string,
  amount: number,
  account?: string,
): boolean {
  let removed = false;
  for (const key of [...dismissed]) {
    if (account) {
      if (dismissKeyMatches(key, merchant, amount, account)) {
        dismissed.delete(key);
        removed = true;
      }
    } else if (parseDismissedKey(key)?.merchant === merchant.toLowerCase()) {
      dismissed.delete(key);
      removed = true;
    }
  }
  return removed;
}

function sameRecurring(
  item: PersistedMarkedRecurring,
  merchant: string,
  _amount: number,
  account?: string,
): boolean {
  if (item.merchant.toLowerCase() !== merchant.toLowerCase()) return false;
  const itemAccount = markedAccount(item);
  if (!itemAccount || !account) return true;
  return itemAccount.toLowerCase() === account.toLowerCase();
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
  return recurringMerchantKey(marked.merchant, markedAccount(marked));
}

function dedupeMarked(items: PersistedMarkedRecurring[]): PersistedMarkedRecurring[] {
  const seen = new Set<string>();
  const out: PersistedMarkedRecurring[] = [];
  for (const item of items) {
    const key = persistedMarkKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function refreshMarkedRecurring(
  userId: string,
  marked: PersistedMarkedRecurring[],
): Promise<PersistedMarkedRecurring[]> {
  // This also upgrades account-less legacy marks before auto-detection has
  // enough occurrences to produce its own row. Lookup is merchant+account
  // so a price change updates the stored amount.
  const refreshed = await Promise.all(marked.map(async (item) => {
    const metadata = await resolveRecurringTransactionMetadata(userId, {
      merchant: item.merchant,
      account: 'account' in item ? item.account : undefined,
      accountId: 'accountId' in item ? item.accountId : undefined,
      type: 'expense',
    });
    return metadata ? { ...metadata, frequency: item.frequency } satisfies MarkedRecurring : item;
  }));

  const dedupedRefresh = dedupeMarked(refreshed);
  if (JSON.stringify(refreshed) !== JSON.stringify(marked) || dedupedRefresh.length !== marked.length) {
    const byOriginalKey = new Map(marked.map((item, index) => [persistedMarkKey(item), refreshed[index]!]));
    await mutateRecurringPreferences(userId, (current) => {
      let changed = false;
      const nextMarked = current.marked.map((item) => {
        const replacement = byOriginalKey.get(persistedMarkKey(item));
        if (!replacement) return item;
        const next = { ...replacement, frequency: item.frequency };
        if (JSON.stringify(next) !== JSON.stringify(item)) changed = true;
        return next;
      });
      const deduped = dedupeMarked(nextMarked);
      if (deduped.length !== nextMarked.length) changed = true;
      current.marked = deduped;
      return { writeDismissed: false, writeMarked: changed };
    });
  }
  return dedupedRefresh;
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
      if (charge.merchant.toLowerCase() !== marked.merchant.toLowerCase()) return false;
      if (!account) return true;
      return account === chargeAccount(charge)
        || ('account' in marked && marked.account.toLowerCase() === charge.account.toLowerCase());
    });
    if (existing.length > 0) {
      for (const charge of existing) {
        charge.frequency = marked.frequency;
        if ('account' in marked) {
          if (marked.lastDate >= charge.lastDate) {
            charge.lastDate = marked.lastDate;
            charge.category = marked.category;
            charge.amount = marked.amount;
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
    const removed = removeMatchingDismissed(preferences.dismissed, merchant, amount, accountId ?? account);
    return { writeDismissed: removed, writeMarked: false };
  });
}

export async function markRecurring(userId: string, marked: MarkedRecurring): Promise<void> {
  const account = marked.accountId ?? marked.account;
  await mutateRecurringPreferences(userId, (preferences) => {
    preferences.marked = preferences.marked.filter((item) => !sameRecurring(item, marked.merchant, marked.amount, account));
    preferences.marked.push(marked);
    const wasDismissed = removeMatchingDismissed(preferences.dismissed, marked.merchant, marked.amount, account);
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
