import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  IconArrowDown,
  IconArrowUp,
  IconBookmarks,
  IconCopy,
  IconLayoutBottombar,
  IconLink,
  IconPencil,
  IconPlus,
  IconSpeakerphone,
  IconX,
} from "@tabler/icons-react";
import { Skeleton, SkeletonText } from "@ui/components/skeleton";
import { cn } from "@ui/lib/utils";
import { Button } from "@ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@ui/components/field";
import { Input } from "@ui/components/input";
import { Label } from "@ui/components/label";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@ui/components/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui/components/select";
import { Slider } from "@ui/components/slider";
import { Switch } from "@ui/components/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ui/components/tabs";
import { Textarea } from "@ui/components/textarea";
import { toast } from "@ui/components/toast";
import { Toggle as ToggleButton } from "@ui/components/toggle";
import { usePending } from "@ui/hooks/use-pending";
import { ToggleGroup, ToggleGroupItem } from "@ui/components/toggle-group";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Overlay as OverlayData } from "../../convex/overlay";
import { useAttempt } from "../useAttempt";
import { findGoogleFont } from "./googleFonts";
import { BUNDLED_FONTS, useFontFaces } from "./fonts";
import { Overlay, OverlayList } from "./Overlay";
import {
  asPanel,
  canPopOut,
  DEFAULT_STYLE,
  isPanel,
  isPopout,
  LABEL_LINES,
  LABELLED_STATS,
  MAX_LABEL_LINE,
  parseStyle,
  pieceKey,
  pieceTag,
  RANGES,
  STAT_LABELS,
  statLabel,
  SYSTEM_FONT,
  tagLabel,
  type FontSource,
  type LabelledStat,
  type OverlayStyle,
  type Piece,
  type PlacedPiece,
} from "./style";
import {
  exportPreset,
  importPreset,
  parsePreset,
  presetName,
  type Preset,
} from "./presets";
import { PreviewRoot } from "./PreviewRoot";
import "./editor.css";

// A change is saved once the slider stops moving, and OBS follows each save.
const SAVE_AFTER_MS = 400;

// Shown in the preview while there's no active Run.
const SAMPLE: OverlayData = {
  encounter: { name: "Margit, the Fell Omen", deathCount: 12 },
  total: 345,
  gravity: 7,
  tags: [{ tagId: "sample", name: "Gravity", count: 7, gravity: true }],
  encounters: [
    { name: "Overworld", deathCount: 120, defeated: false },
    { name: "Margit, the Fell Omen", deathCount: 12, defeated: true },
    { name: "Godrick the Grafted", deathCount: 9, defeated: false },
  ],
  defeated: [{ name: "Margit, the Fell Omen", deathCount: 12 }],
  // Four minutes before the Panel opened.
  lastDeathAt: Date.now() - 4 * 60_000,
  streamDeaths: 23,
  streamFelled: 2,
  popoutAt: null,
  playTime: { seconds: 187_651, running: false, receivedAt: 0, lastSeenAt: null },
};

const PIECE_NAMES: Record<Piece, string> = {
  encounter: "Current Encounter",
  total: "Total",
  gravity: "Gravity",
  sinceDeath: "Time since the last Death",
  stream: "Deaths this Stream",
  felled: "Bosses felled this Stream",
  overworld: "Overworld's Deaths",
  playTime: "Play Time",
};

// Attempts and bosses Defeated have no piece, but have a label.
const STAT_NAMES: Record<LabelledStat, string> = {
  total: PIECE_NAMES.total,
  attempts: "Attempts at this boss",
  defeated: "Bosses Defeated",
  sinceDeath: PIECE_NAMES.sinceDeath,
  stream: PIECE_NAMES.stream,
  felled: PIECE_NAMES.felled,
  overworld: PIECE_NAMES.overworld,
  playTime: PIECE_NAMES.playTime,
  popoutFelled: "Before a boss felled",
  popoutToughest: "Before the boss with the most Deaths",
};

type Change = (current: OverlayStyle) => OverlayStyle;

// The style as saved on the backend, and the edits on top of it that aren't
// saved yet. A save by someone else shows once this editor has nothing of its
// own waiting, so their change and ours never mix halfway.
function useStyle() {
  const saved = useQuery(api.overlayStyle.current);
  const save = useMutation(api.overlayStyle.save);
  const attempt = useAttempt("The style couldn't be saved.");
  const [draft, setDraft] = useState<OverlayStyle>();
  // The latest draft, so a change that lands late, like a looked-up Google
  // Font, builds on it rather than on what was there when it started.
  const latest = useRef<OverlayStyle>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const unsaved = useRef(false);

  useEffect(() => {
    if (saved !== undefined && !unsaved.current) {
      latest.current = parseStyle(saved);
      setDraft(latest.current);
    }
  }, [saved]);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  function update(change: Change, { now = false } = {}) {
    if (!latest.current) {
      return;
    }
    const changed = change(latest.current);
    latest.current = changed;
    setDraft(changed);
    unsaved.current = true;
    const send = () =>
      attempt(() => save({ style: changed })).finally(() => {
        // A later change has its own save coming.
        if (latest.current === changed) {
          unsaved.current = false;
        }
      });
    clearTimeout(saveTimer.current);
    if (now) {
      void send();
    } else {
      saveTimer.current = setTimeout(send, SAVE_AFTER_MS);
    }
  }

  return { style: draft, update };
}

// The Preview sticks to the top, under the page's header, and the controls
// scroll beneath it. On the widest screens it sits beside them instead, as
// the Style page lays them out. It shows the active Run's counts, as OBS
// does, with a sample Play Time while the App sends none, so the Streamer
// can see where it would go.
export function StyleEditor() {
  const overlay = useQuery(api.overlay.current);
  const { style, update } = useStyle();
  if (!style) {
    return <StyleEditorSkeleton />;
  }
  const setStyle = (changed: OverlayStyle) => update(() => changed);
  // Only the Run's own Tags can be placed.
  const tags = overlay?.tags ?? [];

  return (
    <>
      <Preview
        style={style}
        overlay={
          overlay
            ? { ...overlay, playTime: overlay.playTime ?? SAMPLE.playTime }
            : SAMPLE
        }
        tools={
          <>
            {overlay && (style.layout === "banner" || style.layout === "framed") && (
              <PopOutToughest overlay={overlay} />
            )}
            <PresetsButton
              style={style}
              onUse={(preset) => update(() => preset, { now: true })}
            />
            <AddToObs />
          </>
        }
      />
      <Tabs defaultValue="layout" className={CONTROLS}>
        <ControlTabs />
        <TabsContent value="layout" className={TAB}>
          <LayoutControls style={style} tags={tags} onChange={setStyle} />
          {(style.layout === "banner" || style.layout === "framed") && (
            <Group title="Popouts">
              <PopoutControls style={style} onChange={setStyle} />
            </Group>
          )}
        </TabsContent>
        <TabsContent value="text" className={TAB}>
          <Group title="Font">
            <FontControls style={style} onChange={update} />
          </Group>
          <Group title="Outline and shadow">
            <EffectControls style={style} onChange={setStyle} />
          </Group>
          <Group title="Colours">
            <ColorControls style={style} onChange={setStyle} />
          </Group>
        </TabsContent>
        <TabsContent value="position" className={TAB}>
          <PlacementControls style={style} onChange={setStyle} />
        </TabsContent>
      </Tabs>
    </>
  );
}

// One group of controls shows at a time, so none pushes another out of
// reach. On the widest screens they're the Style page's first column.
const CONTROLS = "panel gap-0 2xl:col-start-1 2xl:row-start-1";
const TAB = "flex flex-col gap-4 p-4";

function ControlTabs() {
  return (
    <div className="border-b p-3">
      <TabsList className="w-full">
        <TabsTrigger value="layout">Layout</TabsTrigger>
        <TabsTrigger value="text">Text</TabsTrigger>
        <TabsTrigger value="position">Position</TabsTrigger>
      </TabsList>
    </div>
  );
}

// The editor with the style yet to come: the Preview's frame, and the
// Layout tab, open as it starts.
export function StyleEditorSkeleton() {
  return (
    <>
      <section aria-busy="true" aria-label="Loading" className={PREVIEW}>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-44 rounded-full md:w-80" />
          <Skeleton className="ml-auto h-8 w-8 rounded-full sm:w-24" />
          <Skeleton className="h-8 w-8 rounded-full sm:w-28" />
        </div>
        <Skeleton className="h-64 w-full rounded-2xl 2xl:h-auto 2xl:aspect-video" />
      </section>
      <Tabs
        aria-busy="true"
        value="layout"
        className={cn(CONTROLS, "pointer-events-none")}
      >
        <ControlTabs />
        <div className={TAB}>
          <div className={ROW}>
            <SkeletonText className="w-16" />
            <Skeleton className="h-9 rounded-3xl" />
          </div>
          <ol className="flex flex-col rounded-2xl border">
            {Object.keys(PIECE_NAMES).map((piece) => (
              <li key={piece} className={LIST_ROW}>
                <Skeleton className="h-4.5 w-8 rounded-full" />
                <SkeletonText className="w-36" />
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-3 py-2">
            <Skeleton className="h-4.5 w-8 rounded-full" />
            <SkeletonText className="w-52" />
          </div>
        </div>
      </Tabs>
    </>
  );
}

// Below the header, across the page and edge to edge, or on the widest
// screens in the Style page's second column, beside the controls.
const PREVIEW =
  "sticky top-14 z-10 -mx-4 flex shrink-0 flex-col gap-3 border-b bg-background px-4 py-3 lg:top-16 lg:-mx-6 lg:px-6 2xl:col-start-2 2xl:row-start-1 2xl:mx-0 2xl:border-b-0 2xl:px-0 2xl:py-0";

// The Browser source the Preview stands in for on the widest screens. OBS
// lays the Overlay out in the source's own pixels, so the Preview does too
// and shrinks the whole of it to fit.
const SOURCE = { width: 1920, height: 1080 };

type PreviewView = "overlay" | "list";

function Preview({
  style,
  overlay,
  tools,
}: {
  style: OverlayStyle;
  overlay: OverlayData;
  tools: ReactNode;
}) {
  const [view, setView] = useState<PreviewView>("overlay");
  useFontFaces(style.font);
  return (
    <section aria-label="Preview" className={PREVIEW}>
      <div className="flex items-center gap-2">
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Preview"
          value={[view]}
          // Pressing the view that's showing keeps it showing.
          onValueChange={([pressed]) => pressed && setView(pressed as PreviewView)}
        >
          <ToggleGroupItem value="overlay">
            Overlay{" "}
            <code className="hidden font-mono text-xs text-muted-foreground md:inline">
              /overlay
            </code>
          </ToggleGroupItem>
          <ToggleGroupItem value="list">
            List view{" "}
            <code className="hidden font-mono text-xs text-muted-foreground md:inline">
              /overlay/list
            </code>
          </ToggleGroupItem>
        </ToggleGroup>
        <span className="ml-auto hidden font-mono text-xs text-muted-foreground 2xl:inline">
          {SOURCE.width} × {SOURCE.height}
        </span>
        <div className="ml-auto flex items-center gap-2 2xl:ml-2">{tools}</div>
      </div>
      <Stage>
        {view === "list" ? (
          <OverlayList overlay={overlay} style={style} />
        ) : (
          <Overlay overlay={overlay} style={style} />
        )}
      </Stage>
    </section>
  );
}

// The checks show through wherever OBS would show the scene. On the widest
// screens it's the whole Browser source, shrunk to the column, and cuts off
// what would fall outside it as OBS does. Elsewhere it scrolls.
function Stage({ children }: { children: ReactNode }) {
  const stage = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);

  useLayoutEffect(() => {
    const element = stage.current!;
    const observer = new ResizeObserver(() =>
      setFit(element.clientWidth / SOURCE.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={stage}
      // A ring rather than a border, which would take from the source's room.
      className="preview-stage h-[clamp(8rem,30vh,16rem)] overflow-auto rounded-2xl border p-2 2xl:aspect-video 2xl:h-auto 2xl:overflow-hidden 2xl:border-0 2xl:p-0 2xl:ring-1 2xl:ring-border"
    >
      <div
        className="2xl:h-(--source-height) 2xl:w-(--source-width) 2xl:origin-top-left 2xl:scale-(--fit)"
        style={
          {
            "--source-width": `${SOURCE.width}px`,
            "--source-height": `${SOURCE.height}px`,
            "--fit": fit,
          } as CSSProperties
        }
      >
        <PreviewRoot>{children}</PreviewRoot>
      </div>
    </div>
  );
}

const ROW = "grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3";

// A list's rows, as tall as a fingertip on a touch screen.
const LIST_ROW =
  "flex min-h-11 items-center gap-1 border-b py-1 pr-1 pl-3 last:border-b-0 pointer-coarse:min-h-tap";

// A slider, and the colour of what it sizes beside it when it has one.
function SliderControl({
  label,
  value,
  range,
  unit = "",
  color,
  onChange,
}: {
  label: string;
  value: number;
  range: { min: number; max: number; step: number };
  unit?: string;
  color?: { value: string; onChange: (value: string) => void };
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        "grid items-center gap-3",
        color
          ? "grid-cols-[7rem_auto_minmax(0,1fr)_3.5rem]"
          : "grid-cols-[7rem_minmax(0,1fr)_3.5rem]",
      )}
    >
      <span id={id}>{label}</span>
      {color && (
        <ColorInput label={`${label} colour`} value={color.value} onChange={color.onChange} />
      )}
      {/* An array, since ui/'s Slider draws a thumb per value. */}
      <Slider
        aria-labelledby={id}
        {...range}
        value={[value]}
        onValueChange={(changed) =>
          onChange(Array.isArray(changed) ? changed[0]! : (changed as number))
        }
      />
      <output className="text-right font-mono text-xs text-muted-foreground tabular-nums">
        {value}
        {unit}
      </output>
    </div>
  );
}

function ColorInput({
  label,
  value,
  onChange,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="color"
      aria-label={label}
      className="h-8 w-12 shrink-0 cursor-pointer rounded-xl border bg-input/50 p-1 [&::-webkit-color-swatch]:rounded-lg [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

function ColorControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={ROW}>
      <span>{label}</span>
      <span className="flex items-center gap-3">
        <ColorInput value={value} onChange={onChange} />
        <span className="font-mono text-xs text-muted-foreground uppercase">{value}</span>
      </span>
    </label>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className={ROW}>
      <span id={id}>{label}</span>
      <Select
        items={options}
        value={value}
        onValueChange={(chosen) => chosen !== null && onChange(chosen as T)}
      >
        <SelectTrigger aria-labelledby={id} className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Label className="gap-3 py-2 font-normal">
      <Switch checked={checked} onCheckedChange={onChange} />
      {label}
    </Label>
  );
}

// Controls under a heading, within a tab.
function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 not-first:border-t not-first:pt-4">
      <h3 id={id} className="text-meta font-medium text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

type Controls = { style: OverlayStyle; onChange: (style: OverlayStyle) => void };

// A Tag's piece goes by the Tag's name, which follows a rename.
function pieceName(entry: PlacedPiece, tags: OverlayData["tags"]) {
  const tag = pieceTag(entry, tags);
  if (tag) {
    return tag.name;
  }
  return entry.piece === "tag" ? "A removed Tag" : PIECE_NAMES[entry.piece];
}

// The stats each piece labels. The Current Encounter's two take turns in the
// panels.
const PIECE_STATS: Partial<Record<PlacedPiece["piece"], LabelledStat[]>> = {
  encounter: ["attempts", "defeated"],
  total: ["total"],
  sinceDeath: ["sinceDeath"],
  stream: ["stream"],
  felled: ["felled"],
  overworld: ["overworld"],
  playTime: ["playTime"],
};

// What's on the Overlay, in what order, and how it's arranged. Any of the
// Run's Tags can be placed as a piece, besides Gravity, which always has
// one. The Card has no place for Tags, nor for the other stats the feed
// shows but the Play Time.
function LayoutControls({
  style,
  tags,
  onChange,
}: Controls & { tags: OverlayData["tags"] }) {
  function move(index: number, by: number) {
    const pieces = [...style.pieces];
    const [moved] = pieces.splice(index, 1);
    pieces.splice(index + by, 0, moved!);
    onChange({ ...style, pieces });
  }
  const setPiece = (key: string, change: (entry: PlacedPiece) => PlacedPiece) =>
    onChange({
      ...style,
      pieces: style.pieces.map((entry) => (pieceKey(entry) === key ? change(entry) : entry)),
    });
  const unplaced = tags.filter(
    (tag) =>
      !tag.gravity &&
      !style.pieces.some((entry) => pieceTag(entry, tags) === tag),
  );
  const banner = style.layout === "banner" || style.layout === "framed";
  const popouts = banner && style.popouts.timing !== "off";

  return (
    <>
      <Choice
        label="Arranged"
        value={style.layout}
        options={[
          { value: "stacked", label: "Stacked" },
          { value: "row", label: "In a row" },
          { value: "card", label: "Card" },
          { value: "banner", label: "Banner" },
          { value: "framed", label: "Framed" },
        ]}
        // Moving between panels keeps the Streamer's changes to their look.
        onChange={(layout) =>
          onChange(
            isPanel(layout) && !isPanel(style.layout)
              ? asPanel(style, layout)
              : { ...style, layout },
          )
        }
      />
      <ol className="flex flex-col rounded-2xl border" aria-label="Pieces">
        {style.pieces.map((placed, index) => {
          const key = pieceKey(placed);
          const name = pieceName(placed, tags);
          const tag = pieceTag(placed, tags);
          const stats = PIECE_STATS[placed.piece];
          return (
            <li key={key} className={LIST_ROW}>
              <Label className="min-w-0 flex-1 gap-3 py-2 font-normal">
                <Switch
                  checked={placed.show}
                  onCheckedChange={(show) => setPiece(key, (entry) => ({ ...entry, show }))}
                />
                <span className="truncate">{name}</span>
              </Label>
              {tag && (
                <LabelButton
                  name={name}
                  entries={[
                    {
                      name,
                      label: placed.label,
                      usual: tagLabel(withLabel(placed, undefined), tag.name),
                    },
                  ]}
                  usualName="Use the Tag's name"
                  onSave={([label]) => setPiece(key, (entry) => withLabel(entry, label))}
                />
              )}
              {stats && (
                <LabelButton
                  name={name}
                  entries={stats.map((stat) => ({
                    name: STAT_NAMES[stat],
                    label: style.labels[stat],
                    usual: STAT_LABELS[stat],
                  }))}
                  usualName={stats.length > 1 ? "Use the usual labels" : "Use the usual label"}
                  onSave={(changed) => {
                    const labels = { ...style.labels };
                    stats.forEach((stat, which) => {
                      const label = changed[which];
                      if (label) {
                        labels[stat] = label;
                      } else {
                        delete labels[stat];
                      }
                    });
                    onChange({ ...style, labels });
                  }}
                />
              )}
              {popouts && canPopOut(placed) && (
                <ToggleButton
                  size="sm"
                  className="px-0"
                  aria-label={`Show ${name} as a Popout`}
                  pressed={isPopout(placed, style)}
                  onPressedChange={(popout) =>
                    setPiece(key, (entry) => ({ ...entry, popout }))
                  }
                >
                  <IconLayoutBottombar />
                </ToggleButton>
              )}
              {placed.piece === "tag" && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Take ${name} off the Overlay`}
                  onClick={() =>
                    onChange({
                      ...style,
                      pieces: style.pieces.filter((entry) => pieceKey(entry) !== key),
                    })
                  }
                >
                  <IconX />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${name} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <IconArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${name} down`}
                disabled={index === style.pieces.length - 1}
                onClick={() => move(index, 1)}
              >
                <IconArrowDown />
              </Button>
            </li>
          );
        })}
      </ol>
      {unplaced.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Tags to place">
          {unplaced.map((tag) => (
            <Button
              key={tag.tagId}
              variant="outline"
              size="sm"
              onClick={() =>
                onChange({
                  ...style,
                  pieces: [
                    ...style.pieces,
                    { piece: "tag", tagId: tag.tagId, show: true },
                  ],
                })
              }
            >
              <IconPlus data-icon="inline-start" />
              {tag.name}
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-col">
        {style.layout === "banner" && (
          <Toggle
            label="Moon emblem"
            checked={style.emblem}
            onChange={(emblem) => onChange({ ...style, emblem })}
          />
        )}
        {isPanel(style.layout) && (
          <Toggle
            label="“You died” on each Death"
            checked={style.youDied}
            onChange={(youDied) => onChange({ ...style, youDied })}
          />
        )}
        {banner && (
          <Toggle
            label="Show the feed"
            checked={style.tagFeed}
            onChange={(tagFeed) => onChange({ ...style, tagFeed })}
          />
        )}
        <Toggle
          label="Show Overworld in the List view"
          checked={style.overworld}
          onChange={(overworld) => onChange({ ...style, overworld })}
        />
      </div>
      {banner && style.tagFeed && (
        <SliderControl
          label="Each for"
          unit="s"
          value={style.tagSeconds}
          range={RANGES.tagSeconds}
          onChange={(tagSeconds) => onChange({ ...style, tagSeconds })}
        />
      )}
    </>
  );
}

// The labels before a boss's name in a Popout. The boss with the most
// Deaths is the one Mods pop out by hand.
const POPOUT_LABELS: LabelledStat[] = ["popoutFelled", "popoutToughest"];

// When the Banner and the Framed banner open the line along their bottom
// for the Popouts, which Defeated bosses they go through, and for how long.
// The stats marked as Popouts in the list above show there too.
function PopoutControls({ style, onChange }: Controls) {
  const { popouts } = style;
  const set = (changed: Partial<OverlayStyle["popouts"]>) =>
    onChange({ ...style, popouts: { ...popouts, ...changed } });
  return (
    <>
      <Choice
        label="Show"
        value={popouts.timing}
        options={[
          { value: "off", label: "Never" },
          { value: "afterFeed", label: "After each round of the feed" },
          { value: "always", label: "All the while, between fights" },
          { value: "every", label: "Every few minutes" },
        ]}
        onChange={(timing) => set({ timing })}
      />
      {popouts.timing !== "off" && (
        <>
          <p className="text-meta text-muted-foreground">
            Stats marked{" "}
            <IconLayoutBottombar className="inline size-4 align-text-bottom" aria-label="as a Popout" />{" "}
            in the list above show here instead of in the feed.
          </p>
          <Choice
            label="Bosses felled"
            value={popouts.bosses}
            options={[
              { value: "latest", label: "The latest, going further back" },
              { value: "toughest", label: "The most Deaths" },
              { value: "all", label: "All of them" },
            ]}
            onChange={(bosses) => set({ bosses })}
          />
          {popouts.bosses !== "all" && (
            <SliderControl
              label="How many"
              value={popouts.count}
              range={RANGES.popoutCount}
              onChange={(count) => set({ count })}
            />
          )}
          {popouts.timing === "every" && (
            <SliderControl
              label="Every"
              unit="m"
              value={popouts.minutes}
              range={RANGES.popoutMinutes}
              onChange={(minutes) => set({ minutes })}
            />
          )}
        </>
      )}
      {/* The Mods' popout of the toughest boss uses it too. */}
      <SliderControl
        label="Each for"
        unit="s"
        value={popouts.seconds}
        range={RANGES.popoutSeconds}
        onChange={(seconds) => set({ seconds })}
      />
      <div className={ROW}>
        <span>Labels</span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {POPOUT_LABELS.map((stat) => `“${statLabel(style, stat).replace("\n", " ")}”`).join(", ")}
          </span>
          <LabelButton
            name="the Popouts"
            oneLine
            entries={POPOUT_LABELS.map((stat) => ({
              name: STAT_NAMES[stat],
              label: style.labels[stat],
              usual: STAT_LABELS[stat],
            }))}
            usualName="Use the usual labels"
            onSave={(changed) => {
              const labels = { ...style.labels };
              POPOUT_LABELS.forEach((stat, which) => {
                const label = changed[which];
                if (label) {
                  labels[stat] = label;
                } else {
                  delete labels[stat];
                }
              });
              onChange({ ...style, labels });
            }}
          />
        </span>
      </div>
    </>
  );
}

const SOURCES: { value: FontSource; label: string }[] = [
  { value: "installed", label: "Installed on the streaming PC" },
  { value: "bundled", label: "Bundled with Erdtrack" },
  { value: "google", label: "Google Fonts" },
];

type FontChange = { style: OverlayStyle; onChange: (change: Change) => void };

function FontControls({ style, onChange }: FontChange) {
  const setFont = (font: Partial<OverlayStyle["font"]>) =>
    onChange((current) => ({ ...current, font: { ...current.font, ...font } }));

  // The default stands in until a font is named.
  function chooseSource(source: FontSource) {
    setFont(
      source === "bundled"
        ? { source, family: BUNDLED_FONTS[0]!, faces: [] }
        : { source, family: SYSTEM_FONT, faces: [] },
    );
  }

  return (
    <>
      <Choice
        label="From"
        value={style.font.source}
        options={SOURCES}
        onChange={chooseSource}
      />
      {style.font.source === "bundled" && (
        <Choice
          label="Family"
          value={style.font.family}
          options={[
            ...(BUNDLED_FONTS.includes(style.font.family) ? [] : [style.font.family]),
            ...BUNDLED_FONTS,
          ].map((family) => ({ value: family, label: family }))}
          onChange={(family) => setFont({ family, faces: [] })}
        />
      )}
      {style.font.source === "installed" && (
        <FontNameForm
          // A new form when someone else's save changes it.
          key={style.font.family}
          id="installed-family"
          label="Installed font"
          action="Use"
          initial={style.font.family === SYSTEM_FONT ? "" : style.font.family}
          description="By its name as installed on the PC that runs OBS. The preview only shows it if it's installed on this device too."
          onSubmit={async (family) =>
            setFont({ source: "installed", family, faces: [] })
          }
        />
      )}
      {style.font.source === "google" && (
        <FontNameForm
          key={style.font.family}
          id="google-family"
          label="Google Font"
          action="Use"
          initial={style.font.family === SYSTEM_FONT ? "" : style.font.family}
          description="By its name on fonts.google.com. The Overlay loads it from Google."
          onSubmit={async (name) => {
            const font = await findGoogleFont(name);
            onChange((current) => ({
              ...current,
              font: { ...current.font, source: "google", ...font },
            }));
          }}
        />
      )}
      <SliderControl
        label="Size"
        unit="px"
        value={style.font.size}
        range={RANGES.size}
        onChange={(size) => setFont({ size })}
      />
      <SliderControl
        label="Weight"
        value={style.font.weight}
        range={RANGES.weight}
        onChange={(weight) => setFont({ weight })}
      />
    </>
  );
}

// A font named by hand. Throws a message to show when it can't be used.
function FontNameForm({
  id,
  label,
  action,
  initial,
  description,
  onSubmit,
}: {
  id: string;
  label: string;
  action: string;
  initial: string;
  description: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get("family");
    const family = typeof name === "string" ? name.trim() : "";
    if (!family) {
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      await onSubmit(family);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={submit}>
      <Field data-invalid={error !== undefined} className="gap-1.5">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <div className="flex gap-2">
          <Input
            id={id}
            name="family"
            defaultValue={initial}
            placeholder="Cinzel Decorative"
            autoComplete="off"
            maxLength={100}
            aria-invalid={error !== undefined}
          />
          <Button type="submit" variant="secondary" pending={pending}>
            {action}
          </Button>
        </div>
        <FieldDescription>{description}</FieldDescription>
        <FieldError>{error}</FieldError>
      </Field>
    </form>
  );
}

function EffectControls({ style, onChange }: Controls) {
  return (
    <>
      <SliderControl
        label="Outline"
        unit="px"
        value={style.outline.width}
        range={RANGES.outline}
        color={{
          value: style.outline.color,
          onChange: (color) => onChange({ ...style, outline: { ...style.outline, color } }),
        }}
        onChange={(width) => onChange({ ...style, outline: { ...style.outline, width } })}
      />
      <SliderControl
        label="Shadow"
        unit="px"
        value={style.shadow.blur}
        range={RANGES.shadow}
        color={{
          value: style.shadow.color,
          onChange: (color) => onChange({ ...style, shadow: { ...style.shadow, color } }),
        }}
        onChange={(blur) => onChange({ ...style, shadow: { ...style.shadow, blur } })}
      />
    </>
  );
}

function ColorControls({ style, onChange }: Controls) {
  const setColors = (colors: Partial<OverlayStyle["colors"]>) =>
    onChange({ ...style, colors: { ...style.colors, ...colors } });
  return (
    <>
      <ColorControl label="Text" value={style.colors.text} onChange={(text) => setColors({ text })} />
      <ColorControl
        label="Accent"
        value={style.colors.accent}
        onChange={(accent) => setColors({ accent })}
      />
      <SliderControl
        label="Background"
        value={style.colors.backgroundOpacity}
        range={RANGES.backgroundOpacity}
        color={{
          value: style.colors.background,
          onChange: (background) => setColors({ background }),
        }}
        onChange={(backgroundOpacity) => setColors({ backgroundOpacity })}
      />
      <p className="text-muted-foreground">
        The slider is the background's opacity. At 0 it's transparent, and the
        scene shows through.
      </p>
    </>
  );
}

function PlacementControls({ style, onChange }: Controls) {
  const banner = style.layout === "banner" || style.layout === "framed";
  return (
    <>
      <SliderControl
        label="Scale"
        unit="×"
        value={style.scale}
        range={RANGES.scale}
        onChange={(scale) => onChange({ ...style, scale })}
      />
      <Choice
        label="Alignment"
        value={style.align}
        options={[
          { value: "left", label: "Left" },
          { value: "center", label: "Centre" },
          { value: "right", label: "Right" },
        ]}
        onChange={(align) => onChange({ ...style, align })}
      />
      <SliderControl
        label="Left / right"
        unit="px"
        value={style.offset.x}
        range={RANGES.offset}
        onChange={(x) => onChange({ ...style, offset: { ...style.offset, x } })}
      />
      <SliderControl
        label="Up / down"
        unit="px"
        value={style.offset.y}
        range={RANGES.offset}
        onChange={(y) => onChange({ ...style, offset: { ...style.offset, y } })}
      />
      <SliderControl
        label="Padding"
        unit="px"
        value={style.padding}
        range={RANGES.padding}
        onChange={(padding) => onChange({ ...style, padding })}
      />
      {banner && (
        <>
          <SliderControl
            label="Width"
            unit="px"
            value={style.width}
            range={RANGES.width}
            onChange={(width) => onChange({ ...style, width })}
          />
          <SliderControl
            label="Height"
            unit="px"
            value={style.height}
            range={RANGES.height}
            onChange={(height) => onChange({ ...style, height })}
          />
          <p className="text-muted-foreground">
            At 0 it's as tall as it needs. Set shorter than that, its labels go
            on one line, and it widens to fit them.
          </p>
        </>
      )}
    </>
  );
}

// A piece with a label, or with none so it shows the Tag's name.
function withLabel(entry: PlacedPiece, label: string | undefined): PlacedPiece {
  const { label: _old, ...rest } = entry;
  return label ? { ...rest, label } : rest;
}

type LabelEntry = { name: string; label: string | undefined; usual: string };

// A piece's labels, and a way to change them a line at a time. A label left
// empty is the usual one.
function LabelButton({
  name,
  entries,
  usualName,
  oneLine = false,
  onSave,
}: {
  name: string;
  entries: LabelEntry[];
  usualName: string;
  oneLine?: boolean;
  onSave: (labels: (string | undefined)[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<string[][]>([]);
  const save = (labels: (string | undefined)[]) => {
    onSave(labels);
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setLines(entries.map((entry) => entry.label?.split("\n") ?? []));
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={`Label ${name} on the Overlay`} />
        }
      >
        <IconPencil />
      </PopoverTrigger>
      <PopoverContent align="end" className="text-sm">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(
              entries.map(
                (_, which) =>
                  (lines[which] ?? [])
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .join("\n") || undefined,
              ),
            );
          }}
        >
          <PopoverTitle>
            {entries.length > 1 ? "Labels on the Overlay" : "Label on the Overlay"}
          </PopoverTitle>
          {entries.map((entry, which) => (
            <fieldset key={entry.name} className="flex flex-col gap-2">
              {entries.length > 1 && (
                <legend className="mb-2 text-meta text-muted-foreground">{entry.name}</legend>
              )}
              {Array.from({ length: oneLine ? 1 : LABEL_LINES }, (_, index) => (
                <Input
                  key={index}
                  aria-label={oneLine ? entry.name : `${entry.name}, line ${index + 1}`}
                  placeholder={entry.usual.split("\n")[index] ?? ""}
                  autoComplete="off"
                  maxLength={MAX_LABEL_LINE}
                  value={lines[which]?.[index] ?? ""}
                  onChange={(event) => {
                    const next = lines.map((entryLines) => [...entryLines]);
                    (next[which] ??= [])[index] = event.target.value;
                    setLines(next);
                  }}
                />
              ))}
            </fieldset>
          ))}
          {!oneLine && (
            <p className="text-meta text-muted-foreground">
              The Banner and the Framed banner show both lines. The other layouts
              put them on one.
            </p>
          )}
          <div className="flex justify-end gap-2">
            {entries.some((entry) => entry.label) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mr-auto"
                onClick={() => save(entries.map(() => undefined))}
              >
                {usualName}
              </Button>
            )}
            <Button type="submit" size="sm">
              Save
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

// Where OBS, or a StreamElements widget's frame, shows the Overlay. Both are
// public, as they're shown on stream anyway.
const ADDRESSES = [
  { name: "Overlay", path: "/overlay" },
  { name: "List view", path: "/overlay/list" },
];

// Pops out the boss with the most Deaths on the Overlay, such as when chat
// asks. It's rarely wanted, so it's tucked away here by the Preview, which
// shows it too. The Overlay finds the boss from its own counts, the same
// way: any Encounter on its lists but Overworld. There's none before one
// has a Death.
function PopOutToughest({ overlay }: { overlay: OverlayData }) {
  const popOut = useMutation(api.overlay.popOut);
  const attempt = useAttempt();
  const [popping, track] = usePending();
  const toughest = overlay.encounters
    .filter(({ name }) => name !== "Overworld")
    .reduce<OverlayData["encounters"][number] | null>(
      (most, encounter) =>
        encounter.deathCount > (most?.deathCount ?? 0) ? encounter : most,
      null,
    );
  const label = toughest
    ? `Pop out ${toughest.name}, the boss with the most Deaths`
    : "Pop out the boss with the most Deaths";
  return (
    <Button
      variant="outline"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={!toughest}
      pending={popping}
      onClick={() => track(() => attempt(() => popOut({})))}
    >
      <IconSpeakerphone />
    </Button>
  );
}

function AddToObs() {
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" aria-label="Add to OBS" />}
      >
        <IconLink data-icon="inline-start" />
        <span className="hidden sm:inline">Add to OBS</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[30rem] text-sm">
        <PopoverTitle>Add to OBS</PopoverTitle>
        <p className="text-muted-foreground">
          Add each as a Browser source in OBS, or frame it in a StreamElements
          widget. Each follows every change here as it's saved.
        </p>
        <ul className="flex flex-col rounded-2xl border">
          {ADDRESSES.map(({ name, path }) => (
            <Address key={path} name={name} url={`${location.origin}${path}`} />
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function Address({ name, url }: { name: string; url: string }) {
  return (
    <li className={cn(LIST_ROW, "gap-3")}>
      <span className="w-16 shrink-0 font-medium">{name}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
        {url}
      </code>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Copy the ${name}'s address`}
        onClick={() =>
          void navigator.clipboard.writeText(url).then(
            () => toast.add({ title: "Copied." }),
            () => toast.add({ type: "error", title: "Couldn't copy it." }),
          )
        }
      >
        <IconCopy />
      </Button>
    </li>
  );
}

function PresetsButton({
  style,
  onUse,
}: {
  style: OverlayStyle;
  onUse: (style: OverlayStyle) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" aria-label="Presets" />}
      >
        <IconBookmarks data-icon="inline-start" />
        <span className="hidden sm:inline">Presets</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 gap-4 text-sm">
        <PopoverTitle>Presets</PopoverTitle>
        <Presets style={style} onUse={onUse} />
        <div className="border-t pt-4">
          <Button variant="outline" size="sm" onClick={() => onUse(DEFAULT_STYLE)}>
            Back to the default style
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Kept on the backend for the channel, so every Mod sees the same ones.
function Presets({
  style,
  onUse,
}: {
  style: OverlayStyle;
  onUse: (style: OverlayStyle) => void;
}) {
  const saved = useQuery(api.overlayStyle.presets);
  const savePreset = useMutation(api.overlayStyle.savePreset);
  const deletePreset = useMutation(api.overlayStyle.deletePreset);
  const attempt = useAttempt();
  const presets = (saved ?? []).flatMap((entry) => parsePreset(entry) ?? []);
  const [exported, setExported] = useState<Preset>();
  const [nameError, setNameError] = useState<string>();
  const [importError, setImportError] = useState<string>();

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = new FormData(form).get("name");
    const name = presetName(typeof input === "string" ? input : "");
    if (!name) {
      setNameError("Give the Preset a name of up to 50 characters.");
      return;
    }
    setNameError(undefined);
    void attempt(() => savePreset({ name, style }));
    form.reset();
  }

  function importText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const text = new FormData(form).get("preset");
    const preset = importPreset(typeof text === "string" ? text : "");
    if (!preset) {
      setImportError("That isn't a Preset. Paste the whole text Erdtrack exported.");
      return;
    }
    setImportError(undefined);
    void attempt(() => savePreset(preset));
    form.reset();
  }

  return (
    <>
      {presets.length > 0 && (
        <ul className="flex flex-col rounded-2xl border">
          {presets.map((preset) => (
            <li
              key={preset.name}
              className={LIST_ROW}
            >
              <span className="min-w-0 flex-1 truncate font-medium">{preset.name}</span>
              <Button variant="ghost" size="sm" onClick={() => onUse(preset.style)}>
                Use
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setExported(preset)}>
                Export
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => void attempt(() => deletePreset({ name: preset.name }))}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
      {exported && (
        <Field className="gap-1.5">
          <FieldLabel htmlFor="exported">“{exported.name}”</FieldLabel>
          <Textarea
            id="exported"
            readOnly
            rows={6}
            className="max-h-40 font-mono text-xs"
            value={exportPreset(exported)}
          />
          <FieldDescription>Paste this into Import, here or in another Erdtrack.</FieldDescription>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => void navigator.clipboard.writeText(exportPreset(exported))}
            >
              Copy
            </Button>
            <Button variant="ghost" onClick={() => setExported(undefined)}>
              Close
            </Button>
          </div>
        </Field>
      )}
      <form noValidate onSubmit={save}>
        <Field data-invalid={nameError !== undefined} className="gap-1.5">
          <FieldLabel htmlFor="preset-name">Save the current style</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="preset-name"
              name="name"
              placeholder="Preset name"
              autoComplete="off"
              maxLength={50}
              aria-invalid={nameError !== undefined}
            />
            <Button type="submit" variant="secondary">
              Save Preset
            </Button>
          </div>
          <FieldDescription>A name already used is replaced.</FieldDescription>
          <FieldError>{nameError}</FieldError>
        </Field>
      </form>
      <form noValidate onSubmit={importText}>
        <Field data-invalid={importError !== undefined} className="gap-1.5">
          <FieldLabel htmlFor="import">Import a Preset</FieldLabel>
          <Textarea
            id="import"
            name="preset"
            rows={3}
            spellCheck={false}
            className="max-h-40 font-mono text-xs"
            placeholder="Paste its exported text"
            aria-invalid={importError !== undefined}
          />
          <FieldError>{importError}</FieldError>
          <div>
            <Button type="submit" variant="secondary">
              Import
            </Button>
          </div>
        </Field>
      </form>
    </>
  );
}
