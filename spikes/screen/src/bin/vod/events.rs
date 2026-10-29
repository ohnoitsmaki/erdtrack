// Turning what OCR read in each frame into the Spotter's events: a Name bar
// appearing or going, and a FELLED message. A single frame's read is noisy, so
// a name counts once it's read in a few frames in a row, and goes once it
// hasn't been read for a while.

use std::collections::{BTreeMap, BTreeSet};

use crate::matching::{closest, find, normalize, FELLED_MESSAGES};
use crate::readings::{Line, Reading};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Reads {
    // Only the raw read.
    Raw,
    // Only the cleaned-up read.
    Clean,
    // As ADR 0017 says: raw, and if any line doesn't match a bar name, the
    // cleaned-up read too.
    Both,
}

pub struct Settings {
    // The most wrong characters a match allows, fewer in short words.
    pub most_wrong: usize,
    // How many frames in a row a name or message must be read in to count.
    pub confirm: usize,
    // How many seconds a Name bar must go unread to count as gone.
    pub gone_after: f64,
    // How many seconds after a FELLED message another one is ignored.
    pub felled_cooldown: f64,
    pub reads: Reads,
    // Read names anywhere in the region, not only where Name bars start.
    pub anywhere: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            most_wrong: 3,
            confirm: 2,
            gone_after: 3.0,
            felled_cooldown: 10.0,
            reads: Reads::Both,
            anywhere: false,
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum Kind {
    Appeared(String),
    Gone(String),
    Felled(String),
}

#[derive(Debug, PartialEq)]
pub struct Event {
    pub t: f64,
    pub kind: Kind,
}

// Where a Name bar's name starts, as a fraction of the frame's width: it's
// left-aligned above its health bar, and further bars stack above it. The
// subtitles, messages like "Summoned Okina" and prompts like "E :Summon Lionel
// the Lionhearted" that share the region are centred.
pub const NAME_LEFT: f64 = 0.243;
const NAME_LEFT_WITHIN: f64 = 0.015;

// The text of each Name bar: each line that starts where a name does, joined
// with the lines beside it, since OCR can break one name into several, as
// "Cy-ucible Knigh", ":sb€g", "A4rrior".
pub fn name_rows(lines: &[Line]) -> Vec<String> {
    lines
        .iter()
        .filter(|start| (start.left - NAME_LEFT).abs() <= NAME_LEFT_WITHIN)
        .map(|start| {
            let mut row: Vec<&Line> = lines
                .iter()
                .filter(|l| (start.top..=start.bottom).contains(&((l.top + l.bottom) / 2.0)))
                .collect();
            row.sort_by(|a, b| a.left.total_cmp(&b.left));
            row.iter()
                .map(|l| l.text.as_str())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect()
}

// The bar names read in one frame.
pub fn bars_in<'a>(reading: &Reading, names: &[&'a str], settings: &Settings) -> BTreeSet<&'a str> {
    // Whether to clean up goes by whether each row matched.
    let read = |lines: &[Line]| -> (BTreeSet<&'a str>, bool) {
        let rows = if settings.anywhere {
            vec![lines
                .iter()
                .map(|l| l.text.as_str())
                .collect::<Vec<_>>()
                .join(" ")]
        } else {
            name_rows(lines)
        };
        let mut found = BTreeSet::new();
        let mut all_matched = true;
        for row in rows {
            let in_row = find(&row, names, settings.most_wrong);
            all_matched &= !in_row.is_empty();
            found.extend(in_row);
        }
        (found, all_matched)
    };
    match settings.reads {
        Reads::Raw => read(&reading.bars).0,
        Reads::Clean => read(&reading.bars_clean).0,
        Reads::Both => {
            let (mut found, all_matched) = read(&reading.bars);
            if !all_matched {
                found.extend(read(&reading.bars_clean).0);
            }
            found
        }
    }
}

// The FELLED message read in one frame, if any.
pub fn felled_in(reading: &Reading, settings: &Settings) -> Option<&'static str> {
    let messages = FELLED_MESSAGES.map(normalize);
    let messages: Vec<&str> = messages.iter().map(String::as_str).collect();
    let found = reading
        .felled
        .iter()
        .find_map(|line| closest(line, &messages, settings.most_wrong))?;
    FELLED_MESSAGES.into_iter().find(|m| normalize(m) == found)
}

#[derive(Default)]
struct Seen {
    streak: usize,
    shown: bool,
    last: f64,
}

pub fn events(readings: &[Reading], names: &[&str], settings: &Settings) -> Vec<Event> {
    let mut events = Vec::new();
    let mut bars: BTreeMap<&str, Seen> = BTreeMap::new();
    let mut felled: BTreeMap<&str, usize> = BTreeMap::new();
    let mut last_felled = f64::NEG_INFINITY;

    for reading in readings {
        let t = reading.t;
        let read = bars_in(reading, names, settings);
        for name in &read {
            bars.entry(name).or_default();
        }
        for (name, seen) in bars.iter_mut() {
            if read.contains(name) {
                seen.streak += 1;
                seen.last = t;
                if !seen.shown && seen.streak >= settings.confirm {
                    seen.shown = true;
                    events.push(Event {
                        t,
                        kind: Kind::Appeared(name.to_string()),
                    });
                }
            } else {
                seen.streak = 0;
                if seen.shown && t - seen.last >= settings.gone_after {
                    seen.shown = false;
                    events.push(Event {
                        t,
                        kind: Kind::Gone(name.to_string()),
                    });
                }
            }
        }

        let message = felled_in(reading, settings);
        felled.retain(|m, _| Some(*m) == message);
        if let Some(message) = message {
            let streak = felled.entry(message).or_default();
            *streak += 1;
            if *streak == settings.confirm && t - last_felled >= settings.felled_cooldown {
                last_felled = t;
                events.push(Event {
                    t,
                    kind: Kind::Felled(message.to_string()),
                });
            }
        }
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;

    // A line at `left`, in row `row` of the region.
    fn line(text: &str, left: f64, row: usize) -> Line {
        let top = 0.85 - row as f64 * 0.05;
        Line {
            text: text.into(),
            left,
            top,
            bottom: top + 0.02,
        }
    }

    // Each of `bars` is a Name bar, stacked from the bottom.
    fn reading(t: f64, bars: &[&str], clean: &[&str], felled: &[&str]) -> Reading {
        let names = |lines: &[&str]| {
            lines
                .iter()
                .enumerate()
                .map(|(row, l)| line(l, NAME_LEFT, row))
                .collect()
        };
        Reading {
            t,
            felled: felled.iter().map(|l| l.to_string()).collect(),
            bars: names(bars),
            bars_clean: names(clean),
        }
    }

    const NAMES: [&str; 2] = ["tree sentinel", "margit the fell omen"];

    #[test]
    fn the_cleaned_read_is_used_only_when_a_raw_line_misses() {
        let settings = Settings::default();
        let both = reading(0.0, &["Margit, the Fell Omen"], &["Tree Sentinel"], &[]);
        let missed = reading(0.0, &["T ece Seri tipel"], &["Tree Sentinel"], &[]);

        assert_eq!(
            bars_in(&both, &NAMES, &settings),
            BTreeSet::from(["margit the fell omen"])
        );
        assert_eq!(
            bars_in(&missed, &NAMES, &settings),
            BTreeSet::from(["tree sentinel"])
        );
    }

    #[test]
    fn a_name_broken_across_lines_is_found() {
        let settings = Settings {
            reads: Reads::Raw,
            ..Settings::default()
        };
        let mut broken = reading(0.0, &["Margit, the"], &[], &[]);
        broken.bars.push(line("Fell Omen", 0.33, 0));

        assert_eq!(
            bars_in(&broken, &NAMES, &settings),
            BTreeSet::from(["margit the fell omen"])
        );
    }

    #[test]
    fn centred_text_in_the_region_is_not_a_name_bar() {
        let settings = Settings::default();
        let mut prompts = reading(0.0, &["Tree Sentinel"], &[], &[]);
        prompts
            .bars
            .push(line("Summoned Margit, the Fell Omen", 0.455, 1));
        prompts
            .bars
            .push(line("E :Summon Margit, the Fell Omen", 0.41, 2));

        assert_eq!(name_rows(&prompts.bars), ["Tree Sentinel"],);
        assert_eq!(
            bars_in(&prompts, &NAMES, &settings),
            BTreeSet::from(["tree sentinel"])
        );
        let anywhere = Settings {
            anywhere: true,
            ..Settings::default()
        };
        assert_eq!(bars_in(&prompts, &NAMES, &anywhere).len(), 2);
    }

    #[test]
    fn a_name_appears_once_read_in_frames_in_a_row_and_goes_once_unread() {
        let settings = Settings::default();
        let tree = &["Tree Sentinel"][..];
        let readings = [
            reading(0.0, tree, &[], &[]),
            reading(0.2, &[], &[], &[]),
            reading(0.4, tree, &[], &[]),
            reading(0.6, tree, &[], &[]),
            reading(0.8, &[], &[], &[]),
            reading(2.0, tree, &[], &[]),
            reading(5.0, &[], &[], &[]),
        ];

        let events = events(&readings, &NAMES, &settings);

        assert_eq!(
            events,
            [
                Event {
                    t: 0.6,
                    kind: Kind::Appeared("tree sentinel".into())
                },
                Event {
                    t: 5.0,
                    kind: Kind::Gone("tree sentinel".into())
                },
            ]
        );
    }

    #[test]
    fn a_felled_message_counts_once_in_its_cooldown() {
        let settings = Settings::default();
        let great = &["GREAT ENEMY FELLED"][..];
        let readings = [
            reading(0.0, &[], &[], great),
            reading(0.2, &[], &[], great),
            reading(0.4, &[], &[], great),
            reading(0.6, &[], &[], &[]),
            reading(5.0, &[], &[], great),
            reading(5.2, &[], &[], great),
            reading(20.0, &[], &[], &["LEGEND FELLED"]),
            reading(20.2, &[], &[], &["LEGEND FELLED"]),
        ];

        let events = events(&readings, &NAMES, &settings);

        assert_eq!(
            events,
            [
                Event {
                    t: 0.2,
                    kind: Kind::Felled("GREAT ENEMY FELLED".into())
                },
                Event {
                    t: 20.2,
                    kind: Kind::Felled("LEGEND FELLED".into())
                },
            ]
        );
    }
}
