import { parseStyle, type OverlayStyle } from "./style";

// A Preset: a named style saved for the channel.
export type Preset = { name: string; style: OverlayStyle };

const MAX_NAME_LENGTH = 50;

export function presetName(input: string) {
  const name = input.trim();
  return name && name.length <= MAX_NAME_LENGTH ? name : null;
}

export function parsePreset(value: unknown): Preset | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { name, style } = value as Record<string, unknown>;
  const named = typeof name === "string" ? presetName(name) : null;
  return named ? { name: named, style: parseStyle(style) } : null;
}

// Text a Mod can copy and paste into another Erdtrack.
export function exportPreset(preset: Preset) {
  return JSON.stringify(preset, null, 2);
}

// Pasted text from an export, or null when it isn't one.
export function importPreset(text: string): Preset | null {
  try {
    return parsePreset(JSON.parse(text));
  } catch {
    return null;
  }
}
