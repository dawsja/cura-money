import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { FileText, FolderTree, Menu, PiggyBank, RefreshCw, ScrollText, X } from 'lucide-react';
import clsx from 'clsx';
import { NotificationBell } from './NotificationBell';
import { ProfileMenu } from './ProfileMenu';

const mobileMenuItems = [
  { to: '/saveup', label: 'Save up', icon: PiggyBank },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/recurring', label: 'Recurring', icon: RefreshCw },
  { to: '/categories', label: 'Categories', icon: FolderTree },
  { to: '/rules', label: 'Rules', icon: ScrollText },
];

const routeTitles: Record<string, string> = {
  '/': 'Overview',
  '/accounts': 'Accounts',
  '/budget': 'Budget',
  '/categories': 'Categories',
  '/transactions': 'Transactions',
  '/paydown': 'Pay down',
  '/saveup': 'Save up',
  '/reports': 'Reports',
  '/rules': 'Rules',
  '/recurring': 'Recurring',
  '/admin/settings': 'Settings',
};

/**
 * The Header carries mobile navigation + the notification bell + the
 * profile menu. User identity / sign-out live inside
 * the `ProfileMenu` dropdown — the visible chrome here is intentionally
 * minimal so the user focuses on the page content.
 *
 * The bell sits to the LEFT of the profile menu with a 4px gap. It
 * is always visible; the badge only appears when there's at least
 * one SimpleFIN-imported transaction awaiting review.
 */
export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const title = routeTitles[location.pathname] ?? 'Cura Money';

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  return (
    // `shrink-0` keeps the Header pinned at the top of the main area
    // while the page content scrolls beneath it. Without this, the
    // header would compress / scroll out of view the moment the main
    // content overflowed.
    <header className="app-header-safe relative z-40 shrink-0 flex min-h-[var(--app-header-height)] items-center justify-between border-b border-default/60 bg-page/95 px-3 backdrop-blur-xl md:min-h-0 md:border-b-0 md:bg-page md:px-8 md:py-3">
      <div ref={menuRef} className="relative flex min-w-0 items-center md:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={menuOpen}
          aria-controls="mobile-more-pages"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl fg-secondary hover:bg-slate-800 active:scale-95 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-[background-color,transform]"
        >
          {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>

        <h1 className="ml-1 truncate text-[1.05rem] font-bold tracking-tight fg-primary">{title}</h1>

        {menuOpen && (
          <nav
            id="mobile-more-pages"
            aria-label="More pages"
            className="absolute left-0 top-full mt-2 max-h-[calc(100dvh-var(--app-header-height)-var(--app-tab-height)-2rem)] w-64 overflow-y-auto rounded-2xl border border-default bg-surface p-2 shadow-2xl"
          >
            <div className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide fg-muted">
              More pages
            </div>
            {mobileMenuItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) => clsx(
                  'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-amber-900/30 text-amber-300'
                    : 'fg-secondary hover:bg-slate-800',
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        )}
      </div>
      {/* On md+ screens the sidebar carries the brand; the right cluster
          holds the bell + profile menu in a single flex row. The bell
          sits to the left of the avatar per spec. */}
      <div className="ml-auto flex items-center gap-3">
        <NotificationBell />
        <ProfileMenu />
      </div>
    </header>
  );
}
