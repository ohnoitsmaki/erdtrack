import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { components } from "./_generated/api";
import { displayName, requireOwner, twitchAccount } from "./channels";
import { twitchLogin } from "./twitchLogin";

// Every Mod, oldest first. A pending Mod has no display name until they
// first sign in.
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { channel } = await requireOwner(ctx);
    const mods = await ctx.db
      .query("mods")
      .withIndex("by_channel_login", (q) => q.eq("channelId", channel._id))
      .collect();
    mods.sort((a, b) => a._creationTime - b._creationTime);
    return await Promise.all(
      mods.map(async ({ _id, login, twitchId }) => ({
        _id,
        login,
        displayName: twitchId ? await displayName(ctx, twitchId) : null,
      })),
    );
  },
});

// By Twitch login, since that's what the Streamer knows. The Mod is bound to a
// Twitch user ID when that login first signs in.
export const add = mutation({
  args: { login: v.string() },
  handler: async (ctx, args) => {
    const { channel } = await requireOwner(ctx);
    const login = twitchLogin(args.login);
    if (!login) {
      throw new ConvexError(`"${args.login}" isn't a Twitch login.`);
    }
    if (login === channel.ownerLogin) {
      throw new ConvexError("That's the Streamer's login.");
    }
    const existing = await ctx.db
      .query("mods")
      .withIndex("by_channel_login", (q) =>
        q.eq("channelId", channel._id).eq("login", login),
      )
      .unique();
    if (existing) {
      throw new ConvexError(`${login} is already a Mod.`);
    }
    await ctx.db.insert("mods", { channelId: channel._id, login });
  },
});

// Their sessions are deleted with them, so they're signed out at once.
export const remove = mutation({
  args: { modId: v.id("mods") },
  handler: async (ctx, { modId }) => {
    const { channel } = await requireOwner(ctx);
    const mod = await ctx.db.get(modId);
    if (!mod || mod.channelId !== channel._id) {
      throw new ConvexError("That Mod was already removed.");
    }
    await ctx.db.delete(mod._id);
    if (mod.twitchId !== undefined) {
      await deleteSessions(ctx, mod.twitchId);
    }
  },
});

async function deleteSessions(ctx: MutationCtx, twitchId: string) {
  const account = await twitchAccount(ctx, twitchId);
  if (!account) {
    return;
  }
  // One person has only a few sessions, so one page covers them all.
  await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
    input: {
      model: "session",
      where: [{ field: "userId", value: account.userId }],
    },
    paginationOpts: { cursor: null, numItems: 1000 },
  });
}
