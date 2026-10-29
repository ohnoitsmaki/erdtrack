import { ConvexError, v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireActor, requireActorsRun, type Actor } from "./channels";
import { recordChange, type Effect } from "./changes";
import {
  currentEncounter,
  encountersInRun,
  overworldOf,
  requireEncounterInRun,
} from "./currentEncounter";
import { DEATH_COOLDOWN_MS, MAX_DEATHS_ADDED } from "./deathLimits";
import { bossEncounter, defeatedEffects } from "./encounters";
import { gravityTag, requireActorsTag, tagsOf } from "./tags";

// The most Deaths one action may touch, well within Convex's write limits.
export const MAX_DEATHS_PER_UPDATE = 100;

export type DeathUpdate = {
  deathIds: Id<"deaths">[];
  encounterId?: Id<"encounters">;
  // One Tag put on every Death, or taken off.
  tag?: { tagId: Id<"tags">; tagged: boolean };
};

// Reassigns and tags any number of Deaths of one Run as a single Change. If
// two people edit the same Death at once, the last write wins and both are
// in history.
export async function updateDeathsAs(
  ctx: MutationCtx,
  actor: Actor,
  { deathIds, encounterId, tag }: DeathUpdate,
) {
  const ids = [...new Set(deathIds)];
  if (ids.length === 0 || ids.length > MAX_DEATHS_PER_UPDATE) {
    throw new ConvexError(
      `Choose 1 to ${MAX_DEATHS_PER_UPDATE} Deaths at a time.`,
    );
  }
  const deaths = await Promise.all(ids.map((id) => ctx.db.get(id)));
  const runId = deaths[0]?.runId;
  const run = runId && (await ctx.db.get(runId));
  if (
    !run ||
    run.channelId !== actor.channel._id ||
    deaths.some((death) => death?.runId !== runId)
  ) {
    throw new ConvexError("Those Deaths aren't all in one Run.");
  }
  if (encounterId !== undefined) {
    await requireEncounterInRun(ctx, run._id, encounterId);
  }
  if (tag) {
    await requireActorsTag(ctx, actor, tag.tagId);
  }
  const gravityId = await gravityTag(ctx, actor.channel._id);
  const retag = (tagIds: Id<"tags">[]) => {
    if (!tag) {
      return tagIds;
    }
    if (!tag.tagged) {
      return tagIds.filter((tagId) => tagId !== tag.tagId);
    }
    return tagIds.includes(tag.tagId) ? tagIds : [...tagIds, tag.tagId];
  };
  return await recordChange(
    ctx,
    actor,
    run._id,
    "updateDeaths",
    deaths.map((death) => {
      const before = {
        encounterId: death!.encounterId,
        tagIds: tagsOf(death!, gravityId),
      };
      return {
        kind: "death" as const,
        deathId: death!._id,
        before,
        after: {
          encounterId: encounterId ?? before.encounterId,
          tagIds: retag(before.tagIds),
        },
      };
    }),
  );
}

export const update = mutation({
  args: {
    deathIds: v.array(v.id("deaths")),
    encounterId: v.optional(v.id("encounters")),
    tag: v.optional(v.object({ tagId: v.id("tags"), tagged: v.boolean() })),
  },
  handler: async (ctx, args) => {
    return await updateDeathsAs(ctx, await requireActor(ctx), args);
  },
});

// Refused within the cooldown of the Run's latest Death, so two Mods
// pressing at once for the same death record it once. The Death that won
// is enough: whoever is refused sees it arrive.
export async function recordDeathAs(
  ctx: MutationCtx,
  actor: Actor,
  runId: Id<"runs">,
  encounterId?: Id<"encounters">,
) {
  const run = await requireActorsRun(ctx, actor, runId);
  const now = Date.now();
  if (run.lastDeathAt !== undefined && now - run.lastDeathAt < DEATH_COOLDOWN_MS) {
    throw new ConvexError("A Death was just recorded. Wait a moment.");
  }
  const encounter = await requireEncounterInRun(
    ctx,
    run._id,
    encounterId ?? (await currentEncounter(ctx, run._id)),
  );
  // Inserted removed, and the Change recording it is what shows it, so undo
  // and redo work like any other Change.
  const deathId = await ctx.db.insert("deaths", {
    runId: run._id,
    encounterId: encounter._id,
    removed: true,
    recordedAt: now,
  });
  await recordChange(ctx, actor, run._id, "recordDeath", [
    { kind: "recorded", deathId, before: false, after: true },
  ]);
  await ctx.db.patch(run._id, { lastDeathAt: now });
  return deathId;
}

// Brings the Run's Deaths up to the Save Total, so a Death a Mod already
// pressed for is covered by the save's rise and never made twice. When
// they're made as the game is played, they're happening now: they go in the
// Current Encounter, count for the Stream and start the cooldown, though the
// Watcher is never refused by it. A catch-up is Deaths from before, which go
// in Overworld like those added many at once. At most MAX_DEATHS_ADDED are
// made at a time, and returns how many are still to make.
export async function topUpDeathsAs(
  ctx: MutationCtx,
  actor: Actor,
  run: Doc<"runs">,
  total: number,
  catchUp: boolean,
) {
  const recorded = (await encountersInRun(ctx, run._id)).reduce(
    (sum, { deathCount }) => sum + deathCount,
    0,
  );
  const count = Math.min(total - recorded, MAX_DEATHS_ADDED);
  if (count <= 0) {
    return 0;
  }
  const now = Date.now();
  const encounterId = catchUp
    ? (await overworldOf(ctx, run._id))._id
    : await currentEncounter(ctx, run._id);
  const deathIds = [];
  for (let i = 0; i < count; i++) {
    deathIds.push(
      await ctx.db.insert("deaths", {
        runId: run._id,
        encounterId,
        removed: true,
        recordedAt: catchUp ? undefined : now,
      }),
    );
  }
  await recordChange(ctx, actor, run._id, "addDeaths", [
    { kind: "recordedMany", deathIds, before: false, after: true },
  ]);
  if (!catchUp) {
    await ctx.db.patch(run._id, { lastDeathAt: now });
  }
  return total - recorded - count;
}

// One Death, in the Current Encounter unless another is chosen.
export const record = mutation({
  args: { runId: v.id("runs"), encounterId: v.optional(v.id("encounters")) },
  handler: async (ctx, { runId, encounterId }) => {
    return await recordDeathAs(
      ctx,
      await requireActor(ctx),
      runId,
      encounterId,
    );
  },
});

// Takes back a Death recorded by mistake.
export const remove = mutation({
  args: { deathId: v.id("deaths") },
  handler: async (ctx, { deathId }) => {
    const actor = await requireActor(ctx);
    const death = await ctx.db.get(deathId);
    if (!death) {
      throw new ConvexError("That Death no longer exists.");
    }
    const run = await requireActorsRun(ctx, actor, death.runId);
    return await recordChange(ctx, actor, run._id, "removeDeath", [
      { kind: "recorded", deathId, before: !death.removed, after: false },
    ]);
  },
});

// How many of the Deaths added at once go to one Encounter: one in the Run,
// or a boss from the boss list, added to the Run if it isn't in it yet. A
// boss can be marked Defeated at the same time.
const shareFields = { count: v.number(), defeated: v.optional(v.boolean()) };
const share = v.union(
  v.object({ encounterId: v.id("encounters"), ...shareFields }),
  v.object({ bossId: v.string(), ...shareFields }),
);

// Adds `count` Deaths at once, to catch up a Run that started mid-progress,
// spread across Encounters as the split says and the rest in Overworld.
// They and any boss added for them are inserted removed, and the Change
// adding them is what shows them, so one Undo takes it all back like any
// other Change, Defeated marks included. There's no cooldown: they aren't
// deaths happening now.
export const addMany = mutation({
  args: {
    runId: v.id("runs"),
    count: v.number(),
    split: v.optional(v.array(share)),
  },
  handler: async (ctx, { runId, count, split = [] }) => {
    const actor = await requireActor(ctx);
    const run = await requireActorsRun(ctx, actor, runId);
    if (!Number.isInteger(count) || count < 1 || count > MAX_DEATHS_ADDED) {
      throw new ConvexError(
        `Add 1 to ${MAX_DEATHS_ADDED.toLocaleString("en")} Deaths at a time.`,
      );
    }
    if (split.some((s) => !Number.isInteger(s.count) || s.count < 0)) {
      throw new ConvexError("Each count must be a whole number, 0 or more.");
    }
    const assigned = split.reduce((sum, s) => sum + s.count, 0);
    if (assigned > count) {
      throw new ConvexError(
        `Those counts add up to ${assigned}, more than the ${count} being added.`,
      );
    }
    const counts = new Map<Id<"encounters">, number>();
    const added: Effect[] = [];
    const defeated = new Map<Id<"encounters">, Doc<"encounters">>();
    // A boss given twice is added once: the first share inserts it removed.
    const bosses = new Map<string, Doc<"encounters">>();
    for (const s of split) {
      let encounter;
      if ("bossId" in s) {
        encounter =
          bosses.get(s.bossId) ?? (await bossEncounter(ctx, run._id, s.bossId));
        bosses.set(s.bossId, encounter);
      } else {
        encounter = await requireEncounterInRun(ctx, run._id, s.encounterId);
      }
      if (encounter.removed && !counts.has(encounter._id)) {
        added.push({
          kind: "added",
          encounterId: encounter._id,
          before: false,
          after: true,
        });
      }
      counts.set(encounter._id, (counts.get(encounter._id) ?? 0) + s.count);
      if (s.defeated) {
        defeated.set(encounter._id, encounter);
      }
    }
    const beaten = defeated.size
      ? await defeatedEffects(ctx, run._id, [...defeated.values()])
      : [];
    const overworld = await overworldOf(ctx, run._id);
    counts.set(
      overworld._id,
      (counts.get(overworld._id) ?? 0) + count - assigned,
    );
    const deathIds = [];
    for (const [encounterId, n] of counts) {
      for (let i = 0; i < n; i++) {
        deathIds.push(
          await ctx.db.insert("deaths", {
            runId: run._id,
            encounterId,
            removed: true,
          }),
        );
      }
    }
    const changeId = await recordChange(ctx, actor, run._id, "addDeaths", [
      ...added,
      { kind: "recordedMany", deathIds, before: false, after: true },
      ...beaten,
    ]);
    // Those bosses were beaten before, not now, so they keep the time they
    // had, or none, and don't count as felled this Stream.
    for (const boss of defeated.values()) {
      await ctx.db.patch(boss._id, {
        defeatedAt: boss.defeated ? boss.defeatedAt : undefined,
      });
    }
    return changeId;
  },
});
