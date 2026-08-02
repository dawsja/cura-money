/**
 * Theme management — light / dark mode with persistence.
 *
 * The first-paint flash is avoided by an inline script in index.html
 * that reads localStorage and adds the `.dark` class to <html> BEFORE
 * React mounts. Once the app is running, this module owns the runtime
 * state and exposes `getTheme` / `setTheme` / `toggleTheme` so any
 * component can react to changes.
 *
 * Storage key: 'cura.theme' — must match the inline script in
 * src/ui/index.html (changing one without the other re-introduces FOUC).
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'cura.theme';

/** Read the current theme from the document. Used for initial state. */
export function getTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** Persist + apply a theme. Triggers a re-render via the custom event. */
export function setTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* localStorage blocked (private mode, etc.) — toggle still works for
       the current session, just won't survive a reload. */
  }
  window.dispatchEvent(new CustomEvent<Theme>('cura:theme', { detail: theme }));
}

/** Toggle light <-> dark. Returns the new theme. */
export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

/** Add/remove the `dark` class on the document root. */
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

/**
 * Hook: subscribe to theme changes. Returns an unsubscribe function.
 * Use this in components that render differently in dark mode without
 * re-rendering the whole tree on every toggle.
 */
export function onThemeChange(listener: (theme: Theme) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<Theme>).detail);
  window.addEventListener('cura:theme', handler);
  return () => window.removeEventListener('cura:theme', handler);
}
