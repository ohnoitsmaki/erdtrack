import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// What a Death is: its Encounter and its Tags. Changes recorded before Tags
// carry whether it was tagged Gravity instead.
const deathState = v.object({
  encounterId: v.id("encounters"),
  tagIds: v.optional(v.array(v.id("tags"))),
  gravity: v.optional(v.boolean()),
});

// Which character in the save a Run follows, and the Defeat Flags the
// Watcher remembers for it. Absent fields are ones not yet bound or
// reported. The kept Save Total isn't part of it: it's cleared whenever the
// binding changes, so an undo never brings back one gone stale.
export const binding = v.object({
  slot: v.optional(v.number()),
  reportedFlags: v.optional(v.array(v.number())),
});

// The Play Time as the Watcher reports it: the seconds its clock shows, and
// whether it's counting on.
export const playTime = v.object({
  seconds: v.number(),
  running: v.boolean(),
});

// One thing a Change did, with the state before and after so it can be
// reversed. An Undo stores the reverse of what it undid.
export const effect = v.union(
  v.object({
    kind: v.literal("death"),
    deathId: v.id("deaths"),
    before: deathState,
    after: deathState,
  }),
  v.object({
    kind: v.literal("current"),
    before: v.id("encounters"),
    after: v.id("encounters"),
  }),
  v.object({
    kind: v.literal("added"),
    encounterId: v.id("encounters"),
    before: v.boolean(),
    after: v.boolean(),
  }),
  // Whether a Death is recorded.
  v.object({
    kind: v.literal("recorded"),
    deathId: v.id("deaths"),
    before: v.boolean(),
    after: v.boolean(),
  }),
  // Whether Deaths added at once are recorded.
  v.object({
    kind: v.literal("recordedMany"),
    deathIds: v.array(v.id("deaths")),
    before: v.boolean(),
    after: v.boolean(),
  }),
  v.object({
    kind: v.literal("defeated"),
    encounterId: v.id("encounters"),
    before: v.boolean(),
    after: v.boolean(),
  }),
  // Whether the Run exists, so creating one can be undone.
  v.object({
    kind: v.literal("created"),
    before: v.boolean(),
    after: v.boolean(),
  }),
  // Whether the Run is archived.
  v.object({
    kind: v.literal("archived"),
    before: v.boolean(),
    after: v.boolean(),
  }),
  // The channel's active Run. None once the active Run is archived.
  v.object({
    kind: v.literal("active"),
    before: v.union(v.id("runs"), v.null()),
    after: v.union(v.id("runs"), v.null()),
  }),
  // Whether a Tag is in the channel, so creating and removing one can be
  // undone.
  v.object({
    kind: v.literal("tag"),
    tagId: v.id("tags"),
    before: v.boolean(),
    after: v.boolean(),
  }),
  v.object({
    kind: v.literal("tagName"),
    tagId: v.id("tags"),
    before: v.string(),
    after: v.string(),
  }),
  // A boss's Nickname. None is null.
  v.object({
    kind: v.literal("nickname"),
    encounterId: v.id("encounters"),
    before: v.union(v.string(), v.null()),
    after: v.union(v.string(), v.null()),
  }),
  // Whether an Encounter is left off the Overlay's lists.
  v.object({
    kind: v.literal("hidden"),
    encounterId: v.id("encounters"),
    before: v.boolean(),
    after: v.boolean(),
  }),
  // Where an Encounter is in the Run's order. None is where it was added.
  v.object({
    kind: v.literal("position"),
    encounterId: v.id("encounters"),
    before: v.union(v.number(), v.null()),
    after: v.union(v.number(), v.null()),
  }),
  // Which boss in the boss list a boss Encounter is.
  v.object({
    kind: v.literal("boss"),
    encounterId: v.id("encounters"),
    before: v.string(),
    after: v.string(),
  }),
  // Which character in the save the Run follows.
  v.object({
    kind: v.literal("binding"),
    before: binding,
    after: binding,
  }),
);

export default defineSchema({
  // Every other table is scoped by a channel, so supporting more streamers
  // later is a migration, not a rewrite.
  channels: defineTable({
    ownerLogin: v.string(),
    ownerTwitchId: v.optional(v.string()),
    activeRunId: v.optional(v.id("runs")),
    // When a Mod started the Stream going now. Absent while there's none.
    streamStartedAt: v.optional(v.number()),
    // When a Mod last asked the Overlay to pop out the toughest boss.
    popoutAt: v.optional(v.number()),
  }).index("by_ownerLogin", ["ownerLogin"]),

  // Added by login. Like the Streamer, a Mod is bound to their Twitch user ID
  // the first time that login signs in, and from then on only that ID is the
  // Mod.
  mods: defineTable({
    channelId: v.id("channels"),
    login: v.string(),
    twitchId: v.optional(v.string()),
  })
    .index("by_channel_login", ["channelId", "login"])
    .index("by_channel_twitchId", ["channelId", "twitchId"]),

  // A name Mods give to Deaths, offered in every Run of the channel. Gravity
  // is made for every channel.
  tags: defineTable({
    channelId: v.id("channels"),
    name: v.string(),
    gravity: v.optional(v.boolean()),
    // Set when it's removed, or the Change creating it is undone. It's kept,
    // and Deaths keep it, so history can still name it and an undo can bring
    // it back.
    removed: v.optional(v.boolean()),
  }).index("by_channel_gravity", ["channelId", "gravity"]),

  runs: defineTable({
    channelId: v.id("channels"),
    characterName: v.string(),
    // When its latest Death was recorded, so another can't follow within
    // the cooldown. Absent until it has one.
    lastDeathAt: v.optional(v.number()),
    // How many of the Run's Deaths carry each Tag, kept apart from the
    // Encounter counts. A Tag with none may be missing.
    tagCounts: v.optional(
      v.array(v.object({ tagId: v.id("tags"), count: v.number() })),
    ),
    // The Gravity tally of a Run from before Tags, until its tallies are
    // next written.
    gravityCount: v.optional(v.number()),
    // The save slot of the character the Watcher reports for it, bound by
    // the first report under its name. Absent until then.
    slot: v.optional(v.number()),
    // The Save Total the Watcher last reported for it, so the Panel can
    // show a Mismatch when the Run has more Deaths. Absent until then.
    reportedTotal: v.optional(v.number()),
    // The Defeat Flags the Watcher last reported for it, so a flag newly set
    // is a kill. Absent until its first report.
    reportedFlags: v.optional(v.array(v.number())),
    // The Play Time the Watcher last reported for it, and when the backend
    // received it. Absent unless the Streamer has it on in the App: a report
    // without one clears it from every Run in the channel.
    playTime: v.optional(
      v.object({ ...playTime.fields, receivedAt: v.number() }),
    ),
    // Read-only.
    archived: v.optional(v.boolean()),
    // Set when the Change creating it is undone. It's kept, so a redo can
    // bring it back.
    removed: v.optional(v.boolean()),
  }).index("by_channel", ["channelId"]),

  // Each belongs to one Run and keeps its own count, so summaries never scan
  // the Death log. A boss Encounter keeps its ID in the bundled boss list,
  // but the list itself is never stored.
  encounters: defineTable({
    runId: v.id("runs"),
    kind: v.union(
      v.literal("overworld"),
      v.literal("boss"),
      v.literal("custom"),
    ),
    bossId: v.optional(v.string()),
    name: v.string(),
    deathCount: v.number(),
    // Only ever set on a boss.
    defeated: v.optional(v.boolean()),
    // When it was last marked Defeated, for the order the Overlay shows them
    // in.
    defeatedAt: v.optional(v.number()),
    // What the Overlay shows instead of a boss's name. Only ever set on a
    // boss.
    nickname: v.optional(v.string()),
    // Left off the Overlay's lists, though its Deaths still count toward the
    // Total. Never set on Overworld, which the Overlay style can leave out.
    hidden: v.optional(v.boolean()),
    // Where a Mod moved it in the Run's order, between the places of its
    // neighbours. Until it's moved, its place is when it was added.
    position: v.optional(v.number()),
    // Set when the Change that added it is undone. It's kept, not deleted,
    // so history can still name it and a redo can bring it back.
    removed: v.optional(v.boolean()),
  })
    .index("by_run_kind", ["runId", "kind"])
    .index("by_run_boss", ["runId", "bossId"]),

  // Every time the Current Encounter changed. The latest is current, and a
  // Run with none is in Overworld.
  encounterSwitches: defineTable({
    runId: v.id("runs"),
    encounterId: v.id("encounters"),
    at: v.number(),
  }).index("by_run_at", ["runId", "at"]),

  deaths: defineTable({
    runId: v.id("runs"),
    encounterId: v.id("encounters"),
    tagIds: v.optional(v.array(v.id("tags"))),
    // Whether a Death from before Tags was tagged Gravity, until its Tags
    // are next written.
    gravity: v.optional(v.boolean()),
    // Set when the Change recording it is undone, or a Mod removes it. It's
    // kept, so history can still name it and a redo can bring it back.
    removed: v.optional(v.boolean()),
    // When a Mod pressed Death for it. Absent on Deaths added many at once
    // to catch up, which didn't happen then, and on Deaths from before it
    // was kept.
    recordedAt: v.optional(v.number()),
  })
    .index("by_run", ["runId"])
    .index("by_run_recordedAt", ["runId", "recordedAt"]),

  // Every Panel action, and by whom. Append-only: an Undo is a new Change,
  // and whether a Change is undone is worked out from the Changes after it.
  changes: defineTable({
    runId: v.id("runs"),
    actorTwitchId: v.string(),
    action: v.union(
      v.literal("updateDeaths"),
      v.literal("addEncounter"),
      v.literal("setCurrent"),
      v.literal("markDefeated"),
      v.literal("recordDeath"),
      v.literal("removeDeath"),
      v.literal("addDeaths"),
      v.literal("createRun"),
      v.literal("setActiveRun"),
      v.literal("archiveRun"),
      v.literal("createTag"),
      v.literal("renameTag"),
      v.literal("removeTag"),
      v.literal("setNickname"),
      v.literal("moveEncounter"),
      v.literal("setHidden"),
      v.literal("changeBoss"),
      v.literal("rebindRun"),
      v.literal("undo"),
    ),
    undoes: v.optional(v.id("changes")),
    effects: v.array(effect),
  }).index("by_run", ["runId"]),

  // The Watcher token of a Watched channel. Only its hash is kept, and a
  // channel has at most one. A channel without one is Manual.
  watcherTokens: defineTable({
    channelId: v.id("channels"),
    tokenHash: v.string(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_channel", ["channelId"]),

  // When the Watcher last reported. Written on every report, heartbeats
  // included, so only the Overlay's query reads it, and only while the Play
  // Time is running.
  watcherHeartbeats: defineTable({
    channelId: v.id("channels"),
    lastReportAt: v.number(),
  }).index("by_channel", ["channelId"]),

  // What the Panel shows of the Watcher. Written only when it goes Online or
  // Offline, or the character being played changes, so heartbeats re-run no
  // Panel query.
  watcherConnections: defineTable({
    channelId: v.id("channels"),
    online: v.boolean(),
    since: v.number(),
    characterName: v.string(),
    // The slot of the character being played. Absent on records from before
    // it was kept.
    slot: v.optional(v.number()),
  }).index("by_channel", ["channelId"]),

  // How the Overlay looks, edited in the Panel. A channel has at most one.
  // It's checked as it's read, so a style saved by an older Panel still
  // shows.
  overlayStyles: defineTable({
    channelId: v.id("channels"),
    style: v.any(),
  }).index("by_channel", ["channelId"]),

  // Named Overlay styles to switch between.
  overlayPresets: defineTable({
    channelId: v.id("channels"),
    name: v.string(),
    style: v.any(),
  }).index("by_channel_name", ["channelId", "name"]),
});
