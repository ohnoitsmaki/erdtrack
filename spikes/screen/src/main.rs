// The screen spike (#57): logs save writes, captured frames and marks on one
// monotonic clock, and saves captured regions on request. See README.md.
// It logs to the terminal only: it never reports to a Panel, and nothing in
// it touches the network. Most of it runs only on Windows; elsewhere only the
// tests do.
#![cfg_attr(not(windows), allow(dead_code))]

// The App's own save parser, so the spike sees exactly what the Watcher sees.
#[allow(dead_code)]
#[path = "../../../src-tauri/src/defeat_flags.rs"]
mod defeat_flags;
#[allow(dead_code)]
#[path = "../../../src-tauri/src/save.rs"]
mod save;
#[cfg(test)]
#[path = "../../../src-tauri/src/synthetic_save.rs"]
mod synthetic_save;

#[cfg(windows)]
mod capture;
mod frames;
mod log;
mod regions;
mod save_log;
mod save_watch;

const USAGE: &str =
    "usage: screen-spike [--save <ER0000.sl2>] [--monitor] [--readback] [--each-frame]";

#[cfg(not(windows))]
fn main() {
    eprintln!("The screen spike runs only on Windows. {USAGE}");
    std::process::exit(1);
}

#[cfg(windows)]
fn main() {
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};

    use capture::{Shared, Target};
    use log::{log, START};

    let mut save = None;
    let mut target = Target::Window;
    let mut readback = false;
    let mut each_frame = false;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--save" => save = args.next().map(PathBuf::from),
            "--monitor" => target = Target::Monitor,
            "--readback" => readback = true,
            "--each-frame" => each_frame = true,
            _ => {
                eprintln!("{USAGE}");
                std::process::exit(1);
            }
        }
    }
    let Some(save) = save.or_else(save_watch::find_save) else {
        eprintln!("no save found in %APPDATA%\\EldenRing. {USAGE}");
        std::process::exit(1);
    };
    if !save.exists() {
        eprintln!(
            "no save at {} (it ends in .sl2, with a lowercase L)",
            save.display()
        );
        std::process::exit(1);
    }

    let started = *START;
    log(started, "start", &format!("save {}", save.display()));
    log(
        started,
        "start",
        "F5 killing blow, F6 fog gate, F7 fleeing, F8 save the regions. Type a note and press Enter to mark it. Ctrl+C to stop.",
    );

    let shared = Arc::new(Shared {
        stats: Mutex::new(frames::FrameStats::new()),
        region_request: Mutex::new(None),
        readback,
        each_frame,
        captures: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("captures"),
    });

    thread::spawn(move || save_watch::watch(save));
    thread::spawn({
        let shared = shared.clone();
        move || hotkeys(&shared)
    });
    thread::spawn({
        let shared = shared.clone();
        move || {
            for line in std::io::stdin().lines().map_while(Result::ok) {
                let at = Instant::now();
                match line.trim() {
                    "" => log(at, "mark", "(Enter)"),
                    "save" => request_regions(&shared, at),
                    note => log(at, "mark", note),
                }
            }
        }
    });

    unsafe {
        windows::Win32::System::WinRT::RoInitialize(
            windows::Win32::System::WinRT::RO_INIT_MULTITHREADED,
        )
        .expect("WinRT");
    }
    let _capture = match capture::start(target, shared.clone()) {
        Ok(capture) => capture,
        Err(e) => {
            log(
                Instant::now(),
                "frame",
                &format!("capture failed to start: {e}"),
            );
            std::process::exit(1);
        }
    };

    let cores = thread::available_parallelism().map_or(1, |n| n.get() as u32);
    let mut wall = Instant::now();
    let mut busy = cpu_time();
    loop {
        thread::sleep(Duration::from_secs(1));
        let (now, used) = (Instant::now(), cpu_time());
        // A failed read of the CPU time comes back as zero.
        let summary =
            shared
                .stats
                .lock()
                .unwrap()
                .summary(used.saturating_sub(busy), now - wall, cores);
        log(now, "frames", &summary);
        (wall, busy) = (now, used);
    }
}

#[cfg(windows)]
fn request_regions(shared: &capture::Shared, at: std::time::Instant) {
    *shared.region_request.lock().unwrap() = Some(at);
    log::log(at, "region", "saving the regions of the next frame");
}

// Global hotkeys, so marking a moment needs no alt-tab out of the game.
// They're registered with Windows, which hands them to this thread, and they
// never touch the game.
#[cfg(windows)]
fn hotkeys(shared: &capture::Shared) {
    use std::time::Instant;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        RegisterHotKey, MOD_NOREPEAT, VIRTUAL_KEY, VK_F5, VK_F6, VK_F7, VK_F8,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetMessageW, MSG, WM_HOTKEY};

    // Each key with the mark it logs, or None to save the regions.
    const KEYS: [(&str, VIRTUAL_KEY, Option<&str>); 4] = [
        ("F5", VK_F5, Some("killing blow")),
        ("F6", VK_F6, Some("fog gate")),
        ("F7", VK_F7, Some("fleeing")),
        ("F8", VK_F8, None),
    ];
    for (id, (name, key, _)) in KEYS.iter().enumerate() {
        if let Err(e) = unsafe { RegisterHotKey(None, id as i32, MOD_NOREPEAT, key.0 as u32) } {
            log::log(
                Instant::now(),
                "start",
                &format!("{name} is taken by another program: {e}"),
            );
        }
    }
    let mut msg = MSG::default();
    // -1 is an error, and 0 the thread quitting.
    while unsafe { GetMessageW(&mut msg, None, 0, 0) }.0 > 0 {
        if msg.message != WM_HOTKEY {
            continue;
        }
        let at = Instant::now();
        match KEYS.get(msg.wParam.0) {
            Some((_, _, Some(mark))) => log::log(at, "mark", mark),
            Some((_, _, None)) => request_regions(shared, at),
            None => {}
        }
    }
}

// The CPU time this process has used, user and kernel.
#[cfg(windows)]
fn cpu_time() -> std::time::Duration {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};

    let (mut created, mut exited, mut kernel, mut user) = Default::default();
    let ticks = |t: FILETIME| (u64::from(t.dwHighDateTime) << 32) | u64::from(t.dwLowDateTime);
    // A failure counts as no CPU used, which the summary would show as 0%.
    let _ = unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            &mut created,
            &mut exited,
            &mut kernel,
            &mut user,
        )
    };
    std::time::Duration::from_nanos((ticks(kernel) + ticks(user)) * 100)
}
