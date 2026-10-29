import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  internalMutation,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  requireActor,
  requireActorsRun,
  requireChannel,
  requireOwner,
} from "./channels";
import { recordChange, requireLiveRun } from "./changes";
import { currentEncounter, encountersInRun } from "./currentEncounter";
import { totalOf } from "./overlay";
import { MAX_CHARACTER_NAME_LENGTH } from "./runLimits";
import { findGravityTag, tagsOf, tagTallies } from "./tags";
import { isWatched } from "./watcher";

// A new Run for a character, made the active Run. The Run is inserted
// removed, and the Change creating it is what shows it, so it can be undone
// like any other Change.
export const createRun = mutation({
  args: { characterName: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const characterName = args.characterName.trim();
    if (!characterName || characterName.length > MAX_CHARACTER_NAME_LENGTH) {
      throw new ConvexError(
        `A character name needs 1 to ${MAX_CHARACTER_NAME_LENGTH} characters.`,
      );
    }
    const runId = await ctx.db.insert("runs", {
      channelId: actor.channel._id,
      characterName,
      removed: true,
    });
    await ctx.db.insert("encounters", {
      runId,
      kind: "overworld",
      name: "Overworld",
      deathCount: 0,
    });
    await recordChange(ctx, actor, runId, "createRun", [
      { kind: "created", before: false, after: true },
      {
        kind: "active",
        before: actor.channel.activeRunId ?? null,
        after: runId,
      },
    ]);
    return runId;
  },
});

// An Archived Run becomes read-only. If it was the active Run, there's none.
export const archive = mutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const actor = await requireActor(ctx);
    const run = await requireActorsRun(ctx, actor, runId);
    await requireLiveRun(ctx, run._id);
    const active = actor.channel.activeRunId ?? null;
    await recordChange(ctx, actor, run._id, "archiveRun", [
      {
        kind: "active",
        before: active,
        after: active === run._id ? null : active,
      },
      { kind: "archived", before: false, after: true },
    ]);
  },
});

// Recorded in the history of the Run switched to.
export const setActive = mutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const actor = await requireActor(ctx);
    const run = await requireActorsRun(ctx, actor, runId);
    await requireLiveRun(ctx, run._id);
    await recordChange(ctx, actor, run._id, "setActiveRun", [
      {
        kind: "active",
        before: actor.channel.activeRunId ?? null,
        after: run._id,
      },
    ]);
  },
});

// Only the Streamer can delete a Run, and only once it's archived, so history is
// never wiped by accident. The Run goes at once; everything that belongs to
// it, its Changes included, is deleted in batches afterwards.
export const deleteRun = mutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await requireActorsRun(ctx, await requireOwner(ctx), runId);
    if (!run.archived) {
      throw new ConvexError(
        `Archive ${run.characterName}'s Run before deleting it.`,
      );
    }
    await ctx.db.delete(run._id);
    await ctx.scheduler.runAfter(0, internal.runs.purge, { runId: run._id });
  },
});

// How many records of each kind one pass deletes, well within Convex's write
// limits however long the Run was.
const PURGE_BATCH = 500;

// Deletes what belonged to a deleted Run, a batch at a time, until none is
// left.
export const purge = internalMutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const batches = await Promise.all([
      ctx.db
        .query("changes")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .take(PURGE_BATCH),
      ctx.db
        .query("deaths")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .take(PURGE_BATCH),
      ctx.db
        .query("encounterSwitches")
        .withIndex("by_run_at", (q) => q.eq("runId", runId))
        .take(PURGE_BATCH),
      ctx.db
        .query("encounters")
        .withIndex("by_run_kind", (q) => q.eq("runId", runId))
        .take(PURGE_BATCH),
    ]);
    for (const record of batches.flat()) {
      await ctx.db.delete(record._id);
    }
    if (batches.some((batch) => batch.length === PURGE_BATCH)) {
      await ctx.scheduler.runAfter(0, internal.runs.purge, { runId });
    }
  },
});

// Every Run of the channel, archived ones included, oldest first.
export const list = query({
  args: {},
  handler: async (ctx) => {
    const channel = await requireChannel(ctx);
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .collect();
    const live = runs.filter((run) => !run.removed);
    // Oldest first, which the index already gives.
    return await Promise.all(
      live.map(async ({ _id, characterName, archived }) => ({
        _id,
        characterName,
        total: totalOf(await encountersInRun(ctx, _id)),
        archived: archived ?? false,
        active: _id === channel.activeRunId,
      })),
    );
  },
});

export const activeRun = query({
  args: {},
  handler: async (ctx) => {
    const channel = await requireChannel(ctx);
    const run = channel.activeRunId && (await ctx.db.get(channel.activeRunId));
    return run ? await summary(ctx, run) : null;
  },
});

// Any Run of the channel, so archived Runs stay viewable.
// Takes any string, because the Panel's /runs/:id passes what's in the
// address bar. One that isn't a Run's id finds no Run.
export const run = query({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    const channel = await requireChannel(ctx);
    const runId = ctx.db.normalizeId("runs", args.runId);
    const run = runId && (await ctx.db.get(runId));
    if (!run || run.channelId !== channel._id || run.removed) {
      return null;
    }
    return {
      ...(await summary(ctx, run)),
      active: run._id === channel.activeRunId,
    };
  },
});

// Reads only the Run and its Encounters' stored counts, never the Death log.
async function summary(ctx: QueryCtx, run: Doc<"runs">) {
  const encounters = await encountersInRun(ctx, run._id);
  const total = totalOf(encounters);
  return {
    _id: run._id,
    characterName: run.characterName,
    total,
    mismatch: await mismatchOf(ctx, run, total),
    // When the next Death can be recorded, for the Panel to wait out.
    lastDeathAt: run.lastDeathAt ?? null,
    archived: run.archived ?? false,
    // Each Tag's tally, removed Tags left out.
    tallies: await tagTallies(ctx, run),
    currentEncounterId: await currentEncounter(ctx, run._id),
    encounters: encounters.map(
      ({ _id, kind, bossId, name, nickname, deathCount, defeated, hidden }) => ({
        _id,
        kind,
        bossId,
        name,
        nickname: nickname ?? null,
        deathCount,
        defeated: defeated ?? false,
        hidden: hidden ?? false,
      }),
    ),
  };
}

// How many more Deaths the Run has than the Save Total the Watcher last
// reported for it. None in a Manual channel, before the Watcher has reported
// for the Run, while the save has as many, or once it's archived and can't
// be cleared.
async function mismatchOf(ctx: QueryCtx, run: Doc<"runs">, total: number) {
  if (
    run.archived ||
    run.reportedTotal === undefined ||
    total <= run.reportedTotal ||
    !(await isWatched(ctx, run.channelId))
  ) {
    return null;
  }
  return total - run.reportedTotal;
}

// What the feed shows of a Death.
async function feedEntry(
  ctx: QueryCtx,
  death: Doc<"deaths">,
  gravityId: Id<"tags"> | undefined,
) {
  const encounter = await ctx.db.get(death.encounterId);
  return {
    _id: death._id,
    _creationTime: death._creationTime,
    encounterId: death.encounterId,
    encounterName: encounter?.name,
    encounterNickname: encounter?.nickname ?? null,
    // Removed Tags too: the Panel shows only those it knows.
    tagIds: tagsOf(death, gravityId),
  };
}

// The active Run's Deaths, newest first, leaving out removed ones. Those are
// filtered as the page is read, so many removed Deaths can't leave a page
// empty.
export const deathFeed = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const channel = await requireChannel(ctx);
    if (!channel.activeRunId) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    const deaths = await ctx.db
      .query("deaths")
      .withIndex("by_run", (q) => q.eq("runId", channel.activeRunId!))
      .order("desc")
      .filter((q) => q.neq(q.field("removed"), true))
      .paginate(paginationOpts);
    const gravityId = (await findGravityTag(ctx, channel._id))?._id;
    return {
      ...deaths,
      page: await Promise.all(
        deaths.page.map((death) => feedEntry(ctx, death, gravityId)),
      ),
    };
  },
});
