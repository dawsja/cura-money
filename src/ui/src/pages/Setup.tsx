/**
 * First-run wizard. Four steps:
 *   1. Bootstrap token + first admin
 *   2. Configure OIDC provider (or skip — admin can add one later in /admin/settings)
 *   3. Test OIDC handshake (only reached if OIDC was configured, not if skipped)
 *   4. Done — redirect to /sign-in
 *
 * The bootstrap token is printed to the `app` container logs on first
 * boot (see src/auth/setup.ts → ensureSetupState). Operators copy-paste
 * it into step 1.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

interface SetupStatus {
  needsSetup: boolean;
  bootstrapCompleted: boolean;
  oidcConfigured: boolean;
  bootstrapTokenRequired: boolean;
}

async function fetchStatus(): Promise<SetupStatus> {
  return api.get<SetupStatus>('/api/setup/status');
}

const FIELD_CLS = 'mt-1 w-full rounded-lg border border-default bg-surface fg-primary placeholder-slate-400 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none';

export function Setup() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const statusQ = useQuery({ queryKey: ['setup'], queryFn: fetchStatus });

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // step 1
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [step1Err, setStep1Err] = useState<string | null>(null);
  const [step1Busy, setStep1Busy] = useState(false);

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

  const onBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep1Err(null);
    setStep1Busy(true);
    try {
      await api.post('/api/setup/bootstrap-admin', {
        token, email, password, name,
      });
      await qc.invalidateQueries({ queryKey: ['setup'] });
      setStep(2);
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
        providerId, discoveryUrl, clientId, clientSecret,
        scopes: ['openid', 'email', 'profile'],
      });
      await qc.invalidateQueries({ queryKey: ['setup'] });
      setStep(3);
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
      await api.post('/api/setup/test-oidc');
      await api.post('/api/setup/complete');
      await qc.invalidateQueries({ queryKey: ['setup'] });
      setStep(4);
      setTimeout(() => navigate('/sign-in'), 1500);
    } catch (err) {
      setStep3Err((err as Error).message);
    } finally {
      setStep3Busy(false);
    }
  };

  // Skip OIDC entirely — the admin will sign in with email/password and
  // add a provider later from /admin/settings. We jump straight to step 4.
  const onSkipOidc = async () => {
    setStep2Err(null);
    setStep2Busy(true);
    try {
      await api.post('/api/setup/complete');
      await qc.invalidateQueries({ queryKey: ['setup'] });
      setStep(4);
      setTimeout(() => navigate('/sign-in'), 1500);
    } catch (err) {
      setStep2Err((err as Error).message);
    } finally {
      setStep2Busy(false);
    }
  };

  if (statusQ.isLoading) {
    return <div className="flex h-full items-center justify-center fg-muted bg-page">Loading…</div>;
  }

  return (
    <div className="min-h-full flex items-center justify-center p-4 bg-page">
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
              <Field label="Bootstrap token" value={token} onChange={setToken} mono />
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
                a self-hosted, passkey-first setup. After saving, restart the{' '}
                <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">app</code> container so Better Auth registers the provider.
              </p>
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
              <div className="flex justify-between">
                <button type="button" className="fg-tertiary text-sm" onClick={() => setStep(1)}>
                  ← Back
                </button>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    className="fg-tertiary text-sm underline"
                    onClick={onSkipOidc}
                    disabled={step2Busy}
                  >
                    Skip for now
                  </button>
                  <button type="submit" className="btn-primary" disabled={step2Busy}>
                    {step2Busy ? 'Validating…' : 'Save provider'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold fg-primary">3. Test the OIDC handshake</h2>
              <p className="text-sm fg-tertiary">
                Once you restart the <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">app</code> container and return to this
                page, click below to verify the provider is registered. The
                server will also mark the bootstrap complete.
              </p>
              {step3Err && <p className="text-sm text-rose-600 dark:text-rose-400">{step3Err}</p>}
              <div className="flex justify-between">
                <button type="button" className="fg-tertiary text-sm" onClick={() => setStep(2)}>
                  ← Back
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
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, type = 'text', hint, mono, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; hint?: string; mono?: boolean; placeholder?: string;
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
        required
      />
      {hint && <span className="mt-1 block text-xs fg-muted">{hint}</span>}
    </label>
  );
}

function Stepper({ current }: { current: 1 | 2 | 3 | 4 }) {
  const steps = ['Admin', 'OIDC', 'Test', 'Done'];
  return (
    <ol className="flex items-center gap-2">
      {steps.map((label, idx) => {
        const n = (idx + 1) as 1 | 2 | 3 | 4;
        const active = n === current;
        const done = n < current;
        return (
          <li key={label} className="flex items-center gap-2">
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
            <span className={`text-sm ${active ? 'font-semibold fg-primary' : 'fg-tertiary'}`}>
              {label}
            </span>
            {idx < steps.length - 1 && <span className="w-8 h-px bg-slate-200 dark:bg-slate-700" />}
          </li>
        );
      })}
    </ol>
  );
}
