# Privacy

Erdtrack keeps as little as it can about the people who use it. This file says exactly what is stored, where, and who can see it.

## What's stored

Everything is stored in one Convex deployment, the backend, which also serves the Panel.

**About people**, the Streamer and each Mod:

- **Twitch user ID.** It's how the Panel recognises you.
- **Display name.** It's what the Panel shows other people.
- **The Twitch login the Streamer typed.** The Streamer's login is set when the backend is deployed, and each Mod's login is entered by the Streamer. It's kept so that the first sign-in can be bound to a Twitch user ID. The login Twitch reports at sign-in is only compared with it, never stored.
- **A sign-in session** while you're signed in. It holds no IP address and no browser details. Your browser keeps it in a cookie for the Panel's address.

Nothing else is kept about you: no IP address, no user agent, no Twitch tokens and no real email address. The sign-in library requires an email, so it's given a fake one made from your user ID, `<user ID>@twitch.invalid`. Twitch is asked only for your user ID, login and display name, and sign-in requests no Twitch permissions beyond that. [`convex/auth.ts`](convex/auth.ts) shows how, and a test fails if any of it is ever stored.

**About the game**:

- **Deaths.** When each was recorded and which Encounter it belongs to, with its Tags.
- **Changes.** Every Panel action: who made it (by Twitch user ID), when, and what it changed.
- **Runs and Encounters.** Each Run's character name, and its Encounters with their counts and Defeated marks.
- **The Overlay's style and Presets.**

**About the Watcher**, once the channel is Watched:

- **The Watcher token's hash.** The token itself is shown once, when it's created, and never stored.
- **For each Run**, the save slot it follows, the Save Total last reported for it, and every Defeat Flag reported for it. While the Streamer has Play Time on in the App, also the Play Time last reported for it, and when it was received.
- **For the channel**, when the Watcher last reported, whether it's Online and since when, and the name and slot of the character being played.

## What the App reads and sends

Without the App, nothing is read from the game or the Streamer's PC. The App, which the Streamer installs for Watched mode, runs on their PC. It reads the save file only while a process named `eldenring.exe` is running, which it finds out from the list of running process names. If Windows won't give it that list, it reads as if the game were running. It never opens the game's process or reads its memory.

From the save, it sends the Panel, for the character being played, only:

- **The slot**, which of the save's characters it is.
- **The character's name.**
- **The Save Total**, the character's death count in the save.
- **The Defeat Flags** set in the slot, one for each boss in the boss list that the character has beaten.
- **The Play Time**, as the game's load screen shows it, counted on since it was last saved, and whether the character is loaded in, so it's counting, only while the Streamer has turned it on in the App. It's off until they do.

It sends these when they change, and again every 30 seconds while the game is running, to the Panel address the Streamer pasted in, with the Watcher token. The App's window can't connect anywhere but a Convex site, and its Rust side, which reads the save, never touches the network. [`app/watcher.ts`](app/watcher.ts) is what's sent, and [`src-tauri/src/watch.rs`](src-tauri/src/watch.rs) is how it's read.

**The Steam ID never leaves the PC.** The save is in a folder named after the Steam account's ID, so the App reads the folder's name to find it, but never sends it. Nothing else in the save is sent: not the rest of the character, nor the other characters, nor the Play Time while it's off.

Everything the App keeps is in its own folder: the Panel's address, the Watcher token and whether Play Time is on in `settings.json`, and its window's browser data in `webview`. Deleting the folder removes them all.

## Who can see it

- **The Streamer and Mods**, in the Panel. They see each other's display names, every Death and every Change with who made it, and, while the channel is Watched, whether the Watcher is Online and which character is being played.
- **The developer**, through Convex's dashboard, which shows every stored record.
- **Anyone with the Overlay's address**, and so stream viewers, see what the Overlay shows: Encounter names and counts, the Total and the tallies of Gravity and any other Tags the style shows, and the Play Time while it's sent. Nothing about people.

## Who it's shared with

- **Convex** runs the backend, stores all the data, handles sign-in and serves the Panel and the Overlay. It sees the IP address of anyone who opens them, as any web host does, but Erdtrack stores none of them, and none shows up in the Convex dashboard. See [Convex's privacy policy](https://www.convex.dev/legal/privacy).
- **Twitch** handles sign-in, as with any "Sign in with Twitch".
- **Google Fonts** is contacted only if the Overlay's style uses a Google Font. Looking one up in the editor sends Google the font's name. Then the editor and every Overlay page load the font's files from Google, so Google sees the IP address of whoever is editing and of each PC showing the Overlay, OBS included, and which font it is.

Nothing else is contacted. There is no analytics, no tracking and no advertising.

## How long it's kept

- **Changes and Deaths** are kept as long as their Run. When the Streamer deletes an Archived Run, its Deaths, Changes and Encounters are deleted with it.
- **A removed Mod** is signed out at once and can no longer use the Panel. The login the Streamer typed for them is deleted. Their Twitch user ID and display name stay in the backend, and so do the Changes they made. To have them deleted, ask the developer.
- **Sign-in sessions** expire on their own, and are deleted when a Mod is removed.
- **The Play Time** is kept with its Run until the Streamer turns it off in the App. The next report then deletes it from every Run in the channel.
- **The Watcher's records** stay while the channel is Watched. When the Streamer revokes the Watcher token, its hash, when the Watcher last reported, whether it's Online, the character being played and every Run's last reported Save Total and Play Time are deleted. Each Run keeps its slot and its Defeat Flags, so a boss a Mod unmarked isn't marked again if the channel is Watched again. They're deleted with the Run.
