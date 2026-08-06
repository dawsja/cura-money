import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import clsx from 'clsx';

/**
 * Reusable form modal for creating or editing a categorization rule.
 *
 * Used from two places:
 *   1. The Transactions page popup CTA — opened with a pre-filled
 *      merchant and a default category/sub-category the user just set.
 *   2. The Rules page "Add rule" button — opened empty.
 *
 * The modal owns no network state; the parent wires `onSave` to a
 * useMutation that POSTs or PATCHes `/api/rules` and closes the modal
 * on success.
 */

export interface RuleFormCategory {
  name: string;
  subCategories: { name: string }[];
}

export type RuleFormTxType = 'income' | 'expense' | 'transfer';

export interface RuleFormInitial {
  merchant: string;
  category: string;
  subCategory?: string;
  type?: RuleFormTxType;
}

export interface RuleFormSubmit {
  matchValue: string;
  category: string;
  subCategory: string;
  type?: RuleFormTxType;
}

const INPUT_CLS =
  'rounded-lg border border-default bg-surface fg-primary placeholder-slate-400 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none';

export function RuleFormModal({
  mode,
  initial,
  categories,
  onSave,
  onClose,
}: {
  mode: 'create' | 'edit';
  initial?: RuleFormInitial;
  categories: RuleFormCategory[];
  onSave: (input: RuleFormSubmit) => Promise<unknown> | unknown;
  onClose: () => void;
}) {
  const [merchant, setMerchant] = useState(initial?.merchant ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [subCategory, setSubCategory] = useState(initial?.subCategory ?? '');
  const [type, setType] = useState<RuleFormTxType | ''>(initial?.type ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Keep fields in sync if the parent resets `initial` between opens
  // (e.g. user opens the modal twice with different transactions).
  useEffect(() => {
    if (!initial) return;
    setMerchant(initial.merchant);
    setCategory(initial.category);
    setSubCategory(initial.subCategory ?? '');
    setType(initial.type ?? '');
  }, [initial]);

  const trimmed = merchant.trim();
  const categoryPick = category && subCategory
    ? JSON.stringify({ category, subCategory })
    : '';
  const canSave = trimmed.length > 0 && category.length > 0 && subCategory.length > 0 && !submitting;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSubmitting(true);
    setErr(null);
    try {
      await onSave({
        matchValue: trimmed,
        category,
        subCategory,
        type: type || undefined,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'unknown';
      setErr(message);
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="card w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold fg-primary">
            {mode === 'create' ? 'Create rule' : 'Edit rule'}
          </h3>
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            className="fg-muted hover:fg-secondary"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block">
            <span className="text-sm fg-secondary">Merchant</span>
            <input
              type="text"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder="e.g. Whole Foods Market"
              maxLength={255}
              className={`mt-1 w-full ${INPUT_CLS}`}
              autoFocus
            />
            <span className="text-[10px] fg-muted">
              Case-insensitive. Matches this merchant exactly, or when the payee
              starts with this text (e.g. &quot;Starbucks&quot; matches &quot;STARBUCKS #1234&quot;).
            </span>
          </label>

          <label className="block">
            <span className="text-sm fg-secondary">
              Type <span className="fg-muted font-normal">(optional)</span>
            </span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as RuleFormTxType | '')}
              className={`mt-1 w-full ${INPUT_CLS}`}
            >
              <option value="">No type override</option>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="transfer">Transfer</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm fg-secondary">Category</span>
            <select
              value={categoryPick}
              onChange={(e) => {
                if (!e.target.value) {
                  setCategory('');
                  setSubCategory('');
                  return;
                }
                const selected = JSON.parse(e.target.value) as { category: string; subCategory: string };
                setCategory(selected.category);
                setSubCategory(selected.subCategory);
              }}
              className={`mt-1 w-full ${INPUT_CLS}`}
            >
              <option value="">Pick a category…</option>
              {categories.map((c) => (
                <optgroup key={c.name} label={c.name}>
                  {c.subCategories.map((s) => (
                    <option
                      key={s.name}
                      value={JSON.stringify({ category: c.name, subCategory: s.name })}
                    >
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {err && (
            <p className="text-sm text-rose-600 dark:text-rose-400">{err}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => !submitting && onClose()}
              className="px-3 py-2 text-sm fg-tertiary hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSave}
              className={clsx(
                'btn-primary flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              <Check className="h-4 w-4" />
              {submitting ? 'Saving…' : mode === 'create' ? 'Create rule' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
