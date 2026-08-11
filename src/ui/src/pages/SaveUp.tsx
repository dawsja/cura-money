/**
 * Save up — savings goals ("save up for X") watched against a single
 * account.
 *
 * Each goal card shows the goal name, the watched account, the live
 * balance, the target, and an animated milestone progress bar. Active
 * goals use the CTA accent while reached goals use the success tone.
 *
 * Clicking a card opens an edit modal for that goal. Adding a new
 * goal opens the same modal in "create" mode (no X-to-close needed
 * when creating — there's no destructive action to abandon; users
 * can just click outside or hit the X to dismiss). Editing shows a
 * Delete button at the bottom of the modal so it's only reachable
 * through the destructive intent path.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import { Dialog } from '../components/ui/dialog';
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
  Trophy,
  Sparkles,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import clsx from 'clsx';
import { AsyncQueryState } from '../components/ui/AsyncQueryState';

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
const MILESTONES = [25, 50, 75, 100] as const;

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

  if (goals.isLoading || accounts.isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold fg-primary">Save up</h1>
        <AsyncQueryState status="loading" title="Loading savings goals…" message="Fetching your goals and available accounts." />
      </div>
    );
  }

  if (goals.isError || accounts.isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold fg-primary">Save up</h1>
        <AsyncQueryState
          status="error"
          title="Could not load savings goals"
          message="Goals and account balances are unavailable. No progress amounts are being shown."
          onRetry={() => void Promise.all([goals.refetch(), accounts.refetch()])}
          retrying={goals.isFetching || accounts.isFetching}
        />
      </div>
    );
  }

  const list = goals.data ?? [];
  const accList = (accounts.data ?? []).filter(
    (a) => a.type !== 'credit' && a.type !== 'loan' && a.type !== 'uncategorized',
  );
  const reachedGoals = list.filter((goal) => goal.accountBalance !== null && goal.accountBalance >= goal.target);
  const activeGoals = list.filter((goal) => goal.accountBalance === null || goal.accountBalance < goal.target);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold fg-primary">Save up</h1>
        <button
          onClick={() => setCreatingNew(true)}
          data-onboarding-target="saveup-new-goal"
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

      {list.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-default bg-canvas-subtle px-4 py-3">
          <div className={clsx(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            reachedGoals.length > 0
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
              : 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
          )}>
            {reachedGoals.length > 0 ? <Sparkles className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
          </div>
          <div>
            <div className="text-sm font-semibold fg-primary">
              {reachedGoals.length} of {list.length} {list.length === 1 ? 'goal' : 'goals'} reached
            </div>
            <div className="text-xs fg-muted">
              {reachedGoals.length === list.length
                ? 'Every goal is funded. Nice work.'
                : reachedGoals.length > 0
                  ? `${list.length - reachedGoals.length} still in progress.`
                  : 'Every contribution moves you closer.'}
            </div>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <div className="card text-sm fg-muted text-center">
          <PiggyBank className="h-5 w-5 inline mr-1 fg-muted" />
          No goals yet. Click <span className="font-semibold">New goal</span> to save up for something.
        </div>
      ) : (
        <div className="space-y-6">
          {activeGoals.length > 0 && (
            <GoalGroup
              title={reachedGoals.length > 0 ? 'In progress' : undefined}
              goals={activeGoals}
              allGoals={list}
              onOpen={setOpenGoalId}
            />
          )}
          {reachedGoals.length > 0 && (
            <GoalGroup
              title="Reached"
              goals={reachedGoals}
              allGoals={list}
              onOpen={setOpenGoalId}
            />
          )}
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
            goals={list}
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
          goals={list}
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

function GoalGroup({
  title,
  goals,
  allGoals,
  onOpen,
}: {
  title?: string;
  goals: Goal[];
  allGoals: Goal[];
  onOpen: (id: string) => void;
}) {
  return (
    <section>
      {title && <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide fg-muted">{title}</h2>}
      <div className="grid gap-3 md:grid-cols-2">
        {goals.map((goal, index) => (
          <GoalCard
            key={goal.id}
            goal={goal}
            index={index}
            sharesAccount={allGoals.some((other) => other.id !== goal.id && other.accountId === goal.accountId)}
            onOpen={() => onOpen(goal.id)}
          />
        ))}
      </div>
    </section>
  );
}

function GoalCard({
  goal,
  index,
  sharesAccount,
  onOpen,
}: {
  goal: Goal;
  index: number;
  sharesAccount: boolean;
  onOpen: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const balance = goal.accountBalance;
  const hasAccount = balance !== null;
  const current = balance ?? 0;
  const rawPct = hasAccount ? (Math.max(0, current) / goal.target) * 100 : 0;
  const pct = Math.min(100, rawPct);
  const reached = hasAccount && current >= goal.target;
  const remaining = Math.max(0, goal.target - current);
  const gained = hasAccount ? current - goal.startingValue : 0;
  const nextMilestone = MILESTONES.find((milestone) => milestone > pct);
  const milestoneAmount = nextMilestone
    ? Math.max(0, (goal.target * nextMilestone) / 100 - current)
    : 0;
  const [celebrate, setCelebrate] = useState(false);

  useEffect(() => {
    if (!reached || reduceMotion) return;
    const key = `cura.goal-celebrated.${goal.id}.${goal.target}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, 'true');
    } catch {
      // Storage can be unavailable in locked-down browser contexts. The
      // celebration remains harmless if it repeats in those environments.
    }
    setCelebrate(true);
    const timer = window.setTimeout(() => setCelebrate(false), 1400);
    return () => window.clearTimeout(timer);
  }, [goal.id, goal.target, reached, reduceMotion]);

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: celebrate ? [1, 1.015, 1] : 1,
      }}
      transition={{
        opacity: { duration: 0.2, delay: index * 0.05 },
        y: { duration: 0.25, delay: index * 0.05 },
        scale: { duration: 0.55, ease: 'easeOut' },
      }}
      className={clsx(
        'group card w-full text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900',
        reached ? 'card-goal-reached' : 'card-goal-active',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {reached ? (
              <motion.span
                initial={celebrate ? { scale: 0.5, rotate: -12 } : false}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 16, delay: 0.35 }}
              >
                <Trophy className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              </motion.span>
            ) : (
              <Target className="h-4 w-4 shrink-0 text-amber-500" />
            )}
            <div className="font-semibold fg-primary truncate">{goal.name}</div>
            {reached && (
              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                Goal reached
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1 text-xs fg-muted">
            <Wallet className="h-3 w-3" />
            {goal.accountName ?? (
              <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
                <Link2Off className="h-3 w-3" /> Account removed
              </span>
            )}
            {sharesAccount && goal.accountId && (
              <span title="This account's full balance counts toward more than one goal">· Shared account</span>
            )}
          </div>
        </div>
        <Pencil className="h-3.5 w-3.5 shrink-0 text-slate-500 transition-colors group-hover:text-amber-700 dark:text-slate-400 dark:group-hover:text-amber-300" />
      </div>

      <div className="mt-4 flex items-end justify-between gap-3 tabular-nums">
        <div>
          <div className={clsx('text-sm font-bold', reached ? 'text-emerald-600 dark:text-emerald-300' : 'fg-primary')}>
            {goalStatusLabel(pct, reached)}
          </div>
          <div className="text-lg font-bold fg-primary">{formatMoney(current)}</div>
        </div>
        <div className="text-right">
          <AnimatedPercentage value={pct} reached={reached} />
          <div className="text-xs fg-muted">of {formatMoney(goal.target)}</div>
        </div>
      </div>

      {hasAccount ? (
        <GoalXpBar value={pct} reached={reached} celebrate={celebrate} />
      ) : (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400">
          <Link2Off className="h-3.5 w-3.5" /> Pick an account to track this goal.
        </div>
      )}

      {hasAccount && (
        <div className="mt-3 flex items-start justify-between gap-3 text-xs tabular-nums">
          <div className={reached ? 'font-medium text-emerald-600 dark:text-emerald-300' : 'fg-secondary'}>
            {reached
              ? current > goal.target
                ? `${formatMoney(current - goal.target)} ahead of goal`
                : 'You fully funded this goal'
              : `${formatMoney(remaining)} to go`}
          </div>
          <div className="text-right fg-muted">
            {gained > 0
              ? `+${formatMoney(gained)} since your start`
              : gained < 0
                ? `${formatMoney(Math.abs(gained))} below your start`
                : nextMilestone
                  ? `${formatMoney(milestoneAmount)} to ${nextMilestone}%`
                  : null}
          </div>
        </div>
      )}
    </motion.button>
  );
}

function goalStatusLabel(pct: number, reached: boolean): string {
  if (reached) return 'You made it!';
  if (pct >= 90) return 'So close!';
  if (pct >= 75) return 'Home stretch!';
  if (pct >= 50) return 'Halfway there!';
  if (pct >= 25) return 'Great start!';
  if (pct > 0) return "You're on your way!";
  return 'Ready when you are!';
}

function AnimatedPercentage({ value, reached }: { value: number; reached: boolean }) {
  const reduceMotion = useReducedMotion();
  const progress = useMotionValue(0);
  const spring = useSpring(progress, { stiffness: 70, damping: 18 });
  const label = useTransform(spring, (latest) => `${Math.round(latest)}%`);

  useEffect(() => {
    if (!reduceMotion) progress.set(value);
  }, [progress, reduceMotion, value]);

  return reduceMotion ? (
    <div className={clsx('text-lg font-bold', progressTextClass(value, reached))}>
      {Math.round(value)}%
    </div>
  ) : (
    <motion.div className={clsx('text-lg font-bold', progressTextClass(value, reached))}>
      {label}
    </motion.div>
  );
}

function progressTextClass(value: number, reached: boolean): string {
  if (reached || value >= 75) return 'text-emerald-600 dark:text-emerald-300';
  if (value >= 50) return 'text-amber-700 dark:text-amber-300';
  if (value >= 25) return 'text-sky-700 dark:text-sky-300';
  return 'text-violet-600';
}

function GoalXpBar({
  value,
  reached,
  celebrate,
}: {
  value: number;
  reached: boolean;
  celebrate: boolean;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="mt-3">
      <div
        className="relative h-3 rounded-full bg-slate-200 dark:bg-slate-700"
        role="progressbar"
        aria-label="Goal progress"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <motion.div
          className="goal-progress-gradient absolute inset-0 overflow-hidden rounded-full"
          initial={reduceMotion ? false : { clipPath: 'inset(0 100% 0 0)' }}
          animate={{ clipPath: `inset(0 ${100 - value}% 0 0)` }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          {!reduceMotion && (
            <motion.div
              key={`${Math.round(value)}-${celebrate}`}
              className="absolute inset-y-0 w-1/4 -skew-x-12 bg-white/30"
              initial={{ x: '-120%' }}
              animate={{ x: '500%' }}
              transition={{ duration: 0.75, delay: 0.55, ease: 'easeInOut' }}
            />
          )}
        </motion.div>

      </div>
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
  goals,
  accounts,
  onClose,
  onSaved,
  onDeleted,
}: {
  goal: Goal | null;
  goals: Goal[];
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
  const sharedWith = goals.filter((other) => other.id !== goal?.id && other.accountId === accountId);

  return (
    <Dialog
      aria-label={isEdit ? 'Edit goal' : 'New goal'}
      onClose={onClose}
      closeDisabled={save.isPending || del.isPending}
      contentClassName="card w-full max-w-sm"
    >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold fg-primary">
            {isEdit ? 'Edit goal' : 'New goal'}
          </h3>
          <button
            onClick={onClose}
            disabled={save.isPending || del.isPending}
            className="close-button rounded-lg p-2"
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
            <span className="text-[10px] fg-muted">The account balance when you started, used to show how much you've added since.</span>
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
            {sharedWith.length > 0 && (
              <span className="mt-2 flex items-start gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-2 text-xs text-sky-700 dark:border-sky-700 dark:bg-sky-900/20 dark:text-sky-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                This account also tracks {sharedWith.map((other) => other.name).join(', ')}. Its full balance will count toward every linked goal.
              </span>
            )}
          </label>

          {save.error && (
            <div className="text-xs text-rose-600 dark:text-rose-400">
              {(save.error as Error).message}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={save.isPending || del.isPending} className="px-3 py-2 text-sm fg-tertiary hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg disabled:opacity-50">
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
                    disabled={del.isPending}
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
    </Dialog>
  );
}
