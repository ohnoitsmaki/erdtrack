import { describe, expect, test } from "vitest";
import { exportPreset, importPreset } from "./presets";
import { DEFAULT_STYLE } from "./style";

describe("sharing a Preset", () => {
  test("it comes back as it was exported, Overworld's line left out", () => {
    const preset = {
      name: "Bosses only",
      style: { ...DEFAULT_STYLE, overworld: false },
    };
    expect(importPreset(exportPreset(preset))).toEqual(preset);
  });

  test("it brings its labels, a stat's and Gravity's alike", () => {
    const preset = {
      name: "Short labels",
      style: {
        ...DEFAULT_STYLE,
        labels: { total: "Deaths", attempts: "Tries" },
        pieces: DEFAULT_STYLE.pieces.map((entry) =>
          entry.piece === "gravity" ? { ...entry, label: "Falls" } : entry,
        ),
      },
    };
    expect(importPreset(exportPreset(preset))).toEqual(preset);
  });
});
