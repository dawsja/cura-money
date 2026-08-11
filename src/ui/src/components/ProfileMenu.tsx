import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Check, CircleHelp, Laptop, LogOut, Moon, Settings, Sun } from 'lucide-react';
import clsx from 'clsx';
import { fetchMe, signOut, SIGNOUT_FLAG_KEY } from '../lib/auth';
import { useFinancialOnboarding } from './FinancialOnboardingProvider';
import { useTheme, type ThemePreference } from './ThemeProvider';

const themeOptions: Array<{
  value: ThemePreference;
  label: string;
  icon: typeof Laptop;
}> = [
  { value: 'system', label: 'System', icon: Laptop },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
];

/**
 * Profile menu — click the avatar to open a dropdown with:
 *   - User's full name + email
 *   - Settings
 *   - Sign out
 *
 * Closes on: click outside, Escape.
 */
export function ProfileMenu() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const onboarding = useFinancialOnboarding();
  const { preference, setPreference } = useTheme();
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const onSignOut = async () => {
    setOpen(false);
    await signOut();
    // The flag MUST be stashed BEFORE invalidating me — the redirect to
    // /sign-in happens automatically once meQ.data becomes null, and the
    // flag needs to survive that redirect so SignIn can force prompt=login
    // on the next OIDC click.
    sessionStorage.setItem(SIGNOUT_FLAG_KEY, '1');
    qc.invalidateQueries({ queryKey: ['me'] });
  };

  const name = me.data ? displayName(me.data.user) : '—';
  const email = me.data?.user.email ?? '';
  const initials = me.data ? initialsFor(name) : '?';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-11 items-center justify-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open profile menu"
      >
        <div
          className={clsx(
            'h-9 w-9 rounded-full flex items-center justify-center',
            'bg-amber-100 text-amber-700 font-semibold text-xs',
            'ring-1 ring-amber-200',
            'dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-700/50',
            'hover:ring-amber-400 dark:hover:ring-amber-500 transition-shadow',
          )}
        >
          {initials}
        </div>
      </button>

      {open && (
        <div
          role="menu"
          className={clsx(
            'absolute right-0 mt-2 w-64 rounded-xl shadow-lg z-40',
            'bg-surface border border-default ring-1 ring-black/5',
            'dark:ring-white/10',
          )}
        >
          {/* User identity block. Email in muted text underneath the name. */}
          <div className="px-4 py-3 border-b border-default">
            <div className="text-sm font-semibold fg-primary">
              {name}
            </div>
            <div
              className="text-xs fg-muted truncate"
              title={email}
            >
              {email}
            </div>
          </div>

          <div className="p-1.5">
            <div role="group" aria-label="Appearance">
              <div className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide fg-muted">
                Appearance
              </div>
              {themeOptions.map((option) => {
                const Icon = option.icon;
                const selected = preference === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPreference(option.value)}
                    className={clsx(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                      selected
                        ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                        : 'fg-secondary hover:bg-slate-100 dark:hover:bg-slate-700',
                    )}
                    role="menuitemradio"
                    aria-checked={selected}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 text-left">{option.label}</span>
                    {selected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 border-t border-default pt-1">
              <button
                type="button"
                onClick={() => go('/settings')}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm fg-secondary hover:bg-slate-100 dark:hover:bg-slate-700"
                role="menuitem"
              >
                <Settings className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">Settings</span>
              </button>
            </div>
            <div className="mt-1 border-t border-default pt-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onboarding.restart();
                }}
                disabled={onboarding.isSaving}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm fg-secondary hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
                role="menuitem"
              >
                <CircleHelp className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">Tutorial</span>
              </button>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30"
              role="menuitem"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">Sign out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Display name from the user record, with a sensible fallback chain. */
function displayName(user: { name: string; email: string }): string {
  const n = user.name?.trim();
  if (n) return n;
  const local = user.email?.split('@')[0]?.trim();
  if (local) return local;
  return 'User';
}

/** Initials: first letter of first + first letter of last, uppercased. */
function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]![0]!.toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
