import { ConvexError } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireActor, requireChannel } from "./channels";
import { encountersInRun } from "./currentEncounter";

// The Stream runs from when a Mod starts it to when one ends it, for the
// channel rather than a Run. It isn't a Change, like managing Mods isn't.
export const start = mutation({
  args: {},
  handler: async (ctx) => {
    const { channel } = await requireActor(ctx);
    if (channel.streamStartedAt !== undefined) {
      throw new ConvexError("The Stream has already started.");
    }
    await ctx.db.patch(channel._id, { streamStartedAt: Date.now() });
  },
});

export const end = mutation({
  args: {},
  handler: async (ctx) => {
    const { channel } = await requireActor(ctx);
    if (channel.streamStartedAt === undefined) {
      throw new ConvexError("The Stream has already ended.");
    }
    await ctx.db.patch(channel._id, { streamStartedAt: undefined });
  },
});

// The Stream going now, for the Panel, or null while there's none.
export const current = query({
  args: {},
  handler: async (ctx) => {
    const channel = await requireChannel(ctx);
    if (channel.streamStartedAt === undefined) {
      return null;
    }
    return {
      startedAt: channel.streamStartedAt,
      deaths: await streamDeaths(ctx, channel),
    };
  },
});

// The channel's Runs, as the character can change mid-stream.
async function runsOf(ctx: QueryCtx, channel: Doc<"channels">) {
  const runs = await ctx.db
    .query("runs")
    .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
    .collect();
  return runs.filter(({ removed }) => !removed);
}

// The Deaths recorded since the Stream started, in any of the channel's
// Runs. Deaths added many at once to catch up don't count: they happened
// before. Null while there's no Stream.
export async function streamDeaths(ctx: QueryCtx, channel: Doc<"channels">) {
  const startedAt = channel.streamStartedAt;
  if (startedAt === undefined) {
    return null;
  }
  let count = 0;
  for (const run of await runsOf(ctx, channel)) {
    const deaths = await ctx.db
      .query("deaths")
      .withIndex("by_run_recordedAt", (q) =>
        q.eq("runId", run._id).gte("recordedAt", startedAt),
      )
      .collect();
    count += deaths.filter(({ removed }) => !removed).length;
  }
  return count;
}

// The bosses marked Defeated since the Stream started, in any of the
// channel's Runs, besides those a Mod hid, as the Overlay's Defeated leaves
// them out. Those marked while catching up don't count. Null while there's
// no Stream.
export async function streamFelled(ctx: QueryCtx, channel: Doc<"channels">) {
  const startedAt = channel.streamStartedAt;
  if (startedAt === undefined) {
    return null;
  }
  let count = 0;
  for (const run of await runsOf(ctx, channel)) {
    count += (await encountersInRun(ctx, run._id)).filter(
      ({ defeated, defeatedAt, hidden }) =>
        defeated && !hidden && (defeatedAt ?? 0) >= startedAt,
    ).length;
  }
  return count;
}

// When the latest Death recorded since the Stream started was, in any of the
// channel's Runs, or null while there's no Stream or it's had none. A Death
// removed by mistake doesn't count, so the time goes back to the one before
// it. Deaths added many at once to catch up don't count, like for the
// Stream's Deaths.
export async function streamLatestDeathAt(
  ctx: QueryCtx,
  channel: Doc<"channels">,
) {
  const startedAt = channel.streamStartedAt;
  if (startedAt === undefined) {
    return null;
  }
  let latestAt: number | null = null;
  for (const run of await runsOf(ctx, channel)) {
    const latest = ctx.db
      .query("deaths")
      .withIndex("by_run_recordedAt", (q) =>
        q.eq("runId", run._id).gte("recordedAt", startedAt),
      )
      .order("desc");
    for await (const death of latest) {
      if (!death.removed) {
        latestAt = Math.max(latestAt ?? 0, death.recordedAt!);
        break;
      }
    }
  }
  return latestAt;
}
