import { ConvexError, v, type Infer } from "convex/values";
import {
  action,
  httpAction,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  liveRunsNamed,
  requireActor,
  requireActorsRun,
  requireChannel,
  requireOwner,
  WATCHER_ID,
} from "./channels";
import { bindingOf, recordChange, type Effect } from "./changes";
import { topUpDeathsAs } from "./deaths";
import { findBoss } from "./bosses";
import { lastPlace } from "./currentEncounter";
import { bossEncounter, defeatedEffects } from "./encounters";
import { playTime as playTimeValidator } from "./schema";

type PlayTime = Infer<typeof playTimeValidator>;

// The App sends a heartbeat every 30 seconds while the game is running.
export const OFFLINE_AFTER_MS = 90_000;

function toHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return toHex(new Uint8Array(digest));
}

// Returns the token once. Only its hash is stored, so it can't be shown
// again, and creating a new one revokes the old one. An action, since only
// an action has real randomness.
export const createToken = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
    await ctx.runMutation(internal.watcher.replaceToken, {
      tokenHash: await hashToken(token),
    });
    return token;
  },
});

export const replaceToken = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const { channel } = await requireOwner(ctx);
    await forgetToken(ctx, channel._id);
    await ctx.db.insert("watcherTokens", { channelId: channel._id, tokenHash });
  },
});

// The Watcher's reports are refused until the Streamer creates a new token,
// and the channel is Manual again.
export const revokeToken = mutation({
  args: {},
  handler: async (ctx) => {
    const { channel } = await requireOwner(ctx);
    await forgetToken(ctx, channel._id);
  },
});

// Whether the channel is Watched. The token itself can't be read back.
export const hasToken = query({
  args: {},
  handler: async (ctx) => {
    const { channel } = await requireOwner(ctx);
    return await isWatched(ctx, channel._id);
  },
});

function tokenOf(ctx: QueryCtx, channelId: Id<"channels">) {
  return ctx.db
    .query("watcherTokens")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .unique();
}

// Whether the channel has a Watcher token. One without is Manual.
export async function isWatched(ctx: QueryCtx, channelId: Id<"channels">) {
  return (await tokenOf(ctx, channelId)) !== null;
}

// Along with what its reports said, Save Totals and Play Times included, so a
// new token starts Offline and with no Mismatch, not from the old one's
// reports, which are now refused. The Defeat Flags are kept, so a Defeated a
// Mod undid isn't marked again by the new token's first report.
async function forgetToken(ctx: MutationCtx, channelId: Id<"channels">) {
  const runs = await ctx.db
    .query("runs")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .collect();
  for (const run of runs) {
    if (run.reportedTotal !== undefined || run.playTime !== undefined) {
      await ctx.db.patch(run._id, {
        reportedTotal: undefined,
        playTime: undefined,
      });
    }
  }
  for (const record of [
    await tokenOf(ctx, channelId),
    await heartbeatOf(ctx, channelId),
    await connectionOf(ctx, channelId),
  ]) {
    if (record) {
      await ctx.db.delete(record._id);
    }
  }
}

// What the Panel shows of the Watcher. Null while the channel is Manual.
export const status = query({
  args: {},
  handler: async (ctx) => {
    const channel = await requireChannel(ctx);
    if (!(await isWatched(ctx, channel._id))) {
      return null;
    }
    const connection = await connectionOf(ctx, channel._id);
    return {
      online: connection?.online ?? false,
      since: connection?.since ?? null,
      characterName: connection?.characterName ?? null,
      // Whether to offer creating a Run for the character being played,
      // which nothing is reported for until there's one.
      needsRun:
        !!connection?.online &&
        (await liveRunsNamed(ctx, channel._id, connection.characterName))
          .length === 0,
      // The Run a Mod can rebind to the character being played.
      otherCharacterRunId:
        (await otherCharacterRun(ctx, channel._id))?.run._id ?? null,
    };
  },
});

function heartbeatOf(ctx: QueryCtx, channelId: Id<"channels">) {
  return ctx.db
    .query("watcherHeartbeats")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .unique();
}

// When the Watcher last reported, heartbeats included. Null if it hasn't
// since its token was created.
export async function lastReportAt(ctx: QueryCtx, channelId: Id<"channels">) {
  return (await heartbeatOf(ctx, channelId))?.lastReportAt ?? null;
}

function connectionOf(ctx: QueryCtx, channelId: Id<"channels">) {
  return ctx.db
    .query("watcherConnections")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .unique();
}

// A report keeps the Watcher Online, says which character is being played,
// follows that character's Run, tops its Deaths up to the Save Total and
// keeps that Save Total. A Save Total that drops removes nothing. A Defeat
// Flag newly set marks its boss Defeated. A Play Time is kept on that Run,
// and none clears every Run's.
export const report = internalMutation({
  args: {
    tokenHash: v.string(),
    slot: v.number(),
    characterName: v.string(),
    total: v.number(),
    defeatFlags: v.array(v.number()),
    playTime: v.optional(playTimeValidator),
  },
  handler: async (
    ctx,
    { tokenHash, slot, total, defeatFlags, playTime, ...args },
  ) => {
    // Trimmed as a Run's name is, so the Run created from the offer matches.
    const characterName = args.characterName.trim();
    const token = await ctx.db
      .query("watcherTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!token) {
      return "unauthorized" as const;
    }
    const connection = await connectionOf(ctx, token.channelId);
    // Coming Online is the game starting again, which may be on another
    // character.
    const characterChanged =
      !connection?.online ||
      connection.characterName !== characterName ||
      connection.slot !== slot;
    await markSeen(ctx, token.channelId);
    await showOnline(ctx, token.channelId, slot, characterName);
    if (!playTime) {
      await forgetPlayTimes(ctx, token.channelId);
    }
    const run = await runOfCharacter(ctx, token.channelId, slot, characterName);
    if (!run) {
      return "ok" as const;
    }
    if (playTime) {
      await keepPlayTime(ctx, run, playTime);
    }
    // The Run's first report for its slot, before it's bound or once it's
    // rebound.
    const firstReport = run.reportedTotal === undefined;
    await followCharacter(ctx, run, slot, characterChanged);
    // Deaths the save gained while this character wasn't being watched
    // happened before, not now.
    await topUpDeaths(ctx, run, total, firstReport || characterChanged);
    // Only when it changes, so a heartbeat re-runs nothing on the Panel.
    if (run.reportedTotal !== total) {
      await ctx.db.patch(run._id, { reportedTotal: total });
    }
    // Bosses beaten while this character wasn't being watched were beaten
    // before too. It's the first report for the flags, not the slot, since a
    // Run keeps them when its slot is bound again.
    await markKills(
      ctx,
      run,
      defeatFlags,
      run.reportedFlags === undefined || characterChanged,
    );
    return "ok" as const;
  },
});

// "This one is the real X": the Run follows the character of its name being
// played, in its slot, and the one it followed is then the other character.
// It forgets the Defeat Flags and Save Total reported for the old slot, so the
// next report is a first report for the new one. No Deaths are removed: the
// next report tops them up, and shows a Mismatch if its Save Total is
// lower. The Run is made active, as the character being played is now its
// own. One Change, so an undo follows the old character again, with its
// Defeat Flags, and switches back unless the active Run has changed since.
export const rebind = mutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const actor = await requireActor(ctx);
    const run = await requireActorsRun(ctx, actor, runId);
    const other = await otherCharacterRun(ctx, actor.channel._id);
    if (other?.run._id !== run._id) {
      throw new ConvexError(
        `${run.characterName} isn't another character's Run to follow.`,
      );
    }
    await recordChange(ctx, actor, run._id, "rebindRun", [
      {
        kind: "active",
        before: actor.channel.activeRunId ?? null,
        after: run._id,
      },
      {
        kind: "binding",
        before: bindingOf(run),
        after: { slot: other.slot },
      },
    ]);
  },
});

// A running Play Time's heartbeat is off from where the one kept, counted
// on, says it is by about how much later it was received than that one.
const PLAY_TIME_SLACK_SECONDS = 2;

// Only when it changes, so a heartbeat re-runs nothing on the Panel. It's
// received when it last changed.
async function keepPlayTime(
  ctx: MutationCtx,
  run: Doc<"runs">,
  { seconds, running }: PlayTime,
) {
  const kept = run.playTime;
  if (kept?.running === running) {
    const expected = running
      ? kept.seconds + (Date.now() - kept.receivedAt) / 1000
      : kept.seconds;
    if (
      running
        ? Math.abs(seconds - expected) <= PLAY_TIME_SLACK_SECONDS
        : seconds === expected
    ) {
      return;
    }
  }
  await ctx.db.patch(run._id, {
    playTime: { seconds, running, receivedAt: Date.now() },
  });
}

// Play Time is sent only while the Streamer has it on in the App, so a
// report without it, as once it's turned off, forgets every one sent.
async function forgetPlayTimes(ctx: MutationCtx, channelId: Id<"channels">) {
  const runs = await ctx.db
    .query("runs")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .collect();
  for (const run of runs) {
    if (run.playTime !== undefined) {
      await ctx.db.patch(run._id, { playTime: undefined });
    }
  }
}

// The active Run switches to the character's Run only when the character
// being played changes, or there's no active Run, so a Mod's switch by hand
// holds until then.
async function followCharacter(
  ctx: MutationCtx,
  run: Doc<"runs">,
  slot: number,
  characterChanged: boolean,
) {
  if (run.slot === undefined) {
    await ctx.db.patch(run._id, { slot });
  }
  const watcher = await watcherOf(ctx, run.channelId);
  const { channel } = watcher;
  if (!characterChanged && channel.activeRunId) {
    return;
  }
  await recordChange(
    ctx,
    watcher,
    run._id,
    "setActiveRun",
    [{ kind: "active", before: channel.activeRunId ?? null, after: run._id }],
  );
}

// The Watcher as the actor of the Changes it makes.
async function watcherOf(ctx: QueryCtx, channelId: Id<"channels">) {
  return { channel: (await ctx.db.get(channelId))!, twitchId: WATCHER_ID };
}

// A catch-up too large for one mutation goes on at once in the next, so the
// next report doesn't take the rest as Deaths happening now. It goes no
// higher than the Save Total last reported, which may have dropped since.
async function topUpDeaths(
  ctx: MutationCtx,
  run: Doc<"runs">,
  total: number,
  catchUp: boolean,
) {
  const watcher = await watcherOf(ctx, run.channelId);
  const left = await topUpDeathsAs(ctx, watcher, run, total, catchUp);
  if (left > 0 && catchUp) {
    await ctx.scheduler.runAfter(0, internal.watcher.catchUp, {
      runId: run._id,
      total,
    });
  }
}

// Every flag the Watcher has reported for the Run is remembered, and one set
// now but not remembered is a kill, even one made while the App was closed.
// A remembered flag never marks its boss again, even after a restored backup
// unsets it, so a Defeated a Mod undid stays undone. The kills of one report
// are one Change, so a Mod can undo a first report's bosses in one step.
async function markKills(
  ctx: MutationCtx,
  run: Doc<"runs">,
  defeatFlags: number[],
  catchUp: boolean,
) {
  const remembered = new Set(run.reportedFlags ?? []);
  const newFlags = [...new Set(defeatFlags)].filter(
    (flag) => !remembered.has(flag),
  );
  // Only when there are new ones, so a heartbeat re-runs nothing on the
  // Panel.
  if (run.reportedFlags !== undefined && newFlags.length === 0) {
    return;
  }
  await ctx.db.patch(run._id, { reportedFlags: [...remembered, ...newFlags] });
  const kills = newFlags.filter((flag) => findBoss(String(flag)));
  if (kills.length === 0) {
    return;
  }
  // A boss not in the Run is added, placed as one a Mod adds would be. The
  // last place is found once, as a first report may add every boss.
  const firstPlace = await lastPlace(ctx, run._id);
  const added: Effect[] = [];
  const toMark = [];
  for (const flag of kills) {
    const place = firstPlace + added.length;
    const boss = await bossEncounter(ctx, run._id, String(flag), place);
    if (boss.removed) {
      added.push({
        kind: "added",
        encounterId: boss._id,
        before: false,
        after: true,
      });
    }
    // A Mod may have marked it first.
    if (!boss.defeated) {
      toMark.push(boss);
    }
  }
  if (toMark.length === 0) {
    return;
  }
  await recordChange(
    ctx,
    await watcherOf(ctx, run.channelId),
    run._id,
    "markDefeated",
    [...added, ...(await defeatedEffects(ctx, run._id, toMark))],
  );
  // Beaten before, not now, so they have no time and don't count as felled
  // this Stream.
  if (catchUp) {
    for (const boss of toMark) {
      await ctx.db.patch(boss._id, { defeatedAt: undefined });
    }
  }
}

export const catchUp = internalMutation({
  args: { runId: v.id("runs"), total: v.number() },
  handler: async (ctx, { runId, total }) => {
    const run = await ctx.db.get(runId);
    if (run && !run.removed && !run.archived) {
      const latest = Math.min(total, run.reportedTotal ?? total);
      await topUpDeaths(ctx, run, latest, true);
    }
  },
});

// The live Run a character's reports go to: the one bound to its slot, or
// else one of its name not yet bound to any, which the first report binds.
async function runOfCharacter(
  ctx: QueryCtx,
  channelId: Id<"channels">,
  slot: number,
  characterName: string,
) {
  return followingRun(
    await liveRunsNamed(ctx, channelId, characterName),
    slot,
  );
}

// Of the live Runs of a character's name, the one its slot's reports go to.
function followingRun(named: Doc<"runs">[], slot: number) {
  return (
    named.find((run) => run.slot === slot) ??
    named.find((run) => run.slot === undefined) ??
    null
  );
}

// While the character being played is another character of a Run's name,
// in another slot, the Run of that name, and the slot it would follow if
// rebound. Nothing is reported for the character until then. None while
// Offline, or while a Run follows the character.
async function otherCharacterRun(ctx: QueryCtx, channelId: Id<"channels">) {
  const connection = await connectionOf(ctx, channelId);
  if (!connection?.online || connection.slot === undefined) {
    return null;
  }
  const { slot, characterName } = connection;
  const named = await liveRunsNamed(ctx, channelId, characterName);
  if (followingRun(named, slot)) {
    return null;
  }
  // A channel may have two Runs of one name; either can be rebound.
  return named[0] ? { run: named[0], slot } : null;
}

// Only the Overlay's query reads the heartbeat record, and only while the
// Play Time is running, so a heartbeat re-runs nothing else on the Panel.
async function markSeen(ctx: MutationCtx, channelId: Id<"channels">) {
  const heartbeat = await heartbeatOf(ctx, channelId);
  if (heartbeat) {
    await ctx.db.patch(heartbeat._id, { lastReportAt: Date.now() });
  } else {
    await ctx.db.insert("watcherHeartbeats", {
      channelId,
      lastReportAt: Date.now(),
    });
  }
}

// Written only when the Watcher comes Online or the character changes, so
// the Panel's status query doesn't re-run on every heartbeat.
async function showOnline(
  ctx: MutationCtx,
  channelId: Id<"channels">,
  slot: number,
  characterName: string,
) {
  const connection = await connectionOf(ctx, channelId);
  if (connection?.online) {
    if (
      connection.characterName !== characterName ||
      connection.slot !== slot
    ) {
      await ctx.db.patch(connection._id, { characterName, slot });
    }
    return;
  }
  const shown = { online: true, since: Date.now(), characterName, slot };
  if (connection) {
    await ctx.db.patch(connection._id, shown);
  } else {
    await ctx.db.insert("watcherConnections", { channelId, ...shown });
  }
  await ctx.scheduler.runAfter(OFFLINE_AFTER_MS, internal.watcher.checkOnline, {
    channelId,
    since: shown.since,
  });
}

// Scheduled when the Watcher comes Online, and again for as long as it keeps
// reporting. A check from before a revoke belongs to an earlier spell Online
// and ends, so a channel never has more than one waiting.
export const checkOnline = internalMutation({
  args: { channelId: v.id("channels"), since: v.number() },
  handler: async (ctx, { channelId, since }) => {
    const connection = await connectionOf(ctx, channelId);
    const heartbeat = await heartbeatOf(ctx, channelId);
    if (!connection?.online || connection.since !== since || !heartbeat) {
      return;
    }
    const offlineAt = heartbeat.lastReportAt + OFFLINE_AFTER_MS;
    if (Date.now() < offlineAt) {
      await ctx.scheduler.runAt(offlineAt, internal.watcher.checkOnline, {
        channelId,
        since,
      });
    } else {
      await ctx.db.patch(connection._id, { online: false, since: offlineAt });
    }
  },
});

// The App sends reports from its window, whose origin isn't the Panel's.
// The token is sent as a header, never a cookie, so any origin may send one.
const ANY_ORIGIN = { "Access-Control-Allow-Origin": "*" };

function reply(status: number) {
  return new Response(null, { status, headers: ANY_ORIGIN });
}

// The Watcher's only way in. The token is checked inside the mutation, so it
// grants nothing but reporting.
export const reportFromWatcher = httpAction(async (ctx, request) => {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) {
    return reply(401);
  }
  const body = parseReport(await request.json().catch(() => null));
  if (!body) {
    return reply(400);
  }
  const result = await ctx.runMutation(internal.watcher.report, {
    tokenHash: await hashToken(token),
    ...body,
  });
  return reply({ ok: 200, unauthorized: 401 }[result]);
});

// The preflight the App's window sends before each report.
export const allowReports = httpAction(
  async () =>
    new Response(null, {
      status: 204,
      headers: {
        ...ANY_ORIGIN,
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    }),
);

function isPlayTime(value: unknown): value is PlayTime {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  // Counted on between saves, it's rarely a whole number of seconds.
  const { seconds, running } = value as Record<string, unknown>;
  return (
    typeof seconds === "number" &&
    Number.isFinite(seconds) &&
    seconds >= 0 &&
    typeof running === "boolean"
  );
}

// Elden Ring has 10 character slots, and names are at most 16 characters.
// The name bound is looser so an unusual name is never refused.
const SLOT_COUNT = 10;
const MAX_NAME_LENGTH = 64;
// The boss list has about 200 Defeat Flags. The bound is looser so a longer
// list in a newer App is never refused.
const MAX_DEFEAT_FLAGS = 1000;

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function parseReport(body: unknown) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const { slot, characterName, total, defeatFlags, playTime } = body as Record<
    string,
    unknown
  >;
  if (
    !isCount(slot) ||
    slot >= SLOT_COUNT ||
    typeof characterName !== "string" ||
    characterName.length > MAX_NAME_LENGTH ||
    !isCount(total) ||
    !Array.isArray(defeatFlags) ||
    defeatFlags.length > MAX_DEFEAT_FLAGS ||
    !defeatFlags.every(isCount) ||
    (playTime !== undefined && !isPlayTime(playTime))
  ) {
    return null;
  }
  const played = playTime as PlayTime | undefined;
  return {
    slot,
    characterName,
    total,
    defeatFlags: defeatFlags as number[],
    // Only what's known of it is passed on.
    ...(played
      ? { playTime: { seconds: played.seconds, running: played.running } }
      : {}),
  };
}
