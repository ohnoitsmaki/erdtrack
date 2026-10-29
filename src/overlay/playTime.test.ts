import { describe, expect, test } from "vitest";
import { formatPlayTime, playTimeAt } from "./playTime";

test("the Play Time shows hours, minutes and seconds, as the load screen does", () => {
  expect(formatPlayTime(0)).toBe("0:00:00");
  expect(formatPlayTime(187_651)).toBe("52:07:31");
});

test("its hours go on past a day", () => {
  expect(formatPlayTime(466_625)).toBe("129:37:05");
});

describe("the Play Time shown", () => {
  const receivedAt = 1_000_000;
  const stopped = { seconds: 2576, running: false, receivedAt, lastSeenAt: null };
  const running = { seconds: 2576, running: true, receivedAt, lastSeenAt: receivedAt };

  test("holds still while the clock isn't running", () => {
    expect(playTimeAt(stopped, receivedAt + 60_000)).toBe(2576);
  });

  test("counts on from when the backend received it while it's running", () => {
    expect(playTimeAt(running, receivedAt + 12_500)).toBe(2588.5);
  });

  test("counts on through heartbeats that agree with it", () => {
    const beat = { ...running, lastSeenAt: receivedAt + 30_000 };

    expect(playTimeAt(beat, receivedAt + 45_000)).toBe(2621);
  });

  // The next heartbeat was due by then. The Watcher goes Offline later, and
  // the Overlay stays where it stopped rather than going back.
  test("stops 30 seconds past the Watcher's last report", () => {
    const beat = { ...running, lastSeenAt: receivedAt + 30_000 };

    expect(playTimeAt(beat, receivedAt + 60_000)).toBe(2636);
    expect(playTimeAt(beat, receivedAt + 600_000)).toBe(2636);
  });

  test("doesn't go below the Play Time reported if this clock is behind the backend's", () => {
    expect(playTimeAt(running, receivedAt - 5_000)).toBe(2576);
  });
});
