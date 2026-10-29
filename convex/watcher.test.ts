import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { bosses } from "./bosses";
import {
  owner,
  setup,
  signInWithTwitch,
  stubAuthEnv,
  useFutureClock,
  type FakeTwitchUser,
  type T,
} from "./signIn.testing";

const someMod: FakeTwitchUser = {
  id: "222",
  login: "somemod",
  displayName: "SomeMod",
};

type Report = {
  slot: number;
  characterName: string;
  total: number;
  defeatFlags: number[];
  playTime?: { seconds: number; running: boolean };
};

const tarnished: Report = {
  slot: 0,
  characterName: "Tarnished",
  total: 10,
  defeatFlags: [],
};

function report(t: T, token: string, body: unknown = tarnished) {
  return t.fetch("/api/watcher/report", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function signInAsOwner(t: T) {
  const { asUser } = await signInWithTwitch(t, owner);
  vi.unstubAllGlobals();
  return asUser;
}

async function ownerWithToken(t: T) {
  const asOwner = await signInAsOwner(t);
  const token = await asOwner.action(api.watcher.createToken, {});
  return { asOwner, token };
}

beforeEach(() => {
  stubAuthEnv();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the Watcher token", () => {
  test("a token the Streamer created can report", async () => {
    const t = setup();
    const { token } = await ownerWithToken(t);

    const response = await report(t, token);

    expect(response.status).toBe(200);
  });

  test("creating a new token revokes the old one", async () => {
    const t = setup();
    const { asOwner, token: oldToken } = await ownerWithToken(t);
    const newToken = await asOwner.action(api.watcher.createToken, {});

    expect(newToken).not.toBe(oldToken);
    expect((await report(t, oldToken)).status).toBe(401);
    expect((await report(t, newToken)).status).toBe(200);
  });

  test("a revoked token can no longer report", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);

    await asOwner.mutation(api.watcher.revokeToken, {});

    expect((await report(t, token)).status).toBe(401);
  });

  test.each([
    ["an unknown token", { authorization: "Bearer not-a-real-token" }],
    ["no token", {}],
    ["a token that isn't a Bearer token", { authorization: "Basic abc" }],
  ])("a report with %s is refused", async (_, headers) => {
    const t = setup();
    await ownerWithToken(t);

    const response = await t.fetch("/api/watcher/report", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(tarnished),
    });

    expect(response.status).toBe(401);
  });

  test.each([
    ["a slot outside 0-9", { ...tarnished, slot: 10 }],
    ["a negative slot", { ...tarnished, slot: -1 }],
    ["a slot that isn't a whole number", { ...tarnished, slot: 1.5 }],
    ["no character name", { ...tarnished, characterName: undefined }],
    ["an over-long name", { ...tarnished, characterName: "x".repeat(65) }],
    ["a negative Save Total", { ...tarnished, total: -1 }],
    ["a Save Total that isn't a number", { ...tarnished, total: "10" }],
    ["no Defeat Flags", { ...tarnished, defeatFlags: undefined }],
    ["a Defeat Flag that isn't a number", { ...tarnished, defeatFlags: ["1"] }],
    [
      "too many Defeat Flags",
      { ...tarnished, defeatFlags: Array.from({ length: 1001 }, (_, i) => i) },
    ],
    ["a Play Time that isn't an object", { ...tarnished, playTime: 60 }],
    [
      "a Play Time with negative seconds",
      { ...tarnished, playTime: { seconds: -1, running: false } },
    ],
    [
      "a Play Time with no running",
      { ...tarnished, playTime: { seconds: 60 } },
    ],
    ["a body that isn't an object", [1, 2]],
  ])("a report with %s is malformed", async (_, body) => {
    const t = setup();
    const { token } = await ownerWithToken(t);

    expect((await report(t, token, body)).status).toBe(400);
  });

  test("a body that isn't JSON is malformed", async () => {
    const t = setup();
    const { token } = await ownerWithToken(t);

    const response = await t.fetch("/api/watcher/report", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: "{not json",
    });

    expect(response.status).toBe(400);
  });

  // The App sends reports from its window, whose origin isn't the Panel's.
  // The token is a header, never a cookie, so any origin may send one.
  test("the App's window may send reports and read their status", async () => {
    const t = setup();
    const { token } = await ownerWithToken(t);
    const origin = { origin: "http://tauri.localhost" };

    const preflight = await t.fetch("/api/watcher/report", {
      method: "OPTIONS",
      headers: {
        ...origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, content-type",
      },
    });
    const accepted = await t.fetch("/api/watcher/report", {
      method: "POST",
      headers: { ...origin, authorization: `Bearer ${token}` },
      body: JSON.stringify(tarnished),
    });
    const refused = await t.fetch("/api/watcher/report", {
      method: "POST",
      headers: { ...origin, authorization: "Bearer revoked" },
      body: JSON.stringify(tarnished),
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-methods")).toBe("POST");
    expect(preflight.headers.get("access-control-allow-headers")).toBe(
      "Authorization, Content-Type",
    );
    for (const response of [accepted, refused]) {
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    }
    expect(refused.status).toBe(401);
  });

  // So the Panel can say whether the channel is Watched.
  test("the Streamer can see whether a token exists, but never the token", async () => {
    const t = setup();
    const asOwner = await signInAsOwner(t);
    expect(await asOwner.query(api.watcher.hasToken, {})).toBe(false);

    await asOwner.action(api.watcher.createToken, {});
    expect(await asOwner.query(api.watcher.hasToken, {})).toBe(true);

    await asOwner.mutation(api.watcher.revokeToken, {});
    expect(await asOwner.query(api.watcher.hasToken, {})).toBe(false);
  });

  test("only the Streamer can create or revoke it", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    await asOwner.mutation(api.mods.add, { login: someMod.login });
    const { asUser: asMod } = await signInWithTwitch(t, someMod);
    vi.unstubAllGlobals();

    const refusal = "Only the Streamer can do this.";
    await expect(asMod.action(api.watcher.createToken, {})).rejects.toThrow(
      refusal,
    );
    await expect(asMod.mutation(api.watcher.revokeToken, {})).rejects.toThrow(
      refusal,
    );
    await expect(t.action(api.watcher.createToken, {})).rejects.toThrow(
      refusal,
    );
    expect((await report(t, token)).status).toBe(200);
  });
});

// Moves the fake clock on, running whatever the scheduler had due by then.
async function passTime(t: T, ms: number) {
  vi.advanceTimersByTime(ms);
  await t.finishInProgressScheduledFunctions();
}

describe("the Watcher's status in the Panel", () => {
  test("a Manual channel shows nothing about the Watcher", async () => {
    const t = setup();
    const asOwner = await signInAsOwner(t);

    expect(await asOwner.query(api.watcher.status, {})).toBeNull();
  });

  test("is Offline once the channel is Watched, until the first report", async () => {
    const t = setup();
    const { asOwner } = await ownerWithToken(t);

    expect(await asOwner.query(api.watcher.status, {})).toEqual({
      online: false,
      since: null,
      characterName: null,
      needsRun: false,
      otherCharacterRunId: null,
    });
  });

  test("is Online from a report, with the character being played", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    const reportedAt = useFutureClock();

    expect((await report(t, token)).status).toBe(200);

    expect(await asOwner.query(api.watcher.status, {})).toEqual({
      online: true,
      since: reportedAt,
      characterName: "Tarnished",
      needsRun: true,
      otherCharacterRunId: null,
    });
  });

  test("Mods see it too", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    await asOwner.mutation(api.mods.add, { login: someMod.login });
    const { asUser: asMod } = await signInWithTwitch(t, someMod);
    vi.unstubAllGlobals();
    await report(t, token);

    expect(await asMod.query(api.watcher.status, {})).toMatchObject({
      online: true,
      characterName: "Tarnished",
    });
  });

  test("goes Offline 90 seconds after the last report", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    const firstAt = useFutureClock();
    await report(t, token);
    vi.setSystemTime(firstAt + 30_000);
    await report(t, token);

    await passTime(t, 119_000 - 30_000);
    const justBefore = await asOwner.query(api.watcher.status, {});
    await passTime(t, 1_000);

    expect(justBefore).toEqual({
      online: true,
      since: firstAt,
      characterName: "Tarnished",
      needsRun: true,
      otherCharacterRunId: null,
    });
    expect(await asOwner.query(api.watcher.status, {})).toEqual({
      online: false,
      since: firstAt + 120_000,
      characterName: "Tarnished",
      needsRun: false,
      otherCharacterRunId: null,
    });
  });

  test("comes back Online at the next report", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    const firstAt = useFutureClock();
    await report(t, token);
    await passTime(t, 100_000);
    vi.setSystemTime(firstAt + 101_000);

    await report(t, token, { ...tarnished, characterName: "Nap", slot: 3 });

    expect(await asOwner.query(api.watcher.status, {})).toEqual({
      online: true,
      since: firstAt + 101_000,
      characterName: "Nap",
      needsRun: true,
      otherCharacterRunId: null,
    });
  });

  test("follows a change of character while Online", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    const firstAt = useFutureClock();
    await report(t, token);
    vi.setSystemTime(firstAt + 10_000);

    await report(t, token, { ...tarnished, characterName: "Nap", slot: 3 });

    expect(await asOwner.query(api.watcher.status, {})).toEqual({
      online: true,
      since: firstAt,
      characterName: "Nap",
      needsRun: true,
      otherCharacterRunId: null,
    });
  });

  test("revoking the token returns the channel to Manual", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    useFutureClock();
    await report(t, token);

    await asOwner.mutation(api.watcher.revokeToken, {});
    await passTime(t, 100_000);

    expect(await asOwner.query(api.watcher.status, {})).toBeNull();
    // A new token starts Offline, not from the old App's reports.
    await asOwner.action(api.watcher.createToken, {});
    expect(await asOwner.query(api.watcher.status, {})).toEqual({
      online: false,
      since: null,
      characterName: null,
      needsRun: false,
      otherCharacterRunId: null,
    });
  });
});

// Every record a Panel query could read, as stored, and the checks waiting
// to take the Watcher Offline.
async function whatAHeartbeatLeavesAlone(t: T) {
  return await t.run(async (ctx) => ({
    channels: await ctx.db.query("channels").collect(),
    watcherTokens: await ctx.db.query("watcherTokens").collect(),
    watcherConnections: await ctx.db.query("watcherConnections").collect(),
    runs: await ctx.db.query("runs").collect(),
    waitingChecks: (await ctx.db.system.query("_scheduled_functions").collect())
      .filter((job) => job.state.kind === "pending")
      .map((job) => job._id),
  }));
}

describe("a new token", () => {
  test("replacing the token starts the Watcher Offline, as the App's token is now refused", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    useFutureClock();
    await report(t, token);

    await asOwner.action(api.watcher.createToken, {});

    expect(await asOwner.query(api.watcher.status, {})).toEqual({
      online: false,
      since: null,
      characterName: null,
      needsRun: false,
      otherCharacterRunId: null,
    });
  });

  test("reporting soon after a revoke leaves one check waiting to take it Offline", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    useFutureClock();
    await report(t, token);
    await asOwner.mutation(api.watcher.revokeToken, {});
    const newToken = await asOwner.action(api.watcher.createToken, {});
    await passTime(t, 10_000);
    await report(t, newToken);

    // Past when the check from before the revoke runs.
    await passTime(t, 81_000);

    expect((await whatAHeartbeatLeavesAlone(t)).waitingChecks).toHaveLength(1);
  });
});

describe("heartbeats", () => {
  test("a heartbeat while Online writes nothing a Panel query reads", async () => {
    const t = setup();
    const { token } = await ownerWithToken(t);
    const firstAt = useFutureClock();
    await report(t, token);
    const before = await whatAHeartbeatLeavesAlone(t);

    vi.setSystemTime(firstAt + 30_000);
    expect((await report(t, token)).status).toBe(200);

    expect(before.watcherConnections).toMatchObject([{ online: true }]);
    expect(before.waitingChecks).toHaveLength(1);
    expect(await whatAHeartbeatLeavesAlone(t)).toEqual(before);
  });

  test("a heartbeat for a character with a Run writes nothing a Panel query reads", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    await asOwner.mutation(api.runs.createRun, { characterName: "Tarnished" });
    const firstAt = useFutureClock();
    await report(t, token);
    const before = await whatAHeartbeatLeavesAlone(t);

    vi.setSystemTime(firstAt + 30_000);
    await report(t, token);

    expect(await whatAHeartbeatLeavesAlone(t)).toEqual(before);
  });
});

type AsUser = Awaited<ReturnType<typeof signInAsOwner>>;

async function activeRunName(asOwner: AsUser) {
  return (await asOwner.query(api.runs.activeRun, {}))?.characterName ?? null;
}

describe("following the character being played", () => {
  test("a report for a character with a Run makes that Run active", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    await asOwner.mutation(api.runs.createRun, { characterName: "Tarnished" });
    await asOwner.mutation(api.runs.createRun, { characterName: "Nap" });

    await report(t, token);

    expect(await activeRunName(asOwner)).toBe("Tarnished");
  });

  test("a Mod switching Runs by hand isn't overruled by the next heartbeat", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    await asOwner.mutation(api.runs.createRun, { characterName: "Tarnished" });
    const napId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Nap",
    });
    const firstAt = useFutureClock();
    await report(t, token);

    await asOwner.mutation(api.runs.setActive, { runId: napId });
    vi.setSystemTime(firstAt + 30_000);
    await report(t, token);

    expect(await activeRunName(asOwner)).toBe("Nap");
  });

  test("changing character in game switches the active Run", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    await asOwner.mutation(api.runs.createRun, { characterName: "Tarnished" });
    const napId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Nap",
    });
    const firstAt = useFutureClock();
    await report(t, token);
    await asOwner.mutation(api.runs.setActive, { runId: napId });
    vi.setSystemTime(firstAt + 10_000);
    await report(t, token, { ...tarnished, slot: 3, characterName: "Nap" });
    await asOwner.mutation(api.runs.createRun, { characterName: "Other" });

    vi.setSystemTime(firstAt + 20_000);
    await report(t, token);

    expect(await activeRunName(asOwner)).toBe("Tarnished");
  });

  test("the game starting again switches the active Run", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    await asOwner.mutation(api.runs.createRun, { characterName: "Tarnished" });
    const napId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Nap",
    });
    const firstAt = useFutureClock();
    await report(t, token);
    await asOwner.mutation(api.runs.setActive, { runId: napId });
    await passTime(t, 100_000);
    vi.setSystemTime(firstAt + 101_000);

    await report(t, token);

    expect(await activeRunName(asOwner)).toBe("Tarnished");
  });

  test("an archived Run isn't switched to", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    const tarnishedId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Tarnished",
    });
    await asOwner.mutation(api.runs.archive, { runId: tarnishedId });
    await asOwner.mutation(api.runs.createRun, { characterName: "Nap" });

    await report(t, token);

    expect(await activeRunName(asOwner)).toBe("Nap");
  });

  test("the first slot seen is bound to the Run, so a character of the same name in another slot isn't followed", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    await asOwner.mutation(api.runs.createRun, { characterName: "Tarnished" });
    const napId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Nap",
    });
    const firstAt = useFutureClock();
    await report(t, token);
    await asOwner.mutation(api.runs.setActive, { runId: napId });
    vi.setSystemTime(firstAt + 10_000);

    await report(t, token, { ...tarnished, slot: 5 });

    expect(await activeRunName(asOwner)).toBe("Nap");
  });

  test("a Run's slot is bound only by a report for it", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    await asOwner.mutation(api.runs.createRun, { characterName: "Tarnished" });
    const firstAt = useFutureClock();
    await report(t, token, { ...tarnished, slot: 2, characterName: "Nap" });
    await asOwner.mutation(api.runs.createRun, { characterName: "Nap" });
    vi.setSystemTime(firstAt + 10_000);
    await report(t, token, { ...tarnished, slot: 2, characterName: "Nap" });
    await asOwner.mutation(api.runs.createRun, { characterName: "Other" });

    vi.setSystemTime(firstAt + 20_000);
    await report(t, token, { ...tarnished, slot: 4 });

    expect(await activeRunName(asOwner)).toBe("Tarnished");
  });

  test("the switch is a Change by Watcher in History, which a Mod can undo", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    const tarnishedId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Tarnished",
    });
    await asOwner.mutation(api.runs.createRun, { characterName: "Nap" });
    await asOwner.mutation(api.mods.add, { login: someMod.login });
    const { asUser: asMod } = await signInWithTwitch(t, someMod);
    vi.unstubAllGlobals();
    // No Deaths to top up, so the switch is the only Change.
    await report(t, token, { ...tarnished, total: 0 });

    const [switched] = await asMod.query(api.changes.history, {
      runId: tarnishedId,
    });
    await asMod.mutation(api.changes.undo, { changeId: switched!._id });

    expect(switched).toMatchObject({
      actorName: "Watcher",
      description: "Switched to Tarnished",
      undone: false,
      blockedBy: null,
      refusal: null,
    });
    expect(await activeRunName(asOwner)).toBe("Nap");
  });

  test("an unknown character is offered as a Run to create, and nothing is switched", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    await asOwner.mutation(api.runs.createRun, { characterName: "Nap" });

    await report(t, token);

    expect(await asOwner.query(api.watcher.status, {})).toMatchObject({
      characterName: "Tarnished",
      needsRun: true,
    });
    expect(await activeRunName(asOwner)).toBe("Nap");
  });

  test("creating the offered Run starts matching on the next report", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    const firstAt = useFutureClock();
    await report(t, token);

    await asOwner.mutation(api.runs.createRun, { characterName: "Tarnished" });
    const offeredAfter = await asOwner.query(api.watcher.status, {});
    vi.setSystemTime(firstAt + 10_000);
    await report(t, token);
    await asOwner.mutation(api.runs.createRun, { characterName: "Nap" });
    vi.setSystemTime(firstAt + 20_000);
    await report(t, token, { ...tarnished, slot: 5 });
    const afterAnotherSlot = await activeRunName(asOwner);
    vi.setSystemTime(firstAt + 30_000);
    await report(t, token);

    expect(offeredAfter).toMatchObject({ needsRun: false });
    // The next report bound slot 0, so only that slot is followed.
    expect(afterAnotherSlot).toBe("Nap");
    expect(await activeRunName(asOwner)).toBe("Tarnished");
  });

  test("nothing is offered while the Watcher is Offline", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    useFutureClock();
    await report(t, token);

    await passTime(t, 100_000);

    expect(await asOwner.query(api.watcher.status, {})).toMatchObject({
      online: false,
      needsRun: false,
    });
  });

  test("a name is matched as a Run's name is kept, without surrounding spaces", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    await asOwner.mutation(api.runs.createRun, { characterName: "Tarnished" });
    await asOwner.mutation(api.runs.createRun, { characterName: "Nap" });

    await report(t, token, { ...tarnished, characterName: " Tarnished " });

    expect(await activeRunName(asOwner)).toBe("Tarnished");
    expect(await asOwner.query(api.watcher.status, {})).toMatchObject({
      characterName: "Tarnished",
      needsRun: false,
    });
  });
});

const MARGIT_ID = "10000850";
const MARGIT = "Margit, the Fell Omen — Stormveil Castle (Stormveil Castle)";

// Each Encounter of the Run with its Deaths, by name.
async function deathsByEncounter(asUser: AsUser, runId: Id<"runs">) {
  const run = await asUser.query(api.runs.run, { runId });
  return Object.fromEntries(
    run!.encounters.map(({ name, deathCount }) => [name, deathCount]),
  );
}

// A Run for Tarnished, caught up to the save's 10 by a first report, with
// Margit current and the Stream started.
async function caughtUpRun(t: T) {
  const { asOwner, token } = await ownerWithToken(t);
  const runId = await asOwner.mutation(api.runs.createRun, {
    characterName: "Tarnished",
  });
  const firstAt = useFutureClock();
  await report(t, token);
  const margitId = await asOwner.mutation(api.encounters.addBoss, {
    runId,
    bossId: MARGIT_ID,
  });
  await asOwner.mutation(api.encounters.setCurrent, {
    runId,
    encounterId: margitId,
  });
  await asOwner.mutation(api.streams.start, {});
  return { asOwner, token, runId, firstAt };
}

describe("Deaths topped up to the Save Total", () => {
  test("a rise in the Save Total while Online adds that many Deaths to the Current Encounter, as one Change by Watcher", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    const historyBefore = await asOwner.query(api.changes.history, { runId });

    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, { ...tarnished, total: 12 });

    expect(await deathsByEncounter(asOwner, runId)).toMatchObject({
      Overworld: 10,
      [MARGIT]: 2,
    });
    const history = await asOwner.query(api.changes.history, { runId });
    expect(history).toHaveLength(historyBefore.length + 1);
    expect(history[0]).toMatchObject({ actorName: "Watcher", undone: false });
    expect(await asOwner.query(api.streams.current, {})).toMatchObject({
      deaths: 2,
    });
  });

  test("a Mod pressing Death before the Save Total rises by one leaves one Death", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);

    vi.setSystemTime(firstAt + 20_000);
    await asOwner.mutation(api.deaths.record, { runId });
    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, { ...tarnished, total: 11 });

    expect(await deathsByEncounter(asOwner, runId)).toMatchObject({
      Overworld: 10,
      [MARGIT]: 1,
    });
  });

  test("a Mod pressing Death within the Cooldown of the Watcher's Death is refused", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, { ...tarnished, total: 11 });

    vi.setSystemTime(firstAt + 32_000);
    await expect(asOwner.mutation(api.deaths.record, { runId })).rejects.toThrow(
      "A Death was just recorded",
    );
    vi.setSystemTime(firstAt + 36_000);
    await asOwner.mutation(api.deaths.record, { runId });

    expect(await deathsByEncounter(asOwner, runId)).toMatchObject({
      [MARGIT]: 2,
    });
  });

  test("the Watcher isn't refused within the Cooldown of a Mod's Death", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    vi.setSystemTime(firstAt + 29_000);
    await asOwner.mutation(api.deaths.record, { runId });

    vi.setSystemTime(firstAt + 30_000);
    expect((await report(t, token, { ...tarnished, total: 12 })).status).toBe(
      200,
    );

    expect(await deathsByEncounter(asOwner, runId)).toMatchObject({
      [MARGIT]: 2,
    });
  });

  test("a first report for a character whose save already has Deaths puts them in Overworld, outside the Stream's counts", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    const runId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Tarnished",
    });
    await asOwner.mutation(api.streams.start, {});

    await report(t, token);

    expect(await deathsByEncounter(asOwner, runId)).toEqual({ Overworld: 10 });
    expect(await asOwner.query(api.streams.current, {})).toMatchObject({
      deaths: 0,
    });
    const [added] = await asOwner.query(api.changes.history, { runId });
    expect(added).toMatchObject({
      actorName: "Watcher",
      description: "Added 10 Deaths",
    });
    // Deaths from before don't start the Cooldown.
    await asOwner.mutation(api.deaths.record, { runId });
  });

  test("a catch-up larger than one report may add stays a catch-up to the end", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    const runId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Tarnished",
    });
    await asOwner.mutation(api.streams.start, {});
    const firstAt = useFutureClock();
    await report(t, token, { ...tarnished, total: 5003 });

    await passTime(t, 1_000);
    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, { ...tarnished, total: 5003 });

    expect(await deathsByEncounter(asOwner, runId)).toEqual({
      Overworld: 5003,
    });
    expect(await asOwner.query(api.streams.current, {})).toMatchObject({
      deaths: 0,
    });
  });

  test("the first report for a Run created while Online is a catch-up", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    await asOwner.mutation(api.streams.start, {});
    const firstAt = useFutureClock();
    await report(t, token);

    const runId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Tarnished",
    });
    vi.setSystemTime(firstAt + 30_000);
    await report(t, token);

    expect(await deathsByEncounter(asOwner, runId)).toEqual({ Overworld: 10 });
    expect(await asOwner.query(api.streams.current, {})).toMatchObject({
      deaths: 0,
    });
  });

  test("the first report after being Offline is a catch-up", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    await passTime(t, 100_000);

    vi.setSystemTime(firstAt + 101_000);
    await report(t, token, { ...tarnished, total: 13 });

    expect(await deathsByEncounter(asOwner, runId)).toMatchObject({
      Overworld: 13,
      [MARGIT]: 0,
    });
    expect(await asOwner.query(api.streams.current, {})).toMatchObject({
      deaths: 0,
    });
  });

  test("the first report after changing character is a catch-up for that character", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    vi.setSystemTime(firstAt + 10_000);
    await report(t, token, { ...tarnished, slot: 3, characterName: "Nap" });

    vi.setSystemTime(firstAt + 20_000);
    await report(t, token, { ...tarnished, total: 13 });

    expect(await deathsByEncounter(asOwner, runId)).toMatchObject({
      Overworld: 13,
      [MARGIT]: 0,
    });
  });

  test.each([
    ["at", 10],
    ["below", 7],
  ])("a Save Total %s the Run's Deaths creates nothing", async (_, total) => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    const historyBefore = await asOwner.query(api.changes.history, { runId });

    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, { ...tarnished, total });

    expect(await deathsByEncounter(asOwner, runId)).toMatchObject({
      Overworld: 10,
      [MARGIT]: 0,
    });
    expect(await asOwner.query(api.changes.history, { runId })).toEqual(
      historyBefore,
    );
  });

  test("the Watcher's Deaths are one Change a Mod can undo", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, { ...tarnished, total: 12 });

    const [added] = await asOwner.query(api.changes.history, { runId });
    await asOwner.mutation(api.changes.undo, { changeId: added!._id });

    expect(await deathsByEncounter(asOwner, runId)).toMatchObject({
      Overworld: 10,
      [MARGIT]: 0,
    });
  });
});

// What the Panel shows of the Run's Mismatch.
async function shownMismatch(asUser: AsUser, runId: Id<"runs">) {
  return (await asUser.query(api.runs.run, { runId }))!.mismatch;
}

describe("a Mismatch", () => {
  test("a Mod pressing Death beyond the Save Total shows 1 more than the save, until the save catches up", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    expect(await shownMismatch(asOwner, runId)).toBeNull();

    vi.setSystemTime(firstAt + 20_000);
    await asOwner.mutation(api.deaths.record, { runId });
    vi.setSystemTime(firstAt + 30_000);
    await report(t, token);

    expect(await shownMismatch(asOwner, runId)).toBe(1);
    expect(await asOwner.query(api.runs.activeRun, {})).toMatchObject({
      mismatch: 1,
    });

    vi.setSystemTime(firstAt + 60_000);
    await report(t, token, { ...tarnished, total: 11 });

    expect(await shownMismatch(asOwner, runId)).toBeNull();
  });

  test("a Save Total that drops, as from a restored backup, shows a Mismatch and removes no Deaths", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);

    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, { ...tarnished, total: 7 });

    expect(await deathsByEncounter(asOwner, runId)).toMatchObject({
      Overworld: 10,
    });
    expect(await shownMismatch(asOwner, runId)).toBe(3);
  });

  test("removing Deaths clears it, as a Change that can be undone", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, { ...tarnished, total: 8 });

    const { page } = await asOwner.query(api.runs.deathFeed, {
      paginationOpts: { numItems: 2, cursor: null },
    });
    for (const death of page) {
      await asOwner.mutation(api.deaths.remove, { deathId: death._id });
    }

    expect(await shownMismatch(asOwner, runId)).toBeNull();
    const [removed] = await asOwner.query(api.changes.history, { runId });
    await asOwner.mutation(api.changes.undo, { changeId: removed!._id });
    expect(await shownMismatch(asOwner, runId)).toBe(1);
  });

  test("a Manual channel shows none", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, { ...tarnished, total: 7 });

    await asOwner.mutation(api.watcher.revokeToken, {});

    expect(await shownMismatch(asOwner, runId)).toBeNull();
  });

  test("a Run the Watcher hasn't reported for shows none", async () => {
    const t = setup();
    const { asOwner } = await ownerWithToken(t);
    const runId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Tarnished",
    });
    await asOwner.mutation(api.deaths.record, { runId });

    expect(await shownMismatch(asOwner, runId)).toBeNull();
  });

  test("a new token shows none until the Watcher reports with it", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, { ...tarnished, total: 7 });

    await asOwner.mutation(api.watcher.revokeToken, {});
    const newToken = await asOwner.action(api.watcher.createToken, {});
    expect(await shownMismatch(asOwner, runId)).toBeNull();

    vi.setSystemTime(firstAt + 60_000);
    await report(t, newToken, { ...tarnished, total: 7 });
    expect(await shownMismatch(asOwner, runId)).toBe(3);
  });

  test("an archived Run shows none, as it can't be cleared", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, { ...tarnished, total: 7 });

    await asOwner.mutation(api.runs.archive, { runId });

    expect(await shownMismatch(asOwner, runId)).toBeNull();
  });

  test("a catch-up still going stops at a Save Total that drops, so the Watcher makes no Mismatch", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    const runId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Tarnished",
    });
    const firstAt = useFutureClock();
    await report(t, token, { ...tarnished, total: 5003 });
    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, { ...tarnished, total: 5000 });

    await passTime(t, 1_000);

    expect(await deathsByEncounter(asOwner, runId)).toEqual({
      Overworld: 5000,
    });
    expect(await shownMismatch(asOwner, runId)).toBeNull();
  });
});


const MARGIT_FLAG = Number(MARGIT_ID);
const GODRICK = "Godrick the Grafted — Stormveil Castle (Stormveil Castle)";
const GODRICK_FLAG = 10000800;
const RADAGON_AND_THE_ELDEN_BEAST =
  "Radagon of the Golden Order & Elden Beast — Fractured Marika (Leyndell, Ashen Capital)";
const RADAGON_AND_THE_ELDEN_BEAST_FLAG = 19000800;

// Whether each Encounter of the Run is Defeated, by name.
async function defeatedByEncounter(asUser: AsUser, runId: Id<"runs">) {
  const run = await asUser.query(api.runs.run, { runId });
  return Object.fromEntries(
    run!.encounters.map(({ name, defeated }) => [name, defeated]),
  );
}

describe("Defeated from the save", () => {
  test("a newly set flag marks the boss Defeated, as a Change by Watcher", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);

    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, { ...tarnished, defeatFlags: [MARGIT_FLAG] });

    expect(await defeatedByEncounter(asOwner, runId)).toMatchObject({
      [MARGIT]: true,
    });
    const [marked] = await asOwner.query(api.changes.history, { runId });
    expect(marked).toMatchObject({
      actorName: "Watcher",
      description: `Marked ${MARGIT} Defeated`,
    });
  });

  test("a flag for a boss not in the Run adds the boss last and marks it, shown on the Overlay like any other", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);

    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, { ...tarnished, defeatFlags: [GODRICK_FLAG] });

    const run = await asOwner.query(api.runs.run, { runId });
    expect(
      run!.encounters.map(({ name, defeated }) => [name, defeated]),
    ).toEqual([
      ["Overworld", false],
      [MARGIT, false],
      [GODRICK, true],
    ]);
    expect(await t.query(api.overlay.current, {})).toMatchObject({
      defeated: [{ name: "Godrick the Grafted" }],
    });
  });

  test("Radagon and the Elden Beast's flag marks their one boss Defeated", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);

    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, {
      ...tarnished,
      defeatFlags: [RADAGON_AND_THE_ELDEN_BEAST_FLAG],
    });

    expect(await defeatedByEncounter(asOwner, runId)).toMatchObject({
      [RADAGON_AND_THE_ELDEN_BEAST]: true,
    });
  });

  test("a first report brings in every boss already beaten as one Change, which one undo takes back, and none count as felled this Stream", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    const runId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Tarnished",
    });
    await asOwner.mutation(api.streams.start, {});
    useFutureClock();

    await report(t, token, {
      ...tarnished,
      defeatFlags: [MARGIT_FLAG, GODRICK_FLAG],
    });

    expect(await defeatedByEncounter(asOwner, runId)).toEqual({
      Overworld: false,
      [MARGIT]: true,
      [GODRICK]: true,
    });
    expect(await t.query(api.overlay.current, {})).toMatchObject({
      streamFelled: 0,
    });
    const [marked] = await asOwner.query(api.changes.history, { runId });
    expect(marked).toMatchObject({
      actorName: "Watcher",
      description: `Marked ${MARGIT} and ${GODRICK} Defeated`,
    });
    await asOwner.mutation(api.changes.undo, { changeId: marked!._id });
    expect(await defeatedByEncounter(asOwner, runId)).toEqual({
      Overworld: false,
    });
  });

  test("a kill while Online counts as felled this Stream", async () => {
    const t = setup();
    const { token, firstAt } = await caughtUpRun(t);

    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, { ...tarnished, defeatFlags: [MARGIT_FLAG] });

    expect(await t.query(api.overlay.current, {})).toMatchObject({
      streamFelled: 1,
    });
  });

  test("a kill made while the Watcher was Offline is marked, but not counted as felled this Stream", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    await passTime(t, 100_000);

    vi.setSystemTime(firstAt + 101_000);
    await report(t, token, { ...tarnished, defeatFlags: [MARGIT_FLAG] });

    expect(await defeatedByEncounter(asOwner, runId)).toMatchObject({
      [MARGIT]: true,
    });
    expect(await t.query(api.overlay.current, {})).toMatchObject({
      streamFelled: 0,
    });
  });

  test("a Defeated a Mod undid isn't marked again by the next report", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, { ...tarnished, defeatFlags: [MARGIT_FLAG] });
    const [marked] = await asOwner.query(api.changes.history, { runId });
    await asOwner.mutation(api.changes.undo, { changeId: marked!._id });

    vi.setSystemTime(firstAt + 60_000);
    await report(t, token, { ...tarnished, defeatFlags: [MARGIT_FLAG] });

    expect(await defeatedByEncounter(asOwner, runId)).toMatchObject({
      [MARGIT]: false,
    });
  });

  test("a boss a Mod marked before the Watcher stays as the Mod marked it", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    const margitId = (await asOwner.query(api.runs.run, { runId }))!
      .currentEncounterId;
    await asOwner.mutation(api.encounters.markDefeated, {
      encounterId: margitId,
    });
    const historyBefore = await asOwner.query(api.changes.history, { runId });

    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, { ...tarnished, defeatFlags: [MARGIT_FLAG] });

    expect(await defeatedByEncounter(asOwner, runId)).toMatchObject({
      [MARGIT]: true,
    });
    expect(await asOwner.query(api.changes.history, { runId })).toEqual(
      historyBefore,
    );
    expect(await t.query(api.overlay.current, {})).toMatchObject({
      streamFelled: 1,
    });
  });

  test("a kill of the Current Encounter sends it back to Overworld", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);

    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, { ...tarnished, defeatFlags: [MARGIT_FLAG] });

    const run = (await asOwner.query(api.runs.run, { runId }))!;
    expect(
      run.encounters.find(({ _id }) => _id === run.currentEncounterId)?.name,
    ).toBe("Overworld");
  });

  test("a heartbeat with the same flags writes nothing a Panel query reads", async () => {
    const t = setup();
    const { token, firstAt } = await caughtUpRun(t);
    const beaten = { ...tarnished, defeatFlags: [MARGIT_FLAG, GODRICK_FLAG] };
    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, beaten);
    const before = await whatAHeartbeatLeavesAlone(t);

    vi.setSystemTime(firstAt + 60_000);
    await report(t, token, {
      ...beaten,
      defeatFlags: [GODRICK_FLAG, MARGIT_FLAG],
    });

    expect(await whatAHeartbeatLeavesAlone(t)).toEqual(before);
  });

  test("a first report for a character who has beaten every boss brings them all in, in the order the save lists them", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    const runId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Tarnished",
    });

    await report(t, token, {
      ...tarnished,
      defeatFlags: bosses.map(({ flag }) => flag),
    });

    const run = (await asOwner.query(api.runs.run, { runId }))!;
    expect(
      run.encounters.slice(1).map(({ name, defeated }) => [name, defeated]),
    ).toEqual(bosses.map(({ displayName }) => [displayName, true]));
  });

  test("a Defeated a Mod undid isn't marked again when a restored backup unsets the flag and it's set again", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, { ...tarnished, defeatFlags: [MARGIT_FLAG] });
    const [marked] = await asOwner.query(api.changes.history, { runId });
    await asOwner.mutation(api.changes.undo, { changeId: marked!._id });

    vi.setSystemTime(firstAt + 60_000);
    await report(t, token, { ...tarnished, defeatFlags: [] });
    vi.setSystemTime(firstAt + 90_000);
    await report(t, token, { ...tarnished, defeatFlags: [MARGIT_FLAG] });

    expect(await defeatedByEncounter(asOwner, runId)).toMatchObject({
      [MARGIT]: false,
    });
  });
});


describe("two characters with the same name", () => {
  test("a same-named character in another slot shows as another character named the same, and changes nothing in the Run", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    const runId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Tarnished",
    });
    const napId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Nap",
    });
    const firstAt = useFutureClock();
    await report(t, token);
    await asOwner.mutation(api.runs.setActive, { runId: napId });
    const runBefore = await asOwner.query(api.runs.run, { runId });
    const historyBefore = await asOwner.query(api.changes.history, { runId });

    vi.setSystemTime(firstAt + 10_000);
    await report(t, token, {
      ...tarnished,
      slot: 5,
      total: 50,
      defeatFlags: [MARGIT_FLAG],
    });

    expect(await asOwner.query(api.watcher.status, {})).toMatchObject({
      characterName: "Tarnished",
      needsRun: false,
      otherCharacterRunId: runId,
    });
    expect(await asOwner.query(api.runs.run, { runId })).toEqual(runBefore);
    expect(await asOwner.query(api.changes.history, { runId })).toEqual(
      historyBefore,
    );
    expect(await activeRunName(asOwner)).toBe("Nap");
  });

  test("a Mod can rebind the Run to that slot, and reports from the old slot are then the other character", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    await asOwner.mutation(api.mods.add, { login: someMod.login });
    const { asUser: asMod } = await signInWithTwitch(t, someMod);
    vi.unstubAllGlobals();
    vi.setSystemTime(firstAt + 10_000);
    await report(t, token, { ...tarnished, slot: 5 });

    await asMod.mutation(api.watcher.rebind, { runId });

    expect(await asOwner.query(api.watcher.status, {})).toMatchObject({
      otherCharacterRunId: null,
    });
    vi.setSystemTime(firstAt + 20_000);
    await report(t, token, { ...tarnished, total: 99 });
    expect(await asOwner.query(api.watcher.status, {})).toMatchObject({
      otherCharacterRunId: runId,
    });
    expect(await deathsByEncounter(asOwner, runId)).toEqual({
      Overworld: 10,
      [MARGIT]: 0,
    });
  });

  test("after rebinding, the next report brings in that slot's beaten bosses as a first report", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    vi.setSystemTime(firstAt + 10_000);
    await report(t, token, { ...tarnished, defeatFlags: [MARGIT_FLAG] });
    const [marked] = await asOwner.query(api.changes.history, { runId });
    await asOwner.mutation(api.changes.undo, { changeId: marked!._id });
    vi.setSystemTime(firstAt + 20_000);
    await report(t, token, {
      ...tarnished,
      slot: 5,
      defeatFlags: [MARGIT_FLAG, GODRICK_FLAG],
    });

    await asOwner.mutation(api.watcher.rebind, { runId });
    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, {
      ...tarnished,
      slot: 5,
      defeatFlags: [MARGIT_FLAG, GODRICK_FLAG],
    });

    expect(await defeatedByEncounter(asOwner, runId)).toEqual({
      Overworld: false,
      [MARGIT]: true,
      [GODRICK]: true,
    });
    expect(await t.query(api.overlay.current, {})).toMatchObject({
      streamFelled: 0,
    });
  });

  test("rebinding removes no Deaths, and a lower Save Total in the new slot shows as a Mismatch", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    vi.setSystemTime(firstAt + 10_000);
    await report(t, token, { ...tarnished, slot: 5, total: 4 });

    await asOwner.mutation(api.watcher.rebind, { runId });
    vi.setSystemTime(firstAt + 20_000);
    await report(t, token, { ...tarnished, slot: 5, total: 4 });

    expect(await deathsByEncounter(asOwner, runId)).toEqual({
      Overworld: 10,
      [MARGIT]: 0,
    });
    expect(await shownMismatch(asOwner, runId)).toBe(6);
  });

  test("a higher Save Total in the new slot is caught up in Overworld, as on a first report", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    vi.setSystemTime(firstAt + 10_000);
    await report(t, token, { ...tarnished, slot: 5, total: 25 });

    await asOwner.mutation(api.watcher.rebind, { runId });
    vi.setSystemTime(firstAt + 20_000);
    await report(t, token, { ...tarnished, slot: 5, total: 25 });

    expect(await deathsByEncounter(asOwner, runId)).toEqual({
      Overworld: 25,
      [MARGIT]: 0,
    });
  });

  test("a Run can only be rebound to a character of its name being played", async () => {
    const t = setup();
    const { asOwner, token, firstAt } = await caughtUpRun(t);
    const napId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Nap",
    });
    vi.setSystemTime(firstAt + 10_000);
    await report(t, token, { ...tarnished, slot: 5 });

    await expect(
      asOwner.mutation(api.watcher.rebind, { runId: napId }),
    ).rejects.toThrow("Nap isn't another character's Run to follow.");
  });

  test("a Run already following the character being played can't be rebound, so its remembered Defeat Flags stay", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    vi.setSystemTime(firstAt + 10_000);
    await report(t, token, { ...tarnished, defeatFlags: [MARGIT_FLAG] });
    const [marked] = await asOwner.query(api.changes.history, { runId });
    await asOwner.mutation(api.changes.undo, { changeId: marked!._id });

    await expect(
      asOwner.mutation(api.watcher.rebind, { runId }),
    ).rejects.toThrow("Tarnished isn't another character's Run to follow.");
    vi.setSystemTime(firstAt + 20_000);
    await report(t, token, { ...tarnished, defeatFlags: [MARGIT_FLAG] });

    expect(await defeatedByEncounter(asOwner, runId)).toMatchObject({
      [MARGIT]: false,
    });
  });

  test("rebinding makes the Run active, as a Change in History", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    const napId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Nap",
    });
    await asOwner.mutation(api.runs.setActive, { runId: napId });
    await asOwner.mutation(api.mods.add, { login: someMod.login });
    const { asUser: asMod } = await signInWithTwitch(t, someMod);
    vi.unstubAllGlobals();
    vi.setSystemTime(firstAt + 10_000);
    await report(t, token, { ...tarnished, slot: 5 });

    await asMod.mutation(api.watcher.rebind, { runId });

    expect(await activeRunName(asOwner)).toBe("Tarnished");
    const [rebound] = await asOwner.query(api.changes.history, { runId });
    expect(rebound).toMatchObject({
      actorName: "SomeMod",
      description: "Rebound Tarnished's Run to another Tarnished",
      undone: false,
      blockedBy: null,
      refusal: null,
    });
  });

  test("undoing a rebind follows the old character again, with its Defeat Flags and Save Total, and switches back", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    vi.setSystemTime(firstAt + 10_000);
    await report(t, token, { ...tarnished, defeatFlags: [MARGIT_FLAG] });
    const [marked] = await asOwner.query(api.changes.history, { runId });
    await asOwner.mutation(api.changes.undo, { changeId: marked!._id });
    const napId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Nap",
    });
    await asOwner.mutation(api.runs.setActive, { runId: napId });
    vi.setSystemTime(firstAt + 20_000);
    await report(t, token, { ...tarnished, slot: 5, total: 4 });
    await asOwner.mutation(api.watcher.rebind, { runId });
    const [rebound] = await asOwner.query(api.changes.history, { runId });

    await asOwner.mutation(api.changes.undo, { changeId: rebound!._id });

    expect(await activeRunName(asOwner)).toBe("Nap");
    expect(await asOwner.query(api.watcher.status, {})).toMatchObject({
      otherCharacterRunId: runId,
    });
    expect(await shownMismatch(asOwner, runId)).toBeNull();
    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, { ...tarnished, defeatFlags: [MARGIT_FLAG] });
    expect(await defeatedByEncounter(asOwner, runId)).toMatchObject({
      [MARGIT]: false,
    });
    expect(await deathsByEncounter(asOwner, runId)).toEqual({
      Overworld: 10,
      [MARGIT]: 0,
    });
  });

  test("a rebind can't be undone while another Run of the name follows the old character", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    vi.setSystemTime(firstAt + 10_000);
    await report(t, token, { ...tarnished, slot: 5 });
    await asOwner.mutation(api.watcher.rebind, { runId });
    const [rebound] = await asOwner.query(api.changes.history, { runId });
    await asOwner.mutation(api.runs.createRun, { characterName: "Tarnished" });
    vi.setSystemTime(firstAt + 20_000);
    await report(t, token);

    await expect(
      asOwner.mutation(api.changes.undo, { changeId: rebound!._id }),
    ).rejects.toThrow("Another Tarnished Run follows that character since.");
  });

  test("redoing a rebind gives back the Defeat Flags remembered for the new character, so a Defeated a Mod undid stays undone", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    vi.setSystemTime(firstAt + 10_000);
    await report(t, token, { ...tarnished, slot: 5 });
    await asOwner.mutation(api.watcher.rebind, { runId });
    const [rebound] = await asOwner.query(api.changes.history, { runId });
    vi.setSystemTime(firstAt + 20_000);
    await report(t, token, { ...tarnished, slot: 5, defeatFlags: [MARGIT_FLAG] });
    const [marked] = await asOwner.query(api.changes.history, { runId });
    await asOwner.mutation(api.changes.undo, { changeId: marked!._id });
    const undo = await asOwner.mutation(api.changes.undo, {
      changeId: rebound!._id,
    });

    await asOwner.mutation(api.changes.undo, { changeId: undo! });
    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, { ...tarnished, slot: 5, defeatFlags: [MARGIT_FLAG] });

    expect(await defeatedByEncounter(asOwner, runId)).toMatchObject({
      [MARGIT]: false,
    });
  });

  test("a rebind can still be undone once the active Run has changed, leaving the active Run as it is", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    const napId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Nap",
    });
    vi.setSystemTime(firstAt + 10_000);
    await report(t, token, { ...tarnished, slot: 5 });
    await asOwner.mutation(api.watcher.rebind, { runId });
    const [rebound] = await asOwner.query(api.changes.history, { runId });
    await asOwner.mutation(api.runs.setActive, { runId: napId });
    await asOwner.mutation(api.runs.setActive, { runId });
    await asOwner.mutation(api.runs.setActive, { runId: napId });

    expect(
      (await asOwner.query(api.changes.history, { runId })).find(
        ({ _id }) => _id === rebound!._id,
      ),
    ).toMatchObject({ blockedBy: null, refusal: null });
    await asOwner.mutation(api.changes.undo, { changeId: rebound!._id });

    expect(await activeRunName(asOwner)).toBe("Nap");
    expect(await asOwner.query(api.watcher.status, {})).toMatchObject({
      otherCharacterRunId: runId,
    });
  });

  test("undoing a rebind after a new token brings back no Mismatch from the old token's reports", async () => {
    const t = setup();
    const { asOwner, token, runId, firstAt } = await caughtUpRun(t);
    vi.setSystemTime(firstAt + 10_000);
    await report(t, token, { ...tarnished, slot: 5 });
    await asOwner.mutation(api.watcher.rebind, { runId });
    const [rebound] = await asOwner.query(api.changes.history, { runId });
    await asOwner.mutation(api.deaths.record, { runId });
    await asOwner.action(api.watcher.createToken, {});

    await asOwner.mutation(api.changes.undo, { changeId: rebound!._id });

    expect(await shownMismatch(asOwner, runId)).toBeNull();
  });
});

describe("the Play Time", () => {
  // 52:07:31, as the save last recorded it.
  const played = { ...tarnished, playTime: { seconds: 187_651, running: false } };

  async function shownPlayTime(t: T) {
    return (await t.query(api.overlay.current, {}))?.playTime;
  }

  test("a report without it stores none, so the Overlay shows none", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    await asOwner.mutation(api.runs.createRun, { characterName: "Tarnished" });

    await report(t, token);

    expect(await shownPlayTime(t)).toBeNull();
  });

  test("a report with it shows on the Overlay, with when the backend received it", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    await asOwner.mutation(api.runs.createRun, { characterName: "Tarnished" });
    const firstAt = useFutureClock();

    await report(t, token, played);

    expect(await shownPlayTime(t)).toEqual({
      seconds: 187_651,
      running: false,
      receivedAt: firstAt,
      lastSeenAt: null,
    });
  });

  test("a Play Time counted on from a save can be a fraction of a second", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    await asOwner.mutation(api.runs.createRun, { characterName: "Tarnished" });

    const response = await report(t, token, {
      ...played,
      playTime: { seconds: 187_651.25, running: true },
    });

    expect(response.status).toBe(200);
    expect(await shownPlayTime(t)).toMatchObject({ seconds: 187_651.25 });
  });

  describe("while it's running", () => {
    const counting = {
      ...tarnished,
      playTime: { seconds: 187_651, running: true },
    };
    const countedOn = (seconds: number) => ({
      ...counting,
      playTime: { seconds: 187_651 + seconds, running: true },
    });

    test("it shows with when the Watcher was last seen, so the Overlay stops if it goes quiet", async () => {
      const t = setup();
      const { asOwner, token } = await ownerWithToken(t);
      await asOwner.mutation(api.runs.createRun, {
        characterName: "Tarnished",
      });
      const firstAt = useFutureClock();
      await report(t, token, counting);

      vi.setSystemTime(firstAt + 30_000);
      await report(t, token, countedOn(30));

      expect(await shownPlayTime(t)).toEqual({
        seconds: 187_651,
        running: true,
        receivedAt: firstAt,
        lastSeenAt: firstAt + 30_000,
      });
    });

    test("a heartbeat that agrees with it writes nothing a Panel query reads", async () => {
      const t = setup();
      const { asOwner, token } = await ownerWithToken(t);
      await asOwner.mutation(api.runs.createRun, {
        characterName: "Tarnished",
      });
      const firstAt = useFutureClock();
      await report(t, token, counting);
      const before = await whatAHeartbeatLeavesAlone(t);

      // A little late, as over the network.
      vi.setSystemTime(firstAt + 31_500);
      await report(t, token, countedOn(30));

      expect(await whatAHeartbeatLeavesAlone(t)).toEqual(before);
    });

    test("a report more than 2 seconds off from it replaces it, as after a save", async () => {
      const t = setup();
      const { asOwner, token } = await ownerWithToken(t);
      await asOwner.mutation(api.runs.createRun, {
        characterName: "Tarnished",
      });
      const firstAt = useFutureClock();
      await report(t, token, counting);

      vi.setSystemTime(firstAt + 10_000);
      await report(t, token, countedOn(13));

      expect(await shownPlayTime(t)).toMatchObject({
        seconds: 187_664,
        receivedAt: firstAt + 10_000,
      });
    });
  });

  test("a heartbeat with the same Play Time writes nothing a Panel query reads", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    await asOwner.mutation(api.runs.createRun, { characterName: "Tarnished" });
    const firstAt = useFutureClock();
    await report(t, token, played);
    const before = await whatAHeartbeatLeavesAlone(t);

    vi.setSystemTime(firstAt + 30_000);
    await report(t, token, played);

    expect(await whatAHeartbeatLeavesAlone(t)).toEqual(before);
  });

  test("a later save's Play Time replaces it", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    await asOwner.mutation(api.runs.createRun, { characterName: "Tarnished" });
    const firstAt = useFutureClock();
    await report(t, token, played);

    vi.setSystemTime(firstAt + 60_000);
    await report(t, token, { ...played, playTime: { seconds: 187_711, running: false } });

    expect(await shownPlayTime(t)).toEqual({
      seconds: 187_711,
      running: false,
      receivedAt: firstAt + 60_000,
      lastSeenAt: null,
    });
  });

  test("a report without it, as when it's turned off, clears it from every Run in the channel", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    const tarnishedId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Tarnished",
    });
    await asOwner.mutation(api.runs.createRun, { characterName: "Nap" });
    const firstAt = useFutureClock();
    await report(t, token, played);
    vi.setSystemTime(firstAt + 10_000);
    await report(t, token, { ...played, slot: 1, characterName: "Nap" });

    vi.setSystemTime(firstAt + 20_000);
    await report(t, token, { ...tarnished, slot: 1, characterName: "Nap" });

    expect(await shownPlayTime(t)).toBeNull();
    await asOwner.mutation(api.runs.setActive, { runId: tarnishedId });
    expect(await shownPlayTime(t)).toBeNull();
  });

  test("each Run keeps its own character's", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    const tarnishedId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Tarnished",
    });
    await asOwner.mutation(api.runs.createRun, { characterName: "Nap" });
    const firstAt = useFutureClock();
    await report(t, token, played);

    vi.setSystemTime(firstAt + 10_000);
    await report(t, token, {
      ...tarnished,
      slot: 1,
      characterName: "Nap",
      playTime: { seconds: 60, running: false },
    });

    expect(await shownPlayTime(t)).toMatchObject({ seconds: 60 });
    await asOwner.mutation(api.runs.setActive, { runId: tarnishedId });
    expect(await shownPlayTime(t)).toMatchObject({ seconds: 187_651 });
  });

  test("another character's isn't stored, and after a Rebind the next report sets it", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    const runId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Tarnished",
    });
    const firstAt = useFutureClock();
    await report(t, token, played);
    const other = { ...played, slot: 5, playTime: { seconds: 60, running: false } };

    vi.setSystemTime(firstAt + 10_000);
    await report(t, token, other);
    expect(await shownPlayTime(t)).toMatchObject({ seconds: 187_651 });

    await asOwner.mutation(api.watcher.rebind, { runId });
    vi.setSystemTime(firstAt + 20_000);
    await report(t, token, other);
    expect(await shownPlayTime(t)).toEqual({
      seconds: 60,
      running: false,
      receivedAt: firstAt + 20_000,
      lastSeenAt: null,
    });
  });

  test("revoking the token forgets it, as no report can clear it after", async () => {
    const t = setup();
    const { asOwner, token } = await ownerWithToken(t);
    await asOwner.mutation(api.runs.createRun, { characterName: "Tarnished" });
    await report(t, token, played);

    await asOwner.mutation(api.watcher.revokeToken, {});

    expect(await shownPlayTime(t)).toBeNull();
  });
});
