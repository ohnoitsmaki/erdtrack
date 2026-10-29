// Matching the lines OCR reads to the words they should be: each boss's bar
// names, and the FELLED messages (ADR 0017). OCR misreads some characters even
// from a cleaned crop, so a match allows a few wrong ones, and finds the words
// anywhere in a line, since OCR often joins them with whatever is beside them.

use std::collections::BTreeMap;

use serde::Deserialize;

pub const FELLED_MESSAGES: [&str; 5] = [
    "ENEMY FELLED",
    "GREAT ENEMY FELLED",
    "DEMIGOD FELLED",
    "LEGEND FELLED",
    "GOD SLAIN",
];

// Lowercase letters and digits, with every run of anything else as one space,
// so "Margit, the Fell Omen" and "Margit the Fell 0men" compare letter by
// letter.
pub fn normalize(text: &str) -> String {
    let mut out = String::new();
    for c in text.chars() {
        if c.is_alphanumeric() {
            out.extend(c.to_lowercase());
        } else if !out.is_empty() && !out.ends_with(' ') {
            out.push(' ');
        }
    }
    out.trim_end().to_string()
}

// The fewest characters to change, add or remove so that `words` appear
// somewhere in `line`, as edit distance with the rest of the line free.
pub fn distance_within(words: &str, line: &str) -> usize {
    place_within(words, line).0
}

// That distance, with where in `line` the words were found, as the range of
// its characters.
fn place_within(words: &str, line: &str) -> (usize, std::ops::Range<usize>) {
    let line: Vec<char> = line.chars().collect();
    // One row per character of `words`; a column per position in the line,
    // each cell with its distance and where in the line its match starts.
    let mut row: Vec<(usize, usize)> = (0..=line.len()).map(|j| (0, j)).collect();
    for (i, w) in words.chars().enumerate() {
        let mut next = vec![(i + 1, 0); line.len() + 1];
        for (j, &l) in line.iter().enumerate() {
            let changed = (row[j].0 + usize::from(w != l), row[j].1);
            let added = (row[j + 1].0 + 1, row[j + 1].1);
            let removed = (next[j].0 + 1, next[j].1);
            next[j + 1] = changed.min(added).min(removed);
        }
        row = next;
    }
    let (end, (distance, start)) = row
        .into_iter()
        .enumerate()
        .min_by_key(|(_, (d, _))| *d)
        .unwrap_or((0, (0, 0)));
    (distance, start..end)
}

// How many wrong characters a match allows: `most`, but fewer for short
// words, so a short name doesn't turn up in any long line.
pub fn allowed(words: &str, most: usize) -> usize {
    most.min(words.chars().count() / 4)
}

// Which of `candidates` appear in `line`. When two are found in the same part
// of it, only the one with more characters right counts, so "crucible knight
// ordovis" beats "crucible knight", and "morgott the omen king" beats "mohg
// the omen" found 3 characters off in "gott the omen".
pub fn find<'a>(line: &str, candidates: &[&'a str], most: usize) -> Vec<&'a str> {
    let line = normalize(line);
    let found: Vec<(&str, usize, std::ops::Range<usize>)> = candidates
        .iter()
        .map(|c| (*c, place_within(c, &line)))
        .filter(|(c, (distance, _))| *distance <= allowed(c, most))
        .map(|(c, (distance, at))| (c, c.chars().count().saturating_sub(distance), at))
        .collect();
    found
        .iter()
        .filter(|(c, right, at)| {
            !found.iter().any(|(other, other_right, other_at)| {
                other != c
                    && other_at.start < at.end
                    && at.start < other_at.end
                    && (other_right, other.len()) > (right, c.len())
            })
        })
        .map(|(c, _, _)| *c)
        .collect()
}

// The one of `candidates` closest to appearing in `line`, the longer on a
// tie, for a region that shows one thing at a time.
pub fn closest<'a>(line: &str, candidates: &[&'a str], most: usize) -> Option<&'a str> {
    let line = normalize(line);
    candidates
        .iter()
        .copied()
        .map(|c| (distance_within(c, &line), c))
        .filter(|(d, c)| *d <= allowed(c, most))
        .min_by_key(|(d, c)| (*d, std::cmp::Reverse(c.len())))
        .map(|(_, c)| c)
}

#[derive(Deserialize)]
struct Region {
    bosses: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    boss: String,
    flag_id: u32,
}

// The names a boss's Name bars can show, worked out from its name in the boss
// list: "Crucible Knight & Misbegotten Warrior" is two bars, and
// "Night's Cavalry (Glaive)" or "Fell Twin(x2)" show without the brackets.
pub fn bar_names_of(list_name: &str) -> Vec<String> {
    list_name
        .split(" & ")
        .map(|part| match part.find('(') {
            Some(at) => &part[..at],
            None => part,
        })
        .map(normalize)
        .filter(|name| !name.is_empty())
        .collect()
}

// Every bar name, with the Defeat Flag of each boss that shows it: from the
// boss list's names and the hand-kept aliases the backend searches by.
pub struct BarNames {
    pub bosses: BTreeMap<String, Vec<u32>>,
}

impl BarNames {
    pub fn load() -> Self {
        Self::parse(
            include_str!("../../../../../convex/eroverlayBosses.json"),
            include_str!("../../../../../convex/bossAliases.ts"),
        )
    }

    // The aliases are read from their TypeScript, one boss a line, as
    // `11050800: ["Hoarah Loux, Warrior"],`.
    fn parse(list: &str, aliases: &str) -> Self {
        let regions: Vec<Region> = serde_json::from_str(list).expect("the boss list");
        let mut bosses: BTreeMap<String, Vec<u32>> = BTreeMap::new();
        let mut add = |name: String, flag: u32| {
            let flags = bosses.entry(name).or_default();
            if !flags.contains(&flag) {
                flags.push(flag);
            }
        };
        for entry in regions.iter().flat_map(|r| &r.bosses) {
            for name in bar_names_of(&entry.boss) {
                add(name, entry.flag_id);
            }
        }
        for line in aliases.lines() {
            let Some((flag, rest)) = line.trim().split_once(": [") else {
                continue;
            };
            let Ok(flag) = flag.parse() else { continue };
            for name in rest.split('"').skip(1).step_by(2) {
                add(normalize(name), flag);
            }
        }
        BarNames { bosses }
    }

    pub fn names(&self) -> Vec<&str> {
        self.bosses.keys().map(String::as_str).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizing_keeps_letters_and_digits_and_single_spaces() {
        assert_eq!(
            normalize("  Margit, the Fell Omen "),
            "margit the fell omen"
        );
        assert_eq!(normalize("Night's Cavalry"), "night s cavalry");
        assert_eq!(normalize(":sb?g A4rrior"), "sb g a4rrior");
    }

    #[test]
    fn words_are_found_inside_a_longer_line() {
        assert_eq!(
            distance_within("tree sentinel", "x tree sentinel acquire"),
            0
        );
        assert_eq!(distance_within("tree sentinel", "t ece seri tipel"), 6);
        assert_eq!(distance_within("abc", ""), 3);
    }

    #[test]
    fn the_spikes_cleaned_reads_match_their_names() {
        // ADR 0017: Name bars cleaned up read with 3 wrong characters each.
        let names = ["tree sentinel", "crucible knight", "misbegotten warrior"];
        assert_eq!(find("Tree Sentinel", &names, 3), ["tree sentinel"]);
        assert_eq!(
            find("(.:rucible Knight \\fisbeqotten Warrior", &names, 3),
            ["crucible knight", "misbegotten warrior"]
        );
    }

    #[test]
    fn short_names_allow_fewer_wrong_characters() {
        assert_eq!(allowed("omenkiller", 3), 2);
        assert_eq!(allowed("god slain", 3), 2);
        assert_eq!(allowed("dragonkin soldier of nokstella", 3), 3);
        assert!(find("Omen killer", &["omenkiller"], 3).len() == 1);
        assert!(find("Oxenkitted", &["omenkiller"], 3).is_empty());
    }

    #[test]
    fn a_name_inside_a_longer_one_found_counts_only_as_the_longer() {
        let names = ["crucible knight", "crucible knight ordovis"];
        assert_eq!(
            find("Crucible Knight Ordovis", &names, 3),
            ["crucible knight ordovis"]
        );
    }

    #[test]
    fn of_two_names_found_in_the_same_place_the_one_more_right_counts() {
        let names = [
            "mohg the omen",
            "morgott the omen king",
            "dragonkin soldier",
            "dragonkin soldier of nokstella",
        ];
        assert_eq!(
            find("Morgott, the Omen King", &names, 3),
            ["morgott the omen king"]
        );
        assert_eq!(
            find("Dragonkin Soldier of Nokstclla", &names, 3),
            ["dragonkin soldier of nokstella"]
        );
        assert_eq!(find("Dragonkin Soldier", &names, 3), ["dragonkin soldier"]);
        // Two names side by side both count.
        assert_eq!(
            find(
                "Crucible Knight Misbegotten Warrior",
                &["crucible knight", "misbegotten warrior"],
                3
            ),
            ["crucible knight", "misbegotten warrior"]
        );
    }

    #[test]
    fn the_closest_felled_message_is_the_one_read() {
        let felled = FELLED_MESSAGES.map(normalize);
        let felled: Vec<&str> = felled.iter().map(String::as_str).collect();
        assert_eq!(
            closest("GREAT ENEMY FELLED", &felled, 3),
            Some("great enemy felled")
        );
        assert_eq!(closest("ENEMY FELLED", &felled, 3), Some("enemy felled"));
        // "-end felled" is 2 from "enemy felled".
        assert_eq!(closest("LEGEND FELLED", &felled, 3), Some("legend felled"));
        assert_eq!(closest("Acquire materials", &felled, 3), None);
    }

    #[test]
    fn a_list_name_gives_its_bar_names() {
        assert_eq!(
            bar_names_of("Crucible Knight & Misbegotten Warrior"),
            ["crucible knight", "misbegotten warrior"]
        );
        assert_eq!(
            bar_names_of("Night's Cavalry (Glaive)"),
            ["night s cavalry"]
        );
        assert_eq!(bar_names_of("Fell Twin(x2)"), ["fell twin"]);
    }

    #[test]
    fn bar_names_come_from_the_list_and_the_aliases() {
        let list = r#"[{"bosses": [
            {"boss": "Night's Cavalry (Glaive) & Night's Cavalry (Flail)", "flag_id": 1},
            {"boss": "Night's Cavalry", "flag_id": 2},
            {"boss": "Godfrey, First Elden Lord", "flag_id": 3}]}]"#;
        let aliases = "export const bossAliases = {\n  3: [\"Hoarah Loux, Warrior\"],\n};";

        let bars = BarNames::parse(list, aliases);

        assert_eq!(bars.bosses["night s cavalry"], [1, 2]);
        assert_eq!(bars.bosses["hoarah loux warrior"], [3]);
        assert_eq!(bars.bosses["godfrey first elden lord"], [3]);
    }

    #[test]
    fn the_real_boss_list_loads() {
        let bars = BarNames::load();
        assert!(bars.bosses["tree sentinel"].len() > 1);
        assert!(bars.bosses.contains_key("beast clergyman"));
    }
}
