import { NavLink } from 'react-router-dom';
import { House, Wallet, BarChart3, TrendingDown, Receipt } from 'lucide-react';
import clsx from 'clsx';

// Bottom nav for mobile (md- breakpoint). Shows the most-used
// destinations as icons, mirroring the desktop sidebar but trimmed to
// 5 items that fit on a phone screen. The paydown page is
// the debt-payoff calculator — Monarch-style. The full category list
// is reachable from the main Categories page.
const items = [
  { to: '/', label: 'Home', icon: House },
  { to: '/transactions', label: 'Txns', icon: Receipt },
  { to: '/budget', label: 'Budget', icon: BarChart3 },
  { to: '/paydown', label: 'Pay down', icon: TrendingDown },
  { to: '/accounts', label: 'Accounts', icon: Wallet },
];

export function MobileBottomNav() {
  return (
    <nav aria-label="Primary navigation" className="app-tab-bar md:hidden fixed bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] left-3 right-3 z-30 overflow-hidden rounded-[1.4rem] border border-default bg-surface/92 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl">
      <ul className="grid h-[var(--app-tab-height)] grid-cols-5 px-1">
        {items.map((it) => (
          <li key={it.to} className="h-full p-1.5">
            <NavLink
              to={it.to}
              data-onboarding-target={it.to === '/accounts' ? 'nav-accounts' : it.to === '/transactions' ? 'nav-transactions' : it.to === '/budget' ? 'nav-budget' : undefined}
              end={it.to === '/'}
              aria-label={it.label}
              className={({ isActive }) =>
                clsx(
                  'relative flex h-full min-w-0 items-center justify-center rounded-xl px-1 transition-[color,background-color,transform] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500',
                  isActive
                    ? 'text-amber-300 after:absolute after:left-1/2 after:top-1/2 after:h-9 after:w-12 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-amber-900/25'
                    : 'fg-tertiary',
                )
              }
            >
              <it.icon className="relative z-10 h-6 w-6" strokeWidth={2.2} />
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
