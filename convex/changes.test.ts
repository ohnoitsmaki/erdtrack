import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  owner,
  recordDeaths,
  setup,
  signInWithTwitch,
  stubAuthEnv,
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
const GODRICK = "Godrick the Grafted — Stormveil Castle (Stormveil Castle)";

type AsOwner = AsUser;

// The Streamer and a Run with Margit added, then `deaths` Deaths recorded one
// at a time, all in Overworld.
async function runWithDeaths(t: T, deaths: number) {
  const { asUser: asOwner } = await signInWithTwitch(t, owner);
  vi.unstubAllGlobals();
  const runId = await asOwner.mutation(api.runs.createRun, {
    characterName: "Tarnished",
  });
  const margit = await asOwner.mutation(api.encounters.addBoss, {
    runId,
    bossId: "10000850",
  });
  await recordDeaths(asOwner, runId, deaths);
  const run = await asOwner.query(api.runs.activeRun, {});
  const overworld = run!.currentEncounterId;
  return { asOwner, runId, margit, overworld };
}

// Newest first, as the feed shows them.
async function deathIds(asOwner: AsOwner) {
  const { page } = await asOwner.query(api.runs.deathFeed, {
    paginationOpts: { cursor: null, numItems: 50 },
  });
  return page.map((death) => death._id);
}

async function gravityTally(asOwner: AsOwner) {
  const run = await asOwner.query(api.runs.activeRun, {});
  return run!.tallies.find((tally) => tally.gravity)!.count;
}

async function gravityTag(asOwner: AsOwner) {
  const tags = await asOwner.query(api.tags.list, {});
  return tags.find((tag) => tag.gravity)!._id;
}

async function counts(asOwner: AsOwner) {
  const run = await asOwner.query(api.runs.activeRun, {});
  return {
    gravity: await gravityTally(asOwner),
    encounters: Object.fromEntries(
      run!.encounters.map((e) => [e.name.split(",")[0], e.deathCount]),
    ),
  };
}

// Tags or untags the Deaths Gravity when `gravity` is given.
async function updateDeaths(
  asOwner: AsOwner,
  {
    gravity,
    ...args
  }: {
    deathIds: Id<"deaths">[];
    encounterId?: Id<"encounters">;
    gravity?: boolean;
  },
) {
  const tag =
    gravity === undefined
      ? undefined
      : { tagId: await gravityTag(asOwner), tagged: gravity };
  return asOwner.mutation(api.deaths.update, { ...args, tag });
}

describe("reassign", () => {
  test("reassigning a Death updates both Encounters' counts", async () => {
    const t = setup();
    const { asOwner, margit } = await runWithDeaths(t, 3);
    const [newest] = await deathIds(asOwner);

    await updateDeaths(asOwner, { deathIds: [newest!], encounterId: margit });

    expect(await counts(asOwner)).toEqual({
      gravity: 0,
      encounters: { Overworld: 2, Margit: 1 },
    });
  });
});

async function history(asOwner: AsOwner) {
  const entries = await asOwner.query(api.changes.history, {});
  return entries.map(
    ({ actorName, description, undone, blockedBy, refusal }) => ({
      actorName,
      description,
      undone,
      blockedBy,
      refusal,
    }),
  );
}

describe("Gravity", () => {
  test("a Gravity tag adds to the Gravity tally and leaves the Encounter sum unchanged", async () => {
    const t = setup();
    const { asOwner } = await runWithDeaths(t, 3);
    const [newest] = await deathIds(asOwner);

    await updateDeaths(asOwner, { deathIds: [newest!], gravity: true });

    expect(await counts(asOwner)).toEqual({
      gravity: 1,
      encounters: { Overworld: 3, Margit: 0 },
    });
  });
});

describe("bulk actions", () => {
  test("last 3 → Margit, Gravity is a single Change", async () => {
    const t = setup();
    const { asOwner, margit } = await runWithDeaths(t, 4);
    const lastThree = (await deathIds(asOwner)).slice(0, 3);

    await updateDeaths(asOwner, {
      deathIds: lastThree,
      encounterId: margit,
      gravity: true,
    });

    expect(await counts(asOwner)).toEqual({
      gravity: 3,
      encounters: { Overworld: 1, Margit: 3 },
    });
    const entries = await history(asOwner);
    expect(entries).toHaveLength(7);
    expect(entries[0]).toEqual({
      actorName: "Streamer",
      description: `3 Deaths → ${MARGIT}, Gravity`,
      undone: false,
      blockedBy: null,
      refusal: null,
    });
    expect(entries.slice(-2)).toEqual([
      {
        actorName: "Streamer",
        description: `Added ${MARGIT}`,
        undone: false,
        blockedBy: null,
        refusal: `${MARGIT} has Deaths now.`,
      },
      {
        actorName: "Streamer",
        description: "Created Tarnished's Run",
        undone: false,
        blockedBy: null,
        refusal: "Tarnished's Run has Deaths now.",
      },
    ]);
  });
});

// Everything a Change can affect, as the Panel shows it.
async function state(asOwner: AsOwner) {
  const run = await asOwner.query(api.runs.activeRun, {});
  const { page } = await asOwner.query(api.runs.deathFeed, {
    paginationOpts: { cursor: null, numItems: 50 },
  });
  return {
    current: run!.encounters.find((e) => e._id === run!.currentEncounterId)
      ?.name,
    gravity: await gravityTally(asOwner),
    encounters: run!.encounters.map(({ name, deathCount, defeated }) => ({
      name,
      deathCount,
      defeated,
    })),
    deaths: page.map(({ encounterName, tagIds }) => ({
      encounterName,
      gravity: tagIds.length > 0,
    })),
  };
}

async function newestChange(asOwner: AsOwner) {
  const [newest] = await asOwner.query(api.changes.history, {});
  return newest!._id;
}

describe("undo and redo", () => {
  test.each([
    [
      "reassigning and tagging Deaths",
      async (asOwner: AsOwner, { margit }: { margit: Id<"encounters"> }) => {
        const deaths = (await deathIds(asOwner)).slice(0, 2);
        await updateDeaths(asOwner, {
          deathIds: deaths,
          encounterId: margit,
          gravity: true,
        });
      },
    ],
    [
      "switching the Current Encounter",
      async (
        asOwner: AsOwner,
        {
          runId,
          overworld,
        }: { runId: Id<"runs">; overworld: Id<"encounters"> },
      ) => {
        await asOwner.mutation(api.encounters.setCurrent, {
          runId,
          encounterId: overworld,
        });
      },
    ],
    [
      "marking the current boss Defeated",
      async (asOwner: AsOwner, { margit }: { margit: Id<"encounters"> }) => {
        await asOwner.mutation(api.encounters.markDefeated, {
          encounterId: margit,
        });
      },
    ],
  ])(
    "undo, then undo of that Undo, returns to the exact earlier state: %s",
    async (_, act) => {
      const t = setup();
      const run = await runWithDeaths(t, 3);
      const { asOwner } = run;
      // So marking Defeated also resets the Current Encounter.
      await asOwner.mutation(api.encounters.setCurrent, {
        runId: run.runId,
        encounterId: run.margit,
      });
      const before = await state(asOwner);

      await act(asOwner, run);
      const after = await state(asOwner);
      expect(after).not.toEqual(before);

      await asOwner.mutation(api.changes.undo, {
        changeId: await newestChange(asOwner),
      });
      expect(await state(asOwner)).toEqual(before);

      await asOwner.mutation(api.changes.undo, {
        changeId: await newestChange(asOwner),
      });
      expect(await state(asOwner)).toEqual(after);
    },
  );
});

const someMod = { id: "222", login: "somemod", displayName: "SomeMod" };

async function signInSomeMod(t: T, asOwner: AsOwner) {
  await asOwner.mutation(api.mods.add, { login: someMod.login });
  const { asUser } = await signInWithTwitch(t, someMod);
  vi.unstubAllGlobals();
  return asUser;
}

describe("several Mods", () => {
  test("undo my last ignores other Mods' Changes", async () => {
    const t = setup();
    const { asOwner, runId, margit } = await runWithDeaths(t, 2);
    const asSomeMod = await signInSomeMod(t, asOwner);
    const [second, first] = await deathIds(asOwner);

    await updateDeaths(asOwner, { deathIds: [first!], encounterId: margit });
    await updateDeaths(asSomeMod, { deathIds: [second!], gravity: true });
    await asOwner.mutation(api.changes.undoMyLast, { runId });

    expect(await state(asOwner)).toMatchObject({
      gravity: 1,
      deaths: [
        { encounterName: "Overworld", gravity: true },
        { encounterName: "Overworld", gravity: false },
      ],
    });
    // Next is the Streamer's recording of the Death SomeMod tagged since.
    await expect(
      asOwner.mutation(api.changes.undoMyLast, { runId }),
    ).rejects.toThrow("Changed since by SomeMod.");
    expect(await history(asOwner)).toMatchObject([
      { description: `Undid: 1 Death → ${MARGIT}` },
      { actorName: "SomeMod", undone: false },
      { description: `1 Death → ${MARGIT}`, undone: true },
      { description: "Recorded a Death in Overworld", blockedBy: "SomeMod" },
      { description: "Recorded a Death in Overworld", blockedBy: null },
      { description: `Added ${MARGIT}` },
      { description: "Created Tarnished's Run" },
    ]);
  });

  test("an undo blocked by a later Change to the same Deaths is refused and names its actor", async () => {
    const t = setup();
    const { asOwner, runId, margit } = await runWithDeaths(t, 2);
    const asSomeMod = await signInSomeMod(t, asOwner);
    const [newest] = await deathIds(asOwner);

    await updateDeaths(asOwner, { deathIds: [newest!], encounterId: margit });
    const [mine] = await asOwner.query(api.changes.history, {});
    await updateDeaths(asSomeMod, { deathIds: [newest!], gravity: true });

    await expect(
      asOwner.mutation(api.changes.undo, { changeId: mine!._id }),
    ).rejects.toThrow("Changed since by SomeMod.");
    await expect(
      asOwner.mutation(api.changes.undoMyLast, { runId }),
    ).rejects.toThrow("Changed since by SomeMod.");
    expect(await history(asOwner)).toEqual([
      {
        actorName: "SomeMod",
        description: "1 Death Gravity",
        undone: false,
        blockedBy: null,
        refusal: null,
      },
      {
        actorName: "Streamer",
        description: `1 Death → ${MARGIT}`,
        undone: false,
        blockedBy: "SomeMod",
        refusal: null,
      },
      {
        actorName: "Streamer",
        description: `Recorded a Death in ${MARGIT}`,
        undone: false,
        blockedBy: "Streamer",
        refusal: null,
      },
      {
        actorName: "Streamer",
        description: "Recorded a Death in Overworld",
        undone: false,
        blockedBy: null,
        refusal: null,
      },
      {
        actorName: "Streamer",
        description: `Added ${MARGIT}`,
        undone: false,
        blockedBy: null,
        refusal: `${MARGIT} has Deaths now.`,
      },
      {
        actorName: "Streamer",
        description: "Created Tarnished's Run",
        undone: false,
        blockedBy: null,
        refusal: "Tarnished's Run has Deaths now.",
      },
    ]);

    // Once the later Change is undone, nothing blocks it.
    await asOwner.mutation(api.changes.undo, {
      changeId: await newestChange(asOwner),
    });
    await asOwner.mutation(api.changes.undo, { changeId: mine!._id });
    expect(await counts(asOwner)).toEqual({
      gravity: 0,
      encounters: { Overworld: 2, Margit: 0 },
    });
  });

  test("when two Mods edit the same Death, the last write wins and both are in history", async () => {
    const t = setup();
    const { asOwner, margit, overworld } = await runWithDeaths(t, 1);
    const asSomeMod = await signInSomeMod(t, asOwner);
    const [death] = await deathIds(asOwner);

    await updateDeaths(asSomeMod, { deathIds: [death!], encounterId: margit });
    await updateDeaths(asOwner, { deathIds: [death!], encounterId: overworld });

    expect(await counts(asOwner)).toEqual({
      gravity: 0,
      encounters: { Overworld: 1, Margit: 0 },
    });
    expect(await history(asOwner)).toMatchObject([
      { actorName: "Streamer", description: "1 Death → Overworld" },
      { actorName: "SomeMod", description: `1 Death → ${MARGIT}` },
      { actorName: "Streamer", description: "Recorded a Death in Overworld" },
      { actorName: "Streamer", description: `Added ${MARGIT}` },
      { description: "Created Tarnished's Run" },
    ]);
  });

  test("history shows each actor's current display name", async () => {
    const t = setup();
    const { asOwner } = await runWithDeaths(t, 1);
    const asSomeMod = await signInSomeMod(t, asOwner);
    const [death] = await deathIds(asOwner);
    await updateDeaths(asSomeMod, { deathIds: [death!], gravity: true });

    await signInWithTwitch(t, { ...someMod, displayName: "RenamedMod" });
    vi.unstubAllGlobals();

    expect(await history(asOwner)).toMatchObject([
      { actorName: "RenamedMod" },
      { actorName: "Streamer" },
      { actorName: "Streamer" },
      { actorName: "Streamer" },
    ]);
  });
});

test("after a redo, undo my last undoes the redone Change again", async () => {
  const t = setup();
  const { asOwner, runId, margit } = await runWithDeaths(t, 1);
  const before = await state(asOwner);
  const [death] = await deathIds(asOwner);
  await updateDeaths(asOwner, { deathIds: [death!], encounterId: margit });

  await asOwner.mutation(api.changes.undoMyLast, { runId });
  await asOwner.mutation(api.changes.undo, {
    changeId: await newestChange(asOwner),
  });
  await asOwner.mutation(api.changes.undoMyLast, { runId });

  expect(await state(asOwner)).toEqual(before);
  expect(await history(asOwner)).toMatchObject([
    { description: `Undid: 1 Death → ${MARGIT}`, undone: false },
    { description: `Redid: 1 Death → ${MARGIT}`, undone: false },
    { description: `Undid: 1 Death → ${MARGIT}`, undone: true },
    { description: `1 Death → ${MARGIT}`, undone: true },
    { description: "Recorded a Death in Overworld", undone: false },
    { description: `Added ${MARGIT}`, undone: false },
    { description: "Created Tarnished's Run", undone: false },
  ]);
});

test("an Undo in history is the kind of Change it undid", async () => {
  const t = setup();
  const { asOwner, runId, margit } = await runWithDeaths(t, 1);
  const [death] = await deathIds(asOwner);
  await updateDeaths(asOwner, { deathIds: [death!], encounterId: margit });
  await asOwner.mutation(api.changes.undoMyLast, { runId });

  expect(await asOwner.query(api.changes.history, {})).toMatchObject([
    { action: "updateDeaths", isUndo: true },
    { action: "updateDeaths", isUndo: false },
    { action: "recordDeath", isUndo: false },
    { action: "addEncounter", isUndo: false },
    { action: "createRun", isUndo: false },
  ]);
});

test("someone who isn't a Mod can't reassign or tag Deaths, undo, or read history", async () => {
  const t = setup();
  const { asOwner, runId, margit } = await runWithDeaths(t, 1);
  const [death] = await deathIds(asOwner);
  await updateDeaths(asOwner, { deathIds: [death!], encounterId: margit });
  const changeId = await newestChange(asOwner);
  const { asUser: someoneElse } = await signInWithTwitch(t, someMod);
  vi.unstubAllGlobals();

  await expect(
    someoneElse.mutation(api.deaths.update, {
      deathIds: [death!],
      tag: { tagId: await gravityTag(asOwner), tagged: true },
    }),
  ).rejects.toThrow("Only the Streamer and Mods");
  await expect(
    someoneElse.mutation(api.changes.undo, { changeId }),
  ).rejects.toThrow("Only the Streamer and Mods");
  await expect(
    someoneElse.mutation(api.changes.undoMyLast, { runId }),
  ).rejects.toThrow("Only the Streamer and Mods");
  await expect(someoneElse.query(api.changes.history, {})).rejects.toThrow(
    "Only the Streamer and Mods",
  );
});

describe("adding Encounters", () => {
  test("adding a boss is a Change: undo removes it from the Run, redo brings it back", async () => {
    const t = setup();
    const { asOwner } = await runWithDeaths(t, 0);
    const added = await state(asOwner);

    await asOwner.mutation(api.changes.undo, {
      changeId: await newestChange(asOwner),
    });
    expect((await state(asOwner)).encounters).toEqual([
      { name: "Overworld", deathCount: 0, defeated: false },
    ]);

    await asOwner.mutation(api.changes.undo, {
      changeId: await newestChange(asOwner),
    });
    expect(await state(asOwner)).toEqual(added);
    expect(await history(asOwner)).toMatchObject([
      { description: `Redid: Added ${MARGIT}` },
      { description: `Undid: Added ${MARGIT}`, undone: true },
      { description: `Added ${MARGIT}`, undone: false },
      { description: "Created Tarnished's Run" },
    ]);
  });

  test("adding a Custom Encounter is a Change too", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithDeaths(t, 0);

    await asOwner.mutation(api.encounters.addCustom, {
      runId,
      name: "Jumping puzzle",
    });
    await asOwner.mutation(api.changes.undoMyLast, { runId });

    expect((await state(asOwner)).encounters.map((e) => e.name)).toEqual([
      "Overworld",
      MARGIT,
    ]);
    expect(await history(asOwner)).toMatchObject([
      { description: "Undid: Added Jumping puzzle" },
      { description: "Added Jumping puzzle", undone: true },
      { description: `Added ${MARGIT}` },
      { description: "Created Tarnished's Run" },
    ]);
  });

  test("re-adding a removed boss puts it after those added since", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithDeaths(t, 0);
    await asOwner.mutation(api.changes.undoMyLast, { runId });
    await asOwner.mutation(api.encounters.addBoss, {
      runId,
      bossId: "10000800",
    });

    await asOwner.mutation(api.encounters.addBoss, {
      runId,
      bossId: "10000850",
    });

    expect((await state(asOwner)).encounters.map((e) => e.name)).toEqual([
      "Overworld",
      GODRICK,
      MARGIT,
    ]);
  });

  test("redoing an add is refused while the boss was added again since", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithDeaths(t, 0);
    await asOwner.mutation(api.changes.undoMyLast, { runId });
    const [undo] = await asOwner.query(api.changes.history, {});
    await asOwner.mutation(api.encounters.addBoss, {
      runId,
      bossId: "10000850",
    });

    expect(await history(asOwner)).toMatchObject([
      { description: `Added ${MARGIT}`, refusal: null },
      {
        description: `Undid: Added ${MARGIT}`,
        undone: false,
        blockedBy: null,
        refusal: `${MARGIT} is in the Run again.`,
      },
      // Undone, so it says that rather than why.
      { description: `Added ${MARGIT}`, undone: true, refusal: null },
      { description: "Created Tarnished's Run", refusal: null },
    ]);
    await expect(
      asOwner.mutation(api.changes.undo, { changeId: undo!._id }),
    ).rejects.toThrow(`${MARGIT} is in the Run again.`);
    expect((await state(asOwner)).encounters.map((e) => e.name)).toEqual([
      "Overworld",
      MARGIT,
    ]);
  });

  test.each([
    [
      "it has Deaths",
      async (asOwner: AsOwner, margit: Id<"encounters">) => {
        const [death] = await deathIds(asOwner);
        await updateDeaths(asOwner, {
          deathIds: [death!],
          encounterId: margit,
        });
      },
      `${MARGIT} has Deaths now.`,
    ],
    [
      "it's the Current Encounter",
      async (asOwner: AsOwner, margit: Id<"encounters">, runId: Id<"runs">) => {
        await asOwner.mutation(api.encounters.setCurrent, {
          runId,
          encounterId: margit,
        });
      },
      `${MARGIT} is the Current Encounter.`,
    ],
  ])("undoing an add is refused while %s", async (_, act, refusal) => {
    const t = setup();
    const { asOwner, runId, margit } = await runWithDeaths(t, 1);
    const added = (await asOwner.query(api.changes.history, {})).find(
      (entry) => entry.action === "addEncounter",
    );
    await act(asOwner, margit, runId);

    expect(
      (await asOwner.query(api.changes.history, {})).find(
        (entry) => entry._id === added!._id,
      ),
    ).toMatchObject({ undone: false, blockedBy: null, refusal });
    await expect(
      asOwner.mutation(api.changes.undo, { changeId: added!._id }),
    ).rejects.toThrow(refusal);
  });

  test("nothing can be assigned or switched to a removed Encounter", async () => {
    const t = setup();
    const { asOwner, runId, margit } = await runWithDeaths(t, 1);
    const added = (await asOwner.query(api.changes.history, {})).find(
      (entry) => entry.action === "addEncounter",
    );
    await asOwner.mutation(api.changes.undo, { changeId: added!._id });
    const [death] = await deathIds(asOwner);

    await expect(
      updateDeaths(asOwner, { deathIds: [death!], encounterId: margit }),
    ).rejects.toThrow("That Encounter isn't in this Run.");
    await expect(
      asOwner.mutation(api.encounters.setCurrent, {
        runId,
        encounterId: margit,
      }),
    ).rejects.toThrow("That Encounter isn't in this Run.");
    await expect(
      asOwner.mutation(api.encounters.markDefeated, { encounterId: margit }),
    ).rejects.toThrow("That Encounter isn't in this Run.");
  });
});
