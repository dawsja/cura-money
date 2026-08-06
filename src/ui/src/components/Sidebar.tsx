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

// Top group: daily working surfaces. Order matters — this is the order
// users see in the sidebar. Dashboard first, then transactions, budget,
// paydown, then the planning surfaces (save up, reports).
const primaryItems = [
  { to: '/', label: 'Dashboard', icon: House },
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
      className="group/sidebar hidden md:flex w-[72px] hover:w-64 focus-within:w-64 flex-col h-full min-h-0 overflow-hidden bg-page transition-[width] duration-200"
    >
      {/* Logo only — always visible. No text label. */}
      <div className="flex shrink-0 items-center justify-center gap-2 py-4 group-hover/sidebar:justify-start group-hover/sidebar:px-4 group-focus-within/sidebar:justify-start group-focus-within/sidebar:px-4">
        <img src="/logo.png" alt="Cura Money" className="h-8 w-8 shrink-0" />
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain p-2 pt-4 space-y-1">
        {primaryItems.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to === '/'}
            onClick={(event) => event.currentTarget.blur()}
            className={({ isActive }) =>
              clsx(
                'flex items-center justify-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors group-hover/sidebar:justify-start group-focus-within/sidebar:justify-start',
                isActive
                  ? 'bg-amber-50 text-amber-700 shadow-sm shadow-amber-500/20 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'fg-secondary hover:bg-slate-100 dark:hover:bg-slate-800',
              )
            }
            aria-label={it.label}
          >
            <it.icon className="h-5 w-5 shrink-0" />
            <span className="hidden whitespace-nowrap group-hover/sidebar:inline group-focus-within/sidebar:inline">
              {it.label}
            </span>
          </NavLink>
        ))}
        {/* Separator above the settings-shaped group so Accounts,
            Categories, and Rules stay visually distinct from the
            daily-working surfaces above. Horizontal margins shorten
            the bar on both sides so it reads as a clean inset
            divider rather than a full-width rule. */}
        <div className="my-2 mx-4 border-t border-default" aria-hidden="true" />
        {settingsItems.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            onClick={(event) => event.currentTarget.blur()}
            className={({ isActive }) =>
              clsx(
                'flex items-center justify-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors group-hover/sidebar:justify-start group-focus-within/sidebar:justify-start',
                isActive
                  ? 'bg-amber-50 text-amber-700 shadow-sm shadow-amber-500/20 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'fg-secondary hover:bg-slate-100 dark:hover:bg-slate-800',
              )
            }
            aria-label={it.label}
          >
            <it.icon className="h-5 w-5 shrink-0" />
            <span className="hidden whitespace-nowrap group-hover/sidebar:inline group-focus-within/sidebar:inline">
              {it.label}
            </span>
          </NavLink>
        ))}
      </nav>

      {/* Support link stays pinned to the bottom of the icon rail. */}
      <div className="shrink-0 p-2">
        <a
          href="https://buymeacoffee.com/curamoney"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors group-hover/sidebar:justify-start group-focus-within/sidebar:justify-start"
          aria-label="Buy me a coffee"
        >
          <Coffee className="coffee-accent h-5 w-5 shrink-0" />
          <span className="hidden whitespace-nowrap group-hover/sidebar:inline group-focus-within/sidebar:inline">
            Buy me a coffee
          </span>
        </a>
      </div>
    </aside>
  );
}
