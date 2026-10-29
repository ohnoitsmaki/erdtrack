import { Channel, invoke } from "@tauri-apps/api/core";

// What the Watcher reads from the save, in the shape the backend will be sent.
export type Report = {
  slot: number;
  characterName: string;
  total: number;
  // The bosses' Defeat Flags set in the slot.
  defeatFlags: number[];
  // Always read, but sent only while the Streamer has Play Time on.
  playTime: PlayTime;
};

// The Play Time as the Watcher's clock shows it, in seconds, counted on from
// the last save of it, and whether the clock is counting.
export type PlayTime = { seconds: number; running: boolean };

export type WatcherStatus =
  | "gameClosed"
  | "noSave"
  | "waiting"
  | "unreadable"
  | "reading";

export type WatcherEvent =
  | { kind: "report"; report: Report }
  | { kind: "status"; status: WatcherStatus };

// The Watcher runs on the Rust side, which reads the save and never touches
// the network. Each report it hands over is for the UI to show and send.
export function watchSave(onEvent: (event: WatcherEvent) => void) {
  const events = new Channel<WatcherEvent>();
  events.onmessage = onEvent;
  return invoke<void>("watch_save", { events });
}
