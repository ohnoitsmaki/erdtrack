import { ConvexError, v, type Infer } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { findBoss } from "./bosses";
import {
  displayName,
  liveRunsNamed,
  requireActor,
  requireActorsRun,
  type Actor,
} from "./channels";
import {
  bossEncounterInRun,
  currentEncounter,
  NOT_IN_RUN,
  switchCurrentEncounter,
} from "./currentEncounter";
import type { binding, effect } from "./schema";
import {
  addToTallies,
  findGravityTag,
  gravityTag,
  roomRefusal,
  tagsAdded,
  tagsOf,
  tally,
} from "./tags";

export type Effect = Infer<typeof effect>;
type Binding = Infer<typeof binding>;

// Which character the Run follows, as a binding effect records it.
export function bindingOf(run: Doc<"runs">): Binding {
  return { slot: run.slot, reportedFlags: run.reportedFlags };
}

// Records one Panel action as a Change and makes its effects. Effects that change nothing are dropped, and a Change with
// none is not recorded.
export async function recordChange(
  ctx: MutationCtx,
  actor: Actor,
  runId: Id<"runs">,
  action: Exclude<Doc<"changes">["action"], "undo">,
  effects: Effect[],
) {
  return await record(ctx, actor, runId, { action }, effects.filter(hasEffect));
}

function hasEffect(effect: Effect) {
  switch (effect.kind) {
    case "death":
      return (
        effect.before.encounterId !== effect.after.encounterId ||
        !sameTags(effect.before.tagIds ?? [], effect.after.tagIds ?? []) ||
        effect.before.gravity !== effect.after.gravity
      );
    case "binding":
      return !sameBinding(effect.before, effect.after);
    default:
      return effect.before !== effect.after;
  }
}

function sameBinding(a: Binding, b: Binding) {
  return (
    a.slot === b.slot &&
    a.reportedFlags?.join() === b.reportedFlags?.join()
  );
}

function sameTags(a: Id<"tags">[], b: Id<"tags">[]) {
  return a.length === b.length && a.every((tagId) => b.includes(tagId));
}

async function record(
  ctx: MutationCtx,
  actor: Actor,
  runId: Id<"runs">,
  fields: Pick<Doc<"changes">, "action" | "undoes">,
  effects: Effect[],
) {
  if (effects.length === 0) {
    return null;
  }
  const refused = await refusal(ctx, runId, effects, { archived: true });
  if (refused) {
    throw new ConvexError(refused);
  }
  for (const effect of effects) {
    await apply(ctx, runId, effect);
  }
  return await ctx.db.insert("changes", {
    runId,
    actorTwitchId: actor.twitchId,
    ...fields,
    effects,
  });
}

// Why the current state refuses making these effects, in order, or null if
// it doesn't. It only reads, so History shows it as well as an undo refusing
// it. An archived Run is checked only when asked for, as History
// would say so on every Change.
//
// Each effect is checked as if those before it were made, since a Change's
// effects can depend on each other: creating a Run makes it live before it's
// made active. Only what the Changes recorded today combine is worked out
// that way, so a new kind of Change with effects that depend on each other
// may need more.
async function refusal(
  ctx: QueryCtx,
  runId: Id<"runs">,
  effects: Effect[],
  { archived }: { archived: boolean },
) {
  const run = (await ctx.db.get(runId))!;
  // An archived Run, or one removed by an undo, takes no Changes but the one
  // bringing it back.
  const bringsBack = effects.some(
    (effect) => effect.kind === "created" || effect.kind === "archived",
  );
  if (!bringsBack && (archived || !run.archived)) {
    const refused = liveRunRefusal(run);
    if (refused) {
      return refused;
    }
  }
  for (const [i, effect] of effects.entries()) {
    const earlier = effects.slice(0, i);
    const refused = await effectRefusal(ctx, run, effect, earlier);
    if (refused) {
      return refused;
    }
  }
  return null;
}

async function effectRefusal(
  ctx: QueryCtx,
  run: Doc<"runs">,
  effect: Effect,
  earlier: Effect[],
): Promise<string | null> {
  switch (effect.kind) {
    case "death": {
      const death = await ctx.db.get(effect.deathId);
      if (!death) {
        return null;
      }
      if (death.removed) {
        return "That Death was removed.";
      }
      const { encounterId } = effect.after;
      if (
        death.encounterId !== encounterId &&
        !(await inRunAfter(ctx, run._id, encounterId, earlier))
      ) {
        return NOT_IN_RUN;
      }
      return null;
    }
    case "current":
      if (
        (await currentAfter(ctx, run._id, earlier)) !== effect.after &&
        !(await inRunAfter(ctx, run._id, effect.after, earlier))
      ) {
        return NOT_IN_RUN;
      }
      return null;
    case "added": {
      const encounter = (await ctx.db.get(effect.encounterId))!;
      return effect.after
        ? await addedAgainRefusal(ctx, run._id, encounter)
        : await removableRefusal(ctx, run._id, encounter, earlier);
    }
    case "recorded": {
      const death = await ctx.db.get(effect.deathId);
      if (!death || !death.removed === effect.after) {
        return null;
      }
      if (
        effect.after &&
        !(await inRunAfter(ctx, run._id, death.encounterId, earlier))
      ) {
        return NOT_IN_RUN;
      }
      return null;
    }
    case "recordedMany": {
      if (!effect.after) {
        return null;
      }
      const deaths = await addedDeaths(ctx, run._id, effect.deathIds);
      for (const encounterId of new Set(deaths.map((d) => d.encounterId))) {
        if (!(await inRunAfter(ctx, run._id, encounterId, earlier))) {
          return NOT_IN_RUN;
        }
      }
      return null;
    }
    case "created":
      return effect.after ? null : await deathsRefusal(ctx, run);
    case "active": {
      // Switching another Run active is recorded in that Run's history, so
      // this one's can't see it. The current state is checked instead.
      const channel = (await ctx.db.get(run.channelId))!;
      if ((channel.activeRunId ?? null) !== effect.before) {
        return "The active Run has changed since.";
      }
      return effect.after === null
        ? null
        : liveRunRefusal(await runAfter(ctx, run, effect.after, earlier));
    }
    // Tags belong to the channel, and Changes to them are recorded in
    // whichever Run was active, so one Run's history can't see another's.
    // The current state is checked instead.
    case "tag": {
      const tag = (await ctx.db.get(effect.tagId))!;
      if (!tag.removed !== effect.before) {
        return effect.before
          ? `${tag.name} was removed since.`
          : `${tag.name} was brought back since.`;
      }
      return effect.after ? await roomRefusal(ctx, tag, tag.name) : null;
    }
    case "tagName": {
      const tag = (await ctx.db.get(effect.tagId))!;
      if (tag.name !== effect.before) {
        return `${effect.before} was renamed since.`;
      }
      return tag.removed ? null : await roomRefusal(ctx, tag, effect.after);
    }
    case "boss":
      return await bossTakenRefusal(ctx, run._id, effect.encounterId, effect.after);
    case "binding":
      return await slotTakenRefusal(ctx, run, effect.after.slot);
    case "archived":
    case "defeated":
    case "nickname":
    case "position":
    case "hidden":
      return null;
  }
}

// The latest of the earlier effects of a kind that match.
function lastOf<K extends Effect["kind"]>(
  earlier: Effect[],
  kind: K,
  matches: (effect: Extract<Effect, { kind: K }>) => boolean = () => true,
) {
  return earlier
    .filter(
      (effect): effect is Extract<Effect, { kind: K }> =>
        effect.kind === kind && matches(effect as Extract<Effect, { kind: K }>),
    )
    .at(-1);
}

// Whether the Encounter is in the Run once the earlier effects are made, as
// adding Deaths at once adds bosses before giving them Deaths.
async function inRunAfter(
  ctx: QueryCtx,
  runId: Id<"runs">,
  encounterId: Id<"encounters">,
  earlier: Effect[],
) {
  const added = lastOf(earlier, "added", (e) => e.encounterId === encounterId);
  if (added) {
    return added.after;
  }
  const encounter = await ctx.db.get(encounterId);
  return !!encounter && encounter.runId === runId && !encounter.removed;
}

async function currentAfter(
  ctx: QueryCtx,
  runId: Id<"runs">,
  earlier: Effect[],
) {
  return (
    lastOf(earlier, "current")?.after ?? (await currentEncounter(ctx, runId))
  );
}

// A Run once the earlier effects, which are all on the Change's own Run, are
// made, as creating a Run brings it in before making it active.
async function runAfter(
  ctx: QueryCtx,
  run: Doc<"runs">,
  runId: Id<"runs">,
  earlier: Effect[],
) {
  if (runId !== run._id) {
    return await ctx.db.get(runId);
  }
  const created = lastOf(earlier, "created");
  const archived = lastOf(earlier, "archived");
  return {
    ...run,
    removed: created ? !created.after : run.removed,
    archived: archived ? archived.after : run.archived,
  };
}

// Moves a record to the effect's after state. Counts move by what the record
// actually was, so they stay the number of Deaths whatever happened before.
// Whether it may is checked beforehand, by `refusal`.
async function apply(ctx: MutationCtx, runId: Id<"runs">, effect: Effect) {
  switch (effect.kind) {
    case "death": {
      const death = await ctx.db.get(effect.deathId);
      if (!death) {
        throw new Error(`Death ${effect.deathId} no longer exists`);
      }
      const { encounterId } = effect.after;
      if (death.encounterId !== encounterId) {
        await addToCount(ctx, death.encounterId, -1);
        await addToCount(ctx, encounterId, 1);
      }
      const gravityId = await gravityTagOf(ctx, runId);
      const before = tagsOf(death, gravityId);
      const after = tagsOf(effect.after, gravityId);
      const deltas = new Map<Id<"tags">, number>();
      tally(deltas, tagsAdded(before, after), 1);
      tally(deltas, tagsAdded(after, before), -1);
      await addToTallies(ctx, runId, deltas);
      await ctx.db.patch(death._id, {
        encounterId,
        tagIds: after,
        gravity: undefined,
      });
      return;
    }
    case "current":
      if ((await currentEncounter(ctx, runId)) !== effect.after) {
        await switchCurrentEncounter(ctx, runId, effect.after);
      }
      return;
    case "added":
      await ctx.db.patch(effect.encounterId, { removed: !effect.after });
      return;
    case "recorded": {
      const death = await ctx.db.get(effect.deathId);
      if (!death) {
        throw new Error(`Death ${effect.deathId} no longer exists`);
      }
      if (!death.removed === effect.after) {
        return;
      }
      const delta = effect.after ? 1 : -1;
      await addToCount(ctx, death.encounterId, delta);
      const deltas = new Map<Id<"tags">, number>();
      tally(deltas, tagsOf(death, await gravityTagOf(ctx, runId)), delta);
      await addToTallies(ctx, runId, deltas);
      await ctx.db.patch(death._id, { removed: !effect.after });
      return;
    }
    case "recordedMany": {
      // A later Change to any of these Deaths blocks undoing this, so they're
      // where adding put them, but their counts still move by what they are.
      // Each count is written once, however many Deaths there are.
      const delta = effect.after ? 1 : -1;
      const moved = new Map<Id<"encounters">, number>();
      const tallied = new Map<Id<"tags">, number>();
      const gravityId = await gravityTagOf(ctx, runId);
      for (const death of await addedDeaths(ctx, runId, effect.deathIds)) {
        if (!death.removed === effect.after) {
          continue;
        }
        const { encounterId } = death;
        moved.set(encounterId, (moved.get(encounterId) ?? 0) + delta);
        tally(tallied, tagsOf(death, gravityId), delta);
        await ctx.db.patch(death._id, { removed: !effect.after });
      }
      for (const [encounterId, by] of moved) {
        await addToCount(ctx, encounterId, by);
      }
      await addToTallies(ctx, runId, tallied);
      return;
    }
    case "defeated":
      // A redo counts as beating it again, since it's applied as new.
      await ctx.db.patch(effect.encounterId, {
        defeated: effect.after,
        defeatedAt: effect.after ? Date.now() : undefined,
      });
      return;
    case "created":
      await ctx.db.patch(runId, { removed: !effect.after });
      return;
    case "archived":
      await ctx.db.patch(runId, { archived: effect.after });
      return;
    case "active": {
      const run = (await ctx.db.get(runId))!;
      await ctx.db.patch(run.channelId, {
        activeRunId: effect.after ?? undefined,
      });
      return;
    }
    case "tag":
      await ctx.db.patch(effect.tagId, { removed: !effect.after });
      return;
    case "tagName":
      await ctx.db.patch(effect.tagId, { name: effect.after });
      return;
    case "nickname":
      await ctx.db.patch(effect.encounterId, {
        nickname: effect.after ?? undefined,
      });
      return;
    case "position":
      await ctx.db.patch(effect.encounterId, {
        position: effect.after ?? undefined,
      });
      return;
    case "hidden":
      await ctx.db.patch(effect.encounterId, {
        hidden: effect.after || undefined,
      });
      return;
    case "boss":
      await ctx.db.patch(effect.encounterId, {
        bossId: effect.after,
        name: bossName(effect.after),
      });
      return;
    case "binding": {
      // Each field is set, so one absent from the after state is cleared.
      const { slot, reportedFlags } = effect.after;
      await ctx.db.patch(runId, {
        slot,
        reportedFlags,
        reportedTotal: undefined,
        // The old slot's, until the next report sets the new slot's.
        playTime: undefined,
      });
      return;
    }
  }
}

function bossName(bossId: string) {
  return findBoss(bossId)?.displayName ?? "a boss no longer in the boss list";
}

async function gravityTagOf(ctx: MutationCtx, runId: Id<"runs">) {
  return await gravityTag(ctx, (await ctx.db.get(runId))!.channelId);
}

// The Deaths added at once, read as one range of the Run's Deaths by
// creation time rather than one read each, since Convex limits the reads of
// a mutation. They were inserted in the order listed, one after another, so
// the range holds them all; any other Death in it is left out.
async function addedDeaths(
  ctx: QueryCtx,
  runId: Id<"runs">,
  deathIds: Id<"deaths">[],
) {
  const [first, last] = await Promise.all([
    ctx.db.get(deathIds[0]!),
    ctx.db.get(deathIds.at(-1)!),
  ]);
  const ids = new Set<Id<"deaths">>(deathIds);
  const deaths = (
    await ctx.db
      .query("deaths")
      .withIndex("by_run", (q) =>
        q
          .eq("runId", runId)
          .gte("_creationTime", first!._creationTime)
          .lte("_creationTime", last!._creationTime),
      )
      .collect()
  ).filter((death) => ids.has(death._id));
  if (deaths.length !== ids.size) {
    throw new Error(`Run ${runId} is missing Deaths that were added at once`);
  }
  return deaths;
}

// Recording a Death doesn't touch the Change creating the Run, so this reads
// the Encounters' counts instead of the Death log.
async function deathsRefusal(ctx: QueryCtx, run: Doc<"runs">) {
  const encounters = await ctx.db
    .query("encounters")
    .withIndex("by_run_kind", (q) => q.eq("runId", run._id))
    .collect();
  return encounters.some((encounter) => encounter.deathCount > 0)
    ? `${run.characterName}'s Run has Deaths now.`
    : null;
}

// A Run that can be active: not archived, and not removed by an undo.
function liveRunRefusal(run: Doc<"runs"> | null) {
  if (!run || run.removed) {
    return "That Run no longer exists.";
  }
  if (run.archived) {
    return `${run.characterName}'s Run is archived.`;
  }
  return null;
}

export async function requireLiveRun(ctx: QueryCtx, runId: Id<"runs">) {
  const run = await ctx.db.get(runId);
  const refused = liveRunRefusal(run);
  if (refused) {
    throw new ConvexError(refused);
  }
  return run!;
}

// A Death recorded in an Encounter doesn't touch the Change adding it, so
// removing an Encounter checks its count and the Current Encounter instead.
// Undoing adding Deaths at once takes them out of the bosses it added before
// removing those.
async function removableRefusal(
  ctx: QueryCtx,
  runId: Id<"runs">,
  encounter: Doc<"encounters">,
  earlier: Effect[],
) {
  let deathCount = encounter.deathCount;
  for (const effect of earlier) {
    if (effect.kind === "recordedMany" && !effect.after) {
      const deaths = await addedDeaths(ctx, runId, effect.deathIds);
      deathCount -= deaths.filter(
        (death) => !death.removed && death.encounterId === encounter._id,
      ).length;
    }
  }
  if (deathCount > 0) {
    return `${encounter.name} has Deaths now.`;
  }
  if ((await currentAfter(ctx, runId, earlier)) === encounter._id) {
    return `${encounter.name} is the Current Encounter.`;
  }
  return null;
}

// A boss added again after an Undo is a new Encounter, so bringing the old
// one back would put the boss in the Run twice.
async function addedAgainRefusal(
  ctx: QueryCtx,
  runId: Id<"runs">,
  encounter: Doc<"encounters">,
) {
  const live =
    encounter.bossId &&
    (await bossEncounterInRun(ctx, runId, encounter.bossId));
  return live && live._id !== encounter._id
    ? `${encounter.name} is in the Run again.`
    : null;
}

// Two live Runs of a name never follow the same character, so an undo
// can't bind a Run to a slot another has been bound to since.
async function slotTakenRefusal(
  ctx: QueryCtx,
  run: Doc<"runs">,
  slot: number | undefined,
) {
  const named = await liveRunsNamed(ctx, run.channelId, run.characterName);
  const taken =
    slot !== undefined &&
    named.some((other) => other._id !== run._id && other.slot === slot);
  return taken
    ? `Another ${run.characterName} Run follows that character since.`
    : null;
}

// An Encounter can't become a boss the Run already has, which would put it
// in the Run twice. Undoing a change back to a boss added again since is
// refused the same way.
async function bossTakenRefusal(
  ctx: QueryCtx,
  runId: Id<"runs">,
  encounterId: Id<"encounters">,
  bossId: string,
) {
  const live = await bossEncounterInRun(ctx, runId, bossId);
  return live && live._id !== encounterId
    ? `${bossName(bossId)} is already in the Run.`
    : null;
}

async function addToCount(
  ctx: MutationCtx,
  encounterId: Id<"encounters">,
  delta: number,
) {
  const encounter = await ctx.db.get(encounterId);
  if (!encounter) {
    throw new Error(`Encounter ${encounterId} no longer exists`);
  }
  await ctx.db.patch(encounterId, {
    deathCount: encounter.deathCount + delta,
  });
}

// The records an effect is on, for spotting two Changes that touched the
// same one.
function touched(effect: Effect): string[] {
  switch (effect.kind) {
    case "death":
    case "recorded":
      return [`death:${effect.deathId}`];
    case "recordedMany":
      return effect.deathIds.map((deathId) => `death:${deathId}`);
    case "current":
      return ["current"];
    case "added":
      return [`added:${effect.encounterId}`];
    case "defeated":
      return [`defeated:${effect.encounterId}`];
    case "created":
      return ["created"];
    case "archived":
      return ["archived"];
    case "active":
      return ["active"];
    case "tag":
      return [`tag:${effect.tagId}`];
    case "tagName":
      return [`tagName:${effect.tagId}`];
    case "nickname":
      return [`nickname:${effect.encounterId}`];
    case "position":
      return [`position:${effect.encounterId}`];
    case "hidden":
      return [`hidden:${effect.encounterId}`];
    case "boss":
      return [`boss:${effect.encounterId}`];
    case "binding":
      return ["binding"];
  }
}

// The records a Change is on. A rebind's switch of the active Run is left
// out, as undoing it lets that switch go once the active Run has changed.
function touchedBy(change: Doc<"changes">) {
  const rebinds = change.effects.some((effect) => effect.kind === "binding");
  return change.effects.flatMap((effect) =>
    rebinds && effect.kind === "active" ? [] : touched(effect),
  );
}

// Works out, from the newest Change back, whether each Change is undone and
// which later Change, not undone, blocks undoing it. A Change is undone when
// an Undo of it is itself not undone, so redo needs nothing extra. A Change
// and the Undo that cancels it block nothing, as together they did nothing.
class HistoryWalk {
  // Each undone Change, by the Undo that undid it.
  private undos = new Map<Id<"changes">, Doc<"changes">>();
  // The later Changes, not undone, that touched each record, nearest last.
  private touchedBy = new Map<string, Doc<"changes">[]>();

  visit(change: Doc<"changes">) {
    const undoneBy = this.undos.get(change._id);
    const keys = touchedBy(change);
    const blockedBy =
      keys
        .flatMap((key) => this.touchedBy.get(key)?.at(-1) ?? [])
        .sort((a, b) => a._creationTime - b._creationTime)[0] ?? null;
    for (const key of keys) {
      const later = this.touchedBy.get(key) ?? [];
      this.touchedBy.set(
        key,
        undoneBy ? later.filter((c) => c !== undoneBy) : [...later, change],
      );
    }
    if (!undoneBy && change.undoes) {
      this.undos.set(change.undoes, change);
    }
    return { undone: undoneBy !== undefined, blockedBy };
  }
}

function newestFirst(ctx: QueryCtx, runId: Id<"runs">) {
  return ctx.db
    .query("changes")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .order("desc");
}

// Reversed in order too, so a Change whose effects depend on each other
// unwinds from its last.
function reversed(effects: Effect[]): Effect[] {
  return effects
    .map((effect) => ({ ...effect, before: effect.after, after: effect.before }))
    .reverse() as Effect[];
}

// What undoing a Change makes. A rebind is undone from the binding as it is
// now, so a redo gives back the Defeat Flags remembered since, and lets its
// switch of the active Run go once the active Run has changed since.
async function undoEffects(ctx: QueryCtx, change: Doc<"changes">) {
  const effects = reversed(change.effects);
  if (!effects.some((effect) => effect.kind === "binding")) {
    return effects;
  }
  const run = (await ctx.db.get(change.runId))!;
  const channel = (await ctx.db.get(run.channelId))!;
  return effects.flatMap((effect): Effect[] => {
    if (effect.kind === "binding") {
      return [{ ...effect, before: bindingOf(run) }];
    }
    if (
      effect.kind === "active" &&
      (channel.activeRunId ?? null) !== effect.before
    ) {
      return [];
    }
    return [effect];
  });
}

// Refused if it's already undone, or a later Change, not undone, touched
// the same Deaths or records.
async function undoChange(
  ctx: MutationCtx,
  actor: Actor,
  change: Doc<"changes">,
  status: ReturnType<HistoryWalk["visit"]>,
) {
  if (status.undone) {
    throw new ConvexError("That Change is already undone.");
  }
  if (status.blockedBy) {
    const by = await displayName(ctx, status.blockedBy.actorTwitchId);
    throw new ConvexError(`Changed since by ${by}.`);
  }
  return await record(
    ctx,
    actor,
    change.runId,
    { action: "undo", undoes: change._id },
    await undoEffects(ctx, change),
  );
}

// Anyone can undo any Change. Undoing an Undo is redo.
export async function undoAs(
  ctx: MutationCtx,
  actor: Actor,
  changeId: Id<"changes">,
) {
  const change = await ctx.db.get(changeId);
  if (!change) {
    throw new ConvexError("That Change no longer exists.");
  }
  await requireActorsRun(ctx, actor, change.runId);
  const walk = new HistoryWalk();
  for await (const later of newestFirst(ctx, change.runId)) {
    const status = walk.visit(later);
    if (later._id === change._id) {
      return await undoChange(ctx, actor, change, status);
    }
  }
  throw new Error(`Change ${changeId} is missing from its Run's history`);
}

export const undo = mutation({
  args: { changeId: v.id("changes") },
  handler: async (ctx, { changeId }) => {
    return await undoAs(ctx, await requireActor(ctx), changeId);
  },
});

// Steps back through the caller's own Changes that aren't undone. Undos are
// skipped, so pressing it again keeps going back rather than redoing.
export async function undoMyLastAs(
  ctx: MutationCtx,
  actor: Actor,
  runId: Id<"runs">,
) {
  await requireActorsRun(ctx, actor, runId);
  const walk = new HistoryWalk();
  for await (const change of newestFirst(ctx, runId)) {
    const status = walk.visit(change);
    if (
      change.actorTwitchId === actor.twitchId &&
      change.action !== "undo" &&
      !status.undone
    ) {
      return await undoChange(ctx, actor, change, status);
    }
  }
  throw new ConvexError("You have nothing left to undo.");
}

export const undoMyLast = mutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    return await undoMyLastAs(ctx, await requireActor(ctx), runId);
  },
});

// How many Changes the history panel shows.
const HISTORY_LENGTH = 50;

// A Run's latest Changes, the active Run's unless another is chosen, newest
// first, each with whether it can be undone right now and, if not, why.
export const history = query({
  args: { runId: v.optional(v.id("runs")) },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const runId = args.runId ?? actor.channel.activeRunId;
    if (!runId) {
      return [];
    }
    await requireActorsRun(ctx, actor, runId);
    const names = new Map<string, Promise<string>>();
    const nameOf = (twitchId: string) => {
      if (!names.has(twitchId)) {
        names.set(twitchId, displayName(ctx, twitchId));
      }
      return names.get(twitchId)!;
    };
    const walk = new HistoryWalk();
    const entries = [];
    for await (const change of newestFirst(ctx, runId)) {
      const { undone, blockedBy } = walk.visit(change);
      const { root, undos } = await rootOf(ctx, change);
      entries.push({
        _id: change._id,
        at: change._creationTime,
        actorName: await nameOf(change.actorTwitchId),
        description: await describe(ctx, root, undos),
        // An Undo is the kind of Change it undid or redid.
        action: root.action,
        isUndo: undos > 0,
        undone,
        blockedBy: blockedBy && (await nameOf(blockedBy.actorTwitchId)),
        // Why undoing it would be refused anyway, the same as pressing Undo.
        refusal:
          undone || blockedBy
            ? null
            : await refusal(ctx, runId, await undoEffects(ctx, change), {
                archived: false,
              }),
      });
      if (entries.length === HISTORY_LENGTH) {
        break;
      }
    }
    return entries;
  },
});

// The Change at the root of an Undo's chain, and how many Undos lead to it.
async function rootOf(ctx: QueryCtx, change: Doc<"changes">) {
  let root = change;
  let undos = 0;
  while (root.undoes) {
    const target = await ctx.db.get(root.undoes);
    if (!target) {
      break;
    }
    root = target;
    undos++;
  }
  return { root, undos };
}

// What a Change did, in words. An Undo is described by the Change at the
// root of its chain: an odd number of Undos undid it, an even number redid it.
async function describe(ctx: QueryCtx, root: Doc<"changes">, undos: number) {
  const what = await describeAction(ctx, root);
  if (undos === 0) {
    return what;
  }
  return `${undos % 2 === 1 ? "Undid" : "Redid"}: ${what}`;
}

async function runName(ctx: QueryCtx, runId: Id<"runs">) {
  return (await ctx.db.get(runId))?.characterName ?? "a deleted character";
}

// "A", "A and B", "A, B and C".
function listed(names: string[]) {
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
    : names[0]!;
}

async function describeAction(ctx: QueryCtx, change: Doc<"changes">) {
  const nameOf = async (encounterId: Id<"encounters">) =>
    (await ctx.db.get(encounterId))?.name ?? "a removed Encounter";
  const [first] = change.effects;
  switch (change.action) {
    case "addEncounter":
      return first?.kind === "added"
        ? `Added ${await nameOf(first.encounterId)}`
        : "Added an Encounter";
    case "setCurrent":
    case "markDefeated": {
      const beaten = await Promise.all(
        change.effects.flatMap((e) =>
          e.kind === "defeated" ? nameOf(e.encounterId) : [],
        ),
      );
      if (beaten.length > 0) {
        return `Marked ${listed(beaten)} Defeated`;
      }
      return first?.kind === "current"
        ? `Current Encounter → ${await nameOf(first.after)}`
        : "Changed the Current Encounter";
    }
    case "createRun":
      return `Created ${await runName(ctx, change.runId)}'s Run`;
    case "archiveRun":
      return `Archived ${await runName(ctx, change.runId)}'s Run`;
    case "rebindRun": {
      const name = await runName(ctx, change.runId);
      return `Rebound ${name}'s Run to another ${name}`;
    }
    case "setActiveRun": {
      const run =
        first?.kind === "active" &&
        first.after !== null &&
        (await ctx.db.get(first.after));
      return run
        ? `Switched to ${run.characterName}`
        : "Switched the active Run";
    }
    case "createTag":
    case "removeTag": {
      const tag = first?.kind === "tag" && (await ctx.db.get(first.tagId));
      const name = tag ? `the ${tag.name} Tag` : "a Tag";
      return change.action === "createTag"
        ? `Created ${name}`
        : `Removed ${name}`;
    }
    case "renameTag":
      return first?.kind === "tagName"
        ? `Renamed the ${first.before} Tag to ${first.after}`
        : "Renamed a Tag";
    case "setNickname": {
      if (first?.kind !== "nickname") {
        return "Changed a Nickname";
      }
      const name = await nameOf(first.encounterId);
      return first.after === null
        ? `Cleared ${name}'s Nickname "${first.before}"`
        : `Nicknamed ${name} "${first.after}"`;
    }
    case "moveEncounter":
      return first?.kind === "position"
        ? `Moved ${await nameOf(first.encounterId)}`
        : "Moved an Encounter";
    case "setHidden": {
      if (first?.kind !== "hidden") {
        return "Changed what the Overlay lists";
      }
      const name = await nameOf(first.encounterId);
      return first.after
        ? `Hid ${name} from the Overlay`
        : `Showed ${name} on the Overlay`;
    }
    case "changeBoss":
      return first?.kind === "boss"
        ? `Changed ${bossName(first.before)} to ${bossName(first.after)}`
        : "Changed a boss";
    case "recordDeath":
    case "removeDeath": {
      const death =
        first?.kind === "recorded" && (await ctx.db.get(first.deathId));
      const where = death ? await nameOf(death.encounterId) : "an Encounter";
      return change.action === "recordDeath"
        ? `Recorded a Death in ${where}`
        : `Removed a Death from ${where}`;
    }
    case "addDeaths": {
      const added = change.effects.find((e) => e.kind === "recordedMany");
      const n = added?.kind === "recordedMany" ? added.deathIds.length : 0;
      return `Added ${n} ${n === 1 ? "Death" : "Deaths"}`;
    }
    case "updateDeaths":
    case "undo": {
      const deaths = change.effects.flatMap((e) =>
        e.kind === "death" ? e : [],
      );
      const parts = [];
      const moved = deaths.filter(
        (e) => e.before.encounterId !== e.after.encounterId,
      );
      const targets = new Set(moved.map((e) => e.after.encounterId));
      if (targets.size === 1) {
        parts.push(`→ ${await nameOf([...targets][0]!)}`);
      } else if (targets.size > 1) {
        parts.push("reassigned");
      }
      parts.push(...(await describeTagging(ctx, change.runId, deaths)));
      const n = deaths.length;
      return `${n} ${n === 1 ? "Death" : "Deaths"} ${parts.join(", ")}`;
    }
  }
}

// The Tags a Change put on Deaths, then those it took off.
async function describeTagging(
  ctx: QueryCtx,
  runId: Id<"runs">,
  deaths: Extract<Effect, { kind: "death" }>[],
) {
  const run = await ctx.db.get(runId);
  const gravityId = run
    ? (await findGravityTag(ctx, run.channelId))?._id
    : undefined;
  const added = new Set<Id<"tags">>();
  const taken = new Set<Id<"tags">>();
  for (const { before, after } of deaths) {
    const was = tagsOf(before, gravityId);
    const is = tagsOf(after, gravityId);
    tagsAdded(was, is).forEach((tagId) => added.add(tagId));
    tagsAdded(is, was).forEach((tagId) => taken.add(tagId));
  }
  const nameOf = async (tagId: Id<"tags">) =>
    (await ctx.db.get(tagId))?.name ?? "a removed Tag";
  return [
    ...(await Promise.all([...added].map(nameOf))),
    ...(await Promise.all([...taken].map(nameOf))).map((name) => `not ${name}`),
  ];
}
