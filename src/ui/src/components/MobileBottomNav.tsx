import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  BarChart3,
  FileText,
  FolderTree,
  House,
  Menu,
  PiggyBank,
  Receipt,
  RefreshCw,
  ScrollText,
  TrendingDown,
  Wallet,
  X,
} from 'lucide-react';
import clsx from 'clsx';

// Bottom nav for mobile (md- breakpoint). The four most-used destinations
// stay one tap away; the rightmost control opens the remaining destinations
// directly above the user's thumb.
const items = [
  { to: '/', label: 'Home', icon: House },
  { to: '/transactions', label: 'Txns', icon: Receipt },
  { to: '/budget', label: 'Budget', icon: BarChart3 },
  { to: '/paydown', label: 'Pay down', icon: TrendingDown },
];

const menuItems = [
  { to: '/accounts', label: 'Accounts', icon: Wallet },
  { to: '/saveup', label: 'Save up', icon: PiggyBank },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/recurring', label: 'Recurring', icon: RefreshCw },
  { to: '/categories', label: 'Categories', icon: FolderTree },
  { to: '/rules', label: 'Rules', icon: ScrollText },
];

export function MobileBottomNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const menuRouteActive = menuItems.some((item) => item.to === location.pathname);

  useEffect(() => {
    if (!menuOpen) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };

    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <div ref={navRef} className="md:hidden fixed bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] left-3 right-3 z-30">
      <nav aria-label="Primary navigation" className="app-tab-bar rounded-[1.4rem] border border-default bg-surface/92 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl">
        <ul className="grid h-[var(--app-tab-height)] grid-cols-5 px-1">
          {items.map((it) => (
            <li key={it.to} className="h-full p-1.5">
              <NavLink
                to={it.to}
                data-onboarding-target={it.to === '/transactions' ? 'nav-transactions' : it.to === '/budget' ? 'nav-budget' : undefined}
                end={it.to === '/'}
                aria-label={it.label}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  clsx(
                    'relative flex h-full min-w-0 items-center justify-center rounded-xl px-1 transition-[color,background-color,transform] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500',
                    isActive
                      ? 'text-amber-700 after:absolute after:left-1/2 after:top-1/2 after:h-9 after:w-12 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-amber-50 dark:text-amber-300 dark:after:bg-amber-900/25'
                      : 'fg-tertiary',
                  )
                }
              >
                <it.icon className="relative z-10 h-6 w-6" strokeWidth={2.2} />
              </NavLink>
            </li>
          ))}
          <li className="relative h-full p-1.5">
            <button
              ref={menuButtonRef}
              type="button"
              data-onboarding-target="nav-accounts"
              aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={menuOpen}
              aria-controls="mobile-more-pages"
              onClick={() => setMenuOpen((open) => !open)}
              className={clsx(
                'relative flex h-full w-full min-w-0 items-center justify-center rounded-xl px-1 transition-[color,background-color,transform] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500',
                menuOpen || menuRouteActive
                  ? 'text-amber-700 after:absolute after:left-1/2 after:top-1/2 after:h-9 after:w-12 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-amber-50 dark:text-amber-300 dark:after:bg-amber-900/25'
                  : 'fg-tertiary',
              )}
            >
              {menuOpen
                ? <X className="relative z-10 h-6 w-6" strokeWidth={2.2} />
                : <Menu className="relative z-10 h-6 w-6" strokeWidth={2.2} />}
            </button>
          </li>
        </ul>
      </nav>

      {menuOpen && (
        <div
          id="mobile-more-pages"
          className="absolute bottom-full right-0 mb-2 max-h-[calc(100dvh-var(--app-header-height)-var(--app-tab-height)-2rem)] w-64 overflow-y-auto rounded-2xl border border-default bg-surface/92 p-2 shadow-2xl backdrop-blur-xl"
        >
          <div className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide fg-muted">
            More pages
          </div>
          {menuItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => clsx(
                'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'fg-secondary hover:bg-slate-100 dark:hover:bg-slate-800',
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
