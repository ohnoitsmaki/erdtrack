// How the Overlay looks. It's saved on the backend for the channel, edited in
// the Panel, and read by the Overlay page, which checks it with parseStyle
// like the Panel does.

// Besides the counts, how long since the latest Death, how many Deaths the
// Stream has had and how many bosses it's felled, Overworld's count, and the
// Play Time.
export type Piece =
  | "encounter"
  | "total"
  | "gravity"
  | "sinceDeath"
  | "stream"
  | "felled"
  | "overworld"
  | "playTime";

// One of the pieces every style has, or a Tag's tally, placed by its Tag
// ID. Gravity's piece is the Gravity Tag's, so styles saved before Tags
// keep showing it. A Tag's piece, Gravity's among them, can have a label
// of its own for the Overlay, its lines split by "\n", while the Tag keeps
// its name everywhere else. A piece the feed has a place for can be a
// Popout instead.
export type PlacedPiece =
  | { piece: Piece; show: boolean; label?: string; popout?: boolean }
  | {
      piece: "tag";
      tagId: string;
      show: boolean;
      label?: string;
      popout?: boolean;
    };

// A file of a Google Font, which the Overlay loads straight from Google.
export type FontFace = {
  url: string;
  weight: number;
  italic: boolean;
  unicodeRange?: string;
};

export type FontSource = "installed" | "bundled" | "google";

export type OverlayStyle = {
  // In the order they're arranged. The Card has a place for each, so it
  // only follows whether each shows.
  pieces: PlacedPiece[];
  layout: Layout;
  // Whether the Banner shows its moon emblem.
  emblem: boolean;
  // Whether the List view shows Overworld's line.
  overworld: boolean;
  // Faces are only set for a Google Font.
  font: {
    family: string;
    source: FontSource;
    faces: FontFace[];
    size: number;
    weight: number;
  };
  outline: { width: number; color: string };
  shadow: { blur: number; color: string };
  // A background opacity of 0 is fully transparent.
  colors: {
    text: string;
    accent: string;
    background: string;
    backgroundOpacity: number;
  };
  scale: number;
  align: "left" | "center" | "right";
  // How far the Overlay is moved from where it's aligned, in px. Right and
  // down are positive.
  offset: { x: number; y: number };
  padding: number;
  // How wide and how tall the Banner and the Framed banner are at the
  // least, in px. They grow past each to fit what's in them.
  width: number;
  height: number;
  // The labels the Streamer gave the stats, its lines split by "\n". A
  // stat without one keeps its usual label.
  labels: Partial<Record<LabelledStat, string>>;
  // Whether the Banner and the Framed banner show the feed, where the Tags'
  // tallies and the other stats take turns, and how long each before the
  // next, in seconds. Named for the Tags, which came first.
  tagFeed: boolean;
  tagSeconds: number;
  popouts: Popouts;
  // Whether the Card, the Banner and the Framed banner call out each Death
  // with "You died" sweeping across them.
  youDied: boolean;
};

// When the Banner and the Framed banner open their lower line for the
// Popouts while no boss is being fought: never, after each round of the
// feed, all the while, or every few minutes. Which Defeated bosses each
// round goes through: the latest few, going further back each round, all
// of them, or the few with the most Deaths. And how long each shows.
export type Popouts = {
  timing: PopoutTiming;
  bosses: PopoutBosses;
  // How many bosses a round of the latest or the toughest goes through.
  count: number;
  seconds: number;
  // How long between rounds, every few minutes.
  minutes: number;
};

export const POPOUT_TIMINGS = ["off", "afterFeed", "always", "every"] as const;
export type PopoutTiming = (typeof POPOUT_TIMINGS)[number];

export const POPOUT_BOSSES = ["latest", "all", "toughest"] as const;
export type PopoutBosses = (typeof POPOUT_BOSSES)[number];

// The pieces the feed has a place for, which can be Popouts instead.
const FEED_PIECES: PlacedPiece["piece"][] = [
  "gravity",
  "tag",
  "sinceDeath",
  "stream",
  "felled",
  "overworld",
  "playTime",
];

// Those whose labels are long enough to fit better in a Popout start as
// one.
const POPOUT_PIECES: PlacedPiece["piece"][] = ["sinceDeath", "overworld"];

export function canPopOut(entry: PlacedPiece) {
  return FEED_PIECES.includes(entry.piece);
}

// Whether a piece shows as a Popout rather than in the feed. With the
// Popouts off, it's in the feed.
export function isPopout(entry: PlacedPiece, style: OverlayStyle) {
  return (
    style.popouts.timing !== "off" &&
    canPopOut(entry) &&
    (entry.popout ?? POPOUT_PIECES.includes(entry.piece))
  );
}

export const PIECES: Piece[] = [
  "encounter",
  "total",
  "gravity",
  "sinceDeath",
  "stream",
  "felled",
  "overworld",
  "playTime",
];

export const LAYOUTS = ["stacked", "row", "card", "banner", "framed"] as const;

export type Layout = (typeof LAYOUTS)[number];

// The layouts drawn as a dark panel, which share one look.
const PANELS: Layout[] = ["card", "banner", "framed"];

export function isPanel(layout: Layout) {
  return PANELS.includes(layout);
}

// The font an installed font falls back to, and stands in until a Google
// Font is chosen.
export const SYSTEM_FONT = "system-ui";

// The Overlay starts as the Framed banner.
export const DEFAULT_STYLE: OverlayStyle = asPanel({
  pieces: PIECES.map((piece) => ({ piece, show: true })),
  layout: "stacked",
  emblem: true,
  overworld: true,
  font: {
    family: SYSTEM_FONT,
    source: "installed",
    faces: [],
    size: 32,
    weight: 700,
  },
  outline: { width: 0, color: "#000000" },
  shadow: { blur: 6, color: "#000000" },
  colors: {
    text: "#ffffff",
    accent: "#ffffff",
    background: "#000000",
    backgroundOpacity: 0,
  },
  scale: 1,
  align: "left",
  offset: { x: 0, y: 0 },
  padding: 12,
  width: 600,
  height: 0,
  labels: {},
  tagFeed: true,
  tagSeconds: 30,
  popouts: {
    timing: "afterFeed",
    bosses: "latest",
    count: 5,
    seconds: 6,
    minutes: 5,
  },
  youDied: true,
}, "framed");

// Picking a panel layout also gives it the look the panels were designed
// with: a dark panel, Cinzel, and gold on warm white, with no outline or
// glow. What shows is kept, and the Streamer can change any of the rest
// afterwards.
export function asPanel(
  style: OverlayStyle,
  layout: Layout = "card",
): OverlayStyle {
  return {
    ...style,
    layout,
    font: {
      family: "Cinzel Variable",
      source: "bundled",
      faces: [],
      size: 34,
      weight: 600,
    },
    outline: { ...style.outline, width: 0 },
    shadow: { ...style.shadow, blur: 0 },
    colors: {
      text: "#ece6d8",
      accent: "#d9c27e",
      background: "#0b0908",
      backgroundOpacity: 0.92,
    },
    padding: 20,
  };
}

// The Encounters the List view draws, in the Run's order. Overworld is
// known by its name, as the Card and Banner know it.
export function listViewEncounters<T extends { name: string }>(
  encounters: T[],
  style: OverlayStyle,
): T[] {
  return style.overworld
    ? encounters
    : encounters.filter((encounter) => encounter.name !== "Overworld");
}

// What each number's control allows. A saved number outside it is brought
// into range.
export const RANGES = {
  size: { min: 8, max: 200, step: 1 },
  weight: { min: 100, max: 900, step: 100 },
  outline: { min: 0, max: 10, step: 0.5 },
  shadow: { min: 0, max: 30, step: 1 },
  backgroundOpacity: { min: 0, max: 1, step: 0.05 },
  scale: { min: 0.25, max: 4, step: 0.05 },
  offset: { min: -1000, max: 1000, step: 1 },
  padding: { min: 0, max: 100, step: 1 },
  width: { min: 0, max: 2000, step: 10 },
  height: { min: 0, max: 1000, step: 10 },
  tagSeconds: { min: 5, max: 600, step: 5 },
  popoutCount: { min: 1, max: 20, step: 1 },
  popoutSeconds: { min: 2, max: 60, step: 1 },
  popoutMinutes: { min: 1, max: 60, step: 1 },
} as const;

type Range = (typeof RANGES)[keyof typeof RANGES];

type Fields = Record<string, unknown>;

function fields(value: unknown): Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : {};
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T) {
  return options.includes(value as T) ? (value as T) : fallback;
}

function number(value: unknown, range: Range, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(range.max, Math.max(range.min, value));
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function color(value: unknown, fallback: string) {
  return typeof value === "string" && HEX_COLOR.test(value)
    ? value.toLowerCase()
    : fallback;
}

const MAX_FAMILY_LENGTH = 100;
// The family is put in quotes in the CSS, so nothing that could end the
// quotes or the declaration gets through.
const UNSAFE_IN_FAMILY = /["'\\;{}<>()\p{Cc}]/u;

function family(value: unknown, fallback: string) {
  const name = typeof value === "string" ? value.trim() : "";
  return name &&
    name.length <= MAX_FAMILY_LENGTH &&
    !UNSAFE_IN_FAMILY.test(name)
    ? name
    : fallback;
}

// Only Google's own font host, which the Overlay's CSP allows, so a face
// can't point anywhere else. Nothing that could end the url() gets through.
const FONT_URL = /^https:\/\/fonts\.gstatic\.com\/[A-Za-z0-9/._-]+$/;
const UNICODE_RANGE = /^U\+[0-9A-F?]{1,6}(-[0-9A-F]{1,6})?(, ?U\+[0-9A-F?]{1,6}(-[0-9A-F]{1,6})?)*$/i;

// Tells the pieces apart, a Tag's by its Tag.
export function pieceKey(entry: PlacedPiece) {
  return entry.piece === "tag" ? `tag:${entry.tagId}` : entry.piece;
}

// The Tag a piece shows the tally of, if it's a Tag's. None for a removed
// Tag, which isn't among the Tags.
export function pieceTag<T extends { tagId: string; gravity: boolean }>(
  entry: PlacedPiece,
  tags: T[],
): T | undefined {
  if (entry.piece === "gravity") {
    return tags.find((tag) => tag.gravity);
  }
  return entry.piece === "tag"
    ? tags.find((tag) => tag.tagId === entry.tagId)
    : undefined;
}

// A Tag's label is at most two lines of this many characters.
export const LABEL_LINES = 2;
export const MAX_LABEL_LINE = 20;

// What the Overlay calls a Tag's tally: its own label, or else the Tag's
// name over "deaths".
export function tagLabel(entry: PlacedPiece, name: string) {
  return entry.label ?? `${name}\ndeaths`;
}

// A label's lines, trimmed and cut to length, the empty ones dropped. None
// when nothing is left, so the Tag's name shows.
function label(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const lines = value
    .split("\n")
    .map((line) => line.replace(/\p{Cc}/gu, "").trim().slice(0, MAX_LABEL_LINE))
    .filter(Boolean)
    .slice(0, LABEL_LINES);
  return lines.length > 0 ? lines.join("\n") : undefined;
}

// The stats with a label, besides the Tags' tallies, which each have their
// own on its piece. Attempts and bosses Defeated take turns in the panels,
// and have no piece of their own. Nor do the labels before a Defeated
// boss's name in a Popout, and before the boss with the most Deaths.
// A Popout's label is on one line.
export const LABELLED_STATS = [
  "total",
  "attempts",
  "defeated",
  "sinceDeath",
  "stream",
  "felled",
  "overworld",
  "playTime",
  "popoutFelled",
  "popoutToughest",
] as const;

export type LabelledStat = (typeof LABELLED_STATS)[number];

// What the panels usually call each stat, on two lines but the Popouts'.
export const STAT_LABELS: Record<LabelledStat, string> = {
  total: "Total\ndeaths",
  attempts: "Attempts\nat this boss",
  defeated: "Bosses\nfelled",
  sinceDeath: "Time since\nlast death",
  stream: "Deaths\nthis stream",
  felled: "Felled\nthis stream",
  overworld: "Overworld\ndeaths",
  playTime: "Play\ntime",
  popoutFelled: "Felled",
  popoutToughest: "Most deaths",
};

// What the Overlay calls a stat: the Streamer's label, or else its usual
// one.
export function statLabel(style: OverlayStyle, stat: LabelledStat) {
  return style.labels[stat] ?? STAT_LABELS[stat];
}

function labels(value: unknown) {
  const saved = fields(value);
  const kept: OverlayStyle["labels"] = {};
  for (const stat of LABELLED_STATS) {
    const labelled = label(saved[stat]);
    if (labelled) {
      kept[stat] = labelled;
    }
  }
  return kept;
}

// What a Convex ID is made of.
const TAG_ID = /^[a-z0-9]{1,64}$/;

// Each piece once, in the saved order. Unknown ones are dropped, like the
// deadliest boss the App's styles had, and any that's missing shows at the
// end.
function pieces(value: unknown) {
  const arranged: OverlayStyle["pieces"] = [];
  const placed = (entry: PlacedPiece) =>
    arranged.some((other) => pieceKey(other) === pieceKey(entry));
  for (const entry of Array.isArray(value) ? value : []) {
    const { piece, tagId, show, label: saved, popout } = fields(entry);
    const kept: PlacedPiece | null =
      piece === "tag" && typeof tagId === "string" && TAG_ID.test(tagId)
        ? { piece, tagId, show: show !== false }
        : PIECES.includes(piece as Piece)
          ? { piece: piece as Piece, show: show !== false }
          : null;
    // Only a Tag's piece has a label.
    const labelled = label(saved);
    if (kept && labelled && (kept.piece === "tag" || kept.piece === "gravity")) {
      kept.label = labelled;
    }
    // Left out, a piece is a Popout or not as it starts.
    if (kept && typeof popout === "boolean" && canPopOut(kept)) {
      kept.popout = popout;
    }
    if (kept && !placed(kept)) {
      arranged.push(kept);
    }
  }
  for (const piece of PIECES) {
    if (!arranged.some((placed) => placed.piece === piece)) {
      arranged.push({ piece, show: true });
    }
  }
  return arranged;
}

// Faces that name anything but a file on Google's font host are dropped. A
// range that isn't a plain unicode-range is dropped, and the face covers
// everything.
function faces(value: unknown): FontFace[] {
  const kept: FontFace[] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const { url, weight, italic, unicodeRange } = fields(entry);
    if (typeof url !== "string" || !FONT_URL.test(url)) {
      continue;
    }
    kept.push({
      url,
      weight: number(weight, RANGES.weight, 400),
      italic: italic === true,
      ...(typeof unicodeRange === "string" && UNICODE_RANGE.test(unicodeRange)
        ? { unicodeRange }
        : {}),
    });
  }
  return kept;
}

// Whatever was saved on the backend or in a Preset, or pasted in an
// export, as a complete style. Anything missing or unusable takes its default.
export function parseStyle(value: unknown): OverlayStyle {
  const saved = fields(value);
  const font = fields(saved.font);
  const outline = fields(saved.outline);
  const shadow = fields(saved.shadow);
  const colors = fields(saved.colors);
  const offset = fields(saved.offset);
  const popouts = fields(saved.popouts);
  const defaults = DEFAULT_STYLE;
  return {
    pieces: pieces(saved.pieces),
    layout: oneOf(saved.layout, LAYOUTS, defaults.layout),
    emblem: saved.emblem !== false,
    overworld: saved.overworld !== false,
    font: {
      family: family(font.family, defaults.font.family),
      source: oneOf(
        font.source,
        ["installed", "bundled", "google"],
        defaults.font.source,
      ),
      faces: faces(font.faces),
      size: number(font.size, RANGES.size, defaults.font.size),
      weight:
        Math.round(
          number(font.weight, RANGES.weight, defaults.font.weight) / 100,
        ) * 100,
    },
    outline: {
      width: number(outline.width, RANGES.outline, defaults.outline.width),
      color: color(outline.color, defaults.outline.color),
    },
    shadow: {
      blur: number(shadow.blur, RANGES.shadow, defaults.shadow.blur),
      color: color(shadow.color, defaults.shadow.color),
    },
    colors: {
      text: color(colors.text, defaults.colors.text),
      accent: color(colors.accent, defaults.colors.accent),
      background: color(colors.background, defaults.colors.background),
      backgroundOpacity: number(
        colors.backgroundOpacity,
        RANGES.backgroundOpacity,
        defaults.colors.backgroundOpacity,
      ),
    },
    scale: number(saved.scale, RANGES.scale, defaults.scale),
    align: oneOf(saved.align, ["left", "center", "right"], defaults.align),
    offset: {
      x: number(offset.x, RANGES.offset, defaults.offset.x),
      y: number(offset.y, RANGES.offset, defaults.offset.y),
    },
    padding: number(saved.padding, RANGES.padding, defaults.padding),
    width: number(saved.width, RANGES.width, defaults.width),
    height: number(saved.height, RANGES.height, defaults.height),
    labels: labels(saved.labels),
    tagFeed: saved.tagFeed !== false,
    tagSeconds: number(
      saved.tagSeconds,
      RANGES.tagSeconds,
      defaults.tagSeconds,
    ),
    popouts: {
      timing: oneOf(popouts.timing, POPOUT_TIMINGS, defaults.popouts.timing),
      bosses: oneOf(popouts.bosses, POPOUT_BOSSES, defaults.popouts.bosses),
      count: Math.round(
        number(popouts.count, RANGES.popoutCount, defaults.popouts.count),
      ),
      seconds: number(
        popouts.seconds,
        RANGES.popoutSeconds,
        defaults.popouts.seconds,
      ),
      minutes: number(
        popouts.minutes,
        RANGES.popoutMinutes,
        defaults.popouts.minutes,
      ),
    },
    youDied: saved.youDied !== false,
  };
}
