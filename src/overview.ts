import { findBoss, type Boss } from "../convex/bosses";
import { MAX_TAG_NAME_LENGTH } from "../convex/tagLimits";

type Encounter = {
  _id: string;
  bossId?: string;
  name: string;
  nickname?: string | null;
  defeated: boolean;
};

// A boss's place, region and aliases come from the bundled list, so
// searching costs no database reads.
function searchText(encounter: Encounter) {
  const boss = encounter.bossId ? findBoss(encounter.bossId) : undefined;
  return [
    encounter.name,
    encounter.nickname,
    boss?.place,
    boss?.region,
    ...(boss?.aliases ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

// The most boss search results shown at once, so the list stays short.
export const MAX_BOSS_RESULTS = 10;

// A boss's name, with where it is on a line of its own so a long name
// doesn't push the rest aside. A place named like its region shows once.
export function bossLines(boss: Boss) {
  const where = [...new Set([boss.place, boss.region].filter(Boolean))];
  return { title: boss.name, detail: where.join(" · ") };
}

// A name with any Nickname after it, on one line of text.
export function nicknamed(name: string, nickname?: string | null) {
  return nickname ? `${name} · “${nickname}”` : name;
}

export type EncounterLines = { title: string; nickname?: string; detail?: string };

// A boss's Nickname follows its name. Custom Encounters and Overworld have
// only a name.
export function encounterLines(encounter: Encounter): EncounterLines {
  const boss = encounter.bossId ? findBoss(encounter.bossId) : undefined;
  if (!boss) {
    return { title: encounter.name };
  }
  const { title, detail } = bossLines(boss);
  return encounter.nickname
    ? { title, nickname: encounter.nickname, detail }
    : { title, detail };
}

function words(query: string) {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function matches(encounter: Encounter, queryWords: string[]) {
  const text = searchText(encounter);
  return queryWords.every((word) => text.includes(word));
}

// What the Current Encounter can switch to. Every word of the query must
// appear in the name, Nickname, place or region; an empty search lists every
// Encounter still in play.
export function switchChoices<E extends Encounter>(
  encounters: E[],
  currentId: string | null | undefined,
  query: string,
) {
  const queryWords = words(query);
  return encounters.filter(
    (encounter) =>
      encounter._id !== currentId &&
      (queryWords.length ? matches(encounter, queryWords) : !encounter.defeated),
  );
}

// What a Death can be reassigned to, Defeated or not, searched the same way.
export function reassignChoices<E extends Encounter>(encounters: E[], query: string) {
  const queryWords = words(query);
  return encounters.filter((encounter) => matches(encounter, queryWords));
}

// What picking a Tag for the selected Deaths does: a selection that all has
// it has it taken off, anything else is tagged.
export function bulkTagged(selected: { tagIds: string[] }[], tagId: string) {
  return !selected.every((death) => death.tagIds.includes(tagId));
}

// The Tags the picker lists for what's typed, and the name it offers to
// create a Tag with, unless a Tag has it already or it's too long.
export function tagChoices<T extends { name: string }>(tags: T[], query: string) {
  const name = query.trim();
  const search = name.toLowerCase();
  const taken = tags.some((tag) => tag.name.toLowerCase() === search);
  return {
    tags: tags.filter((tag) => tag.name.toLowerCase().includes(search)),
    create:
      name && !taken && name.length <= MAX_TAG_NAME_LENGTH ? name : null,
  };
}

// The tallies shown beside the Total: Gravity's always, and any other
// Tag's once a Death has it.
export function tallyTiles<T extends { gravity: boolean; count: number }>(
  tallies: T[],
) {
  return tallies.filter((tally) => tally.gravity || tally.count > 0);
}

// A count of Deaths as typed. Left empty it's 0; anything else must be a
// whole number, 0 or more, or it's null.
export function typedCount(text: string) {
  const count = text.trim() === "" ? 0 : Number(text);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

// The list with one moved just before another, or last with none, as the
// Run's order will be once the move goes through.
export function movedBefore<E extends { _id: string }>(
  encounters: E[],
  encounterId: string,
  before: string | null,
) {
  const moved = encounters.find((e) => e._id === encounterId);
  const others = encounters.filter((e) => e._id !== encounterId);
  if (!moved) {
    return encounters;
  }
  const at = before === null ? -1 : others.findIndex((e) => e._id === before);
  return at === -1
    ? [...others, moved]
    : [...others.slice(0, at), moved, ...others.slice(at)];
}

// The Counts list: Overworld, then the rest of the Run's order upside down,
// so the newest is at the top, leaving out Defeated bosses if asked.
export type CountsFilter = "all" | "standing" | "defeated";

export function shownEncounters<E extends { kind: string; defeated: boolean }>(
  encounters: E[],
  filter: CountsFilter,
) {
  const shown = (e: E) =>
    filter === "all" || (filter === "defeated") === e.defeated;
  return [
    ...encounters.filter((e) => e.kind === "overworld"),
    ...encounters.filter((e) => e.kind !== "overworld" && shown(e)).reverse(),
  ];
}

type Counted = { kind: string; deathCount: number };

// Which try at a boss not yet Defeated is underway.
export function attemptOf(encounter: Counted & { defeated: boolean }) {
  return encounter.kind === "boss" && !encounter.defeated
    ? encounter.deathCount + 1
    : null;
}

// Which try each Death in a boss fight ended, for a feed that's newest first
// and unbroken from the newest: the newest is the boss's count, and each
// older one a try before.
export function deathAttempts(
  feed: { encounterId: string }[],
  encounterOf: (encounterId: string) => Counted | undefined,
) {
  const newer = new Map<string, number>();
  return feed.map(({ encounterId }) => {
    const before = newer.get(encounterId) ?? 0;
    newer.set(encounterId, before + 1);
    const encounter = encounterOf(encounterId);
    return encounter?.kind === "boss" ? encounter.deathCount - before : null;
  });
}

// What an Encounter landing at a place in the Counts list, among the others
// shown, goes just before in the Run's order: the one shown above it, since
// the list is upside down, or none when that's Overworld.
export function landedBefore<E extends { _id: string }>(
  others: E[],
  at: number,
): E["_id"] | null {
  return at <= 1 ? null : others[at - 1]!._id;
}

// Shift-clicking a Death after picking another sets every Death from that one
// to it, in the list's order, as the one clicked is now set. Where the first
// is no longer listed, only the one clicked changes.
export function selectRange<T>(
  order: T[],
  selected: Set<T>,
  from: T,
  to: T,
  on: boolean,
) {
  const next = new Set(selected);
  const start = order.indexOf(from);
  const end = order.indexOf(to);
  const range = start === -1 ? [to] : order.slice(Math.min(start, end), Math.max(start, end) + 1);
  for (const id of range) {
    if (on) {
      next.add(id);
    } else {
      next.delete(id);
    }
  }
  return next;
}
