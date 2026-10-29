// How long after a Death another can't be recorded in the same Run, so two
// Mods pressing for the same death record it once. Kept apart from the
// mutations so the Panel can show the wait.
export const DEATH_COOLDOWN_MS = 5_000;

// The most Deaths a Mod may add at once. One mutation inserts them and the
// Change shows them, about 2 writes each, reading them back as one range,
// and the Change lists them all: well within Convex's 16,000 writes per
// mutation and 8,192 items per array.
export const MAX_DEATHS_ADDED = 5000;
