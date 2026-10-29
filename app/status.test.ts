import { describe, expect, test } from "vitest";
import { describeWatcher, onWatcherEvent, type WatcherState } from "./status";
import type { Report, WatcherEvent } from "./watcher";

const yawn: Report = {
  slot: 0,
  characterName: "Yawn",
  total: 42,
  defeatFlags: [10000800, 19000800],
  playTime: { seconds: 0, running: false },
};

function after(...events: WatcherEvent[]) {
  return events.reduce<WatcherState>(onWatcherEvent, {});
}

describe("the App's window", () => {
  test("says it's starting before the Watcher's first word", () => {
    expect(describeWatcher(after())).toEqual({
      game: "Starting the Watcher…",
      character: null,
    });
  });

  test("shows the character, slot, Save Total and beaten bosses from a report", () => {
    const state = after(
      { kind: "status", status: "reading" },
      { kind: "report", report: yawn },
    );

    expect(describeWatcher(state)).toEqual({
      game: "Elden Ring is running. Reading the save.",
      character: { name: "Yawn", slot: 1, total: 42, bossesBeaten: 2 },
    });
  });

  test("a later report replaces the earlier one", () => {
    const state = after(
      { kind: "report", report: yawn },
      {
        kind: "report",
        report: {
          slot: 2,
          characterName: "Nap",
          total: 7,
          defeatFlags: [],
          playTime: { seconds: 0, running: false },
        },
      },
    );

    expect(describeWatcher(state).character).toEqual({
      name: "Nap",
      slot: 3,
      total: 7,
      bossesBeaten: 0,
    });
  });

  test("keeps the last character read once the game closes", () => {
    const state = after(
      { kind: "status", status: "reading" },
      { kind: "report", report: yawn },
      { kind: "status", status: "gameClosed" },
    );

    expect(describeWatcher(state)).toEqual({
      game: "Elden Ring isn't running.",
      character: { name: "Yawn", slot: 1, total: 42, bossesBeaten: 2 },
    });
  });

  test.each([
    ["noSave", "Elden Ring is running, but no save was found yet."],
    ["waiting", "Elden Ring is running. Waiting for it to save, to see which character you're playing."],
    ["unreadable", "Elden Ring is running, but the save can't be read. A game update may have changed it, so Erdtrack needs an update too."],
  ] as const)("explains the %s status", (status, game) => {
    expect(describeWatcher(after({ kind: "status", status })).game).toBe(game);
  });
});
