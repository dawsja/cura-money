import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { settings } from '@/db/schema/settings';
import { getRecurringCharges, getSetting, type RecurringCharge } from '@/db/queries';

export const DISMISSED_RECURRING_KEY = 'dismissed_recurring';
export const MARKED_RECURRING_KEY = 'marked_recurring';

export const recurringIdentitySchema = z.object({
  merchant: z.string().min(1),
  amount: z.number().finite(),
});

export const markedRecurringSchema = recurringIdentitySchema.extend({
  frequency: z.enum(['monthly', 'yearly']),
});

const dismissedRecurringSchema = z.array(z.string());
const markedRecurringListSchema = z.array(markedRecurringSchema);

export type MarkedRecurring = z.infer<typeof markedRecurringSchema>;

interface RecurringPreferences {
  dismissed: Set<string>;
  marked: MarkedRecurring[];
}

export function recurringKey(merchant: string, amount: number): string {
  return `${merchant.toLowerCase()}|${Math.round(amount * 100) / 100}`;
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

export async function loadActiveRecurringCharges(userId: string): Promise<RecurringCharge[]> {
  const [charges, preferences] = await Promise.all([getRecurringCharges(userId), getRecurringPreferences(userId)]);
  const merged = charges.filter(
    (charge) => !preferences.dismissed.has(recurringKey(charge.merchant, charge.amount)),
  );

  for (const marked of preferences.marked) {
    const key = recurringKey(marked.merchant, marked.amount);
    if (preferences.dismissed.has(key)) continue;
    const existing = merged.find((charge) => recurringKey(charge.merchant, charge.amount) === key);
    if (existing) {
      existing.frequency = marked.frequency;
    } else {
      merged.push({
        merchant: marked.merchant,
        amount: marked.amount,
        frequency: marked.frequency,
        occurrences: 1,
        lastDate: new Date().toISOString().slice(0, 10),
        category: '',
        account: '',
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

export async function dismissRecurring(userId: string, merchant: string, amount: number): Promise<void> {
  const key = recurringKey(merchant, amount);
  await mutateRecurringPreferences(userId, (preferences) => {
    preferences.dismissed.add(key);
    const markedLength = preferences.marked.length;
    preferences.marked = preferences.marked.filter((item) => recurringKey(item.merchant, item.amount) !== key);
    return { writeDismissed: true, writeMarked: preferences.marked.length !== markedLength };
  });
}

export async function restoreRecurring(userId: string, merchant: string, amount: number): Promise<void> {
  await mutateRecurringPreferences(userId, (preferences) => {
    preferences.dismissed.delete(recurringKey(merchant, amount));
    return { writeDismissed: true, writeMarked: false };
  });
}

export async function markRecurring(userId: string, marked: MarkedRecurring): Promise<void> {
  const key = recurringKey(marked.merchant, marked.amount);
  await mutateRecurringPreferences(userId, (preferences) => {
    preferences.marked = preferences.marked.filter((item) => recurringKey(item.merchant, item.amount) !== key);
    preferences.marked.push(marked);
    const wasDismissed = preferences.dismissed.delete(key);
    return { writeDismissed: wasDismissed, writeMarked: true };
  });
}

export async function unmarkRecurring(userId: string, merchant: string, amount: number): Promise<void> {
  const key = recurringKey(merchant, amount);
  await mutateRecurringPreferences(userId, (preferences) => {
    preferences.marked = preferences.marked.filter((item) => recurringKey(item.merchant, item.amount) !== key);
    preferences.dismissed.add(key);
    return { writeDismissed: true, writeMarked: true };
  });
}
