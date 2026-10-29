# Screen spike (#57)

Throwaway code that measures what the Spotter's design depends on (ADR 0017), and saves the screen regions it will read, for testing OCR. It logs to the terminal and never reports to a Panel, so running it can't touch a real Run. It sends nothing over the network: it has no network code or networking crates (`cargo tree` lists them all), and it only reads the save, captures the screen, and writes PNGs to `captures/`.

Each log line is stamped in seconds since the spike started, on one monotonic clock:

- **`save`**: every save write, with each slot it changed (the slot being played), its Save Total, its map ID (like `m60_42_36_00`) and its last rested grace. The first read lists every slot. It reads the save with the App's own parser, from `src-tauri/src/save.rs`, polling every 50 ms, so a write is logged up to 0.05 s after it lands. Frames are stamped when they reach the spike, a few milliseconds after the game drew them.
- **`frames`**: every second, how many frames Windows Graphics Capture delivered, the mean and longest gap between them, and the spike's own CPU use as a share of all cores, as Task Manager shows it. WGC only sends a frame when the window changes, so a still screen shows few. A single gap over 100 ms is logged as a `frame` stall. The CPU figure is only the spike's: WGC's own work happens in `dwm.exe` and on the GPU, so watch those in Task Manager too.
- **`mark`**: a key pressed at a moment that matters.
- **`region`**: regions saved from a frame.

Like the App, it never opens the game's process, so it gives Easy Anti-Cheat nothing to act on. It finds the window by its title and captures it through WGC, as OBS's Window Capture does, and the hotkeys are registered with Windows, not hooked into the game. Running the game offline with Easy Anti-Cheat off (below) is about the edited save, not the spike.

## Before running it: offline, with Easy Anti-Cheat off, on a backed-up save

The cases to measure need set-up saves, like a boss not yet beaten, made with [ER-Save-Editor](https://github.com/ClayAmore/ER-Save-Editor). **Never take an edited save online.** FromSoftware can flag or ban an account for one. Only edit a copy, and put the backup back before playing online again.

1. **Back up the save.** Copy the whole folder `%APPDATA%\EldenRing\<Steam ID>\` somewhere safe.
2. **Turn Easy Anti-Cheat off.** In the game's folder (Steam → Elden Ring → Manage → Browse local files → `Game`), make a file named `steam_appid.txt` containing `1245620`. Launching `eldenring.exe` from that folder directly, rather than through Steam's Play button, starts the game without Easy Anti-Cheat, and it plays offline. Delete `steam_appid.txt` afterwards.
3. **Edit the save** with ER-Save-Editor, with the game closed, if the case needs it.
4. After the session, with the game closed, **put the backup back** over the folder before launching through Steam again.

## Run it

It runs on Windows only, since it uses Windows Graphics Capture, so it can't run under WSL. With [Rust](https://rustup.rs) installed on Windows, from the repository in PowerShell:

```powershell
cargo run --release --manifest-path spikes/screen/Cargo.toml
```

It finds the save written most recently in `%APPDATA%\EldenRing`, waits for the `ELDEN RING` window, and starts logging. Options:

- `--save <path>` reads that save instead.
- `--monitor` captures the primary monitor rather than the window, for when window capture shows nothing in fullscreen.
- `--each-frame` logs every frame with its gap from the last, not just the summary each second.
- `--readback` copies every frame to the CPU and crops the regions out of it, as the Spotter will, so the CPU figure includes reading the pixels back. It copies the whole frame, so it overstates the cost a little. Measure the CPU use with and without it.

To keep a log in the git-ignored folder, make it first with `New-Item -ItemType Directory -Force spikes/screen/captures`, then append ` | Tee-Object spikes/screen/captures/log.txt` to the command. Ctrl+C stops it.

### Keys

The hotkeys work while the game has focus, so there's no alt-tab, which would move the timing:

| Key | Does |
| --- | --- |
| F5 | marks the killing blow (when the character's health runs out) |
| F6 | marks walking through a fog gate |
| F7 | marks starting to flee |
| F8 | saves the regions of the next frame |

Typing a note in the terminal and pressing Enter marks it too, like `cutscene` or `phase 2`, and typing `save` saves the regions.

## Save regions

F8 saves PNGs from the next frame to `spikes/screen/captures/`, which git ignores: `you-died`, `felled` and `name-bars`, and the whole `frame`, each named by the time the frame arrived. The regions are fractions of the frame, first guesses for 16:9 in `src/regions.rs`. If a crop misses its text, measure the whole frame and change the fractions. Delete the crops that don't show what they're named for.

Save these, as samples for testing OCR:

- YOU DIED, pressing F8 once it's fully faded in.
- Each FELLED message: ENEMY FELLED, GREAT ENEMY FELLED, DEMIGOD FELLED, LEGEND FELLED and GOD SLAIN.
- Name bars: one boss, several at once (like the Godskin Duo), a name that changes partway through, and a long name.

Crops can show the character's name and the HUD, so they stay out of git, like real saves.

## Check what OCR reads

The Spotter reads all of its text with the OCR built into Windows (ADR 0017). `ocr.ps1` runs it on saved crops and prints what it read. It changes nothing and sends nothing anywhere. In PowerShell, from the repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File spikes/screen/ocr.ps1 -Paths (Resolve-Path spikes/screen/captures/*-you-died.png)
```

YOU DIED, GREAT ENEMY FELLED and a long Name bar read correctly raw, but Name bars over a bright, busy scene needed cleaning up first. ADR 0017 has what each read and the clean-up (#58).

Screenshots of a past stream's video at 1080p work as samples too. Save them in `captures/` as `video-<what it shows>-frame.png`. The spike only crops the frames it captures, so crop a screenshot by hand to the fractions in `src/regions.rs`. At 1920×1080 they're the pixels from (288, 432) to (1632, 648) for `felled`, and from (346, 713) to (1574, 994) for `name-bars`.

The logs can also time when the save is written around a fog gate (F6), YOU DIED's delay after the killing blow (F5, then F8), and fleeing (F7). ADR 0017 starts these as defaults instead, so they're only worth measuring if the defaults go wrong in use.

## Test on a video

`vod` runs the Spotter's reading and matching over a video of the game, and scores it against labels written by watching it, so we know how often it's right before it's built. It reads the same regions as the spike, with the OCR built into Windows, raw and cleaned up as ADR 0017 says. It only takes text whose line starts where a Name bar's name does, left-aligned above its health bar, since the subtitles, messages like "Summoned Okina" and prompts like "E :Summon Lionel the Lionhearted" that share the region are centred. It matches that text against each boss's bar names, which it works out from the boss list (`convex/eroverlayBosses.json`) and its aliases (`convex/bossAliases.ts`). A video has no save, so it can't use the map to tell apart bosses that share a name. The report says when a name is shared instead.

Videos, readings and labels go in `captures/`, which git ignores.

**1. Read the video.** This is the slow part, at 3 to 4 times real time for 1080p. It runs on Windows, and frames come from ffmpeg, so it's easiest from WSL with ffmpeg installed there. First build it with Windows' cargo: `cargo.exe build --release --bin vod`, then `chmod +x target/release/vod.exe`. Then, from `spikes/screen`:

```sh
ffmpeg -loglevel error -i captures/<video>.mp4 -vf fps=5,scale=1920:1080 -f rawvideo -pix_fmt bgra - \
  | ./target/release/vod.exe read --video <video> --size 1920x1080 --fps 5 > captures/<video>.jsonl
```

`fps=5` is how often the Spotter will read. `scale` sets the frame to the size it'll be in the game, so text is the size OCR will see. Try 2560x1440 or 3840x2160 too, and use the same size in `--size`. To start partway, put `-ss <time>` before `-i` and pass the same time as `--start <time>`, so the readings keep the video's times. Don't pipe through Windows PowerShell 5, which corrupts binary pipes.

**2. List what it saw.** This runs anywhere, in a moment:

```sh
cargo run -q --bin vod -- score captures/<video>.jsonl
```

It prints each Name bar appearing (`bar`) and going (`gone`), and each FELLED message, with its time in the video.

**3. Label the video.** Write `captures/<video>.labels`, using the list as a starting point. Check each event in the video, and look for the fights it missed. One label a line:

```
fight 0:12:30 0:14:05 Margit, the Fell Omen    # from the Name bar appearing to it going
felled 0:14:03 LEGEND FELLED
skip 1:02:00 1:04:30                           # the stream's overlay covers the Name bars
```

A fight names its boss as the boss list or its Name bars do, with several joined by ` & `. Skip any stretch where the stream's overlay or webcam covers the regions, since the Spotter captures the game and never sees them.

**4. Score it.**

```sh
cargo run -q --bin vod -- score captures/<video>.jsonl --labels captures/<video>.labels
```

The report lists each fight as found (with how many seconds after its start), missed, or with a WRONG name read too, and each FELLED message the same way. Then it lists false Name bars and FELLED messages outside any label, and sums it up per hour. To tune, score again with `--most-wrong <n>` (the most wrong characters a match allows, 3 by default and fewer for short names), `--confirm <frames>` (frames in a row before a name counts, 2), `--gone <seconds>` (unread before a bar counts as gone, 3), `--reads raw` or `--reads clean` to compare with only one of the reads, or `--anywhere` to match text anywhere in the region. `--events` lists the events beside the report.

## Tests

The pure parts are tested on any platform, and so is the App's parser that the spike reads saves with:

```sh
cargo test --manifest-path spikes/screen/Cargo.toml
cargo clippy --manifest-path spikes/screen/Cargo.toml --target x86_64-pc-windows-msvc
```

The second needs `rustup target add x86_64-pc-windows-msvc`. It checks the Windows code from Linux or WSL without linking it.
