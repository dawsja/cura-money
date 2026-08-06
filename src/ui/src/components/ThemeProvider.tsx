import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemePreference = 'system' | 'dark' | 'light';

const THEME_STORAGE_KEY = 'cura.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

interface ThemeContextValue {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function storedPreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'dark' || stored === 'light' ? stored : 'system';
}

function applyTheme(preference: ThemePreference) {
  const dark = preference === 'dark'
    || (preference === 'system' && window.matchMedia(DARK_QUERY).matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.theme = preference;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#0d1117' : '#d9e0e5');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(storedPreference);

  useEffect(() => {
    applyTheme(preference);
    localStorage.setItem(THEME_STORAGE_KEY, preference);

    if (preference !== 'system') return;
    const media = window.matchMedia(DARK_QUERY);
    const syncWithSystem = () => applyTheme('system');
    media.addEventListener('change', syncWithSystem);
    return () => media.removeEventListener('change', syncWithSystem);
  }, [preference]);

  const setPreference = (next: ThemePreference) => {
    applyTheme(next);
    setPreferenceState(next);
  };

  return (
    <ThemeContext.Provider value={{ preference, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used within ThemeProvider');
  return theme;
}
