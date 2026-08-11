import { useState } from 'react';
import { Check, X } from 'lucide-react';
import clsx from 'clsx';
import { Dialog } from './ui/dialog';

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
  id: string;
  name: string;
  type: RuleFormTxType;
  subCategories: { id: string; name: string }[];
}

export interface RuleFormAccount {
  id: string;
  name: string;
}

export type RuleFormTxType = 'income' | 'expense' | 'transfer';

export interface RuleFormInitial {
  merchant: string;
  accountId?: string;
  sourceType?: RuleFormTxType;
  sourceCategory?: string;
  sourceSubCategory?: string;
  category: string;
  subCategory?: string;
  type?: RuleFormTxType;
}

export interface RuleFormSubmit {
  matchValue: string;
  accountId?: string;
  sourceType?: RuleFormTxType;
  sourceCategory?: string;
  sourceSubCategory?: string;
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
  accounts,
  onSave,
  onClose,
}: {
  mode: 'create' | 'edit';
  initial?: RuleFormInitial;
  categories: RuleFormCategory[];
  accounts: RuleFormAccount[];
  onSave: (input: RuleFormSubmit) => Promise<unknown> | unknown;
  onClose: () => void;
}) {
  const [merchant, setMerchant] = useState(initial?.merchant ?? '');
  const [accountId, setAccountId] = useState(initial?.accountId ?? '');
  const [sourceType, setSourceType] = useState<RuleFormTxType | ''>(initial?.sourceType ?? '');
  const [sourceCategory, setSourceCategory] = useState(initial?.sourceCategory ?? '');
  const [sourceSubCategory, setSourceSubCategory] = useState(initial?.sourceSubCategory ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [subCategory, setSubCategory] = useState(initial?.subCategory ?? '');
  const [type, setType] = useState<RuleFormTxType | ''>(initial?.type ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const trimmed = merchant.trim();
  const sourceCategoryPick = sourceCategory && sourceSubCategory
    ? JSON.stringify({ category: sourceCategory, subCategory: sourceSubCategory })
    : '';
  const categoryPick = category && subCategory
    ? JSON.stringify({ category, subCategory })
    : '';
  const targetExists = categories.some((candidate) =>
    candidate.name === category
    && candidate.subCategories.some((sub) => sub.name === subCategory)
    && (!type || candidate.type === type || candidate.name === 'Pay down goals'),
  );
  const sourceExistsInTree = categories.some((candidate) =>
      candidate.name === sourceCategory
      && candidate.subCategories.some((sub) => sub.name === sourceSubCategory)
      && (!sourceType || candidate.type === sourceType || candidate.name === 'Pay down goals'));
  const unchangedHistoricalSource = initial?.sourceCategory === sourceCategory
    && initial?.sourceSubCategory === sourceSubCategory
    && initial?.sourceType === (sourceType || undefined);
  const sourceExists = !sourceCategory || sourceExistsInTree || unchangedHistoricalSource;
  const accountExists = !accountId || accounts.some((account) => account.id === accountId);
  const preservesLegacyPaydownType = mode === 'edit'
    && initial?.category === 'Pay down goals'
    && initial.type === undefined
    && category === 'Pay down goals'
    && !type;
  const canSave = trimmed.length > 0
    && (!!type || preservesLegacyPaydownType)
    && targetExists
    && sourceExists
    && accountExists
    && !submitting;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSubmitting(true);
    setErr(null);
    try {
      await onSave({
        matchValue: trimmed,
        accountId: accountId || undefined,
        sourceType: sourceType || undefined,
        sourceCategory: sourceCategory || undefined,
        sourceSubCategory: sourceSubCategory || undefined,
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
    <Dialog
      aria-label={mode === 'create' ? 'Create rule' : 'Edit rule'}
      onClose={onClose}
      closeDisabled={submitting}
      contentClassName="card w-full max-w-md"
    >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold fg-primary">
            {mode === 'create' ? 'Create rule' : 'Edit rule'}
          </h3>
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="close-button rounded-lg p-2 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide fg-muted">When</div>
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
              Account <span className="fg-muted font-normal">(optional)</span>
            </span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className={`mt-1 w-full ${INPUT_CLS}`}
            >
              <option value="">Any account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm fg-secondary">
              Original type <span className="fg-muted font-normal">(optional)</span>
            </span>
            <select
              value={sourceType}
              onChange={(e) => {
                const next = e.target.value as RuleFormTxType | '';
                setSourceType(next);
                const selectedCategory = categories.find((candidate) => candidate.name === sourceCategory);
                if (next && selectedCategory && selectedCategory.type !== next && selectedCategory.name !== 'Pay down goals') {
                  setSourceCategory('');
                  setSourceSubCategory('');
                }
              }}
              className={`mt-1 w-full ${INPUT_CLS}`}
            >
              <option value="">Any type</option>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="transfer">Transfer</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm fg-secondary">
              Original category <span className="fg-muted font-normal">(optional)</span>
            </span>
            <select
              value={sourceCategoryPick}
              onChange={(e) => {
                if (!e.target.value) {
                  setSourceCategory('');
                  setSourceSubCategory('');
                  return;
                }
                const selected = JSON.parse(e.target.value) as { category: string; subCategory: string };
                setSourceCategory(selected.category);
                setSourceSubCategory(selected.subCategory);
              }}
              className={`mt-1 w-full ${INPUT_CLS}`}
            >
              <option value="">Any category</option>
              {sourceCategoryPick && !sourceExistsInTree && (
                <option value={sourceCategoryPick}>
                  Historical: {sourceCategory} › {sourceSubCategory}
                </option>
              )}
              {categories
                .filter((candidate) => !sourceType || candidate.type === sourceType || candidate.name === 'Pay down goals')
                .map((c) => (
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
          </label>

          <div className="border-t border-default pt-3 text-xs font-semibold uppercase tracking-wide fg-muted">Then set</div>

          <label className="block">
            <span className="text-sm fg-secondary">
              Type
            </span>
            <select
              value={type}
              onChange={(e) => {
                const next = e.target.value as RuleFormTxType | '';
                setType(next);
                const selectedCategory = categories.find((candidate) => candidate.name === category);
                if (next && selectedCategory && selectedCategory.type !== next && selectedCategory.name !== 'Pay down goals') {
                  setCategory('');
                  setSubCategory('');
                }
              }}
              className={`mt-1 w-full ${INPUT_CLS}`}
            >
              <option value="">
                {preservesLegacyPaydownType ? 'Leave type unchanged (legacy rule)' : 'Pick a type'}
              </option>
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
              {categories
                .filter((candidate) => !type || candidate.type === type || candidate.name === 'Pay down goals')
                .map((c) => (
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
          </label>

          {err && (
            <p className="text-sm text-rose-600 dark:text-rose-400">{err}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => !submitting && onClose()}
              disabled={submitting}
              className="px-3 py-2 text-sm fg-tertiary hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg disabled:opacity-50"
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
    </Dialog>
  );
}
