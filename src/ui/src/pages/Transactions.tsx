import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { api } from '../lib/api';
import { formatMoney, formatDate } from '../lib/format';
import { Trash2, Search, Receipt, ArrowLeftRight, Filter, X, Check, ArrowUpRight, BellRing, Plus, TrendingUp, TrendingDown } from 'lucide-react';
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from '../components/ui/combobox';
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
import { RuleFormModal } from '../components/RuleFormModal';
import { useReviews } from '../components/ReviewsProvider';
import clsx from 'clsx';

type TxType = 'income' | 'expense' | 'transfer';
const TX_TYPES: TxType[] = ['income', 'expense', 'transfer'];

/** Rows per page. Tuned to fit a comfortable full table on a 13" laptop. */
const PAGE_SIZE = 25;

interface Transaction {
  id: string; date: string; merchant: string; category: string;
  subCategory?: string; account: string; amount: number; type: TxType; notes?: string;
}
interface PageResponse { rows: Transaction[]; total: number; }
interface MainCategory { id: string; name: string; type: TxType; subCategories: { id: string; name: string }[]; }
interface Account { id: string; name: string; }

/**
 * Reusable input class: white/slate-700 background, dark text, slate-200/600
 * border, amber-500 focus. Every <input>/<select> in this file uses it so
 * the dark-mode styling stays consistent.
 */
const INPUT_CLS = 'rounded-lg border border-default bg-surface fg-primary placeholder-slate-400 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none';

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

/**
 * Filter state held by the Transactions page. Each field is `undefined`
 * (or empty / an empty Set) when the corresponding dimension has no
 * active filter — there's no "match nothing" mode; absence = no filter.
 */
interface FilterState {
  types: Set<TxType>;
  account: string;
  categoryPick: string;
  merchant: string;
  minAmount: string;
  maxAmount: string;
}

const EMPTY_FILTERS: FilterState = {
  types: new Set<TxType>(),
  account: '',
  categoryPick: '',
  merchant: '',
  minAmount: '',
  maxAmount: '',
};

function hasActiveFilters(f: FilterState, q: string): boolean {
  return f.types.size > 0
    || f.account !== ''
    || f.categoryPick !== ''
    || f.merchant !== ''
    || f.minAmount !== ''
    || f.maxAmount !== ''
    || q.trim() !== '';
}

function activeFilterCount(f: FilterState): number {
  let n = 0;
  if (f.types.size > 0) n++;
  if (f.account) n++;
  if (f.categoryPick) n++;
  if (f.merchant) n++;
  if (f.minAmount || f.maxAmount) n++;
  return n;
}

export function Transactions() {
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get<MainCategory[]>('/api/categories') });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api.get<Account[]>('/api/accounts') });
  // Distinct merchants — fetched once on mount so the merchant filter
  // dropdown doesn't issue a query per keystroke. The list is small
  // (one row per unique merchant, not per transaction) and changes only
  // when the user adds transactions, so we refetch alongside the
  // transactions list cache via the same `['transactions']` key.
  const merchants = useQuery({ queryKey: ['transactions', 'merchants'], queryFn: () => api.get<string[]>('/api/transactions/merchants') });

  // Pagination state. `page` is 1-indexed; the query layer converts to
  // a zero-indexed offset.
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');

  // Filter state lives at the page level so the popover can read /
  // write the same source of truth as the query below. The query
  // key includes every field so React Query refetches (and the
  // pagination resets) the moment any filter changes.
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterContainerRef = useRef<HTMLDivElement>(null);

  // Click-outside closes the filter popover (same pattern as the
  // Combobox component). mousedown so a press that lands outside
  // fires before focus moves.
  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e: MouseEvent) => {
      if (filterContainerRef.current && !filterContainerRef.current.contains(e.target as Node)) {
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

  // Build the API query string from the filter state. Memoised so the
  // query key only changes when a filter actually changes (not when
  // unrelated state updates re-render the component).
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String((page - 1) * PAGE_SIZE));
    if (q.trim()) params.set('q', q.trim());
    if (filters.types.size > 0) params.set('types', Array.from(filters.types).join(','));
    if (filters.account) params.set('account', filters.account);
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
    return params.toString();
  }, [page, q, filters]);

  const txns = useQuery({
    queryKey: ['transactions', 'page', queryString],
    queryFn: () => api.get<PageResponse>(`/api/transactions/page?${queryString}`),
  });
  const total = txns.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Reset to page 1 when the search query or any filter changes —
  // otherwise filtering can leave the user stranded on a page past
  // the filtered results.
  useEffect(() => {
    setPage(1);
  }, [q, filters]);

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/api/transactions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['reviews'] });
    },
  });

  // Manual transaction create. Server applies any matching user rule
  // to the category (rules win over what the user typed), so the new
  // row lands in the list with the rule's category rather than the
  // picker's. Refresh both the page query and the merchants list so
  // the new merchant immediately appears in the filter dropdown.
  const addTx = useMutation({
    mutationFn: (input: Omit<Transaction, 'id'>) =>
      api.post<Transaction>('/api/transactions', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['reviews'] });
    },
  });

  // User-defined rules. Loaded once on mount; consulted both by the
  // popup-trigger check below ("does a rule already exist for this
  // merchant?") and by the modal that creates a new rule. Invalidated
  // on rule create/edit/delete so the popup check stays fresh.
  interface Rule {
    id: string;
    matchType: 'exact';
    matchValue: string;
    category: string;
    subCategory?: string;
  }
  const rules = useQuery({
    queryKey: ['rules'],
    queryFn: () => api.get<Rule[]>('/api/rules'),
  });

  // Popup + modal state. `rulePrompt` is the bottom-right toast shown
  // after an inline category change asks "Create rule for this?".
  // `ruleModal` is the form modal opened when the user clicks "Create
  // rule" on the popup. Single-slot prompts mean rapid edits just
  // replace the current popup (its 8s timer resets) — earlier prompts
  // are silently overwritten, which is acceptable for a non-blocking
  // suggestion.
  const [rulePrompt, setRulePrompt] = useState<{
    merchant: string;
    category: string;
    subCategory?: string;
    rowId: string;
  } | null>(null);
  const [ruleModal, setRuleModal] = useState<{
    merchant: string;
    category: string;
    subCategory?: string;
  } | null>(null);

  // Auto-dismiss the popup 8s after it appears. Slightly longer than
  // Paydown's 4s toast (which is informational) because the popup here
  // requires a decision — but still bounded so it doesn't pile up.
  useEffect(() => {
    if (!rulePrompt) return;
    const t = setTimeout(() => setRulePrompt(null), 8000);
    return () => clearTimeout(t);
  }, [rulePrompt]);

  const createRule = useMutation({
    mutationFn: (input: { matchValue: string; category: string; subCategory?: string }) =>
      api.post<Rule>('/api/rules', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rules'] });
      setRuleModal(null);
      setRulePrompt(null);
    },
  });

  // Inline edit: PATCH a single transaction's category / subCategory in
  // a single round-trip. The select uses JSON-encoded values so a single
  // dropdown can carry both fields (e.g. '{"category":"Foo","subCategory":"Bar"}')
  // without us having to fake a separator that could collide with user data.
  // Auto-fires on select change; no "save" button. After success:
  //   1. Invalidate the transactions + reviews cache (the row changed;
  //      if it was pending it's no longer in the review queue).
  //   2. Invalidate the rules cache — the server auto-trained a rule
  //      when this was a previously-pending row, and we want the
  //      popup-trigger check below to see the new rule.
  //   3. If the server reported it created a rule (the response
  //      `ruleCreated` flag), skip the "Create rule?" popup — the
  //      user already opted in implicitly by categorizing a row that
  //      was awaiting review. Otherwise, raise the popup so the user
  //      can promote this one-off categorization to a rule themselves.
  const updateCategoryInline = useMutation({
    mutationFn: (input: { id: string; category: string; subCategory?: string }) =>
      api.patch<{ ok: true; ruleCreated: boolean }>(`/api/transactions/${input.id}`, {
        category: input.category,
        subCategory: input.subCategory,
      }),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      // Inline category edit on a row that was awaiting review counts
      // as an acknowledgement — drop it from the bell queue + banner.
      qc.invalidateQueries({ queryKey: ['reviews'] });
      qc.invalidateQueries({ queryKey: ['rules'] });
      if (data.ruleCreated) return; // server already trained the rule
      // Look up the merchant from the cached transactions page. If the
      // user paginated away in the meantime we won't find the row —
      // that's fine, we just skip the prompt for that case.
      const row = txns.data?.rows.find((r) => r.id === vars.id);
      if (!row) return;
      const merchantLower = row.merchant.toLowerCase();
      const existingRule = (rules.data ?? []).some(
        (r) => r.matchValue.toLowerCase() === merchantLower,
      );
      if (existingRule) return; // rule already handles this merchant
      setRulePrompt({
        merchant: row.merchant,
        category: vars.category,
        subCategory: vars.subCategory,
        rowId: row.id,
      });
    },
  });
  const onPickCategory = (id: string, jsonValue: string) => {
    let parsed: { category: string; subCategory?: string };
    try {
      parsed = JSON.parse(jsonValue);
    } catch {
      return; // malformed option value, ignore
    }
    updateCategoryInline.mutate({
      id,
      category: parsed.category,
      subCategory: parsed.subCategory,
    });
  };
  // Inline type switch: 3-way pill toggle. Changing type to a new bucket
  // (e.g. income → transfer) clears the category pick so the dropdown
  // re-renders with the new bucket's categories. The category on the
  // server stays the same until the user picks a new one; for a transfer
  // we'll fall back to the seeded Transfer category if they don't pick
  // anything before saving.
  const updateTypeInline = useMutation({
    mutationFn: (input: { id: string; type: TxType; category: string; subCategory?: string }) =>
      api.patch<{ ok: true; ruleCreated: boolean }>(`/api/transactions/${input.id}`, {
        type: input.type,
        category: input.category,
        subCategory: input.subCategory,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['reviews'] });
      // The server may have auto-trained a rule if this was a pending
      // row whose category changed (e.g. expense → transfer with a
      // different fallback category). Refresh so the rules cache stays
      // in sync with the source of truth.
      qc.invalidateQueries({ queryKey: ['rules'] });
    },
  });

  const toggleType = (t: TxType) => {
    setFilters((prev) => {
      const next = new Set(prev.types);
      if (next.has(t)) next.delete(t); else next.add(t);
      return { ...prev, types: next };
    });
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setQ('');
  };

  const filterActive = hasActiveFilters(filters, q);
  const filterCount = activeFilterCount(filters) + (q.trim() ? 1 : 0);

  // Mirror the bell badge so the banner is a discoverable backstop if
  // the user ignores the chrome. Clicking the CTA opens the same
  // carousel modal the bell drives.
  const reviews = useReviews();

  // Manual transaction entry. The "+ Add" button in the page header
  // opens the modal; submitting POSTs a new transaction and refreshes
  // the list (and the bell badge, since new rows may match the review
  // queue if the user left needs_review unset on creation).
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold fg-primary">Transactions</h1>

      {reviews.count > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex items-center justify-between gap-3">
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

      <section className="card">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold fg-primary">All transactions</h2>
            <span className="text-xs fg-muted tabular-nums">
              {txns.isLoading ? '…' : `${total.toLocaleString()} match${total === 1 ? '' : 'es'}`}
            </span>
          </div>
          {/* Header pill row: Search / All Filters (status + clear) /
              Filters (popover) / Add Transaction (primary CTA). Each
              pill is a compact, same-height control so the row reads
              as a unified toolbar. */}
          <div className="flex items-center gap-2 w-full md:w-auto md:flex-1 md:justify-end">
            {/* Search pill — same height as the buttons, single-line
                placeholder. The matches count slides inside the
                right edge when the user has typed something so the
                pill doesn't grow. */}
            <InputGroup className="flex-1 min-w-0 max-w-xs">
              <InputGroupAddon aria-hidden="true">
                <Search className="h-4 w-4" />
              </InputGroupAddon>
              <InputGroupInput
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search..."
                aria-label="Search transactions"
              />
              {q && (
                <InputGroupAddon align="inline-end" className="text-xs fg-muted tabular-nums">
                  {total.toLocaleString()}
                </InputGroupAddon>
              )}
            </InputGroup>

            {/* "All Filters" pill — status indicator + quick reset.
                Shows "All Filters" when nothing is active (read-only
                feel). When filters are on, shows the active count
                and clicking clears everything back to defaults —
                same action as the popover's "Clear all" but visible
                at the toolbar level. */}
            <button
              type="button"
              onClick={clearFilters}
              disabled={!filterActive}
              aria-label={
                filterActive
                  ? `Clear all ${filterCount} active filter${filterCount === 1 ? '' : 's'}`
                  : 'All filters'
              }
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors shrink-0',
                filterActive
                  ? 'bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                  : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500 cursor-default',
              )}
            >
              <Filter className="h-3.5 w-3.5" />
              <span>{filterActive ? `${filterCount} filter${filterCount === 1 ? '' : 's'}` : 'All Filters'}</span>
            </button>

            {/* Filters popover pill — opens the structured filter
                sheet (type / account / category / merchant / amount
                range). Carries a count badge so users see how many
                active filters are set even before opening it. */}
            <div ref={filterContainerRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setFilterOpen((o) => !o)}
                aria-expanded={filterOpen}
                aria-haspopup="dialog"
                aria-label="Filters"
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                  filterActive
                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
                )}
              >
                <Filter className="h-3.5 w-3.5" />
                <span>Filters</span>
                {filterCount > 0 && (
                  <span className={clsx(
                    'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold tabular-nums',
                    'bg-amber-500 text-slate-900',
                  )}>
                    {filterCount}
                  </span>
                )}
              </button>

              {filterOpen && (
                <FilterPopover
                  filters={filters}
                  setFilters={setFilters}
                  accounts={accounts.data ?? []}
                  categories={cats.data ?? []}
                  merchants={merchants.data ?? []}
                  onClear={clearFilters}
                  onClose={() => setFilterOpen(false)}
                />
              )}
            </div>

            {/* Add Transaction — primary CTA, amber pill on the
                right end of the toolbar. Same height as the other
                pills so the row reads as a single control strip. */}
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-900 px-2.5 py-1.5 text-xs font-semibold transition-colors shrink-0"
              aria-label="Add transaction"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Transaction
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase fg-muted">
                <th className="py-2">Date</th>
                <th className="py-2">Merchant</th>
                <th className="py-2">Type</th>
                <th className="py-2">Category</th>
                <th className="py-2">Account</th>
                <th className="py-2 text-right">Amount</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {txns.data?.rows.map((t) => {
                // Categories filtered by the transaction's type so an
                // expense row only sees expense categories and vice versa.
                const rowCats = (cats.data ?? []).filter((c) => c.type === t.type);
                // Current selection as a JSON value (matches the option
                // values below). Falls back to empty if the current value
                // doesn't match any (defensive — shouldn't normally
                // happen, but handles stale client state cleanly).
                const currentValue = (() => {
                  const cat = rowCats.find((c) => c.name === t.category);
                  if (!cat) return '';
                  if (t.subCategory && cat.subCategories.some((s) => s.name === t.subCategory)) {
                    return JSON.stringify({ category: cat.name, subCategory: t.subCategory });
                  }
                  return JSON.stringify({ category: cat.name });
                })();
                return (
                  <tr key={t.id}>
                    <td className="py-2 whitespace-nowrap fg-secondary">{formatDate(t.date)}</td>
                    <td className="py-2 fg-primary">{t.merchant}</td>
                    {/* Type drop-down. Neutral styling so the open menu's
                        options stay readable; the amount cell carries
                        the colour cue at row level. Auto-fires on
                        change (no save button) and PATCHes the row's
                        type + a category from the new bucket in the
                        same call so the row stays consistent. */}
                    <td className="py-2">
                      <select
                        value={t.type}
                        disabled={updateTypeInline.isPending}
                        onChange={(e) => {
                          const newType = e.target.value as TxType;
                          if (newType === t.type) return;
                          // When the user changes type, also push the
                          // new bucket's category in the same PATCH so
                          // the row stays consistent. If the current
                          // category happens to be a match in the new
                          // bucket, keep it; otherwise we let the
                          // server keep the existing string and the
                          // user can re-pick from the dropdown.
                          const newBucketCats = (cats.data ?? []).filter((c) => c.type === newType);
                          const stillValid = newBucketCats.some((c) => c.name === t.category);
                          if (stillValid) {
                            updateTypeInline.mutate({ id: t.id, type: newType, category: t.category, subCategory: t.subCategory });
                          } else {
                            // Pick the first available category in the
                            // new bucket as a sensible default; if the
                            // new bucket is empty, fall back to the
                            // current category string.
                            const fallback = newBucketCats[0]?.name ?? t.category;
                            const fallbackSub = newBucketCats[0]?.subCategories[0]?.name ?? t.subCategory;
                            updateTypeInline.mutate({ id: t.id, type: newType, category: fallback, subCategory: fallbackSub });
                          }
                        }}
                        aria-label="Transaction type"
                        className={`${INPUT_CLS} py-1 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {TX_TYPES.map((tt) => (
                          <option key={tt} value={tt}>
                            {TYPE_STYLE[tt].label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2">
                      <select
                        value={currentValue}
                        onChange={(e) => onPickCategory(t.id, e.target.value)}
                        disabled={updateCategoryInline.isPending}
                        className={`${INPUT_CLS} py-1 max-w-[240px]`}
                        title={t.subCategory ? `${t.category} › ${t.subCategory}` : t.category}
                      >
                        {rowCats.map((c) => (
                          <optgroup key={c.id} label={c.name}>
                            <option value={JSON.stringify({ category: c.name })}>{c.name}</option>
                            {c.subCategories.map((s) => (
                              <option key={s.id} value={JSON.stringify({ category: c.name, subCategory: s.name })}>
                                {'\u00a0\u00a0\u00a0\u00a0'}{c.name} › {s.name}
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
                      <button onClick={() => del.mutate(t.id)} className="text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30 rounded p-1">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {txns.data?.rows.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-sm fg-muted">
                  <Receipt className="h-5 w-5 inline mr-1 fg-muted" /> No transactions match.
                </td></tr>
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

      {/*
        "Create rule?" popup — appears after an inline category change
        when no rule already exists for that merchant. Visual style
        matches Paydown's Save-to-Budget toast (fixed bottom-right,
        same border/shadow tokens, emerald check icon, dismiss X). Auto-
        dismisses after 8s — see `useEffect` above. Clicking "Create
        rule" opens the form modal with the merchant + category pre-
        filled.
      */}
      {rulePrompt && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border border-default bg-surface shadow-lg px-4 py-3 text-sm flex items-start gap-3">
          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="fg-primary">
              Category updated to "{rulePrompt.category}
              {rulePrompt.subCategory ? ` › ${rulePrompt.subCategory}` : ''}".
            </div>
            <button
              type="button"
              onClick={() => {
                setRuleModal({
                  merchant: rulePrompt.merchant,
                  category: rulePrompt.category,
                  subCategory: rulePrompt.subCategory,
                });
                setRulePrompt(null);
              }}
              className="mt-1 inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 hover:underline"
            >
              Create rule <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setRulePrompt(null)}
            className="fg-muted hover:fg-secondary"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/*
        Rule form modal — shared component with the Rules page. Opened
        from the popup CTA above. We pass the cached categories in the
        shape the modal expects (just names + sub-categories).
      */}
      {ruleModal && (
        <RuleFormModal
          mode="create"
          initial={ruleModal}
          categories={(cats.data ?? []).map((c) => ({
            name: c.name,
            subCategories: c.subCategories.map((s) => ({ name: s.name })),
          }))}
          onSave={(input) => createRule.mutateAsync(input)}
          onClose={() => setRuleModal(null)}
        />
      )}

      {addOpen && (
        <AddTransactionModal
          categories={cats.data ?? []}
          accounts={accounts.data ?? []}
          isPending={addTx.isPending}
          error={addTx.error?.message ?? null}
          onClose={() => setAddOpen(false)}
          onSubmit={async (input) => {
            await addTx.mutateAsync(input);
            setAddOpen(false);
          }}
        />
      )}
    </div>
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
 *   3. Category  — searchable combobox over main + sub-categories
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
  onClear,
  onClose,
}: {
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  accounts: Account[];
  categories: MainCategory[];
  merchants: string[];
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

  // Selected category display label for the combobox placeholder. Falls
  // back to a generic "Category…" when nothing is picked.
  const selectedCategoryLabel = (() => {
    if (!filters.categoryPick) return undefined;
    try {
      const p = JSON.parse(filters.categoryPick) as { category: string; subCategory?: string };
      return p.subCategory ? `${p.category} › ${p.subCategory}` : p.category;
    } catch {
      return undefined;
    }
  })();

  const anythingActive =
    filters.types.size > 0
    || filters.account !== ''
    || filters.categoryPick !== ''
    || filters.merchant !== ''
    || filters.minAmount !== ''
    || filters.maxAmount !== '';

  return (
    <div
      role="dialog"
      aria-label="Filters"
      className="absolute top-full right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-1.5rem)] card shadow-lg p-4 space-y-4"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold fg-primary">Filters</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close filters"
          className="fg-muted hover:fg-secondary rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
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
                  'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
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
        <Combobox
          items={accounts.map((a) => ({ value: a.name, label: a.name }))}
          value={filters.account}
          onValueChange={(v) => setFilters((prev) => ({ ...prev, account: v }))}
        >
          <ComboboxInput placeholder="Any account" />
          <ComboboxContent>
            <ComboboxList emptyMessage="No accounts.">
              {(item) => (
                <ComboboxItem key={item.value} value={item.value}>
                  {item.label}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </FilterSection>

      <FilterSection label="Category">
        <Combobox
          items={[]}
          value={filters.categoryPick}
          onValueChange={(v) => setFilters((prev) => ({ ...prev, categoryPick: v }))}
        >
          <ComboboxInput placeholder={selectedCategoryLabel ?? 'Any category'} />
          <ComboboxContent>
            <ComboboxList emptyMessage="No categories.">
              {categories.map((c) => (
                <Command.Group key={c.id} heading={c.name}>
                  <ComboboxItem value={JSON.stringify({ category: c.name })}>
                    {c.name}
                  </ComboboxItem>
                  {c.subCategories.map((s) => (
                    <ComboboxItem
                      key={s.id}
                      value={JSON.stringify({ category: c.name, subCategory: s.name })}
                    >
                      <span className="pl-3">{c.name} › {s.name}</span>
                    </ComboboxItem>
                  ))}
                </Command.Group>
              ))}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </FilterSection>

      <FilterSection label="Merchant">
        <Combobox
          items={merchants.map((m) => ({ value: m, label: m }))}
          value={filters.merchant}
          onValueChange={(v) => setFilters((prev) => ({ ...prev, merchant: v }))}
        >
          <ComboboxInput placeholder="Any merchant" />
          <ComboboxContent>
            <ComboboxList emptyMessage="No merchants yet.">
              {(item) => (
                <ComboboxItem key={item.value} value={item.value}>
                  {item.label}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
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
          disabled={!anythingActive}
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
 * (hierarchical main + sub), account (free-text — server doesn't
 * validate against the user's account list, so the user can type a
 * new one if needed), amount, notes. Sub-category picker only
 * appears once a main category is chosen and the selected main has
 * sub-categories.
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
  onSubmit: (input: Omit<Transaction, 'id'>) => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [merchant, setMerchant] = useState('');
  const [type, setType] = useState<TxType>('expense');
  // Category stored as a JSON-encoded value (matches the table's
  // inline picker) so the same `JSON.parse` machinery works on the
  // server and we don't have to fake a delimiter.
  const [categoryPick, setCategoryPick] = useState('');
  const [accountName, setAccountName] = useState(accounts[0]?.name ?? '');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');

  // Reset account default once the accounts list resolves.
  useEffect(() => {
    if (!accountName && accounts[0]) setAccountName(accounts[0].name);
  }, [accounts, accountName]);

  // Categories filtered by the selected type. Same filter the inline
  // table picker uses so the two UIs stay in lockstep.
  const visibleCats = categories.filter((c) => c.type === type);
  const parsedCat = (() => {
    if (!categoryPick) return null;
    try { return JSON.parse(categoryPick) as { category: string; subCategory?: string }; }
    catch { return null; }
  })();
  const selectedMain = parsedCat ? visibleCats.find((c) => c.name === parsedCat.category) : null;
  const subOptions = selectedMain?.subCategories ?? [];
  const selectedSub = parsedCat?.subCategory ?? '';

  // When the user switches type, drop the category pick so the
  // dropdown re-renders with the new bucket's options.
  useEffect(() => {
    setCategoryPick('');
  }, [type]);

  // Escape closes the modal. Bound only while mounted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const catName = parsedCat?.category ?? '';
    if (!merchant.trim() || !accountName.trim() || !catName) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    await onSubmit({
      date,
      merchant: merchant.trim(),
      category: catName,
      subCategory: selectedSub || undefined,
      account: accountName.trim(),
      amount: amt,
      type,
      notes: notes.trim() || undefined,
    });
  };

  const canSubmit =
    merchant.trim() !== ''
    && accountName.trim() !== ''
    && !!parsedCat?.category
    && Number.isFinite(Number(amount))
    && Number(amount) > 0
    && !isPending;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add transaction"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card w-full max-w-lg flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold fg-primary">Add transaction</h3>
          <button
            type="button"
            onClick={onClose}
            className="fg-muted hover:fg-secondary"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={onSubmitForm} className="space-y-3">
          {/* Row 1: date + amount — the two numeric fields side by side. */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs fg-secondary uppercase tracking-wide">Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={isPending}
                className={`mt-1 w-full ${INPUT_CLS}`}
                required
              />
            </label>
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

          {/* Category — hierarchical <select> matching the inline
              table picker so the two UIs stay in lockstep. */}
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
                  <option value={JSON.stringify({ category: c.name })}>{c.name}</option>
                  {c.subCategories.map((s) => (
                    <option key={s.id} value={JSON.stringify({ category: c.name, subCategory: s.name })}>
                      {'\u00a0\u00a0\u00a0\u00a0'}{c.name} › {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {/* Sub-category only renders if the chosen main has any. */}
          {subOptions.length > 0 && (
            <label className="block">
              <span className="text-xs fg-secondary uppercase tracking-wide">
                Sub-category <span className="fg-muted">(optional)</span>
              </span>
              <select
                value={selectedSub}
                onChange={(e) => {
                  const newSub = e.target.value;
                  setCategoryPick(
                    JSON.stringify({
                      category: selectedMain!.name,
                      subCategory: newSub || undefined,
                    }),
                  );
                }}
                disabled={isPending}
                className={`mt-1 w-full ${INPUT_CLS}`}
              >
                <option value="">No sub-category</option>
                {subOptions.map((s) => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            </label>
          )}

          {/* Account — datalist so the user can pick from their known
              accounts or type a new one. Free-text fallback keeps
              server compatibility (the transactions table stores
              the account name as a string, not an FK). */}
          <label className="block">
            <span className="text-xs fg-secondary uppercase tracking-wide">Account</span>
            <input
              type="text"
              list="add-tx-account-options"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              disabled={isPending}
              placeholder="e.g. Chase Checking"
              className={`mt-1 w-full ${INPUT_CLS}`}
              maxLength={120}
              required
            />
            <datalist id="add-tx-account-options">
              {accounts.map((a) => (
                <option key={a.id} value={a.name} />
              ))}
            </datalist>
          </label>

          {/* Notes — optional free text. */}
          <label className="block">
            <span className="text-xs fg-secondary uppercase tracking-wide">
              Notes <span className="fg-muted">(optional)</span>
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isPending}
              placeholder=""
              maxLength={2000}
              rows={2}
              className={`mt-1 w-full ${INPUT_CLS} resize-y`}
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
      </div>
    </div>
  );
}
