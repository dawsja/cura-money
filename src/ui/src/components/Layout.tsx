import { useEffect, useState, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileBottomNav } from './MobileBottomNav';

const SIDEBAR_COLLAPSED_KEY = 'cura.sidebar.collapsed';

/**
 * Layout — viewport-locked frame:
 *   - The outer container is `h-screen overflow-hidden`, so the page
 *     itself never scrolls. The only scrollable surfaces are:
 *       1. The sidebar's nav area (if it overflows) — keeps the
 *          brand + collapse button pinned to top/bottom.
 *       2. The main <main> — scrolls independently as the user reads
 *          a long transactions list, budget table, etc. The Header
 *          stays visible at the top of the main area.
 *   - Mobile uses the same outer constraint; the MobileBottomNav is
 *     `fixed` (separate stacking context) so it sits on top of the
 *     scrollable main without taking part in the flex layout.
 *
 *   Sidebar is icon-only (Monarch-style) by default. The user's
 *   expand/collapse choice persists in localStorage.
 */
export function Layout({ children }: { children: ReactNode }) {
  // Start collapsed (icon-rail) by default. Read the user's prior
  // preference from localStorage on first render so the choice
  // survives reloads.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) !== 'false';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? 'true' : 'false');
    } catch {
      /* private mode — just skip persistence */
    }
  }, [collapsed]);

  return (
    // Sidebar (`bg-page`) and main area (`bg-page`) share the same
    // background so the rail blends in; only the icon column + collapse
    // toggle distinguish it from the content area.
    <div className="h-screen flex bg-page overflow-hidden">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8 fg-primary">
          {children}
        </main>
        <MobileBottomNav />
      </div>
    </div>
  );
}
