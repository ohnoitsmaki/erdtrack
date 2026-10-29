import { ConvexError, v } from "convex/values";
import { mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { findBoss } from "./bosses";
import { requireActor, requireActorsRun, type Actor } from "./channels";
import { recordChange, type Effect } from "./changes";
import {
  bossEncounterInRun,
  currentEncounter,
  encountersInRun,
  lastPlace,
  NOT_IN_RUN,
  overworldOf,
  placeOf,
  requireEncounterInRun,
} from "./currentEncounter";
import { MAX_ENCOUNTER_NAME_LENGTH } from "./encounterLimits";

async function requireRun(ctx: MutationCtx, runId: Id<"runs">) {
  const actor = await requireActor(ctx);
  return { actor, run: await requireActorsRun(ctx, actor, runId) };
}

// A new Encounter is inserted removed, and the Change adding it to the Run is
// what shows it, so undo and redo work like any other Change. Re-adding one
// already in the Run records nothing.
async function recordAdded(
  ctx: MutationCtx,
  actor: Actor,
  runId: Id<"runs">,
  encounterId: Id<"encounters">,
) {
  const encounter = (await ctx.db.get(encounterId))!;
  await recordChange(ctx, actor, runId, "addEncounter", [
    {
      kind: "added",
      encounterId,
      before: !encounter.removed,
      after: true,
    },
  ]);
}

// The Run's Encounter for a boss, inserted removed if it has none in the
// Run, for a Change to add. One removed by an Undo isn't brought back, so a
// boss added again goes after those added since, like any new one, unless
// a place is given. The name is looked up in the bundled boss list, never in
// the database.
export async function bossEncounter(
  ctx: MutationCtx,
  runId: Id<"runs">,
  bossId: string,
  place?: number,
) {
  const boss = findBoss(bossId);
  if (!boss) {
    throw new ConvexError("That boss isn't in the boss list.");
  }
  const existing = await bossEncounterInRun(ctx, runId, bossId);
  if (existing) {
    return existing;
  }
  const encounterId = await ctx.db.insert("encounters", {
    runId,
    kind: "boss",
    bossId,
    name: boss.displayName,
    deathCount: 0,
    position: place ?? (await lastPlace(ctx, runId)),
    removed: true,
  });
  return (await ctx.db.get(encounterId))!;
}

export const addBoss = mutation({
  args: { runId: v.id("runs"), bossId: v.string() },
  handler: async (ctx, { runId, bossId }) => {
    const { actor, run } = await requireRun(ctx, runId);
    const encounter = await bossEncounter(ctx, run._id, bossId);
    await recordAdded(ctx, actor, run._id, encounter._id);
    return encounter._id;
  },
});

// A name trimmed, refused unless it fits on the Overlay.
function shortName(name: string, needs: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_ENCOUNTER_NAME_LENGTH) {
    throw new ConvexError(
      `${needs} 1 to ${MAX_ENCOUNTER_NAME_LENGTH} characters.`,
    );
  }
  return trimmed;
}

// For anything not in the boss list.
export const addCustom = mutation({
  args: { runId: v.id("runs"), name: v.string() },
  handler: async (ctx, { runId, name }) => {
    const { actor, run } = await requireRun(ctx, runId);
    const encounterId = await ctx.db.insert("encounters", {
      runId: run._id,
      kind: "custom",
      name: shortName(name, "A Custom Encounter needs a name of"),
      deathCount: 0,
      position: await lastPlace(ctx, run._id),
      removed: true,
    });
    await recordAdded(ctx, actor, run._id, encounterId);
    return encounterId;
  },
});

// What the Overlay calls a boss in this Run instead of its name. Null
// clears it. Saving the one it has records nothing.
export const setNickname = mutation({
  args: {
    runId: v.id("runs"),
    encounterId: v.id("encounters"),
    nickname: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { runId, encounterId, nickname }) => {
    const { actor, run } = await requireRun(ctx, runId);
    const encounter = await requireEncounterInRun(ctx, run._id, encounterId);
    if (encounter.kind !== "boss") {
      throw new ConvexError("Only a boss can have a Nickname.");
    }
    await recordChange(ctx, actor, run._id, "setNickname", [
      {
        kind: "nickname",
        encounterId,
        before: encounter.nickname ?? null,
        after: nickname === null ? null : shortName(nickname, "A Nickname needs"),
      },
    ]);
  },
});

// Makes a boss Encounter another boss from the boss list, for one picked by
// mistake, like the wrong one of two fights with the same boss. It keeps its
// Deaths, Nickname, place, Defeated and whether it's current. A boss the Run
// already has is refused. Picking the one it is records nothing.
export const changeBoss = mutation({
  args: {
    runId: v.id("runs"),
    encounterId: v.id("encounters"),
    bossId: v.string(),
  },
  handler: async (ctx, { runId, encounterId, bossId }) => {
    const { actor, run } = await requireRun(ctx, runId);
    const encounter = await requireEncounterInRun(ctx, run._id, encounterId);
    if (encounter.kind !== "boss") {
      throw new ConvexError("Only a boss can be changed to another.");
    }
    if (!findBoss(bossId)) {
      throw new ConvexError("That boss isn't in the boss list.");
    }
    await recordChange(ctx, actor, run._id, "changeBoss", [
      { kind: "boss", encounterId, before: encounter.bossId!, after: bossId },
    ]);
  },
});

// Leaves an Encounter off the Overlay's lists, or puts it back. It stays in
// the Panel, and its Deaths still count toward the Total. Overworld is left
// out by the Overlay style instead.
export const setHidden = mutation({
  args: {
    runId: v.id("runs"),
    encounterId: v.id("encounters"),
    hidden: v.boolean(),
  },
  handler: async (ctx, { runId, encounterId, hidden }) => {
    const { actor, run } = await requireRun(ctx, runId);
    const encounter = await requireEncounterInRun(ctx, run._id, encounterId);
    if (encounter.kind === "overworld") {
      throw new ConvexError(
        "Overworld is left off the List view in the Overlay style.",
      );
    }
    await recordChange(ctx, actor, run._id, "setHidden", [
      {
        kind: "hidden",
        encounterId,
        before: encounter.hidden ?? false,
        after: hidden,
      },
    ]);
  },
});

// Puts an Encounter just before another in the Run's order, or last with
// none. Overworld stays first. Usually only the one moved is written: it
// takes a place between its new neighbours', so theirs stay as they are.
// When there's no room left between them, every Encounter but Overworld is
// given a place again, in the same Change. Moving one to where it is
// records nothing.
export const moveEncounter = mutation({
  args: {
    runId: v.id("runs"),
    encounterId: v.id("encounters"),
    before: v.union(v.id("encounters"), v.null()),
  },
  handler: async (ctx, { runId, encounterId, before }) => {
    const { actor, run } = await requireRun(ctx, runId);
    const encounter = await requireEncounterInRun(ctx, run._id, encounterId);
    const encounters = await encountersInRun(ctx, run._id);
    const others = encounters.filter((other) => other._id !== encounterId);
    const at =
      before === null
        ? others.length
        : others.findIndex((other) => other._id === before);
    if (at === -1) {
      throw new ConvexError(NOT_IN_RUN);
    }
    if (encounter.kind === "overworld" || at === 0) {
      throw new ConvexError("Overworld stays first.");
    }
    if (encounters.findIndex((other) => other._id === encounterId) === at) {
      return;
    }
    const place = between(
      at > 1 ? placeOf(others[at - 1]!) : undefined,
      others[at] && placeOf(others[at]),
    );
    const moved = (inRun: Doc<"encounters">, after: number): Effect => ({
      kind: "position",
      encounterId: inRun._id,
      before: inRun.position ?? null,
      after,
    });
    const order = [...others.slice(1, at), encounter, ...others.slice(at)];
    await recordChange(
      ctx,
      actor,
      run._id,
      "moveEncounter",
      place === null
        ? order.map((inRun, i) => moved(inRun, i + 1))
        : [moved(encounter, place)],
    );
  },
});

// A place after one and before another, either of which may be missing, or
// null if they're too close to tell one between apart.
function between(after: number | undefined, before: number | undefined) {
  if (after === undefined || before === undefined) {
    return after !== undefined ? after + 1 : before! - 1;
  }
  const middle = (after + before) / 2;
  return after < middle && middle < before ? middle : null;
}

// New Deaths go to this Encounter from now on. Choosing the one already
// current records nothing.
export const setCurrent = mutation({
  args: { runId: v.id("runs"), encounterId: v.id("encounters") },
  handler: async (ctx, { runId, encounterId }) => {
    const { actor, run } = await requireRun(ctx, runId);
    const encounter = await requireEncounterInRun(ctx, run._id, encounterId);
    await recordChange(ctx, actor, run._id, "setCurrent", [
      {
        kind: "current",
        before: await currentEncounter(ctx, run._id),
        after: encounter._id,
      },
    ]);
  },
});

// Marks bosses beaten, for a Change. If one was the Current Encounter, that
// goes back to Overworld.
export async function defeatedEffects(
  ctx: QueryCtx,
  runId: Id<"runs">,
  encounters: Doc<"encounters">[],
): Promise<Effect[]> {
  if (encounters.some((encounter) => encounter.kind !== "boss")) {
    throw new ConvexError("Only a boss can be marked Defeated.");
  }
  const current = await currentEncounter(ctx, runId);
  const beaten = encounters.some((encounter) => encounter._id === current);
  return [
    ...encounters.map((encounter) => ({
      kind: "defeated" as const,
      encounterId: encounter._id,
      before: encounter.defeated ?? false,
      after: true,
    })),
    {
      kind: "current",
      before: current,
      after: beaten ? (await overworldOf(ctx, runId))._id : current,
    },
  ];
}

export const markDefeated = mutation({
  args: { encounterId: v.id("encounters") },
  handler: async (ctx, { encounterId }) => {
    const runId = (await ctx.db.get(encounterId))?.runId;
    if (!runId) {
      throw new ConvexError("That Encounter no longer exists.");
    }
    const { actor, run } = await requireRun(ctx, runId);
    const encounter = await requireEncounterInRun(ctx, run._id, encounterId);
    await recordChange(
      ctx,
      actor,
      run._id,
      "markDefeated",
      await defeatedEffects(ctx, run._id, [encounter]),
    );
  },
});
