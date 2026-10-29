// Runs the Watcher: while the game is running, finds the save, reads it
// whenever the game writes it, and hands each report to the App's UI. The
// Rust side never touches the network: only the UI sends reports, which its CSP
// allows only to Convex site hosts.

use std::fs::{self, OpenOptions};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, Once};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use tauri::ipc::Channel;

use crate::watcher::{Outcome, Report, Watcher};

// How often the save is checked for a new write.
const POLL: Duration = Duration::from_millis(100);
// How often to look again for a save that isn't there yet.
const LOOK_FOR_SAVE: Duration = Duration::from_secs(5);
// How often to check that the game is running. Nothing is read or reported
// while it isn't, so the Watcher is Online exactly while the game runs.
const LOOK_FOR_GAME: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    GameClosed,
    NoSave,
    Waiting,
    Unreadable,
    Reading,
}

#[derive(Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WatcherEvent {
    Report { report: Report },
    Status { status: Status },
}

// A reloaded page asks again, and gets the latest status at once, while the
// one Watcher keeps running.
struct Ui {
    events: Option<Channel<WatcherEvent>>,
    status: Option<Status>,
}

static UI: Mutex<Ui> = Mutex::new(Ui {
    events: None,
    status: None,
});
static START: Once = Once::new();

#[tauri::command]
pub fn watch_save(events: Channel<WatcherEvent>) {
    let mut ui = UI.lock().unwrap();
    if let Some(status) = ui.status {
        let _ = events.send(WatcherEvent::Status { status });
    }
    ui.events = Some(events);
    drop(ui);
    START.call_once(|| {
        thread::spawn(run);
    });
}

fn send(event: WatcherEvent) {
    let mut ui = UI.lock().unwrap();
    if let WatcherEvent::Status { status } = event {
        if ui.status == Some(status) {
            return;
        }
        ui.status = Some(status);
    }
    if let Some(events) = &ui.events {
        let _ = events.send(event);
    }
}

fn run() {
    let mut watcher = Watcher::new();
    // The save being read, and the one the Watcher's state belongs to, which
    // is kept while the save is briefly out of reach.
    let mut save: Option<PathBuf> = None;
    let mut watched: Option<PathBuf> = None;
    let mut last_write = None;
    let mut retry_at: Option<Instant> = None;
    let mut game_checked_at: Option<Instant> = None;
    loop {
        // The Watcher keeps its state while the game is closed, so on launch
        // its last report, by then over 30 seconds old, goes out at once. The
        // save is read again then too, so the status is replaced even if
        // nothing was reported yet.
        if game_checked_at.is_none_or(|at| at.elapsed() >= LOOK_FOR_GAME) {
            if !game_running() {
                if let Some(report) = watcher.game_closed(Instant::now()) {
                    send(WatcherEvent::Report { report });
                }
                send(WatcherEvent::Status {
                    status: Status::GameClosed,
                });
                game_checked_at = None;
                last_write = None;
                thread::sleep(LOOK_FOR_GAME);
                continue;
            }
            game_checked_at = Some(Instant::now());
        }
        let Some(path) = save.clone().or_else(find_save) else {
            send(WatcherEvent::Status {
                status: Status::NoSave,
            });
            // The game may have closed during the wait.
            game_checked_at = None;
            thread::sleep(LOOK_FOR_SAVE);
            continue;
        };
        if watched.as_ref() != Some(&path) {
            watcher = Watcher::new();
            watched = Some(path.clone());
            last_write = None;
        }
        save = Some(path.clone());

        let now = Instant::now();
        let Ok(written) = last_written(&path) else {
            // Moved or deleted, so it's looked for again.
            save = None;
            thread::sleep(POLL);
            continue;
        };
        if last_write != Some(written) || retry_at.is_some_and(|at| now >= at) {
            last_write = Some(written);
            retry_at = None;
            match read_shared(&path) {
                Ok(bytes) => match watcher.observe(now, &bytes) {
                    Outcome::Report(report) => {
                        send(WatcherEvent::Status {
                            status: Status::Reading,
                        });
                        send(WatcherEvent::Report { report });
                    }
                    Outcome::Unchanged => send(WatcherEvent::Status {
                        status: Status::Reading,
                    }),
                    Outcome::Waiting => send(WatcherEvent::Status {
                        status: Status::Waiting,
                    }),
                    Outcome::Retry { after } => retry_at = Some(now + after),
                    Outcome::Unreadable { after } => {
                        send(WatcherEvent::Status {
                            status: Status::Unreadable,
                        });
                        retry_at = Some(now + after);
                    }
                },
                Err(_) => retry_at = Some(now + POLL),
            }
        }
        if let Some(report) = watcher.heartbeat(now) {
            // As on a relaunch, while a doubted Save Total is still being retried.
            send(WatcherEvent::Status {
                status: Status::Reading,
            });
            send(WatcherEvent::Report { report });
        }
        thread::sleep(POLL);
    }
}

// Whether a process named eldenring.exe is running. Easy Anti-Cheat guards
// the game, so this only lists process names from a ToolHelp snapshot. It must
// never open a handle to a process, read its memory or inject anything.
#[cfg(windows)]
fn game_running() -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    // SAFETY: the snapshot is a list of names owned by this process, closed
    // before returning, and each entry is sized as the API asks.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            // Better to report while the game might be closed than to stop
            // while it's running.
            return true;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = false;
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        while more {
            let name = &entry.szExeFile;
            let len = name.iter().position(|&c| c == 0).unwrap_or(name.len());
            if String::from_utf16_lossy(&name[..len]).eq_ignore_ascii_case("eldenring.exe") {
                found = true;
                break;
            }
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
        found
    }
}

// Development on other platforms behaves as if the game were always running.
#[cfg(not(windows))]
fn game_running() -> bool {
    true
}

// %APPDATA%\EldenRing\<Steam ID>\ER0000.sl2. With more than one Steam
// account, the save written most recently is the one being played.
fn find_save() -> Option<PathBuf> {
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

// Opened read-only, sharing it so the game can keep writing, and closed as
// soon as it's read. A read that catches a write fails its MD5 and is retried.
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
