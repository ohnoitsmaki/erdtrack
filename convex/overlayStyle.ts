import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ownerChannel, requireActor, requireChannel } from "./channels";

// The style is checked by the Panel and the Overlay as they read it
// (src/overlay/style.ts), so the backend only keeps it from growing past
// what any real style needs.
const MAX_STYLE_LENGTH = 32_000;
const MAX_PRESET_NAME_LENGTH = 50;
const MAX_PRESETS = 50;

function requireSmall(style: unknown) {
  if (JSON.stringify(style ?? null).length > MAX_STYLE_LENGTH) {
    throw new ConvexError("That style is too big to save.");
  }
}

function presetName(name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_PRESET_NAME_LENGTH) {
    throw new ConvexError(
      `Give the Preset a name of up to ${MAX_PRESET_NAME_LENGTH} characters.`,
    );
  }
  return trimmed;
}

// Public, like the Overlay's counts, since OBS reads it without signing in.
// Null until someone first styles the Overlay, and the default style shows.
export const current = query({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const channel = await ownerChannel(ctx);
    if (!channel) {
      return null;
    }
    const saved = await ctx.db
      .query("overlayStyles")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .unique();
    return saved?.style ?? null;
  },
});

// The Streamer and every Mod can style it. OBS follows each save.
export const save = mutation({
  args: { style: v.any() },
  handler: async (ctx, { style }) => {
    const { channel } = await requireActor(ctx);
    requireSmall(style);
    const saved = await ctx.db
      .query("overlayStyles")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .unique();
    if (saved) {
      await ctx.db.patch(saved._id, { style });
    } else {
      await ctx.db.insert("overlayStyles", { channelId: channel._id, style });
    }
  },
});

// In the order they were first saved.
export const presets = query({
  args: {},
  handler: async (ctx) => {
    const channel = await requireChannel(ctx);
    const saved = await ctx.db
      .query("overlayPresets")
      .withIndex("by_channel_name", (q) => q.eq("channelId", channel._id))
      .collect();
    return saved
      .sort((a, b) => a._creationTime - b._creationTime)
      .map(({ name, style }) => ({ name, style: style as unknown }));
  },
});

// Saving under a name already taken replaces that Preset in its place.
export const savePreset = mutation({
  args: { name: v.string(), style: v.any() },
  handler: async (ctx, args) => {
    const { channel } = await requireActor(ctx);
    const name = presetName(args.name);
    requireSmall(args.style);
    const existing = await ctx.db
      .query("overlayPresets")
      .withIndex("by_channel_name", (q) =>
        q.eq("channelId", channel._id).eq("name", name),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { style: args.style });
      return;
    }
    const count = (
      await ctx.db
        .query("overlayPresets")
        .withIndex("by_channel_name", (q) => q.eq("channelId", channel._id))
        .take(MAX_PRESETS)
    ).length;
    if (count >= MAX_PRESETS) {
      throw new ConvexError(
        `There can be up to ${MAX_PRESETS} Presets. Delete one first.`,
      );
    }
    await ctx.db.insert("overlayPresets", {
      channelId: channel._id,
      name,
      style: args.style,
    });
  },
});

export const deletePreset = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const { channel } = await requireActor(ctx);
    const existing = await ctx.db
      .query("overlayPresets")
      .withIndex("by_channel_name", (q) =>
        q.eq("channelId", channel._id).eq("name", name),
      )
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});
