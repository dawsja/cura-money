import { useState, useEffect, useRef, useMemo, useId, Fragment } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import {
  formatMoney,
  formatDate,
  formatDateLong,
  todayLocalISO,
  toLocalISODate,
  parseLocalDate,
} from '../lib/format';
import {
  Trash2, Search, Receipt, ArrowLeftRight, Filter, X, Check, ArrowUpRight,
  BellRing, Plus, TrendingUp, TrendingDown, MoreVertical, Calendar, Pencil,
  ChevronRight,
} from 'lucide-react';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../components/ui/input-group';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  pageWindow,
} from '../components/ui/pagination';
import { DatePicker } from '../components/ui/date-picker';
import { Dialog } from '../components/ui/dialog';
import { useReviews } from '../components/ReviewsProvider';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import clsx from 'clsx';

/** Date-range toolbar presets. `custom` is set when the user edits from/to. */
type DatePreset = 'all' | '7d' | '30d' | '90d' | 'month' | 'ytd' | 'custom';

interface DateRangeState {
  preset: DatePreset;
  from: string; // YYYY-MM-DD or ''
  to: string;
}

const EMPTY_DATE_RANGE: DateRangeState = { preset: 'all', from: '', to: '' };

function resolveDatePreset(preset: Exclude<DatePreset, 'all' | 'custom'>): { from: string; to: string } {
  const to = todayLocalISO();
  const today = parseLocalDate(to);
  if (preset === '7d' || preset === '30d' || preset === '90d') {
    const days = preset === '7d' ? 6 : preset === '30d' ? 29 : 89;
    const from = new Date(today);
    from.setDate(from.getDate() - days);
    return { from: toLocalISODate(from), to };
  }
  if (preset === 'month') {
    return { from: toLocalISODate(new Date(today.getFullYear(), today.getMonth(), 1)), to };
  }
  // ytd
  return { from: toLocalISODate(new Date(today.getFullYear(), 0, 1)), to };
}

function dateRangeLabel(r: DateRangeState): string {
  if (r.preset === 'all' || (!r.from && !r.to)) return 'All dates';
  if (r.preset === '7d') return 'Last 7 days';
  if (r.preset === '30d') return 'Last 30 days';
  if (r.preset === '90d') return 'Last 90 days';
  if (r.preset === 'month') return 'This month';
  if (r.preset === 'ytd') return 'Year to date';
  if (r.from && r.to) return `${formatDate(r.from)} – ${formatDate(r.to)}`;
  if (r.from) return `From ${formatDate(r.from)}`;
  if (r.to) return `Until ${formatDate(r.to)}`;
  return 'Custom';
}

type TxType = 'income' | 'expense' | 'transfer';
const TX_TYPES: TxType[] = ['income', 'expense', 'transfer'];

/** Rows per page. Tuned to fit a comfortable full table on a 13" laptop. */
const PAGE_SIZE = 25;
const DESKTOP_QUERY = '(min-width: 768px)';

interface Transaction {
  id: string; date: string; merchant: string;
  sourceCategory: string; sourceSubCategory?: string; sourceType: TxType;
  sourceClassificationTrusted: boolean;
  category: string;
  subCategory?: string; account: string; accountId?: string; amount: number; type: TxType; notes?: string;
  splits?: TransactionSplit[];
}
interface TransactionSplit {
  id: string;
  amount: number;
  category: string;
  subCategory: string;
  type: TxType;
}
type EditableTransaction = Omit<
  Transaction,
  'id' | 'splits' | 'sourceCategory' | 'sourceSubCategory' | 'sourceType' | 'sourceClassificationTrusted'
>;
interface PageResponse { rows: Transaction[]; total: number; }
interface MainCategory { id: string; name: string; type: TxType; subCategories: { id: string; name: string }[]; }
interface Account { id: string; name: string; alias?: string; type?: string; }

/**
 * Reusable input class: white/slate-700 background, dark text, slate-200/600
 * border, amber-500 focus. Every <input>/<select> in this file uses it so
 * the dark-mode styling stays consistent.
 */
const INPUT_CLS = 'rounded-lg border border-default bg-surface fg-primary placeholder-slate-400 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none';
const ROW_SELECT_CLS = 'w-auto max-w-[9rem] rounded-md border border-control bg-surface py-1 pl-1.5 pr-5 text-xs fg-primary focus:border-amber-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';

/** Visual styling for a transaction type across the page. */
const TYPE_STYLE: Record<TxType, { label: string; sign: string; amount: string }> = {
  income: {
    label: 'Income',
    sign: '+',
    amount: 'text-emerald-600 dark:text-emerald-400',
  },
  expense: {
    label: 'Expense',
    sign: '−',
    amount: 'text-rose-600 dark:text-rose-400',
  },
  transfer: {
    label: 'Transfer',
    sign: '⇄',
    amount: 'text-slate-600 dark:text-slate-400',
  },
};

/** Leading icon for the mobile list rows — one glyph per type. */
const TYPE_ICON: Record<TxType, typeof TrendingUp> = {
  income: TrendingUp,
  expense: TrendingDown,
  transfer: ArrowLeftRight,
};

/** Tinted circle behind the mobile row icon (explicit light + dark pairs). */
const TYPE_ICON_WRAP: Record<TxType, string> = {
  income: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  expense: 'bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  transfer: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

/**
 * Filter state held by the Transactions page. Each field is `undefined`
 * (or empty / an empty Set) when the corresponding dimension has no
 * active filter — there's no "match nothing" mode; absence = no filter.
 */
interface FilterState {
  types: Set<TxType>;
  accounts: Set<string>;
  categoryPick: string;
  merchant: string;
  minAmount: string;
  maxAmount: string;
}

function validDateParam(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const parsed = parseLocalDate(value);
  return !Number.isNaN(parsed.getTime()) && toLocalISODate(parsed) === value ? value : '';
}

function accountIdsParam(value: string | null): Set<string> {
  if (!value) return new Set();
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === 'string' && id !== ''));
  } catch {
    return new Set(value.split(',').map((id) => id.trim()).filter(Boolean));
  }
  return new Set();
}

function finiteAmountParam(value: string | null): string {
  return value !== null && value !== '' && Number.isFinite(Number(value)) ? value : '';
}

function filtersFromParams(params: URLSearchParams): FilterState {
  const rawTypes = (params.get('types') ?? '').split(',');
  const types = new Set(rawTypes.filter((type): type is TxType => TX_TYPES.includes(type as TxType)));
  const category = params.get('category') ?? '';
  const subCategory = params.get('subCategory') ?? '';
  return {
    types,
    accounts: accountIdsParam(params.get('accountIds')),
    categoryPick: category ? JSON.stringify({ category, ...(subCategory ? { subCategory } : {}) }) : '',
    merchant: params.get('merchant') ?? '',
    minAmount: finiteAmountParam(params.get('minAmount') ?? params.get('min')),
    maxAmount: finiteAmountParam(params.get('maxAmount') ?? params.get('max')),
  };
}

function dateRangeFromParams(params: URLSearchParams): DateRangeState {
  const from = validDateParam(params.get('from'));
  const to = validDateParam(params.get('to'));
  if (!from && !to) return EMPTY_DATE_RANGE;
  for (const preset of ['7d', '30d', '90d', 'month', 'ytd'] as const) {
    const resolved = resolveDatePreset(preset);
    if (from === resolved.from && to === resolved.to) return { preset, from, to };
  }
  return { preset: 'custom', from, to };
}

function pageFromParams(params: URLSearchParams): number {
  const value = Number(params.get('page'));
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function hasActiveFilters(f: FilterState, q: string, accountCount: number): boolean {
  return f.types.size > 0
    || (f.accounts.size > 0 && f.accounts.size < accountCount)
    || f.categoryPick !== ''
    || f.merchant !== ''
    || f.minAmount !== ''
    || f.maxAmount !== ''
    || q.trim() !== '';
}

function activeFilterCount(f: FilterState, accountCount: number): number {
  let n = 0;
  if (f.types.size > 0) n++;
  if (f.accounts.size > 0 && f.accounts.size < accountCount) n++;
  if (f.categoryPick) n++;
  if (f.merchant) n++;
  if (f.minAmount || f.maxAmount) n++;
  return n;
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex min-h-8 max-w-full items-center gap-0.5 rounded-lg bg-amber-50 pl-2 pr-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="close-button flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
        aria-label={`Remove filter ${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function EmptyTransactions({
  filtered,
  onClear,
  onAdd,
  addDisabled,
}: {
  filtered: boolean;
  onClear: () => void;
  onAdd: () => void;
  addDisabled?: boolean;
}) {
  return (
    <div className="py-10 text-center">
      <Receipt className="mx-auto mb-2 h-5 w-5 fg-muted" />
      <p className="text-sm fg-muted">{filtered ? 'No transactions match.' : 'No transactions yet.'}</p>
      {filtered ? (
        <button
          type="button"
          onClick={onClear}
          className="mt-2 text-sm font-medium text-amber-700 hover:underline dark:text-amber-400"
        >
          Clear filters
        </button>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          disabled={addDisabled}
          className="mt-2 text-sm font-medium text-amber-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-400"
        >
          Add transaction
        </button>
      )}
    </div>
  );
}

export function Transactions() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get<MainCategory[]>('/api/categories') });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api.get<Account[]>('/api/accounts') });
  // Investment accounts are balance-only — keep them off the cash
  // ledger filter and the manual-add account picker.
  const ledgerAccounts = useMemo(
    () => (accounts.data ?? []).filter((a) => a.type !== 'investment' && a.type !== 'uncategorized'),
    [accounts.data],
  );
  // Distinct merchants — fetched once on mount so the merchant filter
  // dropdown doesn't issue a query per keystroke. The list is small
  // (one row per unique merchant, not per transaction) and changes only
  // when the user adds transactions, so we refetch alongside the
  // transactions list cache via the same `['transactions']` key.
  const merchants = useQuery({ queryKey: ['transactions', 'merchants'], queryFn: () => api.get<string[]>('/api/transactions/merchants') });

  // URL parameters are the only persisted view state. Every interaction
  // writes a canonical URL, and back/forward simply produces a new view.
  const q = searchParams.get('q') ?? '';
  const page = pageFromParams(searchParams);
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const dateRange = useMemo(() => dateRangeFromParams(searchParams), [searchParams]);
  const reviewed = searchParams.get('reviewed') === 'true';

  const setPage = (value: React.SetStateAction<number>) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      const resolved = typeof value === 'function' ? value(pageFromParams(current)) : value;
      if (resolved > 1) next.set('page', String(resolved)); else next.delete('page');
      return next;
    });
  };
  const setQ = (value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value.trim()) next.set('q', value); else next.delete('q');
      next.delete('page');
      return next;
    }, { replace: true });
  };
  const setFilters: React.Dispatch<React.SetStateAction<FilterState>> = (value) => {
    setSearchParams((current) => {
      const previous = filtersFromParams(current);
      const nextFilters = typeof value === 'function' ? value(previous) : value;
      const next = new URLSearchParams(current);
      const types = TX_TYPES.filter((type) => nextFilters.types.has(type));
      if (types.length) next.set('types', types.join(',')); else next.delete('types');
      const accountIds = Array.from(nextFilters.accounts).sort();
      if (accountIds.length) next.set('accountIds', JSON.stringify(accountIds)); else next.delete('accountIds');
      next.delete('category');
      next.delete('subCategory');
      if (nextFilters.categoryPick) {
        try {
          const picked = JSON.parse(nextFilters.categoryPick) as { category?: string; subCategory?: string };
          if (picked.category) next.set('category', picked.category);
          if (picked.subCategory) next.set('subCategory', picked.subCategory);
        } catch { /* malformed selections are omitted */ }
      }
      if (nextFilters.merchant) next.set('merchant', nextFilters.merchant); else next.delete('merchant');
      next.delete('min');
      next.delete('max');
      if (nextFilters.minAmount) next.set('minAmount', nextFilters.minAmount); else next.delete('minAmount');
      if (nextFilters.maxAmount) next.set('maxAmount', nextFilters.maxAmount); else next.delete('maxAmount');
      next.delete('page');
      return next;
    });
  };
  const [filterOpen, setFilterOpen] = useState(false);
  const filterContainerRef = useRef<HTMLDivElement>(null);
  const setDateRange = (value: DateRangeState) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      let { from, to } = value;
      if (from && to && from > to) [from, to] = [to, from];
      if (from) next.set('from', from); else next.delete('from');
      if (to) next.set('to', to); else next.delete('to');
      next.delete('page');
      return next;
    });
  };
  const [dateOpen, setDateOpen] = useState(false);
  const dateContainerRef = useRef<HTMLDivElement>(null);

  // Click-outside closes the filter popover. mousedown fires before
  // focus moves.
  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (filterContainerRef.current && !filterContainerRef.current.contains(target)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [filterOpen]);

  // Escape closes the popover — same affordance as the combobox.
  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFilterOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [filterOpen]);

  useEffect(() => {
    if (!dateOpen) return;
    const handler = (e: MouseEvent) => {
      if (dateContainerRef.current && !dateContainerRef.current.contains(e.target as Node)) {
        setDateOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dateOpen]);

  useEffect(() => {
    if (!dateOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDateOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [dateOpen]);

  // Build the API query string from the filter state. Memoised so the
  // query key only changes when a filter actually changes (not when
  // unrelated state updates re-render the component).
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String((page - 1) * PAGE_SIZE));
    if (q.trim()) params.set('q', q.trim());
    if (filters.types.size > 0) params.set('types', Array.from(filters.types).join(','));
    if (filters.accounts.size > 0 && (ledgerAccounts.length === 0 || filters.accounts.size < ledgerAccounts.length)) {
      params.set('accountIds', JSON.stringify(Array.from(filters.accounts)));
    }
    if (filters.categoryPick) {
      // JSON-encoded value carries both fields without a delimiter
      // that could collide with user-defined category names.
      try {
        const parsed = JSON.parse(filters.categoryPick) as { category: string; subCategory?: string };
        params.set('category', parsed.category);
        if (parsed.subCategory) params.set('subCategory', parsed.subCategory);
      } catch {
        /* ignore malformed */
      }
    }
    if (filters.merchant) params.set('merchant', filters.merchant);
    if (filters.minAmount) {
      const n = Number(filters.minAmount);
      if (Number.isFinite(n)) params.set('minAmount', String(n));
    }
    if (filters.maxAmount) {
      const n = Number(filters.maxAmount);
      if (Number.isFinite(n)) params.set('maxAmount', String(n));
    }
    let from = dateRange.from;
    let to = dateRange.to;
    if (from && to && from > to) {
      const tmp = from;
      from = to;
      to = tmp;
    }
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (reviewed) params.set('reviewed', 'true');
    return params.toString();
  }, [page, q, filters, dateRange, ledgerAccounts.length, reviewed]);

  const txns = useQuery({
    queryKey: ['transactions', 'page', queryString],
    queryFn: () => api.get<PageResponse>(`/api/transactions/page?${queryString}`),
  });
  const total = txns.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // A delete or a shrinking result set can invalidate the current page.
  // Only clamp after a successful response so changing pages does not
  // bounce through page 1 while the next page is loading.
  useEffect(() => {
    if (!txns.data || page <= totalPages) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (totalPages > 1) next.set('page', String(totalPages)); else next.delete('page');
      return next;
    }, { replace: true });
  }, [txns.data, page, totalPages, setSearchParams]);

  const invalidateFinancialQueries = () => {
    for (const key of ['transactions', 'reviews', 'accounts', 'dashboard', 'budget', 'reports', 'paydown', 'recurring', 'notifications', 'goals', 'simplefin']) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/api/transactions/${id}`),
    onSuccess: invalidateFinancialQueries,
  });

  // Manual transaction create. Server applies any matching user rule
  // to the category (rules win over what the user typed), so the new
  // row lands in the list with the rule's category rather than the
  // picker's. Refresh both the page query and the merchants list so
  // the new merchant immediately appears in the filter dropdown.
  const addTx = useMutation({
    mutationFn: (input: EditableTransaction) =>
      api.post<Transaction>('/api/transactions', input),
    onSuccess: invalidateFinancialQueries,
  });

  // User-defined rules. Loaded once on mount; consulted both by the
  // popup-trigger check below ("does a rule already exist for this
  // merchant?") and by the modal that creates a new rule. Invalidated
  // on rule create/edit/delete so the popup check stays fresh.
  interface Rule {
    id: string;
    matchType: 'exact';
    matchValue: string;
    accountId?: string;
    sourceType?: TxType;
    sourceCategory?: string;
    sourceSubCategory?: string;
    category: string;
    subCategory?: string;
    type?: TxType;
    updatedAt: string;
    version: number;
  }

  // `rulePrompt` is the bottom-right toast shown after an assignment
  // correction. Single-slot prompts mean rapid edits just
  // replace the current popup (its 8s timer resets) — earlier prompts
  // are silently overwritten, which is acceptable for a non-blocking
  // suggestion.
  const [rulePrompt, setRulePrompt] = useState<{
    rowId: string;
    merchant: string;
    account: string;
    sourceType: TxType;
    sourceCategory: string;
    sourceSubCategory?: string;
    sourceClassificationTrusted: boolean;
    category: string;
    subCategory?: string;
    type: TxType;
  } | null>(null);
  const rulePromptIdRef = useRef<string | null>(null);
  const [ruleConfirmation, setRuleConfirmation] = useState<{
    transactionId: string;
    existingRule: Rule;
  } | null>(null);
  const [assignmentDraft, setAssignmentDraft] = useState<{
    transaction: Transaction;
    type: TxType;
    categoryPick: string;
  } | null>(null);

  type RuleFromTransactionResult = {
    status: 'created' | 'narrowed' | 'updated' | 'unchanged' | 'confirmation_required';
    rule: Rule;
  };
  const createRuleFromTransaction = useMutation({
    mutationFn: (input: { transactionId: string; replaceRuleId?: string; expectedVersion?: number }) =>
      api.post<RuleFromTransactionResult>(`/api/rules/from-transaction/${input.transactionId}`, {
        replaceRuleId: input.replaceRuleId,
        expectedVersion: input.expectedVersion,
      }),
    onSuccess: (result, input) => {
      if (rulePromptIdRef.current !== input.transactionId && !input.replaceRuleId) return;
      if (result.status === 'confirmation_required') {
        setRuleConfirmation({ transactionId: input.transactionId, existingRule: result.rule });
        rulePromptIdRef.current = null;
        setRulePrompt(null);
        return;
      }
      qc.invalidateQueries({ queryKey: ['rules'] });
      setRuleConfirmation(null);
      rulePromptIdRef.current = null;
      setRulePrompt(null);
    },
  });

  // Pause auto-dismiss while the server is checking for an existing broad
  // rule so a required narrowing confirmation cannot be discarded.
  useEffect(() => {
    if (!rulePrompt || createRuleFromTransaction.isPending) return;
    const t = setTimeout(() => {
      rulePromptIdRef.current = null;
      setRulePrompt(null);
    }, 8000);
    return () => clearTimeout(t);
  }, [rulePrompt, createRuleFromTransaction.isPending]);

  // Type and category form one assignment and are always written together.
  // Rule creation is a separate, explicit action after the correction saves.
  const updateAssignmentInline = useMutation({
    mutationFn: (input: {
      transaction: Transaction;
      type: TxType;
      category: string;
      subCategory: string;
    }) =>
      api.patch<{ ok: true }>(`/api/transactions/${input.transaction.id}`, {
        type: input.type,
        category: input.category,
        subCategory: input.subCategory,
      }),
    onSuccess: (_data, vars) => {
      createRuleFromTransaction.reset();
      invalidateFinancialQueries();
      setDetailTx((current) => current?.id === vars.transaction.id ? null : current);
      rulePromptIdRef.current = vars.transaction.id;
      setRulePrompt({
        rowId: vars.transaction.id,
        merchant: vars.transaction.merchant,
        account: vars.transaction.account,
        sourceType: vars.transaction.sourceType,
        sourceCategory: vars.transaction.sourceCategory,
        sourceSubCategory: vars.transaction.sourceSubCategory,
        sourceClassificationTrusted: vars.transaction.sourceClassificationTrusted,
        category: vars.category,
        subCategory: vars.subCategory,
        type: vars.type,
      });
    },
  });
  const onPickCategory = (transaction: Transaction, jsonValue: string) => {
    let parsed: { category: string; subCategory: string };
    try {
      parsed = JSON.parse(jsonValue);
    } catch {
      return; // malformed option value, ignore
    }
    if (!parsed.category || !parsed.subCategory) return;
    updateAssignmentInline.mutate({
      transaction,
      type: transaction.type,
      category: parsed.category,
      subCategory: parsed.subCategory,
    });
  };

  const toggleType = (t: TxType) => {
    setFilters((prev) => {
      const next = new Set(prev.types);
      if (next.has(t)) next.delete(t); else next.add(t);
      return { ...prev, types: next };
    });
  };

  const clearFilters = () => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const key of ['q', 'types', 'accountIds', 'category', 'subCategory', 'merchant', 'min', 'max', 'minAmount', 'maxAmount', 'from', 'to', 'page']) {
        next.delete(key);
      }
      return next;
    });
  };

  const datesActive = !!dateRange.from || !!dateRange.to;
  const filterActive = hasActiveFilters(filters, q, ledgerAccounts.length) || datesActive;
  const popoverFilterCount = activeFilterCount(filters, ledgerAccounts.length);
  const filterChips: { key: string; label: string; onRemove: () => void }[] = [];
  if (q.trim()) {
    filterChips.push({ key: 'q', label: `Search: ${q.trim()}`, onRemove: () => setQ('') });
  }
  if (datesActive) {
    filterChips.push({ key: 'dates', label: dateRangeLabel(dateRange), onRemove: () => setDateRange(EMPTY_DATE_RANGE) });
  }
  for (const type of TX_TYPES) {
    if (filters.types.has(type)) {
      filterChips.push({ key: `type-${type}`, label: TYPE_STYLE[type].label, onRemove: () => toggleType(type) });
    }
  }
  if (filters.accounts.size > 0 && filters.accounts.size < ledgerAccounts.length) {
    for (const id of filters.accounts) {
      const account = ledgerAccounts.find((a) => a.id === id);
      filterChips.push({
        key: `account-${id}`,
        label: account?.alias || account?.name || id,
        onRemove: () => setFilters((prev) => {
          const next = new Set(prev.accounts);
          next.delete(id);
          return { ...prev, accounts: next };
        }),
      });
    }
  }
  if (filters.categoryPick) {
    let categoryLabel = 'Category';
    try {
      const parsed = JSON.parse(filters.categoryPick) as { category?: string; subCategory?: string };
      if (parsed.category) categoryLabel = parsed.subCategory ? `${parsed.category} › ${parsed.subCategory}` : parsed.category;
    } catch {
      categoryLabel = 'Category';
    }
    filterChips.push({ key: 'category', label: categoryLabel, onRemove: () => setFilters((prev) => ({ ...prev, categoryPick: '' })) });
  }
  if (filters.merchant) {
    filterChips.push({ key: 'merchant', label: filters.merchant, onRemove: () => setFilters((prev) => ({ ...prev, merchant: '' })) });
  }
  if (filters.minAmount || filters.maxAmount) {
    const min = filters.minAmount && Number.isFinite(Number(filters.minAmount)) ? formatMoney(Number(filters.minAmount)) : '';
    const max = filters.maxAmount && Number.isFinite(Number(filters.maxAmount)) ? formatMoney(Number(filters.maxAmount)) : '';
    const amountLabel = min && max ? `${min}–${max}` : min ? `≥ ${min}` : `≤ ${max}`;
    filterChips.push({
      key: 'amount',
      label: amountLabel,
      onRemove: () => setFilters((prev) => ({ ...prev, minAmount: '', maxAmount: '' })),
    });
  }

  // Mirror the bell badge so the banner is a discoverable backstop if
  // the user ignores the chrome. Clicking the CTA opens the same
  // carousel modal the bell drives.
  const reviews = useReviews();
  const dependenciesLoading = cats.isLoading || accounts.isLoading;
  const dependenciesError = cats.error ?? accounts.error;

  // Manual transaction entry. The "+ Add" button in the page header
  // opens the modal; submitting POSTs a new transaction and refreshes
  // the list (and the bell badge, since new rows may match the review
  // queue if the user left needs_review unset on creation).
  const [addOpen, setAddOpen] = useState(false);

  // Mobile detail modal — tapping a row on small screens opens a
  // read-only detail sheet showing all fields.
  const [detailTx, setDetailTx] = useState<Transaction | null>(null);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => {
      setIsDesktop(media.matches);
      if (media.matches) setDetailTx(null);
    };
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // Action modal — opened by the triple-dot button on each row.
  // Allows editing posting date and marking as recurring.
  const [actionTx, setActionTx] = useState<Transaction | null>(null);
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [deleteTx, setDeleteTx] = useState<Transaction | null>(null);

  const updateTransaction = useMutation({
    mutationFn: (input: {
      id: string;
      parent: EditableTransaction;
      splits: Omit<TransactionSplit, 'id'>[];
    }) => api.put<Transaction>(`/api/transactions/${input.id}/full`, {
      transaction: input.parent,
      splits: input.splits,
    }),
    onSuccess: invalidateFinancialQueries,
  });

  const updateTxDate = useMutation({
    mutationFn: (input: { id: string; date: string }) =>
      api.patch<{ ok: true }>(`/api/transactions/${input.id}`, { date: input.date }),
    onSuccess: invalidateFinancialQueries,
  });

  const markRecurring = useMutation({
    mutationFn: (input: { transactionId: string; frequency: 'weekly' | 'monthly' | 'yearly' }) =>
      api.post('/api/recurring/mark', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const dismissRecurring = useMutation({
    mutationFn: (input: { merchant: string; amount: number; account: string; accountId?: string }) =>
      api.post('/api/recurring/dismiss', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const changeTransactionType = (t: Transaction, newType: TxType) => {
    if (newType === t.type) return;
    const newBucketCats = (cats.data ?? []).filter((c) => c.type === newType || c.name === 'Pay down goals');
    const currentCategory = newBucketCats.find((c) => c.name === t.category);
    const stillValid = !!t.subCategory
      && currentCategory?.subCategories.some((s) => s.name === t.subCategory);
    if (stillValid && t.subCategory) {
      updateAssignmentInline.mutate({
        transaction: t,
        type: newType,
        category: t.category,
        subCategory: t.subCategory,
      });
      return;
    }
    if (detailTx?.id === t.id) setDetailTx(null);
    setAssignmentDraft({ transaction: t, type: newType, categoryPick: '' });
  };

  return (
    <div className="space-y-6 app-fab-page-space">
      <div className="flex items-baseline gap-2">
        <h1 className="text-2xl font-bold fg-primary">Transactions</h1>
        <span className="text-xs fg-muted tabular-nums">
          {txns.isLoading ? '…' : `${total.toLocaleString()} match${total === 1 ? '' : 'es'}`}
        </span>
      </div>

      {reviews.count > 0 && (
        <div data-onboarding-target="review-transactions" className="rounded-lg border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm fg-primary">
            <BellRing className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              You have {reviews.count} transaction{reviews.count === 1 ? '' : 's'} that need to be reviewed.
            </span>
          </div>
          <button
            type="button"
            onClick={reviews.openModal}
            className="text-sm font-semibold text-amber-700 dark:text-amber-400 hover:underline shrink-0"
          >
            Review now →
          </button>
        </div>
      )}

      {/* On mobile the section drops its card chrome so the list renders
          edge-to-edge on the page canvas, native-app style. */}
      <section className="card card-mobile-plain">
        <div className="mb-3 grid grid-cols-2 gap-2 md:flex md:items-center">
          <InputGroup className="col-span-2 min-h-11 min-w-0 md:min-h-0 md:flex-1">
            <InputGroupAddon aria-hidden="true">
              <Search className="h-4 w-4" />
            </InputGroupAddon>
            <InputGroupInput
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search merchants, accounts…"
              aria-label="Search transactions"
            />
          </InputGroup>

          <div ref={dateContainerRef} className="relative min-w-0 md:shrink-0">
            <button
              type="button"
              onClick={() => setDateOpen((o) => !o)}
              aria-expanded={dateOpen}
              aria-haspopup="dialog"
              aria-label="Date range"
              className={clsx(
                'inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors md:min-h-0 md:w-auto md:max-w-[11rem]',
                dateRange.preset !== 'all' && (dateRange.from || dateRange.to)
                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
              )}
            >
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{dateRangeLabel(dateRange)}</span>
            </button>
            {dateOpen && (
              <DateRangePopover
                value={dateRange}
                onChange={setDateRange}
                onClose={() => setDateOpen(false)}
              />
            )}
          </div>

          <div ref={filterContainerRef} className="relative min-w-0 md:shrink-0">
            <button
              type="button"
              onClick={() => setFilterOpen((o) => !o)}
              aria-expanded={filterOpen}
              aria-haspopup="dialog"
              aria-label="Filters"
              className={clsx(
                'inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors md:min-h-0 md:w-auto',
                popoverFilterCount > 0
                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
              )}
            >
              <Filter className="h-3.5 w-3.5" />
              <span>Filters</span>
              {popoverFilterCount > 0 && (
                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold tabular-nums text-slate-900">
                  {popoverFilterCount}
                </span>
              )}
            </button>

            {filterOpen && (
              <FilterPopover
                filters={filters}
                setFilters={setFilters}
                accounts={ledgerAccounts}
                categories={cats.data ?? []}
                merchants={merchants.data ?? []}
                clearEnabled={filterActive}
                onClear={clearFilters}
                onClose={() => setFilterOpen(false)}
              />
            )}
          </div>

          <button
            type="button"
            onClick={() => setAddOpen(true)}
            data-onboarding-target="add-transaction"
            disabled={dependenciesLoading || !!dependenciesError}
            className="hidden md:inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-900 px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 md:shrink-0"
            aria-label="Add transaction"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Transaction
          </button>
        </div>
        {filterChips.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {filterChips.map((chip) => (
              <FilterChip key={chip.key} label={chip.label} onRemove={chip.onRemove} />
            ))}
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-medium fg-muted hover:text-amber-700 dark:hover:text-amber-400"
            >
              Clear all
            </button>
          </div>
        )}
        {dependenciesLoading && (
          <p className="mb-3 rounded-lg border border-default bg-surface px-3 py-2 text-sm fg-muted" role="status">
            Loading categories and accounts…
          </p>
        )}
        {dependenciesError && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-300" role="alert">
            <span>Categories or accounts could not be loaded. Editing is unavailable.</span>
            <button type="button" onClick={() => { void cats.refetch(); void accounts.refetch(); }} className="font-semibold hover:underline">
              Retry
            </button>
          </div>
        )}
        {/* Mobile list — tappable rows grouped by date. Every field the
            desktop table shows (and edits) remains reachable through the
            detail bottom sheet each row opens. */}
        <div className="md:hidden">
          {txns.isLoading && (
            <p className="py-10 text-center text-sm fg-muted" role="status">Loading transactions…</p>
          )}
          {txns.isError && (
            <p className="py-10 text-center text-sm text-rose-700 dark:text-rose-300" role="alert">
              <span>Transactions could not be loaded.</span>{' '}
              <button type="button" onClick={() => void txns.refetch()} className="font-semibold hover:underline">Retry</button>
            </p>
          )}
          {txns.isSuccess && txns.data.rows.length === 0 && (
            <EmptyTransactions
              filtered={filterActive}
              onClear={clearFilters}
              onAdd={() => setAddOpen(true)}
              addDisabled={dependenciesLoading || !!dependenciesError}
            />
          )}
          {txns.isSuccess && txns.data.rows.map((t, idx) => {
            const prevDate = idx > 0 ? txns.data!.rows[idx - 1]!.date : null;
            const showDateHeader = t.date !== prevDate;
            const splitCount = t.splits?.length ?? 0;
            const TypeIcon = TYPE_ICON[t.type];
            return (
              <Fragment key={t.id}>
                {showDateHeader && (
                  <div className={clsx('flex items-center gap-3 pb-2', idx === 0 ? 'pt-1' : 'pt-5')}>
                    <span className="shrink-0 text-xs font-semibold fg-primary">{formatDateLong(t.date)}</span>
                    <span className="flex-1 border-t border-default" aria-hidden="true" />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setDetailTx(t)}
                  className="flex w-full items-center gap-3 border-b border-default py-3 text-left transition-transform active:scale-[0.99]"
                  aria-label={`${t.merchant}, ${TYPE_STYLE[t.type].label}, ${formatMoney(t.amount)} — view details`}
                >
                  <span className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', TYPE_ICON_WRAP[t.type])} aria-hidden="true">
                    <TypeIcon className="h-[18px] w-[18px]" strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold fg-primary">{t.merchant}</span>
                    <span className="mt-0.5 block truncate text-xs fg-muted">
                      {splitCount > 0
                        ? `${splitCount} split${splitCount === 1 ? '' : 's'}`
                        : (t.subCategory || t.category || 'Uncategorized')}
                      {' · '}
                      {t.account}
                    </span>
                  </span>
                  <span className={clsx('shrink-0 text-sm font-semibold tabular-nums', TYPE_STYLE[t.type].amount)}>
                    {TYPE_STYLE[t.type].sign}{formatMoney(t.amount)}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 fg-muted" aria-hidden="true" />
                </button>
              </Fragment>
            );
          })}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase fg-muted">
                <th className="py-2">Merchant</th>
                <th className="py-2">Type</th>
                <th className="py-2">Category</th>
                <th className="py-2">Account</th>
                <th className="py-2 text-right">Amount</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {txns.isLoading && (
                <tr><td colSpan={6} className="py-8 text-center text-sm fg-muted" role="status">Loading transactions…</td></tr>
              )}
              {txns.isError && (
                <tr><td colSpan={6} className="py-8 text-center text-sm text-rose-700 dark:text-rose-300" role="alert">
                  <span>Transactions could not be loaded.</span>{' '}
                  <button type="button" onClick={() => void txns.refetch()} className="font-semibold hover:underline">Retry</button>
                </td></tr>
              )}
              {txns.isSuccess && txns.data.rows.map((t, idx) => {
                const rowCats = (cats.data ?? []).filter((c) => c.type === t.type || c.name === 'Pay down goals');
                const currentValue = (() => {
                  const cat = rowCats.find((c) => c.name === t.category);
                  if (!cat) return '';
                  if (t.subCategory && cat.subCategories.some((s) => s.name === t.subCategory)) {
                    return JSON.stringify({ category: cat.name, subCategory: t.subCategory });
                  }
                  return '';
                })();
                const hasSplits = (t.splits?.length ?? 0) > 0;
                const prevDate = idx > 0 ? txns.data!.rows[idx - 1]!.date : null;
                const showDateHeader = t.date !== prevDate;
                return (
                  <Fragment key={t.id}>
                  {showDateHeader && (
                    <tr>
                      <td colSpan={6} className="px-0 pb-2 pt-4">
                        <div className="flex items-center gap-3">
                          <span className="shrink-0 text-xs font-semibold fg-primary">
                            {formatDateLong(t.date)}
                          </span>
                          <span className="flex-1 border-t border-default" aria-hidden="true" />
                        </div>
                      </td>
                    </tr>
                  )}
                  <tr className="cursor-pointer border-b border-default md:cursor-default" onClick={() => { if (!isDesktop) setDetailTx(t); }}>
                    <td className="py-2 fg-primary">
                      <div>{t.merchant}</div>
                      {hasSplits && (
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] fg-muted">
                          {t.splits!.map((split, splitIndex) => (
                            <span key={split.id || splitIndex}>
                              {split.category} › {split.subCategory} ·{' '}
                              <span className={clsx('font-semibold tabular-nums', TYPE_STYLE[split.type].amount)}>
                                {TYPE_STYLE[split.type].sign}{formatMoney(split.amount)}
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-2">
                      <select
                        value={t.type}
                        disabled={hasSplits || updateAssignmentInline.isPending || createRuleFromTransaction.isPending || !!cats.error}
                        aria-label="Transaction type"
                        title={hasSplits ? 'Edit the transaction to change split allocations.' : undefined}
                        className={`${ROW_SELECT_CLS} font-medium`}
                        onChange={(e) => {
                          const newType = e.target.value as TxType;
                          if (newType === t.type) return;
                          changeTransactionType(t, newType);
                        }}
                      >
                        {TX_TYPES.map((type) => (
                          <option key={type} value={type}>{TYPE_STYLE[type].label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2">
                      <select
                        value={currentValue}
                        onChange={(e) => onPickCategory(t, e.target.value)}
                        disabled={hasSplits || updateAssignmentInline.isPending || createRuleFromTransaction.isPending || !!cats.error}
                        aria-label="Transaction category"
                        title={hasSplits ? 'Edit the transaction to change split allocations.' : (t.subCategory ? `${t.category} › ${t.subCategory}` : t.category)}
                        className={ROW_SELECT_CLS}
                      >
                        {!currentValue && <option value="">Select category</option>}
                        {rowCats.map((c) => (
                          <optgroup key={c.id} label={c.name}>
                            {c.subCategories.map((s) => (
                              <option
                                key={s.id}
                                value={JSON.stringify({ category: c.name, subCategory: s.name })}
                              >
                                {s.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 fg-tertiary">{t.account}</td>
                    <td className={clsx('py-2 text-right font-semibold tabular-nums', TYPE_STYLE[t.type].amount)}>
                      {TYPE_STYLE[t.type].sign}{formatMoney(t.amount)}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setActionTx(t); }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg fg-tertiary transition-colors hover:bg-slate-100 hover:fg-secondary dark:hover:bg-slate-700"
                        aria-label="Transaction actions"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                  </Fragment>
                );
              })}
              {txns.isSuccess && txns.data.rows.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyTransactions
                      filtered={filterActive}
                      onClear={clearFilters}
                      onAdd={() => setAddOpen(true)}
                      addDisabled={dependenciesLoading || !!dependenciesError}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/*
          Pagination — only render when there's more than one page. The
          window helper collapses long ranges into "1 … 4 5 6 … 10"
          so the bar stays short even with thousands of rows.
        */}
        {totalPages > 1 && (
          <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="text-xs fg-muted tabular-nums">
              Page {page} of {totalPages.toLocaleString()}
            </div>
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  />
                </PaginationItem>
                {pageWindow(page, totalPages).map((n, i) =>
                  n === 'ellipsis' ? (
                    <PaginationItem key={`e-${i}`}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={n}>
                      <PaginationLink
                        isActive={n === page}
                        onClick={() => setPage(n)}
                      >
                        {n}
                      </PaginationLink>
                    </PaginationItem>
                  ),
                )}
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </section>

      {/* Mobile floating action button — the page's primary action, kept
          in the right thumb zone above the pill tab bar. Shares the
          onboarding target with the desktop toolbar button; the provider
          picks whichever one is visible at the current breakpoint. */}
      <button
        type="button"
        onClick={() => setAddOpen(true)}
        data-onboarding-target="add-transaction"
        disabled={dependenciesLoading || !!dependenciesError}
        aria-label="Add transaction"
        className="app-fab md:hidden flex h-14 w-14 items-center justify-center rounded-full bg-amber-500 text-slate-900 shadow-[0_10px_30px_rgba(0,0,0,0.35)] transition-transform active:scale-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="h-6 w-6" strokeWidth={2.4} />
      </button>

      {rulePrompt && (
        <div className="app-toast fixed z-[60] max-w-sm rounded-lg border border-default bg-surface shadow-lg px-4 py-3 text-sm flex items-start gap-3">
          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="fg-primary">
              Saved {TYPE_STYLE[rulePrompt.type].label} · {rulePrompt.category}
              {rulePrompt.subCategory ? ` › ${rulePrompt.subCategory}` : ''}.
            </div>
            <div className="mt-1 text-xs fg-muted">
              {rulePrompt.sourceClassificationTrusted
                ? `Match ${TYPE_STYLE[rulePrompt.sourceType].label} · ${rulePrompt.sourceCategory}${rulePrompt.sourceSubCategory ? ` › ${rulePrompt.sourceSubCategory}` : ''} on ${rulePrompt.account}.`
                : `Match this merchant on ${rulePrompt.account}. Original type/category was not retained for this older transaction.`}
            </div>
            <button
              type="button"
              disabled={createRuleFromTransaction.isPending}
              onClick={() => createRuleFromTransaction.mutate({ transactionId: rulePrompt.rowId })}
              className="mt-1 inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 hover:underline disabled:opacity-50"
            >
              {createRuleFromTransaction.isPending ? 'Checking rule…' : 'Create scoped rule'}
              <ArrowUpRight className="h-3 w-3" />
            </button>
            {createRuleFromTransaction.isError && (
              <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                {createRuleFromTransaction.error.message}
              </div>
            )}
          </div>
          <button
            type="button"
              onClick={() => {
                rulePromptIdRef.current = null;
                setRulePrompt(null);
              }}
            className="close-button rounded-md p-1"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {updateAssignmentInline.isError && !assignmentDraft && (
        <div className="app-toast fixed z-[60] max-w-sm rounded-lg border border-rose-200 bg-surface shadow-lg px-4 py-3 text-sm flex items-start gap-3">
          <div className="flex-1 min-w-0 text-rose-600 dark:text-rose-400">
            Assignment was not saved: {updateAssignmentInline.error.message}
          </div>
          <button
            type="button"
            onClick={() => updateAssignmentInline.reset()}
            className="close-button rounded-md p-1"
            aria-label="Dismiss assignment error"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {ruleConfirmation && (
        <ConfirmDialog
          title={ruleConfirmation.existingRule.accountId ? 'Update existing scoped rule?' : 'Narrow existing broad rule?'}
          confirmLabel={ruleConfirmation.existingRule.accountId ? 'Update rule' : 'Narrow rule'}
          onConfirm={async () => {
            const result = await createRuleFromTransaction.mutateAsync({
              transactionId: ruleConfirmation.transactionId,
              replaceRuleId: ruleConfirmation.existingRule.id,
              expectedVersion: ruleConfirmation.existingRule.version,
            });
            if (result.status === 'confirmation_required') {
              throw new Error('The matching rule changed. Review the updated rule and confirm again.');
            }
          }}
          onClose={() => setRuleConfirmation(null)}
        >
          <p>
            The existing rule for <span className="font-medium fg-primary">{ruleConfirmation.existingRule.matchValue}</span>{' '}
            currently sets {ruleConfirmation.existingRule.type ? `${TYPE_STYLE[ruleConfirmation.existingRule.type].label} · ` : ''}
            {ruleConfirmation.existingRule.category}
            {ruleConfirmation.existingRule.subCategory ? ` › ${ruleConfirmation.existingRule.subCategory}` : ''}.
          </p>
          <p>
            Confirming replaces it with this transaction&apos;s account, original type, and original category conditions.
          </p>
        </ConfirmDialog>
      )}

      {assignmentDraft && (
        <ConfirmDialog
          title={`Choose a category for ${TYPE_STYLE[assignmentDraft.type].label}`}
          confirmLabel="Save assignment"
          onConfirm={async () => {
            let selected: { category: string; subCategory: string };
            try {
              selected = JSON.parse(assignmentDraft.categoryPick) as { category: string; subCategory: string };
            } catch {
              throw new Error('Choose a category before saving.');
            }
            if (!selected.category || !selected.subCategory) throw new Error('Choose a category before saving.');
            await updateAssignmentInline.mutateAsync({
              transaction: assignmentDraft.transaction,
              type: assignmentDraft.type,
              category: selected.category,
              subCategory: selected.subCategory,
            });
          }}
          onClose={() => setAssignmentDraft(null)}
        >
          <p>The transaction will not change until both its type and category can be saved together.</p>
          <select
            value={assignmentDraft.categoryPick}
            onChange={(event) => setAssignmentDraft((current) => current ? {
              ...current,
              categoryPick: event.target.value,
            } : null)}
            className={`w-full ${INPUT_CLS}`}
            aria-label="New transaction category"
          >
            <option value="">Choose a category</option>
            {(cats.data ?? [])
              .filter((category) => category.type === assignmentDraft.type || category.name === 'Pay down goals')
              .map((category) => (
                <optgroup key={category.id} label={category.name}>
                  {category.subCategories.map((subCategory) => (
                    <option
                      key={subCategory.id}
                      value={JSON.stringify({ category: category.name, subCategory: subCategory.name })}
                    >
                      {subCategory.name}
                    </option>
                  ))}
                </optgroup>
              ))}
          </select>
        </ConfirmDialog>
      )}

      {addOpen && (
        <AddTransactionModal
          categories={cats.data ?? []}
          accounts={ledgerAccounts}
          isPending={addTx.isPending}
          error={addTx.error?.message ?? null}
          onClose={() => setAddOpen(false)}
          onSubmit={async (input) => {
            await addTx.mutateAsync(input);
            setAddOpen(false);
          }}
        />
      )}

      {detailTx && !isDesktop && (
        <TransactionDetailModal
          transaction={detailTx}
          categories={cats.data ?? []}
          isPending={updateAssignmentInline.isPending || createRuleFromTransaction.isPending}
          onClose={() => setDetailTx(null)}
          onChangeType={(type) => changeTransactionType(detailTx, type)}
          onChangeCategory={(value) => onPickCategory(detailTx, value)}
          onActions={() => { setActionTx(detailTx); setDetailTx(null); }}
          onDelete={() => setDeleteTx(detailTx)}
        />
      )}

      {actionTx && (
        <TransactionActionModal
          transaction={actionTx}
          onClose={() => setActionTx(null)}
          onEdit={() => { updateTransaction.reset(); setEditTx(actionTx); }}
          editDisabled={dependenciesLoading || !!dependenciesError}
          onUpdateDate={async (id, date) => {
            await updateTxDate.mutateAsync({ id, date });
          }}
          onSetRecurring={async (frequency) => {
            const identity = {
              merchant: actionTx.merchant,
              amount: actionTx.amount,
              account: actionTx.account,
              accountId: actionTx.accountId,
            };
            if (frequency === 'none') {
              await dismissRecurring.mutateAsync(identity);
            } else {
              await markRecurring.mutateAsync({ transactionId: actionTx.id, frequency });
            }
          }}
          onDelete={() => setDeleteTx(actionTx)}
          isPending={updateTxDate.isPending || markRecurring.isPending || dismissRecurring.isPending}
        />
      )}

      {editTx && (
        <EditTransactionModal
          transaction={editTx}
          categories={cats.data ?? []}
          accounts={ledgerAccounts}
          isPending={updateTransaction.isPending}
          error={updateTransaction.error?.message ?? null}
          onClose={() => { if (!updateTransaction.isPending) { updateTransaction.reset(); setEditTx(null); } }}
          onSubmit={async (parent, splits) => {
            await updateTransaction.mutateAsync({ id: editTx.id, parent, splits });
            setEditTx(null);
            setActionTx(null);
          }}
        />
      )}

      {deleteTx && (
        <ConfirmDialog
          title="Delete transaction?"
          confirmLabel="Delete transaction"
          destructive
          onClose={() => setDeleteTx(null)}
          onConfirm={async () => {
            await del.mutateAsync(deleteTx.id);
            setDetailTx(null);
            setActionTx(null);
          }}
        >
          <p>This permanently deletes the transaction for <strong className="fg-primary">{deleteTx.merchant}</strong>.</p>
          <p>If it came from SimpleFIN, later syncs will not import it again.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/**
 * TransactionDetailModal — mobile-only bottom sheet showing full details
 * of a tapped transaction. Renders date, merchant, type, category,
 * account, amount, and notes in a readable card layout. Includes a
 * delete action so the user doesn't lose that capability on mobile.
 */
function TransactionDetailModal({
  transaction: t,
  categories,
  isPending,
  onClose,
  onChangeType,
  onChangeCategory,
  onActions,
  onDelete,
}: {
  transaction: Transaction;
  categories: MainCategory[];
  isPending: boolean;
  onClose: () => void;
  onChangeType: (type: TxType) => void;
  onChangeCategory: (value: string) => void;
  onActions: () => void;
  onDelete: (id: string) => void;
}) {
  const rowCats = categories.filter((c) => c.type === t.type || c.name === 'Pay down goals');
  const categoryValue = (() => {
    const category = rowCats.find((c) => c.name === t.category);
    if (!category || !t.subCategory || !category.subCategories.some((s) => s.name === t.subCategory)) return '';
    return JSON.stringify({ category: category.name, subCategory: t.subCategory });
  })();

  return (
    <Dialog
      aria-label="Transaction details"
      onClose={onClose}
      closeDisabled={isPending}
      variant="bottom-sheet"
      overlayClassName="md:hidden"
      contentClassName="mobile-sheet card w-full rounded-b-none rounded-t-3xl border-b-0"
    >
        <div className="mx-auto -mt-1 mb-4 h-1.5 w-10 rounded-full bg-slate-600" aria-hidden="true" />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold fg-primary">{t.merchant}</h3>
            <p className={clsx('mt-0.5 text-base font-semibold tabular-nums', TYPE_STYLE[t.type].amount)}>
              {TYPE_STYLE[t.type].sign}{formatMoney(t.amount)}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={isPending} className="close-button flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <dl className="space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="fg-tertiary">Date</dt>
            <dd className="fg-primary font-medium">{formatDate(t.date)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="fg-tertiary">Account</dt>
            <dd className="fg-primary font-medium">{t.account}</dd>
          </div>
          {!!t.splits?.length && (
            <div className="space-y-2 border-t border-default pt-3">
              <dt className="fg-tertiary">Split allocations</dt>
              {t.splits.map((split, index) => (
                <dd key={split.id || index} className="flex items-start justify-between gap-3 pl-3 text-xs">
                  <span className="fg-primary">{split.category} › {split.subCategory} <span className="fg-muted">({TYPE_STYLE[split.type].label})</span></span>
                  <span className={clsx('shrink-0 font-semibold tabular-nums', TYPE_STYLE[split.type].amount)}>
                    {TYPE_STYLE[split.type].sign}{formatMoney(split.amount)}
                  </span>
                </dd>
              ))}
            </div>
          )}
          {t.notes && (
            <div className="flex justify-between">
              <dt className="fg-tertiary">Notes</dt>
              <dd className="max-w-[60%] text-right font-medium fg-primary">{t.notes}</dd>
            </div>
          )}
        </dl>

        <div className="mt-5 grid gap-3 border-t border-default pt-5">
          <label className="grid gap-1.5 text-sm font-medium fg-secondary">
            Type
            <select
              value={t.type}
              disabled={isPending || !!t.splits?.length}
              onChange={(event) => onChangeType(event.target.value as TxType)}
              className={`${INPUT_CLS} w-full`}
            >
              {TX_TYPES.map((type) => <option key={type} value={type}>{TYPE_STYLE[type].label}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium fg-secondary">
            Category
            <select
              value={categoryValue}
              disabled={isPending || !!t.splits?.length}
              onChange={(event) => onChangeCategory(event.target.value)}
              className={`${INPUT_CLS} w-full`}
            >
              {!categoryValue && <option value="">Select category</option>}
              {rowCats.map((category) => (
                <optgroup key={category.id} label={category.name}>
                  {category.subCategories.map((subCategory) => (
                    <option
                      key={subCategory.id}
                      value={JSON.stringify({ category: category.name, subCategory: subCategory.name })}
                    >
                      {subCategory.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {!!t.splits?.length && (
            <p className="text-xs fg-muted">This is a split transaction. Use More actions, then Edit transaction, to change its type or allocations.</p>
          )}
        </div>

        <div className="mt-6 grid gap-2">
          <button
            type="button"
            onClick={onActions}
            disabled={isPending}
            className="btn-primary inline-flex items-center justify-center disabled:opacity-50"
          >
            More actions
          </button>
          <button
            type="button"
            onClick={() => onDelete(t.id)}
            disabled={isPending}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-900/20"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
    </Dialog>
  );
}

const DATE_PRESETS: { value: Exclude<DatePreset, 'custom'>; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: 'month', label: 'This month' },
  { value: 'ytd', label: 'YTD' },
];

function DateRangePopover({
  value,
  onChange,
  onClose,
}: {
  value: DateRangeState;
  onChange: (next: DateRangeState) => void;
  onClose: () => void;
}) {
  const pickPreset = (preset: Exclude<DatePreset, 'custom'>) => {
    if (preset === 'all') {
      onChange(EMPTY_DATE_RANGE);
      return;
    }
    const { from, to } = resolveDatePreset(preset);
    onChange({ preset, from, to });
  };

  const setFrom = (from: string) => {
    onChange({ preset: 'custom', from, to: value.to });
  };
  const setTo = (to: string) => {
    onChange({ preset: 'custom', from: value.from, to });
  };

  const active = value.preset !== 'all' && (!!value.from || !!value.to);

  return (
    <>
    <div className="fixed inset-0 z-40 bg-black/40 md:hidden" aria-hidden="true" onClick={onClose} />
    <div
      role="dialog"
      aria-label="Date range"
      className="mobile-popover absolute top-full left-0 z-50 mt-2 w-[20rem] max-w-[calc(100vw-1.5rem)] card shadow-lg p-4 space-y-3 md:left-auto md:right-0"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold fg-primary">Date range</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close date range"
          className="close-button flex h-11 w-11 items-center justify-center rounded-lg md:h-8 md:w-8"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {DATE_PRESETS.map((opt) => {
          const isActive =
            opt.value === 'all'
              ? value.preset === 'all' || (!value.from && !value.to)
              : value.preset === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => pickPreset(opt.value)}
              aria-pressed={isActive}
              className={clsx(
                'min-h-11 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors md:min-h-0',
                isActive
                  ? 'bg-amber-500 text-slate-900 border-amber-500'
                  : 'bg-surface fg-secondary border-default hover:border-amber-500 hover:text-amber-700 dark:hover:text-amber-400',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs fg-secondary uppercase tracking-wide">From</span>
          <input
            type="date"
            value={value.from}
            onChange={(e) => setFrom(e.target.value)}
            className={`mt-1 w-full ${INPUT_CLS} py-1.5`}
          />
        </label>
        <label className="block">
          <span className="text-xs fg-secondary uppercase tracking-wide">To</span>
          <input
            type="date"
            value={value.to}
            onChange={(e) => setTo(e.target.value)}
            className={`mt-1 w-full ${INPUT_CLS} py-1.5`}
          />
        </label>
      </div>

      {active && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_DATE_RANGE)}
          className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline"
        >
          Clear dates
        </button>
      )}
    </div>
    </>
  );
}

/**
 * Filter popover anchored to the filter button. Owns no state of its
 * own — reads / writes the parent's `filters` state and applies every
 * change immediately (no "Apply" button).
 *
 * Sections:
 *   1. Type      — three toggle chips (income / expense / transfer)
 *   2. Account   — searchable combobox over the user's accounts
 *   3. Category  — searchable combobox over grouped sub-categories
 *   4. Merchant  — searchable combobox over the user's distinct
 *                  merchants (loaded from `/api/transactions/merchants`)
 *   5. Amount    — min + max number inputs
 *   Footer       — "Clear all" button (only enabled when something is
 *                  active) and a Close (X) button
 */
function FilterPopover({
  filters,
  setFilters,
  accounts,
  categories,
  merchants,
  clearEnabled,
  onClear,
  onClose,
}: {
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  accounts: Account[];
  categories: MainCategory[];
  merchants: string[];
  clearEnabled: boolean;
  onClear: () => void;
  onClose: () => void;
}) {
  // Local string state for amount inputs — lets the user type partial
  // values like "1." without the parent re-running the query on every
  // keystroke. The query effect below syncs into the parent state
  // when the value is a valid number.
  const [minStr, setMinStr] = useState(filters.minAmount);
  const [maxStr, setMaxStr] = useState(filters.maxAmount);

  // Keep local amount state in sync when the parent resets (e.g.
  // "Clear all" pressed while the popover is still open).
  useEffect(() => { setMinStr(filters.minAmount); }, [filters.minAmount]);
  useEffect(() => { setMaxStr(filters.maxAmount); }, [filters.maxAmount]);

  // Mirror the local string back into the parent filter state, but
  // only when it parses to a valid finite number. Empty strings clear
  // the filter (so the query drops the `minAmount` / `maxAmount`
  // param entirely).
  const onMinChange = (v: string) => {
    setMinStr(v);
    if (v === '') {
      setFilters((prev) => ({ ...prev, minAmount: '' }));
    } else {
      const n = Number(v);
      if (Number.isFinite(n)) setFilters((prev) => ({ ...prev, minAmount: v }));
    }
  };
  const onMaxChange = (v: string) => {
    setMaxStr(v);
    if (v === '') {
      setFilters((prev) => ({ ...prev, maxAmount: '' }));
    } else {
      const n = Number(v);
      if (Number.isFinite(n)) setFilters((prev) => ({ ...prev, maxAmount: v }));
    }
  };

  const anythingActive =
    filters.types.size > 0
    || (filters.accounts.size > 0 && filters.accounts.size < accounts.length)
    || filters.categoryPick !== ''
    || filters.merchant !== ''
    || filters.minAmount !== ''
    || filters.maxAmount !== '';

  return (
    <>
    <div className="fixed inset-0 z-40 bg-black/40 md:hidden" aria-hidden="true" onClick={onClose} />
    <div
      role="dialog"
      aria-label="Filters"
      className="mobile-popover absolute top-full right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-1.5rem)] card shadow-lg p-4 space-y-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold fg-primary">Filters</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close filters"
          className="close-button flex h-11 w-11 items-center justify-center rounded-lg md:h-8 md:w-8"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <FilterSection label="Type">
        <div className="flex flex-wrap gap-1.5">
          {TX_TYPES.map((t) => {
            const active = filters.types.has(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setFilters((prev) => {
                    const next = new Set(prev.types);
                    if (next.has(t)) next.delete(t); else next.add(t);
                    return { ...prev, types: next };
                  });
                }}
                aria-pressed={active}
                className={clsx(
                  'inline-flex min-h-11 items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors md:min-h-0',
                  active
                    ? 'bg-amber-500 text-slate-900 border-amber-500'
                    : 'bg-surface fg-secondary border-default hover:border-amber-500 hover:text-amber-700 dark:hover:text-amber-400',
                )}
              >
                <span className={clsx(
                  'inline-block h-1.5 w-1.5 rounded-full',
                  t === 'income' && 'bg-emerald-500',
                  t === 'expense' && 'bg-rose-500',
                  t === 'transfer' && 'bg-slate-400',
                )} aria-hidden="true" />
                {TYPE_STYLE[t].label}
              </button>
            );
          })}
        </div>
      </FilterSection>

      <FilterSection label="Account">
        <div className="max-h-48 overflow-y-auto rounded-lg border border-default divide-y divide-slate-100 dark:divide-slate-700">
          {accounts.map((a) => {
            const label = a.alias || a.name;
            const active = filters.accounts.has(a.id);
            return (
              <label
                key={a.id}
                className={clsx(
                  'flex min-h-11 cursor-pointer items-center gap-2 px-2.5 py-2 text-xs transition-colors',
                  active
                    ? 'bg-amber-50 text-amber-800 font-medium dark:bg-amber-900/20 dark:text-amber-200'
                    : 'fg-secondary hover:bg-slate-50 dark:hover:bg-slate-800/40',
                )}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => {
                    setFilters((prev) => {
                      const next = new Set(prev.accounts);
                      if (next.has(a.id)) next.delete(a.id);
                      else next.add(a.id);
                      return { ...prev, accounts: next };
                    });
                  }}
                  className="h-4 w-4 shrink-0 accent-amber-500"
                />
                <span className="truncate">{label}</span>
              </label>
            );
          })}
          {accounts.length === 0 && (
            <div className="px-2.5 py-2 text-xs fg-muted">No accounts.</div>
          )}
        </div>
      </FilterSection>

      <FilterSection label="Category">
        <select
          value={filters.categoryPick}
          onChange={(e) => setFilters((prev) => ({ ...prev, categoryPick: e.target.value }))}
          className={`${INPUT_CLS} w-full`}
          aria-label="Category filter"
        >
          <option value="">Any category</option>
          {categories.map((c) => (
            <optgroup key={c.id} label={c.name}>
              {c.subCategories.map((s) => (
                <option
                  key={s.id}
                  value={JSON.stringify({ category: c.name, subCategory: s.name })}
                >
                  {s.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </FilterSection>

      <FilterSection label="Merchant">
        <select
          value={filters.merchant}
          onChange={(e) => setFilters((prev) => ({ ...prev, merchant: e.target.value }))}
          className={`${INPUT_CLS} w-full`}
          aria-label="Merchant filter"
        >
          <option value="">Any merchant</option>
          {merchants.map((merchant) => (
            <option key={merchant} value={merchant}>{merchant}</option>
          ))}
        </select>
      </FilterSection>

      <FilterSection label="Amount range">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wide fg-muted mb-1">Min</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={minStr}
              onChange={(e) => onMinChange(e.target.value)}
              placeholder="0"
              className={`${INPUT_CLS} w-full`}
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide fg-muted mb-1">Max</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={maxStr}
              onChange={(e) => onMaxChange(e.target.value)}
              placeholder="∞"
              className={`${INPUT_CLS} w-full`}
            />
          </div>
        </div>
      </FilterSection>

      <div className="pt-3 border-t border-default flex items-center justify-between">
        <button
          type="button"
          onClick={onClear}
          disabled={!anythingActive && !clearEnabled}
          className="text-xs font-medium fg-muted hover:text-amber-700 dark:hover:text-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Clear all
        </button>
        <button
          type="button"
          onClick={onClose}
          className="btn-primary text-xs"
        >
          Done
        </button>
      </div>
    </div>
    </>
  );
}

function FilterSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium fg-tertiary mb-1.5">{label}</label>
      {children}
    </div>
  );
}

/**
 * AddTransactionModal — manual transaction entry.
 *
 * Fields mirror the inline row on the Transactions page: date,
 * merchant, type (3-way pill matching the review carousel), category
 * (hierarchical main + sub), an existing ledger account, and amount.
 * Sub-category picker only appears once a main category is chosen and
 * the selected main has sub-categories.
 *
 * On submit: POST /api/transactions. On error, the server message is
 * shown inline so the user can correct the input. On success, the
 * parent closes the modal; React Query invalidates the page list +
 * reviews + merchants caches.
 *
 * Closes on Escape, overlay click, and the X button.
 */
function AddTransactionModal({
  categories,
  accounts,
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  categories: MainCategory[];
  accounts: Account[];
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: EditableTransaction) => Promise<void>;
}) {
  const today = todayLocalISO();
  const [date, setDate] = useState(today);
  const [merchant, setMerchant] = useState('');
  const [type, setType] = useState<TxType>('expense');
  // Category stored as a JSON-encoded value (matches the table's
  // inline picker) so the same `JSON.parse` machinery works on the
  // server and we don't have to fake a delimiter.
  const [categoryPick, setCategoryPick] = useState('');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');

  // Categories filtered by the selected type. Same filter the inline
  // table picker uses so the two UIs stay in lockstep.
  const visibleCats = categories.filter((c) => c.type === type || c.name === 'Pay down goals');
  const parsedCat = (() => {
    if (!categoryPick) return null;
    try { return JSON.parse(categoryPick) as { category: string; subCategory?: string }; }
    catch { return null; }
  })();
  const selectedSub = parsedCat?.subCategory ?? '';

  // When the user switches type, drop the category pick so the
  // dropdown re-renders with the new bucket's options.
  useEffect(() => {
    setCategoryPick('');
  }, [type]);

  const onSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const catName = parsedCat?.category ?? '';
    const selectedAccount = accounts.find((account) => account.id === accountId);
    if (!merchant.trim() || !selectedAccount || !catName || !selectedSub) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    await onSubmit({
      date,
      merchant: merchant.trim(),
      category: catName,
      subCategory: selectedSub,
      account: selectedAccount.name,
      accountId: selectedAccount.id,
      amount: amt,
      type,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
  };

  const canSubmit =
    merchant.trim() !== ''
    && accountId !== ''
    && !!parsedCat?.category
    && selectedSub !== ''
    && Number.isFinite(Number(amount))
    && Number(amount) > 0
    && !isPending;

  return (
    <Dialog
      aria-label="Add transaction"
      onClose={onClose}
      closeDisabled={isPending}
      contentClassName="card w-full max-w-lg flex flex-col"
    >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold fg-primary">Add transaction</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="close-button rounded-lg p-2"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={onSubmitForm} className="space-y-3">
          {/* Row 1: date + amount — the two numeric fields side by side. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="block">
              <span className="text-xs fg-secondary uppercase tracking-wide">Date</span>
              <DatePicker
                value={date}
                onChange={setDate}
                disabled={isPending}
                className="mt-1 w-full"
                aria-label="Transaction date"
              />
            </div>
            <label className="block">
              <span className="text-xs fg-secondary uppercase tracking-wide">Amount</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isPending}
                placeholder="0.00"
                className={`mt-1 w-full ${INPUT_CLS}`}
                required
              />
            </label>
          </div>

          {/* Merchant — free text. */}
          <label className="block">
            <span className="text-xs fg-secondary uppercase tracking-wide">Merchant</span>
            <input
              type="text"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              disabled={isPending}
              placeholder="e.g. Whole Foods Market"
              className={`mt-1 w-full ${INPUT_CLS}`}
              maxLength={255}
              required
            />
          </label>

          {/* Type — three independent pill buttons, same pattern as
              the Categories page's add-type toggle so the visual
              language stays consistent across the app. */}
          <label className="block">
            <span className="text-xs fg-secondary uppercase tracking-wide">Type</span>
            {/* Three pill buttons in a single row below the label,
                matching the layout the other form fields use
                (label on top, control below). `flex` (not inline-flex)
                keeps the row on its own line so it doesn't wrap
                alongside the TYPE label. */}
            <div className="mt-1 flex gap-1.5">
              {(['income', 'expense', 'transfer'] as TxType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  disabled={isPending}
                  className={clsx(
                    'flex-1 inline-flex items-center justify-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors disabled:opacity-50',
                    type === t
                      ? 'bg-amber-500 text-slate-900 border-amber-500'
                      : 'bg-surface fg-secondary border-default hover:border-amber-500 hover:text-amber-700 dark:hover:text-amber-400',
                  )}
                >
                  {t === 'income' && <TrendingUp className="h-3.5 w-3.5" />}
                  {t === 'expense' && <TrendingDown className="h-3.5 w-3.5" />}
                  {t === 'transfer' && <ArrowLeftRight className="h-3.5 w-3.5" />}
                  {TYPE_STYLE[t].label}
                </button>
              ))}
            </div>
          </label>

          {/* Main categories are headings; only leaf sub-categories can
              be assigned to a transaction. */}
          <label className="block">
            <span className="text-xs fg-secondary uppercase tracking-wide">Category</span>
            <select
              value={categoryPick}
              onChange={(e) => setCategoryPick(e.target.value)}
              disabled={isPending || visibleCats.length === 0}
              className={`mt-1 w-full ${INPUT_CLS}`}
            >
              <option value="">
                {visibleCats.length === 0 ? 'No categories for this type' : 'Pick a category…'}
              </option>
              {visibleCats.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  {c.subCategories.map((s) => (
                    <option key={s.id} value={JSON.stringify({ category: c.name, subCategory: s.name })}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {/* Stable IDs disambiguate accounts that share the same display name. */}
          <label className="block">
            <span className="text-xs fg-secondary uppercase tracking-wide">Account</span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              disabled={isPending || accounts.length === 0}
              className={`mt-1 w-full ${INPUT_CLS}`}
              required
            >
              <option value="">
                {accounts.length === 0 ? 'No accounts available' : 'Pick an account…'}
              </option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.alias || a.name}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs fg-secondary uppercase tracking-wide">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isPending}
              rows={3}
              maxLength={2000}
              className={`mt-1 w-full resize-y ${INPUT_CLS}`}
              placeholder="Optional notes"
            />
          </label>

          {error && (
            <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-default">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="px-3 py-2 text-sm fg-tertiary hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="btn-primary flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="h-4 w-4" />
              {isPending ? 'Adding…' : 'Add transaction'}
            </button>
          </div>
        </form>
    </Dialog>
  );
}

type SplitDraft = Omit<TransactionSplit, 'id' | 'amount'> & { amount: string };

function categoryValue(category: string, subCategory?: string): string {
  return category && subCategory ? JSON.stringify({ category, subCategory }) : '';
}

function parseCategoryValue(value: string): { category: string; subCategory: string } | null {
  try {
    const parsed = JSON.parse(value) as { category?: unknown; subCategory?: unknown };
    return typeof parsed.category === 'string' && typeof parsed.subCategory === 'string'
      ? { category: parsed.category, subCategory: parsed.subCategory }
      : null;
  } catch {
    return null;
  }
}

function emptySplit(type: TxType): SplitDraft {
  return { amount: '', category: '', subCategory: '', type };
}

function EditTransactionModal({
  transaction: t,
  categories,
  accounts,
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  transaction: Transaction;
  categories: MainCategory[];
  accounts: Account[];
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (parent: EditableTransaction, splits: Omit<TransactionSplit, 'id'>[]) => Promise<void>;
}) {
  const titleId = useId();
  const merchantRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(t.date);
  const [merchant, setMerchant] = useState(t.merchant);
  const [amount, setAmount] = useState(String(t.amount));
  const [accountId, setAccountId] = useState(t.accountId ?? accounts.find((account) => account.name === t.account)?.id ?? '');
  const [type, setType] = useState<TxType>(t.type);
  const [categoryPick, setCategoryPick] = useState(categoryValue(t.category, t.subCategory));
  const [notes, setNotes] = useState(t.notes ?? '');
  const [splitEnabled, setSplitEnabled] = useState((t.splits?.length ?? 0) > 0);
  const [splits, setSplits] = useState<SplitDraft[]>(() => {
    const existing = (t.splits ?? []).map((split) => ({
      amount: String(split.amount),
      category: split.category,
      subCategory: split.subCategory,
      type: split.type,
    }));
    while (existing.length < 2) existing.push(emptySplit(t.type));
    return existing;
  });

  const selectedCategory = parseCategoryValue(categoryPick);
  const selectedAccount = accounts.find((account) => account.id === accountId);
  const amountNumber = Number(amount);
  const splitTotalCents = splits.reduce((sum, split) => {
    const value = Number(split.amount);
    return sum + (Number.isFinite(value) ? Math.round(value * 100) : 0);
  }, 0);
  const amountCents = Number.isFinite(amountNumber) ? Math.round(amountNumber * 100) : 0;
  const splitFieldsValid = !splitEnabled || splits.every((split) =>
    Number.isFinite(Number(split.amount))
    && Number(split.amount) > 0
    && !!split.category
    && !!split.subCategory,
  );
  const splitTotalValid = !splitEnabled || splitTotalCents === amountCents;
  const canSubmit = !!merchant.trim()
    && !!date
    && !!selectedAccount
    && !!selectedCategory
    && amountNumber > 0
    && Number.isFinite(amountNumber)
    && splitFieldsValid
    && splitTotalValid
    && !isPending;

  const changeSplit = (index: number, patch: Partial<SplitDraft>) => {
    setSplits((current) => current.map((split, i) => i === index ? { ...split, ...patch } : split));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !selectedAccount || !selectedCategory) return;
    await onSubmit({
      date,
      merchant: merchant.trim(),
      amount: amountNumber,
      account: selectedAccount.name,
      accountId: selectedAccount.id,
      type,
      category: selectedCategory.category,
      subCategory: selectedCategory.subCategory,
      ...(notes.trim() ? { notes: notes.trim() } : { notes: '' }),
    }, splitEnabled ? splits.map((split) => ({
      amount: Number(split.amount),
      category: split.category,
      subCategory: split.subCategory,
      type: split.type,
    })) : []);
  };

  return (
    <Dialog
      aria-labelledby={titleId}
      aria-busy={isPending}
      onClose={onClose}
      closeDisabled={isPending}
      initialFocusRef={merchantRef}
      overlayClassName="dialog-overlay--dim"
      contentClassName="card w-full max-w-3xl"
    >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold fg-primary">Edit transaction</h2>
          <button type="button" onClick={onClose} disabled={isPending} className="close-button rounded-lg p-2 disabled:opacity-50" aria-label="Close edit transaction">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs uppercase tracking-wide fg-secondary">
              Merchant
              <input ref={merchantRef} value={merchant} onChange={(e) => setMerchant(e.target.value)} disabled={isPending} maxLength={255} required className={`mt-1 w-full ${INPUT_CLS}`} />
            </label>
            <label className="block text-xs uppercase tracking-wide fg-secondary">
              Amount
              <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isPending} required className={`mt-1 w-full ${INPUT_CLS}`} />
            </label>
            <div className="block text-xs uppercase tracking-wide fg-secondary">
              Date
              <DatePicker value={date} onChange={setDate} disabled={isPending} className="mt-1 w-full" aria-label="Transaction date" />
            </div>
            <label className="block text-xs uppercase tracking-wide fg-secondary">
              Account
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={isPending} required className={`mt-1 w-full ${INPUT_CLS}`}>
                <option value="">Select account</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.alias || account.name}</option>)}
              </select>
            </label>
            <label className="block text-xs uppercase tracking-wide fg-secondary">
              Type
              <select value={type} onChange={(e) => { setType(e.target.value as TxType); setCategoryPick(''); }} disabled={isPending} className={`mt-1 w-full ${INPUT_CLS}`}>
                {TX_TYPES.map((value) => <option key={value} value={value}>{TYPE_STYLE[value].label}</option>)}
              </select>
            </label>
            <label className="block text-xs uppercase tracking-wide fg-secondary">
              Category / subcategory
              <select value={categoryPick} onChange={(e) => setCategoryPick(e.target.value)} disabled={isPending} required className={`mt-1 w-full ${INPUT_CLS}`}>
                <option value="">Select category</option>
                {categories.filter((category) => category.type === type || category.name === 'Pay down goals').map((category) => (
                  <optgroup key={category.id} label={category.name}>
                    {category.subCategories.map((sub) => <option key={sub.id} value={categoryValue(category.name, sub.name)}>{sub.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>

          <label className="block text-xs uppercase tracking-wide fg-secondary">
            Notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={isPending} rows={3} maxLength={2000} className={`mt-1 w-full resize-y ${INPUT_CLS}`} />
          </label>

          <section className="space-y-3 border-t border-default pt-4" aria-labelledby={`${titleId}-splits`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 id={`${titleId}-splits`} className="text-sm font-semibold fg-primary">Split allocations</h3>
                <p className="text-xs fg-muted">Allocations must equal the transaction amount exactly.</p>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm fg-secondary">
                <input type="checkbox" checked={splitEnabled} onChange={(e) => setSplitEnabled(e.target.checked)} disabled={isPending} className="h-4 w-4 accent-amber-500" />
                Split transaction
              </label>
            </div>

            {splitEnabled && (
              <div className="space-y-3">
                {splits.map((split, index) => {
                  const splitPick = categoryValue(split.category, split.subCategory);
                  return (
                    <fieldset key={index} className="rounded-lg border border-default p-3">
                      <legend className="px-1 text-xs font-medium fg-secondary">Allocation {index + 1}</legend>
                      <div className="grid gap-2 sm:grid-cols-[7rem_8rem_1fr_auto]">
                        <input type="number" min="0.01" step="0.01" value={split.amount} onChange={(e) => changeSplit(index, { amount: e.target.value })} disabled={isPending} placeholder="Amount" aria-label={`Allocation ${index + 1} amount`} className={INPUT_CLS} />
                        <select value={split.type} onChange={(e) => changeSplit(index, { type: e.target.value as TxType, category: '', subCategory: '' })} disabled={isPending} aria-label={`Allocation ${index + 1} type`} className={INPUT_CLS}>
                          {TX_TYPES.map((value) => <option key={value} value={value}>{TYPE_STYLE[value].label}</option>)}
                        </select>
                        <select
                          value={splitPick}
                          onChange={(e) => {
                            const picked = parseCategoryValue(e.target.value);
                            changeSplit(index, picked ?? { category: '', subCategory: '' });
                          }}
                          disabled={isPending}
                          aria-label={`Allocation ${index + 1} category`}
                          className={INPUT_CLS}
                        >
                          <option value="">Select category</option>
                          {categories.filter((category) => category.type === split.type || category.name === 'Pay down goals').map((category) => (
                            <optgroup key={category.id} label={category.name}>
                              {category.subCategories.map((sub) => <option key={sub.id} value={categoryValue(category.name, sub.name)}>{sub.name}</option>)}
                            </optgroup>
                          ))}
                        </select>
                        <button type="button" onClick={() => setSplits((current) => current.filter((_, i) => i !== index))} disabled={isPending || splits.length <= 2} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30 disabled:cursor-not-allowed disabled:opacity-30" aria-label={`Remove allocation ${index + 1}`}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </fieldset>
                  );
                })}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" onClick={() => setSplits((current) => [...current, emptySplit(type)])} disabled={isPending} className="inline-flex items-center gap-1 text-sm font-medium text-amber-700 dark:text-amber-300 hover:underline disabled:opacity-50">
                    <Plus className="h-4 w-4" /> Add allocation
                  </button>
                  <p className={clsx('text-sm tabular-nums', splitTotalValid ? 'fg-secondary' : 'text-rose-600 dark:text-rose-400')} role={!splitTotalValid ? 'alert' : undefined}>
                    Allocated {formatMoney(splitTotalCents / 100)} of {formatMoney(amountCents / 100)}
                  </p>
                </div>
              </div>
            )}
          </section>

          {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-default pt-4">
            <button type="button" onClick={onClose} disabled={isPending} className="rounded-lg px-3 py-2 text-sm fg-secondary hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={!canSubmit} className="btn-primary disabled:cursor-not-allowed disabled:opacity-50">{isPending ? 'Saving…' : 'Save transaction'}</button>
          </div>
        </form>
    </Dialog>
  );
}

/**
 * TransactionActionModal — opened by the triple-dot button on each
 * transaction row. Allows editing the posting date, marking the
 * transaction's merchant as recurring (weekly, monthly, or yearly), and
 * deleting the transaction.
 */
type RecurringPick = 'none' | 'weekly' | 'monthly' | 'yearly';
type RecurringState = RecurringPick;

function TransactionActionModal({
  transaction: t,
  onClose,
  onEdit,
  editDisabled,
  onUpdateDate,
  onSetRecurring,
  onDelete,
  isPending,
}: {
  transaction: Transaction;
  onClose: () => void;
  onEdit: () => void;
  editDisabled: boolean;
  onUpdateDate: (id: string, date: string) => Promise<void>;
  onSetRecurring: (frequency: RecurringPick) => Promise<void>;
  onDelete: () => void;
  isPending: boolean;
}) {
  const [date, setDate] = useState(t.date);
  const [frequency, setFrequency] = useState<RecurringState>('none');
  const [dateChanged, setDateChanged] = useState(false);
  const [recurringBusy, setRecurringBusy] = useState(false);

  // Hydrate current mark from the recurring list when the modal opens.
  const recurringQ = useQuery({
    queryKey: ['recurring'],
    queryFn: () => api.get<{
      merchant: string;
      amount: number;
      frequency: string;
      account: string;
      accountId?: string;
    }[]>('/api/recurring'),
  });
  useEffect(() => {
    if (!recurringQ.data) return;
    const key = `${t.merchant.toLowerCase()}|${(t.accountId ?? t.account).toLowerCase()}`;
    const match = recurringQ.data.find(
      (c) => `${c.merchant.toLowerCase()}|${(c.accountId ?? c.account).toLowerCase()}` === key,
    );
    if (match && (
      match.frequency === 'weekly'
      || match.frequency === 'monthly'
      || match.frequency === 'yearly'
    )) {
      setFrequency(match.frequency);
    } else {
      setFrequency('none');
    }
  }, [recurringQ.data, t.merchant, t.amount, t.account, t.accountId]);

  const onSaveDate = async () => {
    if (date === t.date) return;
    await onUpdateDate(t.id, date);
    setDateChanged(true);
  };

  const onPickRecurring = async (next: RecurringPick) => {
    if (next === frequency || isPending || recurringBusy) return;
    setRecurringBusy(true);
    try {
      await onSetRecurring(next);
      setFrequency(next);
    } finally {
      setRecurringBusy(false);
    }
  };

  return (
    <Dialog
      aria-label="Transaction actions"
      onClose={onClose}
      closeDisabled={isPending || recurringBusy}
      contentClassName="card w-full max-w-md flex flex-col"
    >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold fg-primary">Transaction Actions</h3>
          <button type="button" onClick={onClose} disabled={isPending || recurringBusy} className="close-button rounded-lg p-2 disabled:opacity-50" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="text-sm fg-secondary mb-4">
          <span className="font-medium fg-primary">{t.merchant}</span>
          {' · '}
          <span className={clsx('font-semibold tabular-nums', TYPE_STYLE[t.type].amount)}>
            {TYPE_STYLE[t.type].sign}{formatMoney(t.amount)}
          </span>
        </div>

        {/* Edit posting date — popover calendar (local-date safe). */}
        <div className="space-y-2 pb-4 border-b border-default">
          <label className="block text-xs font-medium fg-tertiary uppercase tracking-wide">
            Posting Date
          </label>
          <div className="flex items-center gap-2">
            <DatePicker
              value={date}
              onChange={(ymd) => { setDate(ymd); setDateChanged(false); }}
              disabled={isPending || recurringBusy}
              className="flex-1 min-w-0"
              aria-label="Posting date"
            />
            <button
              type="button"
              onClick={onSaveDate}
              disabled={isPending || date === t.date}
              className="btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {dateChanged ? 'Saved ✓' : 'Update'}
            </button>
          </div>
        </div>

        {/* Recurring frequency — applies immediately on click */}
        <div className="space-y-2 pt-4">
          <label className="block text-xs font-medium fg-tertiary uppercase tracking-wide">
            Recurring
          </label>
          <div className="flex gap-1.5">
            {([
              { value: 'none', label: 'None' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
              { value: 'yearly', label: 'Yearly' },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onPickRecurring(opt.value)}
                disabled={isPending || recurringBusy}
                aria-pressed={frequency === opt.value}
                className={clsx(
                  'flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50',
                  frequency === opt.value
                    ? 'bg-amber-500 text-slate-900 border-amber-500'
                    : 'bg-surface fg-secondary border-default hover:border-amber-500 hover:text-amber-700 dark:hover:text-amber-400',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-default flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onDelete}
            disabled={isPending || recurringBusy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 px-3 py-2 text-sm font-medium hover:bg-rose-200 dark:hover:bg-rose-900/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending || recurringBusy}
              className="px-3 py-2 text-sm fg-tertiary hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={onEdit}
              disabled={isPending || recurringBusy || editDisabled}
              title={editDisabled ? 'Categories and accounts must load before editing.' : undefined}
              className="btn-primary inline-flex items-center gap-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          </div>
        </div>
    </Dialog>
  );
}
