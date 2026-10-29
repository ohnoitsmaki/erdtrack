fn main() {
    // Listing the App's commands makes each refused unless the permissions
    // file allows it, like everything else.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&[
                "watch_save",
                "load_settings",
                "save_settings",
            ])),
    )
    .expect("failed to run tauri-build");
}
