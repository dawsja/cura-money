import { NavLink } from 'react-router-dom';
import {
  House,
  BarChart3,
  TrendingDown,
  Receipt,
  PiggyBank,
  FileText,
  ChevronsLeft,
  ChevronsRight,
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
 * Collapsed by default (just icons, ~72px wide). User clicks the
 * chevron at the bottom to expand for labels. No separator lines —
 * the sidebar and main area are separated purely by a subtle
 * background-color shift in the parent `Layout`.
 */
export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside
      // `h-full` fills the viewport (Layout is `h-screen`). The brand
      // (when expanded) and collapse button are `shrink-0` so they stay
      // pinned; the middle <nav> scrolls if it ever overflows.
      className={clsx(
        'hidden md:flex flex-col h-full bg-page transition-[width] duration-200',
        collapsed ? 'w-[72px]' : 'w-64',
      )}
    >
      {/* Logo only — always visible (collapsed or expanded). No text
          label. Same background as the main area so the rail blends
          in; only the icons + collapse toggle distinguish it. */}
      <div className={clsx('flex shrink-0 items-center gap-2 py-4', collapsed ? 'justify-center' : 'px-4')}>
        <img src="/logo.png" alt="Cura Money" className="h-8 w-8 shrink-0" />
      </div>

      <nav className={clsx('flex-1 overflow-y-auto p-2 space-y-1', collapsed && 'pt-4')}>
        {primaryItems.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to === '/'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                collapsed && 'justify-center',
                isActive
                  ? 'bg-amber-50 text-amber-700 shadow-sm shadow-amber-500/20 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'fg-secondary hover:bg-slate-100 dark:hover:bg-slate-800',
              )
            }
            title={collapsed ? it.label : undefined}
          >
            <it.icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span>{it.label}</span>}
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
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                collapsed && 'justify-center',
                isActive
                  ? 'bg-amber-50 text-amber-700 shadow-sm shadow-amber-500/20 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'fg-secondary hover:bg-slate-100 dark:hover:bg-slate-800',
              )
            }
            title={collapsed ? it.label : undefined}
          >
            <it.icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span>{it.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Collapse/expand toggle pinned to the bottom. Always visible
          so the user can always re-open the sidebar. */}
      <div className="shrink-0 p-2">
        <button
          onClick={onToggle}
          className={clsx(
            'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium fg-tertiary hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors',
            collapsed && 'justify-center',
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronsRight className="h-5 w-5 shrink-0" />
          ) : (
            <ChevronsLeft className="h-5 w-5 shrink-0" />
          )}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}