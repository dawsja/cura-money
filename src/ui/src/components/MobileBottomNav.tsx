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
    <nav className="md:hidden fixed bottom-0 inset-x-0 bg-surface/90 dark:bg-slate-900/90 backdrop-blur-md border-t border-default z-30">
      <ul className="grid grid-cols-5">
        {items.map((it) => (
          <li key={it.to}>
            <NavLink
              to={it.to}
              end={it.to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex flex-col items-center justify-center gap-1 py-2 text-xs',
                  isActive
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'fg-tertiary',
                )
              }
            >
              <it.icon className="h-5 w-5" />
              <span>{it.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
