/**
 * Rules page — user-defined "always set this merchant to this category"
 * mappings. Applied at import time (SimpleFIN + manual add) and via
 * the ▶ Run button on each row, or "Run all rules" for the full set.
 *
 * Rules are auto-trained the first time the user categorizes a
 * previously-pending transaction (the review flow — see
 * markTransactionReviewed + editTransaction in src/db/queries.ts).
 * You can also create one directly from this page ("Add rule" button)
 * or by clicking "Create rule" on the popup that appears after an
 * inline category change on a non-pending row. They show up here in
 * all three cases.
 */
import { useDeferredValue, useEffect, useState } from 'react';
import { useQuery, useQueryClient, useMutation, type QueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus, Play, Trash2, Pencil, AlertTriangle, Check, X, Search } from 'lucide-react';
import { api } from '../lib/api';
import { RuleFormModal, type RuleFormCategory } from '../components/RuleFormModal';
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
  category: string;
  subCategory?: string;
  type?: RuleTxType;
  createdAt: string;
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

function ruleMatchesSearch(rule: Rule, search: string): boolean {
  const tokens = search.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  const fields = [
    rule.matchValue,
    rule.category,
    rule.subCategory,
    rule.type ? RULE_TYPE_LABEL[rule.type] : undefined,
  ];
  return tokens.every((token) => fields.some((field) => fuzzyTokenIn(field, token)));
}

interface MainCategory {
  id: string;
  name: string;
  subCategories: { id: string; name: string }[];
}

export function Rules() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
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

  // Flatten the category tree into the shape the modal expects. Only
  // the names matter; ids are dropped because rules store the category
  // name as a string.
  const ruleFormCategories: RuleFormCategory[] = (cats.data ?? []).map((c) => ({
    name: c.name,
    subCategories: c.subCategories.map((s) => ({ name: s.name })),
  }));

  // ---- Modal state ----------------------------------------------------
  // `null` = closed. Otherwise the modal is open in either 'create' or
  // 'edit' mode with the given initial values (edit pre-fills).
  const [modal, setModal] = useState<
    | {
        mode: 'create';
        initial?: { merchant: string; category: string; subCategory?: string; type?: RuleTxType };
      }
    | { mode: 'edit'; rule: Rule }
    | null
  >(null);

  // ---- Mutations ------------------------------------------------------

  const createRule = useMutation({
    mutationFn: (input: {
      matchValue: string;
      category: string;
      subCategory: string;
      type?: RuleTxType;
    }) => api.post<Rule>('/api/rules', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rules'] });
      setModal(null);
    },
  });

  const updateRule = useMutation({
    mutationFn: (input: {
      id: string;
      patch: {
        matchValue: string;
        category: string;
        subCategory: string;
        type?: RuleTxType | null;
      };
    }) => api.patch(`/api/rules/${input.id}`, input.patch),
    onSuccess: () => {
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
  const filteredRules = (rules.data ?? []).filter((rule) => ruleMatchesSearch(rule, deferredSearch));
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
        <div>
          <h1 className="text-2xl font-bold fg-primary">Rules</h1>
          <p className="text-sm fg-tertiary max-w-xl mt-1">
            Automatically categorize and type future transactions from the same
            merchant. Rules match the merchant exactly or as a prefix (e.g. &quot;Starbucks&quot;
            catches &quot;STARBUCKS #1234&quot;), apply at import, and can be re-run against
            existing transactions.
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
            className="btn-primary inline-flex items-center gap-2 min-h-[44px]"
          >
            <Plus className="h-4 w-4" />
            Add rule
          </button>
        </div>
      </div>

      {/* List */}
      <section className="card">
        {rules.isLoading ? (
          <div className="py-10 text-center text-sm fg-muted">Loading…</div>
        ) : rules.data?.length === 0 ? (
          <div className="py-10 text-center text-sm fg-muted">
            <AlertTriangle className="h-5 w-5 inline mr-1 fg-muted" />
            No rules yet. Rules are created automatically when you categorize a
            transaction that was awaiting review. You can also click{' '}
             <span className="font-semibold fg-secondary">Add rule</span> to create one by hand.
           </div>
         ) : (
          <>
            <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
              <div className="flex items-baseline gap-2">
                <h2 className="text-lg font-semibold fg-primary">All rules</h2>
                <span className="text-xs fg-muted tabular-nums">
                  {filteredRules.length.toLocaleString()} match{filteredRules.length === 1 ? '' : 'es'}
                </span>
              </div>
              <InputGroup className="min-h-11 min-w-0 md:min-h-0 w-full md:max-w-xs">
                <InputGroupAddon aria-hidden="true">
                  <Search className="h-4 w-4" />
                </InputGroupAddon>
                <InputGroupInput
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Search merchants, categories…"
                  aria-label="Search rules"
                />
              </InputGroup>
            </div>

            {filteredRules.length === 0 ? (
              <div className="py-10 text-center text-sm fg-muted">
                No rules match your search.
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                {pagedRules.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm fg-primary truncate">{r.matchValue}</div>
                    <div className="text-xs fg-muted mt-0.5 flex items-center gap-1 flex-wrap">
                      <ArrowRight className="h-3 w-3 shrink-0" />
                      <span className="fg-secondary">
                        {r.type ? (
                          <span className="fg-tertiary">{RULE_TYPE_LABEL[r.type]} · </span>
                        ) : null}
                        {r.category}
                        {r.subCategory ? (
                          <>
                            {' › '}
                            <span className="fg-tertiary">{r.subCategory}</span>
                          </>
                        ) : null}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmation({ kind: 'run', rule: r })}
                    disabled={anyRunPending}
                    title="Re-apply this rule to every existing matching transaction"
                    className={clsx(
                      'inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium',
                      'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
                      'dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50',
                      'disabled:opacity-50 disabled:cursor-not-allowed',
                      'transition-colors',
                    )}
                  >
                    <Play className="h-3.5 w-3.5" />
                    {runRule.isPending && runRule.variables === r.id ? 'Running…' : 'Run'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setModal({ mode: 'edit', rule: r })}
                    title="Edit rule"
                    className="fg-muted hover:text-amber-700 dark:hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded p-1.5"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmation({ kind: 'delete', rule: r })}
                    disabled={deleteRule.isPending}
                    title="Delete rule"
                    className="fg-muted hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded p-1.5 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
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
          mode="create"
          initial={modal.initial}
          categories={ruleFormCategories}
          onSave={(input) => createRule.mutateAsync(input)}
          onClose={() => setModal(null)}
        />
      )}
      {modal && modal.mode === 'edit' && (
        <RuleFormModal
          mode="edit"
          initial={{
            merchant: modal.rule.matchValue,
            category: modal.rule.category,
            subCategory: modal.rule.subCategory,
            type: modal.rule.type,
          }}
          categories={ruleFormCategories}
          onSave={(input) =>
            updateRule.mutateAsync({
              id: modal.rule.id,
              patch: {
                matchValue: input.matchValue,
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
            Every existing transaction matching this merchant will be changed to{' '}
            <span className="font-medium fg-primary">
              {confirmation.rule.category}
              {confirmation.rule.subCategory ? ` › ${confirmation.rule.subCategory}` : ''}
              {confirmation.rule.type ? ` (${RULE_TYPE_LABEL[confirmation.rule.type]})` : ''}
            </span>.
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
            className="fg-muted hover:fg-secondary"
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
  for (const queryKey of ['transactions', 'budget', 'reports', 'reviews']) {
    qc.invalidateQueries({ queryKey: [queryKey] });
  }
}
