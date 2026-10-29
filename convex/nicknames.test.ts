import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  owner,
  setup,
  signInWithTwitch,
  stubAuthEnv,
  type T,
} from "./signIn.testing";

beforeEach(() => {
  stubAuthEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const MARGIT = "Margit, the Fell Omen — Stormveil Castle (Stormveil Castle)";

type AsOwner = Awaited<ReturnType<typeof signInWithTwitch>>["asUser"];

// The Streamer and an active Run with Margit added and current.
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
  await asOwner.mutation(api.encounters.setCurrent, {
    runId,
    encounterId: margit,
  });
  return { asOwner, runId, margit };
}

async function overlayNames(t: T) {
  const overlay = (await t.query(api.overlay.current, {}))!;
  return {
    current: overlay.encounter.name,
    list: overlay.encounters.map((e) => e.name),
    defeated: overlay.defeated.map((e) => e.name),
  };
}

function setNickname(
  asOwner: AsOwner,
  runId: Id<"runs">,
  encounterId: Id<"encounters">,
  nickname: string | null,
) {
  return asOwner.mutation(api.encounters.setNickname, {
    runId,
    encounterId,
    nickname,
  });
}

async function history(asOwner: AsOwner) {
  return (await asOwner.query(api.changes.history, {})).map(
    (change) => change.description,
  );
}

async function undoNewest(asOwner: AsOwner) {
  const [newest] = await asOwner.query(api.changes.history, {});
  await asOwner.mutation(api.changes.undo, { changeId: newest!._id });
}

async function nicknames(asOwner: AsOwner) {
  const run = await asOwner.query(api.runs.activeRun, {});
  return run!.encounters.map((e) => e.nickname);
}

describe("Nicknames", () => {
  test("the Overlay shows a boss's Nickname instead of its name everywhere", async () => {
    const t = setup();
    const { asOwner, runId, margit } = await runWithMargit(t);

    await setNickname(asOwner, runId, margit, " red goblin ");
    const current = await overlayNames(t);
    await asOwner.mutation(api.encounters.markDefeated, { encounterId: margit });

    expect(current.current).toBe("red goblin");
    expect(await overlayNames(t)).toEqual({
      current: "Overworld",
      list: ["Overworld", "red goblin"],
      defeated: ["red goblin"],
    });
  });

  test("clearing a Nickname brings back the boss's name on the Overlay", async () => {
    const t = setup();
    const { asOwner, runId, margit } = await runWithMargit(t);
    await setNickname(asOwner, runId, margit, "red goblin");

    await setNickname(asOwner, runId, margit, null);

    expect((await overlayNames(t)).current).toBe("Margit, the Fell Omen");
    expect(await nicknames(asOwner)).toEqual([null, null]);
    expect((await history(asOwner)).slice(0, 2)).toEqual([
      `Cleared ${MARGIT}'s Nickname "red goblin"`,
      `Nicknamed ${MARGIT} "red goblin"`,
    ]);
  });

  test("the Panel's Run carries each Encounter's Nickname", async () => {
    const t = setup();
    const { asOwner, runId, margit } = await runWithMargit(t);

    await setNickname(asOwner, runId, margit, "red goblin");

    expect(await nicknames(asOwner)).toEqual([null, "red goblin"]);
  });

  test("changing a Nickname is one Change, and saving the same one or clearing none records nothing", async () => {
    const t = setup();
    const { asOwner, runId, margit } = await runWithMargit(t);
    await setNickname(asOwner, runId, margit, null);
    await setNickname(asOwner, runId, margit, "watchdog");
    const before = await history(asOwner);

    await setNickname(asOwner, runId, margit, "teleport dog");
    await setNickname(asOwner, runId, margit, " teleport dog");

    expect(await history(asOwner)).toEqual([
      `Nicknamed ${MARGIT} "teleport dog"`,
      ...before,
    ]);
    expect(before[0]).toBe(`Nicknamed ${MARGIT} "watchdog"`);
  });

  test("undoing a Nickname Change brings back the one before, and redoing it the new one", async () => {
    const t = setup();
    const { asOwner, runId, margit } = await runWithMargit(t);
    await setNickname(asOwner, runId, margit, "watchdog");
    await setNickname(asOwner, runId, margit, "teleport dog");

    await undoNewest(asOwner);
    const undone = await nicknames(asOwner);
    await undoNewest(asOwner);

    expect(undone).toEqual([null, "watchdog"]);
    expect(await nicknames(asOwner)).toEqual([null, "teleport dog"]);
    expect((await history(asOwner)).slice(0, 3)).toEqual([
      `Redid: Nicknamed ${MARGIT} "teleport dog"`,
      `Undid: Nicknamed ${MARGIT} "teleport dog"`,
      `Nicknamed ${MARGIT} "teleport dog"`,
    ]);
  });

  test("a Nickname belongs to its Encounter: a boss added again has none, and redoing the first add brings it back", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);
    const godrick = await asOwner.mutation(api.encounters.addBoss, {
      runId,
      bossId: "10000800",
    });
    await setNickname(asOwner, runId, godrick, "grafty");
    const [, add] = await asOwner.query(api.changes.history, {});

    await asOwner.mutation(api.changes.undo, { changeId: add!._id });
    expect(await nicknames(asOwner)).toEqual([null, null]);
    // Redo the add.
    await undoNewest(asOwner);
    expect(await nicknames(asOwner)).toEqual([null, null, "grafty"]);
    await asOwner.mutation(api.changes.undo, { changeId: add!._id });
    await asOwner.mutation(api.encounters.addBoss, { runId, bossId: "10000800" });

    expect(await nicknames(asOwner)).toEqual([null, null, null]);
  });

  test("a Nickname is 1 to 64 characters once trimmed", async () => {
    const t = setup();
    const { asOwner, runId, margit } = await runWithMargit(t);

    await expect(setNickname(asOwner, runId, margit, "  ")).rejects.toThrow(
      "A Nickname needs 1 to 64 characters.",
    );
    await expect(
      setNickname(asOwner, runId, margit, "x".repeat(65)),
    ).rejects.toThrow("A Nickname needs 1 to 64 characters.");
    await setNickname(asOwner, runId, margit, ` ${"x".repeat(64)} `);
    expect(await nicknames(asOwner)).toEqual([null, "x".repeat(64)]);
  });

  test("only a boss can have a Nickname", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);
    const custom = await asOwner.mutation(api.encounters.addCustom, {
      runId,
      name: "Invasion",
    });
    const run = await asOwner.query(api.runs.activeRun, {});
    const overworld = run!.encounters[0]!._id;

    for (const encounterId of [overworld, custom]) {
      await expect(
        setNickname(asOwner, runId, encounterId, "nope"),
      ).rejects.toThrow("Only a boss can have a Nickname.");
    }
  });

  test("an archived Run's Nicknames can't be changed", async () => {
    const t = setup();
    const { asOwner, runId, margit } = await runWithMargit(t);
    await asOwner.mutation(api.runs.archive, { runId });

    await expect(
      setNickname(asOwner, runId, margit, "red goblin"),
    ).rejects.toThrow("Tarnished's Run is archived.");
  });
});
