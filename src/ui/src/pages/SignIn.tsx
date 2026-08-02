import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { signInEmail, fetchMe, SIGNOUT_FLAG_KEY } from '../lib/auth';
import { api } from '../lib/api';

interface OidcProvider {
  providerId: string;
  displayName: string;
}

interface AuthOptions {
  localAuthDisabled: boolean;
  providers: OidcProvider[];
}

export function SignIn() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Read the "just signed out" flag from sessionStorage. When set, the
  // next OIDC click will include `prompt=login` so the IdP forces a
  // fresh login. We clear the flag on read so it only affects the
  // immediate post-signout attempt and not later visits to /sign-in.
  const [fromSignOut, setFromSignOut] = useState<boolean>(() => {
    const flag = sessionStorage.getItem(SIGNOUT_FLAG_KEY);
    if (flag) {
      sessionStorage.removeItem(SIGNOUT_FLAG_KEY);
      return true;
    }
    return false;
  });

  useEffect(() => {
    if (fromSignOut) {
      qc.invalidateQueries({ queryKey: ['me'] });
    }
  }, [fromSignOut, qc]);

  const callbackURL = params.get('callbackURL') ?? '/';

  // One fetch carries both the OIDC provider list AND the
  // `localAuthDisabled` flag so we can't render a half-applied view
  // (e.g. show the email form for one frame while it's about to be
  // hidden). See src/routes/auth.ts → /auth-options.
  const authOptions = useQuery({
    queryKey: ['auth-options'],
    queryFn: () => api.get<AuthOptions>('/api/auth-app/auth-options'),
  });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await signInEmail(email, password);
      await qc.invalidateQueries({ queryKey: ['me'] });
      const me = await fetchMe();
      if (!me) throw new Error('sign-in succeeded but no session found');
      navigate(callbackURL);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startOidc = async (providerId: string) => {
    setErr(null);
    try {
      const body: Record<string, unknown> = { providerId, callbackURL };
      if (fromSignOut) {
        body.additionalData = { promptLogin: true };
      }
      const resp = await fetch('/api/auth/sign-in/oauth2', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error ?? `OIDC sign-in failed (${resp.status})`);
      }
      const data = (await resp.json()) as { url?: string; redirect?: boolean };
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('OIDC provider did not return an authorization URL');
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const oidcList = authOptions.data?.providers ?? [];
  const localAuthDisabled = authOptions.data?.localAuthDisabled ?? false;
  // We render the email/password form only when local auth is enabled.
  // When it's disabled, the OIDC buttons (or a notice) take the full
  // card so the user can't accidentally try to sign in locally.
  const showLocalForm = !localAuthDisabled;

  return (
    <div className="min-h-full flex items-center justify-center p-4 bg-page">
      <div className="w-full max-w-sm card">
        <div className="flex items-center gap-2 mb-4">
          <img src="/logo.png" alt="Cura Money" className="h-8 w-8" />
          <h1 className="text-xl font-bold fg-primary">Sign in</h1>
        </div>

        {showLocalForm && (
          <form onSubmit={onSubmit} className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium fg-secondary">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-default bg-surface fg-primary placeholder-slate-400 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium fg-secondary">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-default bg-surface fg-primary placeholder-slate-400 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                required
              />
            </label>
            {err && <p className="text-sm text-rose-600 dark:text-rose-400">{err}</p>}
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        {!showLocalForm && oidcList.length === 0 && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 p-3 text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              Local sign-in is disabled
            </p>
            <p className="text-amber-800 dark:text-amber-300 mt-1">
              An admin has turned off email/password sign-in. Ask them to
              add an OIDC provider in Settings → Authentication, or to
              re-enable local sign-in.
            </p>
          </div>
        )}

        {oidcList.length > 0 && (
          <>
            {showLocalForm && (
              <div className="flex items-center gap-3 my-3">
                <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                <span className="text-xs uppercase tracking-wider fg-muted">or</span>
                <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
              </div>
            )}
            <div className="space-y-2">
              {oidcList.map((p) => (
                <button
                  key={p.providerId}
                  type="button"
                  onClick={() => startOidc(p.providerId)}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-default bg-surface fg-primary hover:bg-slate-50 dark:hover:bg-slate-600 px-3 py-2 text-sm font-medium"
                >
                  <span>Sign in with OIDC</span>
                </button>
              ))}
            </div>
          </>
        )}

        {showLocalForm && oidcList.length === 0 && (
          <p className="mt-3 text-xs fg-muted text-center">
            OIDC sign-in is configured? It will appear here once an admin
            enables it from the IdP link.
          </p>
        )}
      </div>
    </div>
  );
}
