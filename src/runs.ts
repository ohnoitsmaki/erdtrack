import type { Role } from "./routes";

export type RunAction = "makeActive" | "archive" | "delete";

// What a Run's row offers, in menu order. Only an Archived Run can be
// deleted, and only by the Streamer.
export function runActions(
  run: { active: boolean; archived: boolean },
  role: Role,
): RunAction[] {
  const actions: RunAction[] = [];
  if (!run.archived && !run.active) {
    actions.push("makeActive");
  }
  if (!run.archived) {
    actions.push("archive");
  }
  if (run.archived && role === "owner") {
    actions.push("delete");
  }
  return actions;
}
