import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
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

type AsOwner = AsUser;

// A new active Run with `deaths` Deaths recorded one at a time, all in
// Overworld.
async function runWithDeaths(
  asOwner: AsOwner,
  deaths: number,
  characterName = "Tarnished",
) {
  const runId = await asOwner.mutation(api.runs.createRun, { characterName });
  await recordDeaths(asOwner, runId, deaths);
  return runId;
}

async function ownerWithRun(t: T, deaths: number) {
  const { asUser: asOwner } = await signInWithTwitch(t, owner);
  vi.unstubAllGlobals();
  const runId = await runWithDeaths(asOwner, deaths);
  return { asOwner, runId };
}

// Newest first, as the feed shows them.
async function feed(asOwner: AsOwner) {
  const { page } = await asOwner.query(api.runs.deathFeed, {
    paginationOpts: { cursor: null, numItems: 50 },
  });
  return page;
}

async function tagNamed(asOwner: AsOwner, name: string) {
  const tags = await asOwner.query(api.tags.list, {});
  return tags.find((tag) => tag.name === name)?._id;
}

// What each Death's Tags are called, newest first.
async function feedTags(asOwner: AsOwner) {
  const tags = await asOwner.query(api.tags.list, {});
  const names = new Map(tags.map((tag) => [tag._id, tag.name]));
  return (await feed(asOwner)).map((death) =>
    death.tagIds.map((tagId) => names.get(tagId) ?? "removed"),
  );
}

// Each live Tag's tally in the active Run, and each Encounter's count.
async function counts(asOwner: AsOwner) {
  const run = await asOwner.query(api.runs.activeRun, {});
  return {
    total: run!.total,
    tallies: Object.fromEntries(run!.tallies.map((t) => [t.name, t.count])),
    encounters: Object.fromEntries(
      run!.encounters.map((e) => [e.name, e.deathCount]),
    ),
  };
}

function tag(
  asOwner: AsOwner,
  deathIds: Id<"deaths">[],
  tagId: Id<"tags">,
  tagged = true,
) {
  return asOwner.mutation(api.deaths.update, {
    deathIds,
    tag: { tagId, tagged },
  });
}

async function undoNewest(asOwner: AsOwner) {
  const [newest] = await asOwner.query(api.changes.history, {});
  return await asOwner.mutation(api.changes.undo, { changeId: newest!._id });
}

async function descriptions(asOwner: AsOwner) {
  const entries = await asOwner.query(api.changes.history, {});
  return entries.map((entry) => entry.description);
}

describe("tagging Deaths", () => {
  test("every channel has Gravity", async () => {
    const t = setup();
    const { asOwner } = await ownerWithRun(t, 0);

    expect(await asOwner.query(api.tags.list, {})).toMatchObject([
      { name: "Gravity", gravity: true },
    ]);
  });

  test("a Death tagged Birds and Gravity carries both, and only the tallies move", async () => {
    const t = setup();
    const { asOwner } = await ownerWithRun(t, 3);
    const [newest] = await feed(asOwner);
    const birds = await asOwner.mutation(api.tags.create, { name: "Birds" });

    await tag(asOwner, [newest!._id], birds);
    await tag(asOwner, [newest!._id], (await tagNamed(asOwner, "Gravity"))!);

    expect(await feedTags(asOwner)).toEqual([["Birds", "Gravity"], [], []]);
    expect(await counts(asOwner)).toEqual({
      total: 3,
      tallies: { Gravity: 1, Birds: 1 },
      encounters: { Overworld: 3 },
    });
    expect(await descriptions(asOwner)).toEqual([
      "1 Death Gravity",
      "1 Death Birds",
      "Created the Birds Tag",
      "Recorded a Death in Overworld",
      "Recorded a Death in Overworld",
      "Recorded a Death in Overworld",
      "Created Tarnished's Run",
    ]);
  });

  test("untagging a Death takes it off the tally", async () => {
    const t = setup();
    const { asOwner } = await ownerWithRun(t, 1);
    const [death] = await feed(asOwner);
    const birds = await asOwner.mutation(api.tags.create, { name: "Birds" });
    await tag(asOwner, [death!._id], birds);

    await tag(asOwner, [death!._id], birds, false);

    expect(await feedTags(asOwner)).toEqual([[]]);
    expect((await counts(asOwner)).tallies).toEqual({ Gravity: 0, Birds: 0 });
    expect((await descriptions(asOwner))[0]).toBe("1 Death not Birds");
  });

  test("tagging several Deaths is one Change, and undoing it puts every Death's Tags back", async () => {
    const t = setup();
    const { asOwner } = await ownerWithRun(t, 3);
    const [a, b, c] = await feed(asOwner);
    const birds = await asOwner.mutation(api.tags.create, { name: "Birds" });
    const gravity = (await tagNamed(asOwner, "Gravity"))!;
    await tag(asOwner, [a!._id], gravity);
    await tag(asOwner, [b!._id], birds);
    const before = await descriptions(asOwner);

    await tag(asOwner, [a!._id, b!._id, c!._id], birds);
    const tagged = await feedTags(asOwner);
    const after = await descriptions(asOwner);
    await undoNewest(asOwner);

    expect(tagged).toEqual([["Gravity", "Birds"], ["Birds"], ["Birds"]]);
    expect(after.length).toBe(before.length + 1);
    // The Death that had Birds already isn't changed.
    expect(after[0]).toBe("2 Deaths Birds");
    expect(await feedTags(asOwner)).toEqual([["Gravity"], ["Birds"], []]);
    expect((await counts(asOwner)).tallies).toEqual({ Gravity: 1, Birds: 1 });
  });

  test("a Death can't be tagged with a removed Tag", async () => {
    const t = setup();
    const { asOwner } = await ownerWithRun(t, 1);
    const [death] = await feed(asOwner);
    const birds = await asOwner.mutation(api.tags.create, { name: "Birds" });
    await asOwner.mutation(api.tags.remove, { tagId: birds });

    await expect(tag(asOwner, [death!._id], birds)).rejects.toThrow(
      "That Tag was removed.",
    );
  });
});

describe("managing Tags", () => {
  test("removing a Tag hides it and its tally, Deaths keep it, and undoing the removal shows them again", async () => {
    const t = setup();
    const { asOwner } = await ownerWithRun(t, 1);
    const [death] = await feed(asOwner);
    const birds = await asOwner.mutation(api.tags.create, { name: "Birds" });
    await tag(asOwner, [death!._id], birds);

    await asOwner.mutation(api.tags.remove, { tagId: birds });
    const removed = {
      tags: (await asOwner.query(api.tags.list, {})).map((tag) => tag.name),
      feed: await feedTags(asOwner),
      tallies: (await counts(asOwner)).tallies,
      history: (await descriptions(asOwner))[0],
    };
    await undoNewest(asOwner);

    expect(removed).toEqual({
      tags: ["Gravity"],
      feed: [["removed"]],
      tallies: { Gravity: 0 },
      history: "Removed the Birds Tag",
    });
    expect(await feedTags(asOwner)).toEqual([["Birds"]]);
    expect((await counts(asOwner)).tallies).toEqual({ Gravity: 0, Birds: 1 });
  });

  test("undoing a Tag's creation removes it, and redoing it brings it back", async () => {
    const t = setup();
    const { asOwner } = await ownerWithRun(t, 0);
    await asOwner.mutation(api.tags.create, { name: "Birds" });

    await undoNewest(asOwner);
    const undone = await asOwner.query(api.tags.list, {});
    await undoNewest(asOwner);

    expect(undone.map((tag) => tag.name)).toEqual(["Gravity"]);
    expect((await asOwner.query(api.tags.list, {})).map((t) => t.name)).toEqual(
      ["Gravity", "Birds"],
    );
  });

  test("renaming a Tag is a Change that can be undone", async () => {
    const t = setup();
    const { asOwner } = await ownerWithRun(t, 0);
    const birds = await asOwner.mutation(api.tags.create, { name: "Birds" });

    await asOwner.mutation(api.tags.rename, { tagId: birds, name: " Crows " });
    const renamed = await tagNamed(asOwner, "Crows");
    const history = (await descriptions(asOwner))[0];
    await undoNewest(asOwner);

    expect(renamed).toBe(birds);
    expect(history).toBe("Renamed the Birds Tag to Crows");
    expect(await tagNamed(asOwner, "Birds")).toBe(birds);
  });

  test("two Tags can't share a name in any case", async () => {
    const t = setup();
    const { asOwner } = await ownerWithRun(t, 0);
    const birds = await asOwner.mutation(api.tags.create, { name: "Birds" });
    const crows = await asOwner.mutation(api.tags.create, { name: "Crows" });

    await expect(
      asOwner.mutation(api.tags.create, { name: "bIRDS" }),
    ).rejects.toThrow("There's already a Tag named bIRDS.");
    await expect(
      asOwner.mutation(api.tags.create, { name: "gravity" }),
    ).rejects.toThrow("There's already a Tag named gravity.");
    await expect(
      asOwner.mutation(api.tags.rename, { tagId: crows, name: "BIRDS" }),
    ).rejects.toThrow("There's already a Tag named BIRDS.");
    // Only its case changes.
    await asOwner.mutation(api.tags.rename, { tagId: birds, name: "BIRDS" });
    expect(await tagNamed(asOwner, "BIRDS")).toBe(birds);
  });

  test("bringing a Tag back is refused while another has its name", async () => {
    const t = setup();
    const { asOwner } = await ownerWithRun(t, 0);
    const birds = await asOwner.mutation(api.tags.create, { name: "Birds" });
    await asOwner.mutation(api.tags.remove, { tagId: birds });
    const [removal] = await asOwner.query(api.changes.history, {});
    await asOwner.mutation(api.tags.create, { name: "birds" });

    await expect(
      asOwner.mutation(api.changes.undo, { changeId: removal!._id }),
    ).rejects.toThrow("There's already a Tag named Birds.");
  });

  test("History shows a Tag Change can't be undone once another Run's history changed the Tag since", async () => {
    const t = setup();
    const { asOwner, runId } = await ownerWithRun(t, 0);
    const birds = await asOwner.mutation(api.tags.create, { name: "Birds" });
    const crows = await asOwner.mutation(api.tags.create, { name: "Crows" });
    await asOwner.mutation(api.tags.rename, { tagId: crows, name: "Ravens" });
    // Tag Changes are recorded in the active Run, which is now this one.
    await runWithDeaths(asOwner, 0, "Second");
    await asOwner.mutation(api.tags.remove, { tagId: birds });
    await asOwner.mutation(api.tags.rename, { tagId: crows, name: "Rooks" });

    const entries = await asOwner.query(api.changes.history, { runId });
    expect(entries).toMatchObject([
      {
        description: "Renamed the Crows Tag to Ravens",
        refusal: "Ravens was renamed since.",
      },
      { description: "Created the Rooks Tag", refusal: null },
      {
        description: "Created the Birds Tag",
        refusal: "Birds was removed since.",
      },
      {},
    ]);
    await expect(
      asOwner.mutation(api.changes.undo, { changeId: entries[0]!._id }),
    ).rejects.toThrow("Ravens was renamed since.");
  });

  test("names are 1 to 32 characters once trimmed", async () => {
    const t = setup();
    const { asOwner } = await ownerWithRun(t, 0);

    await expect(
      asOwner.mutation(api.tags.create, { name: "x".repeat(33) }),
    ).rejects.toThrow("A Tag needs a name of 1 to 32 characters.");
    await expect(
      asOwner.mutation(api.tags.create, { name: "   " }),
    ).rejects.toThrow("A Tag needs a name of 1 to 32 characters.");
    await asOwner.mutation(api.tags.create, { name: ` ${"x".repeat(32)} ` });
    expect(await tagNamed(asOwner, "x".repeat(32))).toBeDefined();
  });

  test("a channel has at most 50 Tags", async () => {
    const t = setup();
    const { asOwner } = await ownerWithRun(t, 0);
    for (let n = 1; n < 50; n++) {
      await asOwner.mutation(api.tags.create, { name: `Tag ${n}` });
    }

    await expect(
      asOwner.mutation(api.tags.create, { name: "One too many" }),
    ).rejects.toThrow("A channel can have at most 50 Tags.");
  });

  test("Tags can't be changed while there's no active Run", async () => {
    const t = setup();
    const { asUser: asOwner } = await signInWithTwitch(t, owner);
    vi.unstubAllGlobals();

    await expect(
      asOwner.mutation(api.tags.create, { name: "Birds" }),
    ).rejects.toThrow("Tags can't be changed while there's no active Run.");
  });
});

describe("tallies", () => {
  test("a Tag made in one Run is offered in another, and each Run's tally counts only its own Deaths", async () => {
    const t = setup();
    const { asOwner, runId: first } = await ownerWithRun(t, 2);
    const birds = await asOwner.mutation(api.tags.create, { name: "Birds" });
    await tag(asOwner, (await feed(asOwner)).map((d) => d._id), birds);

    const second = await runWithDeaths(asOwner, 1, "Second");
    const offered = await asOwner.query(api.tags.list, {});
    await tag(asOwner, (await feed(asOwner)).map((d) => d._id), birds);
    const secondTallies = (await counts(asOwner)).tallies;
    const firstRun = await asOwner.query(api.runs.run, { runId: first });

    expect(second).not.toBe(first);
    expect(offered.map((tag) => tag.name)).toEqual(["Gravity", "Birds"]);
    expect(secondTallies).toEqual({ Gravity: 0, Birds: 1 });
    expect(firstRun!.tallies).toMatchObject([
      { name: "Gravity", count: 0 },
      { name: "Birds", count: 2 },
    ]);
  });

  test("a removed Death isn't counted in any tally, and undoing the removal counts it again", async () => {
    const t = setup();
    const { asOwner, runId } = await ownerWithRun(t, 0);
    const [death] = await recordDeaths(asOwner, runId, 1);
    const birds = await asOwner.mutation(api.tags.create, { name: "Birds" });
    await tag(asOwner, [death!], birds);
    const tagged = (await counts(asOwner)).tallies;

    await asOwner.mutation(api.deaths.remove, { deathId: death! });
    const removed = (await counts(asOwner)).tallies;
    await undoNewest(asOwner);

    expect(tagged).toEqual({ Gravity: 0, Birds: 1 });
    expect(removed).toEqual({ Gravity: 0, Birds: 0 });
    expect((await counts(asOwner)).tallies).toEqual({ Gravity: 0, Birds: 1 });
  });
});

describe("Gravity from before Tags", () => {
  // A Run and one Death as they were kept before Tags: the Death tagged
  // Gravity, the Run's Gravity tally, and the Change tagging it. The
  // channel has no Gravity Tag until the deploy makes it.
  async function beforeTags(t: T) {
    const { asOwner, runId } = await ownerWithRun(t, 2);
    const [tagged, untagged] = await feed(asOwner);
    await t.run(async (ctx) => {
      for (const tag of await ctx.db.query("tags").collect()) {
        await ctx.db.delete(tag._id);
      }
      await ctx.db.patch(tagged!._id, { tagIds: undefined, gravity: true });
      await ctx.db.patch(untagged!._id, { tagIds: undefined });
      await ctx.db.patch(runId, { tagCounts: undefined, gravityCount: 1 });
      const state = { encounterId: tagged!.encounterId };
      await ctx.db.insert("changes", {
        runId,
        actorTwitchId: owner.id,
        action: "updateDeaths",
        effects: [
          {
            kind: "death",
            deathId: tagged!._id,
            before: { ...state, gravity: false },
            after: { ...state, gravity: true },
          },
        ],
      });
    });
    await t.mutation(internal.tags.makeGravityTags, {});
    return { asOwner, tagged: tagged!, untagged: untagged! };
  }

  test("existing Gravity Deaths and tallies show as the Gravity Tag", async () => {
    const t = setup();
    const { asOwner } = await beforeTags(t);

    expect(await feedTags(asOwner)).toEqual([["Gravity"], []]);
    expect((await counts(asOwner)).tallies).toEqual({ Gravity: 1 });
    expect((await descriptions(asOwner))[0]).toBe("1 Death Gravity");
  });

  test("an undo of a Change recorded before Tags still works", async () => {
    const t = setup();
    const { asOwner } = await beforeTags(t);

    await undoNewest(asOwner);

    expect(await feedTags(asOwner)).toEqual([[], []]);
    expect((await counts(asOwner)).tallies).toEqual({ Gravity: 0 });
    expect((await descriptions(asOwner))[0]).toBe("Undid: 1 Death Gravity");
  });

  test("a Death tagged Gravity before Tags keeps it when it's tagged again", async () => {
    const t = setup();
    const { asOwner, tagged, untagged } = await beforeTags(t);
    const birds = await asOwner.mutation(api.tags.create, { name: "Birds" });
    const gravity = (await tagNamed(asOwner, "Gravity"))!;

    await tag(asOwner, [tagged._id], birds);
    await tag(asOwner, [untagged._id], gravity);

    expect(await feedTags(asOwner)).toEqual([["Gravity", "Birds"], ["Gravity"]]);
    expect((await counts(asOwner)).tallies).toEqual({ Gravity: 2, Birds: 1 });
  });
});
