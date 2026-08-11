/**
 * First-run wizard. Four steps:
 *   1. Bootstrap token + first admin
 *   2. Configure OIDC provider (or skip — admin can add one later in /settings)
 *   3. Review OIDC configuration (only reached if OIDC was configured)
 *   4. Done — App transitions to authenticated routing
 *
 * The bootstrap token is printed to the `app` container logs on first
 * boot (see src/auth/setup.ts → ensureSetupState). Operators copy-paste
 * it into step 1.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

interface SetupStatus {
  needsSetup: boolean;
  bootstrapCompleted: boolean;
  oidcConfigured: boolean;
  bootstrapTokenRequired: boolean;
  needsAdmin: boolean;
  nextStep: 'admin' | 'oidc-configure' | 'oidc-review' | 'done';
}

async function fetchStatus(): Promise<SetupStatus> {
  return api.get<SetupStatus>('/api/setup/status');
}

const FIELD_CLS = 'mt-1 w-full rounded-lg border border-default bg-surface fg-primary placeholder-slate-400 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none';

export function Setup() {
  const statusQ = useQuery({ queryKey: ['setup'], queryFn: fetchStatus, retry: false });
  const [editingOidc, setEditingOidc] = useState(false);

  // step 1
  const [bootstrapToken, setBootstrapToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [step1Err, setStep1Err] = useState<string | null>(null);
  const [step1Busy, setStep1Busy] = useState(false);

  // Optional recovery credential for post-admin steps. Normally the
  // HttpOnly continuation cookie is sufficient.
  const [continuationToken, setContinuationToken] = useState('');

  // step 2
  const [providerId, setProviderId] = useState('pocketid');
  const [discoveryUrl, setDiscoveryUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [step2Err, setStep2Err] = useState<string | null>(null);
  const [step2Busy, setStep2Busy] = useState(false);

  // step 3
  const [step3Err, setStep3Err] = useState<string | null>(null);
  const [step3Busy, setStep3Busy] = useState(false);

  const continuationBody = () => {
    const token = continuationToken.trim();
    return token ? { token } : {};
  };

  const refreshStatus = async () => {
    await statusQ.refetch();
  };

  const onBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep1Err(null);
    setStep1Busy(true);
    try {
      await api.post('/api/setup/bootstrap-admin', {
        token: bootstrapToken, email, password, name,
      });
      setBootstrapToken('');
      setEmail('');
      setPassword('');
      setName('');
      await refreshStatus();
    } catch (err) {
      setStep1Err((err as Error).message);
    } finally {
      setStep1Busy(false);
    }
  };

  const onConfigureOidc = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep2Err(null);
    setStep2Busy(true);
    try {
      await api.post('/api/setup/configure-oidc', {
        ...continuationBody(), providerId, discoveryUrl, clientId, clientSecret,
        scopes: ['openid', 'email', 'profile'],
      });
      setClientSecret('');
      setEditingOidc(false);
      await refreshStatus();
    } catch (err) {
      setStep2Err((err as Error).message);
    } finally {
      setStep2Busy(false);
    }
  };

  const onComplete = async () => {
    setStep3Err(null);
    setStep3Busy(true);
    try {
      await api.post('/api/setup/review-oidc', continuationBody());
      await api.post('/api/setup/complete', continuationBody());
      setContinuationToken('');
      await refreshStatus();
    } catch (err) {
      setStep3Err((err as Error).message);
    } finally {
      setStep3Busy(false);
    }
  };

  // Skip OIDC entirely — the admin will sign in with email/password and
  // add a provider later from /settings.
  const onSkipOidc = async () => {
    setStep2Err(null);
    setStep2Busy(true);
    try {
      await api.post('/api/setup/complete', continuationBody());
      setContinuationToken('');
      await refreshStatus();
    } catch (err) {
      setStep2Err((err as Error).message);
    } finally {
      setStep2Busy(false);
    }
  };

  if (statusQ.isLoading) {
    return <div className="flex h-full items-center justify-center fg-muted bg-page">Loading…</div>;
  }

  if (statusQ.isError || !statusQ.data) {
    return (
      <div className="flex h-full items-center justify-center bg-page px-4">
        <div className="card w-full max-w-md space-y-4 text-center">
          <h1 className="text-lg font-semibold fg-primary">Setup status unavailable</h1>
          <p className="text-sm text-rose-600 dark:text-rose-400">
            {statusQ.error instanceof Error ? statusQ.error.message : 'Could not load setup status.'}
          </p>
          <button type="button" className="btn-primary" onClick={() => void statusQ.refetch()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const authoritativeStep = {
    admin: 1,
    'oidc-configure': 2,
    'oidc-review': 3,
    done: 4,
  }[statusQ.data.nextStep] as 1 | 2 | 3 | 4;
  const step = editingOidc && authoritativeStep === 3 ? 2 : authoritativeStep;

  return (
    <div className="h-full overflow-y-auto bg-page px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:flex sm:items-center sm:justify-center">
      <div className="w-full max-w-xl">
        <div className="flex items-center gap-2 mb-6">
          <img src="/logo.png" alt="Cura Money" className="h-10 w-10" />
          <h1 className="text-2xl font-bold fg-primary">Cura Money setup</h1>
        </div>

        <div className="card">
          {step === 1 && (
            <form onSubmit={onBootstrap} className="space-y-4">
              <h2 className="text-lg font-semibold fg-primary">1. Bootstrap the first admin</h2>
              <p className="text-sm fg-tertiary">
                The bootstrap token is printed to the <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">app</code> container logs
                on first boot (look for the &quot;SETUP BOOTSTRAP TOKEN&quot; banner). It
                expires in 1 hour; restart the container to regenerate.
              </p>
              <Field label="Bootstrap token" value={bootstrapToken} onChange={setBootstrapToken} mono />
              <Field label="Email" type="email" value={email} onChange={setEmail} />
              <Field label="Name" value={name} onChange={setName} />
              <Field label="Password (min 12 chars)" type="password" value={password} onChange={setPassword} />
              {step1Err && <p className="text-sm text-rose-600 dark:text-rose-400">{step1Err}</p>}
              <button type="submit" className="btn-primary" disabled={step1Busy}>
                {step1Busy ? 'Creating admin…' : 'Create admin'}
              </button>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={onConfigureOidc} className="space-y-4">
              <h2 className="text-lg font-semibold fg-primary">2. Configure an OIDC provider</h2>
              <p className="text-sm fg-tertiary">
                Point Cura Money at your identity provider. We recommend Pocket ID for
                a self-hosted, passkey-first setup. Discovery and callback URLs must use
                HTTPS, except localhost during development.
              </p>
              {editingOidc && (
                <p className="text-sm fg-tertiary">
                  Reconfiguring replaces the saved provider settings. The saved client secret cannot
                  be recovered, so you must re-enter it before saving.
                </p>
              )}
              <ContinuationTokenField value={continuationToken} onChange={setContinuationToken} />
              <p className="text-sm fg-tertiary">
                Not ready yet? You can skip this step and add a provider later from <strong>Settings</strong>.
                Sign-in with email and password will work either way.
              </p>
              <Field
                label="Provider ID (slug)"
                value={providerId}
                onChange={setProviderId}
                hint="Used in /api/auth/sign-in/oauth/{providerId}"
              />
              <Field
                label="Discovery URL"
                value={discoveryUrl}
                onChange={setDiscoveryUrl}
                placeholder="https://id.example.com/.well-known/openid-configuration"
              />
              <Field label="Client ID" value={clientId} onChange={setClientId} />
              <Field label="Client secret" type="password" value={clientSecret} onChange={setClientSecret} />
              {step2Err && <p className="text-sm text-rose-600 dark:text-rose-400">{step2Err}</p>}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:gap-4">
                  <button
                    type="button"
                    className="fg-tertiary text-sm underline"
                    onClick={onSkipOidc}
                    disabled={step2Busy}
                  >
                    Skip for now
                  </button>
                  <button type="submit" className="btn-primary w-full sm:w-auto" disabled={step2Busy}>
                    {step2Busy ? 'Validating…' : 'Save provider'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold fg-primary">3. Review OIDC and complete</h2>
              <p className="text-sm fg-tertiary">
                Your provider configuration is saved and registered. Completing setup does not
                perform an OIDC sign-in handshake.
              </p>
              <ContinuationTokenField value={continuationToken} onChange={setContinuationToken} />
              {step3Err && <p className="text-sm text-rose-600 dark:text-rose-400">{step3Err}</p>}
              <div className="flex justify-between">
                <button type="button" className="fg-tertiary text-sm" onClick={() => setEditingOidc(true)}>
                  Replace / reconfigure provider
                </button>
                <button onClick={onComplete} className="btn-primary" disabled={step3Busy}>
                  {step3Busy ? 'Completing…' : 'Complete setup'}
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3 text-center">
              <h2 className="text-lg font-semibold text-amber-600 dark:text-amber-400">Setup complete</h2>
              <p className="text-sm fg-tertiary">
                Redirecting you to the sign-in page…
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-center">
          <Stepper current={step} />
        </div>
        {!statusQ.data.needsAdmin && step < 4 && (
          <p className="mt-4 text-center text-sm fg-tertiary">
            Setup access expired?{' '}
            <Link className="font-medium text-amber-600 underline dark:text-amber-400" to="/sign-in?callbackURL=%2Fsetup">
              Sign in as an existing admin to continue setup
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, type = 'text', hint, mono, placeholder, required = true,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; hint?: string; mono?: boolean; placeholder?: string; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium fg-secondary">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${FIELD_CLS} ${mono ? 'font-mono' : ''}`}
        required={required}
      />
      {hint && <span className="mt-1 block text-xs fg-muted">{hint}</span>}
    </label>
  );
}

function ContinuationTokenField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Field
      label="Continuation bootstrap token (optional)"
      type="password"
      value={value}
      onChange={onChange}
      hint="Restart Cura Money to print a new current token in the logs, or sign in as an admin."
      mono
      required={false}
    />
  );
}

function Stepper({ current }: { current: 1 | 2 | 3 | 4 }) {
  const steps = ['Admin', 'OIDC', 'Review', 'Done'];
  return (
    <ol className="flex w-full items-center justify-center gap-1 sm:gap-2" aria-label={`Setup step ${current} of 4`}>
      {steps.map((label, idx) => {
        const n = (idx + 1) as 1 | 2 | 3 | 4;
        const active = n === current;
        const done = n < current;
        return (
          <li key={label} className="flex min-w-0 items-center gap-1.5 sm:gap-2">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                done
                  ? 'bg-amber-500 text-slate-900'
                  : active
                    ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-500 dark:bg-amber-900/40 dark:text-amber-300'
                    : 'bg-slate-100 dark:bg-slate-700 fg-muted'
              }`}
            >
              {n}
            </span>
            <span className={`hidden text-sm sm:inline ${active ? 'font-semibold fg-primary' : 'fg-tertiary'}`}>
              {label}
            </span>
            {idx < steps.length - 1 && <span className="h-px w-5 bg-slate-200 dark:bg-slate-700 sm:w-8" />}
          </li>
        );
      })}
    </ol>
  );
}
