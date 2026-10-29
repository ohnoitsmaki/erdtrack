// Every line goes out stamped on one monotonic clock, in seconds since the
// spike started, so save writes, frames and marks line up.

use std::sync::LazyLock;
use std::time::Instant;

pub static START: LazyLock<Instant> = LazyLock::new(Instant::now);

pub fn seconds(at: Instant) -> f64 {
    at.saturating_duration_since(*START).as_secs_f64()
}

pub fn log(at: Instant, kind: &str, line: &str) {
    println!("[{:>10.3}] {kind:<6} {line}", seconds(at));
}
