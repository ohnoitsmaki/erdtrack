import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { DEATH_COOLDOWN_MS } from "./deathLimits";
import {
  owner,
  recordDeaths,
  setup,
  signInWithTwitch,
  stubAuthEnv,
  useFutureClock,
  type AsUser,
  type T,
} from "./signIn.testing";

beforeEach(() => {
  stubAuthEnv();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const MARGIT = "Margit, the Fell Omen — Stormveil Castle (Stormveil Castle)";

const someMod = { id: "222", login: "somemod", displayName: "SomeMod" };

// The Streamer and a Run with Margit added. The clock is fake.
async function runWithMargit(t: T) {
  const { asUser: asOwner } = await signInWithTwitch(t, owner);
  vi.unstubAllGlobals();
  useFutureClock();
  const runId = await asOwner.mutation(api.runs.createRun, {
    characterName: "Tarnished",
  });
  const margit = await asOwner.mutation(api.encounters.addBoss, {
    runId,
    bossId: "10000850",
  });
  return { asOwner, runId, margit };
}

async function signInSomeMod(t: T, asOwner: AsUser) {
  await asOwner.mutation(api.mods.add, { login: someMod.login });
  const { asUser } = await signInWithTwitch(t, someMod);
  vi.unstubAllGlobals();
  return asUser;
}

async function counts(asOwner: AsUser) {
  const run = await asOwner.query(api.runs.activeRun, {});
  return {
    total: run!.total,
    ...Object.fromEntries(
      run!.encounters.map((e) => [e.name.split(",")[0], e.deathCount]),
    ),
  };
}

async function feed(asOwner: AsUser) {
  const { page } = await asOwner.query(api.runs.deathFeed, {
    paginationOpts: { cursor: null, numItems: 20 },
  });
  return page.map(({ encounterName }) => encounterName);
}

async function undoNewest(asOwner: AsUser) {
  const [newest] = await asOwner.query(api.changes.history, {});
  return await asOwner.mutation(api.changes.undo, { changeId: newest!._id });
}

describe("recording a Death", () => {
  test("is a Change that adds one to its Encounter and the Total", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);

    await recordDeaths(asOwner, runId, 1);

    expect(await counts(asOwner)).toEqual({ total: 1, Overworld: 1, Margit: 0 });
    expect(await feed(asOwner)).toEqual(["Overworld"]);
    const [newest] = await asOwner.query(api.changes.history, {});
    expect(newest).toMatchObject({
      action: "recordDeath",
      description: "Recorded a Death in Overworld",
      actorName: "Streamer",
    });
  });

  test("undoing it removes it, and redoing it brings it back", async () => {
    const t = setup();
    const { asOwner, runId, margit } = await runWithMargit(t);
    await recordDeaths(asOwner, runId, 1, margit);

    await undoNewest(asOwner);
    expect(await counts(asOwner)).toEqual({ total: 0, Overworld: 0, Margit: 0 });
    expect(await feed(asOwner)).toEqual([]);

    await undoNewest(asOwner);
    expect(await counts(asOwner)).toEqual({ total: 1, Overworld: 0, Margit: 1 });
    expect(await feed(asOwner)).toEqual([MARGIT]);
  });

  test("is refused in an archived Run", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);
    await asOwner.mutation(api.runs.archive, { runId });

    await expect(recordDeaths(asOwner, runId, 1)).rejects.toThrow(
      "Tarnished's Run is archived.",
    );
  });

  test("someone who isn't a Mod can't record or remove a Death", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);
    const [deathId] = await recordDeaths(asOwner, runId, 1);
    const { asUser: someoneElse } = await signInWithTwitch(t, someMod);
    vi.unstubAllGlobals();

    await expect(
      someoneElse.mutation(api.deaths.record, { runId }),
    ).rejects.toThrow("Only the Streamer and Mods");
    await expect(
      someoneElse.mutation(api.deaths.remove, { deathId: deathId! }),
    ).rejects.toThrow("Only the Streamer and Mods");
  });
});

describe("the cooldown", () => {
  test("a second Death within it is refused, and one after it is recorded", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);
    await recordDeaths(asOwner, runId, 1);

    vi.setSystemTime(Date.now() + DEATH_COOLDOWN_MS - 1);
    await expect(
      asOwner.mutation(api.deaths.record, { runId }),
    ).rejects.toThrow("A Death was just recorded.");
    expect((await counts(asOwner)).total).toBe(1);

    vi.setSystemTime(Date.now() + 1);
    await asOwner.mutation(api.deaths.record, { runId });
    expect((await counts(asOwner)).total).toBe(2);
  });

  test("holds across Mods, so two pressing for the same death record it once", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);
    const asSomeMod = await signInSomeMod(t, asOwner);
    await recordDeaths(asOwner, runId, 1);

    await expect(
      asSomeMod.mutation(api.deaths.record, { runId }),
    ).rejects.toThrow("A Death was just recorded.");
    expect((await counts(asOwner)).total).toBe(1);
  });

  test("the Run says when its latest Death was recorded", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);
    expect((await asOwner.query(api.runs.activeRun, {}))!.lastDeathAt).toBe(
      null,
    );

    await recordDeaths(asOwner, runId, 1);

    expect((await asOwner.query(api.runs.activeRun, {}))!.lastDeathAt).toBe(
      Date.now(),
    );
  });

  test("belongs to each Run", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);
    const other = await asOwner.mutation(api.runs.createRun, {
      characterName: "Second",
    });
    await recordDeaths(asOwner, runId, 1);

    await asOwner.mutation(api.deaths.record, { runId: other });

    expect((await asOwner.query(api.runs.list, {})).map((r) => r.total)).toEqual(
      [1, 1],
    );
  });
});

async function gravityCount(asOwner: AsUser) {
  const run = await asOwner.query(api.runs.activeRun, {});
  return run!.tallies.find((tally) => tally.gravity)!.count;
}

describe("recording a Gravity Death", () => {
  test("is one Change that adds a Death already tagged Gravity", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);

    await asOwner.mutation(api.deaths.recordGravity, { runId });

    expect(await counts(asOwner)).toEqual({ total: 1, Overworld: 1, Margit: 0 });
    expect(await gravityCount(asOwner)).toBe(1);
    const [newest] = await asOwner.query(api.changes.history, {});
    expect(newest).toMatchObject({
      action: "recordGravityDeath",
      description: "Recorded a Gravity Death in Overworld",
    });
  });

  test("undoing it takes the Death and its Gravity tally back, and redo restores both", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);
    await asOwner.mutation(api.deaths.recordGravity, { runId });

    await undoNewest(asOwner);
    expect((await counts(asOwner)).total).toBe(0);
    expect(await gravityCount(asOwner)).toBe(0);

    await undoNewest(asOwner);
    expect((await counts(asOwner)).total).toBe(1);
    expect(await gravityCount(asOwner)).toBe(1);
  });

  test("starts the cooldown like any Death", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);
    await asOwner.mutation(api.deaths.recordGravity, { runId });

    await expect(
      asOwner.mutation(api.deaths.record, { runId }),
    ).rejects.toThrow("A Death was just recorded.");
  });

  test("within the cooldown tags the Death just recorded, instead of making another", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);
    const asSomeMod = await signInSomeMod(t, asOwner);
    await recordDeaths(asOwner, runId, 1);

    await asSomeMod.mutation(api.deaths.recordGravity, { runId });

    expect((await counts(asOwner)).total).toBe(1);
    expect(await gravityCount(asOwner)).toBe(1);
    const [newest] = await asOwner.query(api.changes.history, {});
    expect(newest).toMatchObject({
      action: "updateDeaths",
      description: "1 Death Gravity",
    });
  });

  test("pressed twice for one fall counts it once", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);
    const asSomeMod = await signInSomeMod(t, asOwner);
    await asOwner.mutation(api.deaths.recordGravity, { runId });

    await asSomeMod.mutation(api.deaths.recordGravity, { runId });

    expect((await counts(asOwner)).total).toBe(1);
    expect(await gravityCount(asOwner)).toBe(1);
    const [newest] = await asOwner.query(api.changes.history, {});
    expect(newest!.action).toBe("recordGravityDeath");
  });

  test("after the cooldown records a new one", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);
    await recordDeaths(asOwner, runId, 1);

    vi.setSystemTime(Date.now() + DEATH_COOLDOWN_MS);
    await asOwner.mutation(api.deaths.recordGravity, { runId });

    expect((await counts(asOwner)).total).toBe(2);
    expect(await gravityCount(asOwner)).toBe(1);
  });

  test("within the cooldown of an undone Death is refused", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);
    await recordDeaths(asOwner, runId, 1);
    await undoNewest(asOwner);

    await expect(
      asOwner.mutation(api.deaths.recordGravity, { runId }),
    ).rejects.toThrow("A Death was just recorded.");
  });

  test("is refused in an archived Run", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);
    await asOwner.mutation(api.runs.archive, { runId });

    await expect(
      asOwner.mutation(api.deaths.recordGravity, { runId }),
    ).rejects.toThrow("Tarnished's Run is archived.");
  });
});

describe("removing a Death", () => {
  test("is a Change that takes it off its Encounter, and undoing it brings it back", async () => {
    const t = setup();
    const { asOwner, runId, margit } = await runWithMargit(t);
    const [deathId] = await recordDeaths(asOwner, runId, 1, margit);

    await asOwner.mutation(api.deaths.remove, { deathId: deathId! });
    expect(await counts(asOwner)).toEqual({ total: 0, Overworld: 0, Margit: 0 });
    expect(await feed(asOwner)).toEqual([]);
    expect(await asOwner.query(api.changes.history, {})).toMatchObject([
      { action: "removeDeath", description: `Removed a Death from ${MARGIT}` },
      { action: "recordDeath" },
      { action: "addEncounter" },
      { action: "createRun" },
    ]);

    await undoNewest(asOwner);
    expect(await counts(asOwner)).toEqual({ total: 1, Overworld: 0, Margit: 1 });
    expect(await feed(asOwner)).toEqual([MARGIT]);
  });

  test("removing one already removed records nothing", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);
    const [deathId] = await recordDeaths(asOwner, runId, 1);
    await asOwner.mutation(api.deaths.remove, { deathId: deathId! });

    expect(
      await asOwner.mutation(api.deaths.remove, { deathId: deathId! }),
    ).toBeNull();
    expect(await asOwner.query(api.changes.history, {})).toHaveLength(4);
  });

  test("blocks undoing the recording, until it's undone itself", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);
    const [deathId] = await recordDeaths(asOwner, runId, 1);
    const [recorded] = await asOwner.query(api.changes.history, {});
    await asOwner.mutation(api.deaths.remove, { deathId: deathId! });

    await expect(
      asOwner.mutation(api.changes.undo, { changeId: recorded!._id }),
    ).rejects.toThrow("Changed since by Streamer.");
  });
});

describe("updating Deaths", () => {
  test("takes 1 to 100 Deaths at a time", async () => {
    const t = setup();
    const { asOwner } = await runWithMargit(t);

    await expect(
      asOwner.mutation(api.deaths.update, { deathIds: [] }),
    ).rejects.toThrow("Choose 1 to 100 Deaths at a time.");
  });

  test("refuses Deaths from more than one Run", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);
    const [first] = await recordDeaths(asOwner, runId, 1);
    const other = await asOwner.mutation(api.runs.createRun, {
      characterName: "Second",
    });
    const [second] = await recordDeaths(asOwner, other, 1);

    await expect(
      asOwner.mutation(api.deaths.update, { deathIds: [first!, second!] }),
    ).rejects.toThrow("Those Deaths aren't all in one Run.");
  });
});

const MALENIA =
  "Malenia, Blade of Miquella & Malenia, Goddess of Rot (Miquella's Haligtree)";

// The Streamer and a new Run with only Overworld.
async function newRun(t: T) {
  const { asUser: asOwner } = await signInWithTwitch(t, owner);
  vi.unstubAllGlobals();
  const runId = await asOwner.mutation(api.runs.createRun, {
    characterName: "Tarnished",
  });
  return { asOwner, runId };
}

async function encounters(asOwner: AsUser) {
  const run = await asOwner.query(api.runs.activeRun, {});
  return run!.encounters.map((e) => [e.name, e.deathCount, e.defeated]);
}

async function allDeaths(asOwner: AsUser) {
  return (
    await asOwner.query(api.runs.deathFeed, {
      paginationOpts: { cursor: null, numItems: 1000 },
    })
  ).page;
}

describe("adding Deaths at once", () => {
  test("adds the bosses not yet in the Run and gives the rest to Overworld, as one Change", async () => {
    const t = setup();
    const { asOwner, runId } = await newRun(t);

    await asOwner.mutation(api.deaths.addMany, {
      runId,
      count: 200,
      split: [
        { bossId: "10000850", count: 40 },
        { bossId: "15000800", count: 120 },
      ],
    });

    expect(await encounters(asOwner)).toEqual([
      ["Overworld", 40, false],
      [MARGIT, 40, false],
      [MALENIA, 120, false],
    ]);
    expect((await counts(asOwner)).total).toBe(200);
    expect(await allDeaths(asOwner)).toHaveLength(200);
    expect(await asOwner.query(api.changes.history, {})).toMatchObject([
      { action: "addDeaths", description: "Added 200 Deaths" },
      { action: "createRun" },
    ]);
  });

  test("with no split puts them all in Overworld, and doesn't start the cooldown", async () => {
    const t = setup();
    const { asOwner, runId } = await newRun(t);

    await asOwner.mutation(api.deaths.addMany, { runId, count: 267 });

    expect(await encounters(asOwner)).toEqual([["Overworld", 267, false]]);
    expect((await asOwner.query(api.runs.activeRun, {}))!.lastDeathAt).toBe(
      null,
    );
    await asOwner.mutation(api.deaths.record, { runId });
    expect((await counts(asOwner)).total).toBe(268);
  });

  test("undoing it removes every Death and boss it added, and redo restores them", async () => {
    const t = setup();
    const { asOwner, runId } = await newRun(t);
    await asOwner.mutation(api.deaths.addMany, {
      runId,
      count: 200,
      split: [
        { bossId: "10000850", count: 40 },
        { bossId: "15000800", count: 120 },
      ],
    });
    // The bosses it added have its Deaths, but undoing takes those out first.
    const [added] = await asOwner.query(api.changes.history, {});
    expect(added!.refusal).toBeNull();

    await undoNewest(asOwner);
    const [undo] = await asOwner.query(api.changes.history, {});
    expect(undo!.refusal).toBeNull();
    expect(await encounters(asOwner)).toEqual([["Overworld", 0, false]]);
    expect(await allDeaths(asOwner)).toEqual([]);

    await undoNewest(asOwner);
    expect(await encounters(asOwner)).toEqual([
      ["Overworld", 40, false],
      [MARGIT, 40, false],
      [MALENIA, 120, false],
    ]);
    expect(await allDeaths(asOwner)).toHaveLength(200);
  });

  test("changing one of its Deaths blocks undoing it", async () => {
    const t = setup();
    const { asOwner, runId } = await newRun(t);
    await asOwner.mutation(api.deaths.addMany, { runId, count: 3 });
    const [added] = await asOwner.query(api.changes.history, {});
    const [death] = await allDeaths(asOwner);

    await asOwner.mutation(api.deaths.remove, { deathId: death!._id });

    await expect(
      asOwner.mutation(api.changes.undo, { changeId: added!._id }),
    ).rejects.toThrow("Changed since by Streamer.");
  });

  test("can't be redone into an Encounter removed since", async () => {
    const t = setup();
    const { asOwner, runId } = await newRun(t);
    const gank = await asOwner.mutation(api.encounters.addCustom, {
      runId,
      name: "Gank",
    });
    const [addedGank] = await asOwner.query(api.changes.history, {});
    await asOwner.mutation(api.deaths.addMany, {
      runId,
      count: 5,
      split: [{ encounterId: gank, count: 5 }],
    });
    await undoNewest(asOwner);
    await asOwner.mutation(api.changes.undo, { changeId: addedGank!._id });
    const [, undoneAdding] = await asOwner.query(api.changes.history, {});

    await expect(
      asOwner.mutation(api.changes.undo, { changeId: undoneAdding!._id }),
    ).rejects.toThrow("That Encounter isn't in this Run.");
  });

  test.each([
    {
      why: "adds up to more than the Deaths being added",
      count: 200,
      split: [
        { bossId: "10000850", count: 150 },
        { bossId: "15000800", count: 51 },
      ],
      error: "Those counts add up to 201, more than the 200 being added.",
    },
    {
      why: "has a negative count",
      count: 200,
      split: [{ bossId: "10000850", count: -1 }],
      error: "Each count must be a whole number, 0 or more.",
    },
    {
      why: "has a fractional count",
      count: 200,
      split: [{ bossId: "10000850", count: 1.5 }],
      error: "Each count must be a whole number, 0 or more.",
    },
    { why: "adds none", count: 0, split: [], error: "Add 1 to 5,000 Deaths" },
    { why: "adds too many", count: 5001, split: [], error: "Add 1 to 5,000 Deaths" },
  ])("a request that $why is refused and changes nothing", async ({ count, split, error }) => {
    const t = setup();
    const { asOwner, runId } = await newRun(t);

    await expect(
      asOwner.mutation(api.deaths.addMany, { runId, count, split }),
    ).rejects.toThrow(error);

    expect(await encounters(asOwner)).toEqual([["Overworld", 0, false]]);
    expect(await allDeaths(asOwner)).toEqual([]);
  });

  test("takes up to 5,000 at once", async () => {
    const t = setup();
    const { asOwner, runId } = await newRun(t);

    await asOwner.mutation(api.deaths.addMany, { runId, count: 5000 });

    expect(await encounters(asOwner)).toEqual([["Overworld", 5000, false]]);
  });

  test("is refused in an archived Run", async () => {
    const t = setup();
    const { asOwner, runId } = await newRun(t);
    await asOwner.mutation(api.runs.archive, { runId });

    await expect(
      asOwner.mutation(api.deaths.addMany, { runId, count: 3 }),
    ).rejects.toThrow("Tarnished's Run is archived.");
  });

  test("marks the bosses ticked Defeated as part of the one Change, but not a Custom Encounter", async () => {
    const t = setup();
    const { asOwner, runId } = await newRun(t);
    const gank = await asOwner.mutation(api.encounters.addCustom, {
      runId,
      name: "Gank",
    });

    await expect(
      asOwner.mutation(api.deaths.addMany, {
        runId,
        count: 10,
        split: [{ encounterId: gank, count: 1, defeated: true }],
      }),
    ).rejects.toThrow("Only a boss can be marked Defeated.");
    await asOwner.mutation(api.deaths.addMany, {
      runId,
      count: 10,
      split: [
        { bossId: "10000850", count: 3 },
        { bossId: "10000850", count: 4, defeated: true },
      ],
    });
    expect(await encounters(asOwner)).toEqual([
      ["Overworld", 3, false],
      ["Gank", 0, false],
      [MARGIT, 7, true],
    ]);

    await undoNewest(asOwner);
    expect(await encounters(asOwner)).toEqual([
      ["Overworld", 0, false],
      ["Gank", 0, false],
    ]);
  });
});
