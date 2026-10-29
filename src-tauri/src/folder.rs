use std::fs;
use std::path::Path;

// Everything the App keeps lives in its own folder, so it can't run from one
// it can't write to. A file is written and removed to find out, because
// Windows folder permissions can't be read reliably any other way.
pub fn check_writable(dir: &Path) -> Result<(), String> {
    let probe = dir.join(".write-check");
    fs::write(&probe, b"")
        .and_then(|()| fs::remove_file(&probe))
        .map_err(|error| {
            format!(
                "Erdtrack can't save to its folder, {}, so it won't start ({error}).\n\n\
                 Move the Erdtrack folder somewhere you can write to, such as \
                 Documents or Desktop, and run it again.",
                dir.display()
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn a_writable_folder_is_accepted_and_left_as_it_was() {
        let dir = tempfile::tempdir().unwrap();

        assert_eq!(check_writable(dir.path()), Ok(()));
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    // Windows ignores the read-only flag on folders, so only Unix can fake an
    // unwritable one here. On Windows it's checked by hand.
    #[cfg(unix)]
    #[test]
    fn an_unwritable_folder_is_refused_with_a_reason_and_a_fix() {
        let dir = tempfile::tempdir().unwrap();
        let mut permissions = fs::metadata(dir.path()).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(dir.path(), permissions.clone()).unwrap();

        let refusal = check_writable(dir.path()).unwrap_err();

        permissions.set_readonly(false);
        fs::set_permissions(dir.path(), permissions).unwrap();
        assert!(refusal.contains(&dir.path().display().to_string()));
        assert!(refusal.contains("can't save"));
        assert!(refusal.contains("Move the Erdtrack folder"));
    }
}
