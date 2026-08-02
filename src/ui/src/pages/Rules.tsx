/**
 * Rules page — user-defined "always set this merchant to this category"
 * mappings. Applied at import time (SimpleFIN + manual add) and via
 * the ▶ Run button on each row.
 *
 * Rules are auto-trained the first time the user categorizes a
 * previously-pending transaction (the review flow — see
 * markTransactionReviewed + editTransaction in src/db/queries.ts).
 * You can also create one directly from this page ("Add rule" button)
 * or by clicking "Create rule" on the popup that appears after an
 * inline category change on a non-pending row. They show up here in
 * all three cases.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { ArrowRight, Plus, Play, Trash2, Pencil, AlertTriangle, Check, X } from 'lucide-react';
import { api } from '../lib/api';
import { RuleFormModal, type RuleFormCategory } from '../components/RuleFormModal';
import clsx from 'clsx';

interface Rule {
  id: string;
  matchType: 'exact';
  matchValue: string;
  category: string;
  subCategory?: string;
  createdAt: string;
}

interface MainCategory {
  id: string;
  name: string;
  subCategories: { id: string; name: string }[];
}

export function Rules() {
  const qc = useQueryClient();

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
    | { mode: 'create'; initial?: { merchant: string; category: string; subCategory?: string } }
    | { mode: 'edit'; rule: Rule }
    | null
  >(null);

  // ---- Mutations ------------------------------------------------------

  const createRule = useMutation({
    mutationFn: (input: { matchValue: string; category: string; subCategory?: string }) =>
      api.post<Rule>('/api/rules', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rules'] });
      setModal(null);
    },
  });

  const updateRule = useMutation({
    mutationFn: (input: {
      id: string;
      patch: { matchValue: string; category: string; subCategory?: string };
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
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['transactions', 'page'] });
      qc.invalidateQueries({ queryKey: ['reviews'] });
      setToast(`Updated ${result.updated} transaction${result.updated === 1 ? '' : 's'}.`);
    },
  });

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
            Automatically categorize future transactions from the same merchant. Rules
            apply at import time (SimpleFIN + manual add) and can also be re-run
            against your existing transactions.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ mode: 'create' })}
          className="btn-primary inline-flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Add rule
        </button>
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
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">
            {(rules.data ?? []).map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm fg-primary truncate">{r.matchValue}</div>
                    <div className="text-xs fg-muted mt-0.5 flex items-center gap-1">
                      <ArrowRight className="h-3 w-3" />
                      <span className="fg-secondary">
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
                    onClick={() => runRule.mutate(r.id)}
                    disabled={runRule.isPending}
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
                    onClick={() => {
                      if (confirm(`Delete rule for "${r.matchValue}"?`)) {
                        deleteRule.mutate(r.id);
                      }
                    }}
                    disabled={deleteRule.isPending}
                    title="Delete rule"
                    className="fg-muted hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded p-1.5 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
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
          }}
          categories={ruleFormCategories}
          onSave={(input) =>
            updateRule.mutateAsync({
              id: modal.rule.id,
              patch: {
                matchValue: input.matchValue,
                category: input.category,
                subCategory: input.subCategory,
              },
            })
          }
          onClose={() => setModal(null)}
        />
      )}

      {/* Toast — matches Paydown's Save-to-Budget style */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border border-default bg-surface shadow-lg px-4 py-3 text-sm flex items-start gap-3">
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
