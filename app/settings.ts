import { invoke } from "@tauri-apps/api/core";

// Where the App reports to, and with what. Play Time is sent only while
// it's on, which it isn't until the Streamer turns it on.
export type Settings = {
  panelAddress: string;
  token: string;
  sendPlayTime: boolean;
};

// Kept in settings.json next to the exe by the Rust side, so the App's window
// needs no file access of its own. Empty on first run.
export function loadSettings() {
  return invoke<Settings>("load_settings");
}

export function saveSettings(settings: Settings) {
  return invoke<void>("save_settings", { settings });
}
