import { describe, expect, test } from "vitest";
import { runActions } from "./runs";

const inactive = { active: false, archived: false };
const active = { active: true, archived: false };
const archived = { active: false, archived: true };

describe("a Run's actions", () => {
  test("a Run that isn't active or archived can be made active or archived", () => {
    expect(runActions(inactive, "owner")).toEqual(["makeActive", "archive"]);
    expect(runActions(inactive, "mod")).toEqual(["makeActive", "archive"]);
  });

  test("the active Run can only be archived", () => {
    expect(runActions(active, "owner")).toEqual(["archive"]);
  });

  test("only the Streamer can delete, and only an archived Run", () => {
    expect(runActions(archived, "owner")).toEqual(["delete"]);
    expect(runActions(archived, "mod")).toEqual([]);
  });
});
