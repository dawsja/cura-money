/**
 * Rules page — user-defined "always set this merchant to this category"
 * mappings. Applied at import time (SimpleFIN + manual add) and via
 * the ▶ Run button on each row, or "Run all rules" for the full set.
 *
 * Rules are created explicitly here or from a corrected transaction.
 * Transaction-derived rules include source account/type/category scope.
 */
import { useDeferredValue, useEffect, useState } from 'react';
import { useQuery, useQueryClient, useMutation, type QueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus, Play, Trash2, Pencil, AlertTriangle, Check, X, Search, ListFilter, EllipsisVertical } from 'lucide-react';
import { api } from '../lib/api';
import {
  RuleFormModal,
  type RuleFormAccount,
  type RuleFormCategory,
} from '../components/RuleFormModal';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../components/ui/input-group';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
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
import clsx from 'clsx';

type RuleTxType = 'income' | 'expense' | 'transfer';

interface Rule {
  id: string;
  matchType: 'exact';
  matchValue: string;
  accountId?: string;
  sourceType?: RuleTxType;
  sourceCategory?: string;
  sourceSubCategory?: string;
  category: string;
  subCategory?: string;
  type?: RuleTxType;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const RULE_TYPE_LABEL: Record<RuleTxType, string> = {
  income: 'Income',
  expense: 'Expense',
  transfer: 'Transfer',
};

const PAGE_SIZE = 10;

function fuzzyTokenIn(value: string | undefined, token: string): boolean {
  if (!value) return false;
  const normalizedValue = value.toLowerCase();
  const normalizedToken = token.toLowerCase();
  if (normalizedValue.includes(normalizedToken)) return true;

  const compactValue = normalizedValue.replace(/[^a-z0-9]+/g, '');
  const compactToken = normalizedToken.replace(/[^a-z0-9]+/g, '');
  return compactToken.length > 0 && compactValue.includes(compactToken);
}

function ruleMatchesSearch(rule: Rule, search: string, accountName?: string): boolean {
  const tokens = search.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  const fields = [
    rule.matchValue,
    accountName,
    rule.sourceCategory,
    rule.sourceSubCategory,
    rule.sourceType ? RULE_TYPE_LABEL[rule.sourceType] : undefined,
    rule.category,
    rule.subCategory,
    rule.type ? RULE_TYPE_LABEL[rule.type] : undefined,
  ];
  return tokens.every((token) => fields.some((field) => fuzzyTokenIn(field, token)));
}

interface MainCategory {
  id: string;
  name: string;
  type: RuleTxType;
  subCategories: { id: string; name: string }[];
}

interface Account {
  id: string;
  name: string;
  alias?: string;
}

export function Rules() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [accountFilter, setAccountFilter] = useState('all');
  const [sourceTypeFilter, setSourceTypeFilter] = useState<'all' | RuleTxType>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [confirmation, setConfirmation] = useState<
    | { kind: 'delete'; rule: Rule }
    | { kind: 'run'; rule: Rule }
    | { kind: 'run-all' }
    | null
  >(null);

  const rules = useQuery({
    queryKey: ['rules'],
    queryFn: () => api.get<Rule[]>('/api/rules'),
  });

  const cats = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<MainCategory[]>('/api/categories'),
  });

  const accounts = useQuery({
    queryKey: ['accounts', 'includeHidden'],
    queryFn: () => api.get<Account[]>('/api/accounts?includeHidden=true'),
  });

  const ruleFormCategories: RuleFormCategory[] = (cats.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    subCategories: c.subCategories.map((s) => ({ id: s.id, name: s.name })),
  }));
  const ruleFormAccounts: RuleFormAccount[] = (accounts.data ?? []).map((account) => ({
    id: account.id,
    name: account.alias || account.name,
  }));
  const accountNames = new Map(ruleFormAccounts.map((account) => [account.id, account.name]));

  // ---- Modal state ----------------------------------------------------
  // `null` = closed. Otherwise the modal is open in either 'create' or
  // 'edit' mode with the given initial values (edit pre-fills).
  const [modal, setModal] = useState<
    | {
        mode: 'create';
        initial?: {
          merchant: string;
          accountId?: string;
          sourceType?: RuleTxType;
          sourceCategory?: string;
          sourceSubCategory?: string;
          category: string;
          subCategory?: string;
          type?: RuleTxType;
        };
      }
    | { mode: 'edit'; rule: Rule }
    | null
  >(null);

  // ---- Mutations ------------------------------------------------------

  const createRule = useMutation({
    mutationFn: (input: {
      matchValue: string;
      accountId?: string;
      sourceType?: RuleTxType;
      sourceCategory?: string;
      sourceSubCategory?: string;
      category: string;
      subCategory: string;
      type?: RuleTxType;
    }) => api.post<Rule>('/api/rules', input),
    onSuccess: (created) => {
      qc.setQueryData<Rule[]>(['rules'], (current) => current ? [...current, created] : [created]);
      qc.invalidateQueries({ queryKey: ['rules'] });
      setModal(null);
    },
  });

  const updateRule = useMutation({
    mutationFn: (input: {
      id: string;
      patch: {
        expectedVersion: number;
        matchValue: string;
        accountId?: string | null;
        sourceType?: RuleTxType | null;
        sourceCategory?: string | null;
        sourceSubCategory?: string | null;
        category: string;
        subCategory: string;
        type?: RuleTxType | null;
      };
    }) => api.patch<Rule>(`/api/rules/${input.id}`, input.patch),
    onSuccess: (updated) => {
      qc.setQueryData<Rule[]>(['rules'], (current) =>
        current?.map((rule) => rule.id === updated.id ? updated : rule) ?? [updated],
      );
      qc.invalidateQueries({ queryKey: ['rules'] });
      setModal(null);
    },
  });

  const deleteRule = useMutation({
    mutationFn: (id: string) => api.delete(`/api/rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });

  const runRule = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; updated: number }>(`/api/rules/${id}/run`, {}),
    onSuccess: (result) => {
      invalidateRuleRunDependents(qc);
      setToast(`Updated ${result.updated} transaction${result.updated === 1 ? '' : 's'}.`);
    },
  });

  const runAllRules = useMutation({
    mutationFn: () => api.post<{ ok: boolean; updated: number }>('/api/rules/run-all', {}),
    onSuccess: (result) => {
      invalidateRuleRunDependents(qc);
      setToast(`Updated ${result.updated} transaction${result.updated === 1 ? '' : 's'}.`);
    },
  });

  const anyRunPending = runRule.isPending || runAllRules.isPending;
  const hasRules = (rules.data?.length ?? 0) > 0;
  const activeFilterCount = [accountFilter, sourceTypeFilter, categoryFilter].filter((value) => value !== 'all').length;
  const filteredRules = (rules.data ?? []).filter((rule) => {
    if (!ruleMatchesSearch(rule, deferredSearch, rule.accountId ? accountNames.get(rule.accountId) : undefined)) return false;
    if (accountFilter === 'any' && rule.accountId) return false;
    if (accountFilter !== 'all' && accountFilter !== 'any' && rule.accountId !== accountFilter) return false;
    if (sourceTypeFilter !== 'all' && rule.sourceType !== sourceTypeFilter) return false;
    if (categoryFilter !== 'all' && rule.category !== categoryFilter) return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filteredRules.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedRules = filteredRules.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // ---- Toast (matches Paydown's style) --------------------------------

  const [toast, setToast] = useState<string | null>(null);
  // Auto-dismiss the toast after 4s — same cadence as Paydown's
  // Save-to-Budget toast. The toast here is informational (no decision
  // to make), so the shorter timer is fine.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div data-onboarding-target="rules-intro">
          <h1 className="text-2xl font-bold fg-primary">Rules</h1>
          <p className="text-sm fg-tertiary max-w-xl mt-1">
            Automatically categorize future transactions when their merchant and optional
            account, original type, and original category conditions match. Merchant text
            matches exactly or as a prefix.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setConfirmation({ kind: 'run-all' })}
            disabled={!hasRules || anyRunPending}
            title="Re-apply every rule to matching transactions in your history"
            className={clsx(
              'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold',
              'border border-default bg-surface fg-primary',
              'hover:bg-slate-50 dark:hover:bg-slate-700',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'transition-colors min-h-[44px]',
            )}
          >
            <Play className="h-4 w-4" />
            {runAllRules.isPending ? 'Running…' : 'Run all rules'}
          </button>
          <button
            type="button"
            onClick={() => setModal({ mode: 'create' })}
            disabled={cats.isLoading || accounts.isLoading || cats.isError || accounts.isError}
            className="btn-primary inline-flex items-center gap-2 min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-4 w-4" />
            Add rule
          </button>
        </div>
      </div>

      {(cats.isError || accounts.isError) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-300" role="alert">
          <span>Categories or accounts could not be loaded. Rule editing is unavailable.</span>
          <button
            type="button"
            onClick={() => { void cats.refetch(); void accounts.refetch(); }}
            className="font-semibold hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* List */}
      <section className="card">
        {rules.isLoading ? (
          <div className="py-10 text-center text-sm fg-muted">Loading…</div>
        ) : rules.isError ? (
          <div className="py-8 text-center" role="alert">
            <p className="text-sm text-rose-600 dark:text-rose-400">Could not load rules.</p>
            <button type="button" className="btn-primary mt-3 px-3 py-1.5 text-sm" onClick={() => void rules.refetch()} disabled={rules.isFetching}>Retry</button>
          </div>
        ) : rules.data?.length === 0 ? (
          <div className="py-10 text-center text-sm fg-muted">
            <AlertTriangle className="h-5 w-5 inline mr-1 fg-muted" />
            No rules yet. Correct a transaction and choose Create scoped rule, or click{' '}
            <span className="font-semibold fg-secondary">Add rule</span> to create one by hand.
           </div>
         ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-baseline gap-2">
                <h2 className="text-lg font-semibold fg-primary">All rules</h2>
                <span className="text-xs fg-muted tabular-nums">
                  {filteredRules.length.toLocaleString()} of {(rules.data?.length ?? 0).toLocaleString()}
                </span>
              </div>
              <div className="flex w-full min-w-0 items-center gap-2 md:w-auto">
                <InputGroup className="min-h-11 min-w-0 flex-1 md:min-h-0 md:w-72">
                  <InputGroupAddon aria-hidden="true">
                    <Search className="h-4 w-4" />
                  </InputGroupAddon>
                  <InputGroupInput
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setPage(1);
                    }}
                    placeholder="Search rules…"
                    aria-label="Search rules"
                  />
                </InputGroup>
                <button
                  type="button"
                  onClick={() => setFiltersOpen((value) => !value)}
                  aria-expanded={filtersOpen}
                  aria-controls="rule-filters"
                  className={clsx(
                    'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium md:min-h-9',
                    filtersOpen || activeFilterCount > 0
                      ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                      : 'border-default bg-surface fg-secondary hover:bg-canvas-subtle',
                  )}
                >
                  <ListFilter className="h-4 w-4" aria-hidden="true" />
                  Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
                </button>
              </div>
            </div>

            {filtersOpen && (
              <div id="rule-filters" className="mb-4 grid gap-3 rounded-xl border border-default bg-canvas-subtle p-3 sm:grid-cols-3">
                <label className="text-xs font-medium fg-secondary">
                  Account scope
                  <select
                    value={accountFilter}
                    onChange={(event) => { setAccountFilter(event.target.value); setPage(1); }}
                    className="mt-1 min-h-11 w-full rounded-lg border border-control bg-surface px-3 text-sm fg-primary"
                  >
                    <option value="all">All account scopes</option>
                    <option value="any">Any account only</option>
                    {ruleFormAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium fg-secondary">
                  Original type
                  <select
                    value={sourceTypeFilter}
                    onChange={(event) => { setSourceTypeFilter(event.target.value as 'all' | RuleTxType); setPage(1); }}
                    className="mt-1 min-h-11 w-full rounded-lg border border-control bg-surface px-3 text-sm fg-primary"
                  >
                    <option value="all">All original types</option>
                    {(Object.keys(RULE_TYPE_LABEL) as RuleTxType[]).map((type) => <option key={type} value={type}>{RULE_TYPE_LABEL[type]}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium fg-secondary">
                  Result category
                  <select
                    value={categoryFilter}
                    onChange={(event) => { setCategoryFilter(event.target.value); setPage(1); }}
                    className="mt-1 min-h-11 w-full rounded-lg border border-control bg-surface px-3 text-sm fg-primary"
                  >
                    <option value="all">All result categories</option>
                    {ruleFormCategories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}
                  </select>
                </label>
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setAccountFilter('all');
                      setSourceTypeFilter('all');
                      setCategoryFilter('all');
                      setPage(1);
                    }}
                    className="justify-self-start text-xs font-semibold text-amber-700 hover:underline dark:text-amber-300 sm:col-span-3"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}

            {filteredRules.length === 0 ? (
              <div className="py-10 text-center text-sm fg-muted">
                No rules match your search or filters.
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                {pagedRules.map((r) => (
                  <li key={r.id} className="py-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wide fg-muted">When</p>
                          <p className="mt-0.5 truncate text-sm font-semibold fg-primary">{r.matchValue}</p>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            <span className="rounded-md border border-default bg-canvas-subtle px-1.5 py-0.5 text-[11px] fg-secondary">
                              {r.accountId ? accountNames.get(r.accountId) ?? 'Unknown account' : 'Any account'}
                            </span>
                            <span className="rounded-md border border-default bg-canvas-subtle px-1.5 py-0.5 text-[11px] fg-secondary">
                              {r.sourceType ? RULE_TYPE_LABEL[r.sourceType] : 'Any type'}
                            </span>
                            <span className="max-w-full truncate rounded-md border border-default bg-canvas-subtle px-1.5 py-0.5 text-[11px] fg-secondary">
                              {r.sourceCategory
                                ? `${r.sourceCategory}${r.sourceSubCategory ? ` › ${r.sourceSubCategory}` : ''}`
                                : 'Any category'}
                            </span>
                          </div>
                        </div>
                        <ArrowRight className="h-4 w-4 rotate-90 justify-self-center fg-muted sm:rotate-0" aria-hidden="true" />
                        <div className="min-w-0 rounded-lg bg-canvas-subtle px-3 py-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wide fg-muted">Then set</p>
                          <p className="mt-0.5 truncate text-sm font-semibold fg-primary">
                            {r.category}{r.subCategory ? ` › ${r.subCategory}` : ''}
                          </p>
                          <p className="mt-1 text-xs fg-muted">{r.type ? RULE_TYPE_LABEL[r.type] : 'Keep transaction type'}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setConfirmation({ kind: 'run', rule: r })}
                          disabled={anyRunPending}
                          title="Re-apply this rule to every existing matching transaction"
                          className={clsx(
                            'inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-medium',
                            'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
                            'dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50',
                            'disabled:cursor-not-allowed disabled:opacity-50',
                          )}
                        >
                          <Play className="h-3.5 w-3.5" aria-hidden="true" />
                          {runRule.isPending && runRule.variables === r.id ? 'Running…' : 'Run'}
                        </button>
                        <details name="rule-actions" className="relative">
                          <summary className="close-button flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-lg [&::-webkit-details-marker]:hidden" aria-label={`Actions for ${r.matchValue}`}>
                            <EllipsisVertical className="h-5 w-5" aria-hidden="true" />
                          </summary>
                          <div className="absolute right-0 z-30 mt-1 min-w-44 rounded-lg border border-default bg-surface p-1 shadow-xl">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.currentTarget.closest('details')?.removeAttribute('open');
                                setModal({ mode: 'edit', rule: r });
                              }}
                              disabled={cats.isLoading || accounts.isLoading || cats.isError || accounts.isError}
                              className="close-button flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm disabled:opacity-50"
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" /> Edit rule
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.currentTarget.closest('details')?.removeAttribute('open');
                                setConfirmation({ kind: 'delete', rule: r });
                              }}
                              disabled={deleteRule.isPending}
                              className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-900/30"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete rule
                            </button>
                          </div>
                        </details>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {totalPages > 1 && (
              <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-2">
                <div className="text-xs fg-muted tabular-nums">
                  Page {currentPage} of {totalPages.toLocaleString()}
                </div>
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={() => setPage((value) => Math.max(1, value - 1))}
                        disabled={currentPage === 1}
                      />
                    </PaginationItem>
                    {pageWindow(currentPage, totalPages).map((value, index) =>
                      value === 'ellipsis' ? (
                        <PaginationItem key={`ellipsis-${index}`}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      ) : (
                        <PaginationItem key={value}>
                          <PaginationLink
                            isActive={value === currentPage}
                            onClick={() => setPage(value)}
                          >
                            {value}
                          </PaginationLink>
                        </PaginationItem>
                      ),
                    )}
                    <PaginationItem>
                      <PaginationNext
                        onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                        disabled={currentPage === totalPages}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </>
        )}
      </section>

      {/* Modal */}
      {modal && modal.mode === 'create' && (
        <RuleFormModal
          key="create-rule"
          mode="create"
          initial={modal.initial}
          categories={ruleFormCategories}
          accounts={ruleFormAccounts}
          onSave={(input) => createRule.mutateAsync(input)}
          onClose={() => setModal(null)}
        />
      )}
      {modal && modal.mode === 'edit' && (
        <RuleFormModal
          key={`edit-${modal.rule.id}`}
          mode="edit"
          initial={{
            merchant: modal.rule.matchValue,
            accountId: modal.rule.accountId,
            sourceType: modal.rule.sourceType,
            sourceCategory: modal.rule.sourceCategory,
            sourceSubCategory: modal.rule.sourceSubCategory,
            category: modal.rule.category,
            subCategory: modal.rule.subCategory,
            type: modal.rule.type,
          }}
          categories={ruleFormCategories}
          accounts={ruleFormAccounts}
          onSave={(input) =>
            updateRule.mutateAsync({
              id: modal.rule.id,
              patch: {
                expectedVersion: modal.rule.version,
                matchValue: input.matchValue,
                accountId: input.accountId ?? null,
                sourceType: input.sourceType ?? null,
                sourceCategory: input.sourceCategory ?? null,
                sourceSubCategory: input.sourceSubCategory ?? null,
                category: input.category,
                subCategory: input.subCategory,
                // null clears a previously-set type when the user picks
                // "Leave type unchanged" on edit.
                type: input.type ?? null,
              },
            })
          }
          onClose={() => setModal(null)}
        />
      )}

      {confirmation?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete rule for “${confirmation.rule.matchValue}”?`}
          confirmLabel="Delete rule"
          destructive
          onConfirm={() => deleteRule.mutateAsync(confirmation.rule.id)}
          onClose={() => setConfirmation(null)}
        >
          <p>This merchant will no longer be categorized automatically by this rule.</p>
          <p>Transactions categorized previously by the rule keep their current categorization.</p>
        </ConfirmDialog>
      )}
      {confirmation?.kind === 'run' && (
        <ConfirmDialog
          title={`Run rule for “${confirmation.rule.matchValue}”?`}
          confirmLabel="Run rule"
          onConfirm={() => runRule.mutateAsync(confirmation.rule.id)}
          onClose={() => setConfirmation(null)}
        >
          <p>
            Every existing transaction for which this is the most-specific matching rule will be changed to{' '}
            <span className="font-medium fg-primary">
              {confirmation.rule.category}
              {confirmation.rule.subCategory ? ` › ${confirmation.rule.subCategory}` : ''}
              {confirmation.rule.type ? ` (${RULE_TYPE_LABEL[confirmation.rule.type]})` : ''}
            </span>.
          </p>
          <p>
            Match scope: {confirmation.rule.accountId ? accountNames.get(confirmation.rule.accountId) ?? 'Unknown account' : 'any account'}
            {' · '}{confirmation.rule.sourceType ? RULE_TYPE_LABEL[confirmation.rule.sourceType] : 'any type'}
            {' · '}{confirmation.rule.sourceCategory
              ? `${confirmation.rule.sourceCategory}${confirmation.rule.sourceSubCategory ? ` › ${confirmation.rule.sourceSubCategory}` : ''}`
              : 'any category'}.
          </p>
          <p>This can overwrite categories or transaction types you set previously.</p>
        </ConfirmDialog>
      )}
      {confirmation?.kind === 'run-all' && (
        <ConfirmDialog
          title="Run all rules on transaction history?"
          confirmLabel="Run all rules"
          onConfirm={() => runAllRules.mutateAsync()}
          onClose={() => setConfirmation(null)}
        >
          <p>Every rule will be applied to all matching existing transactions.</p>
          <p>This can overwrite categories and transaction types you set previously.</p>
        </ConfirmDialog>
      )}

      {/* Toast — matches Paydown's Save-to-Budget style */}
      {toast && (
        <div className="app-toast fixed z-50 max-w-sm rounded-lg border border-default bg-surface shadow-lg px-4 py-3 text-sm flex items-start gap-3">
          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 fg-primary">{toast}</div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="close-button rounded-md p-1"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function invalidateRuleRunDependents(qc: QueryClient) {
  for (const queryKey of ['transactions', 'dashboard', 'budget', 'reports', 'reviews']) {
    qc.invalidateQueries({ queryKey: [queryKey] });
  }
}
