import { describe, expect, test } from "vitest";
import { loginProblem } from "./mods";

describe("adding a Mod by Twitch login", () => {
  test("a Twitch login has no problem, written however the Streamer types it", () => {
    expect(loginProblem("some_mod42")).toBeUndefined();
    expect(loginProblem("  @Some_Mod ")).toBeUndefined();
  });

  test("anything a Twitch login can't contain is a problem", () => {
    expect(loginProblem("some mod")).toBe(
      "Twitch logins are letters, digits and underscores.",
    );
  });
});
