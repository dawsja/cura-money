/**
 * Mirror of server `src/lib/merchant-match.ts` for client-side rule
 * existence checks (create-rule popup). Keep behaviour in sync.
 */

export function normalizeMerchant(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function merchantMatchesRule(merchant: string, matchValue: string): boolean {
  const m = normalizeMerchant(merchant);
  const v = normalizeMerchant(matchValue);
  if (!m || !v) return false;
  if (m === v) return true;
  if (!m.startsWith(v)) return false;
  const next = m[v.length];
  return !next || !/[a-z]/.test(next);
}
