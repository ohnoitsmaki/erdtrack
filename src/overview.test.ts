import { describe, expect, test } from "vitest";
import {
  attemptOf,
  bulkTagged,
  deathAttempts,
  encounterLines,
  landedBefore,
  movedBefore,
  reassignChoices,
  selectRange,
  shownEncounters,
  switchChoices,
  tagChoices,
  tallyTiles,
  typedCount,
} from "./overview";

const overworld = { _id: "o", kind: "overworld", name: "Overworld", defeated: false };
// Bundled as "Soldier of Godrick — Stranded Graveyard (Limgrave)".
const soldier = {
  _id: "s",
  kind: "boss",
  bossId: "18000850",
  name: "Soldier of Godrick",
  defeated: false,
};
// Bundled as "Godrick the Grafted — Stormveil Castle (Stormveil Castle)".
const godrick = {
  _id: "g",
  kind: "boss",
  bossId: "10000800",
  name: "Godrick the Grafted",
  defeated: true,
};
const custom = { _id: "c", kind: "custom", name: "Invasion", defeated: false };
const encounters = [overworld, soldier, godrick, custom];

describe("switching the Current Encounter", () => {
  test("an empty search lists every Encounter still in play but the current one", () => {
    expect(switchChoices(encounters, "o", "")).toEqual([soldier, custom]);
  });

  test("a search also finds Defeated bosses", () => {
    expect(switchChoices(encounters, "o", "grafted")).toEqual([godrick]);
  });

  test("a search matches a boss's place or region from the bundled list", () => {
    expect(switchChoices(encounters, "o", "limgrave graveyard")).toEqual([soldier]);
    expect(switchChoices(encounters, "o", "stormveil")).toEqual([godrick]);
  });

  test("every word must match, in any case", () => {
    expect(switchChoices(encounters, "o", "GODRICK")).toEqual([soldier, godrick]);
    expect(switchChoices(encounters, "o", "godrick limgrave")).toEqual([soldier]);
    expect(switchChoices(encounters, "o", "inva")).toEqual([custom]);
  });

  test("a search matches a phase's name the bundled list doesn't use", () => {
    const godfrey = {
      _id: "h",
      kind: "boss",
      bossId: "11050800",
      name: "Godfrey, First Elden Lord",
      defeated: false,
    };

    expect(switchChoices([...encounters, godfrey], "o", "hoarah")).toEqual([godfrey]);
  });

  test("a search matches a boss's Nickname", () => {
    const nicknamed = { ...soldier, nickname: "Red Goblin" };

    expect(switchChoices([overworld, nicknamed, godrick], "o", "goblin")).toEqual([
      nicknamed,
    ]);
    expect(reassignChoices([overworld, nicknamed, godrick], "red gob")).toEqual([
      nicknamed,
    ]);
  });

  test("the Current Encounter is never offered", () => {
    expect(switchChoices(encounters, "s", "soldier")).toEqual([]);
  });
});

describe("tagging a selection", () => {
  test("a selection that all has the Tag has it taken off", () => {
    expect(bulkTagged([{ tagIds: ["g", "b"] }, { tagIds: ["b"] }], "b")).toBe(
      false,
    );
  });

  test("a selection with any Death without the Tag is tagged", () => {
    expect(bulkTagged([{ tagIds: ["b"] }, { tagIds: ["g"] }], "b")).toBe(true);
    expect(bulkTagged([{ tagIds: [] }], "b")).toBe(true);
  });
});

describe("shift-clicking a Death", () => {
  const order = ["a", "b", "c", "d", "e"];

  test("selects every Death between the last clicked and this one", () => {
    expect(selectRange(order, new Set(["b"]), "b", "d", true)).toEqual(
      new Set(["b", "c", "d"]),
    );
    expect(selectRange(order, new Set(["d"]), "d", "a", true)).toEqual(
      new Set(["a", "b", "c", "d"]),
    );
  });

  test("leaves Deaths outside the range as they were", () => {
    expect(selectRange(order, new Set(["a", "e"]), "b", "c", true)).toEqual(
      new Set(["a", "b", "c", "e"]),
    );
  });

  test("deselects the range when the one clicked is deselected", () => {
    expect(selectRange(order, new Set(order), "b", "d", false)).toEqual(
      new Set(["a", "e"]),
    );
  });

  test("changes only the one clicked when the last clicked is gone", () => {
    expect(selectRange(order, new Set(["a"]), "z", "c", true)).toEqual(
      new Set(["a", "c"]),
    );
  });
});

describe("the Tag picker", () => {
  const tags = [
    { _id: "g", name: "Gravity" },
    { _id: "b", name: "Birds" },
    { _id: "c", name: "Crab" },
  ];

  test("lists every Tag until something is typed", () => {
    expect(tagChoices(tags, "")).toEqual({ tags, create: null });
  });

  test("finds Tags by any part of their name, in any case, and offers to create what's typed", () => {
    expect(tagChoices(tags, " r ")).toEqual({ tags, create: "r" });
    expect(tagChoices(tags, "BI")).toEqual({ tags: [tags[1]], create: "BI" });
  });

  test("doesn't offer to create a Tag that's there already", () => {
    expect(tagChoices(tags, "birds")).toEqual({ tags: [tags[1]], create: null });
  });

  test("doesn't offer a name that's too long", () => {
    expect(tagChoices(tags, "x".repeat(33)).create).toBeNull();
  });
});

describe("the tallies beside the Total", () => {
  test("show Gravity always, and other Tags only once they've a Death", () => {
    const gravity = { name: "Gravity", gravity: true, count: 0 };
    const birds = { name: "Birds", gravity: false, count: 2 };
    const crabs = { name: "Crabs", gravity: false, count: 0 };

    expect(tallyTiles([gravity, birds, crabs])).toEqual([gravity, birds]);
  });
});

describe("an Encounter's lines", () => {
  test("a boss shows its name over its place and region", () => {
    expect(encounterLines(soldier)).toEqual({
      title: "Soldier of Godrick",
      detail: "Stranded Graveyard · Limgrave",
    });
  });

  test("a place named like its region shows once", () => {
    expect(encounterLines(godrick)).toEqual({
      title: "Godrick the Grafted",
      detail: "Stormveil Castle",
    });
  });

  test("a boss's Nickname follows its name", () => {
    expect(encounterLines({ ...soldier, nickname: "red goblin" })).toEqual({
      title: "Soldier of Godrick",
      nickname: "red goblin",
      detail: "Stranded Graveyard · Limgrave",
    });
  });

  test("a Custom Encounter shows only its name", () => {
    expect(encounterLines(custom)).toEqual({ title: "Invasion" });
  });
});

describe("a typed count of Deaths", () => {
  test.each([
    ["", 0],
    ["  ", 0],
    ["0", 0],
    ["267", 267],
    [" 40 ", 40],
    ["-1", null],
    ["1.5", null],
    ["abc", null],
  ])("%j is %j", (text, count) => {
    expect(typedCount(text)).toBe(count);
  });
});

describe("moving an Encounter", () => {
  const ids = (list: { _id: string }[]) => list.map((e) => e._id);

  test("goes just before the one it's moved before", () => {
    expect(ids(movedBefore(encounters, "c", "s"))).toEqual(["o", "c", "s", "g"]);
  });

  test("goes last when moved before none", () => {
    expect(ids(movedBefore(encounters, "s", null))).toEqual(["o", "g", "c", "s"]);
  });
});

describe("the Counts list", () => {
  const ids = (list: { _id: string }[]) => list.map((e) => e._id);

  test("keeps Overworld at the top and shows the newest next", () => {
    expect(ids(shownEncounters(encounters, "all"))).toEqual(["o", "c", "g", "s"]);
  });

  test("can leave out Defeated bosses", () => {
    expect(ids(shownEncounters(encounters, "standing"))).toEqual(["o", "c", "s"]);
  });

  test("can show only Defeated bosses, under Overworld so moves still land", () => {
    expect(ids(shownEncounters(encounters, "defeated"))).toEqual(["o", "g"]);
  });

  test("a move just under Overworld goes last in the Run's order", () => {
    expect(landedBefore([overworld, custom, soldier], 1)).toBeNull();
  });

  test("a move lower down goes just before the one shown above it", () => {
    expect(landedBefore([overworld, custom, soldier], 2)).toBe("c");
  });
});

describe("attempts", () => {
  test("a boss not yet Defeated is on the try after its Deaths", () => {
    expect(attemptOf({ kind: "boss", defeated: false, deathCount: 47 })).toBe(48);
  });

  test("a Defeated boss, Overworld and a Custom Encounter have no Attempt", () => {
    expect(attemptOf({ kind: "boss", defeated: true, deathCount: 3 })).toBeNull();
    expect(attemptOf({ kind: "overworld", defeated: false, deathCount: 9 })).toBeNull();
    expect(attemptOf({ kind: "custom", defeated: false, deathCount: 2 })).toBeNull();
  });

  test("each boss Death, newest first, ended the try its count reached", () => {
    const counts = new Map([
      ["s", { kind: "boss", deathCount: 5 }],
      ["o", { kind: "overworld", deathCount: 9 }],
    ]);
    const feed = ["s", "o", "s", "s"].map((encounterId) => ({ encounterId }));
    expect(deathAttempts(feed, (id) => counts.get(id))).toEqual([5, null, 4, 3]);
  });

  test("a Death in an Encounter that isn't in the Run has no Attempt", () => {
    expect(deathAttempts([{ encounterId: "x" }], () => undefined)).toEqual([null]);
  });
});
