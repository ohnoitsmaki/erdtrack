import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { searchBosses } from "./bosses";
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

type AsOwner = Awaited<ReturnType<typeof signInWithTwitch>>["asUser"];

function newRun(asOwner: AsOwner) {
  return asOwner.mutation(api.runs.createRun, { characterName: "Tarnished" });
}

async function ownerWithRun(t: T) {
  const { asUser: asOwner } = await signInWithTwitch(t, owner);
  vi.unstubAllGlobals();
  const runId = await newRun(asOwner);
  return { asOwner, runId };
}

async function encounterNames(asOwner: AsOwner) {
  const run = await asOwner.query(api.runs.activeRun, {});
  return run!.encounters.map((encounter) => encounter.name);
}

describe("Encounters", () => {
  test("a new Run starts with only Overworld", async () => {
    const t = setup();
    const { asOwner } = await ownerWithRun(t);

    expect(await encounterNames(asOwner)).toEqual(["Overworld"]);
  });

  test("a boss added to the Run is listed after Overworld by its full name", async () => {
    const t = setup();
    const { asOwner, runId } = await ownerWithRun(t);

    await asOwner.mutation(api.encounters.addBoss, {
      runId,
      bossId: "1039430800",
    });

    expect(await encounterNames(asOwner)).toEqual([
      "Overworld",
      "Night's Cavalry — Gate Town Bridge (Liurnia of the Lakes)",
    ]);
  });

  test("adding a boss the Run already has adds nothing", async () => {
    const t = setup();
    const { asOwner, runId } = await ownerWithRun(t);
    const first = await asOwner.mutation(api.encounters.addBoss, {
      runId,
      bossId: "1039430800",
    });

    const second = await asOwner.mutation(api.encounters.addBoss, {
      runId,
      bossId: "1039430800",
    });

    expect(second).toBe(first);
    expect(await encounterNames(asOwner)).toHaveLength(2);
  });

  test("a Custom Encounter belongs only to the Run it was created for", async () => {
    const t = setup();
    const { asOwner, runId } = await ownerWithRun(t);

    await asOwner.mutation(api.encounters.addCustom, {
      runId,
      name: "  Jumping puzzle  ",
    });
    const withCustom = await encounterNames(asOwner);
    await newRun(asOwner);

    expect(withCustom).toEqual(["Overworld", "Jumping puzzle"]);
    expect(await encounterNames(asOwner)).toEqual(["Overworld"]);
  });

  test("a boss that isn't in the boss list is refused", async () => {
    const t = setup();
    const { asOwner, runId } = await ownerWithRun(t);

    await expect(
      asOwner.mutation(api.encounters.addBoss, { runId, bossId: "19000800:radagon" }),
    ).rejects.toThrow("isn't in the boss list");
    expect(await encounterNames(asOwner)).toEqual(["Overworld"]);
  });

  test.each([
    ["a blank name", "   "],
    ["an over-long name", "x".repeat(65)],
  ])("a Custom Encounter with %s is refused", async (_, name) => {
    const t = setup();
    const { asOwner, runId } = await ownerWithRun(t);

    await expect(
      asOwner.mutation(api.encounters.addCustom, { runId, name }),
    ).rejects.toThrow("name");
    expect(await encounterNames(asOwner)).toEqual(["Overworld"]);
  });

  test("someone who isn't a Mod can't add Encounters", async () => {
    const t = setup();
    const { runId } = await ownerWithRun(t);
    const { asUser: someoneElse } = await signInWithTwitch(t, {
      id: "222",
      login: "somemod",
      displayName: "SomeMod",
    });

    await expect(
      someoneElse.mutation(api.encounters.addBoss, {
        runId,
        bossId: "1039430800",
      }),
    ).rejects.toThrow("Only the Streamer and Mods");
    await expect(
      someoneElse.mutation(api.encounters.addCustom, { runId, name: "Ledge" }),
    ).rejects.toThrow("Only the Streamer and Mods");
  });

  test("adding a boss stores only that boss, never the boss list", async () => {
    const t = setup();
    const { asOwner, runId } = await ownerWithRun(t);

    await asOwner.mutation(api.encounters.addBoss, {
      runId,
      bossId: "1039430800",
    });

    const stored = await t.run((ctx) => ctx.db.query("encounters").collect());
    expect(stored).toHaveLength(2);
  });
});

describe("the Run's order", () => {
  // A Run with Encounters A, B and C added in that order.
  async function runWithThree(t: T) {
    const { asOwner, runId } = await ownerWithRun(t);
    const ids = [];
    for (const name of ["A", "B", "C"]) {
      ids.push(
        await asOwner.mutation(api.encounters.addCustom, { runId, name }),
      );
    }
    return { asOwner, runId, a: ids[0]!, b: ids[1]!, c: ids[2]! };
  }

  test("an Encounter moved before another goes just before it", async () => {
    const t = setup();
    const { asOwner, runId, a, c } = await runWithThree(t);

    await asOwner.mutation(api.encounters.moveEncounter, {
      runId,
      encounterId: c,
      before: a,
    });

    expect(await encounterNames(asOwner)).toEqual(["Overworld", "C", "A", "B"]);
  });

  test("an Encounter moved before none goes last, and later ones still go after it", async () => {
    const t = setup();
    const { asOwner, runId, a } = await runWithThree(t);

    await asOwner.mutation(api.encounters.moveEncounter, {
      runId,
      encounterId: a,
      before: null,
    });
    await asOwner.mutation(api.encounters.addCustom, { runId, name: "D" });

    expect(await encounterNames(asOwner)).toEqual([
      "Overworld",
      "B",
      "C",
      "A",
      "D",
    ]);
  });

  test("moving one again and again between the same two keeps the order right", async () => {
    const t = setup();
    const { asOwner, runId, b, c } = await runWithThree(t);

    // Far more than halving the room between them allows.
    for (let i = 0; i < 120; i++) {
      await asOwner.mutation(api.encounters.moveEncounter, {
        runId,
        encounterId: i % 2 ? c : b,
        before: i % 2 ? b : c,
      });
    }

    expect(await encounterNames(asOwner)).toEqual(["Overworld", "A", "C", "B"]);
  });

  test("the List view shows the Run's order", async () => {
    const t = setup();
    const { asOwner, runId, a, c } = await runWithThree(t);

    await asOwner.mutation(api.encounters.moveEncounter, {
      runId,
      encounterId: c,
      before: a,
    });

    const overlay = await t.query(api.overlay.current, {});
    expect(overlay!.encounters.map((e) => e.name)).toEqual([
      "Overworld",
      "C",
      "A",
      "B",
    ]);
  });

  test("a move is a Change, and undoing it puts the Encounter back", async () => {
    const t = setup();
    const { asOwner, runId, a, c } = await runWithThree(t);

    await asOwner.mutation(api.encounters.moveEncounter, {
      runId,
      encounterId: c,
      before: a,
    });
    const [latest] = await asOwner.query(api.changes.history, {});
    await asOwner.mutation(api.changes.undoMyLast, { runId });

    expect(latest!.description).toBe("Moved C");
    expect(await encounterNames(asOwner)).toEqual(["Overworld", "A", "B", "C"]);
  });

  test("moving an Encounter to where it is records nothing", async () => {
    const t = setup();
    const { asOwner, runId, b, c } = await runWithThree(t);
    const before = await asOwner.query(api.changes.history, {});

    await asOwner.mutation(api.encounters.moveEncounter, {
      runId,
      encounterId: b,
      before: c,
    });

    expect(await asOwner.query(api.changes.history, {})).toHaveLength(
      before.length,
    );
  });

  test("Overworld stays first", async () => {
    const t = setup();
    const { asOwner, runId, a } = await runWithThree(t);
    const run = await asOwner.query(api.runs.activeRun, {});
    const overworld = run!.encounters[0]!._id;

    await expect(
      asOwner.mutation(api.encounters.moveEncounter, {
        runId,
        encounterId: a,
        before: overworld,
      }),
    ).rejects.toThrow("Overworld stays first");
    await expect(
      asOwner.mutation(api.encounters.moveEncounter, {
        runId,
        encounterId: overworld,
        before: null,
      }),
    ).rejects.toThrow("Overworld stays first");
    expect(await encounterNames(asOwner)).toEqual(["Overworld", "A", "B", "C"]);
  });

  test("an archived Run's order can't be changed", async () => {
    const t = setup();
    const { asOwner, runId, a, c } = await runWithThree(t);
    await asOwner.mutation(api.runs.archive, { runId });

    await expect(
      asOwner.mutation(api.encounters.moveEncounter, {
        runId,
        encounterId: c,
        before: a,
      }),
    ).rejects.toThrow("archived");
  });
});

describe("hiding an Encounter from the Overlay", () => {
  async function runWithMargit(t: T) {
    const { asOwner, runId } = await ownerWithRun(t);
    const margit = await asOwner.mutation(api.encounters.addBoss, {
      runId,
      bossId: "10000850",
    });
    await asOwner.mutation(api.encounters.addCustom, { runId, name: "Ledge" });
    return { asOwner, runId, margit };
  }

  async function overlayLists(t: T) {
    const overlay = (await t.query(api.overlay.current, {}))!;
    return {
      list: overlay.encounters.map((e) => e.name),
      defeated: overlay.defeated.map((e) => e.name),
      total: overlay.total,
      current: overlay.encounter.name,
    };
  }

  test("leaves it off the List view and the Defeated, but not the Panel or the Total", async () => {
    const t = setup();
    const { asOwner, runId, margit } = await runWithMargit(t);
    await asOwner.mutation(api.encounters.setCurrent, {
      runId,
      encounterId: margit,
    });
    await asOwner.mutation(api.deaths.record, { runId });
    await asOwner.mutation(api.encounters.markDefeated, { encounterId: margit });

    await asOwner.mutation(api.encounters.setHidden, {
      runId,
      encounterId: margit,
      hidden: true,
    });

    expect(await overlayLists(t)).toEqual({
      list: ["Overworld", "Ledge"],
      defeated: [],
      total: 1,
      current: "Overworld",
    });
    const run = await asOwner.query(api.runs.activeRun, {});
    expect(run!.encounters.find((e) => e._id === margit)!.hidden).toBe(true);
  });

  test("still shows it while it's the Current Encounter", async () => {
    const t = setup();
    const { asOwner, runId, margit } = await runWithMargit(t);
    await asOwner.mutation(api.encounters.setHidden, {
      runId,
      encounterId: margit,
      hidden: true,
    });

    await asOwner.mutation(api.encounters.setCurrent, {
      runId,
      encounterId: margit,
    });

    expect((await overlayLists(t)).current).toBe("Margit, the Fell Omen");
  });

  test("is a Change, and undoing it lists it again", async () => {
    const t = setup();
    const { asOwner, runId, margit } = await runWithMargit(t);

    await asOwner.mutation(api.encounters.setHidden, {
      runId,
      encounterId: margit,
      hidden: true,
    });
    const [latest] = await asOwner.query(api.changes.history, {});
    await asOwner.mutation(api.changes.undoMyLast, { runId });

    expect(latest!.description).toBe(
      "Hid Margit, the Fell Omen — Stormveil Castle (Stormveil Castle) from the Overlay",
    );
    expect((await overlayLists(t)).list).toEqual([
      "Overworld",
      "Margit, the Fell Omen",
      "Ledge",
    ]);
  });

  test("Overworld can't be hidden", async () => {
    const t = setup();
    const { asOwner, runId } = await runWithMargit(t);
    const run = await asOwner.query(api.runs.activeRun, {});

    await expect(
      asOwner.mutation(api.encounters.setHidden, {
        runId,
        encounterId: run!.encounters[0]!._id,
        hidden: true,
      }),
    ).rejects.toThrow("Overlay style");
  });
});

describe("changing which boss an Encounter is", () => {
  // Two of the Night's Cavalry fights, easily mixed up.
  const [first, second] = searchBosses("night's cavalry");

  async function runWithCavalry(t: T) {
    const { asOwner, runId } = await ownerWithRun(t);
    const cavalry = await asOwner.mutation(api.encounters.addBoss, {
      runId,
      bossId: first!.id,
    });
    return { asOwner, runId, cavalry };
  }

  async function cavalryOf(asOwner: AsOwner, encounterId: Id<"encounters">) {
    const run = await asOwner.query(api.runs.activeRun, {});
    return run!.encounters.find((e) => e._id === encounterId)!;
  }

  test("keeps its Deaths, Nickname, place and whether it's current", async () => {
    const t = setup();
    const { asOwner, runId, cavalry } = await runWithCavalry(t);
    await asOwner.mutation(api.encounters.setCurrent, {
      runId,
      encounterId: cavalry,
    });
    await asOwner.mutation(api.deaths.record, { runId });
    await asOwner.mutation(api.encounters.setNickname, {
      runId,
      encounterId: cavalry,
      nickname: "horse guy",
    });

    await asOwner.mutation(api.encounters.changeBoss, {
      runId,
      encounterId: cavalry,
      bossId: second!.id,
    });

    const run = await asOwner.query(api.runs.activeRun, {});
    const changed = run!.encounters.find((e) => e._id === cavalry)!;
    expect(changed).toMatchObject({
      bossId: second!.id,
      name: second!.displayName,
      nickname: "horse guy",
      deathCount: 1,
    });
    expect(run!.currentEncounterId).toBe(cavalry);
    expect(run!.encounters.map((e) => e.name)).toEqual([
      "Overworld",
      second!.displayName,
    ]);
  });

  test("is a Change, and undoing it makes it the boss it was", async () => {
    const t = setup();
    const { asOwner, runId, cavalry } = await runWithCavalry(t);

    await asOwner.mutation(api.encounters.changeBoss, {
      runId,
      encounterId: cavalry,
      bossId: second!.id,
    });
    const [latest] = await asOwner.query(api.changes.history, {});
    await asOwner.mutation(api.changes.undoMyLast, { runId });

    expect(latest!.description).toBe(
      `Changed ${first!.displayName} to ${second!.displayName}`,
    );
    expect(await cavalryOf(asOwner, cavalry)).toMatchObject({
      bossId: first!.id,
      name: first!.displayName,
    });
  });

  test("a boss the Run already has is refused", async () => {
    const t = setup();
    const { asOwner, runId, cavalry } = await runWithCavalry(t);
    await asOwner.mutation(api.encounters.addBoss, {
      runId,
      bossId: second!.id,
    });

    await expect(
      asOwner.mutation(api.encounters.changeBoss, {
        runId,
        encounterId: cavalry,
        bossId: second!.id,
      }),
    ).rejects.toThrow(`${second!.displayName} is already in the Run.`);
  });

  test("undoing it is refused once the boss it was is added again", async () => {
    const t = setup();
    const { asOwner, runId, cavalry } = await runWithCavalry(t);
    await asOwner.mutation(api.encounters.changeBoss, {
      runId,
      encounterId: cavalry,
      bossId: second!.id,
    });
    const [change] = await asOwner.query(api.changes.history, {});
    await asOwner.mutation(api.encounters.addBoss, {
      runId,
      bossId: first!.id,
    });

    const entry = (await asOwner.query(api.changes.history, {})).find(
      (c) => c._id === change!._id,
    );
    expect(entry!.refusal).toBe(`${first!.displayName} is already in the Run.`);
    await expect(
      asOwner.mutation(api.changes.undo, { changeId: change!._id }),
    ).rejects.toThrow("is already in the Run.");
  });

  test("keeps it Defeated", async () => {
    const t = setup();
    const { asOwner, runId, cavalry } = await runWithCavalry(t);
    await asOwner.mutation(api.encounters.markDefeated, { encounterId: cavalry });

    await asOwner.mutation(api.encounters.changeBoss, {
      runId,
      encounterId: cavalry,
      bossId: second!.id,
    });

    expect((await cavalryOf(asOwner, cavalry)).defeated).toBe(true);
  });

  test("picking the boss it is records nothing", async () => {
    const t = setup();
    const { asOwner, runId, cavalry } = await runWithCavalry(t);

    await asOwner.mutation(api.encounters.changeBoss, {
      runId,
      encounterId: cavalry,
      bossId: first!.id,
    });

    const [latest] = await asOwner.query(api.changes.history, {});
    expect(latest!.action).toBe("addEncounter");
  });

  test("a Custom Encounter can't be changed to a boss", async () => {
    const t = setup();
    const { asOwner, runId } = await ownerWithRun(t);
    const ledge = await asOwner.mutation(api.encounters.addCustom, {
      runId,
      name: "Ledge",
    });

    await expect(
      asOwner.mutation(api.encounters.changeBoss, {
        runId,
        encounterId: ledge,
        bossId: first!.id,
      }),
    ).rejects.toThrow("Only a boss");
  });

  test("a boss that isn't in the boss list is refused", async () => {
    const t = setup();
    const { asOwner, runId, cavalry } = await runWithCavalry(t);

    await expect(
      asOwner.mutation(api.encounters.changeBoss, {
        runId,
        encounterId: cavalry,
        bossId: "not-a-boss",
      }),
    ).rejects.toThrow("isn't in the boss list");
  });
});
