/**
 * Merchant string matching for categorization rules.
 *
 * Rules store a user-chosen `matchValue` (often the full payee from a
 * past transaction). Bank feeds append store numbers and location codes
 * (`STARBUCKS #12345`, `WHOLE FOODS MARKET 10234`), so equality alone
 * misses most re-imports. Matching is:
 *
 *   1. Case-insensitive, whitespace-normalized equality
 *   2. Prefix: merchant starts with the rule value at a word boundary
 *      (next char is end-of-string or non-letter — space, digit, #, *)
 *
 * When several rules match the same merchant, the longest `matchValue`
 * wins so a specific "Starbucks Reserve" rule beats a generic "Starbucks".
 */

export function normalizeMerchant(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** True when `merchant` is covered by a rule with the given `matchValue`. */
export function merchantMatchesRule(merchant: string, matchValue: string): boolean {
  const m = normalizeMerchant(merchant);
  const v = normalizeMerchant(matchValue);
  if (!m || !v) return false;
  if (m === v) return true;
  if (!m.startsWith(v)) return false;
  const next = m[v.length];
  // Boundary: end, or non-letter so "star" does not match "starbucks"
  // but "starbucks" matches "starbucks #1234" / "starbucks store 9".
  return !next || !/[a-z]/.test(next);
}

export type RuleTransactionType = 'income' | 'expense' | 'transfer';

export interface RuleMatchContext {
  merchant: string;
  accountId?: string;
  sourceType: RuleTransactionType;
  sourceCategory: string;
  sourceSubCategory?: string;
  sourceClassificationTrusted?: boolean;
}

export interface ScopedRuleConditions {
  id?: string;
  matchValue: string;
  accountId?: string | null;
  sourceType?: RuleTransactionType | null;
  sourceCategory?: string | null;
  sourceSubCategory?: string | null;
}

/** True when every populated rule condition matches the transaction source. */
export function transactionMatchesRule(
  context: RuleMatchContext,
  rule: ScopedRuleConditions,
): boolean {
  if (!merchantMatchesRule(context.merchant, rule.matchValue)) return false;
  if (rule.accountId != null && rule.accountId !== context.accountId) return false;
  if (
    context.sourceClassificationTrusted === false
    && (rule.sourceType != null || rule.sourceCategory != null || rule.sourceSubCategory != null)
  ) {
    return false;
  }
  if (rule.sourceType != null && rule.sourceType !== context.sourceType) return false;
  if (rule.sourceCategory != null && rule.sourceCategory !== context.sourceCategory) return false;
  if (rule.sourceSubCategory != null && rule.sourceSubCategory !== (context.sourceSubCategory ?? null)) {
    return false;
  }
  return true;
}

function conditionScore(rule: ScopedRuleConditions): number {
  // Powers of two define a total precedence for different condition sets.
  // Account is strongest because it identifies which ledger side posted.
  return Number(rule.accountId != null) * 8
    + Number(rule.sourceSubCategory != null) * 4
    + Number(rule.sourceCategory != null) * 2
    + Number(rule.sourceType != null);
}

/**
 * Pick one deterministic winner. Account, category, and type conditions have
 * an explicit precedence; merchant length then preserves prefix precedence.
 */
export function pickBestRuleMatch<T extends ScopedRuleConditions>(
  context: RuleMatchContext,
  ruleList: T[],
): T | null {
  let best: T | null = null;
  let bestConditions = -1;
  let bestLen = -1;
  for (const rule of ruleList) {
    if (!transactionMatchesRule(context, rule)) continue;
    const conditions = conditionScore(rule);
    const len = normalizeMerchant(rule.matchValue).length;
    const stableTieBreak = best != null
      && conditions === bestConditions
      && len === bestLen
      && (rule.id ?? '').localeCompare(best.id ?? '') < 0;
    if (conditions > bestConditions || (conditions === bestConditions && len > bestLen) || stableTieBreak) {
      best = rule;
      bestConditions = conditions;
      bestLen = len;
    }
  }
  return best;
}
