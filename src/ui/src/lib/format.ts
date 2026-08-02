/**
 * Number / date formatters used across pages. Match the locale the user
 * expects from a personal-finance app: USD, mm/dd/yyyy by default.
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

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
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
