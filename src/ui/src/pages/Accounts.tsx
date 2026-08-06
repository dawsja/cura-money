import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import { formatAccountBalance, isLiability } from '../lib/accounting';
import { Plus, Trash2, RefreshCw, ExternalLink, Wallet, Landmark, CreditCard, Banknote, PiggyBank, TrendingUp, AlertTriangle, CircleHelp, EyeOff, Eye, Pencil, X } from 'lucide-react';
import clsx from 'clsx';

type EditableAccountType = 'checking' | 'savings' | 'credit' | 'investment' | 'loan';
type AccountType = EditableAccountType | 'uncategorized';

interface Account { id: string; name: string; type: AccountType; balance: number; institution?: string; interestRate?: number; minPayment?: number; plannedPayment?: number; includeInPaydown?: boolean; hidden?: boolean; alias?: string; }
interface SfStatus { connected: boolean; lastSync?: string | null; lastAttempt?: string | null; lastError?: string | null; }
interface SfClaim { setupToken: string; }

const INPUT_CLS = 'rounded-lg border border-default bg-surface fg-primary placeholder-slate-400 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none';

const TYPE_META: Record<AccountType, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  checking: { label: 'Checking', icon: Landmark, color: 'text-sky-600 bg-sky-50 dark:text-sky-300 dark:bg-sky-900/30' },
  savings: { label: 'Savings', icon: PiggyBank, color: 'text-emerald-600 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-900/30' },
  credit: { label: 'Credit', icon: CreditCard, color: 'text-rose-600 bg-rose-50 dark:text-rose-300 dark:bg-rose-900/30' },
  investment: { label: 'Investment', icon: TrendingUp, color: 'text-violet-600 bg-violet-50 dark:text-violet-300 dark:bg-violet-900/30' },
  loan: { label: 'Loan', icon: Banknote, color: 'text-amber-600 bg-amber-50 dark:text-amber-300 dark:bg-amber-900/30' },
  uncategorized: { label: 'Uncategorized', icon: CircleHelp, color: 'fg-secondary bg-canvas-subtle' },
};

const EDITABLE_ACCOUNT_TYPES: EditableAccountType[] = ['checking', 'savings', 'credit', 'investment', 'loan'];

const FINANCIAL_QUERY_KEYS = [
  'accounts',
  'transactions',
  'reviews',
  'dashboard',
  'budget',
  'reports',
  'paydown',
  'goals',
  'recurring',
  'notifications',
  'simplefin',
] as const;

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
  const [type, setType] = useState<EditableAccountType>('checking');
  const [balance, setBalance] = useState('0');
  const [institution, setInstitution] = useState('');

  const [sfToken, setSfToken] = useState('');
  const [sfBusy, setSfBusy] = useState(false);
  const [sfErr, setSfErr] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // The "Show hidden" toggle. Off by default — hidden accounts shouldn't
  // be visible clutter, but the user needs a path back to un-hide.
  const [showHidden, setShowHidden] = useState(false);

  // Account currently open in the edit modal (alias + type).
  const [editing, setEditing] = useState<Account | null>(null);

  const invalidateFinancialData = () => {
    FINANCIAL_QUERY_KEYS.forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
  };

  const add = useMutation({
    mutationFn: (input: Omit<Account, 'id' | 'hidden'>) => api.post<Account>('/api/accounts', input),
    onSuccess: () => {
      invalidateFinancialData();
      setName('');
      setBalance('0');
      setInstitution('');
    },
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/api/accounts/${id}`),
    onSuccess: invalidateFinancialData,
  });
  const hide = useMutation({
    mutationFn: (id: string) => api.post(`/api/accounts/${id}/hide`),
    onSuccess: invalidateFinancialData,
  });
  const unhide = useMutation({
    mutationFn: (id: string) => api.post(`/api/accounts/${id}/unhide`),
    onSuccess: invalidateFinancialData,
  });
  // Alias + type: both are user-owned overrides. SimpleFIN sync never
  // overwrites either on conflict, so the choices survive every re-sync.
  const editAccount = useMutation({
    mutationFn: (input: { id: string; alias: string | null; type: EditableAccountType; balance: number }) =>
      api.patch(`/api/accounts/${input.id}`, { alias: input.alias, type: input.type, balance: input.balance }),
    onSuccess: () => {
      invalidateFinancialData();
      setEditing(null);
    },
  });
  const sync = useMutation({
    mutationFn: () =>
      api.post<{ accountsSynced: number; transactionsSynced: number; errors: string[] }>(
        '/api/simplefin/sync',
        {},
      ),
    onSuccess: invalidateFinancialData,
  });
  const claim = useMutation({
    mutationFn: (body: SfClaim) => api.post('/api/simplefin/claim', body),
  });
  const disconnect = useMutation({
    mutationFn: () => api.delete('/api/simplefin/disconnect'),
    onSuccess: () => {
      setConfirmDisconnect(false);
      qc.invalidateQueries({ queryKey: ['simplefin'] });
    },
  });

  const onAdd = (e: React.FormEvent) => {
    e.preventDefault();
    add.mutate({
      name,
      type,
      balance: Math.abs(Number(balance) || 0),
      institution: institution || undefined,
    });
  };

  const onClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setSfErr(null);
    claim.reset();
    setSfBusy(true);
    try {
      await claim.mutateAsync({ setupToken: sfToken });
      setSfToken('');
      await qc.invalidateQueries({ queryKey: ['simplefin'] });
      try {
        await sync.mutateAsync();
      } catch (syncError) {
        setSfErr(`Connected, but the initial sync failed: ${(syncError as Error).message}`);
      }
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

  const renderRow = (a: Account, opts?: { dimmed?: boolean; extraMeta?: React.ReactNode }) => {
    const { text: balanceText, colorClass: balanceColor } = formatAccountBalance(a, (n) => formatMoney(n));
    // The display name is the user-set alias when present, otherwise
    // the canonical name (e.g. SimpleFIN's "CHASE CHECKING ...").
    const displayName = a.alias || a.name;
    return (
      <li
        key={a.id}
        className={clsx(
          'flex flex-col items-stretch justify-between gap-2 py-3 sm:flex-row sm:items-start sm:gap-4',
          opts?.dimmed && 'opacity-60 py-2',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="font-medium text-sm fg-primary truncate">{displayName}</div>
              <button
                type="button"
                onClick={() => setEditing(a)}
                data-onboarding-target={a.type === 'uncategorized' ? 'unclassified-account-edit' : undefined}
               className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg fg-muted hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-amber-600 dark:hover:text-amber-400 sm:h-7 sm:w-7"
              title="Edit account"
              aria-label={`Edit ${displayName}`}
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
          <div className="text-xs fg-muted">
            {a.alias ? (
              <span className="italic" title="Canonical name from your bank / SimpleFIN">({a.name})</span>
            ) : (
              a.institution ?? 'No institution'
            )}
            {isLiability(a.type) && a.interestRate != null && a.interestRate > 0 && (
              <> · {(a.interestRate * 100).toFixed(2)}% APR</>
            )}
            {isLiability(a.type) && <span className="ml-1 text-rose-500 dark:text-rose-400">· owed</span>}
            {opts?.extraMeta}
          </div>
        </div>
        <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-start">
          <div className={clsx('font-semibold tabular-nums mr-2', opts?.dimmed && 'text-sm', balanceColor)}>{balanceText}</div>
          {opts?.dimmed ? (
            <button
              onClick={() => unhide.mutate(a.id)}
              className="flex h-11 w-11 items-center justify-center rounded-lg fg-tertiary hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 sm:h-8 sm:w-8"
              title="Unhide account"
              aria-label="Unhide"
            >
              <Eye className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={() => {
                if (confirm(`Hide "${displayName}"? It will be removed from the accounts list, dashboard, transactions, and budget. The next SimpleFIN sync will skip it. You can un-hide from the "Show hidden" section below.`))
                  hide.mutate(a.id);
              }}
              className="flex h-11 w-11 items-center justify-center rounded-lg fg-tertiary hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30 sm:h-8 sm:w-8"
              title="Hide account"
              aria-label="Hide"
            >
              <EyeOff className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => {
              if (confirm(`Delete account "${displayName}"?`)) del.mutate(a.id);
            }}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 sm:h-8 sm:w-8"
            title="Delete account"
            aria-label="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold fg-primary">Accounts</h1>
        <button
          onClick={() => sync.mutate()}
          disabled={sync.isPending || !sf.data?.connected}
          className="rounded-lg border border-default px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 fg-secondary flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={'h-4 w-4' + (sync.isPending ? ' animate-spin' : '')} />
          {sync.isPending ? 'Syncing…' : 'Sync'}
        </button>
      </div>

      <div className="space-y-6">
      <section data-onboarding-target="simplefin-connect" className="card">
        <h2 className="text-lg font-semibold mb-3 fg-primary">SimpleFIN</h2>
        {sf.isPending ? (
          <p className="text-sm fg-muted flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" /> Checking connection…
          </p>
        ) : sf.isError ? (
          <div className="space-y-3">
            <p className="text-sm text-rose-600 dark:text-rose-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" /> Could not load SimpleFIN status: {sf.error.message}
            </p>
            <button type="button" onClick={() => sf.refetch()} disabled={sf.isFetching} className="btn-primary disabled:opacity-50">
              {sf.isFetching ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        ) : sf.data.connected ? (
          <div className="text-sm fg-tertiary space-y-1">
            <p>Connected. Last sync: {sf.data.lastSync ?? 'never'}.</p>
            {sf.data.lastAttempt && sf.data.lastAttempt !== sf.data.lastSync && (
              <p className="text-xs fg-muted">Last attempt: {sf.data.lastAttempt}.</p>
            )}
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
            {(sync.error?.message || (!sync.data && sf.data.lastError)) && (
              <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0" /> {sync.error?.message ?? sf.data.lastError}
              </p>
            )}
            {!confirmDisconnect ? (
              <button
                type="button"
                onClick={() => { disconnect.reset(); setConfirmDisconnect(true); }}
                className="mt-3 rounded-lg border border-rose-500/50 px-3 py-2 text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30"
              >
                Disconnect
              </button>
            ) : (
              <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-50/50 p-3 dark:bg-rose-900/20 space-y-3">
                <div>
                  <p className="font-medium text-rose-700 dark:text-rose-300">Disconnect SimpleFIN?</p>
                  <p className="mt-1 text-xs fg-secondary">Imported accounts and transactions will remain in Cura Money. Automatic and manual SimpleFIN syncs will stop until you reconnect.</p>
                </div>
                {disconnect.error && (
                  <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" /> {disconnect.error.message}
                  </p>
                )}
                <div className="flex gap-2">
                  <button type="button" onClick={() => disconnect.mutate()} disabled={disconnect.isPending} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50">
                    {disconnect.isPending ? 'Disconnecting…' : 'Yes, disconnect'}
                  </button>
                  <button type="button" onClick={() => setConfirmDisconnect(false)} disabled={disconnect.isPending} className="rounded-lg border border-default px-3 py-2 text-sm fg-secondary hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={onClaim} className="space-y-2">
            <p className="text-sm fg-tertiary flex items-center gap-1">
              Connect or reconnect via SimpleFIN setup token
              <a
                href="https://bridge.simplefin.org/simplefin/create"
                target="_blank"
                rel="noreferrer"
                aria-label="Get a SimpleFIN setup token"
                title="Get a SimpleFIN setup token"
                className="inline-flex h-11 w-11 items-center justify-center text-inherit visited:text-inherit hover:text-inherit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-lg"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            </p>
            <input
              value={sfToken}
              onChange={(e) => setSfToken(e.target.value)}
              placeholder="Paste SimpleFIN setup token"
              className={`${INPUT_CLS} w-full font-mono`}
            />
            {sfErr && <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {sfErr}</p>}
            <button type="submit" className="btn-primary" disabled={sfBusy}>
              {sfBusy ? (claim.isSuccess ? 'Running initial sync…' : 'Connecting…') : 'Connect'}
            </button>
          </form>
        )}
      </section>

      <section data-onboarding-target="manual-account-add" className="card">
        <h2 className="text-lg font-semibold mb-3 fg-primary">Add account</h2>
        <p className="mb-3 text-xs fg-muted">Balances are entered and displayed in USD only. Enter a positive amount; account type determines whether it is an asset or amount owed.</p>
        <form onSubmit={onAdd} className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={INPUT_CLS} required />
            <select value={type} onChange={(e) => setType(e.target.value as EditableAccountType)} className={INPUT_CLS}>
              {EDITABLE_ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_META[t].label}</option>
              ))}
            </select>
            <input value={balance} onChange={(e) => setBalance(e.target.value)} type="number" min="0" step="0.01" placeholder={isLiability(type) ? 'Amount owed (USD)' : 'Balance (USD)'} className={INPUT_CLS} />
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
      </div>

      <section className="space-y-3">
        {accounts.isPending && (
          <div className="card text-sm fg-muted text-center">
            <RefreshCw className="h-4 w-4 inline mr-2 animate-spin" /> Loading accounts…
          </div>
        )}
        {accounts.isError && (
          <div className="card text-center space-y-3">
            <p className="text-sm text-rose-600 dark:text-rose-400 flex items-center justify-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" /> Could not load accounts: {accounts.error.message}
            </p>
            <button type="button" onClick={() => accounts.refetch()} disabled={accounts.isFetching} className="btn-primary disabled:opacity-50">
              {accounts.isFetching ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        )}
        {!accounts.isPending && !accounts.isError && (['uncategorized', ...EDITABLE_ACCOUNT_TYPES] as AccountType[]).map((t) => {
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
              {t === 'uncategorized' && (
                <p className="mb-2 text-xs fg-muted">Choose an account type with the pencil so balances are counted correctly.</p>
              )}
              <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                {list.map((a) => renderRow(a))}
              </ul>
            </div>
          );
        })}
        {!accounts.isPending && !accounts.isError && visible.length === 0 && (
          <div className="card text-sm fg-muted text-center">
            <Wallet className="h-5 w-5 inline mr-1 fg-muted" /> No accounts yet. Add one above or connect SimpleFIN to auto-import.
          </div>
        )}

        {/* Hidden section. Off by default — the user has to opt in to
            see them. From here they can un-hide to bring the account
            (and its future sync data) back. */}
        {!accounts.isPending && !accounts.isError && hidden.length > 0 && (
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
                {hidden.map((a) => renderRow(a, {
                  dimmed: true,
                  extraMeta: <span> · hidden</span>,
                }))}
              </ul>
            )}
          </div>
        )}
      </section>

      {editing && (
        <EditAccountModal
          account={editing}
          isSaving={editAccount.isPending}
          error={editAccount.error?.message ?? null}
          onClose={() => {
            if (!editAccount.isPending) {
              editAccount.reset();
              setEditing(null);
            }
          }}
          onSave={(patch) => editAccount.mutate({ id: editing.id, ...patch })}
        />
      )}
    </div>
  );
}

/**
 * Edit account modal — alias, type, and positive balance magnitude.
 * Alias and type are user-owned overrides that SimpleFIN sync leaves alone.
 * Empty alias clears back to the canonical bank name.
 */
function EditAccountModal({
  account,
  isSaving,
  error,
  onClose,
  onSave,
}: {
  account: Account;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (patch: { alias: string | null; type: EditableAccountType; balance: number }) => void;
}) {
  const [alias, setAlias] = useState(account.alias ?? '');
  const [type, setType] = useState<AccountType>(account.type);
  const [balance, setBalance] = useState(String(Math.abs(account.balance)));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isSaving, onClose]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedBalance = Number(balance);
    if (isSaving || type === 'uncategorized' || !Number.isFinite(parsedBalance) || parsedBalance < 0) return;
    const trimmed = alias.trim();
    onSave({
      alias: trimmed === '' ? null : trimmed,
      type: type as EditableAccountType,
      balance: parsedBalance,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-account-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => { if (!isSaving) onClose(); }}
    >
      <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 id="edit-account-title" className="text-lg font-semibold fg-primary">
            Edit account
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="fg-muted hover:fg-secondary disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs fg-muted mb-4">
          Bank name: <span className="fg-secondary font-medium">{account.name}</span>
          {account.institution ? <> · {account.institution}</> : null}
        </p>

        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="text-sm fg-secondary">Display name</span>
            <input
              ref={inputRef}
              type="text"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              maxLength={120}
              placeholder={account.name}
              disabled={isSaving}
              className={`mt-1 w-full ${INPUT_CLS}`}
            />
            <span className="mt-1 block text-[10px] fg-muted">
              Leave blank to use the bank name. Survives SimpleFIN sync.
            </span>
          </label>

          <label className="block">
            <span className="text-sm fg-secondary">{isLiability(type) ? 'Amount owed' : 'Balance'} (USD)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              disabled={isSaving}
              required
              className={`mt-1 w-full ${INPUT_CLS}`}
            />
            <span className="mt-1 block text-[10px] fg-muted">
              Cura Money supports USD only. Enter a positive amount; the account type determines its net-worth sign.
            </span>
          </label>

          <label className="block">
            <span className="text-sm fg-secondary">Account type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as AccountType)}
              disabled={isSaving}
              required
              className={`mt-1 w-full ${INPUT_CLS}`}
            >
              {type === 'uncategorized' && <option value="uncategorized" disabled>Select account type</option>}
              {EDITABLE_ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_META[t].label}</option>
              ))}
            </select>
            <span className="mt-1 block text-[10px] fg-muted">
              {type === 'investment'
                ? 'Investment is balance-only: value stays on Accounts/Dashboard for growth; no transactions are imported or shown.'
                : 'Affects net worth sign and paydown. Survives SimpleFIN sync.'}
            </span>
          </label>

          {error && (
            <p className="text-sm text-rose-600 dark:text-rose-400 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-lg border border-default px-3 py-2 text-sm fg-secondary hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || type === 'uncategorized' || balance === '' || Number(balance) < 0}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
