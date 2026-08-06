import { NavLink } from 'react-router-dom';
import { House, Wallet, BarChart3, TrendingDown, Receipt } from 'lucide-react';
import clsx from 'clsx';

// Bottom nav for mobile (md- breakpoint). Shows the most-used
// destinations in icon + label form, mirroring the desktop sidebar but
// trimmed to 5 items that fit on a phone screen. The paydown page is
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
              end={it.to === '/'}
              className={({ isActive }) =>
                clsx(
                  'relative flex h-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[0.6875rem] font-medium transition-[color,background-color,transform] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500',
                  isActive
                    ? 'bg-amber-900/25 text-amber-300'
                    : 'fg-tertiary',
                )
              }
            >
              <it.icon className="h-[1.35rem] w-[1.35rem]" strokeWidth={2.2} />
              <span className="truncate">{it.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
