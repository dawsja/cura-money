import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileBottomNav } from './MobileBottomNav';

/**
 * Layout — viewport-locked frame:
 *   - The outer container is `h-full overflow-hidden` (filling
 *     html/body/#root which are also height-locked + overflow-hidden),
 *     so the document itself never scrolls. The only scrollable
 *     surfaces are:
 *       1. The sidebar's nav area (if it overflows) — keeps the
 *          brand + support link pinned to top/bottom.
 *       2. The main <main> — scrolls independently as the user reads
 *          a long transactions list, budget table, etc. The Header
 *          stays visible at the top of the main area. `min-h-0` and
 *          `overscroll-y-contain` keep flex sizing correct and stop
 *          Chromium from chaining wheel scroll past the shell.
 *   - Mobile uses the same outer constraint; the MobileBottomNav is
 *     `fixed` (separate stacking context) so it sits on top of the
 *     scrollable main without taking part in the flex layout.
 *
 *   Sidebar is icon-only (Monarch-style) by default and expands while
 *   hovered or while one of its controls has keyboard focus.
 */
export function Layout({ children }: { children: ReactNode }) {
  return (
    // Sidebar (`bg-page`) and main area (`bg-page`) share the same
    // background so the rail blends in; only the icon column + support
    // link distinguish it from the content area.
    <div className="app-shell flex bg-page overflow-hidden">
      <Sidebar />
      <div className="flex-1 min-w-0 min-h-0 flex flex-col h-full overflow-hidden">
        <Header />
        <main id="app-main" className="app-main app-mobile-bottom-space flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-4 pt-3 md:p-8 fg-primary">
          {children}
        </main>
        <MobileBottomNav />
      </div>
    </div>
  );
}
