// No console window behind the App in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use tauri::{WebviewUrl, WebviewWindowBuilder};
mod defeat_flags;
mod folder;
mod play_time;
mod save;
mod settings;
#[cfg(test)]
mod synthetic_save;
mod watch;
mod watcher;

use folder::check_writable;
use settings::AppFolder;

fn main() {
    let folder = app_folder();
    if let Err(refusal) = check_writable(&folder) {
        rfd::MessageDialog::new()
            .set_level(rfd::MessageLevel::Error)
            .set_title("Erdtrack can't start")
            .set_description(refusal)
            .show();
        std::process::exit(1);
    }

    tauri::Builder::default()
        .manage(AppFolder(folder.clone()))
        .invoke_handler(tauri::generate_handler![
            watch::watch_save,
            settings::load_settings,
            settings::save_settings
        ])
        .setup(move |app| {
            // WebView2 keeps its data in AppData unless told otherwise. It's
            // kept next to the exe, so deleting the folder removes it too.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Erdtrack")
                .inner_size(480.0, 560.0)
                .min_inner_size(360.0, 280.0)
                .data_directory(folder.join("webview"))
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Erdtrack failed to start");
}

// The folder the exe was unzipped into.
fn app_folder() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(PathBuf::from))
        .expect("Erdtrack can't tell which folder it's in")
}
