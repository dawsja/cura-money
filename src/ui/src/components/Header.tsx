import { useLocation } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';
import { ProfileMenu } from './ProfileMenu';

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
 * The Header carries the mobile page title, notification bell, and profile
 * menu. User identity / sign-out live inside
 * the `ProfileMenu` dropdown — the visible chrome here is intentionally
 * minimal so the user focuses on the page content.
 *
 * The bell sits to the LEFT of the profile menu with a 4px gap. It
 * is always visible; the badge only appears when there's at least
 * one SimpleFIN-imported transaction awaiting review.
 */
export function Header() {
  const location = useLocation();
  const title = routeTitles[location.pathname] ?? 'Cura Money';

  return (
    // `shrink-0` keeps the Header pinned at the top of the main area
    // while the page content scrolls beneath it. Without this, the
    // header would compress / scroll out of view the moment the main
    // content overflowed.
    <header className="app-header-safe relative z-40 shrink-0 flex min-h-[var(--app-header-height)] items-center justify-between bg-page/95 px-3 backdrop-blur-xl md:min-h-0 md:bg-page md:px-8 md:py-3">
      <div className="min-w-0 md:hidden">
        <h1 className="truncate text-[1.05rem] font-bold tracking-tight fg-primary">{title}</h1>
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
