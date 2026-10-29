import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { findBoss } from "./bosses";
import { ownerChannel, requireActor } from "./channels";
import { currentEncounter, encountersInRun } from "./currentEncounter";
import {
  streamDeaths,
  streamFelled,
  streamLatestDeathAt,
} from "./streams";
import { tagTallies } from "./tags";
import { lastReportAt } from "./watcher";

// Exactly what the Overlay displays, and nothing more.
// The List view shows every Encounter in the Run, and the Card the Defeated
// bosses in the order they were beaten, both leaving out those a Mod hid. A
// hidden one still shows while it's the Current Encounter, and its Deaths
// still count toward the Total. Each Tag that isn't removed comes
// with its tally, Gravity first. The time of the Stream's latest Death and
// the Stream's Deaths and bosses felled are null while there's no Stream,
// and the time is null too before the Stream's first Death. The time a Mod
// last asked for the toughest boss's Popout is null if none ever has. The
// Play Time is null unless the Streamer has it on in the App. While it's
// running, it comes with when the Watcher last reported, so the Overlay
// stops counting on if the Watcher goes quiet.
export type Overlay = {
  encounter: { name: string; deathCount: number };
  total: number;
  // Gravity's tally, for styles from before Tags, which show only that.
  gravity: number;
  tags: { tagId: string; name: string; count: number; gravity: boolean }[];
  encounters: { name: string; deathCount: number; defeated: boolean }[];
  defeated: { name: string; deathCount: number }[];
  lastDeathAt: number | null;
  streamDeaths: number | null;
  streamFelled: number | null;
  popoutAt: number | null;
  playTime:
    | (NonNullable<Doc<"runs">["playTime"]> & { lastSeenAt: number | null })
    | null;
};

// Public, with no sign-in: OBS can't sign in, and it's all shown on stream
// anyway. Null with no active Run, as there's nothing to show.
export const current = query({
  args: {},
  handler: async (ctx): Promise<Overlay | null> => {
    const channel = await ownerChannel(ctx);
    const run =
      channel?.activeRunId && (await ctx.db.get(channel.activeRunId));
    if (!run) {
      return null;
    }
    const encounter = (await ctx.db.get(await currentEncounter(ctx, run._id)))!;
    // In the Run's order, as in the Panel.
    const encounters = await encountersInRun(ctx, run._id);
    const listed = encounters.filter(({ hidden }) => !hidden);
    // Those beaten before the time was kept come first, in the Run's order.
    const defeated = listed
      .filter(({ defeated }) => defeated)
      .sort((a, b) => (a.defeatedAt ?? 0) - (b.defeatedAt ?? 0));
    const tags = await tagTallies(ctx, run);
    return {
      encounter: {
        name: overlayName(encounter),
        deathCount: encounter.deathCount,
      },
      total: totalOf(encounters),
      gravity: tags.find((tag) => tag.gravity)?.count ?? 0,
      tags: tags.map(({ tagId, name, count, gravity }) => ({
        tagId,
        name,
        count,
        gravity,
      })),
      encounters: listed.map((inRun) => ({
        name: overlayName(inRun),
        deathCount: inRun.deathCount,
        defeated: inRun.defeated ?? false,
      })),
      defeated: defeated.map((beaten) => ({
        name: overlayName(beaten),
        deathCount: beaten.deathCount,
      })),
      lastDeathAt: await streamLatestDeathAt(ctx, channel!),
      streamDeaths: await streamDeaths(ctx, channel!),
      streamFelled: await streamFelled(ctx, channel!),
      popoutAt: channel!.popoutAt ?? null,
      playTime: run.playTime
        ? {
            ...run.playTime,
            lastSeenAt: run.playTime.running
              ? await lastReportAt(ctx, channel!._id)
              : null,
          }
        : null,
    };
  },
});

// Asks the Overlay to pop out the boss with the most Deaths, such as when
// chat asks. Only the time is kept: the Overlay finds the boss from its own
// counts. It isn't a Change, like starting the Stream isn't.
export const popOut = mutation({
  args: {},
  handler: async (ctx) => {
    const { channel } = await requireActor(ctx);
    await ctx.db.patch(channel._id, { popoutAt: Date.now() });
  },
});

// The Total is every recorded Death, in whichever Encounter.
export function totalOf(encounters: Doc<"encounters">[]) {
  return encounters.reduce((sum, { deathCount }) => sum + deathCount, 0);
}

// A boss shows by its Nickname, or else its name alone. Its place and
// region are there to tell bosses apart in the Panel, and are too long for
// the Overlay.
function overlayName({ bossId, name, nickname }: Doc<"encounters">) {
  return nickname ?? (bossId && findBoss(bossId)?.name) ?? name;
}
