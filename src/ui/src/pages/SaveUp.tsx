/**
 * Save up — savings goals ("save up for X") watched against a single
 * account.
 *
 * Each goal card shows the goal name, the watched account, the live
 * balance, the target, and a progress bar (current / target). Tone
 * follows the same emerald/amber/rose palette as the Budget page.
 *
 * Clicking a card opens an edit modal for that goal. Adding a new
 * goal opens the same modal in "create" mode (no X-to-close needed
 * when creating — there's no destructive action to abandon; users
 * can just click outside or hit the X to dismiss). Editing shows a
 * Delete button at the bottom of the modal so it's only reachable
 * through the destructive intent path.
 */
import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import { Progress } from '../components/ui/progress';
import {
  PiggyBank,
  Plus,
  X,
  Check,
  Pencil,
  Trash2,
  Target,
  Wallet,
  Link2Off,
} from 'lucide-react';
import clsx from 'clsx';

interface Goal {
  id: string;
  name: string;
  target: number;
  startingValue: number;
  accountId: string | null;
  accountBalance: number | null;
  accountName: string | null;
}

interface Account {
  id: string;
  name: string;
  type: string;
  hidden: boolean;
}

const INPUT_CLS = 'rounded-lg border border-default bg-surface fg-primary placeholder-slate-400 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none';

export function SaveUp() {
  const qc = useQueryClient();
  const goals = useQuery({ queryKey: ['goals'], queryFn: () => api.get<Goal[]>('/api/goals') });
  const accounts = useQuery({
    queryKey: ['accounts', { forGoal: true }],
    // We need hidden accounts too — a user might want to attach a goal
    // to a hidden account they still track. (`?includeHidden=true`.)
    queryFn: () => api.get<Account[]>('/api/accounts?includeHidden=true'),
  });

  const [openGoalId, setOpenGoalId] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);

  const list = goals.data ?? [];
  const accList = (accounts.data ?? []).filter((a) => a.type !== 'credit' && a.type !== 'loan');
  const accById = new Map(accList.map((a) => [a.id, a]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold fg-primary">Save up</h1>
        <button
          onClick={() => setCreatingNew(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="h-4 w-4" /> New goal
        </button>
      </div>

      <p className="text-sm fg-tertiary max-w-xl">
        Pick a savings goal and the account you're stashing money in.
        The progress bar tracks that account's live balance — every
        dollar in counts toward your target.
      </p>

      {list.length === 0 ? (
        <div className="card text-sm fg-muted text-center">
          <PiggyBank className="h-5 w-5 inline mr-1 fg-muted" />
          No goals yet. Click <span className="font-semibold">New goal</span> to save up for something.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((g) => {
            const balance = g.accountBalance;
            const showProgress = balance !== null;
            const pct = showProgress && g.target > 0 && balance !== null
              ? Math.min(100, (Math.max(0, balance) / g.target) * 100)
              : 0;
            const tone: 'emerald' | 'amber' | 'rose' =
              balance !== null && balance > g.target
                ? 'rose'
                : pct >= 70
                  ? 'amber'
                  : 'emerald';
            const current = balance ?? 0;
            const remaining = Math.max(0, g.target - current);
            return (
              <button
                key={g.id}
                onClick={() => setOpenGoalId(g.id)}
                className="card text-left hover:border-amber-300 dark:hover:border-amber-600 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Target className="h-4 w-4 shrink-0 text-amber-500" />
                      <div className="font-semibold fg-primary truncate">{g.name}</div>
                    </div>
                    <div className="text-xs fg-muted mt-1 flex items-center gap-1">
                      <Wallet className="h-3 w-3" />
                      {g.accountName ?? (
                        <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
                          <Link2Off className="h-3 w-3" /> Account removed
                        </span>
                      )}
                    </div>
                  </div>
                  <Pencil className="h-3.5 w-3.5 fg-muted shrink-0" />
                </div>
                <div className="mt-3 flex items-baseline justify-between text-sm tabular-nums">
                  <span className={clsx(
                    'font-semibold',
                    balance !== null && balance > g.target
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'fg-primary',
                  )}>
                    {formatMoney(current)}
                  </span>
                  <span className="fg-muted">
                    of {formatMoney(g.target)}
                  </span>
                </div>
                {showProgress ? (
                  <Progress value={pct} tone={tone} className="mt-2" />
                ) : (
                  <div className="mt-2 text-xs text-rose-600 dark:text-rose-400">
                    Pick an account to track this goal.
                  </div>
                )}
                <div className="mt-2 text-xs fg-muted tabular-nums">
                  {balance !== null && balance > g.target
                    ? <span className="text-rose-600 dark:text-rose-400 font-medium">Over target by {formatMoney(current - g.target)}</span>
                    : `${Math.round(pct)}% · ${formatMoney(remaining)} to go`}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Edit modal — one instance per open goal. Render via a portal-like
          key trick so each open goal gets its own state. */}
      {openGoalId && (() => {
        const g = list.find((x) => x.id === openGoalId);
        if (!g) return null;
        return (
          <GoalModal
            key={g.id}
            goal={g}
            accounts={accList}
            onClose={() => setOpenGoalId(null)}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: ['goals'] });
              setOpenGoalId(null);
            }}
            onDeleted={() => {
              qc.invalidateQueries({ queryKey: ['goals'] });
              setOpenGoalId(null);
            }}
          />
        );
      })()}

      {creatingNew && (
        <GoalModal
          key="new"
          goal={null}
          accounts={accList}
          onClose={() => setCreatingNew(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['goals'] });
            setCreatingNew(false);
          }}
          onDeleted={() => setCreatingNew(false)}
        />
      )}
    </div>
  );
}

// ---- Goal modal ---------------------------------------------------------
//
// One modal handles both create and edit. `goal === null` means create.
// In edit mode the modal shows a Delete button at the bottom; in
// create mode it's omitted (nothing to delete yet).

function GoalModal({
  goal,
  accounts,
  onClose,
  onSaved,
  onDeleted,
}: {
  goal: Goal | null;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const isEdit = goal !== null;
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? String(goal.target) : '');
  const [startingValue, setStartingValue] = useState(goal ? String(goal.startingValue) : '0');
  const [accountId, setAccountId] = useState(goal?.accountId ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        target: Number(target),
        startingValue: Number(startingValue) || 0,
        accountId,
      };
      // Different return shapes; useMutation's generic is a single T so
      // we widen it via a Promise<unknown> cast — onSuccess only cares
      // that the call resolved, not what came back.
      const p: Promise<unknown> = isEdit
        ? api.patch<{ ok: true }>(`/api/goals/${goal!.id}`, payload)
        : api.post<Goal>('/api/goals', payload);
      return p as Promise<{ ok: true } | Goal>;
    },
    onSuccess: onSaved,
  });

  const del = useMutation({
    mutationFn: () => api.delete(`/api/goals/${goal!.id}`),
    onSuccess: onDeleted,
  });

  const targetNum = Number(target);
  const canSave = name.trim().length > 0 && Number.isFinite(targetNum) && targetNum > 0 && accountId.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold fg-primary">
            {isEdit ? 'Edit goal' : 'New goal'}
          </h3>
          <button
            onClick={onClose}
            className="fg-muted hover:fg-secondary"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSave || save.isPending) return;
            save.mutate();
          }}
          className="space-y-3"
        >
          <label className="block">
            <span className="text-sm fg-secondary">Goal name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Emergency fund"
              className={`mt-1 w-full ${INPUT_CLS}`}
              required
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-sm fg-secondary">Target amount</span>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 fg-muted text-sm">$</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="0"
                className={`w-full ${INPUT_CLS} pl-7 pr-3 tabular-nums`}
                required
              />
            </div>
          </label>
          <label className="block">
            <span className="text-sm fg-secondary">
              Starting value <span className="fg-muted font-normal">(optional)</span>
            </span>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 fg-muted text-sm">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={startingValue}
                onChange={(e) => setStartingValue(e.target.value)}
                placeholder="0"
                className={`w-full ${INPUT_CLS} pl-7 pr-3 tabular-nums`}
              />
            </div>
            <span className="text-[10px] fg-muted">How much you've already saved toward this goal.</span>
          </label>
          <label className="block">
            <span className="text-sm fg-secondary">Watch account</span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className={`mt-1 w-full ${INPUT_CLS}`}
              required
            >
              <option value="">— Pick an account —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.type})
                </option>
              ))}
            </select>
            <span className="text-[10px] fg-muted">
              The account whose balance drives the progress bar.
            </span>
          </label>

          {save.error && (
            <div className="text-xs text-rose-600 dark:text-rose-400">
              {(save.error as Error).message}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm fg-tertiary hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">
              Cancel
            </button>
            <button type="submit" disabled={!canSave || save.isPending} className="btn-primary flex items-center gap-1">
              <Check className="h-4 w-4" /> {isEdit ? 'Save' : 'Create'}
            </button>
          </div>
        </form>

        {/* Delete — only shown when editing an existing goal. Two-step
            (button → confirm) so a stray click doesn't nuke data. The
            button lives at the bottom of the modal so it's only reached
            through the destructive intent path. */}
        {isEdit && (
          <div className="mt-4 pt-4 border-t border-default">
            {!confirmingDelete ? (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg"
              >
                <Trash2 className="h-4 w-4" /> Delete goal
              </button>
            ) : (
              <div className="space-y-2">
                <div className="text-xs fg-tertiary text-center">
                  Delete this goal? This can't be undone.
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="flex-1 px-3 py-2 text-sm fg-tertiary hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    onClick={() => del.mutate()}
                    disabled={del.isPending}
                    className="flex-1 px-3 py-2 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-lg flex items-center justify-center gap-2"
                  >
                    <Trash2 className="h-4 w-4" /> Delete
                  </button>
                </div>
                {del.error && (
                  <div className="text-xs text-rose-600 dark:text-rose-400 text-center">
                    {(del.error as Error).message}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}