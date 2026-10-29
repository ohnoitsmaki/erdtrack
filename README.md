# Erdtrack

A per-boss death tracker for Elden Ring streamers. A streamer's Mods record each **Death** in the **Panel** as it happens, and the Panel serves the **Overlay** that shows the counts on stream. Optionally, the desktop **App** reads the save file on the Streamer's PC and records Deaths and beaten bosses itself: the channel is then **Watched** rather than **Manual**.

- What's stored, and who can see it: [`PRIVACY.md`](PRIVACY.md)
- Hosting your own copy, and developing: [`docs/deployment.md`](docs/deployment.md)
- Installing the App for Watched mode: [`docs/deployment.md`](docs/deployment.md#watched-mode-the-app)
- Licences of bundled assets: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)

## Recording Deaths

The Overview's **Death** button records one Death in the Current Encounter. After a Death, nobody can record another in the same Run for 5 seconds, the Cooldown, so two Mods pressing for the same death record it once. The button counts the seconds down. A Death recorded by mistake can be removed, and every Change can be undone from History.

## First-time setup for the Streamer

1. Sign in to the Panel with Twitch.
2. Under **Runs**, create a Run with the character's name. It becomes the active Run.
3. Add the Overlay (below), and style it under **Overlay** in the Panel.
4. To add Mods, enter their Twitch logins under **Settings**. Each is bound to their Twitch account the first time they sign in.
5. Optionally, install the App so the channel is Watched: see [Watched mode](docs/deployment.md#watched-mode-the-app).

## Watched mode

A channel is Watched while it has a **Watcher token**, which only the Streamer can create, under **Settings → Watcher**. The App on the Streamer's PC reports to the Panel with it, and its **Watcher** reads the save only while Elden Ring is running. The sidebar shows **Watcher Online** while it's reporting, and which character is being played. The save's own death count, the **Save Total**, is the source of truth:

- **Deaths are topped up to the Save Total.** Each time the game saves, the Watcher adds exactly enough Deaths to bring the Run's Total up to it, in the Current Encounter, as a Change by "Watcher".
- **Mods can still press Death** at any time. If a Mod presses before the game saves, the save's rise covers it, so the death is counted once. The Cooldown applies to the Watcher's Deaths too, so a Mod pressing for a death the Watcher just added is refused. The Watcher itself is never refused.
- **Deaths from while the character wasn't being watched** are added to Overworld, and don't count as this Stream's Deaths: those in the save before its first report, and those since the Watcher last saw it, while it was Offline or another character was being played.
- **A Mismatch** shows in Counts as "N more than the save" when the Run has more Deaths than the Save Total, like after a Mod pressed for a death that didn't happen, or a restored backup save. Nothing is ever removed by the Watcher: Mods clear a Mismatch by removing Deaths. The Overlay never shows it.
- **Beaten bosses are marked Defeated** from the save, even ones beaten off stream, and a boss not in the Run is added. The first report for a character brings in every boss it has already beaten, as one Change. Mods can still mark and unmark Defeated, and a boss they unmark isn't marked again.
- **The active Run follows the character being played.** Reports go to the Run of the character's name. A character with no Run is offered in the sidebar as **Create X's Run**, and nothing is recorded for it until a Mod creates it. A Mod's switch by hand holds until the character being played changes, or the Watcher comes back Online.
- **Two characters with the same name**, like a practice copy, show as "Playing another character named X", and nothing is recorded for the second one. If it's the one the Run should follow, a Mod clicks **This one is the real X**.

Everything the Watcher does is a Change by "Watcher" in History, which Mods can undo like any other.

To go back to Manual, the Streamer clicks **Revoke token** under **Settings → Watcher**. The App's reports are refused from then on, and the counts stay as they are. Mods record every Death by hand, as before.

## Add the Overlay

The Overlay is public: anyone with the address sees what's on stream, and nothing else.

- **OBS**: add a source of the **Browser** type with the URL `https://<deployment>.convex.site/overlay`. For the List view, add another with `https://<deployment>.convex.site/overlay/list`.
- **StreamElements**: in a custom widget, frame the same address in an `<iframe>`. Only the Overlay's pages can be framed; the rest of the Panel refuses.

It shows the Current Encounter and its count, the Total and the Gravity tally, and the style editor can add any other Tag's tally. It follows each count and each styling change live. The Streamer and Mods style it under **Overlay** (`/style`), which also lists both addresses to copy. Presets belong to the channel, and can be exported as text and imported again.

A font can be bundled with Erdtrack, a Google Font, or one installed on the PC by name. An installed font only shows where it's installed: in OBS on the Streamer's PC, but in the editor's preview only if the editing device has it too.
