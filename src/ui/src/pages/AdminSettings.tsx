import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Plus, Trash2, Edit3, RefreshCw, ShieldCheck, X, AlertTriangle, Copy, Check, KeyRound, Lock, Users, Eye, EyeOff, KeySquare, ShieldAlert, ShieldOff, Shield } from 'lucide-react';
import { api } from '../lib/api';
import { fetchMe, changePassword } from '../lib/auth';

interface OidcProvider {
  id: string;
  providerId: string;
  discoveryUrl: string;
  clientId: string;
  hasClientSecret: boolean;
  scopes: string[];
  isActive: boolean;
  createdAt: string;
  callbackUri: string;
}

interface DiscoveryResult {
  ok: boolean;
  discovery?: {
    authorizationEndpoint: string;
    tokenEndpoint: string;
    userinfoEndpoint?: string;
    jwksUri?: string;
  };
  error?: string;
  code?: string;
}

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string | null;
  createdAt: string;
  hasCredential: boolean;
  providers: string;
  isProtected: boolean;
  protectionReason:
    | 'last_admin'
    | 'last_local_admin'
    | 'last_oidc_admin_when_local_disabled'
    | null;
}

function protectionTooltip(reason: AdminUser['protectionReason']): string {
  switch (reason) {
    case 'last_admin':
      return 'Only remaining admin — demote or delete would lock the instance. Promote another user first.';
    case 'last_local_admin':
      return 'Only local admin — demote or delete would remove the recovery path. Promote another user to admin first.';
    case 'last_oidc_admin_when_local_disabled':
      return 'Only OIDC admin and local auth is disabled — this is the only sign-in path. Promote another OIDC user to admin first.';
    default:
      return 'Protected admin';
  }
}

interface LocalAuthInfo {
  localAuthDisabled: boolean;
  /** True when at least one OIDC provider is configured AND at least
   *  one user with role='admin' has signed in via a non-credential
   *  provider. When false, the "Disable local auth" button is locked
   *  and we surface a message explaining what the admin needs to do
   *  first. */
  canDisable: boolean;
  oidcAdminCount: number;
}

const EMPTY_PROVIDER_FORM = {
  providerId: '',
  discoveryUrl: '',
  clientId: '',
  clientSecret: '',
  scopes: 'openid,email,profile',
};

const PWD_INPUT_CLS = 'rounded-lg border border-default bg-surface fg-primary placeholder-slate-400 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none';

export function AdminSettings() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe });

  const isAdmin = me.data?.user.role === 'admin';

  if (me.isLoading) {
    return <div className="fg-muted">Loading…</div>;
  }
  if (!isAdmin) {
    return (
      <div className="card max-w-md">
        <h1 className="text-lg font-semibold text-rose-600 dark:text-rose-400">Admin only</h1>
        <p className="mt-2 text-sm fg-tertiary">
          This page is reserved for the admin role. Sign in with the admin account
          to manage OIDC providers, change your password, and manage users.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold fg-primary">Settings</h1>
      </div>

      <OidcSection />

      <AuthenticationSection />

      <PasswordSection
        hasCredential={me.data?.user.hasCredential ?? false}
        email={me.data?.user.email ?? ''}
      />

      <UsersSection />
    </div>
  );
}

// ============================================================================
// OIDC providers — existing functionality, just lifted out of the old page.
// ============================================================================

function OidcSection() {
  const qc = useQueryClient();
  const providers = useQuery({
    queryKey: ['admin', 'oidc', 'providers'],
    queryFn: () => api.get<OidcProvider[]>('/api/admin/oidc/providers'),
  });
  const [editing, setEditing] = useState<OidcProvider | null>(null);
  const [adding, setAdding] = useState(false);
  // Shown after a save that the server reports needs a container restart
  // (i.e. the in-memory Better Auth instance couldn't be hot-reloaded —
  // which in v0.1 only happens if `refreshAuth()` is broken, so this
  // banner should be rare). When the server returns `restart_required:
  // false` we silently invalidate and continue — the new provider is
  // already live.
  const [needsRestart, setNeedsRestart] = useState(false);

  const del = useMutation({
    mutationFn: (id: string) => api.delete<{ restart_required: boolean }>(`/api/admin/oidc/providers/${id}`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['admin', 'oidc'] });
      if (data?.restart_required) setNeedsRestart(true);
    },
  });

  return (
    <section>
      <SectionHeader
        icon={<KeyRound className="h-4 w-4" />}
        title="OIDC providers"
        action={
          <button onClick={() => setAdding(true)} className="btn-primary flex items-center gap-2 shrink-0">
            <Plus className="h-4 w-4" /> Add provider
          </button>
        }
      />

      {needsRestart && (
        <div className="card border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-900/30 flex items-start gap-3 mb-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-amber-900 dark:text-amber-200">Restart required</h3>
            <p className="text-sm text-amber-800 dark:text-amber-300 mt-0.5">
              The provider list changed. Run{' '}
              <code className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200 text-xs">
                docker compose restart app
              </code>{' '}
              to activate the new config. The sign-in page won't show the new
              buttons until you do.
            </p>
            <button
              onClick={() => setNeedsRestart(false)}
              className="mt-2 text-xs text-amber-700 dark:text-amber-300 hover:underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="card">
        {providers.isLoading && <div className="fg-muted text-sm">Loading…</div>}
        {providers.data?.length === 0 && (
          <div className="text-sm fg-muted text-center py-6">
            <KeyRound className="h-5 w-5 inline mr-1 fg-muted" /> No OIDC providers configured yet. Click "Add provider" to wire one up.
          </div>
        )}
        <ul className="divide-y divide-slate-100 dark:divide-slate-700">
          {providers.data?.map((p) => (
            <li key={p.id} className="py-3 flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold fg-primary">{p.providerId}</span>
                  {p.isActive ? (
                    <span className="text-xs bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded">
                      active
                    </span>
                  ) : (
                    <span className="text-xs bg-slate-100 dark:bg-slate-700 fg-tertiary px-2 py-0.5 rounded">
                      inactive
                    </span>
                  )}
                </div>
                <div className="text-xs fg-muted mt-1 break-all">{p.discoveryUrl}</div>
                <div className="text-xs fg-muted mt-0.5">
                  client_id: <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded fg-secondary">{p.clientId}</code>
                  {' · '}
                  secret: {p.hasClientSecret ? 'set' : 'missing'}
                  {' · '}
                  scopes: {p.scopes.join(', ')}
                </div>
                <div className="text-xs fg-muted mt-2 flex items-center gap-1">
                  <span className="fg-muted">Callback URI:</span>
                  <code className="bg-slate-50 dark:bg-slate-700 border border-default px-1.5 py-0.5 rounded fg-secondary break-all">
                    {p.callbackUri}
                  </code>
                  <CopyButton value={p.callbackUri} />
                </div>
                <div className="text-xs fg-muted mt-0.5">
                  Added {new Date(p.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setEditing(p)}
                  className="p-2 rounded fg-tertiary hover:bg-slate-100 dark:hover:bg-slate-700"
                  title="Edit"
                >
                  <Edit3 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete OIDC provider "${p.providerId}"?`)) del.mutate(p.id);
                  }}
                  className="p-2 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {(adding || editing) && (
        <ProviderForm
          initial={editing ?? null}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={(needsRestart) => {
            setAdding(false);
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['admin', 'oidc'] });
            if (needsRestart) setNeedsRestart(true);
          }}
        />
      )}
    </section>
  );
}

// ============================================================================
// Authentication — toggle for local email/password sign-in.
//
// Renders below the OIDC section per the operator flow: "wire up OIDC
// first, then optionally turn off local auth once an OIDC admin exists".
// Reachable only by admins (the page guard already enforces that).
// ============================================================================

function AuthenticationSection() {
  const qc = useQueryClient();
  const info = useQuery({
    queryKey: ['admin', 'auth', 'local'],
    queryFn: () => api.get<LocalAuthInfo>('/api/admin/auth/local-auth'),
  });
  const [confirming, setConfirming] = useState<null | 'disable' | 'enable'>(null);
  const [err, setErr] = useState<string | null>(null);

  const toggle = useMutation({
    mutationFn: (disabled: boolean) =>
      api.patch<{ ok: true; localAuthDisabled: boolean }>('/api/admin/auth/local-auth', { disabled }),
    onSuccess: (data) => {
      setConfirming(null);
      setErr(null);
      qc.setQueryData(['admin', 'auth', 'local'], (prev: LocalAuthInfo | undefined) =>
        prev ? { ...prev, localAuthDisabled: data.localAuthDisabled } : prev,
      );
      // The sign-in page reads auth-options — invalidate so a tab
      // already open at /sign-in re-renders against the new state on
      // next navigation.
      qc.invalidateQueries({ queryKey: ['auth-options'] });
    },
    onError: (e) => {
      setErr((e as { message?: string }).message ?? 'Failed to update local auth.');
    },
  });

  if (info.isLoading) {
    return (
      <section>
        <SectionHeader icon={<Shield className="h-4 w-4" />} title="Authentication" />
        <div className="card text-sm fg-muted">Loading…</div>
      </section>
    );
  }
  const data = info.data;
  if (!data) {
    // Surface the server-side message so the operator can debug
    // without tailing the container logs. Common cause: the migration
    // that adds `local_auth_disabled` hasn't run yet (e.g. the new
    // image was pulled before the boot-time migrator had a chance).
    const errMsg =
      (info.error as { message?: string } | null)?.message
      ?? 'Could not load authentication settings.';
    return (
      <section>
        <SectionHeader icon={<Shield className="h-4 w-4" />} title="Authentication" />
        <div className="card text-sm text-rose-600 dark:text-rose-400 space-y-2">
          <p className="font-medium">Could not load authentication settings.</p>
          <p className="text-xs break-words">{errMsg}</p>
          <button
            type="button"
            onClick={() => info.refetch()}
            className="text-xs underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  const localAuthDisabled = data.localAuthDisabled;
  const canDisable = data.canDisable;
  // If the flag is currently ON, we should be able to turn it OFF
  // unconditionally — re-enabling never locks anyone out. The guard
  // only applies when transitioning from ON → OFF.
  const disableLocked = !localAuthDisabled && !canDisable;

  return (
    <section>
      <SectionHeader
        icon={<Shield className="h-4 w-4" />}
        title="Authentication"
        subtitle="Local email/password sign-in is enabled by default. Turn it off once at least one OIDC user has been promoted to admin."
      />

      <div className="card space-y-3">
        <div className="flex items-start gap-3">
          {localAuthDisabled ? (
            <span className="text-xs bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 px-2 py-0.5 rounded shrink-0 mt-0.5">
              disabled
            </span>
          ) : (
            <span className="text-xs bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded shrink-0 mt-0.5">
              enabled
            </span>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-medium fg-primary">
              Local sign-in (email + password)
            </div>
            <p className="text-sm fg-tertiary mt-1">
              {localAuthDisabled
                ? 'The email/password form on the sign-in page is hidden. Users can only sign in with an OIDC provider.'
                : 'Users can sign in with email and password. Disable this once OIDC is set up and you trust it.'}
            </p>
          </div>
        </div>

        {disableLocked && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 p-3 flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-900 dark:text-amber-200">
              <p>Disabling local auth requires an OIDC user with admin role</p>
            </div>
          </div>
        )}

        {err && (
          <p className="text-sm text-rose-600 dark:text-rose-400 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> {err}
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {localAuthDisabled ? (
            <button
              type="button"
              onClick={() => setConfirming('enable')}
              className="px-3 py-2 text-sm rounded-lg border border-default bg-surface fg-primary hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
              disabled={toggle.isPending}
            >
              <Shield className="h-4 w-4" />
              Re-enable local sign-in
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming('disable')}
              className="px-3 py-2 text-sm rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              disabled={disableLocked || toggle.isPending}
              title={
                disableLocked
                  ? 'Promote an OIDC user to admin before disabling local sign-in'
                  : undefined
              }
            >
              <ShieldOff className="h-4 w-4" />
              Disable local sign-in
            </button>
          )}
        </div>
      </div>

      {confirming && (
        <LocalAuthConfirmModal
          intent={confirming}
          busy={toggle.isPending}
          err={err}
          onCancel={() => {
            setConfirming(null);
            setErr(null);
          }}
          onConfirm={() => toggle.mutate(confirming === 'disable')}
        />
      )}
    </section>
  );
}

function LocalAuthConfirmModal({
  intent,
  busy,
  err,
  onCancel,
  onConfirm,
}: {
  intent: 'disable' | 'enable';
  busy: boolean;
  err: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Type-to-confirm for destructive intent only. The enable path is
  // non-destructive so a single click is enough.
  const [typed, setTyped] = useState('');
  const canConfirm = intent === 'enable' || (typed === 'CONFIRM' && !busy);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className={`h-5 w-5 shrink-0 ${intent === 'disable' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`} />
          <h3 className="text-lg font-semibold fg-primary">
            {intent === 'disable' ? 'Disable local sign-in?' : 'Re-enable local sign-in?'}
          </h3>
        </div>
        {intent === 'disable' ? (
          <>
            <p className="text-sm fg-tertiary">
              Once disabled, <strong>no one can sign in with email and
              password</strong>. The sign-in page will only show OIDC
              buttons. Existing sessions stay valid until they expire or
              the user signs out.
            </p>
            <p className="text-sm fg-tertiary mt-2">
              You can re-enable local sign-in later from this same screen.
              The guard requires at least one admin who has signed in via
              OIDC &mdash; that has been confirmed.
            </p>
          </>
        ) : (
          <p className="text-sm fg-tertiary">
            Re-enabling restores the email/password form on the sign-in
            page. No precondition is required.
          </p>
        )}
        {intent === 'disable' && (
          <label className="block mt-4">
            <span className="text-sm font-medium fg-secondary">
              Type <span className="font-mono">CONFIRM</span> to confirm:
            </span>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className={`mt-1 w-full ${PWD_INPUT_CLS}`}
              autoComplete="off"
              autoFocus
            />
          </label>
        )}
        {err && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 text-sm fg-tertiary hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className={`px-3 py-2 text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed ${
              intent === 'disable'
                ? 'bg-rose-600 text-white hover:bg-rose-700'
                : 'bg-amber-600 text-slate-900 hover:bg-amber-700'
            }`}
          >
            {busy
              ? 'Updating…'
              : intent === 'disable'
                ? 'Disable local sign-in'
                : 'Re-enable local sign-in'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Change password — only visible for users with a credential account.
// ============================================================================

function PasswordSection({ hasCredential, email }: { hasCredential: boolean; email: string }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!hasCredential) {
    return (
      <section>
        <SectionHeader
          icon={<Lock className="h-4 w-4" />}
          title="Change password"
          subtitle="Only available for accounts with an email/password login."
        />
        <div className="card text-sm fg-tertiary">
          <p>
            You signed in via an OIDC provider (<span className="font-mono text-xs">{email}</span>),
            so there's no password to change here. Manage it from your identity provider.
          </p>
        </div>
      </section>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setOk(false);
    if (next.length < 12) return setErr('New password must be at least 12 characters.');
    if (next !== confirm) return setErr('New password and confirmation do not match.');
    setBusy(true);
    try {
      await changePassword(current, next);
      setOk(true);
      setCurrent(''); setNext(''); setConfirm('');
    } catch (e2) {
      const api = e2 as { message?: string };
      setErr(api.message ?? 'Failed to change password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <SectionHeader
        icon={<Lock className="h-4 w-4" />}
        title="Change password"
        subtitle="Change the password for your local account."
      />
      <form onSubmit={onSubmit} className="card max-w-md space-y-3">
        <label className="block">
          <span className="text-sm font-medium fg-secondary">Current password</span>
          <div className="relative mt-1">
            <input
              type={showCurrent ? 'text' : 'password'}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={`w-full pr-10 ${PWD_INPUT_CLS}`}
              required
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowCurrent((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 fg-muted hover:fg-secondary p-1"
              aria-label={showCurrent ? 'Hide current password' : 'Show current password'}
            >
              {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </label>
        <label className="block">
          <span className="text-sm font-medium fg-secondary">
            New password <span className="text-xs fg-muted font-normal">(min 12 chars)</span>
          </span>
          <div className="relative mt-1">
            <input
              type={showNext ? 'text' : 'password'}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className={`w-full pr-10 ${PWD_INPUT_CLS}`}
              required
              minLength={12}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowNext((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 fg-muted hover:fg-secondary p-1"
              aria-label={showNext ? 'Hide new password' : 'Show new password'}
            >
              {showNext ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </label>
        <label className="block">
          <span className="text-sm font-medium fg-secondary">Confirm new password</span>
          <input
            type={showNext ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={`mt-1 w-full ${PWD_INPUT_CLS}`}
            required
            minLength={12}
            autoComplete="new-password"
          />
        </label>
        {err && <p className="text-sm text-rose-600 dark:text-rose-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {err}</p>}
        {ok && <p className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><Check className="h-3 w-3" /> Password changed.</p>}
        <button type="submit" className="btn-primary flex items-center gap-2" disabled={busy}>
          <KeySquare className="h-4 w-4" /> {busy ? 'Changing…' : 'Change password'}
        </button>
      </form>
    </section>
  );
}

// ============================================================================
// Users — list + delete (OIDC users only; local admins are protected).
// ============================================================================

function UsersSection() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  const users = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api.get<AdminUser[]>('/api/admin/users'),
  });
  const [confirmDelete, setConfirmDelete] = useState<AdminUser | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [roleErr, setRoleErr] = useState<{ userId: string; message: string } | null>(null);

  const del = useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true; deletedRows: number }>(`/api/admin/users/${id}`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setConfirmDelete(null);
      setDeleteErr(null);
      // Re-fetch `me` in case the current user changed (unlikely but harmless).
      qc.invalidateQueries({ queryKey: ['me'] });
      // Silent success — the row disappearing from the list is the
      // feedback. We log the row count for ops debugging.
      // eslint-disable-next-line no-console
      console.info(`[admin] deleted user, ${data.deletedRows} rows of data removed`);
    },
    onError: (e) => {
      const err = e as { message?: string };
      setDeleteErr(err.message ?? 'Failed to delete user.');
    },
  });

  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: 'admin' | 'user' }) =>
      api.patch<{ ok: true; id: string; role: string | null }>(`/api/admin/users/${id}`, { role }),
    onSuccess: (_data, vars) => {
      setRoleErr(null);
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      // If the admin just changed their own role, refetch me so the page
      // guard reflects the new state. Server still enforces on every
      // request; this is just a UI cache concern.
      if (me.data?.user.id === vars.id) qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e, vars) => {
      const err = e as { message?: string };
      setRoleErr({ userId: vars.id, message: err.message ?? 'Failed to update role.' });
    },
    onSettled: () => {
      // Always refetch so the select reflects the canonical value
      // (in case the server applied a normalized value, e.g. 'user' -> null).
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });

  return (
    <section>
      <SectionHeader
        icon={<Users className="h-4 w-4" />}
        title="Users"
      />
      <div className="card">
        {users.isLoading && <div className="fg-muted text-sm">Loading…</div>}
        {users.data?.length === 0 && (
          <div className="text-sm fg-muted text-center py-6">
            <Users className="h-5 w-5 inline mr-1 fg-muted" /> No users.
          </div>
        )}
        <ul className="divide-y divide-slate-100 dark:divide-slate-700">
          {users.data?.map((u) => {
            const isLocal = u.hasCredential;
            const isProtectedAdmin = u.isProtected;
            const currentRole: 'admin' | 'user' = u.role === 'admin' ? 'admin' : 'user';
            const roleErrForRow = roleErr?.userId === u.id ? roleErr.message : null;
            const lockTitle = protectionTooltip(u.protectionReason);
            return (
              <li key={u.id} className="py-3 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium fg-primary truncate">{u.name}</span>
                    {isLocal ? (
                      <span className="text-xs bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 px-2 py-0.5 rounded">local</span>
                    ) : (
                      <span className="text-xs bg-slate-100 dark:bg-slate-700 fg-tertiary px-2 py-0.5 rounded">OIDC</span>
                    )}
                    {isProtectedAdmin && (
                      <span title={lockTitle} aria-label={lockTitle}>
                        <Lock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                      </span>
                    )}
                  </div>
                  <div className="text-xs fg-muted mt-0.5 truncate">
                    {u.email}
                  </div>
                  {roleErrForRow && (
                    <div className="text-xs text-rose-600 dark:text-rose-400 mt-1 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> {roleErrForRow}
                    </div>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <label className="text-xs fg-muted">Role</label>
                  <select
                    value={currentRole}
                    onChange={(e) => {
                      const next = e.target.value as 'admin' | 'user';
                      setRoleErr(null);
                      setRole.mutate({ id: u.id, role: next });
                    }}
                    disabled={setRole.isPending}
                    className="rounded-lg border border-default bg-surface fg-primary px-2 py-1 text-sm focus:border-amber-500 focus:outline-none disabled:opacity-50"
                    title={isProtectedAdmin ? lockTitle : 'Change user role'}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                {isProtectedAdmin ? (
                  <span title={lockTitle} aria-label={lockTitle}>
                    <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(u)}
                    className="p-2 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 shrink-0"
                    aria-label={`Delete ${u.email}`}
                    title="Delete user and all data"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {confirmDelete && (
        <DeleteUserModal
          user={confirmDelete}
          busy={del.isPending}
          err={deleteErr}
          onCancel={() => {
            setConfirmDelete(null);
            setDeleteErr(null);
          }}
          onConfirm={() => del.mutate(confirmDelete.id)}
        />
      )}
    </section>
  );
}

function DeleteUserModal({
  user,
  busy,
  err,
  onCancel,
  onConfirm,
}: {
  user: AdminUser;
  busy: boolean;
  err: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // The user has to TYPE the user's email to confirm. This is a
  // destructive action and the typed email matches the standard
  // "type the name to confirm" pattern used by GitHub, AWS, etc.
  const [typed, setTyped] = useState('');
  const canConfirm = typed === user.email && !busy;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0" />
          <h3 className="text-lg font-semibold fg-primary">Delete user?</h3>
        </div>
        <p className="text-sm fg-tertiary">
          This will permanently delete <span className="font-medium fg-primary">{user.name}</span>{' '}
          (<span className="font-mono text-xs">{user.email}</span>) and <strong>all of their data</strong>:
        </p>
        <ul className="text-sm fg-tertiary mt-2 ml-5 list-disc space-y-0.5">
          <li>Transactions</li>
          <li>Accounts</li>
          <li>Categories and sub-categories</li>
          <li>Monthly budget rows</li>
          <li>Settings</li>
          <li>Better Auth session + OIDC account link</li>
        </ul>
        <p className="text-sm text-rose-700 dark:text-rose-300 mt-3 font-medium">
          This cannot be undone.
        </p>
        <label className="block mt-4">
          <span className="text-sm font-medium fg-secondary">
            Type <span className="font-mono">{user.email}</span> to confirm:
          </span>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className={`mt-1 w-full ${PWD_INPUT_CLS}`}
            autoComplete="off"
            autoFocus
          />
        </label>
        {err && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-4">
          <button type="button" onClick={onCancel} className="px-3 py-2 text-sm fg-tertiary hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="px-3 py-2 text-sm font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Deleting…' : 'Delete user + data'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Provider form — used by the OIDC section.
// ============================================================================

function SectionHeader({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div>
        <h2 className="text-lg font-semibold fg-primary flex items-center gap-2">
          <span className="h-7 w-7 rounded-lg flex items-center justify-center bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            {icon}
          </span>
          {title}
        </h2>
        {subtitle && <p className="text-sm fg-tertiary mt-1 max-w-2xl">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function ProviderForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: OidcProvider | null;
  onClose: () => void;
  onSaved: (needsRestart: boolean) => void;
}) {
  const [form, setForm] = useState(
    initial
      ? {
          providerId: initial.providerId,
          discoveryUrl: initial.discoveryUrl,
          clientId: initial.clientId,
          clientSecret: '',
          scopes: initial.scopes.join(', '),
        }
      : EMPTY_PROVIDER_FORM,
  );
  const [testResult, setTestResult] = useState<DiscoveryResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isEdit = !!initial;

  const onTest = async () => {
    setTesting(true);
    setTestResult(null);
    setErr(null);
    try {
      const body: Record<string, string> = {
        discoveryUrl: form.discoveryUrl,
        clientId: form.clientId,
      };
      if (form.clientSecret) body.clientSecret = form.clientSecret;
      const r = await api.post<DiscoveryResult>('/api/admin/oidc/providers/test', body);
      setTestResult(r);
    } catch (e) {
      const msg = (e as Error).message;
      setTestResult({ ok: false, error: msg });
    } finally {
      setTesting(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const scopes = form.scopes.split(',').map((s) => s.trim()).filter(Boolean);
      let needsRestart = false;
      if (isEdit && initial) {
        const patch: Record<string, unknown> = {
          providerId: form.providerId,
          discoveryUrl: form.discoveryUrl,
          clientId: form.clientId,
          scopes,
        };
        if (form.clientSecret) patch.clientSecret = form.clientSecret;
        const res = await api.patch<{ restart_required?: boolean }>(
          `/api/admin/oidc/providers/${initial.id}`,
          patch,
        );
        needsRestart = !!res?.restart_required;
      } else {
        if (!form.clientSecret) {
          setErr('Client secret is required when adding a new provider');
          setBusy(false);
          return;
        }
        const res = await api.post<{ restart_required?: boolean }>(
          '/api/admin/oidc/providers',
          {
            providerId: form.providerId,
            discoveryUrl: form.discoveryUrl,
            clientId: form.clientId,
            clientSecret: form.clientSecret,
            scopes,
          },
        );
        needsRestart = !!res?.restart_required;
      }
      onSaved(needsRestart);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold fg-primary">
            {isEdit ? `Edit ${initial?.providerId}` : 'Add OIDC provider'}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 fg-tertiary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <ProviderField
            label="Provider ID (slug)"
            value={form.providerId}
            onChange={(v) => setForm({ ...form, providerId: v })}
            hint="Used in /api/auth/sign-in/oauth/<providerId>"
            disabled={isEdit}
            required
          />
          <ProviderField
            label="Discovery URL"
            value={form.discoveryUrl}
            onChange={(v) => setForm({ ...form, discoveryUrl: v })}
            placeholder="https://id.example.com/.well-known/openid-configuration"
            required
          />
          <ProviderField
            label="Client ID"
            value={form.clientId}
            onChange={(v) => setForm({ ...form, clientId: v })}
            required
          />
          <ProviderField
            label={isEdit ? 'Client secret (leave blank to keep current)' : 'Client secret'}
            value={form.clientSecret}
            onChange={(v) => setForm({ ...form, clientSecret: v })}
            type="password"
            required={!isEdit}
          />
          <ProviderField
            label="Scopes (comma-separated)"
            value={form.scopes}
            onChange={(v) => setForm({ ...form, scopes: v })}
            hint="Standard: openid, email, profile"
          />

          {form.providerId.trim() && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 p-3">
              <div className="text-xs font-semibold text-amber-900 dark:text-amber-200 mb-1">
                Register this callback URI in your IdP first
              </div>
              <p className="text-xs text-amber-800 dark:text-amber-300 mb-2">
                Before saving here, copy this exact value into your IdP's
                &quot;Allowed redirect URIs&quot; (Pocket ID) / &quot;Redirect URIs&quot;
                (Authentik / Keycloak). If the strings differ by even a
                trailing slash, the IdP will reject the sign-in with{' '}
                <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">redirect_uri not registered</code>.
              </p>
              <div className="flex items-center gap-1 bg-surface dark:bg-slate-800 border border-amber-200 dark:border-amber-700 rounded px-2 py-1.5">
                <code className="text-xs fg-primary break-all flex-1 font-mono">
                  {predictedCallbackUri(form.providerId)}
                </code>
                <CopyButton value={predictedCallbackUri(form.providerId)} />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onTest}
              className="text-sm text-amber-700 dark:text-amber-400 hover:underline flex items-center gap-1 disabled:opacity-50"
              disabled={testing || !form.discoveryUrl || !form.clientId}
            >
              <RefreshCw className={'h-3 w-3' + (testing ? ' animate-spin' : '')} />
              {testing ? 'Testing…' : 'Test discovery'}
            </button>
            {testResult?.ok && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" /> reachable
              </span>
            )}
            {testResult && !testResult.ok && (
              <span className="text-xs text-rose-600 dark:text-rose-400">{testResult.error}</span>
            )}
          </div>

          {err && <p className="text-sm text-rose-600 dark:text-rose-400">{err}</p>}

          <div className="flex justify-end gap-2 pt-3">
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm fg-tertiary hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add provider'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ProviderField({
  label,
  value,
  onChange,
  type = 'text',
  hint,
  disabled,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  hint?: string;
  disabled?: boolean;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium fg-secondary">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        className="mt-1 w-full rounded-lg border border-default bg-surface fg-primary placeholder-slate-400 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none disabled:bg-slate-50 dark:disabled:bg-slate-800 disabled:text-slate-500"
      />
      {hint && <span className="mt-1 block text-xs fg-muted">{hint}</span>}
    </label>
  );
}

function predictedCallbackUri(providerId: string): string {
  if (!providerId.trim()) return '';
  return `${window.location.origin}/api/auth/oauth2/callback/${encodeURIComponent(
    providerId.trim(),
  )}`;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        /* give up silently */
      }
      document.body.removeChild(ta);
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      className="shrink-0 p-1 rounded fg-tertiary hover:fg-primary hover:bg-slate-100 dark:hover:bg-slate-700"
      title={copied ? 'Copied!' : 'Copy'}
      aria-label="Copy to clipboard"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}
