import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireActor, requireChannel, type Actor } from "./channels";
import { recordChange } from "./changes";
import { MAX_TAG_NAME_LENGTH, MAX_TAGS } from "./tagLimits";


// The channel's Gravity Tag, once it's been made.
export async function findGravityTag(ctx: QueryCtx, channelId: Id<"channels">) {
  return await ctx.db
    .query("tags")
    .withIndex("by_channel_gravity", (q) =>
      q.eq("channelId", channelId).eq("gravity", true),
    )
    .first();
}

// Makes Gravity if the channel has none yet.
export async function gravityTag(ctx: MutationCtx, channelId: Id<"channels">) {
  const existing = await findGravityTag(ctx, channelId);
  return (
    existing?._id ??
    (await ctx.db.insert("tags", { channelId, name: "Gravity", gravity: true }))
  );
}

// Run after each deploy, so channels made before Tags have Gravity too.
export const makeGravityTags = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const channel of await ctx.db.query("channels").collect()) {
      await gravityTag(ctx, channel._id);
    }
  },
});

// A Death's Tags, or what an effect says they were. Deaths and Changes from
// before Tags carry only whether they were tagged Gravity.
export function tagsOf(
  state: { tagIds?: Id<"tags">[]; gravity?: boolean },
  gravityId: Id<"tags"> | undefined,
): Id<"tags">[] {
  if (state.tagIds) {
    return state.tagIds;
  }
  return state.gravity && gravityId ? [gravityId] : [];
}

// How many of a Run's Deaths carry each Tag. A Run from before Tags kept
// only the Gravity tally.
export function talliesOf(run: Doc<"runs">, gravityId: Id<"tags"> | undefined) {
  const tallies = new Map(
    (run.tagCounts ?? []).map(({ tagId, count }) => [tagId, count]),
  );
  if (run.gravityCount && gravityId && !tallies.has(gravityId)) {
    tallies.set(gravityId, run.gravityCount);
  }
  return tallies;
}

// Each of the channel's Tags that isn't removed, with the Run's tally.
export async function tagTallies(ctx: QueryCtx, run: Doc<"runs">) {
  const gravity = await findGravityTag(ctx, run.channelId);
  const counted = talliesOf(run, gravity?._id);
  return (await liveTags(ctx, run.channelId)).map((tag) => ({
    tagId: tag._id,
    name: tag.name,
    gravity: tag.gravity ?? false,
    count: counted.get(tag._id) ?? 0,
  }));
}

// The Tags in `after` that aren't in `before`.
export function tagsAdded(before: Id<"tags">[], after: Id<"tags">[]) {
  return after.filter((tagId) => !before.includes(tagId));
}

// Adds `by` to the tally of each of `tagIds`.
export function tally(
  deltas: Map<Id<"tags">, number>,
  tagIds: Id<"tags">[],
  by: number,
) {
  for (const tagId of tagIds) {
    deltas.set(tagId, (deltas.get(tagId) ?? 0) + by);
  }
}

// Removed Tags keep their tallies, so bringing one back shows the right one.
export async function addToTallies(
  ctx: MutationCtx,
  runId: Id<"runs">,
  deltas: Map<Id<"tags">, number>,
) {
  if ([...deltas.values()].every((delta) => delta === 0)) {
    return;
  }
  const run = (await ctx.db.get(runId))!;
  const tallies = talliesOf(run, await gravityTag(ctx, run.channelId));
  for (const [tagId, delta] of deltas) {
    tallies.set(tagId, (tallies.get(tagId) ?? 0) + delta);
  }
  await ctx.db.patch(runId, {
    tagCounts: [...tallies]
      .filter(([, count]) => count !== 0)
      .map(([tagId, count]) => ({ tagId, count })),
    gravityCount: undefined,
  });
}

// The channel's Tags that aren't removed: Gravity first, then in the order
// they were made.
export async function liveTags(ctx: QueryCtx, channelId: Id<"channels">) {
  const tags = await ctx.db
    .query("tags")
    .withIndex("by_channel_gravity", (q) => q.eq("channelId", channelId))
    .collect();
  return tags
    .filter((tag) => !tag.removed)
    .sort(
      (a, b) =>
        Number(b.gravity ?? false) - Number(a.gravity ?? false) ||
        a._creationTime - b._creationTime,
    );
}

// Names are unique among the channel's Tags regardless of case, and there
// are at most MAX_TAGS. Checked whenever a Tag is brought in or renamed, by
// a Change or its undo. Returns why there's no room, or null.
export async function roomRefusal(ctx: QueryCtx, tag: Doc<"tags">, name: string) {
  const others = (await liveTags(ctx, tag.channelId)).filter(
    (other) => other._id !== tag._id,
  );
  if (others.some((other) => other.name.toLowerCase() === name.toLowerCase())) {
    return `There's already a Tag named ${name}.`;
  }
  if (tag.removed && others.length >= MAX_TAGS) {
    return `A channel can have at most ${MAX_TAGS} Tags.`;
  }
  return null;
}

// A Tag of the actor's channel that isn't removed.
export async function requireActorsTag(
  ctx: QueryCtx,
  actor: Actor,
  tagId: Id<"tags">,
) {
  const tag = await ctx.db.get(tagId);
  if (!tag || tag.channelId !== actor.channel._id) {
    throw new ConvexError("That Tag no longer exists.");
  }
  if (tag.removed) {
    throw new ConvexError("That Tag was removed.");
  }
  return tag;
}

function tagName(name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_TAG_NAME_LENGTH) {
    throw new ConvexError(
      `A Tag needs a name of 1 to ${MAX_TAG_NAME_LENGTH} characters.`,
    );
  }
  return trimmed;
}

// Tags belong to no one Run, so changing them is recorded in the active
// Run's history.
function activeRunOf(actor: Actor) {
  const runId = actor.channel.activeRunId;
  if (!runId) {
    throw new ConvexError("Tags can't be changed while there's no active Run.");
  }
  return runId;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const channel = await requireChannel(ctx);
    return (await liveTags(ctx, channel._id)).map(({ _id, name, gravity }) => ({
      _id,
      name,
      gravity: gravity ?? false,
    }));
  },
});

// Inserted removed, and the Change creating it is what shows it, so undo and
// redo work like any other Change.
export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const actor = await requireActor(ctx);
    const runId = activeRunOf(actor);
    // Made first, so its name is taken.
    await gravityTag(ctx, actor.channel._id);
    const tagId = await ctx.db.insert("tags", {
      channelId: actor.channel._id,
      name: tagName(name),
      removed: true,
    });
    await recordChange(ctx, actor, runId, "createTag", [
      { kind: "tag", tagId, before: false, after: true },
    ]);
    return tagId;
  },
});

export const rename = mutation({
  args: { tagId: v.id("tags"), name: v.string() },
  handler: async (ctx, { tagId, name }) => {
    const actor = await requireActor(ctx);
    const runId = activeRunOf(actor);
    const tag = await requireActorsTag(ctx, actor, tagId);
    await recordChange(ctx, actor, runId, "renameTag", [
      { kind: "tagName", tagId, before: tag.name, after: tagName(name) },
    ]);
  },
});

// Deaths keep it, but it's hidden from the picker, the tallies and the
// Overlay.
export const remove = mutation({
  args: { tagId: v.id("tags") },
  handler: async (ctx, { tagId }) => {
    const actor = await requireActor(ctx);
    const runId = activeRunOf(actor);
    await requireActorsTag(ctx, actor, tagId);
    await recordChange(ctx, actor, runId, "removeTag", [
      { kind: "tag", tagId, before: true, after: false },
    ]);
  },
});
