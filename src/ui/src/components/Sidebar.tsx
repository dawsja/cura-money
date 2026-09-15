import { NavLink } from 'react-router-dom';
import {
  House,
  BarChart3,
  TrendingDown,
  Receipt,
  PiggyBank,
  FileText,
  Coffee,
  Wallet,
  FolderTree,
  ScrollText,
  RefreshCw,
} from 'lucide-react';
import clsx from 'clsx';
import { Separator } from '@/components/ui/separator';

// Top group: daily working surfaces. Order matters — this is the order
// users see in the sidebar. Home first, then transactions, budget,
// paydown, then the planning surfaces (save up, reports).
const primaryItems = [
  { to: '/', label: 'Home', icon: House },
  { to: '/transactions', label: 'Transactions', icon: Receipt },
  { to: '/budget', label: 'Budget', icon: BarChart3 },
  { to: '/paydown', label: 'Pay down', icon: TrendingDown },
  { to: '/saveup', label: 'Save up', icon: PiggyBank },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/recurring', label: 'Recurring', icon: RefreshCw },
];

// Bottom group: settings-shaped destinations. A horizontal divider
// above this group keeps it visually separated from the working
// surfaces above (per the AGENTS.md UI constraint).
const settingsItems = [
  { to: '/accounts', label: 'Accounts', icon: Wallet },
  { to: '/categories', label: 'Categories', icon: FolderTree },
  { to: '/rules', label: 'Rules', icon: ScrollText },
];

/**
 * Sidebar — icon-rail navigation, Monarch-style.
 *
 * Collapsed by default (just icons, ~72px wide) and expands on hover
 * or keyboard focus to reveal its labels. No separator lines — the
 * sidebar and main area are separated purely by a subtle
 * background-color shift in the parent `Layout`.
 */
export function Sidebar() {
  return (
    <aside
      // `h-full` fills the Layout frame. The brand and support link are
      // `shrink-0` so they stay pinned; the middle
      // <nav> scrolls if it ever overflows.
      className="group/sidebar hidden h-full min-h-0 min-w-0 w-[72px] max-w-[72px] flex-col overflow-hidden bg-page transition-[width] duration-200 hover:w-64 hover:max-w-64 focus-within:w-64 focus-within:max-w-64 md:flex"
    >
      {/* Logo only — always visible. No text label. */}
      <div className="flex shrink-0 items-center justify-center gap-2 py-4 group-hover/sidebar:justify-start group-hover/sidebar:px-4 group-focus-within/sidebar:justify-start group-focus-within/sidebar:px-4">
        <img src="/logo.png" alt="Cura Money" className="size-8 shrink-0" />
      </div>

      <nav className="hide-scrollbar flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-x-clip overflow-y-auto overscroll-y-contain p-2 pt-4">
        {primaryItems.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            data-onboarding-target={it.to === '/transactions' ? 'nav-transactions' : it.to === '/budget' ? 'nav-budget' : undefined}
            end={it.to === '/'}
            onClick={(event) => event.currentTarget.blur()}
            className={({ isActive }) =>
              clsx(
                'flex min-w-0 items-center justify-center gap-3 overflow-hidden rounded-lg px-3 py-2 text-sm font-medium transition-colors group-hover/sidebar:justify-start group-focus-within/sidebar:justify-start',
                isActive
                  ? 'bg-amber-50 text-amber-700 shadow-sm shadow-amber-500/20 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'fg-secondary hover:bg-slate-100 dark:hover:bg-slate-800',
              )
            }
            aria-label={it.label}
          >
            <it.icon className="size-5 shrink-0" />
            <span className="hidden min-w-0 truncate group-hover/sidebar:inline group-focus-within/sidebar:inline">
              {it.label}
            </span>
          </NavLink>
        ))}
        <div className="min-w-0 px-2 py-2">
          <Separator />
        </div>
        {settingsItems.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            data-onboarding-target={it.to === '/accounts' ? 'nav-accounts' : undefined}
            onClick={(event) => event.currentTarget.blur()}
            className={({ isActive }) =>
              clsx(
                'flex min-w-0 items-center justify-center gap-3 overflow-hidden rounded-lg px-3 py-2 text-sm font-medium transition-colors group-hover/sidebar:justify-start group-focus-within/sidebar:justify-start',
                isActive
                  ? 'bg-amber-50 text-amber-700 shadow-sm shadow-amber-500/20 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'fg-secondary hover:bg-slate-100 dark:hover:bg-slate-800',
              )
            }
            aria-label={it.label}
          >
            <it.icon className="size-5 shrink-0" />
            <span className="hidden min-w-0 truncate group-hover/sidebar:inline group-focus-within/sidebar:inline">
              {it.label}
            </span>
          </NavLink>
        ))}
      </nav>

      {/* Support link stays pinned to the bottom of the icon rail. */}
      <div className="min-w-0 shrink-0 overflow-hidden p-2">
        <a
          href="https://buymeacoffee.com/curamoney"
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full min-w-0 items-center justify-center gap-3 overflow-hidden rounded-lg px-3 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50 group-hover/sidebar:justify-start group-focus-within/sidebar:justify-start dark:text-amber-300 dark:hover:bg-amber-900/30"
          aria-label="Buy me a coffee"
        >
          <Coffee className="coffee-accent size-5 shrink-0" />
          <span className="hidden min-w-0 truncate group-hover/sidebar:inline group-focus-within/sidebar:inline">
            Buy me a coffee
          </span>
        </a>
      </div>
    </aside>
  );
}
