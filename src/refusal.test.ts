import { describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import { refusalMessage } from "./refusal";

describe("a refused mutation's toast", () => {
  test("shows the backend's message", () => {
    expect(
      refusalMessage(new ConvexError("Only the Streamer can delete Runs."), "That failed."),
    ).toBe("Only the Streamer can delete Runs.");
  });

  test("shows the fallback for anything the backend didn't explain", () => {
    expect(refusalMessage(new Error("Server Error"), "Undo failed.")).toBe(
      "Undo failed.",
    );
  });
});
