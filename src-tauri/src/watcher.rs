// The Watcher's decisions, kept apart from the file and the clock so tests
// can feed it a sequence of saves: which slot is being played, which Save
// Totals to believe, and what to report.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::play_time::{PlayClock, PlayTime, PlayTimeRead, Write};
use crate::save::{read_save, Save, Slot};

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub slot: u8,
    pub character_name: String,
    pub total: u32,
    // The bosses' Defeat Flags set in the slot. The backend works out which
    // are new.
    pub defeat_flags: Vec<u32>,
    // What the clock shows as the report is made. Always worked out, but the
    // App's window sends it only while the Streamer has Play Time turned on.
    pub play_time: PlayTime,
}

#[derive(Debug, PartialEq)]
pub enum Outcome {
    Report(Report),
    Unchanged,
    // Several characters, and the game hasn't written to any of them yet.
    Waiting,
    // Read the file again after this long, even if it hasn't changed.
    Retry { after: Duration },
    // The active slot isn't laid out as expected, as after a game patch. It's
    // retried like a torn read, but meanwhile nothing is sent, so the backend
    // sees the Watcher offline rather than a Save Total that has stopped rising.
    Unreadable { after: Duration },
}

// Retries start quickly, since a torn read means the game is mid-write, and
// back off so a save that stays unreadable isn't read in a tight loop.
const FIRST_RETRY: Duration = Duration::from_millis(100);
const LONGEST_RETRY: Duration = Duration::from_secs(5);

// A Save Total lower than the last one read, or more than this far above it, is
// doubted until it has held this long, across the game's later writes. More
// Deaths than this between two writes isn't believable.
const MAX_JUMP: u32 = 50;
const STABLE_FOR: Duration = Duration::from_secs(5);

// The backend counts the Watcher Offline after 90 seconds without a report.
const HEARTBEAT: Duration = Duration::from_secs(30);

// A Save Total that failed the plausibility check, and when it was first read.
#[derive(Clone, Copy)]
struct Doubt {
    slot: u8,
    total: u32,
    since: Instant,
}

pub struct Watcher {
    retries: u32,
    // Each slot's MD5 at the last whole read, None before the first one.
    digests: Option<HashMap<u8, [u8; 16]>>,
    active: Option<u8>,
    // Each slot's last accepted Save Total.
    last_totals: HashMap<u8, u32>,
    doubted: Option<Doubt>,
    // The last report, and when it was sent.
    last_sent: Option<(Report, Instant)>,
    unreadable: bool,
    // The profile summaries' MD5 at the last whole read.
    profile_digest: Option<[u8; 16]>,
    clock: PlayClock,
    // The last whole read is being retried, so reading it again changes
    // nothing because the game wrote nothing, not because it wrote the same.
    rereading: bool,
}

impl Watcher {
    pub fn new() -> Self {
        Watcher {
            retries: 0,
            digests: None,
            active: None,
            last_totals: HashMap::new(),
            doubted: None,
            last_sent: None,
            unreadable: false,
            profile_digest: None,
            clock: PlayClock::new(),
            rereading: false,
        }
    }

    pub fn observe(&mut self, now: Instant, save: &[u8]) -> Outcome {
        let outcome = self.read(now, save);
        if !matches!(outcome, Outcome::Retry { .. } | Outcome::Unreadable { .. }) {
            self.retries = 0;
        }
        outcome
    }

    // The last report again, once it's 30 seconds old, so the backend knows
    // the Watcher is still running, with the Play Time as the clock now shows
    // it. Sooner if the clock changed between reads, as when it catches up
    // with a save it was holding for.
    pub fn heartbeat(&mut self, now: Instant) -> Option<Report> {
        let (_, sent) = self.last_sent.as_ref()?;
        let due = now.duration_since(*sent) >= HEARTBEAT;
        self.report_again(now, due)
    }

    // The game closed. It saved as it quit, so the clock stops at that save,
    // and the report saying so goes out once, so the Watcher still goes
    // Offline while the game is closed.
    pub fn game_closed(&mut self, now: Instant) -> Option<Report> {
        self.clock.stop();
        self.report_again(now, false)
    }

    // The last report with the Play Time as the clock now shows it, if it's
    // due or the clock has changed.
    fn report_again(&mut self, now: Instant, due: bool) -> Option<Report> {
        if self.unreadable {
            return None;
        }
        let report = Report {
            play_time: self.play_time(now),
            ..self.last_sent.as_ref()?.0.clone()
        };
        if !due && self.sent_already(now, &report) {
            return None;
        }
        self.last_sent = Some((report.clone(), now));
        Some(report)
    }

    fn read(&mut self, now: Instant, save: &[u8]) -> Outcome {
        let Ok(save) = read_save(save) else {
            return self.retry();
        };
        let slots = &save.slots;
        let write = self.write(&save);
        self.profile_digest = Some(save.profile_digest);
        self.follow_active_slot(slots);
        let Some(slot) = slots.iter().find(|slot| Some(slot.index) == self.active) else {
            return Outcome::Waiting;
        };
        // The profile summary holds it, so it's there even if the slot
        // itself can't be parsed.
        if !(self.rereading && write == Write::Unchanged) {
            self.clock.saw(
                now,
                PlayTimeRead {
                    slot: slot.index,
                    seconds: slot.seconds_played,
                    write,
                },
            );
        }
        self.rereading = false;
        let Ok(read) = &slot.read else {
            self.unreadable = true;
            self.rereading = true;
            return Outcome::Unreadable {
                after: self.backoff(),
            };
        };
        self.unreadable = false;
        if !self.plausible(now, slot.index, read.total) {
            self.rereading = true;
            return self.retry();
        }
        self.last_totals.insert(slot.index, read.total);
        let report = Report {
            slot: slot.index,
            character_name: slot.character_name.clone(),
            total: read.total,
            defeat_flags: read.defeat_flags.clone(),
            play_time: self.play_time(now),
        };
        if self.sent_already(now, &report) {
            return Outcome::Unchanged;
        }
        self.last_sent = Some((report.clone(), now));
        Outcome::Report(report)
    }

    // Before any save is read, there's no Play Time to show, but nor is
    // there a report to carry it.
    fn play_time(&self, now: Instant) -> PlayTime {
        self.clock.shown(now).unwrap_or(PlayTime {
            seconds: 0.0,
            running: false,
        })
    }

    // Whether the last report said this already. Its Play Time did if the
    // clock is where that one, counting on as the Overlay does, says it is
    // now, to within a second, which the Overlay wouldn't show.
    fn sent_already(&self, now: Instant, report: &Report) -> bool {
        let Some((sent, at)) = &self.last_sent else {
            return false;
        };
        let (was, is) = (sent.play_time, report.play_time);
        let mut expected = was.seconds;
        if was.running {
            expected += now.duration_since(*at).as_secs_f64();
        }
        Report {
            play_time: is,
            ..sent.clone()
        } == *report
            && was.running == is.running
            && (is.seconds - expected).abs() < 1.0
    }

    // What the game rewrote since the last whole read. The first read can't
    // tell.
    fn write(&self, save: &Save) -> Write {
        let Some(previous) = &self.digests else {
            return Write::First;
        };
        let profile = self.profile_digest != Some(save.profile_digest);
        let slots = previous.len() != save.slots.len()
            || save
                .slots
                .iter()
                .any(|slot| previous.get(&slot.index) != Some(&slot.digest));
        match (profile, slots) {
            (true, _) => Write::Profile,
            (false, true) => Write::SlotOnly,
            (false, false) => Write::Unchanged,
        }
    }

    // The active slot is whichever one the game wrote to since the last read.
    // Until it writes, a single character is taken to be the active one.
    fn follow_active_slot(&mut self, slots: &[Slot]) {
        let digests: HashMap<_, _> = slots.iter().map(|slot| (slot.index, slot.digest)).collect();
        if let Some(previous) = &self.digests {
            let changed: Vec<_> = slots
                .iter()
                .filter(|slot| previous.get(&slot.index) != Some(&slot.digest))
                .collect();
            if let [slot] = changed.as_slice() {
                self.active = Some(slot.index);
            }
        }
        if self
            .active
            .is_some_and(|active| !digests.contains_key(&active))
        {
            self.active = None;
        }
        if let [slot] = slots {
            self.active.get_or_insert(slot.index);
        }
        self.digests = Some(digests);
    }

    // A real drop, as when the Streamer restores a backup, is still accepted
    // once it holds, so the backend sees it.
    fn plausible(&mut self, now: Instant, slot: u8, total: u32) -> bool {
        let Some(&last) = self.last_totals.get(&slot) else {
            return true;
        };
        if total >= last && total - last <= MAX_JUMP {
            self.doubted = None;
            return true;
        }
        let doubt = match self.doubted {
            Some(doubt) if (doubt.slot, doubt.total) == (slot, total) => doubt,
            _ => Doubt {
                slot,
                total,
                since: now,
            },
        };
        if now.duration_since(doubt.since) < STABLE_FOR {
            self.doubted = Some(doubt);
            return false;
        }
        self.doubted = None;
        true
    }

    fn retry(&mut self) -> Outcome {
        Outcome::Retry {
            after: self.backoff(),
        }
    }

    fn backoff(&mut self) -> Duration {
        let after = FIRST_RETRY.saturating_mul(1 << self.retries.min(16));
        self.retries += 1;
        after.min(LONGEST_RETRY)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defeat_flags;
    use crate::synthetic_save::{build_save, tear, SlotSpec};

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

    fn yawn(total: u32) -> Vec<u8> {
        build_save(&[Some(SlotSpec::new("Yawn", total))])
    }

    #[test]
    fn a_drop_or_a_big_jump_is_retried_and_reported_once_it_holds() {
        let mut watcher = Watcher::new();
        let start = Instant::now();
        let at = |n| start + ms(n);

        watcher.observe(at(0), &yawn(100));
        let jump = watcher.observe(at(1000), &yawn(151));
        let rise = watcher.observe(at(1100), &yawn(101));
        let largest_rise = watcher.observe(at(1200), &yawn(151));
        let drop = [1300, 1400, 6299, 6300].map(|n| watcher.observe(at(n), &yawn(7)));

        assert_eq!(jump, Outcome::Retry { after: ms(100) });
        assert_eq!(without_play_time(rise), report(0, "Yawn", 101));
        assert_eq!(without_play_time(largest_rise), report(0, "Yawn", 151));
        assert_eq!(
            drop.map(without_play_time),
            [
                Outcome::Retry { after: ms(100) },
                Outcome::Retry { after: ms(200) },
                Outcome::Retry { after: ms(400) },
                report(0, "Yawn", 7),
            ]
        );
    }

    // For what else a report holds, which the clock doesn't change.
    fn without_play_time(outcome: Outcome) -> Outcome {
        match outcome {
            Outcome::Report(report) => Outcome::Report(Report {
                play_time: play_time(0.0, false),
                ..report
            }),
            other => other,
        }
    }

    fn as_report(outcome: Outcome) -> Report {
        match outcome {
            Outcome::Report(report) => report,
            other => panic!("expected a report, got {other:?}"),
        }
    }

    #[test]
    fn the_last_report_is_repeated_every_30s() {
        let mut watcher = Watcher::new();
        let start = Instant::now();
        let at = |n| start + ms(n);

        let before_any = watcher.heartbeat(at(0));
        watcher.observe(at(0), &yawn(10));
        let too_soon = watcher.heartbeat(at(29_999));
        let first = watcher.heartbeat(at(30_000));
        watcher.observe(at(40_000), &yawn(11));
        let after_death = [69_999, 70_000].map(|n| watcher.heartbeat(at(n)));

        assert_eq!(before_any, None);
        assert_eq!(too_soon, None);
        assert_eq!(first.map(Outcome::Report), Some(report(0, "Yawn", 10)));
        assert_eq!(
            after_death.map(|beat| beat.map(Outcome::Report).map(without_play_time)),
            [None, Some(report(0, "Yawn", 11))]
        );
    }

    // The run loop stops calling the Watcher while the game is closed, and
    // resumes with what it knew.
    #[test]
    fn after_a_pause_the_last_report_goes_out_at_once_then_every_30s() {
        let mut watcher = Watcher::new();
        let start = Instant::now();
        let at = |n| start + ms(n);

        watcher.observe(at(0), &yawn(10));
        let resumed = watcher.heartbeat(at(3_600_000));
        let next = [3_629_999, 3_630_000].map(|n| watcher.heartbeat(at(n)));

        assert_eq!(resumed.map(Outcome::Report), Some(report(0, "Yawn", 10)));
        assert_eq!(
            next.map(|beat| beat.map(Outcome::Report)),
            [None, Some(report(0, "Yawn", 10))]
        );
    }

    #[test]
    fn a_slot_it_cant_parse_stops_the_heartbeat_until_it_can() {
        let mut watcher = Watcher::new();
        let start = Instant::now();
        let at = |n| start + ms(n);
        let mut patched = SlotSpec::new("Yawn", 10);
        patched.gaitem_handles = vec![0x10800001];

        watcher.observe(at(0), &yawn(10));
        let unreadable = watcher.observe(at(1000), &build_save(&[Some(patched)]));
        let quiet = watcher.heartbeat(at(30_000));
        let read = watcher.observe(at(31_000), &yawn(10));
        let back = watcher.heartbeat(at(61_000));

        assert_eq!(unreadable, Outcome::Unreadable { after: ms(100) });
        assert_eq!(quiet, None);
        assert_eq!(without_play_time(read), report(0, "Yawn", 10));
        assert_eq!(
            back.map(Outcome::Report).map(without_play_time),
            Some(report(0, "Yawn", 10))
        );
    }

    #[test]
    fn a_report_holds_only_the_slot_name_total_defeat_flags_and_play_time() {
        let mut watcher = Watcher::new();
        let start = Instant::now();
        let mut died = SlotSpec::new("Yawn", 11);
        died.event_flags = with_flags(&[10000800]);

        let resting = as_report(watcher.observe(start, &yawn(10)));
        let died = as_report(watcher.observe(start + ms(9250), &build_save(&[Some(died)])));

        assert_eq!(
            serde_json::to_string(&resting).unwrap(),
            r#"{"slot":0,"characterName":"Yawn","total":10,"defeatFlags":[],"playTime":{"seconds":0.0,"running":false}}"#
        );
        assert_eq!(
            serde_json::to_string(&died).unwrap(),
            r#"{"slot":0,"characterName":"Yawn","total":11,"defeatFlags":[10000800],"playTime":{"seconds":0.0,"running":true}}"#
        );
    }

    fn report(slot: u8, name: &str, total: u32) -> Outcome {
        Outcome::Report(Report {
            slot,
            character_name: name.to_string(),
            total,
            defeat_flags: Vec::new(),
            play_time: play_time(0.0, false),
        })
    }

    #[test]
    fn a_report_carries_the_play_time_from_the_profile_summary() {
        let mut yawn = SlotSpec::new("Yawn", 10);
        yawn.seconds_played = 187_651; // 52:07:31

        let outcome = as_report(Watcher::new().observe(Instant::now(), &build_save(&[Some(yawn)])));

        assert_eq!(outcome.play_time, play_time(187_651.0, false));
    }

    fn played(seconds_played: u32, level: u32) -> SlotSpec {
        SlotSpec {
            seconds_played,
            level,
            ..SlotSpec::new("Yawn", 10)
        }
    }

    fn save_of(slot: SlotSpec) -> Vec<u8> {
        build_save(&[Some(slot)])
    }

    fn play_time(seconds: f64, running: bool) -> PlayTime {
        PlayTime { seconds, running }
    }

    // The App opens with the game on the title screen. Loading in rewrites
    // the profile summary with the Play Time it had.
    #[test]
    fn the_play_time_counts_on_from_loading_in() {
        let mut watcher = Watcher::new();
        let start = Instant::now();
        let at = |n| start + ms(n);

        let title = as_report(watcher.observe(at(0), &save_of(played(2576, 1))));
        let loaded = as_report(watcher.observe(at(20_000), &save_of(played(2576, 2))));
        let beat = watcher.heartbeat(at(50_000)).unwrap();

        assert_eq!(title.play_time, play_time(2576.0, false));
        assert_eq!(loaded.play_time, play_time(2576.0, true));
        assert_eq!(beat.play_time, play_time(2606.0, true));
    }

    // Loaded in 20s after the App opened, at 2576s played.
    fn loaded_in(watcher: &mut Watcher, start: Instant) {
        watcher.observe(start, &save_of(played(2576, 1)));
        watcher.observe(start + ms(20_000), &save_of(played(2576, 2)));
    }

    // Most saves only write the slot, and the profile summary still holds the
    // Play Time from loading in.
    #[test]
    fn a_save_to_the_slot_alone_keeps_the_play_time_counting() {
        let mut watcher = Watcher::new();
        let start = Instant::now();
        let at = |n| start + ms(n);
        loaded_in(&mut watcher, start);
        let resting = SlotSpec {
            regions: 1,
            ..played(2576, 2)
        };
        let died = SlotSpec {
            total: 11,
            ..played(2576, 2)
        };

        let rested = watcher.observe(at(40_000), &save_of(resting));
        let death = as_report(watcher.observe(at(53_000), &save_of(died)));

        assert_eq!(rested, Outcome::Unchanged);
        assert_eq!(death.play_time, play_time(2609.0, true));
    }

    // As on reaching the title screen. It goes out at once, not with the
    // next heartbeat.
    #[test]
    fn a_write_that_changes_nothing_stops_the_play_time() {
        let mut watcher = Watcher::new();
        let start = Instant::now();
        let at = |n| start + ms(n);
        loaded_in(&mut watcher, start);

        let title = as_report(watcher.observe(at(60_000), &save_of(played(2576, 2))));
        let beat = watcher.heartbeat(at(90_000)).unwrap();

        assert_eq!(title.play_time, play_time(2616.0, false));
        assert_eq!(beat.play_time, play_time(2616.0, false));
    }

    #[test]
    fn a_save_of_the_play_time_ahead_of_the_clock_goes_out_at_once() {
        let mut watcher = Watcher::new();
        let start = Instant::now();
        let at = |n| start + ms(n);
        loaded_in(&mut watcher, start);

        let saved = as_report(watcher.observe(at(40_000), &save_of(played(2700, 2))));

        assert_eq!(saved.play_time, play_time(2700.0, true));
    }

    // The game didn't count the 6s of dying and respawning, so the clock
    // holds until it catches up, and says so as it does.
    #[test]
    fn a_play_time_held_for_a_save_counts_on_again_at_once() {
        let mut watcher = Watcher::new();
        let start = Instant::now();
        let at = |n| start + ms(n);
        loaded_in(&mut watcher, start);

        let held = as_report(watcher.observe(at(67_000), &save_of(played(2617, 2))));
        let still = watcher.heartbeat(at(72_999));
        let again = watcher.heartbeat(at(73_100)).unwrap();

        assert_eq!(held.play_time, play_time(2623.0, false));
        assert_eq!(still, None);
        assert!(again.play_time.running);
    }

    // The game saved as it quit, so the clock stops at that save. That goes
    // out once, and no heartbeat follows until the game is launched again.
    #[test]
    fn the_play_time_stops_at_the_last_save_when_the_game_closes() {
        let mut watcher = Watcher::new();
        let start = Instant::now();
        let at = |n| start + ms(n);
        loaded_in(&mut watcher, start);
        watcher.observe(at(300_000), &save_of(played(2856, 3)));

        let closed = watcher.game_closed(at(303_000)).unwrap();
        let still_closed = watcher.game_closed(at(340_000));
        let relaunched = watcher.heartbeat(at(3_600_000)).unwrap();

        assert_eq!(closed.play_time, play_time(2856.0, false));
        assert_eq!(still_closed, None);
        assert_eq!(relaunched.play_time, play_time(2856.0, false));
    }

    // Reading a doubted Save Total again isn't the game writing the same
    // save, as on the title screen.
    #[test]
    fn retrying_a_doubted_save_total_keeps_the_play_time_counting() {
        let mut watcher = Watcher::new();
        let start = Instant::now();
        let at = |n| start + ms(n);
        loaded_in(&mut watcher, start);
        let jumped = || {
            save_of(SlotSpec {
                total: 70,
                ..played(2576, 2)
            })
        };

        watcher.observe(at(40_000), &jumped());
        let again = watcher.observe(at(40_100), &jumped());
        let beat = watcher.heartbeat(at(50_000)).unwrap();

        assert_eq!(again, Outcome::Retry { after: ms(200) });
        assert_eq!(beat.play_time, play_time(2606.0, true));
    }

    #[test]
    fn reports_the_total_of_the_only_character() {
        let mut watcher = Watcher::new();
        let mut yawn = SlotSpec::new("Yawn", 4321);
        // weapon (21 bytes), armour (16), item (8)
        yawn.gaitem_handles = vec![0x80800001, 0x90800002, 0xc0800003, 0x80800004];
        yawn.projectiles = 3;
        yawn.regions = 57;
        yawn.menu_size = 0x1234;
        yawn.tutorial_size = 0x80;

        let outcome = watcher.observe(Instant::now(), &build_save(&[None, Some(yawn)]));

        assert_eq!(outcome, report(1, "Yawn", 4321));
    }

    #[test]
    fn the_active_slot_is_the_one_the_game_wrote_to() {
        let mut watcher = Watcher::new();
        let start = Instant::now();
        let save = |a: SlotSpec, b: SlotSpec| build_save(&[Some(a), None, Some(b)]);
        // Writes that leave the Save Total as it was.
        let mut resting = SlotSpec::new("Yawn", 10);
        resting.regions = 1;
        let b_resting = || SlotSpec {
            regions: 1,
            ..SlotSpec::new("Nap", 21)
        };

        let before = watcher.observe(
            start,
            &save(SlotSpec::new("Yawn", 10), SlotSpec::new("Nap", 20)),
        );
        let b_played = watcher.observe(
            start + ms(1000),
            &save(SlotSpec::new("Yawn", 10), SlotSpec::new("Nap", 21)),
        );
        let b_again = watcher.observe(
            start + ms(2000),
            &save(SlotSpec::new("Yawn", 10), b_resting()),
        );
        let a_played = watcher.observe(start + ms(3000), &save(resting, b_resting()));

        assert_eq!(before, Outcome::Waiting);
        assert_eq!(without_play_time(b_played), report(2, "Nap", 21));
        assert_eq!(b_again, Outcome::Unchanged);
        assert_eq!(without_play_time(a_played), report(0, "Yawn", 10));
    }

    // The fields after the Save Total change in multiplayer, so they
    // must not be what finds it.
    #[test]
    fn reports_the_total_with_a_guest_in_the_world_or_as_a_phantom() {
        let mut host = SlotSpec::new("Yawn", 77);
        host.in_online_session = 1;
        host.not_alone = 1;
        let mut phantom = SlotSpec::new("Yawn", 78);
        phantom.character_type = 1;
        phantom.in_online_session = 1;
        phantom.character_type_online = 0;

        let as_host = Watcher::new().observe(Instant::now(), &build_save(&[Some(host)]));
        let as_phantom = Watcher::new().observe(Instant::now(), &build_save(&[Some(phantom)]));

        assert_eq!(as_host, report(0, "Yawn", 77));
        assert_eq!(as_phantom, report(0, "Yawn", 78));
    }

    #[test]
    fn the_character_name_is_read_whole_in_any_script() {
        let mut watcher = Watcher::new();
        let name = "Ranni的魔女ÉtoileWi"; // 16 UTF-16 units, the game's limit

        let outcome = watcher.observe(Instant::now(), &build_save(&[Some(SlotSpec::new(name, 3))]));

        assert_eq!(outcome, report(0, name, 3));
    }

    fn with_flags(flags: &[u32]) -> Vec<(usize, u8)> {
        flags
            .iter()
            .map(|&flag| defeat_flags::bit(flag).unwrap())
            .collect()
    }

    #[test]
    fn a_report_carries_the_boss_defeat_flags_set_in_the_slot() {
        let mut yawn = SlotSpec::new("Yawn", 10);
        // Godrick, the flag Radagon and Elden Beast share, and one from
        // Shadow of the Erdtree.
        yawn.event_flags = with_flags(&[10000800, 19000800, 2052430800]);
        // Not a boss's flag, though it's in Godrick's block.
        yawn.event_flags.extend(with_flags(&[10000801]));
        // In no boss's block: they start at byte 434 * 125.
        yawn.event_flags.push((0, 0xff));

        let outcome = as_report(Watcher::new().observe(Instant::now(), &build_save(&[Some(yawn)])));

        assert_eq!(outcome.defeat_flags, vec![10000800, 19000800, 2052430800]);
    }

    #[test]
    fn a_newly_set_defeat_flag_is_reported_though_the_total_held() {
        let mut watcher = Watcher::new();
        let start = Instant::now();
        let mut killed = SlotSpec::new("Yawn", 10);
        killed.event_flags = with_flags(&[10000800]);

        watcher.observe(start, &yawn(10));
        let kill = as_report(watcher.observe(start + ms(1000), &build_save(&[Some(killed)])));

        assert_eq!(kill.defeat_flags, vec![10000800]);
    }

    #[test]
    fn a_torn_read_is_retried_with_backoff_until_it_reads_whole() {
        let mut watcher = Watcher::new();
        let start = Instant::now();
        let whole = build_save(&[Some(SlotSpec::new("Yawn", 12))]);
        let mut torn = whole.clone();
        tear(&mut torn, 0);

        let first = watcher.observe(start, &torn);
        let second = watcher.observe(start + ms(100), &torn);
        let third = watcher.observe(start + ms(300), &whole);

        assert_eq!(first, Outcome::Retry { after: ms(100) });
        assert_eq!(second, Outcome::Retry { after: ms(200) });
        assert_eq!(third, report(0, "Yawn", 12));
    }
}
