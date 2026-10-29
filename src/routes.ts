// Who can see the Panel's shell. Anyone else gets sign-in or Not authorized.
export type Role = "owner" | "mod";

export type Page = "overview" | "runs" | "run" | "history" | "style" | "settings";

export type Route =
  | { page: Exclude<Page, "run">; title: string }
  | { page: "run"; title: string; runId: string }
  | { redirect: "/" };

type NavItem = { page: Exclude<Page, "run">; path: string; title: string };

// In sidebar order. Settings manages Tags for everyone, and Mods only for the
// Streamer. The Overlay's style is at /style, since /overlay is the Overlay
// itself, which OBS shows.
const NAV: NavItem[] = [
  { page: "overview", path: "/", title: "Overview" },
  { page: "runs", path: "/runs", title: "Runs" },
  { page: "history", path: "/history", title: "History" },
  { page: "style", path: "/style", title: "Overlay" },
  { page: "settings", path: "/settings", title: "Settings" },
];

// The Streamer and Mods see the same pages.
export function navFor(): NavItem[] {
  return NAV;
}

// Anything that isn't a page goes to the Overview.
export function routeFor(path: string): Route {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const item = navFor().find((nav) => nav.path === trimmed);
  if (item) {
    return { page: item.page, title: item.title };
  }
  const run = /^\/runs\/([^/]+)$/.exec(trimmed);
  if (run) {
    return { page: "run", title: "Run", runId: run[1]! };
  }
  return { redirect: "/" };
}
