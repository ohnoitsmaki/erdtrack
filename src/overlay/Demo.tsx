import { useEffect, useState } from "react";
import type { Overlay as OverlayData } from "../../convex/overlay";

// The demo's counts, for /overlay/demo: a made-up Run that goes through a
// few Deaths and a boss fight that ends with the boss Defeated, over and
// over. It never reads or changes the real counts, so the Overlay can be
// shown off, or tried in OBS, without touching them.

// The Run's Encounters in its order, the Current Encounter, Gravity's
// tally, and the Stream's Deaths and bosses felled. The Total and the
// Defeated bosses follow from them.
type Run = {
  encounters: { name: string; deathCount: number; defeated: boolean }[];
  current: string;
  gravity: number;
  lastDeathAt: number;
  streamDeaths: number;
  streamFelled: number;
};

const BOSS = "Rennala, Queen of the Full Moon";

function startingRun(): Run {
  return {
    encounters: [
      { name: "Overworld", deathCount: 14, defeated: false },
      { name: "Margit, the Fell Omen", deathCount: 9, defeated: true },
      { name: "Godrick the Grafted", deathCount: 6, defeated: true },
      { name: "Red Wolf of Radagon", deathCount: 3, defeated: true },
      { name: BOSS, deathCount: 0, defeated: false },
    ],
    current: "Overworld",
    gravity: 4,
    // So the time since the last Death shows from the start.
    lastDeathAt: Date.now() - 7 * 60_000,
    streamDeaths: 5,
    streamFelled: 1,
  };
}

function died(run: Run, gravity = false): Run {
  return {
    ...run,
    encounters: run.encounters.map((encounter) =>
      encounter.name === run.current
        ? { ...encounter, deathCount: encounter.deathCount + 1 }
        : encounter,
    ),
    gravity: run.gravity + (gravity ? 1 : 0),
    lastDeathAt: Date.now(),
    streamDeaths: run.streamDeaths + 1,
  };
}

// What happens, in order, and how long each holds, in ms. Each Death waits
// long enough for "You died" to play out. After the last, the Run starts
// over.
const SCRIPT: { ms: number; step: (run: Run) => Run }[] = [
  // Exploring the Overworld.
  { ms: 6000, step: (run) => run },
  // A fall.
  { ms: 5000, step: (run) => died(run, true) },
  { ms: 6000, step: (run) => ({ ...run, current: BOSS }) },
  { ms: 5000, step: (run) => died(run) },
  { ms: 5000, step: (run) => died(run) },
  { ms: 5000, step: (run) => died(run) },
  { ms: 5000, step: (run) => died(run) },
  {
    ms: 7000,
    step: (run) => ({
      ...run,
      encounters: run.encounters.map((encounter) =>
        encounter.name === BOSS ? { ...encounter, defeated: true } : encounter,
      ),
      streamFelled: run.streamFelled + 1,
    }),
  },
  { ms: 6000, step: (run) => ({ ...run, current: "Overworld" }) },
];

// The Run as the Overlay's query would give it.
function overlayOf(run: Run): OverlayData {
  const encounter = run.encounters.find(({ name }) => name === run.current)!;
  return {
    encounter: { name: encounter.name, deathCount: encounter.deathCount },
    total: run.encounters.reduce((sum, { deathCount }) => sum + deathCount, 0),
    gravity: run.gravity,
    tags: [
      { tagId: "gravity", name: "Gravity", count: run.gravity, gravity: true },
    ],
    encounters: run.encounters,
    defeated: run.encounters
      .filter(({ defeated }) => defeated)
      .map(({ name, deathCount }) => ({ name, deathCount })),
    lastDeathAt: run.lastDeathAt,
    streamDeaths: run.streamDeaths,
    streamFelled: run.streamFelled,
    popoutAt: null,
    playTime: { seconds: 187_651, running: false, receivedAt: 0, lastSeenAt: null },
  };
}

// The demo's counts as they play out, or undefined while it's off.
export function useDemo(on: boolean): OverlayData | undefined {
  const [state, setState] = useState(() => {
    const run = startingRun();
    return { at: 0, run, overlay: overlayOf(run) };
  });

  useEffect(() => {
    if (!on) return;
    const timer = setTimeout(() => {
      setState(({ at, run }) => {
        const next = (at + 1) % SCRIPT.length;
        const stepped = SCRIPT[next]!.step(next === 0 ? startingRun() : run);
        return { at: next, run: stepped, overlay: overlayOf(stepped) };
      });
    }, SCRIPT[state.at]!.ms);
    return () => clearTimeout(timer);
  }, [on, state]);

  return on ? state.overlay : undefined;
}
