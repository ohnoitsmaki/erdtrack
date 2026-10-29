import { describe, expect, test } from "vitest";
import { actorsOf, byDay, filterHistory } from "./history";

const at = (iso: string) => new Date(iso).getTime();

const change = (
  actorName: string,
  action: Parameters<typeof filterHistory>[0][number]["action"],
  rest: { isUndo?: boolean; undone?: boolean; at?: number } = {},
) => ({
  actorName,
  action,
  isUndo: false,
  undone: false,
  at: at("2026-10-25T12:00"),
  ...rest,
});

const none = { actors: [], kinds: [], hideUndone: false };

describe("filtering History", () => {
  const reassign = change("Streamer", "updateDeaths");
  const added = change("SomeMod", "addEncounter");
  const created = change("Streamer", "createRun");
  const history = [reassign, added, created];

  test("nothing chosen shows every Change", () => {
    expect(filterHistory(history, none)).toEqual(history);
  });

  test("by who made the Change", () => {
    expect(filterHistory(history, { ...none, actors: ["Streamer"] })).toEqual([
      reassign,
      created,
    ]);
  });

  test("by kind, where an Undo is the kind of Change it undid", () => {
    const undid = change("Streamer", "addEncounter", { isUndo: true });
    expect(
      filterHistory([...history, undid], { ...none, kinds: ["Encounters"] }),
    ).toEqual([added, undid]);
  });

  test("who and kind both apply", () => {
    expect(
      filterHistory(history, { ...none, actors: ["Streamer"], kinds: ["Run"] }),
    ).toEqual([created]);
  });

  test("hiding undone leaves what the Run is now", () => {
    // Added, undone, then redone: the Add stands, both Undos go.
    const redid = change("Streamer", "addEncounter", { isUndo: true });
    const undid = change("Streamer", "addEncounter", { isUndo: true, undone: true });
    // Reassigned, then undone: neither shows.
    const undoneReassign = change("Streamer", "updateDeaths", { undone: true });
    const undidReassign = change("Streamer", "updateDeaths", { isUndo: true });
    expect(
      filterHistory([undidReassign, undoneReassign, redid, undid, added], {
        ...none,
        hideUndone: true,
      }),
    ).toEqual([added]);
  });
});

test("everyone who made a Change, once each, newest first", () => {
  expect(
    actorsOf([
      change("SomeMod", "updateDeaths"),
      change("Streamer", "updateDeaths"),
      change("SomeMod", "addEncounter"),
    ]),
  ).toEqual(["SomeMod", "Streamer"]);
});

test("History is grouped into Today, Yesterday, then dated days", () => {
  const now = at("2026-10-25T12:00");
  const today = change("Streamer", "updateDeaths", { at: at("2026-10-25T09:00") });
  const yesterday = change("Streamer", "updateDeaths", { at: at("2026-10-24T23:00") });
  const earlier = change("Streamer", "createRun", { at: at("2026-10-20T10:00") });
  expect(byDay([today, yesterday, earlier], now)).toEqual([
    { label: "Today", changes: [today] },
    { label: "Yesterday", changes: [yesterday] },
    {
      label: new Date(earlier.at).toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
      changes: [earlier],
    },
  ]);
});
