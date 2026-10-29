---
status: accepted
---

# The save is the source of truth, and Mods can still add Deaths

A channel can be Watched again: the App on the Streamer's PC reads the save and reports to the backend, with a Watcher token the Streamer creates in the Panel. The Save Total is the source of truth for how many Deaths a Run has, but Mods can still press Death at any time, in a Watched channel as in a Manual one. A channel without a Watcher token stays Manual, and nothing changes for it.

This partly supersedes ADR 0015. Deaths are no longer recorded only by hand, there is an App again, and the save marks bosses Defeated. The Total is still the sum of the Run's Encounter counts, and the save's own count is the Save Total. Everything else in ADR 0015 still holds: the Cooldown, the public Overlay, its style living in the backend, and its pages being framable. ADR 0015 also dropped the App as the slowest and riskiest part to build and ship. It's back holding only the Watcher, with the Overlay still served and styled by the Panel, and with a release build tuned for fast builds rather than a small exe, so ADR 0004 doesn't hold again. ADRs 0005, 0009 and 0012 do, for how the App reads the save: the Save Total is found by walking the slot, the save is read only while a process named `eldenring.exe` is running, found by listing process names, and the Defeat Flags' positions are facts taken from ER-Save-Lib.

The earlier ADRs were removed from the tree in 3e14bce and can be read from the history before it. That history has an ADR 0016 of its own, on the Panel being served by Convex, which still holds. This one is numbered as the next after ADR 0015.

## Deaths are topped up to the Save Total

On each report, the Watcher creates exactly enough Deaths to bring the Run's Deaths up to the Save Total, as one Change by "Watcher". This is what lets Mods keep pressing Death. ADR 0002 kept Mods out because a Mod's Death and the Watcher's report of the same death would both be counted, and ADR 0015 rejected adding Mod Deaths alongside the Watcher for that reason. Topping up removes the race: a Mod who presses before the game saves has already raised the Run's Deaths, so the save's rise covers that Death and the Watcher adds nothing.

- **While Online**, the Watcher's Deaths go in the Current Encounter and count as happening now: they're this Stream's Deaths, and the Cooldown starts after them, so a Mod pressing for the same death just after is refused. The Watcher itself is never refused.
- **On a Run's first report, or the first after being Offline or playing another character**, they're a Catch-up: they go in Overworld and aren't this Stream's Deaths, since they happened earlier. The Cooldown doesn't start after a Catch-up.
- **Nothing is ever removed.** When the Run has more Deaths than the Save Total, the Panel shows a Mismatch ("N more than the save"), and Mods remove Deaths by hand to clear it. A Save Total that drops, from a restored backup or a copied save, shows up the same way. The Overlay never shows a Mismatch.

## Defeat Flags are remembered in the backend

The backend keeps, for each Run, every Defeat Flag the Watcher has reported for it. A flag set now but not remembered is a kill, which marks its boss Defeated and adds the boss as an Encounter if the Run doesn't have it. A kill made while the App was closed is still caught. ADR 0013 had the Watcher compare its own reads of a slot, and only offered the flags already set at its first read, rather than marking them.

- **The first report for a character marks every boss already beaten**, as one Change a Mod can undo. The Streamer this was built for beats bosses off stream, and the save is the truth.
- **Mod corrections stick.** A remembered flag never marks its boss again, so a Defeated a Mod undid stays undone, even after a restored backup unsets the flag and the game sets it again. Revoking the Watcher token keeps the flags for the same reason.

## Runs follow the character being played

A report goes to the Run of the character's name, and the first slot reported under that name is bound to the Run. Elden Ring names can't be changed, so a character of the same name in another slot is shown as the Other character, and nothing is recorded for it until a Mod rebinds the Run to it. Rebinding forgets the Run's remembered Defeat Flags and the Save Total last reported for it, so the next report is a first report for the new slot, and removes no Deaths. The Watcher switches the active Run only when the character being played changes, or it comes back Online, so a Mod's switch by hand holds until then.

## Considered options

- **Deaths only from the Watcher, as ADR 0002 had it.** Rejected: the Save Total rises 5.5 to 11.5 seconds after the killing blow (ADR 0006), and Mods want the count to move as the death happens on stream, and to keep counting when the save can't be read.
- **Each report adds the rise since the last one.** Rejected: a Mod's Death and the rise would both count, which is the race ADR 0015 avoided.
- **Remove Deaths when the Save Total drops.** Rejected: a restored backup would take Deaths off the stream. A Mismatch shows the difference, and a Mod decides.
- **Defeat Flags remembered by the App.** Rejected: they'd be lost with the App's folder or on a new PC, and the next report would mark every beaten boss again, undoing Mods' corrections.
