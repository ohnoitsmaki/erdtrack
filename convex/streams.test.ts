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
import { DEATH_COOLDOWN_MS } from "./deathLimits";

beforeEach(() => {
  stubAuthEnv();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function overlay(t: T) {
  return t.query(api.overlay.current, {});
}

// The Streamer and an active Run.
async function activeRun(t: T) {
  const { asUser: asOwner } = await signInWithTwitch(t, owner);
  vi.unstubAllGlobals();
  const runId = await asOwner.mutation(api.runs.createRun, {
    characterName: "Tarnished",
  });
  return { asOwner, runId };
}

describe("the Stream", () => {
  test("there's none until a Mod starts one, and none again once it's ended", async () => {
    const t = setup();
    const { asOwner } = await activeRun(t);
    expect(await asOwner.query(api.streams.current, {})).toBeNull();
    expect((await overlay(t))?.streamDeaths).toBeNull();

    const startedAt = useFutureClock();
    await asOwner.mutation(api.streams.start, {});
    expect(await asOwner.query(api.streams.current, {})).toEqual({
      startedAt,
      deaths: 0,
    });
    await expect(asOwner.mutation(api.streams.start, {})).rejects.toThrow(
      "The Stream has already started.",
    );

    await asOwner.mutation(api.streams.end, {});
    expect(await asOwner.query(api.streams.current, {})).toBeNull();
    await expect(asOwner.mutation(api.streams.end, {})).rejects.toThrow(
      "The Stream has already ended.",
    );
  });

  test("it counts the Deaths recorded since it started, but not those removed or added to catch up", async () => {
    const t = setup();
    const { asOwner, runId } = await activeRun(t);
    await recordDeaths(asOwner, runId, 2);
    vi.setSystemTime(Date.now() + 1);
    await asOwner.mutation(api.streams.start, {});
    const [, mistake] = await recordDeaths(asOwner, runId, 3);
    await asOwner.mutation(api.deaths.remove, { deathId: mistake! });
    await asOwner.mutation(api.deaths.addMany, { runId, count: 10 });

    expect((await asOwner.query(api.streams.current, {}))?.deaths).toBe(2);
    expect((await overlay(t))?.streamDeaths).toBe(2);
  });

  test("it counts the Deaths of every Run, as the character can change mid-stream", async () => {
    const t = setup();
    const { asOwner, runId } = await activeRun(t);
    await asOwner.mutation(api.streams.start, {});
    await recordDeaths(asOwner, runId, 1);
    const other = await asOwner.mutation(api.runs.createRun, {
      characterName: "Second",
    });
    await recordDeaths(asOwner, other, 2);

    expect((await asOwner.query(api.streams.current, {}))?.deaths).toBe(3);
  });

  test("only the Streamer and Mods can start and end it", async () => {
    const t = setup();
    await activeRun(t);
    await expect(t.mutation(api.streams.start, {})).rejects.toThrow(
      "Only the Streamer and Mods can do this.",
    );
  });
});

describe("the bosses felled this Stream", () => {
  test("it counts the bosses marked Defeated since it started, but not those marked catching up, or hidden", async () => {
    const t = setup();
    const { asOwner, runId } = await activeRun(t);
    const addBoss = (bossId: string) =>
      asOwner.mutation(api.encounters.addBoss, { runId, bossId });
    const before = await addBoss("10000850");
    await asOwner.mutation(api.encounters.markDefeated, { encounterId: before });
    expect((await overlay(t))?.streamFelled).toBeNull();

    vi.setSystemTime(Date.now() + 1);
    await asOwner.mutation(api.streams.start, {});
    const felled = await addBoss("15000800");
    const hidden = await addBoss("18000850");
    await asOwner.mutation(api.encounters.markDefeated, { encounterId: felled });
    await asOwner.mutation(api.encounters.markDefeated, { encounterId: hidden });
    await asOwner.mutation(api.encounters.setHidden, {
      runId,
      encounterId: hidden,
      hidden: true,
    });
    await asOwner.mutation(api.deaths.addMany, {
      runId,
      count: 5,
      split: [{ bossId: "1042360800", count: 5, defeated: true }],
    });

    expect((await overlay(t))?.streamFelled).toBe(1);
  });
});

describe("the Stream's latest Death's time", () => {
  test("it's null while there's no Stream, and before the Stream's first Death", async () => {
    const t = setup();
    const { asOwner, runId } = await activeRun(t);
    await recordDeaths(asOwner, runId, 1);
    expect((await overlay(t))?.lastDeathAt).toBeNull();

    vi.setSystemTime(Date.now() + 1);
    await asOwner.mutation(api.streams.start, {});
    expect((await overlay(t))?.lastDeathAt).toBeNull();

    await recordDeaths(asOwner, runId, 1);
    await asOwner.mutation(api.streams.end, {});
    expect((await overlay(t))?.lastDeathAt).toBeNull();
  });

  test("it's the latest still recorded", async () => {
    const t = setup();
    const { asOwner, runId } = await activeRun(t);
    await asOwner.mutation(api.streams.start, {});

    const [, second] = await recordDeaths(asOwner, runId, 2);
    const secondAt = Date.now();
    expect((await overlay(t))?.lastDeathAt).toBe(secondAt);

    await asOwner.mutation(api.deaths.remove, { deathId: second! });
    expect((await overlay(t))?.lastDeathAt).toBe(secondAt - DEATH_COOLDOWN_MS);
  });

  test("Deaths added to catch up don't move it", async () => {
    const t = setup();
    const { asOwner, runId } = await activeRun(t);
    await asOwner.mutation(api.streams.start, {});
    await recordDeaths(asOwner, runId, 1);
    const at = Date.now();
    vi.setSystemTime(at + 60_000);
    await asOwner.mutation(api.deaths.addMany, { runId, count: 5 });

    expect((await overlay(t))?.lastDeathAt).toBe(at);
  });

  test("it's the latest in any Run, as the character can change mid-stream", async () => {
    const t = setup();
    const { asOwner, runId } = await activeRun(t);
    await asOwner.mutation(api.streams.start, {});
    await recordDeaths(asOwner, runId, 1);
    const at = Date.now();
    await asOwner.mutation(api.runs.createRun, { characterName: "Second" });

    expect((await overlay(t))?.lastDeathAt).toBe(at);
  });
});
