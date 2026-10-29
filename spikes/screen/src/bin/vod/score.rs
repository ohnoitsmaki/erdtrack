// Comparing the events with a video's labels, written by hand from watching
// it, one to a line:
//
//     fight 0:12:30 0:14:05 Margit, the Fell Omen
//     felled 0:14:03 LEGEND FELLED
//     skip 1:02:00 1:04:30
//
// A fight runs from its Name bar appearing to the boss dying or the bar going,
// and names the boss as the boss list or its Name bars do, several joined with
// " & ". A skipped stretch is left out, as when the stream's overlay covers the
// Name bars, which the Spotter, capturing the game itself, never sees.
// Anything after a # is a comment.

use std::fmt::Write;

use crate::events::{Event, Kind};
use crate::matching::{bar_names_of, normalize, BarNames};

// How far before a fight's start, or a FELLED message's time, an event still
// counts as seeing it, since labels are set by hand; and how far after a
// FELLED message.
const EARLY: f64 = 2.0;
const FELLED_LATE: f64 = 5.0;

#[derive(Debug, PartialEq)]
pub enum Label {
    Fight { start: f64, end: f64, boss: String },
    Felled { t: f64, message: String },
    Skip { start: f64, end: f64 },
}

// "1:02:03.5", "2:03" or "123" as seconds.
pub fn parse_time(text: &str) -> Option<f64> {
    text.split(':').try_fold(0.0, |total, part| {
        Some(total * 60.0 + part.parse::<f64>().ok()?)
    })
}

pub fn format_time(t: f64) -> String {
    let whole = t.max(0.0) as u64;
    format!("{}:{:02}:{:02}", whole / 3600, whole / 60 % 60, whole % 60)
}

pub fn parse_labels(text: &str) -> Result<Vec<Label>, String> {
    let mut labels = Vec::new();
    for (n, line) in text.lines().enumerate() {
        let line = line.split('#').next().unwrap().trim();
        if line.is_empty() {
            continue;
        }
        let bad = || format!("labels line {}: {line}", n + 1);
        let mut words = line.splitn(4, ' ');
        let kind = words.next().unwrap();
        let mut time = || words.next().and_then(parse_time).ok_or_else(bad);
        labels.push(match kind {
            "fight" => {
                let (start, end) = (time()?, time()?);
                let boss = words.next().ok_or_else(bad)?.trim().to_string();
                Label::Fight { start, end, boss }
            }
            "felled" => {
                let t = time()?;
                // The message is the rest of the line, split by splitn above.
                let rest: Vec<&str> = words.collect();
                Label::Felled {
                    t,
                    message: rest.join(" "),
                }
            }
            "skip" => Label::Skip {
                start: time()?,
                end: time()?,
            },
            _ => return Err(bad()),
        });
    }
    Ok(labels)
}

fn appeared(event: &Event) -> Option<&str> {
    match &event.kind {
        Kind::Appeared(name) => Some(name),
        _ => None,
    }
}

fn felled(event: &Event) -> Option<&str> {
    match &event.kind {
        Kind::Felled(message) => Some(message),
        _ => None,
    }
}

// The report, from the events of a video `length` seconds long.
pub fn score(events: &[Event], labels: &[Label], bars: &BarNames, length: f64) -> String {
    let mut out = String::new();
    let skips: Vec<(f64, f64)> = labels
        .iter()
        .filter_map(|l| match l {
            Label::Skip { start, end } => Some((*start, *end)),
            _ => None,
        })
        .collect();
    let skipped = |t: f64| skips.iter().any(|(s, e)| (*s..=*e).contains(&t));
    let counted = length - skips.iter().map(|(s, e)| e - s).sum::<f64>();

    let mut fights = 0;
    let mut found = 0;
    let mut delays = Vec::new();
    let mut wrong = 0;
    let mut explained = vec![false; events.len()];
    writeln!(out, "Fights").unwrap();
    for label in labels {
        let Label::Fight { start, end, boss } = label else {
            continue;
        };
        fights += 1;
        let expected = bar_names_of(boss);
        let mut seen: Vec<(f64, &str)> = Vec::new();
        for (i, event) in events.iter().enumerate() {
            let Some(name) = appeared(event) else {
                continue;
            };
            if (start - EARLY..=*end).contains(&event.t) {
                explained[i] = true;
                seen.push((event.t, name));
            }
        }
        let right: Vec<&(f64, &str)> = seen
            .iter()
            .filter(|(_, n)| expected.iter().any(|e| e == n))
            .collect();
        let mut others: Vec<&str> = Vec::new();
        for (_, name) in &seen {
            if !expected.iter().any(|e| e == name) && !others.contains(name) {
                others.push(name);
            }
        }
        let mut line = format!("  {}  {boss:<40} ", format_time(*start));
        match right.first() {
            Some((t, _)) => {
                found += 1;
                delays.push(t - start);
                write!(line, "found {:+.1} s", t - start).unwrap();
                if expected.len() > 1 {
                    write!(line, " ({} of {} bars)", right.len(), expected.len()).unwrap();
                }
                let shared = right
                    .iter()
                    .map(|(_, n)| bars.bosses.get(*n).map_or(0, Vec::len))
                    .max()
                    .unwrap_or(0);
                if shared > 1 {
                    write!(line, ", a name {shared} bosses share").unwrap();
                }
            }
            None => line.push_str("MISSED"),
        }
        if !others.is_empty() {
            wrong += 1;
            write!(line, ", also read WRONG: {}", others.join(", ")).unwrap();
        }
        writeln!(out, "{}", line.trim_end()).unwrap();
    }

    let mut false_bars = Vec::new();
    for (i, event) in events.iter().enumerate() {
        if let Some(name) = appeared(event) {
            if !explained[i] && !skipped(event.t) {
                false_bars.push(format!("  {}  {name}", format_time(event.t)));
            }
        }
    }

    let mut messages = 0;
    let mut messages_found = 0;
    let mut used = vec![false; events.len()];
    writeln!(out, "\nFELLED messages").unwrap();
    for label in labels {
        let Label::Felled { t, message } = label else {
            continue;
        };
        messages += 1;
        let hit = events.iter().enumerate().find(|(i, e)| {
            !used[*i] && felled(e).is_some() && (t - EARLY..=t + FELLED_LATE).contains(&e.t)
        });
        let mut line = format!("  {}  {message:<40} ", format_time(*t));
        match hit {
            Some((i, event)) => {
                used[i] = true;
                messages_found += 1;
                let read = felled(event).unwrap();
                write!(line, "found {:+.1} s", event.t - t).unwrap();
                if !message.is_empty() && normalize(read) != normalize(message) {
                    write!(line, ", read as {read}").unwrap();
                }
            }
            None => line.push_str("MISSED"),
        }
        writeln!(out, "{}", line.trim_end()).unwrap();
    }
    let false_felled: Vec<String> = events
        .iter()
        .enumerate()
        .filter(|(i, e)| !used[*i] && !skipped(e.t))
        .filter_map(|(_, e)| Some(format!("  {}  {}", format_time(e.t), felled(e)?)))
        .collect();

    let hours = counted / 3600.0;
    for (what, list) in [
        ("Name bars", &false_bars),
        ("FELLED messages", &false_felled),
    ] {
        writeln!(
            out,
            "\nFalse {what}, outside any fight or label: {}",
            list.len()
        )
        .unwrap();
        for line in list {
            writeln!(out, "{line}").unwrap();
        }
    }

    delays.sort_by(f64::total_cmp);
    let median = delays
        .get(delays.len() / 2)
        .map_or("-".into(), |d| format!("{d:+.1} s"));
    writeln!(out, "\nSummary over {:.2} hours counted", hours).unwrap();
    writeln!(
        out,
        "  fights found {found} of {fights}, median delay {median}, {wrong} with a wrong name read"
    )
    .unwrap();
    writeln!(out, "  FELLED found {messages_found} of {messages}").unwrap();
    if hours > 0.0 {
        writeln!(
            out,
            "  false Name bars {:.1} an hour, false FELLED {:.1} an hour",
            false_bars.len() as f64 / hours,
            false_felled.len() as f64 / hours
        )
        .unwrap();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn times_read_as_seconds_and_print_as_hours() {
        assert_eq!(parse_time("1:02:03.5"), Some(3723.5));
        assert_eq!(parse_time("2:03"), Some(123.0));
        assert_eq!(parse_time("x"), None);
        assert_eq!(format_time(3723.5), "1:02:03");
    }

    #[test]
    fn labels_parse_with_comments() {
        let labels = parse_labels(
            "# margit\nfight 12:30 14:05 Margit, the Fell Omen  # first try\nfelled 14:03 LEGEND FELLED\nskip 1:00:00 1:00:30\n",
        )
        .unwrap();

        assert_eq!(
            labels,
            [
                Label::Fight {
                    start: 750.0,
                    end: 845.0,
                    boss: "Margit, the Fell Omen".into()
                },
                Label::Felled {
                    t: 843.0,
                    message: "LEGEND FELLED".into()
                },
                Label::Skip {
                    start: 3600.0,
                    end: 3630.0
                },
            ]
        );
        assert!(parse_labels("fight 12:30 Margit").is_err());
    }

    fn event(t: f64, kind: Kind) -> Event {
        Event { t, kind }
    }

    #[test]
    fn a_report_counts_found_missed_wrong_and_false() {
        let bars = BarNames {
            bosses: [("tree sentinel".to_string(), vec![1, 2])].into(),
        };
        let labels = parse_labels(
            "fight 10 100 Tree Sentinel\nfight 200 300 Margit, the Fell Omen\nfelled 99 GREAT ENEMY FELLED\nskip 500 600",
        )
        .unwrap();
        let events = [
            event(11.5, Kind::Appeared("tree sentinel".into())),
            event(12.0, Kind::Appeared("godrick the grafted".into())),
            event(100.0, Kind::Felled("ENEMY FELLED".into())),
            event(400.0, Kind::Appeared("tree sentinel".into())),
            event(550.0, Kind::Appeared("tree sentinel".into())),
        ];

        let report = score(&events, &labels, &bars, 3600.0);

        assert!(report.contains(
            "Tree Sentinel                            found +1.5 s, a name 2 bosses share, also read WRONG: godrick the grafted"
        ), "{report}");
        assert!(report.contains("Margit, the Fell Omen                    MISSED"));
        assert!(report.contains(
            "GREAT ENEMY FELLED                       found +1.0 s, read as ENEMY FELLED"
        ));
        assert!(report
            .contains("False Name bars, outside any fight or label: 1\n  0:06:40  tree sentinel"));
        assert!(
            report.contains("fights found 1 of 2, median delay +1.5 s, 1 with a wrong name read")
        );
        assert!(report.contains("false Name bars 1.0 an hour"), "{report}");
    }
}
