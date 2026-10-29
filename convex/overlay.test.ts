import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import {
  owner,
  recordDeaths,
  setup,
  signInWithTwitch,
  stubAuthEnv,
  useFutureClock,
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

// What OBS gets, signed out: the counts, or null with no active Run.
function overlay(t: T) {
  return t.query(api.overlay.current, {});
}

async function signInOwner(t: T) {
  const { asUser: asOwner } = await signInWithTwitch(t, owner);
  vi.unstubAllGlobals();
  return asOwner;
}

// The Streamer and an active Run.
async function activeRun(t: T) {
  const asOwner = await signInOwner(t);
  const runId = await asOwner.mutation(api.runs.createRun, {
    characterName: "Tarnished",
  });
  return { asOwner, runId };
}

describe("reading the Overlay", () => {
  test("it shows the Current Encounter and its count, the Run's Total and the Gravity tally", async () => {
    const t = setup();
    const { asOwner, runId } = await activeRun(t);
    await recordDeaths(asOwner, runId, 2);

    expect(await overlay(t)).toEqual({
      encounter: { name: "Overworld", deathCount: 2 },
      total: 2,
      gravity: 0,
      tags: [{ tagId: expect.any(String), name: "Gravity", count: 0, gravity: true }],
      encounters: [{ name: "Overworld", deathCount: 2, defeated: false }],
      defeated: [],
      lastDeathAt: null,
      streamDeaths: null,
      streamFelled: null,
      popoutAt: null,
      playTime: null,
    });
  });

  test("a boss shows by its name alone, and Gravity Deaths count in its tally", async () => {
    const t = setup();
    const { asOwner, runId } = await activeRun(t);
    const margit = await asOwner.mutation(api.encounters.addBoss, {
      runId,
      bossId: "10000850",
    });
    await asOwner.mutation(api.encounters.setCurrent, {
      runId,
      encounterId: margit,
    });
    await recordDeaths(asOwner, runId, 1);
    const { page } = await asOwner.query(api.runs.deathFeed, {
      paginationOpts: { cursor: null, numItems: 10 },
    });
    await asOwner.mutation(api.deaths.update, {
      deathIds: [page[0]!._id],
      tag: {
        tagId: (await asOwner.query(api.tags.list, {}))[0]!._id,
        tagged: true,
      },
    });

    expect(await overlay(t)).toEqual({
      encounter: { name: "Margit, the Fell Omen", deathCount: 1 },
      total: 1,
      gravity: 1,
      tags: [{ tagId: expect.any(String), name: "Gravity", count: 1, gravity: true }],
      encounters: [
        { name: "Overworld", deathCount: 0, defeated: false },
        { name: "Margit, the Fell Omen", deathCount: 1, defeated: false },
      ],
      defeated: [],
      lastDeathAt: null,
      streamDeaths: null,
      streamFelled: null,
      popoutAt: null,
      playTime: null,
    });
  });

  test("each Tag shows with its tally, and a removed one doesn't show", async () => {
    const t = setup();
    const { asOwner, runId } = await activeRun(t);
    await recordDeaths(asOwner, runId, 1);
    const { page } = await asOwner.query(api.runs.deathFeed, {
      paginationOpts: { cursor: null, numItems: 10 },
    });
    const birds = await asOwner.mutation(api.tags.create, { name: "Birds" });
    const crows = await asOwner.mutation(api.tags.create, { name: "Crows" });
    await asOwner.mutation(api.deaths.update, {
      deathIds: [page[0]!._id],
      tag: { tagId: birds, tagged: true },
    });
    await asOwner.mutation(api.tags.remove, { tagId: crows });

    expect((await overlay(t))?.tags).toEqual([
      { tagId: expect.any(String), name: "Gravity", count: 0, gravity: true },
      { tagId: birds, name: "Birds", count: 1, gravity: false },
    ]);
  });

  test("the list view gets every Encounter in the Run, in the order added, with Defeated marks", async () => {
    const t = setup();
    const { asOwner, runId } = await activeRun(t);
    await recordDeaths(asOwner, runId, 1);
    const margit = await asOwner.mutation(api.encounters.addBoss, {
      runId,
      bossId: "10000850",
    });
    await asOwner.mutation(api.encounters.addCustom, {
      runId,
      name: "Invasion",
    });
    await asOwner.mutation(api.encounters.markDefeated, {
      encounterId: margit,
    });

    expect((await overlay(t))?.encounters).toEqual([
      { name: "Overworld", deathCount: 1, defeated: false },
      { name: "Margit, the Fell Omen", deathCount: 0, defeated: true },
      { name: "Invasion", deathCount: 0, defeated: false },
    ]);
  });

  test("the Defeated bosses come in the order they were beaten, not the order added", async () => {
    const t = setup();
    const { asOwner, runId } = await activeRun(t);
    const margit = await asOwner.mutation(api.encounters.addBoss, {
      runId,
      bossId: "10000850",
    });
    const godrick = await asOwner.mutation(api.encounters.addBoss, {
      runId,
      bossId: "10000800",
    });
    // Margit was given up on, and beaten after Godrick.
    useFutureClock();
    await asOwner.mutation(api.encounters.markDefeated, {
      encounterId: godrick,
    });
    vi.advanceTimersByTime(60_000);
    await asOwner.mutation(api.encounters.markDefeated, {
      encounterId: margit,
    });

    expect((await overlay(t))?.defeated).toEqual([
      { name: "Godrick the Grafted", deathCount: 0 },
      { name: "Margit, the Fell Omen", deathCount: 0 },
    ]);
  });

  test("a boss whose Defeat was undone takes its place from when it's beaten again", async () => {
    const t = setup();
    const { asOwner, runId } = await activeRun(t);
    const margit = await asOwner.mutation(api.encounters.addBoss, {
      runId,
      bossId: "10000850",
    });
    const godrick = await asOwner.mutation(api.encounters.addBoss, {
      runId,
      bossId: "10000800",
    });
    useFutureClock();
    await asOwner.mutation(api.encounters.markDefeated, {
      encounterId: margit,
    });
    await asOwner.mutation(api.changes.undoMyLast, { runId });
    vi.advanceTimersByTime(60_000);
    await asOwner.mutation(api.encounters.markDefeated, {
      encounterId: godrick,
    });
    vi.advanceTimersByTime(60_000);
    await asOwner.mutation(api.encounters.markDefeated, {
      encounterId: margit,
    });

    expect((await overlay(t))?.defeated).toEqual([
      { name: "Godrick the Grafted", deathCount: 0 },
      { name: "Margit, the Fell Omen", deathCount: 0 },
    ]);
  });

  test("an Encounter whose adding was undone isn't in the list", async () => {
    const t = setup();
    const { asOwner, runId } = await activeRun(t);
    await asOwner.mutation(api.encounters.addCustom, {
      runId,
      name: "Invasion",
    });
    await asOwner.mutation(api.changes.undoMyLast, { runId });

    expect((await overlay(t))?.encounters).toEqual([
      { name: "Overworld", deathCount: 0, defeated: false },
    ]);
  });

  test("the Total is every Death in the Run, whichever Encounter it's in", async () => {
    const t = setup();
    const { asOwner, runId } = await activeRun(t);
    const margit = await asOwner.mutation(api.encounters.addBoss, {
      runId,
      bossId: "10000850",
    });
    await recordDeaths(asOwner, runId, 2);
    await recordDeaths(asOwner, runId, 3, margit);

    expect(await overlay(t)).toMatchObject({
      encounter: { name: "Overworld", deathCount: 2 },
      total: 5,
    });
  });

  test("a removed Death isn't counted", async () => {
    const t = setup();
    const { asOwner, runId } = await activeRun(t);
    const [deathId] = await recordDeaths(asOwner, runId, 2);
    await asOwner.mutation(api.deaths.remove, { deathId: deathId! });

    expect((await overlay(t))?.total).toBe(1);
  });

  test("with no active Run it shows nothing", async () => {
    const t = setup();
    const { asOwner, runId } = await activeRun(t);
    await asOwner.mutation(api.runs.archive, { runId });

    expect(await overlay(t)).toBeNull();
  });

  test("before the Streamer has ever signed in it shows nothing", async () => {
    const t = setup();

    expect(await overlay(t)).toBeNull();
  });
});

describe("popping out the toughest boss", () => {
  test("the Overlay gets the time a Mod last asked for it", async () => {
    const t = setup();
    const { asOwner } = await activeRun(t);
    expect((await overlay(t))?.popoutAt).toBeNull();

    const first = useFutureClock();
    await asOwner.mutation(api.overlay.popOut, {});
    expect((await overlay(t))?.popoutAt).toBe(first);

    vi.setSystemTime(first + 5000);
    await asOwner.mutation(api.overlay.popOut, {});
    expect((await overlay(t))?.popoutAt).toBe(first + 5000);
  });

  test("only a signed-in Mod or the Streamer can ask", async () => {
    const t = setup();
    await activeRun(t);

    await expect(t.mutation(api.overlay.popOut, {})).rejects.toThrow(
      "Only the Streamer and Mods can do this.",
    );
  });
});
