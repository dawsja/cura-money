import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemePreference = 'system' | 'dark' | 'light';

const THEME_STORAGE_KEY = 'cura.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function storedPreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'dark' || stored === 'light' ? stored : 'system';
}

function isDark(preference: ThemePreference): boolean {
  return preference === 'dark'
    || (preference === 'system' && window.matchMedia(DARK_QUERY).matches);
}

function applyTheme(preference: ThemePreference) {
  const dark = isDark(preference);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.theme = preference;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#0d1117' : '#d9e0e5');
  return dark;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(storedPreference);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() =>
    isDark(storedPreference()) ? 'dark' : 'light',
  );

  useEffect(() => {
    setResolved(applyTheme(preference) ? 'dark' : 'light');
    localStorage.setItem(THEME_STORAGE_KEY, preference);

    if (preference !== 'system') return;
    const media = window.matchMedia(DARK_QUERY);
    const syncWithSystem = () => setResolved(applyTheme('system') ? 'dark' : 'light');
    media.addEventListener('change', syncWithSystem);
    return () => media.removeEventListener('change', syncWithSystem);
  }, [preference]);

  const setPreference = (next: ThemePreference) => {
    setResolved(applyTheme(next) ? 'dark' : 'light');
    setPreferenceState(next);
  };

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used within ThemeProvider');
  return theme;
}
