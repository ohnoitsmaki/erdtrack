import type { QueryCtx, MutationCtx } from "./_generated/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

export async function overworldOf(ctx: QueryCtx, runId: Id<"runs">) {
  const overworld = await ctx.db
    .query("encounters")
    .withIndex("by_run_kind", (q) =>
      q.eq("runId", runId).eq("kind", "overworld"),
    )
    .unique();
  if (!overworld) {
    throw new Error(`Run ${runId} has no Overworld Encounter`);
  }
  return overworld;
}

// The boss's Encounter in the Run, or null if it isn't in it. A boss is in a
// Run at most once, though Encounters of it removed by an Undo are kept.
export async function bossEncounterInRun(
  ctx: QueryCtx,
  runId: Id<"runs">,
  bossId: string,
) {
  const encounters = await ctx.db
    .query("encounters")
    .withIndex("by_run_boss", (q) => q.eq("runId", runId).eq("bossId", bossId))
    .collect();
  return encounters.find((encounter) => !encounter.removed) ?? null;
}

// Where an Encounter is in the Run's order, after Overworld, which is always
// first. One from before the order could be changed has none, and goes by
// when it was added.
export function placeOf(encounter: Doc<"encounters">) {
  return encounter.position ?? encounter._creationTime;
}

function allOf(ctx: QueryCtx, runId: Id<"runs">) {
  return ctx.db
    .query("encounters")
    .withIndex("by_run_kind", (q) => q.eq("runId", runId))
    .collect();
}

// The Run's Encounters, removed ones left out, in the Run's order. Two with
// the same place go in the order they were added.
export async function encountersInRun(ctx: QueryCtx, runId: Id<"runs">) {
  const encounters = (await allOf(ctx, runId)).filter(
    (encounter) => !encounter.removed,
  );
  const rank = (encounter: Doc<"encounters">) =>
    encounter.kind === "overworld" ? -Infinity : placeOf(encounter);
  return encounters.sort(
    (a, b) => rank(a) - rank(b) || a._creationTime - b._creationTime,
  );
}

// The place for a new Encounter: last. Removed ones count too, so one an
// Undo brings back doesn't share it.
export async function lastPlace(ctx: QueryCtx, runId: Id<"runs">) {
  const places = (await allOf(ctx, runId))
    .filter((encounter) => encounter.kind !== "overworld")
    .map(placeOf);
  return Math.max(0, ...places) + 1;
}

export const NOT_IN_RUN = "That Encounter isn't in this Run.";

// An Encounter of the Run that hasn't been removed.
export async function requireEncounterInRun(
  ctx: QueryCtx,
  runId: Id<"runs">,
  encounterId: Id<"encounters">,
) {
  const encounter = await ctx.db.get(encounterId);
  if (!encounter || encounter.runId !== runId || encounter.removed) {
    throw new ConvexError(NOT_IN_RUN);
  }
  return encounter;
}

// The latest switch. Overworld until a Mod sets one.
export async function currentEncounter(ctx: QueryCtx, runId: Id<"runs">) {
  const latest = await ctx.db
    .query("encounterSwitches")
    .withIndex("by_run_at", (q) => q.eq("runId", runId))
    .order("desc")
    .first();
  return latest?.encounterId ?? (await overworldOf(ctx, runId))._id;
}

export async function switchCurrentEncounter(
  ctx: MutationCtx,
  runId: Id<"runs">,
  encounterId: Id<"encounters">,
) {
  await ctx.db.insert("encounterSwitches", {
    runId,
    encounterId,
    at: Date.now(),
  });
}
