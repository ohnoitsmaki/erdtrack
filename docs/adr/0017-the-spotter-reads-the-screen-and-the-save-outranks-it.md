---
status: proposed
---

# The Spotter reads the screen, and the save outranks it

The save can't tell which boss is being fought, and its Save Total rises 5.5 to 11.5 seconds after the killing blow (ADR 0006). So in a Watched channel, the App can also have a Spotter, which the Streamer turns on in the App and is off by default. It reads the game's screen for Name bars, YOU DIED and FELLED messages. It sets the Current Encounter when a Name bar appears, records a Death at YOU DIED, and marks the Current Encounter's boss Defeated at a FELLED message. Each of these is a Change by "Spotter", not "Watcher", so History shows which one to distrust. A Manual channel never has a Spotter. Text is read in English only, and in any other language the Spotter sees nothing it recognises.

## The save outranks the Spotter

The Spotter never removes a Death and never overrides the save (ADR 0016).

- **A Spotter Death is like a Mod pressing early.** It goes in the Current Encounter, and the save's rise covers it, so the death is counted once. The Cooldown refuses the Spotter as it does a Mod, so a Mod pressing at the killing blow and the Spotter seeing YOU DIED a moment later record one Death, not two plus a Mismatch. A false YOU DIED becomes a Mismatch, which Mods already clear by hand.
- **A Spotter Defeated holds until the save confirms or contradicts it.** If the save hasn't set that boss's Defeat Flag within the next couple of reports after the FELLED message, the Watcher reverts it with a Change of its own. A FELLED message while the Current Encounter is Overworld or a Custom Encounter does nothing.

## The Current Encounter follows Name bars, but only when they change

- When a Name bar appears, or a boss changes its name partway through, the Spotter makes its boss the Current Encounter. If the boss isn't in the Run, the Spotter adds it in the same Change. A Hidden boss becomes current but stays Hidden. A Mod's switch by hand holds until the next Name bar appears.
- Any Defeated, whoever marks it, sets the Current Encounter back to Overworld. A Mod's Undo of the Defeated doesn't bring the boss back as the Current Encounter.
- If the Name bar of a boss the Spotter set disappears, and no YOU DIED or FELLED message follows within N seconds, the Streamer has fled. The Spotter sets the Current Encounter back to Overworld. After YOU DIED, the flee timer is off until the Name bar appears again, so the run back doesn't count as fleeing. A boss a Mod set by hand isn't cleared this way.

## Bosses are matched on the PC, by Name bars and the map

The boss list's names are written for the Panel, not as the screen shows them: variant suffixes like "(Staff)", counts like "(x2)", fights joined with "&", and names like "Godskin Duo" that never appear. Each boss has a set of bar names, worked out from its list name plus hand-kept aliases. A fight matches a boss when every visible Name bar is one of that boss's bar names. Name bars that appear one after another, in a phase change or for fighters who come in turn, match the boss already chosen. A name with no match does nothing.

26 names are shared by more than one boss, and Night's Cavalry by 8. Each Defeat Flag encodes its boss's map (Tree Sentinel's 1042360800 is the open-world tile m60_42_36, and 18000850 is the dungeon m18_00), and the save records the character's current map. Among the bosses that match, the Spotter drops those whose flag is set, then picks the one on the current map (exactly for a dungeon, nearest tile for the open world), then prefers one already in the Run and not Defeated. If it's still ambiguous, the Current Encounter doesn't change, and the Panel asks a Mod which boss it was. The save may not yet have the new map when a Name bar appears, if the game hasn't saved since a fog gate or fast travel. Then a shared name is ambiguous, or picks the boss on the old map, and a Mod fixes it as for any other wrong guess. A test fails if two bosses share both a bar name and a map.

All of this runs in the App, which sends only the boss's ID. The map ID and position never leave the PC.

## The screen is read with Windows Graphics Capture and the OCR built into Windows

The App's Rust side captures the game with Windows Graphics Capture, only while `eldenring.exe` is running. This is the same API OBS's Window and Display Capture use. It reads the image the window has already drawn and never opens the game's process, so ADR 0009's rule for Easy Anti-Cheat still holds. Window capture includes the window's title bar and borders, so the App crops to the part the game draws first. It then samples a few fixed screen regions, a few times a second. All of the text, YOU DIED, the FELLED messages and Name bars, is read with the OCR built into Windows, using its English recognizer, and compared with the words it should be. If that recognizer isn't installed, the Spotter doesn't run, and the App says why. Frames stay in memory and are never saved or sent anywhere. PRIVACY.md says what the Spotter reads and that the App sends which boss it saw.

YOU DIED and the FELLED messages are read raw. A Name bar crop is read raw too, and if any line doesn't match a bar name, it's cleaned up and read again. Cleaning up makes each pixel that is light (every channel at least 150) and nearly grey (its channels within 60 of each other) black, and the rest white, then doubles the image's size. A Name bar's text is light grey, so this drops the scene behind it. It also erases the gold FELLED message. Each line OCR returns is matched on its own, allowing wrong characters, since even a cleaned crop misreads some. How many it allows starts at 3 in a name, as the duo below needed, and is tuned in use.

The spike checked this (#57, #58). Windows Graphics Capture captured the game windowed. The OCR built into Windows read YOU DIED and GREAT ENEMY FELLED raw. From a stream's video at 1080p, it read a long name raw too, as `Dragonkin Soldier of Nokstella`. Name bars over a bright, busy scene misread raw. Tree Sentinel over grass read as `T ece Seri tipel G) :Acquire materials`, and a duo over red sand as `Cy-ucible Knigh :sb?g A4rrior`. Cleaned up, they read as `Tree Sentinel` and `(.:rucible Knight \fisbeqotten Warrior`, 3 wrong characters from each name. Cleaning up spoiled Dragonkin Soldier of Nokstella, which read as `Sol(.het of NokstcJla`. With a threshold of 175 instead of 150, every cleaned crop read as nothing. The spike's script printed OCR's lines joined, so whether each Name bar comes back as its own line is checked when the Spotter is built. Of the FELLED messages, only GREAT ENEMY FELLED was checked.

## Defaults, tuned in use

The spike in `spikes/screen/` was meant to measure the timings below before anything was built. Instead they start as defaults and are tuned from real use, since a wrong guess only costs a Mod a correction:

- **N, the flee timeout:** 30 seconds, long enough to outlast a phase change's cutscene. A Streamer who flees and dies to something else within it has that Death in the boss's Encounter, which a Mod can move.
- **How often the regions are read:** 5 times a second, so YOU DIED is seen well within a second.

Whether capture works in exclusive fullscreen is found out in the App (#61), which says so when capture fails.

## Considered options

- **Matching YOU DIED and FELLED messages against stored images of them.** Rejected: the OCR built into Windows read YOU DIED as it is, and images would have to be captured for every message and checked at every resolution.
- **Cleaning up every crop before OCR.** Rejected: it erases the gold FELLED message, and spoiled a long Name bar that read correctly raw.
- **Measuring the timings in the game before building.** Rejected: it took a long session for numbers that defaults and real use settle as well.

- **Frames from OBS over obs-websocket.** Rejected: Streamers would have to set up and expose a WebSocket with a password.
- **The Spotter as part of the Watcher.** Rejected: History couldn't tell a guess from the screen from the save's truth.
- **Defeated only from Defeat Flags.** Rejected: the FELLED message is immediate and the flag isn't. The save still overrules the Spotter.
- **The Spotter not refused by the Cooldown, like the Watcher.** Rejected: a Mod pressing at the killing blow would cause a Mismatch on nearly every death.
- **Sending the map ID so the backend matches bosses.** Rejected: matching on the PC keeps the character's location off the backend.
