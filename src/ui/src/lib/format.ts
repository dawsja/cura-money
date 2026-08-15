/**
 * Number / date formatters used across pages. Amounts render in the
 * user's chosen display currency (USD by default); dates use mm/dd/yyyy.
 *
 * `formatMoney` reads a module-level "active currency" so the hundreds of
 * call sites don't each need the preference threaded through. The
 * CurrencyProvider keeps this in sync with the per-user setting and
 * re-renders the tree whenever it changes, so displayed amounts update.
 *
 * Ledger dates are bare `YYYY-MM-DD` (Postgres `date`). Parsing those
 * with `new Date(iso)` treats them as UTC midnight and shifts the
 * calendar day in western timezones — always go through parseLocalDate.
 */
const CURRENCY_STORAGE_KEY = 'cura.currency';
const DEFAULT_CURRENCY = 'USD';

/** Read the last-known currency synchronously so the very first paint
 *  after a reload uses the right symbol instead of flashing USD. */
function readInitialCurrency(): string {
  try {
    return localStorage.getItem(CURRENCY_STORAGE_KEY) || DEFAULT_CURRENCY;
  } catch {
    return DEFAULT_CURRENCY;
  }
}

let activeCurrency = readInitialCurrency();

const formatterCache = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string, whole: boolean): Intl.NumberFormat {
  const key = `${currency}|${whole ? 'w' : 'f'}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: whole ? 0 : 2,
    });
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/** Update the currency used by every subsequent `formatMoney` call and
 *  persist it for the next reload. Invalid codes fall back to USD. */
export function setActiveCurrency(currency: string): void {
  activeCurrency = currency || DEFAULT_CURRENCY;
  try {
    localStorage.setItem(CURRENCY_STORAGE_KEY, activeCurrency);
  } catch {
    // Storage can be unavailable in locked-down browser contexts.
  }
}

export function getActiveCurrency(): string {
  return activeCurrency;
}

/** The currency symbol for the active (or given) currency, e.g. "$", "€". */
export function currencySymbol(currency: string = activeCurrency): string {
  try {
    const parts = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? '$';
  } catch {
    return '$';
  }
}

export function formatMoney(n: number, whole = false): string {
  if (!Number.isFinite(n)) return '—';
  try {
    return moneyFormatter(activeCurrency, whole).format(n);
  } catch {
    return moneyFormatter(DEFAULT_CURRENCY, whole).format(n);
  }
}

/** Treat `YYYY-MM-DD` as a local calendar date (not UTC midnight). */
export function parseLocalDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(iso);
}

export function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayLocalISO(): string {
  return toLocalISODate(new Date());
}

export function formatDate(iso: string): string {
  const d = parseLocalDate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** Long form for section headers — "August 2, 2026". */
export function formatDateLong(iso: string): string {
  const d = parseLocalDate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `YYYY-MM` → "Jan 27". Compact enough for dense chart axes. */
export function monthYearShort(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTH_ABBREVIATIONS[Number(m) - 1] ?? ''} ${(y ?? '').slice(2)}`;
}

/** `YYYY-MM` → "Jan 2027". */
export function monthYearLong(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTH_ABBREVIATIONS[Number(m) - 1] ?? ''} ${y ?? ''}`;
}

export function shiftYearMonth(ym: string, delta: number): string {
  const [yStr, mStr] = ym.split('-');
  const d = new Date(Number(yStr), Number(mStr) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Render an ISO timestamp / Date as a short "X ago" string for badges
 * like "Last synced: 5m ago". Returns "just now" for < 30s, then
 * minute / hour / day units, capped at "Nd ago". Falls back to a
 * locale string for invalid input.
 */
export function timeAgo(input: string | Date | null | undefined): string {
  if (!input) return 'never';
  const d = typeof input === 'string' ? new Date(input) : input;
  const ms = Date.now() - d.getTime();
  if (Number.isNaN(ms)) return d.toLocaleString();
  if (ms < 30_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}
