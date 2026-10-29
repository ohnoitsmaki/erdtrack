import type { ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "wouter";
import {
  IconCheck,
  IconChevronsUp,
  IconHistory,
  IconLayoutDashboard,
  IconListDetails,
  IconLogout,
  IconPalette,
  IconSelector,
  IconSettings,
} from "@tabler/icons-react";
import { Avatar, AvatarFallback } from "@ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ui/components/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@ui/components/sidebar";
import { Skeleton, SkeletonText } from "@ui/components/skeleton";
import { Spinner } from "@ui/components/spinner";
import { usePending } from "@ui/hooks/use-pending";
import { cn } from "@ui/lib/utils";
import { api } from "../convex/_generated/api";
import { useSignOut } from "./authClient";
import { navFor, type Page, type Role } from "./routes";
import { Elapsed, LiveDot, StreamControl } from "./StreamControl";
import { useAttempt } from "./useAttempt";
import { WatcherStatus } from "./WatcherStatus";

const ICONS = {
  overview: IconLayoutDashboard,
  runs: IconListDetails,
  history: IconHistory,
  style: IconPalette,
  settings: IconSettings,
};

// Without a role, while who's viewing isn't known, it's the same frame with
// skeletons where what's theirs goes, and asks for nothing.
export function Shell({
  role,
  displayName,
  page,
  title,
  action,
  children,
}: {
  role?: Role;
  displayName?: string;
  page: Page;
  title: string;
  // At the right of the header, for what the page needs in reach.
  action?: ReactNode;
  children: ReactNode;
}) {
  // The sidebar writes this cookie when it's collapsed or expanded, but
  // doesn't read it back.
  return (
    <SidebarProvider defaultOpen={!/(?:^|;\s*)sidebar_state=false/.test(document.cookie)}>
      <Sidebar collapsible="icon">
        <SidebarHeader className="px-3 pt-3 pb-2 group-data-[collapsible=icon]:px-2">
          {role ? <RunSwitcher /> : <RunSwitcherSkeleton />}
        </SidebarHeader>
        <SidebarContent>
          <Nav page={page} />
        </SidebarContent>
        <SidebarFooter className="gap-2 p-3 group-data-[collapsible=icon]:px-2">
          {role ? (
            <>
              <StatusCard />
              <UserMenu role={role} displayName={displayName} />
            </>
          ) : (
            <>
              <StatusCardSkeleton />
              <UserMenuSkeleton />
            </>
          )}
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      {/* The Overview fits the viewport on desktop, and its panes scroll
          inside themselves. */}
      <SidebarInset
        className={cn("min-w-0", page === "overview" && "lg:h-svh lg:overflow-hidden")}
      >
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 bg-background px-4 lg:h-16 lg:px-5">
          <SidebarTrigger className="-ml-1.5 text-muted-foreground" />
          <h1 className="truncate text-[15px] font-semibold tracking-tight">{title}</h1>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {role && <LivePill />}
            {action}
          </span>
        </header>
        {page === "overview" ? (
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        ) : page === "history" ? (
          // A table, so it's wider than the other pages, up to where its
          // Change column would stretch too far to read.
          <div className="flex w-full max-w-[1400px] flex-col gap-4 p-4 pt-0 lg:p-6 lg:pt-0">
            {children}
          </div>
        ) : (
          <div
            className={cn(
              "mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 pt-0 lg:p-6 lg:pt-0",
              // The Style page's Preview takes a second column on the widest
              // screens.
              page === "style" && "2xl:max-w-[1800px]",
            )}
          >
            {children}
          </div>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}

function Nav({ page }: { page: Page }) {
  const { isMobile, setOpenMobile } = useSidebar();
  // A Run's own page sits under Runs.
  const current = page === "run" ? "runs" : page;
  return (
    <SidebarGroup className="px-3 group-data-[collapsible=icon]:px-2">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5">
          {navFor().map((item) => {
            const Icon = ICONS[item.page];
            return (
              <SidebarMenuItem key={item.path}>
                <SidebarMenuButton
                  isActive={item.page === current}
                  tooltip={item.title}
                  className="h-9 rounded-lg text-body font-medium text-muted-foreground data-active:bg-sidebar-accent data-active:text-foreground"
                  render={<Link href={item.path} />}
                  onClick={() => isMobile && setOpenMobile(false)}
                >
                  <Icon />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function UserMenu({ role, displayName }: { role: Role; displayName?: string }) {
  const { isMobile } = useSidebar();
  const { signingOut, signOut } = useSignOut();
  const name = displayName ?? "Signed in";
  const initial = displayName?.slice(0, 1).toUpperCase() ?? "?";
  const roleName = role === "owner" ? "Streamer" : "Mod";
  const person = (
    <>
      <Avatar className="size-8">
        <AvatarFallback className="text-meta font-semibold">
          {initial}
        </AvatarFallback>
      </Avatar>
      <span className="grid min-w-0 flex-1 text-left text-meta leading-tight">
        <span className="truncate font-medium">{name}</span>
        <span className="truncate text-xs text-muted-foreground">{roleName}</span>
      </span>
    </>
  );
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" className="rounded-xl data-popup-open:bg-sidebar-accent" />}
          >
            {person}
            <IconChevronsUp className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? "top" : "right"}
            align="end"
            className="min-w-56"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-2">
                {person}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {/* Stays open while signing out, so the spinner shows. */}
            <DropdownMenuItem closeOnClick={false} disabled={signingOut} onClick={signOut}>
              {signingOut ? <Spinner /> : <IconLogout />}
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

// The active Run at the top of the sidebar, like a workspace: it's what
// every page is about. Switching here does what Make active on Runs does.
function RunSwitcher() {
  const runs = useQuery(api.runs.list);
  const setActive = useMutation(api.runs.setActive);
  const attempt = useAttempt();
  const [pending, track] = usePending();
  const { isMobile, setOpenMobile } = useSidebar();
  if (runs === undefined) {
    return <RunSwitcherSkeleton />;
  }
  const active = runs.find((run) => run.active);
  const live = runs.filter((run) => !run.archived);
  const name = active?.characterName ?? "No active Run";
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                tooltip={name}
                className="h-12 gap-2.5 rounded-xl px-2 data-popup-open:bg-sidebar-accent group-data-[collapsible=icon]:justify-center"
              />
            }
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-meta font-bold text-primary-foreground">
              {pending ? <Spinner /> : (active?.characterName.slice(0, 1).toUpperCase() ?? "E")}
            </span>
            <span className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate text-body font-semibold">{name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {active ? "Active Run" : "Erdtrack"}
              </span>
            </span>
            <IconSelector className="ml-auto text-muted-foreground group-data-[collapsible=icon]:hidden" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Runs</DropdownMenuLabel>
              {live.map((run) => (
                <DropdownMenuItem
                  key={run._id}
                  disabled={pending}
                  onClick={() =>
                    !run.active &&
                    track(() => attempt(() => setActive({ runId: run._id })))
                  }
                >
                  <span className="min-w-0 flex-1 truncate">{run.characterName}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{run.total}</span>
                  <IconCheck className={cn(!run.active && "invisible")} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              render={<Link href="/runs" />}
              onClick={() => isMobile && setOpenMobile(false)}
            >
              <IconListDetails />
              All Runs
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

// The Run switcher's button, its letter and lines yet to come.
function RunSwitcherSkeleton() {
  return (
    <SidebarMenu aria-busy="true" aria-label="Loading">
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          render={<div />}
          className="h-12 gap-2.5 rounded-xl px-2 hover:bg-transparent group-data-[collapsible=icon]:justify-center"
        >
          <Skeleton className="size-7 shrink-0 rounded-lg" />
          <span className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
            <SkeletonText className="w-24 text-body" />
            <SkeletonText className="w-16 text-xs" />
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

// The Stream and the Watcher together, at the bottom of the sidebar. With it
// collapsed to icons, only a dot is left while live.
function StatusCard() {
  const stream = useQuery(api.streams.current);
  return (
    <>
      <div className="panel flex flex-col gap-2.5 rounded-xl p-3 text-meta group-data-[collapsible=icon]:hidden">
        <StreamControl />
        <WatcherStatus className="border-t pt-2.5 empty:hidden" />
      </div>
      {stream && (
        <span
          title="Live"
          className="hidden h-8 items-center justify-center group-data-[collapsible=icon]:flex"
        >
          <LiveDot />
        </span>
      )}
    </>
  );
}

// The status card with the Stream's line yet to come. Off stream it's one
// line, as most of the time.
function StatusCardSkeleton() {
  return (
    <div className="panel flex flex-col gap-2.5 rounded-xl p-3 text-meta group-data-[collapsible=icon]:hidden">
      <SkeletonText className="w-32" />
    </div>
  );
}

// The user's button, their initial and name yet to come.
function UserMenuSkeleton() {
  return (
    <SidebarMenu aria-busy="true" aria-label="Loading">
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" render={<div />} className="rounded-xl hover:bg-transparent">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <span className="grid min-w-0 flex-1 text-meta leading-tight">
            <SkeletonText className="w-20" />
            <SkeletonText className="w-12 text-xs" />
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

// On a phone the sidebar is out of sight, so the header says the Stream is
// live, and whether the Watcher is reporting.
function LivePill() {
  const { isMobile } = useSidebar();
  const stream = useQuery(api.streams.current);
  const watcher = useQuery(api.watcher.status);
  if (!isMobile || !stream) {
    return null;
  }
  return (
    <span className="flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs">
      <LiveDot className="size-1.5" />
      <span className="font-semibold">Live</span>
      <span className="text-muted-foreground tabular-nums">
        <Elapsed since={stream.startedAt} />
      </span>
      {watcher?.online && (
        <span className="ml-0.5 size-1.5 rounded-full bg-emerald-400" title="Watcher online" />
      )}
    </span>
  );
}
