/**
 * SimpleFIN client + sync. Uses `fetch`, takes `userId` everywhere, and
 * stores the access URL in the per-user `settings` table.
 */
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { accounts } from '@/db/schema/accounts';
import { rules } from '@/db/schema/rules';
import {
  getSetting,
  setSetting,
  upsertAccount,
  addTransactionWithExternalId,
  deleteSimpleFinAccountsNotIn,
} from '@/db/queries';
import type { InferredAccountType } from './categorize';
import { inferAccountType, smartCategorizeMerchant } from './categorize';

// ---- Types --------------------------------------------------------------

export interface SimpleFinTransaction {
  id: string;
  posted: number; // Unix epoch seconds
  amount: string | number;
  description?: string;
  payee?: string;
  memo?: string;
  pending?: boolean;
}
export interface SimpleFinAccount {
  id: string;
  name: string;
  currency?: string;
  balance: string | number;
  'balance-date'?: number;
  org?: { id?: string; name?: string; url?: string };
  // SimpleFIN protocol v2 fields — kept untyped on purpose. The `extra`
  // object is explicitly server-opaque per the spec; some bridges
  // populate it with `account_type`, `account_class`, etc., others
  // don't. We sniff opportunistically and ignore anything we don't
  // understand. `conn_id` and `available-balance` are documented v2
  // fields we capture but currently don't use downstream.
  conn_id?: string;
  'available-balance'?: string | number;
  extra?: Record<string, unknown>;
  transactions?: SimpleFinTransaction[];
}
export interface SimpleFinResponse {
  errors?: string[];
  errlist?: unknown[];
  connections?: unknown[];
  accounts?: SimpleFinAccount[];
}

// ---- Client -------------------------------------------------------------

const SetupTokenSchema = z.string().min(8);
const AccessUrlSchema = z.string().url().refine(
  (u) => u.startsWith('http://') || u.startsWith('https://'),
  { message: 'must be http(s)' },
);

/**
 * Claim a SimpleFIN setup token → returns the permanent access URL.
 */
export async function claimSetupToken(setupToken: string): Promise<string> {
  const trimmed = SetupTokenSchema.parse(setupToken.trim());

  let claimUrl: string;
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf-8').trim();
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
      claimUrl = decoded;
    } else {
      throw new Error('decoded token is not a URL');
    }
  } catch (err) {
    throw new Error(`Invalid Base64 setup token: ${(err as Error).message}`);
  }

  const res = await fetch(claimUrl, { method: 'POST', headers: { 'Content-Length': '0' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`SimpleFIN claim failed (${res.status}): ${text || res.statusText}`);
  }
  const accessUrl = (await res.text()).trim();
  return AccessUrlSchema.parse(accessUrl);
}

/**
 * Fetch account + transaction data from SimpleFIN.
 *
 * `startDate` and `endDate` are Unix epoch SECONDS. Per the SimpleFIN
 * Bridge docs, the difference between them must be <= 90 days. We keep
 * our windows at 60 days to stay well inside that limit.
 */
export async function fetchSimpleFinData(
  accessUrl: string,
  startDate?: number,
  endDate?: number,
): Promise<{ accounts: SimpleFinAccount[]; errors: string[] }> {
  const url = new URL(accessUrl);
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  url.username = '';
  url.password = '';

  let endpoint = `${url.toString().replace(/\/$/, '')}/accounts?version=2&pending=1`;
  if (startDate) endpoint += `&start-date=${startDate}`;
  if (endDate) endpoint += `&end-date=${endDate}`;

  const headers: Record<string, string> = {};
  if (username || password) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  }

  const res = await fetch(endpoint, { method: 'GET', headers });
  if (!res.ok) {
    if (res.status === 402) {
      throw new Error(`SimpleFIN Payment Required (HTTP 402). Check your subscription at bridge.simplefin.org.`);
    }
    const text = await res.text().catch(() => '');
    throw new Error(`SimpleFIN API error: ${res.status} ${text}`);
  }
  const data = (await res.json()) as SimpleFinResponse;
  return { accounts: data.accounts ?? [], errors: data.errors ?? [] };
}

// ---- Settings helpers ---------------------------------------------------

const ENABLED_KEY = 'simplefin_enabled_account_ids';

export async function getEnabledSimpleFinAccountIds(userId: string): Promise<string[] | null> {
  const json = await getSetting(userId, ENABLED_KEY);
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

export async function setEnabledSimpleFinAccountIds(userId: string, ids: string[]): Promise<void> {
  await setSetting(userId, ENABLED_KEY, JSON.stringify(ids));
}

// ---- Sync ---------------------------------------------------------------

// HARDCODED — operators cannot tune these. Rationale: stay strictly inside
// SimpleFIN Bridge's documented limits (https://docs.simplefin.org/):
//   - <= 90 days per /accounts request (we use 60, with margin)
//   - <= 24 requests/day per access token (we use 12/day cron + 3-call
//     first-sync backfill, comfortably under quota)
const SIMPLEFIN_LOOKBACK_MONTHS = 6;
const SIMPLEFIN_LOOKBACK_MS = SIMPLEFIN_LOOKBACK_MONTHS * 30 * 24 * 60 * 60 * 1000;
const SIMPLEFIN_CHUNK_MS = 60 * 24 * 60 * 60 * 1000; // 60 days per request
// Re-pull from last_sync minus this buffer so we don't miss a transaction
// that posted in the gap between the last sync and the new one.
const SIMPLEFIN_INCREMENTAL_BUFFER_MS = 24 * 60 * 60 * 1000;

export interface ImportedAccount {
  // `simplefin-<sfId>` — the DB primary key.
  id: string;
  name: string;
  institution?: string;
  inferredType: InferredAccountType;
}

export interface SimpleFinSyncResult {
  accountsSynced: number;
  transactionsSynced: number;
  errors: string[];
  // Newly-upserted accounts with their inferred types. The UI uses
  // this to open a post-sync review carousel so the user can correct
  // any mis-classifications before they pollute the dashboard,
  // budget, and paydown views.
  imported: ImportedAccount[];
}

export async function syncSimpleFinToDatabase(
  userId: string,
  selectedAccountIds?: string[],
): Promise<SimpleFinSyncResult> {
  const accessUrl = await getSetting(userId, 'simplefin_access_url');
  if (!accessUrl) {
    throw new Error('SimpleFIN is not connected. Please provide a Setup Token first.');
  }

  if (selectedAccountIds && Array.isArray(selectedAccountIds)) {
    await setEnabledSimpleFinAccountIds(userId, selectedAccountIds);
  }
  const enabledAccountIds = selectedAccountIds ?? (await getEnabledSimpleFinAccountIds(userId));

  // Build the list of (start, end) windows to ask the bridge for.
  // First sync (no simplefin_last_sync yet): backfill SIMPLEFIN_LOOKBACK_MONTHS
  // in <= SIMPLEFIN_CHUNK_MS chunks. After that, incremental from the
  // watermark minus a 1-day safety buffer. addTransactionWithExternalId
  // dedupes on external_id, so any overlap is safe.
  const lastSyncRaw = await getSetting(userId, 'simplefin_last_sync');
  const now = Date.now();
  const windows: Array<[number, number]> = [];

  if (!lastSyncRaw) {
    const backfillStart = now - SIMPLEFIN_LOOKBACK_MS;
    for (let s = backfillStart; s < now; s += SIMPLEFIN_CHUNK_MS) {
      const startSec = Math.floor(s / 1000);
      const endSec = Math.floor(Math.min(s + SIMPLEFIN_CHUNK_MS, now) / 1000);
      windows.push([startSec, endSec]);
    }
  } else {
    const lastSyncMs = Date.parse(lastSyncRaw);
    const startMs = Number.isFinite(lastSyncMs)
      ? lastSyncMs - SIMPLEFIN_INCREMENTAL_BUFFER_MS
      : now - SIMPLEFIN_INCREMENTAL_BUFFER_MS;
    windows.push([Math.floor(startMs / 1000), Math.floor(now / 1000)]);
  }

  // Sequential, not parallel: respect the SimpleFIN quota, simpler error
  // handling, and dedup makes overlap safe anyway. Later windows' account
  // metadata wins when the same account appears in multiple windows.
  const rawAccountsById = new Map<string, SimpleFinAccount>();
  const errors: string[] = [];
  for (const [startSec, endSec] of windows) {
    const { accounts, errors: chunkErrors } = await fetchSimpleFinData(accessUrl, startSec, endSec);
    for (const acc of accounts) rawAccountsById.set(acc.id, acc);
    errors.push(...chunkErrors);
  }
  const rawAccounts = [...rawAccountsById.values()];

  const accountsToSync = enabledAccountIds
    ? rawAccounts.filter((a) => enabledAccountIds.includes(a.id) || enabledAccountIds.includes(`simplefin-${a.id}`))
    : rawAccounts;

  if (enabledAccountIds) {
    await deleteSimpleFinAccountsNotIn(userId, enabledAccountIds);
  }

  // Load the user's rules into a `lower(merchant) → {category, sub}` map
  // so we can apply them per-transaction without an N+1 query. Rules
  // win over the smart categoriser below — the user explicitly asked
  // for that mapping, so it should never be silently overridden by
  // pattern-matching.
  const ruleRows = await db
    .select({ matchValue: rules.matchValue, category: rules.category, subCategory: rules.subCategory })
    .from(rules)
    .where(and(eq(rules.userId, userId), eq(rules.matchType, 'exact')));
  const rulesMap = new Map<string, { category: string; subCategory?: string }>();
  for (const r of ruleRows) {
    rulesMap.set(r.matchValue.toLowerCase(), {
      category: r.category,
      subCategory: r.subCategory ?? undefined,
    });
  }

  let accountsSynced = 0;
  let transactionsSynced = 0;
  const imported: ImportedAccount[] = [];

  for (const sAcc of accountsToSync) {
    const parsedBalance = typeof sAcc.balance === 'number' ? sAcc.balance : parseFloat(sAcc.balance || '0');
    // Pass the org name + opaque `extra` block so `inferAccountType`
    // can use the institution signal and any bank-supplied type
    // metadata. Many servers (the SimpleFIN Bridge included) populate
    // `extra.account_type` for retirement and brokerage accounts.
    const institution = sAcc.org?.name ?? 'SimpleFIN Bank';
    const accType = inferAccountType(sAcc.name, parsedBalance, {
      institution,
      extra: sAcc.extra,
    });
    const accId = `simplefin-${sAcc.id}`;

    // If the user previously hid this account, skip the upsert AND the
    // transaction import. Without this check, deleting (or hiding) an
    // account would be undone by the next sync — the whole reason the
    // Hide button exists. The row stays in the DB so the user can
    // un-hide later and resume syncing.
    const [existing] = await db
      .select({ hidden: accounts.hidden })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.id, accId)))
      .limit(1);
    if (existing?.hidden) continue;

    await upsertAccount(userId, {
      id: accId,
      name: sAcc.name,
      type: accType,
      balance: Math.abs(parsedBalance),
      institution,
    });
    accountsSynced++;
    imported.push({
      id: accId,
      name: sAcc.name,
      institution,
      inferredType: accType,
    });

    if (sAcc.transactions && Array.isArray(sAcc.transactions)) {
      for (const sTx of sAcc.transactions) {
        const rawAmount = typeof sTx.amount === 'number' ? sTx.amount : parseFloat(sTx.amount || '0');
        const merchant = sTx.payee || sTx.description || 'Unknown Merchant';
        const dateStr = sTx.posted
          ? new Date(sTx.posted * 1000).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10);
        const isIncome = rawAmount > 0;
        const absAmount = Math.abs(rawAmount);
        // The categorizer can return a `type` override — it does for
        // credit card payments, where the amount-sign heuristic would
        // mislabel a positive payment on a credit account as income.
        // User-defined rules win over the smart categoriser on
        // category/subCategory so a rule for "Whole Foods Market" is
        // never silently overridden by the broader grocery patterns.
        // The `type` override is still respected (a rule for a
        // payment-shaped merchant should still land as a transfer).
        const smart = smartCategorizeMerchant(merchant, rawAmount);
        const ruleMatch = rulesMap.get(merchant.toLowerCase());
        const category = ruleMatch?.category ?? smart.category;
        const subCategory = ruleMatch?.subCategory ?? smart.subCategory;
        const suggestedType = smart.type;
        const txType = suggestedType ?? (isIncome ? 'income' : 'expense');

        const added = await addTransactionWithExternalId(userId, {
          date: dateStr,
          merchant,
          category,
          subCategory,
          account: sAcc.name,
          amount: absAmount,
          type: txType,
          notes: sTx.memo || (sTx.pending ? 'Pending Transaction' : undefined),
          externalId: `sf-${sTx.id}`,
        });
        if (added) transactionsSynced++;
      }
    }
  }

  await setSetting(userId, 'simplefin_last_sync', new Date().toISOString());
  return { accountsSynced, transactionsSynced, errors, imported };
}
