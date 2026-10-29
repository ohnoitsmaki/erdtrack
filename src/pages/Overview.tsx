import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  IconArrowsExchange,
  IconCheck,
  IconMap2,
  IconPlus,
  IconSkull,
  IconSwords,
  IconTag,
  IconTrash,
  IconUserPlus,
  IconX,
} from "@tabler/icons-react";
import { Badge } from "@ui/components/badge";
import { Button } from "@ui/components/button";
import { Checkbox } from "@ui/components/checkbox";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@ui/components/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ui/components/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@ui/components/drawer";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@ui/components/empty";
import { Field, FieldLabel } from "@ui/components/field";
import { Input } from "@ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@ui/components/popover";
import { ScrollArea } from "@ui/components/scroll-area";
import { Skeleton, SkeletonText } from "@ui/components/skeleton";
import { Spinner } from "@ui/components/spinner";
import { usePending } from "@ui/hooks/use-pending";
import { cn } from "@ui/lib/utils";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DEATH_COOLDOWN_MS, MAX_DEATHS_ADDED } from "../../convex/deathLimits";
import { searchBosses, type Boss } from "../../convex/bosses";
import { Counts, Mismatch, Tally, type RunView } from "../Counts";
import { Lines, Nickname } from "../Lines";
import { ConfirmDialog } from "../ConfirmDialog";
import { CreateRun } from "../CreateRun";
import {
  attemptOf,
  bossLines,
  bulkTagged,
  deathAttempts,
  encounterLines,
  MAX_BOSS_RESULTS,
  nicknamed,
  reassignChoices,
  selectRange,
  switchChoices,
  tagChoices,
  tallyTiles,
  typedCount,
  type EncounterLines,
} from "../overview";
import { useAttempt, type Attempt } from "../useAttempt";
import { useDesktop } from "../useDesktop";

type Pane = "deaths" | "counts";

// The active Run's working screen: the Current Encounter across the top,
// with Death. On desktop it fits the viewport and each pane scrolls inside
// itself; on a phone a segmented control switches between the panes and
// Death floats at the bottom, in reach of a thumb.
export function Overview() {
  const run = useQuery(api.runs.activeRun);
  const desktop = useDesktop();
  const [pane, setPane] = useState<Pane>("deaths");
  if (run === undefined) {
    return <OverviewSkeleton />;
  }
  if (run === null) {
    return <NoActiveRun />;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 pt-0 max-lg:pb-24 lg:gap-4 lg:p-4 lg:pt-0">
      <NowPanel run={run} />
      {desktop ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(22rem,26rem)_1fr] gap-4">
          <CountsPane run={run} />
          <DeathsPane run={run} desktop />
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="Show" className="panel flex rounded-full p-1">
            {(
              [
                ["deaths", "Deaths", run.total],
                ["counts", "Counts", run.encounters.length],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={pane === key}
                onClick={() => setPane(key)}
                className={cn(
                  "tap-target flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                  pane === key
                    ? "bg-secondary text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]"
                    : "text-muted-foreground",
                )}
              >
                {label}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {count.toLocaleString()}
                </span>
              </button>
            ))}
          </div>
          {pane === "deaths" ? (
            <DeathsPane run={run} desktop={false} />
          ) : (
            <CountsPane run={run} />
          )}
          <div className="fixed inset-x-3 bottom-[max(--spacing(3),env(safe-area-inset-bottom))] z-20 md:left-[calc(var(--sidebar-width)+--spacing(3))] md:group-has-data-[collapsible=icon]/sidebar-wrapper:left-[calc(var(--sidebar-width-icon)+--spacing(3))]">
            <DeathButton run={run} className="h-14 w-full text-base" />
          </div>
        </>
      )}
    </div>
  );
}

// The Overview's frame with what's the Run's yet to come: the same panels,
// panes and rows, so nothing moves as it arrives.
export function OverviewSkeleton() {
  const desktop = useDesktop();
  return (
    <div
      aria-busy="true"
      aria-label="Loading"
      className="flex min-h-0 flex-1 flex-col gap-3 p-3 pt-0 max-lg:pb-24 lg:gap-4 lg:p-4 lg:pt-0"
    >
      <NowPanelSkeleton />
      {desktop ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(22rem,26rem)_1fr] gap-4">
          <Pane
            title={<PaneSkeletonTitle>Counts</PaneSkeletonTitle>}
            action={<SkeletonText className="ml-auto w-24 text-body" />}
          >
            <div className="min-h-0 flex-1 overflow-hidden p-2 pt-2.5">
              <CountsSkeleton />
            </div>
          </Pane>
          <Pane
            title={<PaneSkeletonTitle>Deaths</PaneSkeletonTitle>}
            action={<SkeletonText className="ml-auto w-24 text-body" />}
          >
            <DeathColumns />
            <div className="min-h-0 flex-1 overflow-hidden">
              <DeathRowsSkeleton desktop />
            </div>
          </Pane>
        </div>
      ) : (
        <>
          <div className="panel flex rounded-full p-1">
            {["Deaths", "Counts"].map((label, index) => (
              <span
                key={label}
                className={cn(
                  "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full font-medium",
                  index === 0 ? "bg-secondary text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
                <SkeletonText className="w-5 text-xs" />
              </span>
            ))}
          </div>
          {/* On a phone, Select is beside Add Deaths. */}
          <Pane
            title={<PaneSkeletonTitle>Deaths</PaneSkeletonTitle>}
            action={<SkeletonText className="ml-auto w-40 text-body" />}
          >
            <DeathRowsSkeleton desktop={false} />
          </Pane>
          <div className="fixed inset-x-3 bottom-[max(--spacing(3),env(safe-area-inset-bottom))] z-20 md:left-[calc(var(--sidebar-width)+--spacing(3))] md:group-has-data-[collapsible=icon]/sidebar-wrapper:left-[calc(var(--sidebar-width-icon)+--spacing(3))]">
            <Skeleton className="h-14 w-full rounded-full" />
          </div>
        </>
      )}
    </div>
  );
}

// A pane's title, with its count yet to come.
function PaneSkeletonTitle({ children }: { children: ReactNode }) {
  return (
    <>
      <PaneTitle>{children}</PaneTitle>
      <SkeletonText className="w-6 text-meta" />
    </>
  );
}

// Widths for the lines of skeleton rows, so they read as names of different
// lengths rather than a grid of bars.
const SKELETON_WIDTHS = ["72%", "48%", "64%", "56%", "80%", "44%", "68%", "52%"];

function NowPanelSkeleton() {
  return (
    <section className={NOW.panel}>
      <div className={NOW.encounter}>
        <Skeleton className="size-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <SkeletonText className="w-56 max-w-full text-[15px]" />
          <SkeletonText className="w-32 text-meta" />
        </div>
      </div>
      <div className={NOW.tallies}>
        {[6, 8, 7, 6].map((width, index) => (
          <TallySkeleton key={index} width={width} />
        ))}
      </div>
      <div className={NOW.controls}>
        <Skeleton className={cn("rounded-full", NOW.switcher)} />
        <Skeleton className="h-10 w-[6.75rem] rounded-full max-lg:hidden" />
      </div>
    </section>
  );
}

// A Tally's number and label, `width` quarter-rems wide.
function TallySkeleton({ width }: { width: number }) {
  return (
    <div className="flex shrink-0 flex-col">
      <SkeletonText className="text-xl" style={{ width: `${width * 0.25}rem` }} />
      <SkeletonText className="text-xs" style={{ width: `${width * 0.3}rem` }} />
    </div>
  );
}

function CountsSkeleton() {
  return (
    <div className="flex w-full flex-col gap-2 pointer-coarse:gap-3.5">
      <div className="flex flex-wrap gap-1">
        {["w-14", "w-24", "w-24"].map((width, index) => (
          <Skeleton key={index} className={cn("h-7 rounded-full", width)} />
        ))}
      </div>
      <div className="flex flex-col">
        {SKELETON_WIDTHS.map((width, index) => (
          <div
            key={index}
            className="flex min-h-12 items-center gap-2 rounded-xl pr-2.5 pl-3.5 pointer-coarse:min-h-tap"
          >
            <span className="flex min-w-0 flex-1 flex-col py-1.5">
              <SkeletonText className="text-body" style={{ width }} />
              {index > 0 && <SkeletonText className="w-2/5 text-xs" />}
            </span>
            <SkeletonText className="w-6 text-[15px]" />
          </div>
        ))}
      </div>
    </div>
  );
}

// The Deaths list's column heads, over its rows. Time, Encounter and Attempt
// are made wider or narrower by dragging their right edges, and back to how
// they were by double-clicking them.
function DeathColumns() {
  return (
    <div className={cn("grid shrink-0 items-center border-b px-4 py-2 text-xs text-muted-foreground", DEATH_COLUMNS)}>
      <span />
      <ColumnHead column="time">Time</ColumnHead>
      <ColumnHead column="encounter">Encounter</ColumnHead>
      <ColumnHead column="attempt">Attempt</ColumnHead>
      <span>Tags</span>
    </div>
  );
}

function ColumnHead({ column, children }: { column: DeathColumn; children: ReactNode }) {
  const head = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  return (
    <span ref={head} className="relative min-w-0">
      <span className="block truncate">{children}</span>
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${column}`}
        title="Drag to resize, double-click to reset"
        className="absolute inset-y-[-0.5rem] -right-2.5 z-10 flex w-3 cursor-col-resize touch-none justify-center after:w-px after:bg-transparent after:transition-colors hover:after:bg-border active:after:bg-primary"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, width: head.current?.getBoundingClientRect().width ?? 0 };
        }}
        onPointerMove={(event) => {
          if (drag.current) {
            setColumnWidth(column, drag.current.width + event.clientX - drag.current.x);
          }
        }}
        onPointerUp={() => {
          drag.current = null;
          storeColumnWidths();
        }}
        onPointerCancel={() => {
          drag.current = null;
          storeColumnWidths();
        }}
        onDoubleClick={() => {
          setColumnWidth(column, null);
          storeColumnWidths();
        }}
      />
    </span>
  );
}

function DeathRowsSkeleton({ desktop }: { desktop: boolean }) {
  const rows = [...SKELETON_WIDTHS, ...SKELETON_WIDTHS, ...SKELETON_WIDTHS];
  return (
    <ol aria-busy="true" aria-label="Loading" className="py-1">
      {(desktop ? rows : rows.slice(0, 10)).map((width, index) =>
        desktop ? (
          <li
            key={index}
            className={cn("mx-2 grid min-h-11 items-center px-2 text-body", DEATH_COLUMNS)}
          >
            <span />
            <SkeletonText className="w-14" />
            <SkeletonText style={{ width }} />
            <SkeletonText className="w-5" />
            <span />
          </li>
        ) : (
          <li key={index} className="mx-2 flex min-h-14 flex-col justify-center px-2 py-2 text-body">
            <SkeletonText style={{ width }} />
            <SkeletonText className="w-28 text-xs" />
          </li>
        ),
      )}
    </ol>
  );
}

function NoActiveRun() {
  return (
    <div className="flex flex-1 flex-col p-3 pt-0 lg:p-4 lg:pt-0">
      <Empty className="panel flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconUserPlus />
          </EmptyMedia>
          <EmptyTitle>No active Run</EmptyTitle>
          <EmptyDescription>
            Create one for the character being played.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <CreateRun />
        </EmptyContent>
      </Empty>
    </div>
  );
}

// The Now panel's layout, by its own width rather than the screen's, as the
// sidebar takes a share of the screen: stacked when narrow, as on a phone;
// the Encounter beside the controls over the Tallies when there's room for
// those; and all in a row when there's room for that. In a row, the Tallies
// never squeeze into a stack; if they don't fit, the controls wrap below.
// Wide is 90rem, written out each time, as Tailwind finds classes by their
// full names.
const NOW = {
  panel: "panel @container/now flex flex-wrap items-center gap-x-6 gap-y-3 p-3 lg:p-4",
  encounter:
    "flex min-w-0 basis-full items-center gap-3 @4xl/now:flex-1 @4xl/now:basis-0 @min-[90rem]/now:flex-[0_1_24rem]",
  tallies:
    "flex min-w-0 flex-1 flex-wrap items-end gap-x-6 gap-y-2 @4xl/now:order-last @4xl/now:basis-full @4xl/now:border-t @4xl/now:pt-3 @min-[90rem]/now:order-none @min-[90rem]/now:min-w-max @min-[90rem]/now:basis-0 @min-[90rem]/now:gap-x-8 @min-[90rem]/now:border-t-0 @min-[90rem]/now:border-l @min-[90rem]/now:pt-0 @min-[90rem]/now:pl-6",
  controls: "flex basis-full items-center gap-2 @4xl/now:shrink-0 @4xl/now:basis-auto",
  switcher: "h-10 @max-4xl/now:flex-1 @4xl/now:w-56",
};

// The Current Encounter and the counts that matter mid-fight, at the top so
// a Mod can switch in one go as a fight starts, and Death beside them.
function NowPanel({ run }: { run: RunView }) {
  const setCurrent = useMutation(api.encounters.setCurrent);
  const markDefeated = useMutation(api.encounters.markDefeated);
  const stream = useQuery(api.streams.current);
  const attempt = useAttempt();
  const [switching, trackSwitch] = usePending();
  const [defeating, trackDefeat] = usePending();
  const [query, setQuery] = useState("");
  const current = run.encounters.find((e) => e._id === run.currentEncounterId);
  const choices = switchChoices(run.encounters, run.currentEncounterId, query);
  const tries = current && attemptOf(current);
  const lines = current && encounterLines(current);
  return (
    <section
      aria-label="Current Encounter"
      className={NOW.panel}
    >
      <div className={NOW.encounter}>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-secondary text-muted-foreground [&_svg]:size-5">
          {current?.kind === "overworld" ? <IconMap2 /> : <IconSwords />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[15px] font-semibold tracking-tight">
              {lines?.title ?? "No Current Encounter"}
            </h2>
            {tries && <Badge className="tabular-nums">Attempt {tries}</Badge>}
            {current?.defeated && <Badge variant="success">Defeated</Badge>}
          </div>
          <p className="truncate text-meta text-muted-foreground">
            {[lines?.nickname && `“${lines.nickname}”`, lines?.detail]
              .filter(Boolean)
              .join(", ") || "Anywhere outside a boss fight"}
          </p>
        </div>
      </div>
      <dl className={NOW.tallies}>
        {current && <Tally label="Here" value={current.deathCount} />}
        {/* Held while the Stream's on its way, as it most often comes. */}
        {stream === undefined && <TallySkeleton width={6} />}
        {stream && stream.deaths !== null && (
          <Tally label="This Stream" value={stream.deaths} />
        )}
        <Tally label="Run total" value={run.total} />
        {tallyTiles(run.tallies).map((tally) => (
          <Tally key={tally.tagId} label={tally.name} value={tally.count} />
        ))}
        {run.mismatch !== null && <Mismatch count={run.mismatch} />}
      </dl>
      <div className={NOW.controls}>
        {current?.kind === "boss" && !current.defeated && (
          <Button
            size="sm"
            variant="outline"
            className="h-10 shrink-0"
            pending={defeating}
            onClick={() =>
              trackDefeat(() => attempt(() => markDefeated({ encounterId: current._id })))
            }
          >
            <IconCheck data-icon="inline-start" />
            Mark Defeated
          </Button>
        )}
        <Combobox
          items={choices}
          filter={null}
          value={null}
          itemToStringLabel={(encounter: RunView["encounters"][number]) => encounter.name}
          inputValue={query}
          onInputValueChange={(value, details) =>
            details.reason !== "item-press" && setQuery(value)
          }
          onValueChange={(encounter) => {
            setQuery("");
            if (encounter) {
              trackSwitch(() =>
                attempt(() => setCurrent({ runId: run._id, encounterId: encounter._id })),
              );
            }
          }}
        >
          <ComboboxInput
            aria-label="Switch the Current Encounter"
            placeholder="Switch encounter"
            className={NOW.switcher}
            pending={switching}
          />
          <ComboboxContent>
            <ComboboxEmpty>No Encounters match.</ComboboxEmpty>
            <ComboboxList>
              {(encounter: RunView["encounters"][number]) => (
                <EncounterOption key={encounter._id} encounter={encounter} />
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        <DeathButton run={run} className="max-lg:hidden" shortcut />
      </div>
    </section>
  );
}

// Records one Death in the Current Encounter. It waits out the cooldown
// after the Run's latest Death, whoever recorded it, so two Mods pressing
// for the same death record it once; the backend refuses it too. While it
// waits it says the Death was recorded, filling back up as the cooldown
// runs. With `shortcut`, D records one too, unless typing or in a dialog.
function DeathButton({
  run,
  shortcut = false,
  className,
}: {
  run: RunView;
  shortcut?: boolean;
  className?: string;
}) {
  const record = useMutation(api.deaths.record);
  const attempt = useAttempt();
  const [pending, track] = usePending();
  const { fraction, seconds } = useCooldown(run.lastDeathAt);
  const cooling = seconds > 0;
  const press = () => track(() => attempt(() => record({ runId: run._id })));
  const ready = useRef(false);
  ready.current = !cooling && !pending;
  const pressRef = useRef(press);
  pressRef.current = press;
  useEffect(() => {
    if (!shortcut) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.key.toLowerCase() !== "d" ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target.closest("input, textarea, select, [contenteditable]") ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      ) {
        return;
      }
      if (ready.current) {
        pressRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);
  return (
    <button
      type="button"
      onClick={press}
      disabled={cooling || pending}
      aria-busy={pending || undefined}
      aria-keyshortcuts={shortcut ? "D" : undefined}
      aria-label={cooling ? `Death recorded. Ready again in ${seconds} seconds` : undefined}
      className={cn(
        "relative isolate inline-flex h-10 shrink-0 items-center justify-center gap-2 overflow-hidden rounded-full px-4 text-sm font-semibold outline-none pointer-coarse:min-h-tap transition-[background-color,scale] select-none focus-visible:ring-3 focus-visible:ring-ring/40",
        cooling
          ? "bg-secondary text-muted-foreground"
          : "bg-primary text-primary-foreground shadow-[0_0_0_1px_rgb(250_237_118/0.4),0_6px_20px_-6px_rgb(250_237_118/0.45)] hover:bg-[#fff38f] active:scale-[0.98] disabled:opacity-80",
        className,
      )}
    >
      {cooling && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 -z-10 bg-primary/30"
          style={{ width: `${(1 - fraction) * 100}%` }}
        />
      )}
      {pending ? <Spinner /> : <IconSkull className="size-4.5" stroke={2.2} />}
      {cooling ? (
        <span className="tabular-nums">Recorded, {seconds}s</span>
      ) : (
        <>
          Death
          {shortcut && (
            <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-current/25 px-1 font-sans text-[11px] font-medium opacity-70">
              D
            </kbd>
          )}
        </>
      )}
    </button>
  );
}

// What's left of the cooldown after `lastDeathAt`: the fraction, for the
// button's fill, and whole seconds, counting down. Never more than the
// cooldown, in case this clock is behind the backend's.
function useCooldown(lastDeathAt: number | null) {
  const [now, setNow] = useState(Date.now);
  const left =
    lastDeathAt === null
      ? 0
      : Math.min(DEATH_COOLDOWN_MS, lastDeathAt + DEATH_COOLDOWN_MS - now);
  const cooling = left > 0;
  useEffect(() => {
    setNow(Date.now());
  }, [lastDeathAt]);
  useEffect(() => {
    if (!cooling) {
      return;
    }
    const interval = setInterval(() => setNow(Date.now()), 50);
    return () => clearInterval(interval);
  }, [cooling]);
  return {
    fraction: Math.max(0, left / DEATH_COOLDOWN_MS),
    seconds: Math.max(0, Math.ceil(left / 1000)),
  };
}

function Pane({
  title,
  count,
  action,
  className,
  children,
}: {
  title: ReactNode;
  count?: number;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("panel flex min-h-0 flex-col", className)}>
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-1.5 pointer-coarse:min-h-tap">
        {title}
        {count !== undefined && (
          <span className="text-meta text-muted-foreground tabular-nums">
            {count.toLocaleString()}
          </span>
        )}
        {action}
      </header>
      {children}
    </section>
  );
}

function PaneTitle({ children }: { children: ReactNode }) {
  return <h2 className="font-semibold tracking-tight">{children}</h2>;
}

function CountsPane({ run }: { run: RunView }) {
  const setCurrent = useMutation(api.encounters.setCurrent);
  const attempt = useAttempt();
  return (
    <Pane
      title={<PaneTitle>Counts</PaneTitle>}
      count={run.encounters.length}
      action={
        <AddEncounter
          runId={run._id}
          addedBossIds={run.encounters.flatMap((e) => e.bossId ?? [])}
        />
      }
    >
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2 pt-2.5 pointer-coarse:px-2.5 pointer-coarse:pt-3.5">
          <Counts
            run={run}
            onPick={(encounterId) =>
              encounterId !== run.currentEncounterId &&
              attempt(() => setCurrent({ runId: run._id, encounterId }))
            }
          />
        </div>
      </ScrollArea>
    </Pane>
  );
}

type AddOption = { id: string; label: string; boss?: Boss };

// Searches the bundled boss list, so typing costs no database reads. In a
// popover from the Counts header, which closes once one is added.
function AddEncounter({
  runId,
  addedBossIds,
}: {
  runId: Id<"runs">;
  addedBossIds: string[];
}) {
  const addBoss = useMutation(api.encounters.addBoss);
  const addCustom = useMutation(api.encounters.addCustom);
  const attempt = useAttempt();
  const [adding, track] = usePending();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const added = new Set(addedBossIds);
  const name = query.trim();
  const options: AddOption[] = name
    ? [
        ...searchBosses(name)
          .filter((boss) => !added.has(boss.id))
          .slice(0, MAX_BOSS_RESULTS)
          .map((boss) => ({ id: boss.id, label: boss.displayName, boss })),
        { id: "custom", label: `Add “${name}” as a Custom Encounter` },
      ]
    : [];
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setQuery("");
      }}
    >
      <PopoverTrigger
        render={<Button variant="ghost" size="sm" className="ml-auto text-meta text-muted-foreground" />}
      >
        <IconPlus data-icon="inline-start" />
        Add encounter
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverTitle>Add an Encounter</PopoverTitle>
        <Combobox
          items={options}
          filter={null}
          value={null}
          itemToStringLabel={(option: AddOption) => option.label}
          inputValue={query}
          onInputValueChange={(value, details) =>
            details.reason !== "item-press" && setQuery(value)
          }
          onValueChange={(option) => {
            setQuery("");
            if (option) {
              track(() =>
                attempt(async () => {
                  await (option.boss
                    ? addBoss({ runId, bossId: option.boss.id })
                    : addCustom({ runId, name }));
                  setOpen(false);
                }),
              );
            }
          }}
        >
          <ComboboxInput
            aria-label="Add Encounter"
            placeholder="Boss, place or region"
            className="w-full max-lg:h-11"
            showTrigger={false}
            pending={adding}
          />
          <ComboboxContent>
            <ComboboxEmpty>Type a boss's name, place or region.</ComboboxEmpty>
            <ComboboxList>
              {(option: AddOption) => (
                <ComboboxItem key={option.id} value={option}>
                  {option.boss ? (
                    <Lines {...bossLines(option.boss)} />
                  ) : (
                    <>
                      <IconPlus />
                      {option.label}
                    </>
                  )}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </PopoverContent>
    </Popover>
  );
}

type FeedDeath = FunctionReturnType<
  typeof api.runs.deathFeed
>["page"][number];
type RunEncounter = RunView["encounters"][number];
type Tag = FunctionReturnType<typeof api.tags.list>[number];
type Tagging = { tagId: Id<"tags">; tagged: boolean };
type DeathChange = { encounterId?: Id<"encounters">; tag?: Tagging };

// How many Deaths each scroll to the bottom loads.
const PAGE_SIZE = 30;

// Each Death can be reassigned, tagged or removed in one action. Selecting
// several applies one action to all of them as a single Change, from a bar
// that floats over the list while they're selected.
function DeathsPane({ run, desktop }: { run: RunView; desktop: boolean }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.runs.deathFeed,
    {},
    { initialNumItems: PAGE_SIZE },
  );
  const updateDeaths = useMutation(api.deaths.update);
  const tags = useQuery(api.tags.list) ?? [];
  const attempt = useAttempt();
  const [selected, setSelected] = useState<Set<Id<"deaths">>>(new Set());
  // Where a shift-click's range starts from.
  const [lastToggled, setLastToggled] = useState<Id<"deaths">>();
  // On a phone, tapping a Death opens it unless selecting.
  const [selecting, setSelecting] = useState(false);
  const [openId, setOpenId] = useState<Id<"deaths">>();
  // Deaths newer than this arrived while the list was open, so slide in.
  const [openedAt] = useState(Date.now);
  const now = useNow(30_000);
  const sentinel = useLoadOlder(status === "CanLoadMore", () =>
    loadMore(PAGE_SIZE),
  );
  const all = results;
  const chosen = all.filter((death) => selected.has(death._id));
  const opened = all.find((death) => death._id === openId);
  const byId = new Map(run.encounters.map((e) => [e._id as string, e]));
  const attempts = deathAttempts(all, (id) => byId.get(id));

  const toggle = (deathId: Id<"deaths">, range = false) => {
    const on = !selected.has(deathId);
    const from = (range && lastToggled) || deathId;
    setSelected(selectRange(all.map((death) => death._id), selected, from, deathId, on));
    setLastToggled(deathId);
  };
  const clear = () => {
    setSelected(new Set());
    setLastToggled(undefined);
    setSelecting(false);
  };
  const update = (deathIds: Id<"deaths">[], change: DeathChange) =>
    attempt(async () => {
      await updateDeaths({ deathIds, ...change });
      clear();
    });

  const row = (death: FeedDeath, index: number) => {
    const shared = {
      death,
      attempt: attempts[index] ?? null,
      justNow: index === 0 && now - death._creationTime < 60_000,
      arrived: death._creationTime > openedAt,
      tags,
      selected: selected.has(death._id),
    };
    return desktop ? (
      <DesktopDeathRow
        key={death._id}
        {...shared}
        selecting={chosen.length > 0}
        encounters={run.encounters}
        onToggle={(range) => toggle(death._id, range)}
        onUpdate={(change) => update([death._id], change)}
        onFail={attempt}
      />
    ) : (
      <MobileDeathRow
        key={death._id}
        {...shared}
        selecting={selecting}
        onPress={() => (selecting ? toggle(death._id) : setOpenId(death._id))}
      />
    );
  };

  const loaded = status !== "LoadingFirstPage";
  const list = !loaded ? (
    <DeathRowsSkeleton desktop={desktop} />
  ) : all.length === 0 ? (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconSkull />
        </EmptyMedia>
        <EmptyTitle>No Deaths yet</EmptyTitle>
        <EmptyDescription>
          {desktop ? "Press Death, or D, when one happens." : "Press Death when one happens."}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  ) : (
    <div className="relative">
      <ol aria-label="Recent Deaths" className="py-1">
        {all.map(row)}
      </ol>
      {status === "LoadingMore" && (
        <p className="p-4 text-center text-muted-foreground">Loading older Deaths…</p>
      )}
      {/* Covers the last stretch of the list, so older Deaths load before
          the bottom is reached. */}
      <div
        ref={sentinel}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[50vh] max-h-full"
      />
    </div>
  );

  return (
    <Pane
      title={<PaneTitle>Deaths</PaneTitle>}
      count={run.total}
      action={
        <span className="ml-auto flex items-center gap-1">
          {!selecting && <AddDeaths run={run} />}
          {/* There while the Deaths load, so Add Deaths doesn't move. */}
          {!desktop && (!loaded || all.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              className="text-meta"
              disabled={!loaded}
              onClick={() => (selecting ? clear() : setSelecting(true))}
            >
              {selecting ? "Cancel" : "Select"}
            </Button>
          )}
        </span>
      }
    >
      {desktop && (!loaded || all.length > 0) && <DeathColumns />}
      {desktop ? <ScrollArea className="min-h-0 flex-1">{list}</ScrollArea> : list}
      {chosen.length > 0 && (
        <SelectionBar
          count={chosen.length}
          encounters={run.encounters}
          tags={tags}
          selected={chosen}
          onUpdate={(change) =>
            update(
              chosen.map((death) => death._id),
              change,
            )
          }
          onClear={clear}
          desktop={desktop}
        />
      )}
      {!desktop && (
        <DeathDrawer
          death={opened}
          encounters={run.encounters}
          tags={tags}
          onClose={() => setOpenId(undefined)}
          onUpdate={async (change) => {
            if (opened) {
              await update([opened._id], change);
            }
          }}
          attempt={attempt}
        />
      )}
    </Pane>
  );
}

// The time now, again every `every` ms, for what says how long ago.
function useNow(every: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(interval);
  }, [every]);
  return now;
}

// Adds many Deaths at once, to catch up a Run that started mid-progress: how
// many, then how many of them go to each Encounter picked, the rest to
// Overworld. It's one Change, so History can take it all back.
function AddDeaths({ run }: { run: RunView }) {
  const [open, setOpen] = useState(false);
  // Opened afresh each time, so nothing typed before is left over.
  const [key, setKey] = useState(0);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-meta text-muted-foreground"
        onClick={() => {
          setKey(key + 1);
          setOpen(true);
        }}
      >
        <IconPlus data-icon="inline-start" />
        Add Deaths…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <AddDeathsForm key={key} run={run} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

// One Encounter picked to take some of the Deaths being added: one in the
// Run, or a boss from the boss list the backend adds along with them.
// `count` is as typed. Only a boss not yet Defeated can be marked so in the
// same Change.
type Share = {
  key: string;
  lines: EncounterLines;
  target: { encounterId: Id<"encounters"> } | { bossId: string };
  count: string;
  canMarkDefeated: boolean;
  defeated: boolean;
};

function encounterShare(encounter: RunEncounter): Share {
  return {
    key: encounter._id,
    lines: encounterLines(encounter),
    target: { encounterId: encounter._id },
    count: "",
    canMarkDefeated: encounter.kind === "boss" && !encounter.defeated,
    defeated: false,
  };
}

function bossShare(boss: Boss): Share {
  return {
    key: boss.id,
    lines: bossLines(boss),
    target: { bossId: boss.id },
    count: "",
    canMarkDefeated: true,
    defeated: false,
  };
}

function AddDeathsForm({ run, onDone }: { run: RunView; onDone: () => void }) {
  const addMany = useMutation(api.deaths.addMany);
  const attempt = useAttempt();
  const [adding, track] = usePending();
  const [total, setTotal] = useState("");
  const [shares, setShares] = useState<Share[]>([]);
  const count = typedCount(total);
  const counts = shares.map((share) => typedCount(share.count));
  const left =
    (count ?? 0) - counts.reduce<number>((sum, n) => sum + (n ?? 0), 0);
  const tooMany = count !== null && count > MAX_DEATHS_ADDED;
  const valid =
    count !== null &&
    count > 0 &&
    !tooMany &&
    counts.every((n) => n !== null) &&
    left >= 0;
  const updateShare = (key: string, to: Partial<Share>) =>
    setShares(shares.map((s) => (s.key === key ? { ...s, ...to } : s)));
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) {
          return;
        }
        track(() =>
          attempt(async () => {
            await addMany({
              runId: run._id,
              count,
              split: shares.map((share, i) => ({
                ...share.target,
                count: counts[i]!,
                ...(share.defeated && { defeated: true }),
              })),
            });
            onDone();
          }),
        );
      }}
    >
      <DialogHeader>
        <DialogTitle>Add Deaths</DialogTitle>
        <DialogDescription>
          To catch up on Deaths from before. Give some to Encounters, and the
          rest go to Overworld.
        </DialogDescription>
      </DialogHeader>
      <div className="flex min-w-0 flex-col gap-3">
        <Field className="gap-1.5">
          <FieldLabel htmlFor="add-deaths-count">How many</FieldLabel>
          <Input
            id="add-deaths-count"
            autoFocus
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_DEATHS_ADDED}
            step={1}
            placeholder="0"
            aria-invalid={count === null || tooMany || undefined}
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            className="w-32 tabular-nums max-lg:h-11"
          />
        </Field>
        {shares.map((share, i) => (
          <div key={share.key} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Lines {...share.lines} />
            </div>
            <Input
              aria-label={`Deaths for ${share.lines.title}`}
              aria-invalid={counts[i] === null || undefined}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder="0"
              value={share.count}
              onChange={(e) => updateShare(share.key, { count: e.target.value })}
              className="w-20 shrink-0 tabular-nums max-lg:h-11"
            />
            {share.canMarkDefeated && (
              <label className="flex shrink-0 items-center gap-1.5 text-sm max-lg:min-h-11">
                <Checkbox
                  checked={share.defeated}
                  onCheckedChange={(defeated) =>
                    updateShare(share.key, { defeated })
                  }
                />
                Defeated
              </label>
            )}
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="shrink-0"
              aria-label={`Remove ${share.lines.title}`}
              onClick={() => setShares(shares.filter((s) => s.key !== share.key))}
            >
              <IconX />
            </Button>
          </div>
        ))}
        <PickShareEncounter
          run={run}
          picked={shares.map((s) => s.key)}
          onPick={(share) => setShares([...shares, share])}
        />
        <p
          role="status"
          className={cn(
            "text-sm tabular-nums",
            left < 0 || tooMany ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {tooMany
            ? `At most ${MAX_DEATHS_ADDED.toLocaleString()} at a time`
            : left < 0
              ? `${(-left).toLocaleString()} more than the ${(count ?? 0).toLocaleString()} being added`
              : `${left.toLocaleString()} left for Overworld`}
        </p>
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className="max-lg:h-11"
          disabled={adding}
          onClick={onDone}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="max-lg:h-11"
          pending={adding}
          disabled={!valid}
        >
          {valid
            ? `Add ${count.toLocaleString()} ${count === 1 ? "Death" : "Deaths"}`
            : "Add Deaths"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// The Run's Encounters besides Overworld, then bosses from the boss list not
// yet in it, leaving out any already picked. Custom Encounters can't be
// created here, only picked once they're in the Run.
function PickShareEncounter({
  run,
  picked,
  onPick,
}: {
  run: RunView;
  picked: string[];
  onPick: (share: Share) => void;
}) {
  const [query, setQuery] = useState("");
  const pickedKeys = new Set(picked);
  const inRun = new Set(run.encounters.flatMap((e) => e.bossId ?? []));
  const name = query.trim();
  const options: Share[] = [
    ...reassignChoices(
      run.encounters.filter((e) => e.kind !== "overworld"),
      name,
    ).map(encounterShare),
    ...(name ? searchBosses(name) : [])
      .filter((boss) => !inRun.has(boss.id))
      .slice(0, MAX_BOSS_RESULTS)
      .map(bossShare),
  ].filter((option) => !pickedKeys.has(option.key));
  return (
    <Combobox
      items={options}
      filter={null}
      value={null}
      itemToStringLabel={(option: Share) => option.lines.title}
      inputValue={query}
      onInputValueChange={(value, details) =>
        details.reason !== "item-press" && setQuery(value)
      }
      onValueChange={(option) => {
        setQuery("");
        if (option) {
          onPick(option);
        }
      }}
    >
      <ComboboxInput
        aria-label="Add an Encounter to give Deaths to"
        placeholder="Give some to: boss, place or region"
        className="w-full max-lg:h-11"
        showTrigger={false}
      />
      <ComboboxContent>
        <ComboboxEmpty>Type a boss's name, place or region.</ComboboxEmpty>
        <ComboboxList>
          {(option: Share) => (
            <ComboboxItem key={option.key} value={option}>
              <Lines {...option.lines} />
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

// Calls `load` whenever the returned element is on screen and `canLoad`,
// including again after each page arrives while it's still showing.
function useLoadOlder(canLoad: boolean, load: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const element = ref.current;
    if (!element || !canLoad) {
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        loadRef.current();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [canLoad]);
  return ref;
}

// Floats over the list while Deaths are selected, so the actions are where
// the eye already is: at the bottom of the screen on desktop, and above
// Death on a phone.
function SelectionBar({
  count,
  encounters,
  tags,
  selected,
  onUpdate,
  onClear,
  desktop,
}: {
  count: number;
  encounters: RunEncounter[];
  tags: Tag[];
  selected: FeedDeath[];
  onUpdate: (change: DeathChange) => Promise<unknown>;
  onClear: () => void;
  desktop: boolean;
}) {
  useClearOnEscape(onClear);
  return (
    <div
      role="toolbar"
      aria-label="Selected Deaths"
      className={cn(
        "fixed z-30 flex items-center gap-1.5 rounded-full pointer-coarse:gap-y-3 border border-white/10 bg-popover/95 p-1.5 pl-4 shadow-[0_12px_40px_-8px_rgb(0_0_0/0.7)] backdrop-blur motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2",
        desktop
          ? "bottom-6 left-1/2 -translate-x-1/2"
          : "inset-x-3 bottom-[calc(max(--spacing(3),env(safe-area-inset-bottom))+--spacing(17))] flex-wrap rounded-3xl md:left-[calc(var(--sidebar-width)+--spacing(3))]",
      )}
    >
      <span className="pr-1 font-medium whitespace-nowrap tabular-nums">{count} selected</span>
      <EncounterCombobox
        encounters={encounters}
        label={`Move ${count} to`}
        placeholder="Move to…"
        onPick={(encounterId) => onUpdate({ encounterId })}
        className={cn(desktop ? "h-8 w-52" : "h-11 min-w-0 flex-1 basis-40")}
      />
      <TagPicker
        tags={tags}
        label={`Tag ${count}`}
        has={(tagId) => !bulkTagged(selected, tagId)}
        onPick={(tag) => onUpdate({ tag })}
        className={cn(desktop ? "h-8 w-36" : "h-11 min-w-0 flex-1 basis-28")}
      />
      {desktop ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 rounded-full text-muted-foreground"
          title="Clear the selection (Esc)"
          onClick={onClear}
        >
          <IconX data-icon="inline-start" />
          Clear
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="size-11 rounded-full text-muted-foreground"
          aria-label="Clear the selection"
          onClick={onClear}
        >
          <IconX />
        </Button>
      )}
    </div>
  );
}

// Esc clears the selection, unless it's closing a picker or a dialog, or
// leaving a field.
function useClearOnEscape(onClear: () => void) {
  const clearRef = useRef(onClear);
  clearRef.current = onClear;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        target.closest("input, textarea, select, [contenteditable]") ||
        document.querySelector('[role="dialog"], [role="alertdialog"], [role="listbox"]')
      ) {
        return;
      }
      clearRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function DeathTime({ death }: { death: FeedDeath }) {
  const at = new Date(death._creationTime);
  return (
    <time dateTime={at.toISOString()} title={at.toLocaleTimeString()} className="tabular-nums">
      {at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
    </time>
  );
}

// Each Tag keeps its colour, by its place among the channel's Tags. A
// removed Tag's badge doesn't show, though the Death keeps it.
const TAG_COLOURS = ["violet", "info", "teal", "pink", "orange"] as const;

function DeathBadges({ death, tags }: { death: FeedDeath; tags: Tag[] }) {
  return (
    <>
      {tags.map(
        (tag, i) =>
          death.tagIds.includes(tag._id) && (
            <Badge key={tag._id} variant={TAG_COLOURS[i % TAG_COLOURS.length]}>
              {tag.name}
            </Badge>
          ),
      )}
    </>
  );
}

type TagOption = { id: string; label: string; tag?: Tag };

// The channel's Tags, with a check on each the Deaths have. Picking one puts
// it on or takes it off, and what's typed can be made a new Tag, which goes
// on straight away.
function TagPicker({
  tags,
  label,
  has,
  onPick,
  className,
}: {
  tags: Tag[];
  label: string;
  has: (tagId: Id<"tags">) => boolean;
  onPick: (tag: Tagging) => Promise<unknown>;
  className?: string;
}) {
  const createTag = useMutation(api.tags.create);
  const attempt = useAttempt();
  const [pending, track] = usePending();
  const [query, setQuery] = useState("");
  const { tags: listed, create } = tagChoices(tags, query);
  const options: TagOption[] = [
    ...listed.map((tag) => ({ id: tag._id, label: tag.name, tag })),
    ...(create ? [{ id: "create", label: `Create “${create}”` }] : []),
  ];
  return (
    <Combobox
      items={options}
      filter={null}
      value={null}
      itemToStringLabel={(option: TagOption) => option.label}
      inputValue={query}
      onInputValueChange={(value, details) =>
        details.reason !== "item-press" && setQuery(value)
      }
      onValueChange={(option) => {
        setQuery("");
        if (!option) {
          return;
        }
        track(() =>
          attempt(async () => {
            const tagId = option.tag?._id ?? (await createTag({ name: create! }));
            await onPick({ tagId, tagged: !option.tag || !has(option.tag._id) });
          }),
        );
      }}
    >
      <ComboboxInput
        aria-label={label}
        placeholder="Tags…"
        className={className}
        pending={pending}
      />
      <ComboboxContent>
        <ComboboxEmpty>Type a name to create a Tag.</ComboboxEmpty>
        <ComboboxList>
          {(option: TagOption) => (
            <ComboboxItem key={option.id} value={option}>
              {option.tag ? (
                <>
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {has(option.tag._id) && <IconCheck aria-label="Tagged" />}
                </>
              ) : (
                <>
                  <IconPlus />
                  {option.label}
                </>
              )}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

// One Death's Tags.
function DeathTagPicker({
  death,
  tags,
  onUpdate,
  className,
}: {
  death: FeedDeath;
  tags: Tag[];
  onUpdate: (change: DeathChange) => Promise<unknown>;
  className?: string;
}) {
  return (
    <TagPicker
      tags={tags}
      label="Tags"
      has={(tagId) => death.tagIds.includes(tagId)}
      onPick={(tag) => onUpdate({ tag })}
      className={className}
    />
  );
}

// Takes back a Death recorded by mistake, from its row on desktop. It's a
// Change, so History can bring it back.
function RemoveDeath({ death, attempt }: { death: FeedDeath; attempt: Attempt }) {
  const remove = useMutation(api.deaths.remove);
  const [removing, track] = usePending();
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label="Remove this Death"
      title="Remove"
      className="hover:text-destructive"
      pending={removing}
      onClick={() => track(() => attempt(() => remove({ deathId: death._id })))}
    >
      <IconTrash />
    </Button>
  );
}

// Check, time, Encounter, Attempt, then Tags with the row's actions after.
// The middle three are as wide as they've been dragged to, if they have been.
const DEATH_COLUMNS =
  "grid-cols-[1.25rem_var(--death-time,5.5rem)_minmax(0,var(--death-encounter,17rem))_var(--death-attempt,4rem)_minmax(0,1fr)] gap-x-3";

// A faint line between Deaths, gone beside a highlighted one so its rounded
// corners stay clean.
const ROW_RULE =
  "relative before:pointer-events-none before:absolute before:inset-x-2 before:top-0 before:h-px before:bg-white/[0.04] before:transition-opacity first:before:hidden hover:before:opacity-0 [&:hover+li]:before:opacity-0 data-selected:before:opacity-0 [&[data-selected]+li]:before:opacity-0";

type DeathColumn = "time" | "encounter" | "attempt";

const COLUMN_WIDTHS_KEY = "erdtrack.deaths.columnWidths";
// In pixels, so a column can't be dragged away to nothing or past the page.
const COLUMN_LIMITS: Record<DeathColumn, [number, number]> = {
  time: [48, 240],
  encounter: [80, 800],
  attempt: [40, 160],
};

// The dragged widths, kept on the page's root so the column heads, the rows
// and their loading stand-ins all follow them.
const columnWidths: Partial<Record<DeathColumn, number>> = {};

function setColumnWidth(column: DeathColumn, width: number | null) {
  const property = `--death-${column}`;
  if (width === null) {
    delete columnWidths[column];
    document.documentElement.style.removeProperty(property);
    return;
  }
  const [min, max] = COLUMN_LIMITS[column];
  columnWidths[column] = Math.round(Math.min(max, Math.max(min, width)));
  document.documentElement.style.setProperty(property, `${columnWidths[column]}px`);
}

// Kept in this browser, and still dragged for now where it can't be written.
function storeColumnWidths() {
  try {
    localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(columnWidths));
  } catch {
    // Kept for this visit only.
  }
}

// Brought back as the page loads, before the list first draws.
try {
  const stored: unknown = JSON.parse(localStorage.getItem(COLUMN_WIDTHS_KEY) ?? "{}");
  for (const column of Object.keys(COLUMN_LIMITS) as DeathColumn[]) {
    const width = (stored as Record<string, unknown>)?.[column];
    if (typeof width === "number") {
      setColumnWidth(column, width);
    }
  }
} catch {
  // The usual widths, then.
}

type RowProps = {
  death: FeedDeath;
  // Which try at a boss it ended.
  attempt: number | null;
  justNow: boolean;
  // Recorded while the list was open.
  arrived: boolean;
  tags: Tag[];
  selected: boolean;
  selecting: boolean;
};

// The newest Death, if it's from the last minute, says so instead of its time.
function When({ death, justNow }: { death: FeedDeath; justNow: boolean }) {
  return justNow ? (
    <span className="inline-flex items-center gap-1.5 font-medium whitespace-nowrap text-primary">
      <span className="size-1.5 rounded-full bg-primary" />
      Just now
    </span>
  ) : (
    <DeathTime death={death} />
  );
}

function DesktopDeathRow({
  death,
  attempt,
  justNow,
  arrived,
  tags,
  selected,
  selecting,
  encounters,
  onToggle,
  onUpdate,
  onFail,
}: RowProps & {
  encounters: RunEncounter[];
  // With shift held, for every Death from the last one toggled to this one.
  onToggle: (range: boolean) => void;
  onUpdate: (change: DeathChange) => Promise<unknown>;
  onFail: Attempt;
}) {
  return (
    <li
      data-selected={selected || undefined}
      className={cn(
        "group/row mx-2 grid min-h-11 items-center rounded-lg px-2 text-body transition-colors hover:bg-white/[0.035]",
        DEATH_COLUMNS,
        ROW_RULE,
        selected && "bg-primary/[0.06] hover:bg-primary/[0.08]",
        arrived && "animate-arrive",
      )}
    >
      <Checkbox
        aria-label="Select this Death"
        checked={selected}
        onCheckedChange={(_, { event }) => onToggle(event instanceof MouseEvent && event.shiftKey)}
        // Shift-clicking would otherwise select the text between the rows.
        onMouseDown={(event) => event.shiftKey && event.preventDefault()}
        className={cn(
          !selecting &&
            "opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100",
        )}
      />
      <span className="text-muted-foreground">
        <When death={death} justNow={justNow} />
      </span>
      <span className="flex min-w-0 items-baseline gap-1">
        <span className="truncate font-medium">{death.encounterName}</span>
        {death.encounterNickname && <Nickname nickname={death.encounterNickname} />}
      </span>
      <span className="text-muted-foreground tabular-nums">{attempt ?? ""}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <DeathBadges death={death} tags={tags} />
        {!selecting && (
          <span className="ml-auto hidden items-center gap-0.5 group-focus-within/row:flex group-hover/row:flex group-has-data-popup-open/row:flex">
            <Popover>
              <PopoverTrigger
                render={<Button variant="ghost" size="icon-sm" aria-label="Move to another Encounter" title="Move" />}
              >
                <IconArrowsExchange />
              </PopoverTrigger>
              <PopoverContent align="end">
                <PopoverTitle>Move to</PopoverTitle>
                <EncounterCombobox
                  encounters={encounters}
                  label="Move to"
                  value={death.encounterId}
                  onPick={(encounterId) => onUpdate({ encounterId })}
                  className="w-full"
                />
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger
                render={<Button variant="ghost" size="icon-sm" aria-label="Tags" title="Tags" />}
              >
                <IconTag />
              </PopoverTrigger>
              <PopoverContent align="end">
                <PopoverTitle>Tags</PopoverTitle>
                <DeathTagPicker death={death} tags={tags} onUpdate={onUpdate} className="w-full" />
              </PopoverContent>
            </Popover>
            <RemoveDeath death={death} attempt={onFail} />
          </span>
        )}
      </span>
    </li>
  );
}

function MobileDeathRow({
  death,
  attempt,
  justNow,
  arrived,
  tags,
  selected,
  selecting,
  onPress,
}: RowProps & { onPress: () => void }) {
  return (
    <li
      data-selected={selected || undefined}
      className={cn(
        "mx-2 rounded-lg",
        ROW_RULE,
        selected && "bg-primary/[0.06]",
        arrived && "animate-arrive",
      )}
    >
      <button
        type="button"
        aria-pressed={selecting ? selected : undefined}
        onClick={onPress}
        className="flex min-h-14 w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-body outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        {selecting && (
          <Checkbox
            aria-hidden="true"
            tabIndex={-1}
            checked={selected}
            className="pointer-events-none"
          />
        )}
        <span className="grid min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-1">
            <span className="truncate font-medium">{death.encounterName}</span>
            {death.encounterNickname && <Nickname nickname={death.encounterNickname} />}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            <When death={death} justNow={justNow} />
            {attempt && `, attempt ${attempt}`}
          </span>
        </span>
        <DeathBadges death={death} tags={tags} />
      </button>
    </li>
  );
}

// In the drawer, Remove is under a thumb that's often moving fast, so it's
// red and asks first.
function ConfirmRemoveDeath({ death, attempt }: { death: FeedDeath; attempt: Attempt }) {
  const remove = useMutation(api.deaths.remove);
  const at = new Date(death._creationTime).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <ConfirmDialog
      trigger={
        <Button variant="destructive" className="h-11">
          <IconTrash data-icon="inline-start" />
          Remove
        </Button>
      }
      title="Remove this Death?"
      description={`The Death at ${at} in ${nicknamed(death.encounterName ?? "", death.encounterNickname)} comes off the counts and the Overlay. History can bring it back.`}
      confirm="Remove"
      onConfirm={() => attempt(() => remove({ deathId: death._id }))}
    />
  );
}

function DeathDrawer({
  death,
  encounters,
  tags,
  onClose,
  onUpdate,
  attempt,
}: {
  death: FeedDeath | undefined;
  encounters: RunEncounter[];
  tags: Tag[];
  onClose: () => void;
  onUpdate: (change: DeathChange) => Promise<unknown>;
  attempt: Attempt;
}) {
  return (
    <Drawer open={death !== undefined} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent>
        {death && (
          <>
            <DrawerHeader>
              <DrawerTitle>
                Death at <DeathTime death={death} />
              </DrawerTitle>
              <DrawerDescription className="flex flex-wrap justify-center gap-2">
                <span>
                  {nicknamed(death.encounterName ?? "", death.encounterNickname)}
                </span>
                <DeathBadges death={death} tags={tags} />
              </DrawerDescription>
            </DrawerHeader>
            <div className="flex flex-col gap-3 p-4">
              <EncounterCombobox
                encounters={encounters}
                label="Reassign"
                value={death.encounterId}
                onPick={(encounterId) => onUpdate({ encounterId })}
                className="h-11 w-full"
              />
              <DeathTagPicker
                death={death}
                tags={tags}
                onUpdate={onUpdate}
                className="h-11 w-full"
              />
            </div>
            <DrawerFooter>
              <ConfirmRemoveDeath death={death} attempt={attempt} />
              <Button variant="ghost" className="h-11" onClick={onClose}>
                Done
              </Button>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}


function EncounterOption({ encounter }: { encounter: RunEncounter }) {
  return (
    <ComboboxItem value={encounter}>
      <Lines {...encounterLines(encounter)} />
      {encounter.defeated && <Badge variant="success">Defeated</Badge>}
    </ComboboxItem>
  );
}

// Lists every Encounter of the Run until something is typed, then searches
// name, place or region.
function EncounterCombobox({
  encounters,
  label,
  placeholder,
  value,
  onPick,
  className,
}: {
  encounters: RunEncounter[];
  label: string;
  placeholder?: string;
  value?: Id<"encounters">;
  onPick: (encounterId: Id<"encounters">) => Promise<unknown>;
  className?: string;
}) {
  const [pending, track] = usePending();
  const [query, setQuery] = useState("");
  const selected = encounters.find((e) => e._id === value) ?? null;
  const labelOf = (encounter: RunEncounter) =>
    nicknamed(encounter.name, encounter.nickname);
  // The input shows the selected name until the Mod types.
  const search = selected && query === labelOf(selected) ? "" : query;
  return (
    <Combobox
      items={reassignChoices(encounters, search)}
      filter={null}
      value={selected}
      itemToStringLabel={labelOf}
      isItemEqualToValue={(a: RunEncounter, b: RunEncounter) => a._id === b._id}
      onInputValueChange={setQuery}
      onValueChange={(encounter) => {
        if (encounter && encounter._id !== value) {
          track(() => onPick(encounter._id));
        }
      }}
    >
      <ComboboxInput
        aria-label={label}
        placeholder={placeholder}
        className={className}
        pending={pending}
      />
      <ComboboxContent>
        <ComboboxEmpty>No Encounters match.</ComboboxEmpty>
        <ComboboxList>
          {(encounter: RunEncounter) => (
            <EncounterOption key={encounter._id} encounter={encounter} />
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
