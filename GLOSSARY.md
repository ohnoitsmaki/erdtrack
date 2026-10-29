# Erdtrack

A per-boss death tracker for Elden Ring streamers, shown on stream as an Overlay and kept by the Streamer's trusted Mods, who record each death by hand, or by the App reading the save.

## People

**Streamer**:
The person a self-hosted copy belongs to. There is exactly one per copy.
_Avoid_: Owner, admin, streamer account

**Mod**:
A person the Streamer has trusted to manage the tracker. Not necessarily a Twitch channel moderator. The Streamer adds a Mod by Twitch login, and the Mod is bound to their Twitch user ID the first time that login signs in. Mods can do everything in the Panel except manage Mods, delete Runs and manage the Watcher token.
_Avoid_: Moderator, editor, trusted member

## Counting

**Death**:
One death of the player's character, recorded by a Mod, the Watcher or the Spotter. Every Death belongs to exactly one Encounter. A Mod can remove one recorded by mistake.
_Avoid_: Entry, +1, Manual Death

**Cooldown**:
The few seconds after a Death during which no Mod can record another in the same Run, so two Mods pressing for the same death record it once. It follows the Watcher's Deaths too, except a Catch-up, but never refuses the Watcher. It refuses the Spotter as it does a Mod.
_Avoid_: Debounce, lock

**Encounter**:
Something a Death can be assigned to: a boss, a Custom Encounter, or the built-in Overworld. Each belongs to one Run. A Run's Encounters are in the order they were added, after Overworld, until a Mod moves one.
_Avoid_: Bucket, boss (when Overworld is included)

**Custom Encounter**:
An Encounter a Mod creates by name for one Run, for anything not in the boss list.
_Avoid_: Custom boss, other

**Overworld**:
The built-in Encounter for Deaths outside any boss fight, and for Deaths caught up on.
_Avoid_: Other, misc

**Catch-up**:
Deaths added many at once for deaths from before: by a Mod, or by the Watcher for deaths in the save from while the character wasn't being watched. They go in Overworld and aren't this Stream's Deaths.
_Avoid_: Backfill, backlog, import

**Tag**:
A name Mods give to Deaths, for fun, like Gravity or "Birds". It's only a label: a tagged Death still counts toward its Encounter and its Run. Tags belong to the channel and are offered in every Run, and each Run keeps a tally per Tag of its Deaths that carry it.
_Avoid_: Label, category, cause

**Gravity**:
The Tag a Death gets when the player fell. Every channel has it.
_Avoid_: Gravity bucket, fall damage encounter

**Nickname**:
A name Mods give a boss Encounter in one Run, like "red goblin" for Margit, which the Overlay shows instead of the boss's name.
_Avoid_: Alias, display name

**Current Encounter**:
The Encounter that new Deaths are recorded in. It is Overworld unless a Mod or the Spotter has set a boss, and goes back to Overworld when that boss is Defeated, or when the Spotter sees its Name bar go without a death.
_Avoid_: Active boss, selected boss

**Defeated**:
The state of a boss Encounter in a Run once the boss is beaten. A Mod marks it, or the Watcher does when the boss's Defeat Flag is newly set, or the Spotter does on a FELLED message until the save says otherwise. A Mod can undo it.
_Avoid_: Cleared, done, killed

**Hidden**:
The state of an Encounter a Mod has left off the Overlay's lists. It stays in the Panel, and its Deaths still count.
_Avoid_: Removed, archived

**Attempt**:
Which try at a boss not yet Defeated is underway: one more than its Encounter's Deaths.
_Avoid_: Try, pull, run

**Run**:
One character's playthrough, created by the character's name, owning its own per-Encounter counts. In a Watched channel it follows one slot of the save. At most one Run is active at a time.
_Avoid_: Session, character, save

**Stream**:
One stretch of the Streamer streaming, which a Mod starts and ends in the Panel. It belongs to the channel, not a Run. A Catch-up doesn't count toward its Deaths.
_Avoid_: Session, broadcast

**Archived**:
The state of a finished Run: read-only and still viewable. Only an Archived Run can be deleted, and only by the Streamer.
_Avoid_: Closed, finished, done

## The save

**App**:
The program on the Streamer's PC that holds the Watcher.
_Avoid_: Desktop app, client, tracker

**Watcher**:
The part of the App that reads the save and reports to the backend. It's also the actor of the Changes those reports make.
_Avoid_: Reader, bot, sync

**Spotter**:
The part of the App that reads the game's screen, in a Watched channel whose Streamer has turned it on. It's also the actor of the Changes it makes. It never outranks the save.
_Avoid_: OCR, vision, screen reader, Watcher (for what it does)

**Name bar**:
A boss's health bar in the game, with its name. A fight can show several at once, and a boss can change its name partway through.
_Avoid_: Boss bar, health bar, HP bar

**YOU DIED**:
The text the game shows when the player's character dies.
_Avoid_: Death screen, death banner

**FELLED message**:
The text the game shows when a boss is beaten: ENEMY FELLED, GREAT ENEMY FELLED, DEMIGOD FELLED, LEGEND FELLED or GOD SLAIN.
_Avoid_: Banner, victory text, kill message

**Watcher token**:
The secret the Streamer creates in the Panel and pastes into the App, which its reports carry. Only the Streamer can create, replace or revoke it.
_Avoid_: API key, password, app token

**Watched**:
The mode of a channel that has a Watcher token: the save is the source of truth, and Mods can still record Deaths by hand.
_Avoid_: Automatic, connected, synced

**Manual**:
The mode of a channel with no Watcher token: Mods record every Death by hand.
_Avoid_: Offline, unwatched

**Online**:
The state of the Watcher while Elden Ring is running and it's reporting. **Offline** otherwise.
_Avoid_: Connected, live

**Slot**:
One of the characters in the save. A Run follows the slot of the first character the Watcher reported under its name.
_Avoid_: Save, profile, character index

**Total**:
How many Deaths a Run has, across all its Encounters.
_Avoid_: Death count, Run count

**Save Total**:
A character's lifetime death count, as the save records it. It's the source of truth for a Watched Run's Total.
_Avoid_: Save count, game total, save deaths

**Play Time**:
A character's time played, as the save records it and the load screen shows it, counted on between saves. The Watcher sends it only while the Streamer has turned it on in the App, and turning it off forgets every one sent. Each Run keeps the last one reported for it.
_Avoid_: Playtime, time played, session time

**Mismatch**:
How many more Deaths a Run's Total has than the Save Total last reported for it. Never negative: a Run with fewer is just topped up.
_Avoid_: Drift, discrepancy, error

**Defeat Flag**:
The save's record that a boss was beaten. Each boss in the boss list has a flag of its own, and a fight the save records as won with one flag, like Radagon and the Elden Beast, is one boss.
_Avoid_: Boss flag, kill flag, event flag

**Other character**:
A character in another slot with the name of a Run that follows a different slot, like a practice copy. Nothing is recorded for it until a Mod rebinds the Run to it.
_Avoid_: Duplicate, clone, impostor

**Rebind**:
Making a Run follow the Other character's slot instead, as a Change. Its next report counts as the first for that slot.
_Avoid_: Relink, switch character

## Editing

**Change**:
One action by one person, or by the Watcher, which may touch several Deaths or Encounters at once. Every Change is kept.
_Avoid_: Edit, entry, log line

**Effect**:
One record a Change alters, from its state before to its state after.
_Avoid_: Edit, step, operation

**Undo**:
A Change that reverts an earlier Change. Undoing an Undo is a redo.
_Avoid_: Delete, rollback

## Surfaces

**Panel**:
The signed-in view where the Streamer and Mods manage Runs, record and assign Deaths, and style the Overlay.
_Avoid_: Dashboard, control panel, admin

**Overlay**:
The read-only view shown on stream, which the Panel serves publicly at `/overlay`, for a Browser source in OBS or a StreamElements widget. It never shows a Mismatch.
_Avoid_: Widget, browser source

**List view**:
A second Overlay, at `/overlay/list`, showing every Encounter in the Run that isn't Hidden, with its count and a mark on each Defeated boss.
_Avoid_: Boss list, tracker view

**Popout**:
A stat or a Defeated boss with its count, shown wide along the bottom of the Banner or the Framed banner while no boss is being fought, at the times the Streamer chose. A Mod can pop out the boss with the most Deaths at any time, even over a fight.
_Avoid_: Ticker, toast, slide

**Preset**:
A named Overlay style saved in the Panel, which can be exported as text and imported again.
_Avoid_: Theme, template, skin
