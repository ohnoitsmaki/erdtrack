---
status: accepted
---

# Play Time is sent only if the Streamer turns it on

Supersedes ADR 0011, "Play Time stays on the PC", which is no longer in the repo (read it with `git show 3e14bce^:docs/adr/0011-play-time-stays-on-the-pc.md`).

The Overlay can show the Play Time, which the game records in the profile summary next to the character's name (ER-Save-Lib's `seconds_played`, 0x26 into each profile). It's the only play time in the save. In the old App, the Overlay was served from the Streamer's PC, so the Play Time never left it. The Overlay is now served by the Panel (ADR 0015), so for the Overlay to show it, the Watcher has to report it to the backend.

So the App has a Play Time checkbox, off by default, kept in `settings.json` with the Panel address and the Watcher token. While it's on, each report carries the Play Time of the character being played, as `playTime: { seconds, running }`. While it's off, no report carries it.

The backend keeps it, with its own time of receipt, on the Run following the reported slot, and only on that Run. Another character's Play Time isn't kept, and after a Rebind the next report sets the Run's from its new slot. A report without one clears every Run's in the channel, whether the Streamer turned it off or the App is too old to send it. Revoking the Watcher token clears them too, as no report could clear them after. The Overlay's `playTime` piece shows the active Run's as `H:MM:SS`, with hours that don't wrap into days, and doesn't show while there's none.

## How the game saves it

Carried over from ADR 0011. Measured with `spikes/save-file/playtime.ts` on a developer's PC, in vanilla, offline:

- Most saves rewrite only the character slot. The game writes the Play Time to the profile summary only on loading in, respawning after a death, resting at a grace and quitting to the title screen. The HP-0 save at a death is a slot-only write.
- The game's clock runs while the player is AFK, but nothing is saved: one AFK stretch went 169 seconds without a write, and the next save's Play Time had gone up by 165 seconds.
- It stops on the title screen. Loading in rewrites the profile summary with the same Play Time as quitting did.
- Reaching the title screen wrote the file without changing any slot or the profile summary. This was seen once in the log, and again testing v0.3.2.
- Dying and respawning, a 47-second stretch, raised it by 41 seconds, so the game doesn't count some loading.

## The clock is in the App

Between saves, the clock counts on from the last Play Time saved, and the Watcher decides whether it's running from what each read of the save changed: the profile summary, only the slots, nothing, or the first read. `PlayClock`, in `src-tauri/src/play_time.rs`, keeps ADR 0011's rules:

- A profile summary written with the same Play Time as one read 3 or more seconds earlier means the Streamer has loaded in. The clock goes to the save at once, dropping anything counted on the title screen, and starts running.
- A profile summary with a higher Play Time resets the clock to it and keeps it running. If it's behind what's on screen by up to 60 seconds, as after a loading screen the game didn't count, the clock waits for it rather than going back. Further behind, or for another character, it shows the save as it is and stops until the Streamer loads in.
- A write to the slots alone changes nothing while the clock runs, since the Play Time in it is stale. While it's stopped, it starts the clock, since the game only writes a slot while the Streamer is loaded in, as when the App is opened mid-game.
- A write that changes nothing, as on reaching the title screen, stops the clock where it is. The game stopped counting at the quit save a few seconds before, but going back to it would be a jump on stream, so the clock goes back on loading in instead, behind the loading screen. Reading the save again to retry a doubted Save Total, or a slot it can't parse, isn't such a write.
- The first read, when the App starts, can't tell whether the Streamer is loaded in, so the clock stands still until the game next writes.
- The game closing stops it at the last save, which the game made as it quit.

`seconds` is what the clock shows when the report is made, often with a fraction of a second, and `running` whether it's counting. A change in the clock sends a report straight away, like a change in the Save Total: when it starts or stops, when it's reset to a save, and when it catches up with a save it was holding for. A change is anything other than where the last report, counted on, puts it, by a second or more. The 30-second heartbeat carries it too.

## The Overlay counts on from the backend's receipt

While `running`, the Overlay counts on from `seconds` plus the time since the backend received the report, by its own clock against the backend's time, never the Streamer's PC's. The backend keeps a running Play Time only when it changes, so a heartbeat re-runs nothing on the Panel: a report up to 2 seconds off from where the one kept, counted on, says it is, is taken as the same, the difference being how much later it arrived.

When the game closes, the App reports the clock stopped at the last save, once, and the Watcher goes Offline 90 seconds later. If the reports stop without that, as when the App or the PC closes or the network drops, the Watcher goes Offline 90 seconds after its last report. Counting on until then, and going back once it's known, would be a jump on stream. So while it's running, the Overlay is given when the Watcher last reported, and counts on to no more than 30 seconds past it, when the next heartbeat was due. Once the heartbeats stop, it stays there.

The Overlay's query reads when the Watcher last reported only while the Play Time is running, so only then does a heartbeat re-run it.

## Considered options

- **Always send it.** Rejected: the Play Time is more of the save than the Watcher needs to count Deaths and Defeated bosses, and PRIVACY.md promised it wasn't sent. A Streamer who wants it shown can turn it on.
- **Turn it on in the Panel.** Rejected: the App would have to ask the backend whether to send it, so it would be sent before it knew, and the Panel would control what leaves the Streamer's PC. Only the Streamer, at the PC, turns it on.
- **Count on between saves in the backend or on the Overlay**, from the saves alone. Rejected: the title screen is known only from a write that changes nothing, which only the App sees. The backend gets a report only when something changed, and on the heartbeat.
- **Stop counting a while after the last save**, so the clock can't run long on the title screen. Tried in v0.3.1 of the old App, with 90 seconds, and it froze while the developer was AFK in the game, when nothing is saved. Rejected.
- **Stop the Overlay at the Watcher's last report once it's Offline.** Rejected: it would have counted on for 90 seconds by then, so it would jump back on stream.
- **Write every running heartbeat to the Run**, so the Overlay knows when it was. Rejected: every Panel query reading the Run would re-run every 30 seconds while the Streamer plays.
- **Keep the Play Time sent before it was turned off.** Rejected: turning it off is the Streamer withdrawing it, so every one sent is forgotten, and the Overlay stops showing it.

## Consequences

- **The Play Time piece is on by default**, for new styles and for styles saved before it existed, but shows nothing until the Streamer turns Play Time on in the App. Importing an old App style keeps its piece where it was, shown or not.
- **A Manual channel never shows it**, as nothing reports it.
- **An App too old to send it clears it**, like one with it turned off.
- **Quitting looks like resting**, as ADR 0011 found, so the clock counts on for the few seconds until the title screen appears, and is that far ahead on the title screen until the Streamer loads in. If the write on reaching the title screen ever doesn't come, it counts on there until the Streamer loads in.
- **After a death or a loading screen, it can pause for a few seconds** at the next save, while the game's count catches up.
- **A late heartbeat pauses the Overlay's clock** until it arrives, then it catches up.
- **Closing the game puts the Overlay's clock back to the quit save**, by the few seconds it took the App to notice.
- **If the reports stop otherwise, the Overlay's clock can be up to 30 seconds ahead**, until the App reports again.
