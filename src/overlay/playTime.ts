import type { Overlay } from "../../convex/overlay";

// As the Overlay is given it, with when the backend received it.
export type PlayTime = NonNullable<Overlay["playTime"]>;

// As the game's load screen shows the Play Time, hours first and never
// wrapping into days: 129:37:05.
export function formatPlayTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${hours}:${pad(minutes)}:${pad(Math.floor(seconds) % 60)}`;
}

// The Watcher reports at least this often while the game runs, as its
// HEARTBEAT in src-tauri/src/watcher.rs.
const HEARTBEAT_MS = 30_000;

// The Play Time to show at `now`. While running, it counts on from when the
// backend received it, by this clock, never the Streamer's PC's. It stops
// once the next heartbeat is overdue, as when the game closes, and stays
// there once the Watcher goes Offline (ADR 0018).
export function playTimeAt(
  { seconds, running, receivedAt, lastSeenAt }: PlayTime,
  now: number,
) {
  if (!running) {
    return seconds;
  }
  const until = Math.min(now, (lastSeenAt ?? receivedAt) + HEARTBEAT_MS);
  return seconds + Math.max(0, until - receivedAt) / 1000;
}
