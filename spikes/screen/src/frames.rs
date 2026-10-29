// What the captured frames are logged as: a summary every second of how many
// arrived, the gaps between them and the spike's own CPU use, plus any single
// gap long enough to be a stall.

use std::time::{Duration, Instant};

// A gap this long is logged on its own, as the capture or the game stalling.
pub const STALL: Duration = Duration::from_millis(100);

pub struct FrameStats {
    last: Option<Instant>,
    frames: u32,
    gaps: u32,
    gap_total: Duration,
    longest: Duration,
}

impl FrameStats {
    pub fn new() -> Self {
        FrameStats {
            last: None,
            frames: 0,
            gaps: 0,
            gap_total: Duration::ZERO,
            longest: Duration::ZERO,
        }
    }

    // The gap from the last frame to one arriving at `at`.
    pub fn gap(&self, at: Instant) -> Option<Duration> {
        self.last.map(|last| at - last)
    }

    // A frame arrived. Returns the gap since the last one if it was a stall.
    pub fn frame(&mut self, at: Instant) -> Option<Duration> {
        self.frames += 1;
        let gap = at - self.last.replace(at)?;
        self.gaps += 1;
        self.gap_total += gap;
        self.longest = self.longest.max(gap);
        (gap >= STALL).then_some(gap)
    }

    // The summary since the last one, given the CPU time this process used
    // over `wall` on a PC with `cores` logical cores.
    pub fn summary(&mut self, busy: Duration, wall: Duration, cores: u32) -> String {
        let cpu = 100.0 * busy.as_secs_f64() / (wall.as_secs_f64() * f64::from(cores));
        let gaps = if self.gaps == 0 {
            String::new()
        } else {
            format!(
                ", gap mean {:.1} ms, max {:.1} ms",
                millis(self.gap_total) / f64::from(self.gaps),
                millis(self.longest)
            )
        };
        let line = format!(
            "frames: {}{gaps}, CPU {cpu:.1}% of {cores} cores",
            self.frames
        );
        *self = FrameStats {
            last: self.last,
            ..FrameStats::new()
        };
        line
    }
}

pub fn millis(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

    #[test]
    fn a_second_of_frames_sums_up_their_gaps_and_the_cpu_used() {
        let mut stats = FrameStats::new();
        let start = Instant::now();

        for n in [0, 10, 20, 50] {
            stats.frame(start + ms(n));
        }
        let summary = stats.summary(ms(80), ms(1000), 8);

        assert_eq!(
            summary,
            "frames: 4, gap mean 16.7 ms, max 30.0 ms, CPU 1.0% of 8 cores"
        );
    }

    #[test]
    fn each_summary_starts_afresh_from_the_last_frame() {
        let mut stats = FrameStats::new();
        let start = Instant::now();
        stats.frame(start);
        stats.frame(start + ms(16));
        stats.summary(ms(10), ms(1000), 4);

        stats.frame(start + ms(40));
        let summary = stats.summary(ms(40), ms(1000), 4);

        assert_eq!(
            summary,
            "frames: 1, gap mean 24.0 ms, max 24.0 ms, CPU 1.0% of 4 cores"
        );
    }

    #[test]
    fn a_second_with_no_frames_says_so() {
        let mut stats = FrameStats::new();

        let summary = stats.summary(ms(5), ms(1000), 4);

        assert_eq!(summary, "frames: 0, CPU 0.1% of 4 cores");
    }

    #[test]
    fn a_long_gap_is_a_stall() {
        let mut stats = FrameStats::new();
        let start = Instant::now();

        let first = stats.frame(start);
        let quick = stats.frame(start + ms(99));
        let stall = stats.frame(start + ms(250));

        assert_eq!((first, quick, stall), (None, None, Some(ms(151))));
    }
}
