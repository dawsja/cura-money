import { useEffect, useState, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import { formatAccountBalance, isLiability, netWorthContribution } from '../lib/accounting';
import { Plus, Trash2, RefreshCw, ExternalLink, Wallet, Landmark, CreditCard, Banknote, PiggyBank, TrendingUp, AlertTriangle, CircleHelp, EyeOff, Eye, Pencil, X, EllipsisVertical, ChevronDown, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { Dialog } from '../components/ui/dialog';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { SummaryCard } from '../components/SummaryCard';

type EditableAccountType = 'checking' | 'savings' | 'credit' | 'investment' | 'loan';
type AccountType = EditableAccountType | 'uncategorized';

interface Account { id: string; source: 'manual' | 'simplefin'; name: string; type: AccountType; balance: number; institution?: string; interestRate?: number; minPayment?: number; plannedPayment?: number; includeInPaydown?: boolean; hidden?: boolean; alias?: string; }
interface SfStatus { demoMode: boolean; connected: boolean; lastSync?: string | null; lastAttempt?: string | null; lastError?: string | null; }
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
  const [confirmation, setConfirmation] = useState<{ action: 'hide' | 'delete'; account: Account } | null>(null);

  const invalidateFinancialData = () => {
    FINANCIAL_QUERY_KEYS.forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
  };

  const add = useMutation({
    mutationFn: (input: Omit<Account, 'id' | 'source' | 'hidden'>) => api.post<Account>('/api/accounts', input),
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
      api.post<{
        accountsSynced: number;
        transactionsSynced: number;
        transactionsReconciled: number;
        reconciliationAmbiguous: number;
        stalePendingTransactions: number;
        errors: string[];
      }>(
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
  const visibleAssets = visible.reduce(
    (sum, account) => !isLiability(account.type) && account.type !== 'uncategorized' ? sum + Math.abs(account.balance) : sum,
    0,
  );
  const visibleDebt = visible.reduce(
    (sum, account) => isLiability(account.type) ? sum + Math.abs(account.balance) : sum,
    0,
  );
  const visibleNet = visible.reduce((sum, account) => sum + netWorthContribution(account), 0);
  const accountOperationError = unhide.error;

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
            {a.source === 'simplefin' && (
              <span className="shrink-0 rounded-full border border-default bg-canvas-subtle px-1.5 py-0.5 text-[10px] font-medium fg-muted">
                SimpleFIN
              </span>
            )}
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
          <details name="account-actions" className="relative">
            <summary
              data-onboarding-target={a.type === 'uncategorized' ? 'unclassified-account-edit' : undefined}
              className="close-button flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-lg [&::-webkit-details-marker]:hidden"
              aria-label={`Actions for ${displayName}`}
            >
              <EllipsisVertical className="h-5 w-5" aria-hidden="true" />
            </summary>
            <div className="absolute right-0 z-20 mt-1 min-w-44 rounded-lg border border-default bg-surface p-1 shadow-xl">
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open');
                  setEditing(a);
                }}
                className="close-button flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm"
              >
                <Pencil className="h-4 w-4" aria-hidden="true" /> Edit account
              </button>
              {opts?.dimmed ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest('details')?.removeAttribute('open');
                    unhide.mutate(a.id);
                  }}
                  disabled={unhide.isPending}
                  className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
                >
                  <Eye className="h-4 w-4" aria-hidden="true" /> Unhide account
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest('details')?.removeAttribute('open');
                    hide.reset();
                    setConfirmation({ action: 'hide', account: a });
                  }}
                  className="close-button flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm"
                >
                  <EyeOff className="h-4 w-4" aria-hidden="true" /> Hide account
                </button>
              )}
              {a.source === 'manual' && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest('details')?.removeAttribute('open');
                    del.reset();
                    setConfirmation({ action: 'delete', account: a });
                  }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete account
                </button>
              )}
            </div>
          </details>
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold fg-primary">Accounts</h1>
        {!sf.data?.demoMode && (
          <button
            onClick={() => sync.mutate()}
            disabled={sync.isPending || !sf.data?.connected}
            className="rounded-lg border border-default px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 fg-secondary flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={'h-4 w-4' + (sync.isPending ? ' animate-spin' : '')} />
            {sync.isPending ? 'Syncing…' : 'Sync'}
          </button>
        )}
      </div>
      {accountOperationError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-300" role="alert">
          Account operation failed: {accountOperationError.message}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold fg-primary">Your accounts</h2>
            {!accounts.isPending && !accounts.isError && (
              <p className="text-xs fg-tertiary">{visible.length} visible {visible.length === 1 ? 'account' : 'accounts'}</p>
            )}
          </div>
        </div>
        {!accounts.isPending && !accounts.isError && visible.length > 0 && (
          <div className="summary-scroll grid grid-cols-3 gap-3">
            <SummaryCard label="Assets" value={formatMoney(visibleAssets)} tone="slate" />
            <SummaryCard label="Amount owed" value={formatMoney(visibleDebt)} tone="rose" />
            <SummaryCard
              label="Net balance"
              value={visibleNet < 0 ? `−${formatMoney(Math.abs(visibleNet))}` : formatMoney(visibleNet)}
              tone={visibleNet < 0 ? 'rose' : 'slate'}
            />
          </div>
        )}
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
          const typeTotal = list.reduce((sum, account) => sum + Math.abs(account.balance), 0);
          return (
            <div key={t} className="card">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', meta.color)}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <h3 className="truncate text-sm font-semibold fg-primary">{meta.label}</h3>
                  <span className="shrink-0 text-xs fg-muted">· {list.length}</span>
                </div>
                <div className={clsx(
                  'shrink-0 text-right text-sm font-semibold tabular-nums',
                  t === 'uncategorized'
                    ? 'fg-muted'
                    : isLiability(t)
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'fg-primary',
                )}>
                  {formatMoney(typeTotal)}
                  {t === 'uncategorized' && <span className="ml-1 text-[10px] font-normal">not counted</span>}
                  {isLiability(t) && <span className="ml-1 text-[10px] font-normal fg-muted">owed</span>}
                </div>
              </div>
              {t === 'uncategorized' && (
                <p className="mb-2 text-xs fg-muted">Use the account menu to choose a type so balances are counted correctly.</p>
              )}
              <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                {list.map((a) => renderRow(a))}
              </ul>
            </div>
          );
        })}
        {!accounts.isPending && !accounts.isError && visible.length === 0 && (
          <div className="card text-sm fg-muted text-center">
            <Wallet className="h-5 w-5 inline mr-1 fg-muted" /> No accounts yet. Add one below or connect SimpleFIN to auto-import.
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
              aria-expanded={showHidden}
              className="w-full flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-2">
                <EyeOff className="h-4 w-4 fg-muted" />
                <span className="text-sm font-semibold fg-secondary">
                  {showHidden ? 'Hide' : 'Show'} hidden accounts
                </span>
                <span className="text-xs fg-muted">· {hidden.length}</span>
              </div>
              {showHidden
                ? <ChevronDown className="h-4 w-4 fg-muted" aria-hidden="true" />
                : <ChevronRight className="h-4 w-4 fg-muted" aria-hidden="true" />}
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

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold fg-primary">Add or connect an account</h2>
          <p className="text-xs fg-tertiary">Connect SimpleFIN for automatic imports or add a balance manually.</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
          <section data-onboarding-target="simplefin-connect" className="card">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold fg-primary">SimpleFIN</h3>
              {!sf.isPending && !sf.isError && (
                <span className={clsx(
                  'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                  sf.data.demoMode
                    ? 'bg-canvas-subtle fg-muted'
                    : sf.data.connected
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
                )}>
                  {sf.data.demoMode ? 'Demo' : sf.data.connected ? 'Connected' : 'Not connected'}
                </span>
              )}
            </div>
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
        ) : sf.data.demoMode ? (
          <p className="text-sm fg-secondary">
            Bank connections are disabled in the public demo. The accounts below use sample data.
          </p>
        ) : sf.data.connected ? (
          <div className="text-sm fg-tertiary space-y-1">
            <p>Connected. Last sync: {sf.data.lastSync ?? 'never'}.</p>
            {sf.data.lastAttempt && sf.data.lastAttempt !== sf.data.lastSync && (
              <p className="text-xs fg-muted">Last attempt: {sf.data.lastAttempt}.</p>
            )}
            {sync.data && (
              <p className="text-xs fg-muted">
                Synced {sync.data.accountsSynced} account(s), {sync.data.transactionsSynced} transaction(s).
                {sync.data.transactionsReconciled > 0 && ` Reconciled ${sync.data.transactionsReconciled} pending charge(s).`}
              </p>
            )}
            {sync.data && sync.data.reconciliationAmbiguous > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {sync.data.reconciliationAmbiguous} pending charge(s) need manual duplicate review.
              </p>
            )}
            {sync.data && sync.data.stalePendingTransactions > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {sync.data.stalePendingTransactions} pending charge(s) have not been seen for at least 7 days.
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
        <h3 className="text-base font-semibold mb-3 fg-primary">Manual account</h3>
        <p className="mb-3 text-xs fg-muted">Balances are entered and displayed in USD only. Enter a positive amount; account type determines whether it is an asset or amount owed.</p>
        <form onSubmit={onAdd} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
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
      {confirmation?.action === 'hide' && (
        <ConfirmDialog
          title={`Hide “${confirmation.account.alias || confirmation.account.name}”?`}
          confirmLabel="Hide account"
          onConfirm={() => hide.mutateAsync(confirmation.account.id)}
          onClose={() => setConfirmation(null)}
        >
          <p>This account and its activity will be excluded from Home, Transactions, Budget, Paydown, Reports, and the main account list.</p>
          <p>It will remain available in the hidden accounts section, and sync will pause until you unhide it.</p>
        </ConfirmDialog>
      )}
      {confirmation?.action === 'delete' && (
        <ConfirmDialog
          title={`Delete “${confirmation.account.alias || confirmation.account.name}”?`}
          confirmLabel="Delete account"
          destructive
          onConfirm={() => del.mutateAsync(confirmation.account.id)}
          onClose={() => setConfirmation(null)}
        >
          <p>This permanently removes the account balance and detaches any savings goals linked to the account.</p>
          <p>Account-specific paydown rows will also be removed.</p>
          <p>If its name uniquely matches a Pay down category, that category, its budget entries, and its categorization rules will also be removed.</p>
          <p>Historical transactions are retained and remain visible in your ledger and reports.</p>
        </ConfirmDialog>
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
    inputRef.current?.select();
  }, []);

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
    <Dialog
      aria-labelledby="edit-account-title"
      onClose={onClose}
      closeDisabled={isSaving}
      initialFocusRef={inputRef}
      contentClassName="card w-full max-w-sm"
    >
        <div className="flex items-center justify-between mb-3">
          <h3 id="edit-account-title" className="text-lg font-semibold fg-primary">
            Edit account
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="close-button rounded-lg p-2 disabled:opacity-50"
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
                ? 'Investment is balance-only: value stays on Accounts/Home for growth; no transactions are imported or shown.'
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
    </Dialog>
  );
}
