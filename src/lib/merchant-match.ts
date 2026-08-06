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

/**
 * Pick the best matching rule for a merchant. Prefers the longest
 * matchValue among hits. Returns null when nothing matches.
 */
export function pickBestRuleMatch<T extends { matchValue: string }>(
  merchant: string,
  ruleList: T[],
): T | null {
  let best: T | null = null;
  let bestLen = -1;
  for (const rule of ruleList) {
    if (!merchantMatchesRule(merchant, rule.matchValue)) continue;
    const len = normalizeMerchant(rule.matchValue).length;
    if (len > bestLen) {
      best = rule;
      bestLen = len;
    }
  }
  return best;
}
