import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import { formatAccountBalance, isLiability } from '../lib/accounting';
import { Plus, Trash2, RefreshCw, Link2, Wallet, Landmark, CreditCard, Banknote, PiggyBank, TrendingUp, AlertTriangle, EyeOff, Eye, Pencil } from 'lucide-react';
import clsx from 'clsx';

type AccountType = 'checking' | 'savings' | 'credit' | 'investment' | 'loan';

interface Account { id: string; name: string; type: AccountType; balance: number; institution?: string; interestRate?: number; minPayment?: number; plannedPayment?: number; includeInPaydown?: boolean; hidden?: boolean; alias?: string; }
interface SfStatus { connected: boolean; lastSync?: string | null; enabledAccountIds: string[] | null; }
interface SfClaim { setupToken: string; }

const INPUT_CLS = 'rounded-lg border border-default bg-surface fg-primary placeholder-slate-400 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none';

const TYPE_META: Record<AccountType, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  checking: { label: 'Checking', icon: Landmark, color: 'text-sky-600 bg-sky-50 dark:text-sky-300 dark:bg-sky-900/30' },
  savings: { label: 'Savings', icon: PiggyBank, color: 'text-emerald-600 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-900/30' },
  credit: { label: 'Credit', icon: CreditCard, color: 'text-rose-600 bg-rose-50 dark:text-rose-300 dark:bg-rose-900/30' },
  investment: { label: 'Investment', icon: TrendingUp, color: 'text-violet-600 bg-violet-50 dark:text-violet-300 dark:bg-violet-900/30' },
  loan: { label: 'Loan', icon: Banknote, color: 'text-amber-600 bg-amber-50 dark:text-amber-300 dark:bg-amber-900/30' },
};

export function Accounts() {
  const qc = useQueryClient();
  // Always fetch with `includeHidden=true` so the user can toggle the
  // "Show hidden" section and un-hide from the same page. The server
  // marks each row with `hidden: boolean`; we filter client-side.
  const accounts = useQuery({
    queryKey: ['accounts', 'all'],
    queryFn: () => api.get<Account[]>('/api/accounts?includeHidden=true'),
  });
  const sf = useQuery({ queryKey: ['simplefin', 'status'], queryFn: () => api.get<SfStatus>('/api/simplefin/status') });

  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('checking');
  const [balance, setBalance] = useState('0');
  const [institution, setInstitution] = useState('');

  const [sfToken, setSfToken] = useState('');
  const [sfBusy, setSfBusy] = useState(false);
  const [sfErr, setSfErr] = useState<string | null>(null);

  // The "Show hidden" toggle. Off by default — hidden accounts shouldn't
  // be visible clutter, but the user needs a path back to un-hide.
  const [showHidden, setShowHidden] = useState(false);

  // Inline alias editing: each row owns its own edit state inside the
  // InlineNameEditor component. We only need to know the row's
  // canonical name from the parent (it's the alias-fallback display
  // and the input's placeholder).

  const add = useMutation({
    mutationFn: (input: Omit<Account, 'id' | 'hidden'>) => api.post<Account>('/api/accounts', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/api/accounts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
  const hide = useMutation({
    mutationFn: (id: string) => api.post(`/api/accounts/${id}/hide`),
    // Invalidate everything that depends on accounts: dashboard net
    // worth, transactions list, paydown, simplefin (so the next sync
    // visibly reflects the change).
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['simplefin'] });
    },
  });
  const unhide = useMutation({
    mutationFn: (id: string) => api.post(`/api/accounts/${id}/unhide`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
  // Alias: PATCH `{ alias: string | null }`. Empty string clears it
  // back to NULL (the server's editAccount maps "" → null). Any other
  // string is the new alias. SimpleFIN sync never overwrites this, so
  // the choice survives every re-sync.
  const setAlias = useMutation({
    mutationFn: (input: { id: string; alias: string | null }) =>
      api.patch(`/api/accounts/${input.id}`, { alias: input.alias }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
  const sync = useMutation({
    mutationFn: () => api.post<{ accountsSynced: number; transactionsSynced: number; errors: string[] }>('/api/simplefin/sync'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['simplefin'] });
      // Fresh SimpleFIN inserts land as `needs_review=true`. The bell
      // badge + the Transactions banner both read these keys, so
      // invalidating them makes the new count visible on the very next
      // render without waiting for the 30s polling tick.
      qc.invalidateQueries({ queryKey: ['reviews'] });
    },
  });
  const claim = useMutation({
    mutationFn: (body: SfClaim) => api.post('/api/simplefin/claim', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['simplefin'] }),
  });

  const onAdd = (e: React.FormEvent) => {
    e.preventDefault();
    add.mutate({
      name,
      type,
      balance: Number(balance) || 0,
      institution: institution || undefined,
    });
    setName(''); setBalance('0'); setInstitution('');
  };

  const onClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setSfErr(null);
    setSfBusy(true);
    try {
      await claim.mutateAsync({ setupToken: sfToken });
      setSfToken('');
    } catch (e2) {
      setSfErr((e2 as Error).message);
    } finally {
      setSfBusy(false);
    }
  };

  // Group accounts by type for the list view. Hidden accounts are split
  // out into a separate dimmed section below the main list — the user
  // can toggle them on to un-hide, and off to ignore them.
  const all = accounts.data ?? [];
  const visible = all.filter((a) => !a.hidden);
  const hidden = all.filter((a) => a.hidden);
  const byType = visible.reduce((acc, a) => {
    (acc[a.type] ??= []).push(a);
    return acc;
  }, {} as Record<AccountType, Account[]>);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold fg-primary">Accounts</h1>
        <button
          onClick={() => sync.mutate()}
          className="rounded-lg border border-default px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 fg-secondary flex items-center gap-2"
        >
          <RefreshCw className={'h-4 w-4' + (sync.isPending ? ' animate-spin' : '')} />
          {sync.isPending ? 'Syncing…' : 'Sync'}
        </button>
      </div>

      <section className="card">
        <h2 className="text-lg font-semibold mb-3 fg-primary">SimpleFIN</h2>
        {sf.data?.connected ? (
          <div className="text-sm fg-tertiary space-y-1">
            <p>Connected. Last sync: {sf.data.lastSync ?? 'never'}.</p>
            {sync.data && (
              <p className="text-xs fg-muted">
                Synced {sync.data.accountsSynced} account(s), {sync.data.transactionsSynced} transaction(s).
              </p>
            )}
            {sync.data?.errors && sync.data.errors.length > 0 && (
              <ul className="text-xs text-rose-600 dark:text-rose-400 space-y-0.5">
                {sync.data.errors.map((e, i) => <li key={i} className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {e}</li>)}
              </ul>
            )}
          </div>
        ) : (
          <form onSubmit={onClaim} className="space-y-2">
            <p className="text-sm fg-tertiary flex items-center gap-2">
              <Link2 className="h-4 w-4" /> Connect via SimpleFIN setup token (from bridge.simplefin.org)
            </p>
            <input
              value={sfToken}
              onChange={(e) => setSfToken(e.target.value)}
              placeholder="Paste SimpleFIN setup token"
              className={`${INPUT_CLS} w-full font-mono`}
            />
            {sfErr && <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {sfErr}</p>}
            <button type="submit" className="btn-primary" disabled={sfBusy}>
              {sfBusy ? 'Claiming…' : 'Connect'}
            </button>
          </form>
        )}
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold mb-3 fg-primary">Add account</h2>
        <form onSubmit={onAdd} className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={INPUT_CLS} required />
            <select value={type} onChange={(e) => setType(e.target.value as AccountType)} className={INPUT_CLS}>
              {(Object.keys(TYPE_META) as AccountType[]).map((t) => (
                <option key={t} value={t}>{TYPE_META[t].label}</option>
              ))}
            </select>
            <input value={balance} onChange={(e) => setBalance(e.target.value)} type="number" step="0.01" placeholder="Balance" className={INPUT_CLS} />
            <input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Institution (optional)" className={INPUT_CLS} />
          </div>
          {add.error && (
            <p className="text-sm text-rose-600 dark:text-rose-400 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {add.error.message}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button type="submit" disabled={add.isPending} className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
              <Plus className={'h-4 w-4' + (add.isPending ? ' animate-spin' : '')} />
              {add.isPending ? 'Adding…' : 'Add account'}
            </button>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        {(['checking', 'savings', 'credit', 'investment', 'loan'] as AccountType[]).map((t) => {
          const list = byType[t] ?? [];
          if (list.length === 0) return null;
          const meta = TYPE_META[t];
          const Icon = meta.icon;
          return (
            <div key={t} className="card">
              <div className="flex items-center gap-2 mb-3">
                <span className={clsx('h-7 w-7 rounded-lg flex items-center justify-center', meta.color)}>
                  <Icon className="h-4 w-4" />
                </span>
                <h3 className="text-sm font-semibold fg-primary">{meta.label}</h3>
                <span className="text-xs fg-muted">· {list.length}</span>
              </div>
              <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                {list.map((a) => {
                  // Display with the right sign and color. Liabilities
                  // (credit + loan) show as `−$5,000 owed` in rose so the
                  // user can't mistake debt for an asset.
                  const { text: balanceText, colorClass: balanceColor } = formatAccountBalance(a, (n) => formatMoney(n));
                  // The display name is the user-set alias when present,
                  // otherwise the canonical name (e.g. SimpleFIN's
                  // "CHASE CHECKING ..."). The alias persists across
                  // syncs because the sync helper doesn't touch it.
                  const displayName = a.alias || a.name;
                  return (
                    <li key={a.id} className="flex items-start justify-between gap-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <InlineNameEditor
                            alias={a.alias ?? null}
                            canonicalName={a.name}
                            isSaving={setAlias.isPending && setAlias.variables?.id === a.id}
                            onSave={(next) => setAlias.mutate({ id: a.id, alias: next })}
                          />
                        </div>
                        <div className="text-xs fg-muted">
                          {a.alias ? (
                            <span className="italic" title="Canonical name from your bank / SimpleFIN">({a.name})</span>
                          ) : (
                            a.institution ?? 'No institution'
                          )}
                          {isLiability(t) && a.interestRate != null && a.interestRate > 0 && (
                            <> · {(a.interestRate * 100).toFixed(2)}% APR</>
                          )}
                          {isLiability(t) && <span className="ml-1 text-rose-500 dark:text-rose-400">· owed</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className={clsx('font-semibold tabular-nums mr-2', balanceColor)}>{balanceText}</div>
                        {/* Hide: removes the account from every view AND
                            tells SimpleFIN to stop re-importing it on the
                            next sync. We use a confirm() because hiding
                            is reversible but not obvious — the user
                            might mean Delete. */}
                        <button
                          onClick={() => {
                            if (confirm(`Hide "${displayName}"? It will be removed from the accounts list, dashboard, transactions, and budget. The next SimpleFIN sync will skip it. You can un-hide from the "Show hidden" section below.`))
                              hide.mutate(a.id);
                          }}
                          className="fg-tertiary hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30 rounded p-1"
                          title="Hide account"
                          aria-label="Hide"
                        >
                          <EyeOff className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete account "${displayName}"?`)) del.mutate(a.id);
                          }}
                          className="text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded p-1"
                          title="Delete account"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="card text-sm fg-muted text-center">
            <Wallet className="h-5 w-5 inline mr-1 fg-muted" /> No accounts yet. Add one above or connect SimpleFIN to auto-import.
          </div>
        )}

        {/* Hidden section. Off by default — the user has to opt in to
            see them. From here they can un-hide to bring the account
            (and its future sync data) back. */}
        {hidden.length > 0 && (
          <div className="card">
            <button
              type="button"
              onClick={() => setShowHidden((v) => !v)}
              className="w-full flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-2">
                <EyeOff className="h-4 w-4 fg-muted" />
                <span className="text-sm font-semibold fg-secondary">
                  {showHidden ? 'Hide' : 'Show'} hidden accounts
                </span>
                <span className="text-xs fg-muted">· {hidden.length}</span>
              </div>
              <span className="text-xs fg-muted">{showHidden ? '▾' : '▸'}</span>
            </button>
            {showHidden && (
              <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-700">
                {hidden.map((a) => {
                  const { text: balanceText, colorClass: balanceColor } = formatAccountBalance(a, (n) => formatMoney(n));
                  const displayName = a.alias || a.name;
                  return (
                    <li key={a.id} className="flex items-start justify-between gap-4 py-2 opacity-60">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <InlineNameEditor
                            alias={a.alias ?? null}
                            canonicalName={a.name}
                            isSaving={setAlias.isPending && setAlias.variables?.id === a.id}
                            onSave={(next) => setAlias.mutate({ id: a.id, alias: next })}
                          />
                        </div>
                        <div className="text-xs fg-muted">
                          {a.alias ? <span className="italic">({a.name})</span> : (a.institution ?? 'No institution')} · hidden
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className={clsx('font-semibold tabular-nums mr-2 text-sm', balanceColor)}>{balanceText}</div>
<button
                            onClick={() => unhide.mutate(a.id)}
                            className="fg-tertiary hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded p-1"
                            title="Unhide account"
                            aria-label="Unhide"
                          >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete account "${displayName}"?`)) del.mutate(a.id);
                          }}
                          className="text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded p-1"
                          title="Delete account"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Inline alias editor for an account row. The display name (alias ||
 * canonical) shows as plain text with a pencil button; clicking the
 * pencil swaps the text in place for an input that grows with the
 * typed content. Blur or Enter commits; Escape cancels.
 *
 * - The edited value is always the alias (the user-set override);
 *   the canonical name is the input's placeholder so the user can
 *   see what the default is while editing.
 * - Empty on commit clears the alias (parent maps "" → null) and the
 *   row falls back to the canonical name as the display.
 * - `draft` only syncs from `alias` when not editing, so a server
 *   reconciliation (e.g. another tab saves) doesn't clobber what the
 *   user is typing.
 */
function InlineNameEditor({
  alias,
  canonicalName,
  isSaving,
  onSave,
}: {
  alias: string | null;
  canonicalName: string;
  isSaving?: boolean;
  onSave: (next: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(alias ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(alias ?? '');
  }, [alias, editing]);

  // Focus + select-all on entering edit mode so the user can start
  // typing immediately to replace the current value.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    const current = alias ?? '';
    if (trimmed === current) {
      setEditing(false);
      return;
    }
    onSave(trimmed === '' ? null : trimmed);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(alias ?? '');
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        disabled={isSaving}
        size={Math.max(draft.length, 4)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        maxLength={120}
        placeholder={canonicalName}
        className="rounded-md border border-default bg-surface fg-primary placeholder-slate-400 px-2 py-0.5 text-sm font-medium focus:border-amber-500 focus:outline-none"
      />
    );
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <div className="font-medium text-sm fg-primary truncate">{alias || canonicalName}</div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="fg-muted hover:text-amber-600 dark:hover:text-amber-400 rounded p-0.5 shrink-0"
        title={`Rename (alias for "${canonicalName}")`}
        aria-label="Edit name"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  );
}
