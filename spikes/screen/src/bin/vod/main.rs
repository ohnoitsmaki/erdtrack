// Runs the Spotter's reading and matching over a video instead of the game,
// to measure how often it's right before it's built (ADR 0017). See the
// README's "Test on a video". Like the spike, it sends nothing anywhere.
//
//   vod read: frames from ffmpeg on stdin, what OCR reads on stdout. Windows
//     only, and the slow part.
//   vod score: what was read, matched and turned into events, and compared
//     with the video's labels. Runs anywhere, in a moment, so the matching can
//     be tuned without reading again.
#![cfg_attr(not(windows), allow(dead_code))]

mod cleanup;
mod events;
mod matching;
#[cfg(windows)]
mod ocr;
mod readings;
#[path = "../../regions.rs"]
#[allow(dead_code)]
mod regions;
mod score;

use std::process::exit;

use events::{Kind, Reads, Settings};

const USAGE: &str = "usage:
  vod read --video <name> --size <width>x<height> --fps <n> [--start <time>] [--threads <n>]
      < raw BGRA frames from ffmpeg > readings.jsonl
  vod score <readings.jsonl> [--labels <file>] [--events] [--reads raw|clean|both] [--anywhere]
      [--most-wrong <n>] [--confirm <frames>] [--gone <seconds>]";

fn fail(message: &str) -> ! {
    eprintln!("{message}\n\n{USAGE}");
    exit(1);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("read") => read(&args[1..]),
        Some("score") => score(&args[1..]),
        _ => fail("read or score?"),
    }
}

fn value<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
    let at = args.iter().position(|a| a == flag)?;
    Some(
        args.get(at + 1)
            .unwrap_or_else(|| fail(&format!("{flag} needs a value"))),
    )
}

fn number<T: std::str::FromStr>(args: &[String], flag: &str) -> Option<T> {
    value(args, flag).map(|v| v.parse().unwrap_or_else(|_| fail(&format!("{flag} {v}?"))))
}

#[cfg(not(windows))]
fn read(_: &[String]) {
    fail("vod read runs only on Windows, which has the OCR it uses.");
}

#[cfg(windows)]
fn read(args: &[String]) {
    use std::collections::BTreeMap;
    use std::io::{BufReader, BufWriter, Read, Write};
    use std::sync::{mpsc, Arc, Mutex};
    use std::thread;
    use std::time::Instant;

    use cleanup::clean_up;
    use readings::{Header, Reading};
    use regions::{crop, Frame, REGIONS};

    let video = value(args, "--video").unwrap_or_else(|| fail("--video?"));
    let (width, height) = value(args, "--size")
        .and_then(|s| s.split_once('x'))
        .and_then(|(w, h)| Some((w.parse::<u32>().ok()?, h.parse::<u32>().ok()?)))
        .unwrap_or_else(|| fail("--size?"));
    let fps: f64 = number(args, "--fps").unwrap_or_else(|| fail("--fps?"));
    let start = value(args, "--start").map_or(0.0, |s| {
        score::parse_time(s).unwrap_or_else(|| fail("--start?"))
    });

    let threads = number(args, "--threads")
        .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()));
    // Fail early if Windows can't read English.
    ocr::Ocr::english().unwrap_or_else(|e| fail(&e));

    let mut out = BufWriter::new(std::io::stdout().lock());
    let header = Header {
        video: video.into(),
        width,
        height,
        fps,
    };
    writeln!(out, "{}", serde_json::to_string(&header).unwrap()).unwrap();

    // Frames go to a thread each, which read them, and come back in order.
    let (frames, frames_out) = mpsc::sync_channel::<(u64, Vec<u8>)>(threads * 2);
    let frames_out = Arc::new(Mutex::new(frames_out));
    let (results, results_out) = mpsc::channel::<(u64, Reading)>();
    for _ in 0..threads {
        let (frames_out, results) = (frames_out.clone(), results.clone());
        thread::spawn(move || {
            let ocr = ocr::Ocr::english().unwrap();
            let region = |name| REGIONS.iter().find(|r| r.name == name).unwrap();
            let (felled, bars) = (region("felled"), region("name-bars"));
            loop {
                let next = frames_out.lock().unwrap().recv();
                let Ok((n, bgra)) = next else { return };
                let frame = Frame {
                    bgra: &bgra,
                    width,
                    height,
                    row_pitch: width as usize * 4,
                };
                let t = start + n as f64 / fps;
                let read = |image, region| {
                    ocr.lines(image, region)
                        .unwrap_or_else(|e| fail(&format!("OCR at {t}: {e}")))
                };
                let bar_crop = crop(&frame, bars);
                let double =
                    bar_crop.width * 2 <= ocr.max_side && bar_crop.height * 2 <= ocr.max_side;
                let reading = Reading {
                    t,
                    felled: read(&crop(&frame, felled), felled)
                        .into_iter()
                        .map(|line| line.text)
                        .collect(),
                    bars: read(&bar_crop, bars),
                    bars_clean: read(&clean_up(&bar_crop, double), bars),
                };
                if results.send((n, reading)).is_err() {
                    return;
                }
            }
        });
    }
    drop(results);
    thread::spawn(move || {
        let mut input = BufReader::with_capacity(1 << 24, std::io::stdin().lock());
        for n in 0.. {
            let mut bgra = vec![0; (width * height * 4) as usize];
            if input.read_exact(&mut bgra).is_err() || frames.send((n, bgra)).is_err() {
                return;
            }
        }
    });

    let began = Instant::now();
    let mut waiting = BTreeMap::new();
    let mut n = 0u64;
    for (at, reading) in results_out {
        waiting.insert(at, reading);
        while let Some(reading) = waiting.remove(&n) {
            writeln!(out, "{}", serde_json::to_string(&reading).unwrap()).unwrap();
            n += 1;
            if n.is_multiple_of((fps as u64 * 60).max(1)) {
                eprintln!(
                    "{} read, {:.1}x real time",
                    score::format_time(reading.t),
                    (n as f64 / fps) / began.elapsed().as_secs_f64()
                );
            }
        }
    }
    out.flush().unwrap();
    eprintln!(
        "{n} frames read in {:.0} s on {threads} threads",
        began.elapsed().as_secs_f64()
    );
}

fn score(args: &[String]) {
    let path = args
        .first()
        .filter(|a| !a.starts_with("--"))
        .unwrap_or_else(|| fail("readings?"));
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| fail(&format!("{path}: {e}")));
    let (header, readings) =
        readings::parse(&text).unwrap_or_else(|e| fail(&format!("{path}: {e}")));

    let defaults = Settings::default();
    let settings = Settings {
        most_wrong: number(args, "--most-wrong").unwrap_or(defaults.most_wrong),
        confirm: number(args, "--confirm").unwrap_or(defaults.confirm),
        gone_after: number(args, "--gone").unwrap_or(defaults.gone_after),
        anywhere: args.iter().any(|a| a == "--anywhere"),
        reads: match value(args, "--reads") {
            None | Some("both") => Reads::Both,
            Some("raw") => Reads::Raw,
            Some("clean") => Reads::Clean,
            Some(other) => fail(&format!("--reads {other}?")),
        },
        ..defaults
    };
    let bars = matching::BarNames::load();
    let events = events::events(&readings, &bars.names(), &settings);
    let length = readings.last().map_or(0.0, |r| r.t) - readings.first().map_or(0.0, |r| r.t);
    println!(
        "{}: {}x{} at {} fps, {} read",
        header.video,
        header.width,
        header.height,
        header.fps,
        score::format_time(length)
    );

    let labels = value(args, "--labels");
    if labels.is_none() || args.iter().any(|a| a == "--events") {
        println!("\nEvents");
        for event in &events {
            let (what, name) = match &event.kind {
                Kind::Appeared(name) => ("bar", name),
                Kind::Gone(name) => ("gone", name),
                Kind::Felled(message) => ("felled", message),
            };
            println!("  {}  {what:<6} {name}", score::format_time(event.t));
        }
    }
    if let Some(labels) = labels {
        let text =
            std::fs::read_to_string(labels).unwrap_or_else(|e| fail(&format!("{labels}: {e}")));
        let labels = score::parse_labels(&text).unwrap_or_else(|e| fail(&e));
        println!("\n{}", score::score(&events, &labels, &bars, length));
    }
}
