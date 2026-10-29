import type { Doc } from "../convex/_generated/dataModel";

type Action = Doc<"changes">["action"];

export const KINDS = ["Deaths", "Encounters", "Run", "Tags"] as const;
export type Kind = (typeof KINDS)[number];

// What the History filters call each action. Undos never reach here: they
// carry the action they undid or redid.
const KIND_OF: Record<Exclude<Action, "undo">, Kind> = {
  updateDeaths: "Deaths",
  recordDeath: "Deaths",
  removeDeath: "Deaths",
  addDeaths: "Deaths",
  addEncounter: "Encounters",
  setCurrent: "Encounters",
  markDefeated: "Encounters",
  setNickname: "Encounters",
  moveEncounter: "Encounters",
  setHidden: "Encounters",
  changeBoss: "Encounters",
  createRun: "Run",
  setActiveRun: "Run",
  archiveRun: "Run",
  rebindRun: "Run",
  createTag: "Tags",
  renameTag: "Tags",
  removeTag: "Tags",
};

export function kindOf(action: Action): Kind | undefined {
  return action === "undo" ? undefined : KIND_OF[action];
}

type Change = {
  at: number;
  actorName: string;
  action: Action;
  isUndo: boolean;
  undone: boolean;
};

export type HistoryFilter = {
  // Empty means everyone, or every kind.
  actors: string[];
  kinds: Kind[];
  // Leaves what the Run is now: a Change that's undone did nothing, and every
  // Undo either cancelled something or is undone itself, its redo showing as
  // the original Change no longer undone.
  hideUndone: boolean;
};

export function filterHistory<C extends Change>(changes: C[], filter: HistoryFilter) {
  return changes.filter(
    (change) =>
      (filter.actors.length === 0 || filter.actors.includes(change.actorName)) &&
      (filter.kinds.length === 0 ||
        filter.kinds.includes(kindOf(change.action)!)) &&
      !(filter.hideUndone && (change.undone || change.isUndo)),
  );
}

// Everyone who made one of the Changes, in the order they first appear.
export function actorsOf(changes: Change[]) {
  return [...new Set(changes.map((change) => change.actorName))];
}

// Newest first, in a group for each day.
export function byDay<C extends Change>(changes: C[], now = Date.now()) {
  const days: { label: string; changes: C[] }[] = [];
  for (const change of changes) {
    const label = dayLabel(change.at, now);
    if (days.at(-1)?.label === label) {
      days.at(-1)!.changes.push(change);
    } else {
      days.push({ label, changes: [change] });
    }
  }
  return days;
}

function dayLabel(at: number, now: number) {
  const day = new Date(at).toDateString();
  if (day === new Date(now).toDateString()) {
    return "Today";
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === yesterday.toDateString()) {
    return "Yesterday";
  }
  return new Date(at).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
