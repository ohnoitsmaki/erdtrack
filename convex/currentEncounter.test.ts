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

// The Streamer and a Run with Margit added.
async function runWithMargit(t: T) {
  const { asUser: asOwner } = await signInWithTwitch(t, owner);
  vi.unstubAllGlobals();
  const runId = await asOwner.mutation(api.runs.createRun, {
    characterName: "Tarnished",
  });
  const margit = await asOwner.mutation(api.encounters.addBoss, {
    runId,
    bossId: "10000850",
  });
  return { asOwner, runId, margit };
}

async function feed(asOwner: AsUser) {
  const { page } = await asOwner.query(api.runs.deathFeed, {
    paginationOpts: { cursor: null, numItems: 20 },
  });
  return page.map(({ encounterName }) => encounterName);
}

async function currentEncounter(asOwner: AsUser) {
  const run = await asOwner.query(api.runs.activeRun, {});
  return run!.encounters.find((e) => e._id === run!.currentEncounterId)?.name;
}

function setCurrent(
  asOwner: AsUser,
  runId: Id<"runs">,
  encounterId: Id<"encounters">,
) {
  return asOwner.mutation(api.encounters.setCurrent, { runId, encounterId });
}

const MARGIT = "Margit, the Fell Omen — Stormveil Castle (Stormveil Castle)";

describe("Current Encounter", () => {
  test("when no boss has been set, it's Overworld and Deaths go there", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);

    await recordDeaths(asOwner, runId, 2);

    expect(await currentEncounter(asOwner)).toBe("Overworld");
    expect(await feed(asOwner)).toEqual(["Overworld", "Overworld"]);
  });

  // Convex re-runs a subscribed query only when what it read changes. A
  // query that read switches up to its own clock never sees a later one, so
  // the Panel and the Overlay kept showing the old Encounter until a reload.
  // The test clock can't go back behind a commit, so the switch is dated
  // after the query's clock instead.
  test("is the latest switch, even one dated after the query's clock", async () => {
    const t = setup();
    const { asOwner, runId, margit } = await runWithMargit(t);

    await t.run((ctx) =>
      ctx.db.insert("encounterSwitches", {
        runId,
        encounterId: margit,
        at: Date.now() + 60_000,
      }),
    );

    expect(await currentEncounter(asOwner)).toBe(MARGIT);
  });

  test("a Death is recorded in the Current Encounter unless another is chosen", async () => {
    const t = setup();
    const { asOwner, runId, margit } = await runWithMargit(t);
    const run = await asOwner.query(api.runs.activeRun, {});

    await setCurrent(asOwner, runId, margit);
    await recordDeaths(asOwner, runId, 1);
    await recordDeaths(asOwner, runId, 1, run!.encounters[0]!._id);

    expect(await feed(asOwner)).toEqual(["Overworld", MARGIT]);
  });

  test("a Death can't be recorded in an Encounter removed from the Run", async () => {
    const t = setup();
    const { asOwner, runId, margit } = await runWithMargit(t);
    await asOwner.mutation(api.changes.undoMyLast, { runId });

    await expect(recordDeaths(asOwner, runId, 1, margit)).rejects.toThrow(
      "That Encounter isn't in this Run.",
    );
  });
});

describe("Defeated", () => {
  test("marking the current boss Defeated resets to Overworld", async () => {
    const t = setup();
    const { asOwner, runId, margit } = await runWithMargit(t);
    await setCurrent(asOwner, runId, margit);
    await recordDeaths(asOwner, runId, 1);

    await asOwner.mutation(api.encounters.markDefeated, {
      encounterId: margit,
    });

    const run = await asOwner.query(api.runs.activeRun, {});
    expect(await currentEncounter(asOwner)).toBe("Overworld");
    expect(run!.encounters).toMatchObject([
      { name: "Overworld", defeated: false, deathCount: 0 },
      { name: MARGIT, defeated: true, deathCount: 1 },
    ]);
    expect(await asOwner.query(api.changes.history, {})).toMatchObject([
      { description: `Marked ${MARGIT} Defeated` },
      { description: `Recorded a Death in ${MARGIT}` },
      { description: `Current Encounter → ${MARGIT}` },
      { description: `Added ${MARGIT}` },
      { description: "Created Tarnished's Run" },
    ]);
  });

  test("marking a boss already Defeated records no Change", async () => {
    const t = setup();
    const { asOwner, margit } = await runWithMargit(t);
    await asOwner.mutation(api.encounters.markDefeated, {
      encounterId: margit,
    });

    await asOwner.mutation(api.encounters.markDefeated, {
      encounterId: margit,
    });

    expect(await asOwner.query(api.changes.history, {})).toHaveLength(3);
  });

  test("only a boss can be marked Defeated", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);
    const run = await asOwner.query(api.runs.activeRun, {});

    await expect(
      asOwner.mutation(api.encounters.markDefeated, {
        encounterId: run!.currentEncounterId,
      }),
    ).rejects.toThrow("Only a boss");
    const custom = await asOwner.mutation(api.encounters.addCustom, {
      runId,
      name: "Jumping puzzle",
    });
    await expect(
      asOwner.mutation(api.encounters.markDefeated, { encounterId: custom }),
    ).rejects.toThrow("Only a boss");
  });
});

describe("permissions", () => {
  test("someone who isn't a Mod can't switch the Current Encounter or mark Defeated", async () => {
    const t = setup();
    const { runId, margit } = await runWithMargit(t);
    const { asUser: someoneElse } = await signInWithTwitch(t, {
      id: "222",
      login: "somemod",
      displayName: "SomeMod",
    });

    await expect(setCurrent(someoneElse, runId, margit)).rejects.toThrow(
      "Only the Streamer and Mods",
    );
    await expect(
      someoneElse.mutation(api.encounters.markDefeated, {
        encounterId: margit,
      }),
    ).rejects.toThrow("Only the Streamer and Mods");
  });
});
