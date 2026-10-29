import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { IconHourglass, IconSkull, IconSwords } from "@tabler/icons-react";
import type { Overlay as OverlayData } from "../../convex/overlay";
import { fontFamily } from "./fonts";
import { formatPlayTime, playTimeAt, type PlayTime } from "./playTime";
import {
  isPopout,
  listViewEncounters,
  pieceKey,
  pieceTag,
  statLabel,
  tagLabel,
  type LabelledStat,
  type OverlayStyle,
  type Piece,
  type PlacedPiece,
} from "./style";

// Outline offsets around each letter, at a width of 1px.
const OUTLINE_DIRECTIONS = Array.from({ length: 16 }, (_, step) => {
  const angle = (step / 16) * 2 * Math.PI;
  return [Math.cos(angle), Math.sin(angle)] as const;
});

// The outline is drawn as sharp shadows in a ring around each letter, since
// older versions of OBS's browser can't draw a stroke outside the letters.
// The blurred shadow comes last, so it sits beneath the outline.
function textShadow({ outline, shadow }: OverlayStyle) {
  const layers: string[] = [];
  if (outline.width > 0) {
    for (const [x, y] of OUTLINE_DIRECTIONS) {
      layers.push(
        `${(x * outline.width).toFixed(2)}px ${(y * outline.width).toFixed(2)}px 0 ${outline.color}`,
      );
    }
  }
  if (shadow.blur > 0) {
    layers.push(`0 0 ${shadow.blur}px ${shadow.color}`);
  }
  return layers.join(", ") || "none";
}

function rgba(hex: string, opacity: number) {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

const JUSTIFY = { left: "flex-start", center: "center", right: "flex-end" };

// The style as CSS variables, which overlay.css uses. They're set through
// the DOM, which the Overlay's Content Security Policy allows.
function properties(style: OverlayStyle) {
  return {
    "--font": fontFamily(style.font.family),
    "--size": `${style.font.size}px`,
    "--weight": String(style.font.weight),
    "--text": style.colors.text,
    "--accent": style.colors.accent,
    // The panels' borders and rules, and the Banner's glow.
    "--accent-faint": rgba(style.colors.accent, 0.25),
    "--accent-soft": rgba(style.colors.accent, 0.1),
    "--accent-glow": rgba(style.colors.accent, 0.5),
    "--background": rgba(
      style.colors.background,
      style.colors.backgroundOpacity,
    ),
    "--text-shadow": textShadow(style),
    "--scale": String(style.scale),
    "--align": style.align,
    "--justify": JUSTIFY[style.align],
    "--offset-x": `${style.offset.x}px`,
    "--offset-y": `${style.offset.y}px`,
    "--padding": `${style.padding}px`,
    "--width": `${style.width}px`,
    "--height": `${style.height}px`,
  } as CSSProperties;
}

function Frame({
  style,
  className,
  panel,
  children,
}: {
  style: OverlayStyle;
  className: string;
  panel?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div className="overlay-frame" style={properties(style)}>
      <div ref={panel} className={`overlay ${className}`}>
        {children}
      </div>
    </div>
  );
}

// The compact Overlay: the pieces the Streamer chose, in their order, out of the
// Current Encounter and its count, the Run's Total, the tallies of Gravity
// and any other Tags, the time since the latest Death, the Stream's Deaths
// and bosses felled, Overworld's count, and the Play Time. Nothing shows
// until there are counts, and the Play Time only while the App sends it.
export function Overlay({
  overlay,
  style,
}: {
  overlay: OverlayData | null;
  style: OverlayStyle;
}) {
  if (!overlay) {
    return null;
  }
  const shown = style.pieces.filter(({ show }) => show);
  if (style.layout === "card") {
    return <Card overlay={overlay} style={style} />;
  }
  if (style.layout === "banner" || style.layout === "framed") {
    return <Banner overlay={overlay} style={style} />;
  }
  if (shown.length === 0) {
    return null;
  }
  return (
    <Frame style={style} className={style.layout}>
      {shown.map((entry) => (
        <PieceView
          key={pieceKey(entry)}
          entry={entry}
          overlay={overlay}
          style={style}
        />
      ))}
    </Frame>
  );
}

// A stat's label on one line, as the stacked and row layouts and the Card
// show it, or else what they usually call it.
function inline(style: OverlayStyle, stat: LabelledStat, usual: string) {
  return style.labels[stat]?.replace("\n", " ") ?? usual;
}

function PieceView({
  entry,
  overlay,
  style,
}: {
  entry: PlacedPiece;
  overlay: OverlayData;
  style: OverlayStyle;
}) {
  switch (entry.piece) {
    case "encounter":
      return (
        <div className="encounter">
          <span className="name">{overlay.encounter.name}</span>{" "}
          <span className="count">{overlay.encounter.deathCount}</span>
        </div>
      );
    case "total":
      return (
        <div className="tally">
          {inline(style, "total", "Total")}{" "}
          <span className="count">{overlay.total}</span>
        </div>
      );
    // A removed Tag's shows nothing.
    case "gravity":
    case "tag": {
      const tag = pieceTag(entry, overlay.tags);
      return (
        tag && (
          <div className="tally">
            {/* On one line here, and the Tag's name alone unless it has
                a label. */}
            {entry.label?.replace("\n", " ") ?? tag.name}{" "}
            <span className="count">{tag.count}</span>
          </div>
        )
      );
    }
    case "sinceDeath":
      return (
        overlay.lastDeathAt !== null && (
          <div className="tally">
            {inline(style, "sinceDeath", "Time since last death")}{" "}
            <span className="count">
              <Elapsed since={overlay.lastDeathAt} />
            </span>
          </div>
        )
      );
    case "stream":
      return (
        overlay.streamDeaths !== null && (
          <div className="tally">
            {inline(style, "stream", "Deaths this stream")}{" "}
            <span className="count">{overlay.streamDeaths}</span>
          </div>
        )
      );
    case "felled":
      return (
        overlay.streamFelled !== null && (
          <div className="tally">
            {inline(style, "felled", "Felled this stream")}{" "}
            <span className="count">{overlay.streamFelled}</span>
          </div>
        )
      );
    case "overworld": {
      const overworld = overworldOf(overlay);
      return (
        overworld && (
          <div className="tally">
            {inline(style, "overworld", "Overworld deaths")}{" "}
            <span className="count">{overworld.deathCount}</span>
          </div>
        )
      );
    }
    case "playTime":
      return (
        overlay.playTime && (
          <div className="tally">
            {inline(style, "playTime", "Play time")}{" "}
            <span className="count">
              <Played playTime={overlay.playTime} />
            </span>
          </div>
        )
      );
  }
}

// The Play Time, counting on while the Watcher's clock runs. Only its digits
// sit in boxes, as the time since a Death's do.
function Played({ playTime }: { playTime: PlayTime }) {
  return formatPlayTime(playTimeAt(playTime, useNow()))
    .split(":")
    .map((part, index) => (
      <Fragment key={index}>
        {index > 0 && ":"}
        <Digits value={part} />
      </Fragment>
    ));
}

// Overworld is known by its name, as the List view knows it.
function overworldOf({ encounters }: OverlayData) {
  return encounters.find(({ name }) => name === "Overworld");
}

// The time now, ticking on every second.
function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  return now;
}

// The time since `since`, as m:ss, or h:mm:ss from an hour. Never below
// 0:00, in case this clock is behind the backend's.
function Elapsed({ since }: { since: number }) {
  const seconds = Math.max(0, Math.floor((useNow() - since) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const parts = [
    ...(hours > 0 ? [String(hours)] : []),
    hours > 0 ? String(minutes).padStart(2, "0") : String(minutes),
    String(seconds % 60).padStart(2, "0"),
  ];
  return parts.map((part, index) => (
    <Fragment key={index}>
      {index > 0 && ":"}
      <Digits value={part} />
    </Fragment>
  ));
}


// The Card lists only this many Defeated bosses, the latest beaten, so it
// stays the same size however far the Run goes.
const CARD_DEFEATED = 5;

// The Card: the Total in the top right with the Play Time under it, the boss
// being fought, and the Defeated bosses. Each piece has its own place, so the
// Streamer's order doesn't apply, only whether it shows. It has no place for
// Tags' tallies.
function Card({
  overlay: latest,
  style,
}: {
  overlay: OverlayData;
  style: OverlayStyle;
}) {
  const { overlay, deaths } = useYouDied(latest, style.youDied);
  const shows = (piece: Piece) =>
    style.pieces.some((entry) => entry.piece === piece && entry.show);
  // Overworld is the Current Encounter whenever no boss is set, and there's
  // nothing being fought then.
  const fighting =
    shows("encounter") && overlay.encounter.name !== "Overworld";
  // The last boss fought stays in place while the fight's section closes.
  const [lastFought, setLastFought] = useState(
    fighting ? overlay.encounter : null,
  );
  if (fighting && lastFought !== overlay.encounter) {
    setLastFought(overlay.encounter);
  }
  const { defeated } = overlay;
  const unlisted = Math.max(0, defeated.length - CARD_DEFEATED);
  const played = shows("playTime") ? overlay.playTime : null;
  if (!shows("total") && !played && !fighting && defeated.length === 0) {
    return null;
  }
  return (
    <Frame style={style} className="card">
      <YouDied deaths={deaths} />
      {(shows("total") || played) && (
        <div className="total">
          {shows("total") && (
            <>
              <span className="label">
                <IconSkull className="icon" aria-hidden />{" "}
                {inline(style, "total", "Deaths")}
              </span>
              <Count value={overlay.total} />
            </>
          )}
          {played && (
            <span className="played">
              <IconHourglass
                className="icon"
                aria-label={inline(style, "playTime", "Play time")}
              />
              <span>
                <Played playTime={played} />
              </span>
            </span>
          )}
        </div>
      )}
      <Reveal open={fighting}>
        {lastFought && (
          // A different boss comes in fresh, rather than as a new count.
          <NowFighting
            key={lastFought.name}
            encounter={lastFought}
            overlay={overlay}
          />
        )}
      </Reveal>
      {defeated.length > 0 && (
        <section className="defeated">
          <h2 className="label">
            {inline(style, "defeated", "Felled")} ({defeated.length})
          </h2>
          <ul>
            {defeated.slice(unlisted).map((encounter, index) => (
              <li key={index}>
                {encounter.name}{" "}
                <span className="count">{encounter.deathCount}</span>
              </li>
            ))}
            {unlisted > 0 && <li className="more">+{unlisted} more</li>}
          </ul>
        </section>
      )}
    </Frame>
  );
}

function NowFighting({
  encounter: { name, deathCount },
  overlay,
}: {
  encounter: OverlayData["encounter"];
  overlay: OverlayData;
}) {
  const deaths = (
    <>
      <Count value={deathCount} />{" "}
      {deathCount === 1 ? "death" : "deaths"}
    </>
  );
  const defeated = overlay.encounters.some(
    (encounter) => encounter.name === name && encounter.defeated,
  );
  return (
    <section className="encounter">
      <h2 className="label">
        <IconSwords className="icon" aria-hidden /> Now fighting
      </h2>
      <div className="name">{name}</div>
      <div className="details">
        {deaths}
        {!defeated && ` · attempt ${deathCount + 1}`}
      </div>
    </section>
  );
}

// The Banner, and the Framed banner: one wide panel with the Total up front,
// how many bosses are Defeated behind a divider, and the boss being fought
// along the bottom, only while there is one. While that boss isn't yet
// Defeated, its attempt shows in place of Defeated. Unless the Streamer
// switched it off, the feed takes turns at the far end through the shown
// Tags' tallies and the other stats, in the Streamer's order. While no boss
// is being fought, the line along the bottom opens for the Popouts, when
// the Streamer chose. A Mod can pop out the boss with the most Deaths at
// any time, even over a fight. The Banner has a moon emblem and a gold
// rule; the Framed has a double frame and puts the boss in a darker strip.
// Like the Card, each piece has its own place.
function Banner({
  overlay: latest,
  style,
}: {
  overlay: OverlayData;
  style: OverlayStyle;
}) {
  const { overlay, deaths, holding } = useYouDied(latest, style.youDied);
  const shows = (piece: Piece) =>
    style.pieces.some((entry) => entry.piece === piece && entry.show);
  const fighting =
    shows("encounter") && overlay.encounter.name !== "Overworld";
  // While fighting a boss not yet Defeated, Defeated gives way to the
  // attempt this is at.
  const attempt =
    fighting &&
    !overlay.encounters.some(
      ({ name, defeated }) => name === overlay.encounter.name && defeated,
    )
      ? overlay.encounter.deathCount + 1
      : null;
  // The attempt stays as it was while it gives way.
  const [lastAttempt, setLastAttempt] = useState(attempt ?? 1);
  if (attempt && attempt !== lastAttempt) {
    setLastAttempt(attempt);
  }
  const sinceDeathShows = usePassed(overlay.lastDeathAt, SINCE_DEATH_WAIT_MS);
  const feed = style.pieces.flatMap((entry) =>
    entry.show && !isPopout(entry, style)
      ? feedStats(entry, overlay, style, sinceDeathShows)
      : [],
  );
  const feedOpen = style.tagFeed && feed.length > 0;
  const toughest = useToughest(overlay, style);
  const popouts = usePopouts(overlay, style, {
    idle: !fighting,
    paused: holding || toughest !== null,
    feedCycles: feedOpen && turning(feed).length > 1,
    sinceDeathShows,
  });
  const line: Line | null =
    toughest ??
    (fighting
      ? {
          key: `fighting:${overlay.encounter.name}`,
          name: overlay.encounter.name,
          count: overlay.encounter.deathCount,
        }
      : popouts.shown);
  // The last line shown stays in place while it closes.
  const [lastLine, setLastLine] = useState(line);
  if (line && !sameLine(line, lastLine)) {
    setLastLine(line);
  }
  // The last stats shown stay in place while they close.
  const [lastFeed, setLastFeed] = useState(feed);
  if (feed.length > 0 && tallied(feed) !== tallied(lastFeed)) {
    setLastFeed(feed);
  }
  const framed = style.layout === "framed";
  const [panel, short] = useShort(style.height);
  return (
    <Frame
      style={style}
      className={short ? `${style.layout} short` : style.layout}
      panel={panel}
    >
      <YouDied deaths={deaths} />
      {!framed && style.emblem && <Emblem />}
      <div className="main">
        <div className="stats">
          {shows("total") && (
            <div className="stat">
              <span className="label">{statLabel(style, "total")}</span>
              <Count value={overlay.total} />
            </div>
          )}
          <span className="divider" aria-hidden />
          <Passing
            shown={attempt ? "attempts" : "defeated"}
            stats={[
              {
                key: "attempts",
                label: statLabel(style, "attempts"),
                count: attempt ?? lastAttempt,
              },
              {
                key: "defeated",
                label: statLabel(style, "defeated"),
                count: overlay.defeated.length,
              },
            ]}
          />
          <span
            className={feedOpen ? "divider" : "divider closed"}
            aria-hidden
          />
          <Reveal open={feedOpen} across>
            {lastFeed.length > 0 && (
              <Feed
                stats={lastFeed}
                seconds={style.tagSeconds}
                paused={holding || popouts.pausesFeed}
                onRound={feedOpen ? popouts.onFeedRound : undefined}
              />
            )}
          </Reveal>
        </div>
        {!framed && <span className="rule" aria-hidden />}
        <Reveal open={line !== null}>
          {lastLine && <Strip line={lastLine} open={line !== null} />}
        </Reveal>
      </div>
    </Frame>
  );
}

// Whether the Streamer set the panel shorter than it needs with its labels
// on two lines, so it puts each on one line instead and widens to fit them.
// Only if that makes it shorter, which it doesn't while the Banner's
// emblem is taller than its numbers. Both are measured with no height set,
// whichever it's showing, so going short never undoes itself. They're
// measured again as the panel changes size, such as when the boss line
// opens or a font loads. A height of 0 leaves it as tall as it needs.
function useShort(height: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [short, setShort] = useState(false);

  useLayoutEffect(() => {
    const panel = ref.current!;
    const measure = () => {
      const wasShort = panel.classList.contains("short");
      // In the panel's own px, as its height is set, whatever its scale.
      const needs = (asShort: boolean) => {
        panel.classList.toggle("short", asShort);
        return parseFloat(getComputedStyle(panel).height);
      };
      panel.style.minHeight = "0px";
      const onTwoLines = needs(false);
      const onOneLine = needs(true);
      panel.style.minHeight = "";
      panel.classList.toggle("short", wasShort);
      setShort(height > 0 && height < onTwoLines && onOneLine < onTwoLines);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [height]);

  return [ref, short] as const;
}

// A stat that takes its turn in a place shared with others. A clock's count
// is the time it counts from, and the Play Time's is the seconds reported,
// which it counts on from. One that rises comes up straight away. The feed's
// usual labels are on two lines, each no longer than "this stream", so they
// say what they count without making the feed wider.
type Stat = {
  key: string;
  label: string;
  count: number;
  clock?: boolean;
  played?: PlayTime;
  rises?: boolean;
};

// How long after a Death before the feed counts the time since it, so it
// doesn't pass by at a few seconds.
const SINCE_DEATH_WAIT_MS = 30_000;

// Whether `ms` has passed since `since`, changing when it does. False with
// no time to count from.
function usePassed(since: number | null, ms: number) {
  const [passed, setPassed] = useState(
    since !== null && Date.now() - since >= ms,
  );
  useEffect(() => {
    if (since === null) {
      setPassed(false);
      return;
    }
    const left = since + ms - Date.now();
    setPassed(left <= 0);
    if (left <= 0) return;
    const timer = setTimeout(() => setPassed(true), left);
    return () => clearTimeout(timer);
  }, [since, ms]);
  return passed;
}

// What a shown piece puts in the feed: a Tag's tally, the time since the
// Stream's latest Death, the Stream's Deaths or bosses felled, Overworld's
// count, or the Play Time. Nothing for a piece with nothing to show yet, or
// one the feed has no place for. The time since the latest Death waits
// until it was a while ago.
function feedStats(
  entry: PlacedPiece,
  overlay: OverlayData,
  style: OverlayStyle,
  sinceDeathShows: boolean,
): Stat[] {
  switch (entry.piece) {
    case "gravity":
    case "tag": {
      const tag = pieceTag(entry, overlay.tags);
      return tag
        ? [
            {
              key: tag.tagId,
              label: tagLabel(entry, tag.name),
              count: tag.count,
              rises: true,
            },
          ]
        : [];
    }
    case "sinceDeath":
      return overlay.lastDeathAt === null || !sinceDeathShows
        ? []
        : [
            {
              key: "sinceDeath",
              label: statLabel(style, "sinceDeath"),
              count: overlay.lastDeathAt,
              clock: true,
            },
          ];
    case "stream":
      return overlay.streamDeaths === null
        ? []
        : [
            {
              key: "stream",
              label: statLabel(style, "stream"),
              count: overlay.streamDeaths,
            },
          ];
    case "felled":
      return overlay.streamFelled === null
        ? []
        : [
            {
              key: "felled",
              label: statLabel(style, "felled"),
              count: overlay.streamFelled,
            },
          ];
    case "overworld": {
      const overworld = overworldOf(overlay);
      return overworld
        ? [
            {
              key: "overworld",
              label: statLabel(style, "overworld"),
              count: overworld.deathCount,
            },
          ]
        : [];
    }
    case "playTime":
      return overlay.playTime
        ? [
            {
              key: "playTime",
              label: statLabel(style, "playTime"),
              count: overlay.playTime.seconds,
              played: overlay.playTime,
            },
          ]
        : [];
    default:
      return [];
  }
}

// The stats that take their turn in the feed: those not at 0, and a clock
// always. Every stat when all are at 0.
function turning(stats: Stat[]) {
  const counted = stats.filter(({ count, clock }) => clock || count > 0);
  return counted.length > 0 ? counted : stats;
}

// Tells lists of stats apart by what they show.
function tallied(stats: Stat[]) {
  return stats
    .map(
      ({ key, label, count, played }) =>
        `${key}:${label}:${count}:${played ? playTimeKey(played) : ""}`,
    )
    .join();
}

// All of it, as a Play Time that stops, or whose Watcher reports again,
// counts on differently from the same seconds.
function playTimeKey({ running, receivedAt, lastSeenAt }: PlayTime) {
  return `${running}:${receivedAt}:${lastSeenAt}`;
}

// The feed's stats, one at a time, each for the Streamer's few seconds. Counts
// at 0 are passed over, unless every stat is, but a clock always takes its
// turn. A Tag that's just had a Death comes up straight away, and its time
// starts from there. While paused, such as through "You died", none takes
// its turn, and the one shown starts its time again after. With `onRound`,
// once each has had its turn it says so, and if that pauses it, the next
// comes in as soon as it's let go.
function Feed({
  stats,
  seconds,
  paused,
  onRound,
}: {
  stats: Stat[];
  seconds: number;
  paused: boolean;
  onRound?: () => void;
}) {
  const [shownKey, setShownKey] = useState(stats[0]!.key);
  const [lastCounts, setLastCounts] = useState(stats);
  if (tallied(stats) !== tallied(lastCounts)) {
    const risen = stats.find(
      ({ key, count, rises }) =>
        rises &&
        lastCounts.some((last) => last.key === key && last.count < count),
    );
    setLastCounts(stats);
    if (risen) setShownKey(risen.key);
  }

  const taking = turning(stats);
  const shown = taking.find(({ key }) => key === shownKey) ?? taking[0]!;
  const turn = taking.map(({ key }) => key).join();
  // How many have had their turn this round, and whether the round's ended.
  const [round, setRound] = useState({ turns: 0, ended: false });
  const roundEnds = useRef(onRound);
  roundEnds.current = onRound;

  useEffect(() => {
    const keys = turn.split(",");
    if (paused || keys.length < 2) return;
    const next = keys[(keys.indexOf(shown.key) + 1) % keys.length]!;
    if (round.ended) {
      setRound({ turns: 0, ended: false });
      setShownKey(next);
      return;
    }
    const timer = setTimeout(() => {
      if (roundEnds.current && round.turns + 1 >= keys.length) {
        setRound({ turns: 0, ended: true });
        roundEnds.current();
      } else {
        setRound({ turns: round.turns + 1, ended: false });
        setShownKey(next);
      }
    }, seconds * 1000);
    return () => clearTimeout(timer);
  }, [shown.key, turn, seconds, paused, round]);

  return <Passing shown={shown.key} stats={stats} />;
}

// Stats that take turns in one place, so it's as wide as the widest and
// nothing beside it shifts. The one giving way drifts up and softens away
// as the next rises from below and comes into focus. Each comes in fresh,
// rather than as a new count.
function Passing({ shown, stats }: { shown: string; stats: Stat[] }) {
  const [last, setLast] = useState({ shown, left: "", turns: 0 });
  if (last.shown !== shown) {
    setLast({ shown, left: last.shown, turns: last.turns + 1 });
  }

  return (
    <div className="stat passing">
      {stats.map(({ key, label, count, clock, played }) => (
        <div
          key={key}
          className={
            key === shown
              ? "turn shown"
              : key === last.left
                ? "turn left"
                : "turn"
          }
          aria-hidden={key !== shown}
        >
          <span className="label">{label}</span>
          {clock || played ? (
            <span className="count">
              {played ? <Played playTime={played} /> : <Elapsed since={count} />}
            </span>
          ) : (
            <Count key={key === shown ? last.turns : "waiting"} value={count} />
          )}
        </div>
      ))}
    </div>
  );
}

// What the line along the bottom of the Banner and the Framed banner shows:
// the boss being fought, or a Popout. A Popout of a boss has a label before
// its name; a stat's label is its name, on one line. A clock's count is the
// time it counts from, and the Play Time's is the seconds reported, which it
// counts on from.
type Line = {
  key: string;
  label?: string;
  name: string;
  count: number;
  clock?: boolean;
  played?: PlayTime;
};

// The line along the bottom. It comes in with the line as it opens. While
// it's open, a different boss or Popout passes through it as the feed's
// stats do, rather than coming in as a new count: the one giving way
// drifts up and softens away as the next rises from below.
function Strip({ line, open }: { line: Line; open: boolean }) {
  const [seen, setSeen] = useState({
    shown: line,
    left: null as Line | null,
    open,
  });
  if (seen.shown.key !== line.key) {
    setSeen({ shown: line, left: seen.open ? seen.shown : null, open });
  } else if (seen.open !== open || !sameLine(line, seen.shown)) {
    setSeen({ ...seen, shown: line, open });
  }
  const { left } = seen;

  return (
    <div className="boss">
      {left && (
        <div key={left.key} className="turn out" aria-hidden>
          <LineContent line={left} />
        </div>
      )}
      <div key={line.key} className={left ? "turn in" : "turn"}>
        <LineContent line={line} />
      </div>
    </div>
  );
}

function LineContent({ line }: { line: Line }) {
  return (
    <>
      {line.label && <span className="label">{line.label}</span>}
      <FittedName name={line.name} />
      {line.clock || line.played ? (
        <span className="count">
          {line.played ? (
            <Played playTime={line.played} />
          ) : (
            <Elapsed since={line.count} />
          )}
        </span>
      ) : (
        <Count value={line.count} />
      )}
    </>
  );
}

function sameLine(line: Line, other: Line | null) {
  return (
    other !== null &&
    line.key === other.key &&
    line.label === other.label &&
    line.name === other.name &&
    line.count === other.count &&
    (line.played && playTimeKey(line.played)) ===
      (other.played && playTimeKey(other.played))
  );
}

// One round of Popouts: the stats the Streamer made Popouts, in their
// order, then the Defeated bosses the Streamer chose, latest beaten first.
// Each round of the latest few goes further back, and starts again from
// the latest once it's been through them all.
function popoutRound(
  overlay: OverlayData,
  style: OverlayStyle,
  round: number,
  sinceDeathShows: boolean,
): Line[] {
  const stats = style.pieces.flatMap((entry) =>
    entry.show && isPopout(entry, style)
      ? feedStats(entry, overlay, style, sinceDeathShows).map(
          ({ key, label, count, clock, played }) => ({
            key: `stat:${key}`,
            name: label.replace("\n", " "),
            count,
            clock,
            played,
          }),
        )
      : [],
  );
  const { bosses, count } = style.popouts;
  const latestFirst = [...overlay.defeated].reverse();
  const chosen =
    bosses === "all" || latestFirst.length <= count
      ? latestFirst
      : bosses === "toughest"
        ? [...latestFirst]
            .sort((a, b) => b.deathCount - a.deathCount)
            .slice(0, count)
        : Array.from(
            { length: count },
            (_, index) =>
              latestFirst[(round * count + index) % latestFirst.length]!,
          );
  return [
    ...stats,
    ...chosen.map(({ name, deathCount }) => ({
      key: `boss:${name}`,
      label: statLabel(style, "popoutFelled").replace("\n", " "),
      name,
      count: deathCount,
    })),
  ];
}

// The Popout showing, if any, as the Streamer chose: never, after each
// round of the feed, all the while, or every few minutes, and only while
// idle, with no boss being fought. A round shows its Popouts one at a time,
// each for the Streamer's few seconds, and closes. While paused, such as
// through "You died", none takes its turn. After each round of the feed,
// the feed waits for the Popouts. With the feed shut or still, a round of
// it is one turn.
function usePopouts(
  overlay: OverlayData,
  style: OverlayStyle,
  {
    idle,
    paused,
    feedCycles,
    sinceDeathShows,
  }: {
    idle: boolean;
    paused: boolean;
    feedCycles: boolean;
    sinceDeathShows: boolean;
  },
) {
  const { timing, seconds, minutes } = style.popouts;
  const [round, setRound] = useState(0);
  // Which of the round is showing, or null while shut.
  const [at, setAt] = useState<number | null>(null);
  const lines = popoutRound(overlay, style, round, sinceDeathShows);
  const on = idle && timing !== "off" && lines.length > 0;
  // A fight, or the Popouts switched off, shuts the round.
  if (!on && at !== null) {
    setAt(null);
  }
  const shown = on && at !== null ? (lines[at] ?? null) : null;

  useEffect(() => {
    if (!on || paused) return;
    const after = (ms: number, then: () => void) => {
      const timer = setTimeout(then, ms);
      return () => clearTimeout(timer);
    };
    if (at !== null) {
      return after(seconds * 1000, () => {
        if (at + 1 < lines.length) {
          setAt(at + 1);
          return;
        }
        setRound((done) => done + 1);
        setAt(timing === "always" ? 0 : null);
      });
    }
    switch (timing) {
      case "always":
        setAt(0);
        return;
      case "every":
        return after(minutes * 60_000, () => setAt(0));
      case "afterFeed":
        return feedCycles
          ? undefined
          : after(style.tagSeconds * 1000, () => setAt(0));
    }
  }, [on, paused, at, lines.length, timing, seconds, minutes, feedCycles, style.tagSeconds]);

  const onFeedRound = useCallback(() => {
    if (on && timing === "afterFeed") {
      setAt((showing) => showing ?? 0);
    }
  }, [on, timing]);

  return {
    shown,
    pausesFeed: timing === "afterFeed" && shown !== null,
    onFeedRound,
  };
}

// The boss with the most Deaths, popped out for the Streamer's few seconds
// each time a Mod asks, but not for an ask from before the page loaded. Any
// Encounter but Overworld, Defeated or not. Null while there's none to show.
function useToughest(overlay: OverlayData, style: OverlayStyle): Line | null {
  const { seconds } = style.popouts;
  const asks = useChanges(overlay.popoutAt);
  const [ended, setEnded] = useState(asks);

  useEffect(() => {
    if (asks === ended) return;
    const timer = setTimeout(() => setEnded(asks), seconds * 1000);
    return () => clearTimeout(timer);
  }, [asks, ended, seconds]);

  const toughest = overlay.encounters
    .filter(({ name }) => name !== "Overworld")
    .reduce<OverlayData["encounters"][number] | null>(
      (most, encounter) =>
        encounter.deathCount > (most?.deathCount ?? 0) ? encounter : most,
      null,
    );
  return asks !== ended && toughest
    ? {
        key: `toughest:${toughest.name}`,
        label: statLabel(style, "popoutToughest").replace("\n", " "),
        name: toughest.name,
        count: toughest.deathCount,
      }
    : null;
}

// How long after a Death the Card, the Banner and the Framed banner keep
// showing the counts from before it, in ms: until a moment after "You died"
// has faded, so the old count is seen again before the new one comes in.
const YOU_DIED_HOLD = 2600;

// The counts a panel shows, and how many Deaths have been called out with
// "You died". Deaths added many at once to catch up, and Deaths removed, pass
// quietly and show straight away, as does the page first loading.
function useYouDied(latest: OverlayData, on: boolean) {
  const [seen, setSeen] = useState({
    latest,
    held: null as OverlayData | null,
    deaths: 0,
  });
  if (seen.latest !== latest) {
    const died = on && latest.total === seen.latest.total + 1;
    setSeen({
      latest,
      // From before the first of any Deaths close together.
      held: died ? (seen.held ?? seen.latest) : seen.held,
      deaths: died ? seen.deaths + 1 : seen.deaths,
    });
  }

  // From the latest Death.
  useEffect(() => {
    const timer = setTimeout(
      () => setSeen((last) => ({ ...last, held: null })),
      YOU_DIED_HOLD,
    );
    return () => clearTimeout(timer);
  }, [seen.deaths]);

  return {
    overlay: on ? (seen.held ?? latest) : latest,
    deaths: on ? seen.deaths : 0,
    holding: on && seen.held !== null,
  };
}

// "You died" over the panel each time a Death is called out, like a goal on
// a scoreboard: a dark backdrop fades in over it as the words come up and
// spread, then fades away.
function YouDied({ deaths }: { deaths: number }) {
  const [ended, setEnded] = useState(deaths);
  if (deaths === ended) {
    return null;
  }
  return (
    <div
      key={deaths}
      className="you-died"
      aria-hidden
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setEnded(deaths);
      }}
    >
      <span className="words">You died</span>
    </div>
  );
}

// A crescent moon in a ring of slowly turning ticks, with a "z z" drifting
// off it. The mask needs an id of its own, since the Panel's preview and OBS
// can each show one.
function Emblem() {
  const mask = `moon-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg className="emblem" viewBox="0 0 120 120" aria-hidden>
      <defs>
        <mask id={mask}>
          <rect width="120" height="120" fill="white" />
          <circle cx="70" cy="50" r="20" fill="black" />
        </mask>
      </defs>
      <circle cx="60" cy="60" r="54" className="ring" />
      <circle cx="60" cy="60" r="44" className="ring faint" />
      <g className="ticks">
        {EMBLEM_TICKS.map(([x1, y1, x2, y2], index) => (
          <line key={index} x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
      </g>
      <path d="M60 3 l4 4 -4 4 -4 -4z M117 60 l-4 4 -4 -4 4 -4z" className="mark" />
      <circle cx="58" cy="62" r="22" mask={`url(#${mask})`} className="mark" />
      <text x="78" y="44" className="z">
        z
      </text>
      <text x="86" y="34" className="z small">
        z
      </text>
    </svg>
  );
}

// 36 ticks around the emblem's ring, every third one longer.
const EMBLEM_TICKS = Array.from({ length: 36 }, (_, step) => {
  const angle = (step / 36) * 2 * Math.PI;
  const inner = step % 3 === 0 ? 46 : 48;
  const [x, y] = [Math.cos(angle), Math.sin(angle)];
  return [60 + x * inner, 60 + y * inner, 60 + x * 52, 60 + y * 52];
});

// Each digit in a box as wide as a 0, so a count doesn't shift as it
// changes in a font without tabular figures, such as Cinzel.
function Digits({ value }: { value: number | string }) {
  return [...String(value)].map((digit, index) => (
    <span key={index} className="digit">
      {digit}
    </span>
  ));
}

// How many times the value has changed since it was first shown.
function useChanges<T>(value: T) {
  const [seen, setSeen] = useState({ value, changes: 0 });
  if (seen.value !== value) {
    setSeen({ value, changes: seen.changes + 1 });
  }
  return seen.changes;
}

// A count that springs into place each time it changes, but not when the
// page first loads.
function Count({ value }: { value: number }) {
  const changes = useChanges(value);
  return (
    <span key={changes} className={changes > 0 ? "count changed" : "count"}>
      <Digits value={value} />
    </span>
  );
}

// How far a boss's name in the Banner and the Framed banner gives way to fit
// its line: its letters close up first, then it shrinks, and past that it's
// cut short. In em, and as a share of its usual size.
const NAME_SPACING = { usual: 0.14, tightest: 0.04 };
const NAME_SMALLEST = 0.85;

// A boss's name that closes up and shrinks to fit the line the numbers give
// it, so a long name isn't cut short while it could still fit.
function FittedName({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  // Every render, since a growing count takes room from the name.
  useLayoutEffect(() => fitName(ref.current!));

  useLayoutEffect(() => {
    const element = ref.current!;
    const refit = () => fitName(element);
    // The line, not the name, since the name's own size follows its fit.
    const observer = new ResizeObserver(refit);
    observer.observe(element.parentElement!);
    document.fonts.addEventListener("loadingdone", refit);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", refit);
    };
  }, []);

  return (
    <span ref={ref} className="name">
      {name}
    </span>
  );
}

function fitName(element: HTMLElement) {
  const spacing = (value: number) =>
    element.style.setProperty("--name-spacing", `${value}em`);
  spacing(NAME_SPACING.usual);
  element.style.setProperty("--name-scale", "1");
  const room = element.clientWidth;
  const usual = element.scrollWidth;
  if (usual <= room) return;

  // The name's width falls in step with its spacing, so two measures find
  // the spacing that just fits.
  spacing(NAME_SPACING.tightest);
  const tightest = element.scrollWidth;
  if (tightest <= room) {
    const share = (usual - room) / (usual - tightest);
    spacing(
      NAME_SPACING.usual - share * (NAME_SPACING.usual - NAME_SPACING.tightest),
    );
    return;
  }
  const scale = Math.max(
    NAME_SMALLEST,
    Math.floor((room / tightest) * 1000) / 1000,
  );
  element.style.setProperty("--name-scale", `${scale}`);
}

// Grows open or shrinks shut from the height of what's in it, or its width
// when across. The size is measured, since older versions of OBS's browser
// can't transition to auto. Nothing moves when the page first loads.
function Reveal({
  open,
  across = false,
  children,
}: {
  open: boolean;
  across?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef<boolean | null>(null);
  const size = across ? "width" : "height";
  const measure = (element: HTMLElement) =>
    across ? element.offsetWidth : element.offsetHeight;

  useLayoutEffect(() => {
    const element = ref.current!;
    if (shown.current === null) {
      element.style[size] = open ? "" : "0px";
    } else if (shown.current !== open) {
      // From wherever it is, even part way through closing.
      element.style[size] = `${measure(element)}px`;
      void element.offsetHeight;
      // Measured from what's in it, since scrollHeight would count a new
      // boss's name still sliding into place.
      const content = [...element.children].reduce(
        (total, child) => total + measure(child as HTMLElement),
        0,
      );
      element.style[size] = `${open ? content : 0}px`;
    }
    shown.current = open;
  }, [open]);

  const name = across ? "reveal-across" : "reveal";
  return (
    <div
      ref={ref}
      className={open ? `${name} open` : name}
      onTransitionEnd={(event) => {
        // Once open, it follows what's in it, such as a longer name.
        if (open && event.target === ref.current) {
          ref.current.style[size] = "";
        }
      }}
    >
      {children}
    </div>
  );
}

// The List view: every Encounter in the Run with its count, and a mark on
// each Defeated boss. Overworld's line can be left out.
export function OverlayList({
  overlay,
  style,
}: {
  overlay: OverlayData | null;
  style: OverlayStyle;
}) {
  if (!overlay) {
    return null;
  }
  return (
    <Frame style={style} className="list">
      <ul>
        {listViewEncounters(overlay.encounters, style).map((encounter, index) => (
          <li
            key={index}
            className={encounter.defeated ? "defeated" : undefined}
          >
            <span className="name">{encounter.name}</span>
            <span className="count">{encounter.deathCount}</span>
            <span className="mark">
              {encounter.defeated ? "✓" : ""}
            </span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}
