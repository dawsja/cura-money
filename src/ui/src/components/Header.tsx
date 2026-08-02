import { NotificationBell } from './NotificationBell';
import { ProfileMenu } from './ProfileMenu';

/**
 * The Header is now just the brand strip on mobile + the notification
 * bell + the profile menu on the right. The user identity / sign-out /
 * theme toggle all live inside the `ProfileMenu` dropdown — the
 * visible chrome here is intentionally minimal so the user focuses
 * on the page content.
 *
 * The bell sits to the LEFT of the profile menu with a 4px gap. It
 * is always visible; the badge only appears when there's at least
 * one SimpleFIN-imported transaction awaiting review.
 */
export function Header() {
  return (
    // `shrink-0` keeps the Header pinned at the top of the main area
    // while the page content scrolls beneath it. Without this, the
    // header would compress / scroll out of view the moment the main
    // content overflowed.
    <header className="shrink-0 flex items-center justify-between bg-page px-4 md:px-8 py-3">
      <div className="md:hidden flex items-center gap-2">
        <img src="/logo.png" alt="Cura Money" className="h-7 w-7" />
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
