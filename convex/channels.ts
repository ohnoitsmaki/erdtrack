import { ConvexError, v } from "convex/values";
import { internalMutation, type QueryCtx } from "./_generated/server";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { authComponent } from "./auth";
import { gravityTag } from "./tags";

function ownerLogin() {
  return process.env.OWNER_TWITCH_LOGIN?.toLowerCase();
}

export async function ownerChannel(ctx: QueryCtx) {
  const login = ownerLogin();
  if (!login) {
    return null;
  }
  return await ctx.db
    .query("channels")
    .withIndex("by_ownerLogin", (q) => q.eq("ownerLogin", login))
    .unique();
}

// The Streamer is configured by Twitch login and Mods are added by login, but
// logins can be renamed and reused. So the first time each login signs in,
// it is bound to its Twitch user ID, and from then on only that ID counts.
export const bindOnSignIn = internalMutation({
  args: { twitchId: v.string(), login: v.string() },
  handler: async (ctx, { twitchId, login: anyCaseLogin }) => {
    const login = anyCaseLogin.toLowerCase();
    const channel = await ownerChannel(ctx);
    if (login === ownerLogin()) {
      if (!channel) {
        const channelId = await ctx.db.insert("channels", {
          ownerLogin: login,
          ownerTwitchId: twitchId,
        });
        await gravityTag(ctx, channelId);
      } else if (channel.ownerTwitchId === undefined) {
        await ctx.db.patch(channel._id, { ownerTwitchId: twitchId });
      }
      return;
    }
    const mod =
      channel &&
      (await ctx.db
        .query("mods")
        .withIndex("by_channel_login", (q) =>
          q.eq("channelId", channel._id).eq("login", login),
        )
        .unique());
    if (!mod || mod.twitchId !== undefined) {
      return;
    }
    // A Mod who renamed on Twitch and was added again under the new login
    // keeps one entry, under the login they have now.
    const renamed = await ctx.db
      .query("mods")
      .withIndex("by_channel_twitchId", (q) =>
        q.eq("channelId", mod.channelId).eq("twitchId", twitchId),
      )
      .unique();
    if (renamed) {
      await ctx.db.delete(renamed._id);
    }
    await ctx.db.patch(mod._id, { twitchId });
  },
});

// Who is calling, as far as the Panel is concerned: the Streamer, a Mod, or
// someone who isn't let in.
export async function viewerRole(ctx: QueryCtx) {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) {
    return { status: "signedOut" } as const;
  }
  const account = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "account",
    where: [
      { field: "userId", value: user._id },
      { field: "providerId", value: "twitch" },
    ],
  });
  const channel = await ownerChannel(ctx);
  if (!account || !channel) {
    return { status: "notAuthorized" } as const;
  }
  const twitchId: string = account.accountId;
  const signedIn = { displayName: user.name, twitchId, channel };
  if (channel.ownerTwitchId === twitchId) {
    return { status: "owner", ...signedIn } as const;
  }
  const mod = await ctx.db
    .query("mods")
    .withIndex("by_channel_twitchId", (q) =>
      q.eq("channelId", channel._id).eq("twitchId", twitchId),
    )
    .unique();
  if (!mod) {
    return { status: "notAuthorized" } as const;
  }
  return { status: "mod", ...signedIn } as const;
}

// Who the Watcher's Changes are recorded against. Twitch user IDs are
// numbers, so it's never anyone's.
export const WATCHER_ID = "watcher";

// Someone acting in the Panel, who each Change is recorded against.
export type Actor = { channel: Doc<"channels">; twitchId: string };

// The Streamer or a Mod. Throws for anyone else.
export async function requireActor(ctx: QueryCtx): Promise<Actor> {
  const role = await viewerRole(ctx);
  if (role.status !== "owner" && role.status !== "mod") {
    throw new ConvexError("Only the Streamer and Mods can do this.");
  }
  return { channel: role.channel, twitchId: role.twitchId };
}

// The channel the Panel reads from, for the Streamer or a Mod.
export async function requireChannel(ctx: QueryCtx) {
  return (await requireActor(ctx)).channel;
}

// For what only the Streamer can do: managing Mods and deleting Runs.
export async function requireOwner(ctx: QueryCtx): Promise<Actor> {
  const role = await viewerRole(ctx);
  if (role.status !== "owner") {
    throw new ConvexError("Only the Streamer can do this.");
  }
  return { channel: role.channel, twitchId: role.twitchId };
}

// A Run of the actor's channel.
export async function requireActorsRun(
  ctx: QueryCtx,
  actor: Actor,
  runId: Id<"runs">,
) {
  const run = await ctx.db.get(runId);
  if (!run || run.channelId !== actor.channel._id) {
    throw new ConvexError("That Run no longer exists.");
  }
  return run;
}

// The Better Auth account of a Twitch user, if they've ever signed in.
export async function twitchAccount(ctx: QueryCtx, twitchId: string) {
  return await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "account",
    where: [
      { field: "accountId", value: twitchId },
      { field: "providerId", value: "twitch" },
    ],
  });
}

// A Twitch user's display name as of their latest sign-in, for history.
export async function displayName(ctx: QueryCtx, twitchId: string) {
  if (twitchId === WATCHER_ID) {
    return "Watcher";
  }
  const account = await twitchAccount(ctx, twitchId);
  const user =
    account &&
    (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "_id", value: account.userId }],
    }));
  return user?.name ?? "someone";
}

// The channel's live Runs of a character's name.
export async function liveRunsNamed(
  ctx: QueryCtx,
  channelId: Id<"channels">,
  characterName: string,
) {
  const runs = await ctx.db
    .query("runs")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .collect();
  return runs.filter(
    (run) =>
      !run.removed && !run.archived && run.characterName === characterName,
  );
}
