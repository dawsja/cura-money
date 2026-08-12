/**
 * Display-currency preference. Amounts are stored as integer cents and are
 * currency-agnostic; this only controls how the UI renders them. The
 * whitelist mirrors `src/ui/src/lib/currency.tsx`.
 */
export const DEFAULT_CURRENCY = 'USD';
export const DISPLAY_CURRENCY_KEY = 'display_currency';

export const SUPPORTED_CURRENCY_CODES = [
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'CHF', 'CNY', 'INR',
  'BRL', 'MXN', 'ZAR', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'SGD',
  'HKD', 'KRW', 'TRY', 'AED', 'ILS',
] as const;

const supported = new Set<string>(SUPPORTED_CURRENCY_CODES);

export function isSupportedCurrency(code: unknown): code is string {
  return typeof code === 'string' && supported.has(code);
}

/** The stored currency for a user, falling back to the default when unset
 *  or no longer supported. */
export function resolveCurrency(raw: string | null | undefined): string {
  return isSupportedCurrency(raw) ? raw : DEFAULT_CURRENCY;
}
