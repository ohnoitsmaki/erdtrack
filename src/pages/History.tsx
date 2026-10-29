import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  IconArrowBackUp,
  IconChevronDown,
  IconFilterOff,
  IconHistory,
} from "@tabler/icons-react";
import { Button } from "@ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@ui/components/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@ui/components/empty";
import { Skeleton, SkeletonText } from "@ui/components/skeleton";
import { usePending } from "@ui/hooks/use-pending";
import { cn } from "@ui/lib/utils";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  actorsOf,
  byDay,
  filterHistory,
  KINDS,
  kindOf,
  type HistoryFilter,
} from "../history";
import { useAttempt, type Attempt } from "../useAttempt";

type HistoryChange = FunctionReturnType<typeof api.changes.history>[number];

const NO_FILTER: HistoryFilter = { actors: [], kinds: [], hideUndone: false };

// Every Change to a Run, the active Run unless another is given, newest
// first. Anyone can undo any Change nothing has touched since. Undoing an
// Undo is redo.
export function History({ runId }: { runId?: Id<"runs"> }) {
  const activeRun = useQuery(api.runs.activeRun, runId ? "skip" : {});
  const run = runId ? { _id: runId } : activeRun;
  const history = useQuery(api.changes.history, runId ? { runId } : {});
  const undoMyLast = useMutation(api.changes.undoMyLast);
  const attempt = useAttempt("Undo failed.");
  const [undoingLast, track] = usePending();
  const [filter, setFilter] = useState<HistoryFilter>(NO_FILTER);
  if (activeRun === null) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconHistory />
          </EmptyMedia>
          <EmptyTitle>No active Run</EmptyTitle>
          <EmptyDescription>
            There's no History to show until a Run is active.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (!run || !history) {
    return <HistorySkeleton />;
  }
  return (
    <section className="flex min-w-0 flex-col rounded-2xl border bg-card text-card-foreground">
      <header className="flex min-h-14 flex-wrap items-center gap-2 border-b px-4 py-2">
        <h2 className="flex-1 font-medium">Changes</h2>
        <Button
          variant="outline"
          size="sm"
          className="h-11 sm:h-8"
          disabled={history.length === 0}
          pending={undoingLast}
          onClick={() => track(() => attempt(() => undoMyLast({ runId: run._id })))}
        >
          <IconArrowBackUp data-icon="inline-start" />
          Undo my last
        </Button>
      </header>
      {history.length > 0 && (
        <Filters
          actors={actorsOf(history)}
          filter={filter}
          onChange={setFilter}
        />
      )}
      {history.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconHistory />
            </EmptyMedia>
            <EmptyTitle>No Changes yet</EmptyTitle>
            <EmptyDescription>
              Every Panel action shows here, and can be undone.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ChangeTable
          changes={filterHistory(history, filter)}
          attempt={attempt}
          onClear={() => setFilter(NO_FILTER)}
        />
      )}
    </section>
  );
}

// Nothing ticked in a dropdown shows everything.
function Filters({
  actors,
  filter,
  onChange,
}: {
  actors: string[];
  filter: HistoryFilter;
  onChange: (filter: HistoryFilter) => void;
}) {
  const filtering =
    filter.actors.length > 0 || filter.kinds.length > 0 || filter.hideUndone;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
      <FilterMenu
        label="Who"
        summary={summary(filter.actors, "Everyone", "people")}
        active={filter.actors.length > 0}
      >
        {actors.map((actor) => (
          <DropdownMenuCheckboxItem
            key={actor}
            checked={filter.actors.includes(actor)}
            onCheckedChange={(checked) =>
              onChange({ ...filter, actors: toggled(filter.actors, actor, checked) })
            }
          >
            {actor}
          </DropdownMenuCheckboxItem>
        ))}
      </FilterMenu>
      <FilterMenu
        label="Kind"
        summary={summary(filter.kinds, "All", "kinds")}
        active={filter.kinds.length > 0}
      >
        {KINDS.map((kind) => (
          <DropdownMenuCheckboxItem
            key={kind}
            checked={filter.kinds.includes(kind)}
            onCheckedChange={(checked) =>
              onChange({ ...filter, kinds: toggled(filter.kinds, kind, checked) })
            }
          >
            {kind}
          </DropdownMenuCheckboxItem>
        ))}
      </FilterMenu>
      <FilterMenu
        label="Status"
        summary={filter.hideUndone ? "In effect" : "All"}
        active={filter.hideUndone}
      >
        <DropdownMenuRadioGroup
          value={filter.hideUndone ? "inEffect" : "all"}
          onValueChange={(value) =>
            onChange({ ...filter, hideUndone: value === "inEffect" })
          }
        >
          <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="inEffect">
            In effect only
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </FilterMenu>
      {filtering && (
        <Button
          variant="ghost"
          size="sm"
          className="h-11 sm:h-8"
          onClick={() => onChange(NO_FILTER)}
        >
          Clear
        </Button>
      )}
    </div>
  );
}

// A dropdown whose button says what it's set to, outlined in the primary
// colour while it's filtering. Stays open, so several can be ticked.
function FilterMenu({
  label,
  summary,
  active,
  children,
}: {
  label: string;
  summary: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn("h-11 sm:h-8", active && "border-primary")}
          />
        }
      >
        <span className="text-muted-foreground">{label}:</span>
        {summary}
        <IconChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

function summary(chosen: string[], none: string, plural: string) {
  if (chosen.length === 0) {
    return none;
  }
  return chosen.length === 1 ? chosen[0]! : `${chosen.length} ${plural}`;
}

function toggled<T>(chosen: T[], value: T, checked: boolean) {
  return checked ? [...chosen, value] : chosen.filter((c) => c !== value);
}

function ChangeTable({
  changes,
  attempt,
  onClear,
}: {
  changes: HistoryChange[];
  attempt: Attempt;
  onClear: () => void;
}) {
  if (changes.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconFilterOff />
          </EmptyMedia>
          <EmptyTitle>No Changes match</EmptyTitle>
          <EmptyDescription>
            None of the latest Changes fit these filters.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" className="h-11 sm:h-9" onClick={onClear}>
            Clear filters
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  return (
    // Every column but Change is as narrow as what's in it, so Change gets
    // the rest of the width.
    <table className="w-full text-sm">
      <ChangeColumns />
      {byDay(changes).map((day) => (
        <tbody key={day.label}>
          <tr className="border-b bg-muted/40">
            <th
              scope="colgroup"
              colSpan={5}
              className="px-4 py-1.5 text-left text-xs font-medium text-muted-foreground"
            >
              {day.label}
            </th>
          </tr>
          {day.changes.map((change) => (
            <ChangeRow key={change._id} change={change} attempt={attempt} />
          ))}
        </tbody>
      ))}
    </table>
  );
}

const FIT = "w-px whitespace-nowrap";

function ChangeColumns() {
  return (
    <thead className="max-sm:sr-only">
      <tr className="border-b text-left text-xs text-muted-foreground">
        <th scope="col" className={cn(FIT, "px-4 py-2 font-medium")}>Time</th>
        <th scope="col" className={cn(FIT, "px-4 py-2 font-medium max-sm:hidden")}>
          Who
        </th>
        <th scope="col" className="px-4 py-2 font-medium">Change</th>
        <th scope="col" className={cn(FIT, "px-4 py-2 font-medium max-md:hidden")}>
          Kind
        </th>
        <th scope="col" className={cn(FIT, "px-4 py-2 text-right font-medium")}>
          <span className="sr-only">Undo</span>
        </th>
      </tr>
    </thead>
  );
}

const SKELETON_CHANGES = ["58%", "34%", "46%", "40%", "62%", "30%"];

// The History's frame, with its Changes yet to come: the same header,
// filters and table, so nothing moves as they arrive.
export function HistorySkeleton() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading"
      className="flex min-w-0 flex-col rounded-2xl border bg-card text-card-foreground"
    >
      <header className="flex min-h-14 flex-wrap items-center gap-2 border-b px-4 py-2">
        <h2 className="flex-1 font-medium">Changes</h2>
        <Skeleton className="h-11 w-32 rounded-full sm:h-8" />
      </header>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        {["w-32", "w-22", "w-24"].map((width) => (
          <Skeleton key={width} className={cn("h-11 rounded-full sm:h-8", width)} />
        ))}
      </div>
      <table className="w-full text-sm">
        <ChangeColumns />
        <tbody>
          <tr className="border-b bg-muted/40">
            <th colSpan={5} className="px-4 py-1.5">
              <SkeletonText className="w-10 text-xs" />
            </th>
          </tr>
          {SKELETON_CHANGES.map((width, index) => (
            <tr key={index} className="border-b last:border-b-0">
              <td className="px-4 py-2">
                <SkeletonText className="w-[8ch] font-mono text-sm" />
              </td>
              <td className={cn(FIT, "px-4 py-2 max-sm:hidden")}>
                <SkeletonText className="w-20" />
              </td>
              <td className="px-4 py-2">
                <SkeletonText className="w-20 sm:hidden" />
                <SkeletonText style={{ width }} />
              </td>
              <td className={cn(FIT, "px-4 py-2 max-md:hidden")}>
                <SkeletonText className="w-16" />
              </td>
              <td className="px-4 py-2 sm:w-px">
                <div className="flex min-h-11 items-center justify-end sm:min-h-8">
                  <SkeletonText className="w-9" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// On a phone, who did it sits above what was done instead of in its own
// column, and the Kind column goes until there's room.
function ChangeRow({ change, attempt }: { change: HistoryChange; attempt: Attempt }) {
  const undo = useMutation(api.changes.undo);
  const [undoing, track] = usePending();
  return (
    <tr className="border-b transition-colors last:border-b-0 hover:bg-muted/25">
      <td className="px-4 py-2 whitespace-nowrap">
        <time
          dateTime={new Date(change.at).toISOString()}
          className="font-mono text-muted-foreground tabular-nums"
        >
          {new Date(change.at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </td>
      <td className={cn(FIT, "px-4 py-2 font-medium max-sm:hidden")}>
        {change.actorName}
      </td>
      <td className="px-4 py-2">
        <span className="block font-medium sm:hidden">{change.actorName}</span>
        <span
          className={cn(change.undone && "text-muted-foreground line-through")}
        >
          {change.description}
        </span>
      </td>
      <td className={cn(FIT, "px-4 py-2 text-muted-foreground max-md:hidden")}>
        {kindOf(change.action)}
      </td>
      {/* As tall as the Undo button whatever it holds, so every row is the
          same height. The button's text lines up with the others'. */}
      <td className="px-4 py-2 text-right text-muted-foreground sm:w-px sm:whitespace-nowrap">
        <div className="flex min-h-11 items-center justify-end sm:min-h-8">
          {change.undone ? (
            "Undone"
          ) : change.blockedBy ? (
            `Changed since by ${change.blockedBy}`
          ) : change.refusal ? (
            change.refusal
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="-mr-3 h-11 sm:h-8"
              pending={undoing}
              onClick={() => track(() => attempt(() => undo({ changeId: change._id })))}
            >
              Undo
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
