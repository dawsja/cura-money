import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { getTheme, setTheme, type Theme } from '../lib/theme';

/**
 * Light / dark toggle. Renders the icon for the OPPOSITE theme (Sun
 * when in dark mode, Moon when in light) — the convention is "click to
 * switch to this". The current theme is read from the document on
 * mount and updated live via the `cura:theme` custom event so multiple
 * toggles in different parts of the tree stay in sync.
 *
 * `label` adds a text label for use in the profile menu (vs icon-only
 * in narrow contexts).
 */
export function ThemeToggle({ label = false }: { label?: boolean }) {
  const [theme, setLocal] = useState<Theme>(() => getTheme());

  // Stay in sync if another component toggles the theme.
  useEffect(() => {
    const handler = (e: Event) => setLocal((e as CustomEvent<Theme>).detail);
    window.addEventListener('cura:theme', handler);
    return () => window.removeEventListener('cura:theme', handler);
  }, []);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const Icon = theme === 'dark' ? Sun : Moon;
  const action = theme === 'dark' ? 'Light mode' : 'Dark mode';

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm fg-secondary hover:bg-slate-100 dark:hover:bg-slate-700"
      aria-label={`Switch to ${action.toLowerCase()}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label ? <span className="flex-1 text-left">{action}</span> : null}
    </button>
  );
}
