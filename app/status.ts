import type { Report, WatcherEvent, WatcherStatus } from "./watcher";

// What the Watcher has said so far: its latest status, and its latest
// report, kept while the game is closed.
export type WatcherState = { status?: WatcherStatus; report?: Report };

export function onWatcherEvent(
  state: WatcherState,
  event: WatcherEvent,
): WatcherState {
  return event.kind === "status"
    ? { ...state, status: event.status }
    : { ...state, report: event.report };
}

const GAME: Record<WatcherStatus, string> = {
  gameClosed: "Elden Ring isn't running.",
  noSave: "Elden Ring is running, but no save was found yet.",
  waiting:
    "Elden Ring is running. Waiting for it to save, to see which character you're playing.",
  unreadable:
    "Elden Ring is running, but the save can't be read. A game update may have changed it, so Erdtrack needs an update too.",
  reading: "Elden Ring is running. Reading the save.",
};

// What the window shows. Slots are counted from 1, as in the game's menu.
// Each boss in the boss list has a Defeat Flag of its own, so each flag set
// is one boss beaten.
export function describeWatcher({ status, report }: WatcherState) {
  return {
    game: status ? GAME[status] : "Starting the Watcher…",
    character: report
      ? {
          name: report.characterName,
          slot: report.slot + 1,
          total: report.total,
          bossesBeaten: report.defeatFlags.length,
        }
      : null,
  };
}
