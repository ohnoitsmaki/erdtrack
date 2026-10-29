import { HistorySkeleton } from "./pages/History";
import { OverviewSkeleton } from "./pages/Overview";
import { RunSkeleton } from "./pages/Run";
import { RunsSkeleton } from "./pages/Runs";
import { SettingsSkeleton } from "./pages/Settings";
import { StyleSkeleton } from "./pages/Style";
import type { Page, Role } from "./routes";

// The page as each shows while what's on it loads, for while who's viewing
// isn't known yet. `role` is who it was last time.
export function PageSkeleton({ page, role }: { page: Page; role: Role }) {
  switch (page) {
    case "overview":
      return <OverviewSkeleton />;
    case "runs":
      return <RunsSkeleton />;
    case "run":
      return <RunSkeleton />;
    case "history":
      return <HistorySkeleton />;
    case "style":
      return <StyleSkeleton />;
    case "settings":
      return <SettingsSkeleton role={role} />;
  }
}
