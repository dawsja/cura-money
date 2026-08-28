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
import { AuthError, AuthPage, AuthPanel, AuthTextField } from '../components/AuthScreen';
import { AsyncQueryState } from '../components/ui/AsyncQueryState';

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

export function Setup() {
  const statusQ = useQuery({ queryKey: ['setup'], queryFn: fetchStatus, retry: false });
  const [editingOidc, setEditingOidc] = useState(false);

  const [bootstrapToken, setBootstrapToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [step1Err, setStep1Err] = useState<string | null>(null);
  const [step1Busy, setStep1Busy] = useState(false);

  const [continuationToken, setContinuationToken] = useState('');

  const [providerId, setProviderId] = useState('pocketid');
  const [discoveryUrl, setDiscoveryUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [step2Err, setStep2Err] = useState<string | null>(null);
  const [step2Busy, setStep2Busy] = useState(false);

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
    return (
      <AuthPage width="xl">
        <AuthPanel>
          <AsyncQueryState
            status="loading"
            title="Loading setup…"
            message="Checking this instance."
          />
        </AuthPanel>
      </AuthPage>
    );
  }

  if (statusQ.isError || !statusQ.data) {
    return (
      <AuthPage width="xl">
        <AuthPanel>
          <AsyncQueryState
            status="error"
            title="Setup status unavailable"
            message={statusQ.error instanceof Error ? statusQ.error.message : 'Could not load setup status.'}
            onRetry={() => void statusQ.refetch()}
            retrying={statusQ.isFetching}
          />
        </AuthPanel>
      </AuthPage>
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
    <AuthPage width="xl">
      <div className="mb-6 flex items-center gap-2">
        <img src="/logo.png" alt="Cura Money" className="h-10 w-10" />
        <h1 className="text-2xl font-bold fg-primary">Cura Money setup</h1>
      </div>

      <AuthPanel>
        {step === 1 && (
          <form onSubmit={onBootstrap} className="space-y-4">
            <h2 className="text-lg font-semibold fg-primary">1. Bootstrap the first admin</h2>
            <p className="text-sm fg-tertiary">
              The bootstrap token is printed to the <code className="rounded bg-canvas-subtle px-1">app</code> container logs
              on first boot (look for the &quot;SETUP BOOTSTRAP TOKEN&quot; banner). It
              expires in 1 hour; restart the container to regenerate.
            </p>
            <AuthTextField
              label="Bootstrap token"
              value={bootstrapToken}
              onChange={setBootstrapToken}
              autoComplete="off"
              mono
              disabled={step1Busy}
            />
            <AuthTextField
              label="Email"
              type="email"
              name="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              disabled={step1Busy}
            />
            <AuthTextField
              label="Name"
              name="name"
              value={name}
              onChange={setName}
              autoComplete="name"
              disabled={step1Busy}
            />
            <AuthTextField
              label="Password (min 12 chars)"
              type="password"
              name="password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              disabled={step1Busy}
            />
            {step1Err && <AuthError message={step1Err} />}
            <button type="submit" className="btn-primary w-full sm:w-auto" disabled={step1Busy}>
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
            <ContinuationTokenField value={continuationToken} onChange={setContinuationToken} disabled={step2Busy} />
            <p className="text-sm fg-tertiary">
              Not ready yet? You can skip this step and add a provider later from <strong>Settings</strong>.
              Sign-in with email and password will work either way.
            </p>
            <AuthTextField
              label="Provider ID (slug)"
              value={providerId}
              onChange={setProviderId}
              hint="Used in /api/auth/sign-in/oauth/{providerId}"
              disabled={step2Busy}
            />
            <AuthTextField
              label="Discovery URL"
              value={discoveryUrl}
              onChange={setDiscoveryUrl}
              placeholder="https://id.example.com/.well-known/openid-configuration"
              disabled={step2Busy}
            />
            <AuthTextField
              label="Client ID"
              value={clientId}
              onChange={setClientId}
              disabled={step2Busy}
            />
            <AuthTextField
              label="Client secret"
              type="password"
              value={clientSecret}
              onChange={setClientSecret}
              disabled={step2Busy}
            />
            {step2Err && <AuthError message={step2Err} />}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:gap-4">
                <button
                  type="button"
                  className="text-sm fg-tertiary underline"
                  onClick={() => void onSkipOidc()}
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
            <ContinuationTokenField value={continuationToken} onChange={setContinuationToken} disabled={step3Busy} />
            {step3Err && <AuthError message={step3Err} />}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                className="text-sm fg-tertiary"
                onClick={() => setEditingOidc(true)}
                disabled={step3Busy}
              >
                Replace / reconfigure provider
              </button>
              <button onClick={() => void onComplete()} className="btn-primary w-full sm:w-auto" disabled={step3Busy}>
                {step3Busy ? 'Completing…' : 'Complete setup'}
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3 text-center">
            <h2 className="text-lg font-semibold fg-primary">Setup complete</h2>
            <p className="text-sm fg-secondary">
              Redirecting you to the sign-in page…
            </p>
          </div>
        )}
      </AuthPanel>

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
    </AuthPage>
  );
}

function ContinuationTokenField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <AuthTextField
      label="Continuation bootstrap token (optional)"
      type="password"
      value={value}
      onChange={onChange}
      hint="Restart Cura Money to print a new current token in the logs, or sign in as an admin."
      autoComplete="off"
      mono
      required={false}
      disabled={disabled}
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
                    : 'bg-canvas-subtle fg-muted'
              }`}
            >
              {n}
            </span>
            <span className={`hidden text-sm sm:inline ${active ? 'font-semibold fg-primary' : 'fg-tertiary'}`}>
              {label}
            </span>
            {idx < steps.length - 1 && <span className="h-px w-5 border-t border-default sm:w-8" />}
          </li>
        );
      })}
    </ol>
  );
}
