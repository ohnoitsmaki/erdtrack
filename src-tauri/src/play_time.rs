// The Play Time the game last saved, counted on between saves so the Overlay
// shows a running clock without the save being read every second. The
// Watcher feeds it each read and reports what it shows (ADR 0018).
//
// The game only writes the Play Time to the profile summary on some saves:
// loading in, respawning, resting and quitting. Its clock keeps running while
// the Streamer is AFK, when nothing is saved, and stops on the title screen.

use std::time::{Duration, Instant};

// A save behind what was already shown by at most this much is taken to be
// the clock's drift, as after a loading screen the game didn't count, and the
// clock waits for it rather than going back. Further behind, it's another
// save, as after restoring a backup.
const HOLD_AT_MOST: Duration = Duration::from_secs(60);

// A profile summary written with the same time as one read at least this
// long before means the game's clock was stopped in between: the Streamer has
// loaded in from the title screen. Sooner, it's a save in the same second.
const STILL_AFTER: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct PlayTime {
    pub seconds: f64,
    // Whether it's counting up, so the Overlay can count on between reports.
    pub running: bool,
}

// What a write to the save changed.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Write {
    // The profile summary, so the Play Time in it is current.
    Profile,
    // Only the character slots, which the game only does while the Streamer is
    // loaded in. The Play Time in the profile summary is whatever it was at
    // its last write.
    SlotOnly,
    // Nothing, as on reaching the title screen.
    Unchanged,
    // The App's first read, which can't tell what changed.
    First,
}

// The active slot's Play Time from one read of the save.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PlayTimeRead {
    pub slot: u8,
    pub seconds: u32,
    pub write: Write,
}

#[derive(Clone, Copy)]
struct Saved {
    slot: u8,
    seconds: u32,
    read_at: Instant,
}

pub struct PlayClock {
    saved: Option<Saved>,
    // Only while the Streamer is loaded in, so the clock doesn't run on the
    // title screen.
    running: bool,
    // What was shown when a save came in behind it, kept until the clock
    // passes it.
    held: Option<f64>,
}

impl PlayClock {
    pub fn new() -> Self {
        PlayClock {
            saved: None,
            running: false,
            held: None,
        }
    }

    pub fn saw(&mut self, now: Instant, read: PlayTimeRead) {
        let PlayTimeRead {
            slot,
            seconds,
            write,
        } = read;
        let shown = self.shown(now).map(|time| time.seconds);
        let (running, held) = match self.saved {
            Some(saved) if saved.slot == slot => match write {
                Write::SlotOnly if self.running => return,
                // The Streamer is playing, as when the App opened mid-game.
                // The time may be behind until the game next saves it.
                Write::SlotOnly => (true, None),
                // On the title screen. The game stopped counting when the
                // Streamer quit, but the clock stays where it is rather than
                // going back on stream, and goes back on loading in.
                Write::Unchanged => return self.freeze(now),
                Write::First => return self.stop(),
                Write::Profile if seconds > saved.seconds => {
                    let behind = shown.filter(|&shown| {
                        shown > seconds as f64
                            && shown - (seconds as f64) <= HOLD_AT_MOST.as_secs_f64()
                    });
                    (true, behind)
                }
                Write::Profile if seconds == saved.seconds => {
                    if now.duration_since(saved.read_at) < STILL_AFTER {
                        return;
                    }
                    // Loaded in, so whatever was counted on the title screen
                    // goes at once.
                    (true, None)
                }
                // Lower, as after restoring a backup.
                Write::Profile => (false, None),
            },
            // The first read, or another character. Any write to the save
            // means the Streamer is loaded in, but the first read can't tell.
            _ => (matches!(write, Write::Profile | Write::SlotOnly), None),
        };
        self.running = running;
        self.held = held;
        self.saved = Some(Saved {
            slot,
            seconds,
            read_at: now,
        });
    }

    fn freeze(&mut self, now: Instant) {
        self.held = self.shown(now).map(|time| time.seconds);
        self.running = false;
    }

    // The game closed. It saves as it quits, so the last save is exact.
    pub fn stop(&mut self) {
        self.running = false;
        self.held = None;
    }

    pub fn shown(&self, now: Instant) -> Option<PlayTime> {
        let saved = self.saved?;
        let mut seconds = saved.seconds as f64;
        if self.running {
            seconds += now.duration_since(saved.read_at).as_secs_f64();
        }
        // Held, it isn't counting yet, or the Overlay would count on past the
        // held time between reports and flick back to it on each one.
        match self.held {
            Some(held) if held > seconds => Some(PlayTime {
                seconds: held,
                running: false,
            }),
            _ => Some(PlayTime {
                seconds,
                running: self.running,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn secs(n: u64) -> Duration {
        Duration::from_secs(n)
    }

    fn at(clock: &PlayClock, now: Instant) -> (f64, bool) {
        let time = clock.shown(now).unwrap();
        (time.seconds, time.running)
    }

    fn read(seconds: u32, write: Write) -> PlayTimeRead {
        PlayTimeRead {
            slot: 3,
            seconds,
            write,
        }
    }

    // The App starts with the game on the title screen, and the Streamer loads
    // in 20s later.
    fn loaded_in(start: Instant) -> PlayClock {
        let mut clock = PlayClock::new();
        clock.saw(start, read(2576, Write::First));
        clock.saw(start + secs(20), read(2576, Write::Profile));
        clock
    }

    #[test]
    fn shows_nothing_until_a_save_is_read() {
        assert_eq!(PlayClock::new().shown(Instant::now()), None);
    }

    #[test]
    fn stands_still_on_the_title_screen() {
        let mut clock = PlayClock::new();
        let start = Instant::now();
        clock.saw(start, read(2576, Write::First));

        assert_eq!(at(&clock, start + secs(60)), (2576.0, false));
    }

    #[test]
    fn counts_from_loading_in() {
        let start = Instant::now();
        let clock = loaded_in(start);

        assert_eq!(at(&clock, start + secs(30)), (2586.0, true));
    }

    // Most saves only write the slot, and the profile summary still holds the
    // time from loading in.
    #[test]
    fn a_save_to_the_slot_alone_changes_nothing() {
        let start = Instant::now();
        let mut clock = loaded_in(start);
        clock.saw(start + secs(53), read(2576, Write::SlotOnly));

        assert_eq!(at(&clock, start + secs(60)), (2616.0, true));
    }

    #[test]
    fn keeps_counting_while_nothing_is_saved_as_when_afk() {
        let start = Instant::now();
        let clock = loaded_in(start);

        assert_eq!(at(&clock, start + secs(200)), (2756.0, true));
    }

    #[test]
    fn counts_on_from_each_save_of_the_play_time() {
        let start = Instant::now();
        let mut clock = loaded_in(start);
        clock.saw(start + secs(70), read(2630, Write::Profile));

        assert_eq!(at(&clock, start + secs(71)), (2631.0, true));
    }

    #[test]
    fn the_same_time_saved_within_seconds_keeps_counting() {
        let start = Instant::now();
        let mut clock = loaded_in(start);
        clock.saw(start + secs(70), read(2630, Write::Profile));
        clock.saw(start + secs(72), read(2630, Write::Profile));

        assert_eq!(at(&clock, start + secs(73)), (2633.0, true));
    }

    // The game didn't count the 6s of dying and respawning.
    #[test]
    fn a_save_a_little_behind_holds_the_clock_until_it_catches_up() {
        let start = Instant::now();
        let mut clock = loaded_in(start);
        clock.saw(start + secs(67), read(2617, Write::Profile));

        assert_eq!(at(&clock, start + secs(68)), (2623.0, false));
        assert_eq!(at(&clock, start + secs(77)), (2627.0, true));
    }

    #[test]
    fn stops_where_it_is_on_the_title_screen_and_goes_back_on_loading_in() {
        let start = Instant::now();
        let mut clock = loaded_in(start);
        // Quits, saving the time, then reaches the title screen 12s later.
        clock.saw(start + secs(300), read(2856, Write::Profile));
        clock.saw(start + secs(312), read(2856, Write::Unchanged));
        assert_eq!(at(&clock, start + secs(330)), (2868.0, false));

        clock.saw(start + secs(340), read(2856, Write::Profile));
        assert_eq!(at(&clock, start + secs(350)), (2866.0, true));
    }

    #[test]
    fn loading_in_drops_what_was_counted_on_the_title_screen() {
        let start = Instant::now();
        let mut clock = loaded_in(start);
        // Quits without the write that marks the title screen, and loads in
        // 40s later.
        clock.saw(start + secs(300), read(2856, Write::Profile));
        clock.saw(start + secs(340), read(2856, Write::Profile));

        assert_eq!(at(&clock, start + secs(341)), (2857.0, true));
    }

    // Opened with the game loaded in, it learns which character is being
    // played from the game's next write.
    #[test]
    fn counts_from_the_first_write_when_opened_mid_game() {
        let mut clock = PlayClock::new();
        let start = Instant::now();
        clock.saw(start, read(2576, Write::First));
        clock.saw(start + secs(10), read(2576, Write::SlotOnly));
        assert_eq!(at(&clock, start + secs(20)), (2586.0, true));

        // The save's time was older than it looked, so the next one jumps.
        clock.saw(start + secs(40), read(2700, Write::Profile));
        assert_eq!(at(&clock, start + secs(41)), (2701.0, true));

        let mut clock = PlayClock::new();
        clock.saw(
            start + secs(10),
            PlayTimeRead {
                slot: 3,
                seconds: 2576,
                write: Write::SlotOnly,
            },
        );
        assert_eq!(at(&clock, start + secs(20)), (2586.0, true));
    }

    #[test]
    fn another_character_counts_from_its_own_time() {
        let start = Instant::now();
        let mut clock = loaded_in(start);
        clock.saw(
            start + secs(30),
            PlayTimeRead {
                slot: 0,
                seconds: 3008,
                write: Write::Profile,
            },
        );

        assert_eq!(at(&clock, start + secs(40)), (3018.0, true));
    }

    #[test]
    fn an_earlier_save_is_shown_as_it_is() {
        let start = Instant::now();
        let mut clock = loaded_in(start);
        clock.saw(start + secs(30), read(100, Write::Profile));
        assert_eq!(at(&clock, start + secs(40)), (100.0, false));
    }

    #[test]
    fn stops_at_the_last_save_when_the_game_closes() {
        let start = Instant::now();
        let mut clock = loaded_in(start);
        clock.saw(start + secs(30), read(2586, Write::Profile));
        clock.stop();

        assert_eq!(at(&clock, start + secs(100)), (2586.0, false));
    }
}
