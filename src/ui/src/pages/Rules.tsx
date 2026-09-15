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
import { ArrowRight, Plus, Play, Trash2, Pencil, AlertTriangle, Search, ListFilter, EllipsisVertical } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import {
  RuleFormModal,
  type RuleFormAccount,
  type RuleFormCategory,
} from '../components/RuleFormModal';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty';
import { Field, FieldGroup, FieldLabel } from '../components/ui/field';
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Spinner } from '../components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group';

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
      toast.success(`Updated ${result.updated} transaction${result.updated === 1 ? '' : 's'}.`);
    },
  });

  const runAllRules = useMutation({
    mutationFn: () => api.post<{ ok: boolean; updated: number }>('/api/rules/run-all', {}),
    onSuccess: (result) => {
      invalidateRuleRunDependents(qc);
      toast.success(`Updated ${result.updated} transaction${result.updated === 1 ? '' : 's'}.`);
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

  return (
    <div className="flex flex-col gap-6">
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
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmation({ kind: 'run-all' })}
            disabled={!hasRules || anyRunPending}
            title="Re-apply every rule to matching transactions in your history"
          >
            {runAllRules.isPending ? <Spinner data-icon="inline-start" /> : <Play data-icon="inline-start" />}
            {runAllRules.isPending ? 'Running…' : 'Run all rules'}
          </Button>
          <Button
            type="button"
            onClick={() => setModal({ mode: 'create' })}
            disabled={cats.isLoading || accounts.isLoading || cats.isError || accounts.isError}
          >
            <Plus data-icon="inline-start" />
            Add rule
          </Button>
        </div>
      </div>

      {(cats.isError || accounts.isError) && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Rule editing is unavailable</AlertTitle>
          <AlertDescription>Categories or accounts could not be loaded.</AlertDescription>
          <AlertAction>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => { void cats.refetch(); void accounts.refetch(); }}
            >
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}

      <Card>
        {rules.isLoading ? (
          <CardContent className="py-10">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><Spinner /></EmptyMedia>
                <EmptyTitle>Loading rules…</EmptyTitle>
              </EmptyHeader>
            </Empty>
          </CardContent>
        ) : rules.isError ? (
          <CardContent className="py-8">
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Could not load rules.</AlertTitle>
              <AlertAction>
                <Button type="button" size="sm" onClick={() => void rules.refetch()} disabled={rules.isFetching}>
                  {rules.isFetching ? <Spinner data-icon="inline-start" /> : null}
                  Retry
                </Button>
              </AlertAction>
            </Alert>
          </CardContent>
        ) : rules.data?.length === 0 ? (
          <CardContent className="py-10">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><AlertTriangle /></EmptyMedia>
                <EmptyTitle>No rules yet</EmptyTitle>
                <EmptyDescription>
                  Correct a transaction and choose Create scoped rule, or click Add rule to create one by hand.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        ) : (
          <>
            <CardHeader className="gap-3 sm:grid-cols-[1fr_auto]">
              <div className="flex items-baseline gap-2">
                <CardTitle>All rules</CardTitle>
                <span className="text-xs text-muted-foreground tabular-nums">
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
                <Button
                  type="button"
                  variant={filtersOpen || activeFilterCount > 0 ? 'secondary' : 'outline'}
                  onClick={() => setFiltersOpen((value) => !value)}
                  aria-expanded={filtersOpen}
                  aria-controls="rule-filters"
                >
                  <ListFilter data-icon="inline-start" />
                  Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
            {filtersOpen && (
              <div id="rule-filters" className="mb-4 rounded-xl border border-default bg-canvas-subtle p-3">
                <FieldGroup className="gap-3 sm:grid sm:grid-cols-3">
                  <Field>
                    <FieldLabel>Account scope</FieldLabel>
                    <Select
                      value={accountFilter}
                      onValueChange={(value) => { setAccountFilter(value); setPage(1); }}
                    >
                      <SelectTrigger className="w-full min-h-11 md:min-h-8">
                        <SelectValue placeholder="All account scopes" />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectGroup>
                          <SelectItem value="all">All account scopes</SelectItem>
                          <SelectItem value="any">Any account only</SelectItem>
                          {ruleFormAccounts.map((account) => (
                            <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>Original type</FieldLabel>
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      value={sourceTypeFilter}
                      onValueChange={(value) => {
                        if (!value) return;
                        setSourceTypeFilter(value as 'all' | RuleTxType);
                        setPage(1);
                      }}
                      className="w-full flex-wrap"
                    >
                      <ToggleGroupItem value="all" className="flex-1">All</ToggleGroupItem>
                      {(Object.keys(RULE_TYPE_LABEL) as RuleTxType[]).map((type) => (
                        <ToggleGroupItem key={type} value={type} className="flex-1">
                          {RULE_TYPE_LABEL[type]}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </Field>
                  <Field>
                    <FieldLabel>Result category</FieldLabel>
                    <Select
                      value={categoryFilter}
                      onValueChange={(value) => { setCategoryFilter(value); setPage(1); }}
                    >
                      <SelectTrigger className="w-full min-h-11 md:min-h-8">
                        <SelectValue placeholder="All result categories" />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectGroup>
                          <SelectItem value="all">All result categories</SelectItem>
                          {ruleFormCategories.map((category) => (
                            <SelectItem key={category.id} value={category.name}>{category.name}</SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </FieldGroup>
                {activeFilterCount > 0 && (
                  <Button
                    type="button"
                    variant="link"
                    className="mt-2 h-auto px-0"
                    onClick={() => {
                      setAccountFilter('all');
                      setSourceTypeFilter('all');
                      setCategoryFilter('all');
                      setPage(1);
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            )}

            {filteredRules.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No matching rules</EmptyTitle>
                  <EmptyDescription>No rules match your search or filters.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="divide-y divide-border">
                {pagedRules.map((r) => (
                  <li key={r.id} className="py-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">When</p>
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
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Then set</p>
                          <p className="mt-0.5 truncate text-sm font-semibold fg-primary">
                            {r.category}{r.subCategory ? ` › ${r.subCategory}` : ''}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">{r.type ? RULE_TYPE_LABEL[r.type] : 'Keep transaction type'}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center justify-end gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setConfirmation({ kind: 'run', rule: r })}
                          disabled={anyRunPending}
                          title="Re-apply this rule to every existing matching transaction"
                        >
                          {runRule.isPending && runRule.variables === r.id
                            ? <Spinner data-icon="inline-start" />
                            : <Play data-icon="inline-start" />}
                          {runRule.isPending && runRule.variables === r.id ? 'Running…' : 'Run'}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" aria-label={`Actions for ${r.matchValue}`}>
                              <EllipsisVertical />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-44">
                            <DropdownMenuGroup>
                              <DropdownMenuItem
                                disabled={cats.isLoading || accounts.isLoading || cats.isError || accounts.isError}
                                onClick={() => setModal({ mode: 'edit', rule: r })}
                              >
                                <Pencil /> Edit rule
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={deleteRule.isPending}
                                onClick={() => setConfirmation({ kind: 'delete', rule: r })}
                              >
                                <Trash2 /> Delete rule
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {totalPages > 1 && (
              <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground tabular-nums">
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
            </CardContent>
          </>
        )}
      </Card>

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
    </div>
  );
}

function invalidateRuleRunDependents(qc: QueryClient) {
  for (const queryKey of ['transactions', 'dashboard', 'budget', 'reports', 'reviews']) {
    qc.invalidateQueries({ queryKey: [queryKey] });
  }
}
