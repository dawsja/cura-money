import { useEffect, useState, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import { formatAccountBalance, isLiability, netWorthContribution } from '../lib/accounting';
import { Plus, Trash2, RefreshCw, ExternalLink, Wallet, Landmark, CreditCard, Banknote, PiggyBank, TrendingUp, AlertTriangle, CircleHelp, EyeOff, Eye, Pencil, EllipsisVertical, ChevronDown, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Spinner } from '../components/ui/spinner';
import { SummaryCard } from '../components/SummaryCard';

type EditableAccountType = 'checking' | 'savings' | 'credit' | 'investment' | 'loan';
type AccountType = EditableAccountType | 'uncategorized';

interface Account { id: string; source: 'manual' | 'simplefin'; name: string; type: AccountType; balance: number; institution?: string; interestRate?: number; minPayment?: number; plannedPayment?: number; includeInPaydown?: boolean; hidden?: boolean; alias?: string; }
interface SfStatus { demoMode: boolean; connected: boolean; lastSync?: string | null; lastAttempt?: string | null; lastError?: string | null; }
interface SfClaim { setupToken: string; }

const TYPE_META: Record<AccountType, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  checking: { label: 'Checking', icon: Landmark, color: 'text-sky-600 bg-sky-50 dark:text-sky-300 dark:bg-sky-900/30' },
  savings: { label: 'Savings', icon: PiggyBank, color: 'text-emerald-600 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-900/30' },
  credit: { label: 'Credit', icon: CreditCard, color: 'text-rose-600 bg-rose-50 dark:text-rose-300 dark:bg-rose-900/30' },
  investment: { label: 'Investment', icon: TrendingUp, color: 'text-violet-600 bg-violet-50 dark:text-violet-300 dark:bg-violet-900/30' },
  loan: { label: 'Loan', icon: Banknote, color: 'text-amber-600 bg-amber-50 dark:text-amber-300 dark:bg-amber-900/30' },
  uncategorized: { label: 'Uncategorized', icon: CircleHelp, color: 'text-muted-foreground bg-muted' },
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
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="truncate text-sm font-medium text-foreground">{displayName}</div>
            {a.source === 'simplefin' && (
              <Badge variant="outline">SimpleFIN</Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {a.alias ? (
              <span className="italic" title="Canonical name from your bank / SimpleFIN">({a.name})</span>
            ) : (
              a.institution ?? 'No institution'
            )}
            {isLiability(a.type) && a.interestRate != null && a.interestRate > 0 && (
              <> · {(a.interestRate * 100).toFixed(2)}% APR</>
            )}
            {isLiability(a.type) && <span className="ml-1 text-destructive">· owed</span>}
            {opts?.extraMeta}
          </div>
        </div>
        <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-start">
          <div className={clsx('mr-2 font-semibold tabular-nums', opts?.dimmed && 'text-sm', balanceColor)}>{balanceText}</div>
          <details name="account-actions" className="relative">
            <summary
              data-onboarding-target={a.type === 'uncategorized' ? 'unclassified-account-edit' : undefined}
              className="close-button flex size-11 cursor-pointer list-none items-center justify-center rounded-lg [&::-webkit-details-marker]:hidden"
              aria-label={`Actions for ${displayName}`}
            >
              <EllipsisVertical className="size-5" aria-hidden="true" />
            </summary>
            <div className="absolute right-0 z-20 mt-1 min-w-44 rounded-lg border border-border bg-card p-1 shadow-xl">
              <Button
                type="button"
                variant="ghost"
                className="h-11 w-full justify-start"
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open');
                  setEditing(a);
                }}
              >
                <Pencil data-icon="inline-start" aria-hidden="true" /> Edit account
              </Button>
              {opts?.dimmed ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 w-full justify-start"
                  onClick={(event) => {
                    event.currentTarget.closest('details')?.removeAttribute('open');
                    unhide.mutate(a.id);
                  }}
                  disabled={unhide.isPending}
                >
                  <Eye data-icon="inline-start" aria-hidden="true" /> Unhide account
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 w-full justify-start"
                  onClick={(event) => {
                    event.currentTarget.closest('details')?.removeAttribute('open');
                    hide.reset();
                    setConfirmation({ action: 'hide', account: a });
                  }}
                >
                  <EyeOff data-icon="inline-start" aria-hidden="true" /> Hide account
                </Button>
              )}
              {a.source === 'manual' && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 w-full justify-start text-destructive hover:text-destructive"
                  onClick={(event) => {
                    event.currentTarget.closest('details')?.removeAttribute('open');
                    del.reset();
                    setConfirmation({ action: 'delete', account: a });
                  }}
                >
                  <Trash2 data-icon="inline-start" aria-hidden="true" /> Delete account
                </Button>
              )}
            </div>
          </details>
        </div>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Accounts</h1>
        {!sf.data?.demoMode && (
          <Button
            type="button"
            variant="outline"
            onClick={() => sync.mutate()}
            disabled={sync.isPending || !sf.data?.connected}
          >
            {sync.isPending ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
            {sync.isPending ? 'Syncing…' : 'Sync'}
          </Button>
        )}
      </div>
      {accountOperationError && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Account operation failed</AlertTitle>
          <AlertDescription>{accountOperationError.message}</AlertDescription>
        </Alert>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Your accounts</h2>
            {!accounts.isPending && !accounts.isError && (
              <p className="text-xs text-muted-foreground">{visible.length} visible {visible.length === 1 ? 'account' : 'accounts'}</p>
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
          <Card>
            <CardContent className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Loading accounts…
            </CardContent>
          </Card>
        )}
        {accounts.isError && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 text-center">
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>Could not load accounts</AlertTitle>
                <AlertDescription>{accounts.error.message}</AlertDescription>
              </Alert>
              <Button type="button" onClick={() => accounts.refetch()} disabled={accounts.isFetching}>
                {accounts.isFetching ? <Spinner data-icon="inline-start" /> : null}
                {accounts.isFetching ? 'Retrying…' : 'Retry'}
              </Button>
            </CardContent>
          </Card>
        )}
        {!accounts.isPending && !accounts.isError && (['uncategorized', ...EDITABLE_ACCOUNT_TYPES] as AccountType[]).map((t) => {
          const list = byType[t] ?? [];
          if (list.length === 0) return null;
          const meta = TYPE_META[t];
          const Icon = meta.icon;
          const typeTotal = list.reduce((sum, account) => sum + Math.abs(account.balance), 0);
          return (
            <Card key={t}>
              <CardHeader>
                <div className="flex min-w-0 items-center gap-2">
                  <span className={clsx('flex size-7 shrink-0 items-center justify-center rounded-lg', meta.color)}>
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <CardTitle className="truncate text-sm">{meta.label}</CardTitle>
                  <span className="shrink-0 text-xs text-muted-foreground">· {list.length}</span>
                </div>
                <CardAction>
                <div className={clsx(
                  'shrink-0 text-right text-sm font-semibold tabular-nums',
                  t === 'uncategorized'
                    ? 'text-muted-foreground'
                    : isLiability(t)
                      ? 'text-destructive'
                      : 'text-foreground',
                )}>
                  {formatMoney(typeTotal)}
                  {t === 'uncategorized' && <span className="ml-1 text-[10px] font-normal">not counted</span>}
                  {isLiability(t) && <span className="ml-1 text-[10px] font-normal text-muted-foreground">owed</span>}
                </div>
                </CardAction>
              </CardHeader>
              <CardContent>
                {t === 'uncategorized' && (
                  <p className="mb-2 text-xs text-muted-foreground">Use the account menu to choose a type so balances are counted correctly.</p>
                )}
                <ul className="divide-y divide-border">
                  {list.map((a) => renderRow(a))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
        {!accounts.isPending && !accounts.isError && visible.length === 0 && (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Wallet />
              </EmptyMedia>
              <EmptyTitle>No accounts yet</EmptyTitle>
              <EmptyDescription>Add one below or connect SimpleFIN to auto-import.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        {/* Hidden section. Off by default — the user has to opt in to
            see them. From here they can un-hide to bring the account
            (and its future sync data) back. */}
        {!accounts.isPending && !accounts.isError && hidden.length > 0 && (
          <Card>
            <CardContent>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowHidden((v) => !v)}
                aria-expanded={showHidden}
                className="w-full justify-between"
              >
                <span className="flex items-center gap-2">
                  <EyeOff data-icon="inline-start" />
                  <span className="text-sm font-semibold">
                    {showHidden ? 'Hide' : 'Show'} hidden accounts
                  </span>
                  <span className="text-xs text-muted-foreground">· {hidden.length}</span>
                </span>
                {showHidden
                  ? <ChevronDown data-icon="inline-end" aria-hidden="true" />
                  : <ChevronRight data-icon="inline-end" aria-hidden="true" />}
              </Button>
              {showHidden && (
                <ul className="mt-3 divide-y divide-border">
                  {hidden.map((a) => renderRow(a, {
                    dimmed: true,
                    extraMeta: <span> · hidden</span>,
                  }))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Add or connect an account</h2>
          <p className="text-xs text-muted-foreground">Connect SimpleFIN for automatic imports or add a balance manually.</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
          <Card data-onboarding-target="simplefin-connect">
            <CardHeader>
              <CardTitle>SimpleFIN</CardTitle>
              {!sf.isPending && !sf.isError && (
                <CardAction>
                  <Badge variant={sf.data.demoMode ? 'outline' : sf.data.connected ? 'secondary' : 'outline'}>
                    {sf.data.demoMode ? 'Demo' : sf.data.connected ? 'Connected' : 'Not connected'}
                  </Badge>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
        {sf.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Checking connection…
          </p>
        ) : sf.isError ? (
          <div className="flex flex-col gap-3">
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Could not load SimpleFIN status</AlertTitle>
              <AlertDescription>{sf.error.message}</AlertDescription>
            </Alert>
            <Button type="button" onClick={() => sf.refetch()} disabled={sf.isFetching}>
              {sf.isFetching ? <Spinner data-icon="inline-start" /> : null}
              {sf.isFetching ? 'Retrying…' : 'Retry'}
            </Button>
          </div>
        ) : sf.data.demoMode ? (
          <p className="text-sm text-muted-foreground">
            Bank connections are disabled in the public demo. The accounts below use sample data.
          </p>
        ) : sf.data.connected ? (
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <p>Connected. Last sync: {sf.data.lastSync ?? 'never'}.</p>
            {sf.data.lastAttempt && sf.data.lastAttempt !== sf.data.lastSync && (
              <p className="text-xs text-muted-foreground">Last attempt: {sf.data.lastAttempt}.</p>
            )}
            {sync.data && (
              <p className="text-xs text-muted-foreground">
                Synced {sync.data.accountsSynced} account(s), {sync.data.transactionsSynced} transaction(s).
                {sync.data.transactionsReconciled > 0 && ` Reconciled ${sync.data.transactionsReconciled} pending charge(s).`}
              </p>
            )}
            {sync.data && sync.data.reconciliationAmbiguous > 0 && (
              <Alert>
                <AlertTriangle />
                <AlertDescription>
                  {sync.data.reconciliationAmbiguous} pending charge(s) need manual duplicate review.
                </AlertDescription>
              </Alert>
            )}
            {sync.data && sync.data.stalePendingTransactions > 0 && (
              <Alert>
                <AlertTriangle />
                <AlertDescription>
                  {sync.data.stalePendingTransactions} pending charge(s) have not been seen for at least 7 days.
                </AlertDescription>
              </Alert>
            )}
            {sync.data?.errors && sync.data.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>Sync errors</AlertTitle>
                <AlertDescription>
                  <ul className="flex flex-col gap-0.5">
                    {sync.data.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {(sync.error?.message || (!sync.data && sf.data.lastError)) && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertDescription>{sync.error?.message ?? sf.data.lastError}</AlertDescription>
              </Alert>
            )}
            {!confirmDisconnect ? (
              <Button
                type="button"
                variant="destructive"
                className="mt-3 self-start"
                onClick={() => { disconnect.reset(); setConfirmDisconnect(true); }}
              >
                Disconnect
              </Button>
            ) : (
              <div className="mt-3 flex flex-col gap-3">
                <Alert variant="destructive">
                  <AlertTitle>Disconnect SimpleFIN?</AlertTitle>
                  <AlertDescription>
                    Imported accounts and transactions will remain in Cura Money. Automatic and manual SimpleFIN syncs will stop until you reconnect.
                  </AlertDescription>
                </Alert>
                {disconnect.error && (
                  <Alert variant="destructive">
                    <AlertTriangle />
                    <AlertDescription>{disconnect.error.message}</AlertDescription>
                  </Alert>
                )}
                <div className="flex gap-2">
                  <Button type="button" variant="destructive" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
                    {disconnect.isPending ? <Spinner data-icon="inline-start" /> : null}
                    {disconnect.isPending ? 'Disconnecting…' : 'Yes, disconnect'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setConfirmDisconnect(false)} disabled={disconnect.isPending}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={onClaim} className="flex flex-col gap-2">
            <FieldGroup>
              <Field data-invalid={!!sfErr || undefined}>
                <FieldLabel htmlFor="simplefin-token">SimpleFIN setup token</FieldLabel>
                <div className="flex items-center gap-1">
                  <FieldDescription>Connect or reconnect via SimpleFIN setup token</FieldDescription>
                  <Button variant="ghost" size="icon" asChild>
                    <a
                      href="https://bridge.simplefin.org/simplefin/create"
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Get a SimpleFIN setup token"
                      title="Get a SimpleFIN setup token"
                    >
                      <ExternalLink />
                    </a>
                  </Button>
                </div>
                <Input
                  id="simplefin-token"
                  value={sfToken}
                  onChange={(e) => setSfToken(e.target.value)}
                  placeholder="Paste SimpleFIN setup token"
                  className="font-mono"
                  aria-invalid={!!sfErr || undefined}
                />
              </Field>
            </FieldGroup>
            {sfErr && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertDescription>{sfErr}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={sfBusy}>
              {sfBusy ? <Spinner data-icon="inline-start" /> : null}
              {sfBusy ? (claim.isSuccess ? 'Running initial sync…' : 'Connecting…') : 'Connect'}
            </Button>
          </form>
        )}
            </CardContent>
          </Card>

      <Card data-onboarding-target="manual-account-add">
        <CardHeader>
          <CardTitle>Manual account</CardTitle>
          <CardDescription>Balances are entered and displayed in USD only. Enter a positive amount; account type determines whether it is an asset or amount owed.</CardDescription>
        </CardHeader>
        <CardContent>
        <form onSubmit={onAdd} className="flex flex-col gap-3">
          <FieldGroup>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="manual-account-name">Name</FieldLabel>
                <Input id="manual-account-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="manual-account-type">Type</FieldLabel>
                <Select value={type} onValueChange={(value) => setType(value as EditableAccountType)}>
                  <SelectTrigger id="manual-account-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {EDITABLE_ACCOUNT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{TYPE_META[t].label}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="manual-account-balance">{isLiability(type) ? 'Amount owed (USD)' : 'Balance (USD)'}</FieldLabel>
                <Input id="manual-account-balance" value={balance} onChange={(e) => setBalance(e.target.value)} type="number" min="0" step="0.01" placeholder={isLiability(type) ? 'Amount owed (USD)' : 'Balance (USD)'} />
              </Field>
              <Field>
                <FieldLabel htmlFor="manual-account-institution">Institution</FieldLabel>
                <Input id="manual-account-institution" value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Institution (optional)" />
              </Field>
            </div>
          </FieldGroup>
          {add.error && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertDescription>{add.error.message}</AlertDescription>
            </Alert>
          )}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
              {add.isPending ? 'Adding…' : 'Add account'}
            </Button>
          </div>
        </form>
        </CardContent>
      </Card>
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
  const typeUncategorized = type === 'uncategorized';
  const balanceInvalid = balance === '' || Number(balance) < 0;

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
      open
      onOpenChange={(open) => {
        if (!open && !isSaving) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(event) => {
          if (isSaving) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (isSaving) event.preventDefault();
        }}
      >
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Edit account</DialogTitle>
            <DialogDescription>
              Bank name: {account.name}
              {account.institution ? ` · ${account.institution}` : ''}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="edit-account-alias">Display name</FieldLabel>
              <Input
                ref={inputRef}
                id="edit-account-alias"
                type="text"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                maxLength={120}
                placeholder={account.name}
                disabled={isSaving}
              />
              <FieldDescription>
                Leave blank to use the bank name. Survives SimpleFIN sync.
              </FieldDescription>
            </Field>

            <Field data-invalid={balanceInvalid || undefined}>
              <FieldLabel htmlFor="edit-account-balance">{isLiability(type) ? 'Amount owed' : 'Balance'} (USD)</FieldLabel>
              <Input
                id="edit-account-balance"
                type="number"
                min="0"
                step="0.01"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                disabled={isSaving}
                required
                aria-invalid={balanceInvalid || undefined}
              />
              <FieldDescription>
                Cura Money supports USD only. Enter a positive amount; the account type determines its net-worth sign.
              </FieldDescription>
            </Field>

            <Field data-invalid={typeUncategorized || undefined}>
              <FieldLabel htmlFor="edit-account-type">Account type</FieldLabel>
              <Select
                value={typeUncategorized ? undefined : type}
                onValueChange={(value) => setType(value as EditableAccountType)}
                disabled={isSaving}
              >
                <SelectTrigger id="edit-account-type" className="w-full" aria-invalid={typeUncategorized || undefined}>
                  <SelectValue placeholder="Select account type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {EDITABLE_ACCOUNT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{TYPE_META[t].label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                {type === 'investment'
                  ? 'Investment is balance-only: value stays on Accounts/Home for growth; no transactions are imported or shown.'
                  : 'Affects net worth sign and paydown. Survives SimpleFIN sync.'}
              </FieldDescription>
            </Field>
          </FieldGroup>

          {error && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving || typeUncategorized || balanceInvalid}>
              {isSaving ? <Spinner data-icon="inline-start" /> : null}
              {isSaving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
