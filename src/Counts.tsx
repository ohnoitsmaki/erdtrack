import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  IconDots,
  IconEye,
  IconEyeOff,
  IconGripVertical,
  IconPencil,
  IconPlus,
  IconReplace,
} from "@tabler/icons-react";
import { Badge } from "@ui/components/badge";
import { Button } from "@ui/components/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@ui/components/combobox";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@ui/components/drawer";
import { Input } from "@ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@ui/components/popover";
import { usePending } from "@ui/hooks/use-pending";
import { cn } from "@ui/lib/utils";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { searchBosses, type Boss } from "../convex/bosses";
import { MAX_ENCOUNTER_NAME_LENGTH } from "../convex/encounterLimits";
import { Lines } from "./Lines";
import {
  bossLines,
  encounterLines,
  landedBefore,
  MAX_BOSS_RESULTS,
  movedBefore,
  shownEncounters,
  tallyTiles,
  type CountsFilter,
} from "./overview";
import { Roll } from "./Roll";
import { useAttempt } from "./useAttempt";
import { useDesktop } from "./useDesktop";

export type RunView = NonNullable<FunctionReturnType<typeof api.runs.activeRun>>;

type RunEncounter = RunView["encounters"][number];

// Each Encounter's count; the Total and the Tags' tallies are Tallies.
// Overworld is at the top and the newest of the rest after it, narrowed by
// the filter chips, which this browser remembers. Unless the Run is
// archived, every Encounter but Overworld can be moved by its handle and
// hidden from the Overlay's lists, and a boss can be given a Nickname or
// changed to another boss: on desktop from buttons that show on the row
// being pointed at, on a phone from a drawer. Where `onPick` is given,
// picking a row makes it the Current Encounter.
export function Counts({
  run,
  onPick,
}: {
  run: RunView;
  onPick?: (encounterId: Id<"encounters">) => void;
}) {
  const [filter, setFilter] = useStoredFilter();
  const reorder = useReorder(run, shownEncounters(run.encounters, filter));
  const desktop = useDesktop();
  const [editing, setEditing] = useState<Id<"encounters">>();
  const edited = run.encounters.find((e) => e._id === editing);
  const bosses = run.encounters.filter((e) => e.kind !== "overworld");
  const filters: [CountsFilter, string, number, string?][] = [
    ["all", "All", run.encounters.length],
    ["standing", "Standing", bosses.filter((e) => !e.defeated).length, "bg-sky-400"],
    ["defeated", "Defeated", bosses.filter((e) => e.defeated).length, "bg-emerald-400"],
  ];
  return (
    <div className="flex w-full flex-col gap-2 pointer-coarse:gap-3.5">
      {/* Wrapping, not scrolling, so the chips' touch targets aren't cut off. */}
      <div role="radiogroup" aria-label="Show" className="flex flex-wrap gap-1">
        {filters.map(([key, label, count, dot]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              "tap-target inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-meta font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
              filter === key
                ? "bg-secondary text-foreground ring-1 ring-white/[0.06]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {dot && <span className={cn("size-1.5 rounded-full", dot)} />}
            {label}
            <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
          </button>
        ))}
      </div>
      <div className="relative">
        {reorder.slot && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5"
            style={reorder.slot}
          />
        )}
        <dl
          ref={reorder.list}
          className={cn("flex flex-col", reorder.dragging && "select-none")}
        >
          {reorder.encounters.map((encounter, index) => {
            const current = encounter._id === run.currentEncounterId;
            const editable = encounter.kind !== "overworld" && !run.archived;
            const name = (
              <Lines
                {...encounterLines(encounter)}
                className="flex-1"
                titleClassName={cn("text-body font-medium", encounter.defeated && !current && "text-muted-foreground")}
              />
            );
            return (
              <div
                key={encounter._id}
                ref={reorder.row(encounter._id)}
                style={reorder.offset(index)}
                className={cn(
                  "group/row relative flex min-h-12 items-center gap-1 rounded-xl pr-2.5 pointer-coarse:min-h-tap transition-colors hover:bg-white/[0.035] lg:pl-3.5",
                  run.archived && "pl-2.5",
                  current && "bg-white/[0.045] hover:bg-white/[0.045]",
                  reorder.dragging &&
                    "motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out",
                  reorder.dragging === encounter._id &&
                    "z-10 scale-[1.02] bg-popover shadow-lg ring-1 ring-white/10 motion-safe:transition-[scale,box-shadow]",
                )}
              >
                <dt className="flex min-w-0 flex-1 items-center gap-2 self-stretch">
                  {!run.archived &&
                    (encounter.kind === "overworld" ? (
                      <span aria-hidden className="size-9 shrink-0 lg:hidden" />
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing max-lg:size-9 lg:absolute lg:inset-y-0 lg:left-0 lg:h-auto lg:w-3.5 lg:rounded-l-xl lg:rounded-r-none lg:opacity-0 lg:group-hover/row:opacity-100 lg:focus-visible:opacity-100"
                        aria-label={`Move ${encounter.name}`}
                        title="Drag, or press the up and down arrow keys"
                        {...reorder.handle(encounter._id)}
                      >
                        <IconGripVertical className="size-3.5" />
                      </Button>
                    ))}
                  {onPick ? (
                    <button
                      type="button"
                      onClick={() => onPick(encounter._id)}
                      aria-current={current || undefined}
                      title={current ? undefined : "Make this the Current Encounter"}
                      className="flex min-w-0 flex-1 items-center self-stretch rounded-lg py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {name}
                    </button>
                  ) : (
                    <span className="flex min-w-0 flex-1 items-center py-1.5">{name}</span>
                  )}
                  {current && <Badge>Current</Badge>}
                  {encounter.defeated && <Badge variant="success">Defeated</Badge>}
                  {encounter.hidden && <Badge variant="secondary">Hidden</Badge>}
                  {editable &&
                    (desktop ? (
                      // Over the badges, on the row being pointed at, and
                      // while one of its popovers is open.
                      <span className="absolute top-1/2 right-12 hidden -translate-y-1/2 items-center gap-0.5 rounded-lg bg-popover p-0.5 shadow-md ring-1 ring-white/10 group-focus-within/row:flex group-hover/row:flex group-has-data-popup-open/row:flex">
                        {encounter.kind === "boss" && (
                          <>
                            <BossChanger run={run} encounter={encounter} />
                            <NicknameEditor runId={run._id} encounter={encounter} />
                          </>
                        )}
                        <HiddenToggle runId={run._id} encounter={encounter} />
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9 shrink-0 text-muted-foreground"
                        aria-label={`Edit ${encounter.name}`}
                        onClick={() => setEditing(encounter._id)}
                      >
                        <IconDots />
                      </Button>
                    ))}
                </dt>
                <dd
                  className={cn(
                    "w-10 shrink-0 text-right text-[15px] font-semibold",
                    encounter.defeated && !current && "text-muted-foreground",
                  )}
                >
                  <Roll value={encounter.deathCount} />
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
      {!desktop && (
        <EncounterDrawer run={run} encounter={edited} onClose={() => setEditing(undefined)} />
      )}
    </div>
  );
}

const FILTER_KEY = "erdtrack.counts.filter";
// Where Hide Defeated was kept before the filter chips.
const HIDE_DEFEATED_KEY = "erdtrack.counts.hideDefeated";

// The filter chips' choice, kept in this browser. It's All where storage
// can't be read, and still changes for now where it can't be written.
function useStoredFilter() {
  const [filter, setFilter] = useState<CountsFilter>(() => {
    try {
      const stored = localStorage.getItem(FILTER_KEY);
      if (stored === "all" || stored === "standing" || stored === "defeated") {
        return stored;
      }
      return localStorage.getItem(HIDE_DEFEATED_KEY) === "true" ? "standing" : "all";
    } catch {
      return "all";
    }
  });
  const set = (next: CountsFilter) => {
    setFilter(next);
    try {
      localStorage.setItem(FILTER_KEY, next);
    } catch {
      // Kept for this visit only.
    }
  };
  return [filter, set] as const;
}

// A row being dragged, and where every row was when it was picked up,
// measured from the top of the list. The rows stay where they are until it's
// let go, and are only drawn moved, so these don't change.
type Drag = {
  id: Id<"encounters">;
  from: number;
  order: RunEncounter[];
  rows: { top: number; height: number }[];
  startY: number;
  y: number;
};

// Where the held row would land: after Overworld and every other row whose
// middle it's past.
function landing({ from, rows, startY, y }: Drag) {
  const held = rows[from]!;
  const middle = held.top + held.height / 2 + y - startY;
  const passed = rows.filter(
    (row, i) => i !== 0 && i !== from && row.top + row.height / 2 < middle,
  );
  return passed.length + 1;
}

// Dragging a handle lifts its row to follow the pointer, within the list,
// while the rows it passes slide aside and a slot shows where it will land.
// The move is made once it's let go. The arrow keys on a handle move it a
// place at a time. A move shows straight away, before it goes through. The
// rows are as shown, which is the Run's order upside down.
function useReorder(run: RunView, shown: RunEncounter[]) {
  const attempt = useAttempt();
  const moveEncounter = useMutation(
    api.encounters.moveEncounter,
  ).withOptimisticUpdate((store, { runId, encounterId, before }) => {
    const moved = <V extends RunView>(view: V): V => ({
      ...view,
      encounters: movedBefore(view.encounters, encounterId, before),
    });
    const active = store.getQuery(api.runs.activeRun, {});
    if (active?._id === runId) {
      store.setQuery(api.runs.activeRun, {}, moved(active));
    }
    const viewed = store.getQuery(api.runs.run, { runId });
    if (viewed) {
      store.setQuery(api.runs.run, { runId }, moved(viewed));
    }
  });
  const [drag, setDrag] = useState<Drag | null>(null);
  const list = useRef<HTMLDListElement>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const handles = useRef(new Map<string, HTMLElement>());
  const encounters = drag?.order ?? shown;
  const to = drag && landing(drag);

  const move = (encounterId: Id<"encounters">, before: Id<"encounters"> | null) =>
    attempt(() => moveEncounter({ runId: run._id, encounterId, before }));

  // How far each row is drawn from where it is.
  const offsetOf = (index: number) => {
    if (!drag || to === null) {
      return 0;
    }
    const held = drag.rows[drag.from]!;
    if (index === drag.from) {
      const first = drag.rows[1]!;
      const last = drag.rows.at(-1)!;
      return Math.min(
        Math.max(drag.y - drag.startY, first.top - held.top),
        last.top + last.height - held.top - held.height,
      );
    }
    if (drag.from < to && index > drag.from && index <= to) {
      return -held.height;
    }
    if (to < drag.from && index >= to && index < drag.from) {
      return held.height;
    }
    return 0;
  };

  // Where the held row will land, in the space the others leave it.
  const slot = (() => {
    if (!drag || to === null) {
      return null;
    }
    const held = drag.rows[drag.from]!;
    const top =
      to === drag.from
        ? held.top
        : drag.from < to
          ? drag.rows[to]!.top + drag.rows[to]!.height - held.height
          : drag.rows[to]!.top;
    return { top, height: held.height };
  })();

  return {
    list,
    encounters,
    dragging: drag?.id,
    slot,
    offset: (index: number) => {
      const by = offsetOf(index);
      return by ? { transform: `translateY(${by}px)` } : undefined;
    },
    row: (id: string) => (row: HTMLElement | null) => {
      if (row) {
        rows.current.set(id, row);
      } else {
        rows.current.delete(id);
      }
    },
    handle: (id: Id<"encounters">) => ({
      ref: (handle: HTMLElement | null) => {
        if (handle) {
          handles.current.set(id, handle);
        } else {
          handles.current.delete(id);
        }
      },
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        if (event.button !== 0) {
          return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        const top = list.current!.getBoundingClientRect().top;
        setDrag({
          id,
          from: shown.findIndex((e) => e._id === id),
          order: shown,
          rows: shown.map((e) => {
            const rect = rows.current.get(e._id)!.getBoundingClientRect();
            return { top: rect.top - top, height: rect.height };
          }),
          startY: event.clientY,
          y: event.clientY,
        });
      },
      onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
        if (drag?.id === id) {
          setDrag({ ...drag, y: event.clientY });
        }
      },
      onPointerUp: () => {
        if (drag?.id !== id || to === null) {
          return;
        }
        setDrag(null);
        if (to !== drag.from) {
          const others = drag.order.filter((e) => e._id !== id);
          move(id, landedBefore(others, to));
        }
      },
      onLostPointerCapture: () => setDrag(null),
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        const at = shown.findIndex((e) => e._id === id);
        let to: number;
        if (event.key === "ArrowUp" && at > 1) {
          to = at - 1;
        } else if (event.key === "ArrowDown" && at < shown.length - 1) {
          to = at + 1;
        } else {
          return;
        }
        event.preventDefault();
        move(id, landedBefore(shown.filter((e) => e._id !== id), to));
        // The row has moved by the next frame, which can take the focus.
        requestAnimationFrame(() => handles.current.get(id)?.focus());
      },
    }),
  };
}

// Leaves the Encounter off the Overlay's lists, or puts it back: an icon on
// desktop, a full-width button in the phone's drawer.
function HiddenToggle({
  runId,
  encounter,
  wide = false,
}: {
  runId: Id<"runs">;
  encounter: RunEncounter;
  wide?: boolean;
}) {
  const setHidden = useMutation(api.encounters.setHidden);
  const attempt = useAttempt();
  const [pending, track] = usePending();
  const label = encounter.hidden
    ? `Show ${encounter.name} on the Overlay`
    : `Hide ${encounter.name} from the Overlay`;
  const toggle = () =>
    track(() =>
      attempt(() =>
        setHidden({ runId, encounterId: encounter._id, hidden: !encounter.hidden }),
      ),
    );
  if (wide) {
    return (
      <Button variant="secondary" className="h-11 w-full" pending={pending} onClick={toggle}>
        {encounter.hidden ? <IconEye data-icon="inline-start" /> : <IconEyeOff data-icon="inline-start" />}
        {encounter.hidden ? "Show on the Overlay" : "Hide from the Overlay"}
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      aria-pressed={encounter.hidden}
      disabled={pending}
      onClick={toggle}
    >
      {encounter.hidden ? <IconEyeOff /> : <IconEye />}
    </Button>
  );
}

// For a boss picked by mistake, like the wrong one of two fights with the
// same boss. Searches the bundled boss list, leaving out bosses the Run
// already has, and calls `onDone` once the change goes through.
function BossChangeForm({
  run,
  encounter,
  onDone,
}: {
  run: RunView;
  encounter: RunEncounter;
  onDone: () => void;
}) {
  const changeBoss = useMutation(api.encounters.changeBoss);
  const attempt = useAttempt();
  const [pending, track] = usePending();
  const [query, setQuery] = useState("");
  const inRun = new Set(run.encounters.flatMap((e) => e.bossId ?? []));
  const name = query.trim();
  const options = name
    ? searchBosses(name)
        .filter((boss) => !inRun.has(boss.id))
        .slice(0, MAX_BOSS_RESULTS)
    : [];
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Keeps its Deaths, Nickname and Defeated.
      </p>
      <Combobox
        items={options}
        filter={null}
        value={null}
        itemToStringLabel={(boss: Boss) => boss.displayName}
        inputValue={query}
        onInputValueChange={(value, details) =>
          details.reason !== "item-press" && setQuery(value)
        }
        onValueChange={(boss) => {
          if (boss) {
            track(() =>
              attempt(async () => {
                await changeBoss({
                  runId: run._id,
                  encounterId: encounter._id,
                  bossId: boss.id,
                });
                onDone();
              }),
            );
          }
        }}
      >
        <ComboboxInput
          aria-label="Boss"
          placeholder="Boss, place or region"
          className="w-full max-lg:h-11"
          showTrigger={false}
          pending={pending}
        />
        <ComboboxContent>
          <ComboboxEmpty>Type a boss's name, place or region.</ComboboxEmpty>
          <ComboboxList>
            {(boss: Boss) => (
              <ComboboxItem key={boss.id} value={boss}>
                <Lines {...bossLines(boss)} />
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}

function BossChanger({ run, encounter }: { run: RunView; encounter: RunEncounter }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Change ${encounter.name} to another boss`}
            title="Change boss"
          />
        }
      >
        <IconReplace />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverTitle>Change boss</PopoverTitle>
        <BossChangeForm run={run} encounter={encounter} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

// Starts from the Nickname as it is, and calls `onDone` once a save or clear
// goes through. A refusal is shown like any other and leaves it open. The
// boss's name can be put in at the cursor, for a Nickname built around it.
function NicknameForm({
  runId,
  encounter,
  onDone,
}: {
  runId: Id<"runs">;
  encounter: RunEncounter;
  onDone: () => void;
}) {
  const setNickname = useMutation(api.encounters.setNickname);
  const attempt = useAttempt();
  const [pending, track] = usePending();
  const [draft, setDraft] = useState(encounter.nickname ?? "");
  const input = useRef<HTMLInputElement>(null);
  const bossName = encounterLines(encounter).title;
  const insertBossName = () => {
    const field = input.current!;
    const start = field.selectionStart ?? draft.length;
    const end = field.selectionEnd ?? draft.length;
    const caret = start + bossName.length;
    setDraft(draft.slice(0, start) + bossName + draft.slice(end));
    // Once the new value is in, so the cursor lands after the name.
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(caret, caret);
    });
  };
  const save = (value: string | null) =>
    track(() =>
      attempt(async () => {
        await setNickname({ runId, encounterId: encounter._id, nickname: value });
        onDone();
      }),
    );
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.trim()) {
          save(draft);
        }
      }}
    >
      <Input
        ref={input}
        aria-label="Nickname"
        placeholder={bossName}
        autoComplete="off"
        maxLength={MAX_ENCOUNTER_NAME_LENGTH}
        className="max-lg:h-11"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mr-auto max-lg:h-11"
          disabled={draft.length + bossName.length > MAX_ENCOUNTER_NAME_LENGTH}
          onClick={insertBossName}
        >
          <IconPlus data-icon="inline-start" />
          Boss name
        </Button>
        {encounter.nickname && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="max-lg:h-11"
            disabled={pending}
            onClick={() => save(null)}
          >
            Clear
          </Button>
        )}
        <Button
          type="submit"
          size="sm"
          className="max-lg:h-11"
          pending={pending}
          disabled={!draft.trim()}
        >
          Save
        </Button>
      </div>
    </form>
  );
}

function NicknameEditor({ runId, encounter }: { runId: Id<"runs">; encounter: RunEncounter }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Nickname ${encounter.name}`}
            title="Nickname"
          />
        }
      >
        <IconPencil />
      </PopoverTrigger>
      <PopoverContent align="end">
        <PopoverTitle>Nickname on the Overlay</PopoverTitle>
        <NicknameForm runId={runId} encounter={encounter} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

// On a phone, an Encounter's edits in one drawer rather than a row of small
// buttons, so its name keeps the room.
function EncounterDrawer({
  run,
  encounter,
  onClose,
}: {
  run: RunView;
  encounter: RunEncounter | undefined;
  onClose: () => void;
}) {
  return (
    <Drawer open={encounter !== undefined} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent>
        {encounter && (
          <>
            <DrawerHeader>
              <DrawerTitle>{encounterLines(encounter).title}</DrawerTitle>
              <DrawerDescription>{encounterLines(encounter).detail ?? "Custom Encounter"}</DrawerDescription>
            </DrawerHeader>
            <div className="flex flex-col gap-6 p-4 pb-[max(--spacing(6),env(safe-area-inset-bottom))]">
              {encounter.kind === "boss" && (
                <>
                  <section className="flex flex-col gap-2">
                    <h3 className="font-medium">Nickname on the Overlay</h3>
                    <NicknameForm runId={run._id} encounter={encounter} onDone={onClose} />
                  </section>
                  <section className="flex flex-col gap-2">
                    <h3 className="font-medium">Change boss</h3>
                    <BossChangeForm run={run} encounter={encounter} onDone={onClose} />
                  </section>
                </>
              )}
              <HiddenToggle runId={run._id} encounter={encounter} wide />
            </div>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}

// The Total, with any Mismatch beside it, and the Tags' tallies, as a row of
// figures.
export function Tallies({ run, className }: { run: RunView; className?: string }) {
  return (
    <dl className={cn("flex min-w-0 flex-wrap items-end gap-x-6 gap-y-2", className)}>
      <Tally label="Total" value={run.total} />
      {tallyTiles(run.tallies).map((tally) => (
        <Tally key={tally.tagId} label={tally.name} value={tally.count} />
      ))}
      {run.mismatch !== null && <Mismatch count={run.mismatch} />}
    </dl>
  );
}

export function Tally({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex shrink-0 flex-col-reverse">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tracking-tight">
        <Roll value={value} />
      </dd>
    </div>
  );
}

// More Deaths in the Run than the save has. Mods clear it by removing some.
export function Mismatch({ count }: { count: number }) {
  return (
    <div className="self-center">
      <dt className="sr-only">Mismatch</dt>
      <dd>
        <Badge variant="orange" className="h-6 px-2 text-meta">
          {count.toLocaleString()} more than the save
        </Badge>
      </dd>
    </div>
  );
}
