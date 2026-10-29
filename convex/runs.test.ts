import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MAX_CHARACTER_NAME_LENGTH } from "./runLimits";
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

type AsOwner = AsUser;

async function signInAsOwner(t: T) {
  const { asUser } = await signInWithTwitch(t, owner);
  vi.unstubAllGlobals();
  return asUser;
}

function createRun(asOwner: AsOwner, characterName: string) {
  return asOwner.mutation(api.runs.createRun, { characterName });
}

async function activeName(asOwner: AsOwner) {
  return (await asOwner.query(api.runs.activeRun, {}))?.characterName ?? null;
}

async function history(asOwner: AsOwner) {
  const entries = await asOwner.query(api.changes.history, {});
  return entries.map(({ description, undone }) => ({ description, undone }));
}

describe("switching by hand", () => {
  test("is a Change that can be undone", async () => {
    const t = setup();
    const asOwner = await signInAsOwner(t);
    const first = await createRun(asOwner, "Tarnished");
    await createRun(asOwner, "Second");

    await asOwner.mutation(api.runs.setActive, { runId: first });

    expect(await activeName(asOwner)).toBe("Tarnished");
    const [switched] = await asOwner.query(api.changes.history, {});
    expect(switched!.description).toBe("Switched to Tarnished");

    await asOwner.mutation(api.changes.undo, { changeId: switched!._id });

    expect(await activeName(asOwner)).toBe("Second");
  });

  test("can't be undone once another Run was switched to since", async () => {
    const t = setup();
    const asOwner = await signInAsOwner(t);
    const first = await createRun(asOwner, "Tarnished");
    const second = await createRun(asOwner, "Second");
    await asOwner.mutation(api.runs.setActive, { runId: first });

    await asOwner.mutation(api.runs.setActive, { runId: second });

    expect(await activeName(asOwner)).toBe("Second");
    const [switched] = await asOwner.query(api.changes.history, {
      runId: first,
    });
    expect(switched).toMatchObject({
      description: "Switched to Tarnished",
      blockedBy: null,
      refusal: "The active Run has changed since.",
    });
    await expect(
      asOwner.mutation(api.changes.undo, { changeId: switched!._id }),
    ).rejects.toThrow("The active Run has changed since.");
  });

  // So a Run's own page can send the viewer to the Overview.
  test("a Run's own page says whether it's the active Run", async () => {
    const t = setup();
    const asOwner = await signInAsOwner(t);
    const first = await createRun(asOwner, "Tarnished");
    const second = await createRun(asOwner, "Second");

    await asOwner.mutation(api.runs.setActive, { runId: first });

    expect(await asOwner.query(api.runs.run, { runId: first })).toMatchObject({
      active: true,
    });
    expect(await asOwner.query(api.runs.run, { runId: second })).toMatchObject({
      active: false,
    });
  });
});

describe("creating a Run", () => {
  test("makes it the active Run with only Overworld and no Deaths", async () => {
    const t = setup();
    const asOwner = await signInAsOwner(t);

    await createRun(asOwner, "Tarnished");

    expect(await asOwner.query(api.runs.activeRun, {})).toMatchObject({
      characterName: "Tarnished",
      total: 0,
      lastDeathAt: null,
      archived: false,
      encounters: [{ name: "Overworld", deathCount: 0 }],
    });
  });

  test("is the first Change in its history, and undoing it leaves no active Run", async () => {
    const t = setup();
    const asOwner = await signInAsOwner(t);
    const runId = await createRun(asOwner, "Tarnished");

    expect(await history(asOwner)).toEqual([
      { description: "Created Tarnished's Run", undone: false },
    ]);
    await asOwner.mutation(api.changes.undoMyLast, { runId });

    expect(await asOwner.query(api.runs.activeRun, {})).toBeNull();
    expect(await asOwner.query(api.runs.list, {})).toEqual([]);
  });

  test("undoing it brings back the Run that was active before", async () => {
    const t = setup();
    const asOwner = await signInAsOwner(t);
    await createRun(asOwner, "Tarnished");
    const second = await createRun(asOwner, "Second");

    await asOwner.mutation(api.changes.undoMyLast, { runId: second });

    expect(await activeName(asOwner)).toBe("Tarnished");
  });

  test("trims the character name", async () => {
    const t = setup();
    const asOwner = await signInAsOwner(t);

    await createRun(asOwner, "  Tarnished  ");

    expect(await activeName(asOwner)).toBe("Tarnished");
  });

  test.each([
    ["a blank name", "   "],
    ["an over-long name", "x".repeat(MAX_CHARACTER_NAME_LENGTH + 1)],
  ])("with %s is refused", async (_, name) => {
    const t = setup();
    const asOwner = await signInAsOwner(t);

    await expect(createRun(asOwner, name)).rejects.toThrow(
      `A character name needs 1 to ${MAX_CHARACTER_NAME_LENGTH} characters.`,
    );
    expect(await asOwner.query(api.runs.list, {})).toEqual([]);
  });

  test(`a name of exactly ${MAX_CHARACTER_NAME_LENGTH} characters is allowed`, async () => {
    const t = setup();
    const asOwner = await signInAsOwner(t);
    const name = "x".repeat(MAX_CHARACTER_NAME_LENGTH);

    await createRun(asOwner, name);

    expect(await activeName(asOwner)).toBe(name);
  });

  test("can't be undone once the Run has Deaths", async () => {
    const t = setup();
    const asOwner = await signInAsOwner(t);
    const runId = await createRun(asOwner, "Tarnished");
    await recordDeaths(asOwner, runId, 1);
    const created = (await asOwner.query(api.changes.history, {})).at(-1);

    expect(created).toMatchObject({
      description: "Created Tarnished's Run",
      blockedBy: null,
      refusal: "Tarnished's Run has Deaths now.",
    });
    await expect(
      asOwner.mutation(api.changes.undo, { changeId: created!._id }),
    ).rejects.toThrow("Tarnished's Run has Deaths now.");
  });

  test("someone who isn't a Mod can't create one", async () => {
    const t = setup();
    await signInAsOwner(t);
    const { asUser: someoneElse } = await signInWithTwitch(t, someMod);
    vi.unstubAllGlobals();

    await expect(createRun(someoneElse, "Tarnished")).rejects.toThrow(
      "Only the Streamer and Mods",
    );
  });
});

describe("the Run list", () => {
  test("lists every Run oldest first, with its Total", async () => {
    const t = setup();
    const asOwner = await signInAsOwner(t);
    const first = await createRun(asOwner, "Tarnished");
    await recordDeaths(asOwner, first, 2);
    await createRun(asOwner, "Second");

    expect(await asOwner.query(api.runs.list, {})).toMatchObject([
      { characterName: "Tarnished", total: 2, active: false, archived: false },
      { characterName: "Second", total: 0, active: true, archived: false },
    ]);
  });
});

describe("archiving", () => {
  // Every Change in it would say so, which says nothing.
  test("History doesn't show that an archived Run refuses undos, but pressing one is still refused", async () => {
    const t = setup();
    const asOwner = await signInAsOwner(t);
    const runId = await createRun(asOwner, "Tarnished");
    await asOwner.mutation(api.encounters.addBoss, {
      runId,
      bossId: "10000850",
    });
    await asOwner.mutation(api.runs.archive, { runId });

    const [archived, added] = await asOwner.query(api.changes.history, {
      runId,
    });
    expect(archived).toMatchObject({
      description: "Archived Tarnished's Run",
      refusal: null,
    });
    expect(added).toMatchObject({ blockedBy: null, refusal: null });
    await expect(
      asOwner.mutation(api.changes.undo, { changeId: added!._id }),
    ).rejects.toThrow("Tarnished's Run is archived.");
  });

  test("an archived Run rejects edits but stays viewable", async () => {
    const t = setup();
    const asOwner = await signInAsOwner(t);
    const runId = await createRun(asOwner, "Tarnished");
    await recordDeaths(asOwner, runId, 1);
    await asOwner.mutation(api.encounters.addCustom, { runId, name: "Gank" });

    await asOwner.mutation(api.runs.archive, { runId });

    await expect(
      asOwner.mutation(api.encounters.addCustom, { runId, name: "Other" }),
    ).rejects.toThrow("Tarnished's Run is archived.");
    await expect(
      asOwner.mutation(api.runs.setActive, { runId }),
    ).rejects.toThrow("Tarnished's Run is archived.");
    const [, added] = await asOwner.query(api.changes.history, { runId });
    await expect(
      asOwner.mutation(api.changes.undo, { changeId: added!._id }),
    ).rejects.toThrow("Tarnished's Run is archived.");
    expect(await asOwner.query(api.runs.activeRun, {})).toBeNull();
    expect(await asOwner.query(api.runs.list, {})).toMatchObject([
      { _id: runId, characterName: "Tarnished", archived: true, active: false },
    ]);
    expect(await asOwner.query(api.runs.run, { runId })).toMatchObject({
      total: 1,
      encounters: [{ name: "Overworld", deathCount: 1 }, { name: "Gank" }],
    });
  });

  // The Panel's /runs/:id takes whatever is in the address bar.
  test("an address that isn't a Run's opens no Run", async () => {
    const t = setup();
    const asOwner = await signInAsOwner(t);
    const runId = await createRun(asOwner, "Tarnished");
    await asOwner.mutation(api.runs.archive, { runId });
    await asOwner.mutation(api.runs.deleteRun, { runId });

    expect(await asOwner.query(api.runs.run, { runId: "not-a-run" })).toBeNull();
    expect(await asOwner.query(api.runs.run, { runId })).toBeNull();
  });

  test("archiving a Run that isn't active leaves the active Run", async () => {
    const t = setup();
    const asOwner = await signInAsOwner(t);
    const first = await createRun(asOwner, "Tarnished");
    await createRun(asOwner, "Second");

    await asOwner.mutation(api.runs.archive, { runId: first });

    expect(await activeName(asOwner)).toBe("Second");
  });

  test("undoing it brings the Run back as the active Run", async () => {
    const t = setup();
    const asOwner = await signInAsOwner(t);
    const runId = await createRun(asOwner, "Tarnished");
    await asOwner.mutation(api.runs.archive, { runId });

    const [archived] = await asOwner.query(api.changes.history, { runId });
    expect(archived!.description).toBe("Archived Tarnished's Run");
    await asOwner.mutation(api.changes.undo, { changeId: archived!._id });

    expect(await activeName(asOwner)).toBe("Tarnished");
  });

  test("can't be undone once another Run was made active since", async () => {
    const t = setup();
    const asOwner = await signInAsOwner(t);
    const runId = await createRun(asOwner, "Tarnished");
    await asOwner.mutation(api.runs.archive, { runId });
    await createRun(asOwner, "Again");

    const [archived] = await asOwner.query(api.changes.history, { runId });
    await expect(
      asOwner.mutation(api.changes.undo, { changeId: archived!._id }),
    ).rejects.toThrow("The active Run has changed since.");
  });
});

const someMod = { id: "222", login: "somemod", displayName: "SomeMod" };

// Everything left in the database that belongs to the Run.
function leftOf(t: T, runId: Id<"runs">) {
  return t.run(async (ctx) => ({
    run: await ctx.db.get(runId),
    changes: (await ctx.db.query("changes").collect()).filter(
      (change) => change.runId === runId,
    ).length,
    deaths: (await ctx.db.query("deaths").collect()).filter(
      (death) => death.runId === runId,
    ).length,
    encounters: (await ctx.db.query("encounters").collect()).filter(
      (encounter) => encounter.runId === runId,
    ).length,
    encounterSwitches: (await ctx.db.query("encounterSwitches").collect())
      .filter((encounterSwitch) => encounterSwitch.runId === runId).length,
  }));
}

describe("deleting a Run", () => {
  test("also deletes its Changes, Deaths, Encounters and switches", async () => {
    const t = setup();
    const asOwner = await signInAsOwner(t);
    const runId = await createRun(asOwner, "Tarnished");
    // Records Deaths on a fake clock, which the scheduler runs on too.
    await recordDeaths(asOwner, runId, 2);
    const gank = await asOwner.mutation(api.encounters.addCustom, {
      runId,
      name: "Gank",
    });
    await asOwner.mutation(api.encounters.setCurrent, {
      runId,
      encounterId: gank,
    });
    await asOwner.mutation(api.runs.archive, { runId });

    await asOwner.mutation(api.runs.deleteRun, { runId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await leftOf(t, runId)).toEqual({
      run: null,
      changes: 0,
      deaths: 0,
      encounters: 0,
      encounterSwitches: 0,
    });
    expect(await asOwner.query(api.runs.list, {})).toEqual([]);
  });

  test("is refused until the Run is archived", async () => {
    const t = setup();
    const asOwner = await signInAsOwner(t);
    const runId = await createRun(asOwner, "Tarnished");

    await expect(
      asOwner.mutation(api.runs.deleteRun, { runId }),
    ).rejects.toThrow("Archive Tarnished's Run before deleting it.");
  });

  test("a Mod can't delete a Run", async () => {
    const t = setup();
    const asOwner = await signInAsOwner(t);
    const runId = await createRun(asOwner, "Tarnished");
    await asOwner.mutation(api.runs.archive, { runId });
    await asOwner.mutation(api.mods.add, { login: someMod.login });
    const { asUser: asMod } = await signInWithTwitch(t, someMod);
    vi.unstubAllGlobals();

    await expect(
      asMod.mutation(api.runs.deleteRun, { runId }),
    ).rejects.toThrow("Only the Streamer can do this.");
    expect((await leftOf(t, runId)).run).not.toBeNull();
  });
});
