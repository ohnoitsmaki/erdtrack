// Where the Watcher reports to: the Panel's address and the Watcher token,
// as the Streamer pasted them, and whether its reports carry the Play Time.
// Kept next to the exe, like everything else the App keeps, so deleting the
// folder removes them too.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::State;

#[derive(Clone, Default, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub panel_address: String,
    pub token: String,
    // Off unless the Streamer turns it on, and in settings saved before it.
    #[serde(default)]
    pub send_play_time: bool,
}

const FILE: &str = "settings.json";

// The folder the exe was unzipped into, where the settings are kept.
pub struct AppFolder(pub PathBuf);

#[tauri::command]
pub fn load_settings(folder: State<AppFolder>) -> Settings {
    load(&folder.0)
}

#[tauri::command]
pub fn save_settings(folder: State<AppFolder>, settings: Settings) -> Result<(), String> {
    save(&folder.0, &settings)
}

// Empty on first run, or if the file was edited into something unreadable,
// so the Streamer is asked again.
pub fn load(folder: &Path) -> Settings {
    fs::read_to_string(folder.join(FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(folder: &Path, settings: &Settings) -> Result<(), String> {
    let text = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(folder.join(FILE), text + "\n")
        .map_err(|error| format!("The settings couldn't be saved ({error})."))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pasted() -> Settings {
        Settings {
            panel_address: "https://happy-otter-123.convex.site".into(),
            token: "secret-token".into(),
            send_play_time: false,
        }
    }

    #[test]
    fn saved_settings_are_loaded_again_after_a_restart() {
        let dir = tempfile::tempdir().unwrap();

        save(dir.path(), &pasted()).unwrap();

        assert_eq!(load(dir.path()), pasted());
        assert!(dir.path().join("settings.json").exists());
    }

    #[test]
    fn saving_again_replaces_them() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), &pasted()).unwrap();
        let replaced = Settings {
            token: "new-token".into(),
            ..pasted()
        };

        save(dir.path(), &replaced).unwrap();

        assert_eq!(load(dir.path()), replaced);
    }

    #[test]
    fn play_time_is_kept_with_them() {
        let dir = tempfile::tempdir().unwrap();
        let sending = Settings {
            send_play_time: true,
            ..pasted()
        };

        save(dir.path(), &sending).unwrap();

        assert!(load(dir.path()).send_play_time);
    }

    // Settings saved before Play Time could be sent keep their address and
    // token, and don't send it.
    #[test]
    fn settings_from_before_play_time_load_with_it_off() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("settings.json"),
            r#"{"panelAddress":"https://happy-otter-123.convex.site","token":"secret-token"}"#,
        )
        .unwrap();

        assert_eq!(load(dir.path()), pasted());
    }

    #[test]
    fn on_first_run_they_are_empty() {
        let dir = tempfile::tempdir().unwrap();

        assert_eq!(load(dir.path()), Settings::default());
    }

    // Edited by hand, or cut short, it's as if there were none.
    #[test]
    fn an_unreadable_file_is_as_if_there_were_none() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("settings.json"), "{not json").unwrap();

        assert_eq!(load(dir.path()), Settings::default());
    }

    #[test]
    fn a_failed_save_says_why() {
        let dir = tempfile::tempdir().unwrap();
        let missing: PathBuf = dir.path().join("gone");

        let refusal = save(&missing, &pasted()).unwrap_err();

        assert!(refusal.contains("couldn't be saved"));
    }
}
