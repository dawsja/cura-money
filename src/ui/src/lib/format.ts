/**
 * Number / date formatters used across pages. Match the locale the user
 * expects from a personal-finance app: USD, mm/dd/yyyy by default.
 *
 * Ledger dates are bare `YYYY-MM-DD` (Postgres `date`). Parsing those
 * with `new Date(iso)` treats them as UTC midnight and shifts the
 * calendar day in western timezones — always go through parseLocalDate.
 */
const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const usdWhole = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export function formatMoney(n: number, whole = false): string {
  if (!Number.isFinite(n)) return '—';
  return whole ? usdWhole.format(n) : usd.format(n);
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
