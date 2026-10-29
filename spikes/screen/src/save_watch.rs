// Polls the save for writes and logs each one. It opens the save read-only,
// sharing it so the game can keep writing, as the Watcher does.

use std::fs::{self, OpenOptions};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use crate::log::log;
use crate::save::read_save;
use crate::save_log::SaveLog;

// Finer than the Watcher's 100 ms, to time writes closely.
const POLL: Duration = Duration::from_millis(50);

pub fn watch(path: PathBuf) {
    let mut save_log = SaveLog::new();
    let mut last_write = None;
    // When the write being read was first seen, kept while torn reads retry.
    let mut seen_at: Option<Instant> = None;
    loop {
        thread::sleep(POLL);
        let Ok(written) = last_written(&path) else {
            continue; // mid-replace
        };
        if last_write == Some(written) && seen_at.is_none() {
            continue;
        }
        let at = *seen_at.get_or_insert_with(Instant::now);
        match read_shared(&path).map(|bytes| read_save(&bytes)) {
            Ok(Ok(save)) => {
                for line in save_log.write(&save) {
                    log(at, "save", &line);
                }
                last_write = Some(written);
                seen_at = None;
            }
            Ok(Err(_)) => log(
                Instant::now(),
                "save",
                "torn read, the game was mid-write; reading again",
            ),
            Err(e) => log(
                Instant::now(),
                "save",
                &format!("read failed ({e}); reading again"),
            ),
        }
    }
}

// %APPDATA%\EldenRing\<Steam ID>\ER0000.sl2, the one written most recently.
pub fn find_save() -> Option<PathBuf> {
    let folder = PathBuf::from(std::env::var_os("APPDATA")?).join("EldenRing");
    fs::read_dir(folder)
        .ok()?
        .flatten()
        .map(|entry| entry.path().join("ER0000.sl2"))
        .filter_map(|path| Some((fs::metadata(&path).ok()?.modified().ok()?, path)))
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path)
}

fn last_written(path: &Path) -> io::Result<(SystemTime, u64)> {
    let metadata = fs::metadata(path)?;
    Ok((metadata.modified()?, metadata.len()))
}

fn read_shared(path: &Path) -> io::Result<Vec<u8>> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_SHARE_READ_WRITE_DELETE: u32 = 0x1 | 0x2 | 0x4;
        options.share_mode(FILE_SHARE_READ_WRITE_DELETE);
    }
    let mut bytes = Vec::new();
    options.open(path)?.read_to_end(&mut bytes)?;
    Ok(bytes)
}
