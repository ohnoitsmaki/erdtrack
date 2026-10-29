// Which bosses' Defeat Flags are set in a slot's event flags. A flag's bit is
// found through the 1000-flag block it's in, whose position in the event
// flags the game decides; data/defeat_flag_blocks.txt holds the boss blocks'
// positions, taken from ER-Save-Lib as facts about the game's layout.

use std::collections::HashMap;
use std::sync::LazyLock;

pub const EVENT_FLAGS_SIZE: usize = 0x1bf99f;
const FLAGS_PER_BLOCK: u32 = 1000;
const BYTES_PER_BLOCK: usize = 125;

// Each block (flag / 1000) mapped to its position.
type Blocks = HashMap<u32, usize>;

static BLOCKS: LazyLock<Blocks> =
    LazyLock::new(|| parse_blocks(include_str!("../data/defeat_flag_blocks.txt")));

// Every boss's Defeat Flag, once each, from the boss list the backend ships.
static BOSS_FLAGS: LazyLock<Vec<u32>> =
    LazyLock::new(|| boss_flags(include_str!("../../convex/eroverlayBosses.json")));

fn parse_blocks(text: &str) -> Blocks {
    text.lines()
        .filter(|line| !line.starts_with('#') && !line.trim().is_empty())
        .map(|line| {
            let (block, position) = line.trim().split_once(',').expect("block,position");
            (block.parse().unwrap(), position.parse().unwrap())
        })
        .collect()
}

#[derive(serde::Deserialize)]
struct Region {
    bosses: Vec<BossEntry>,
}

#[derive(serde::Deserialize)]
struct BossEntry {
    flag_id: u32,
}

fn boss_flags(json: &str) -> Vec<u32> {
    let regions: Vec<Region> = serde_json::from_str(json).expect("the boss list");
    let mut flags: Vec<u32> = regions
        .iter()
        .flat_map(|region| region.bosses.iter().map(|boss| boss.flag_id))
        .collect();
    flags.sort_unstable();
    flags.dedup();
    flags
}

// The byte a flag's bit is in, and its mask: the lowest flag of a byte is
// its most significant bit. None if its block has no known position.
fn bit_in(blocks: &Blocks, flag: u32) -> Option<(usize, u8)> {
    let position = *blocks.get(&(flag / FLAGS_PER_BLOCK))?;
    let n = (flag % FLAGS_PER_BLOCK) as usize;
    Some((position * BYTES_PER_BLOCK + n / 8, 0x80 >> (n % 8)))
}

// Where a boss's Defeat Flag is, for building saves in tests.
#[cfg(test)]
pub fn bit(flag: u32) -> Option<(usize, u8)> {
    bit_in(&BLOCKS, flag)
}

// The bosses' Defeat Flags set in a slot's event flags, in ascending order.
// A flag placed outside them is an error, not a clear flag, so a game patch
// that moves blocks shows up like any other layout change.
pub fn set_defeat_flags(event_flags: &[u8]) -> Result<Vec<u32>, String> {
    set_in(event_flags, &BLOCKS, &BOSS_FLAGS)
}

fn set_in(event_flags: &[u8], blocks: &Blocks, flags: &[u32]) -> Result<Vec<u32>, String> {
    let mut set = Vec::new();
    for &flag in flags {
        let (byte, mask) =
            bit_in(blocks, flag).ok_or(format!("no position for defeat flag {flag}"))?;
        let value = event_flags
            .get(byte)
            .ok_or(format!("defeat flag {flag} is outside the event flags"))?;
        if value & mask != 0 {
            set.push(flag);
        }
    }
    Ok(set)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn the_file_holds_exactly_the_blocks_of_the_boss_defeat_flags() {
        let needed: BTreeSet<u32> = BOSS_FLAGS.iter().map(|flag| flag / 1000).collect();
        let held: BTreeSet<u32> = BLOCKS.keys().copied().collect();

        assert_eq!(held, needed);
        assert_eq!(held.len(), 180);
    }

    #[test]
    fn every_boss_defeat_flag_has_a_place_in_the_event_flags() {
        let unplaced: Vec<u32> = BOSS_FLAGS
            .iter()
            .copied()
            .filter(|&flag| bit(flag).is_none_or(|(byte, _)| byte >= EVENT_FLAGS_SIZE))
            .collect();

        assert_eq!(BOSS_FLAGS.len(), 207);
        assert_eq!(unplaced, Vec::<u32>::new());
    }

    // ER-Save-Editor places flags itself (MIT or Apache-2.0), and agrees on every
    // boss block it places.
    #[test]
    fn the_positions_agree_with_er_save_editor_where_it_places_the_block() {
        let rows: Vec<(u32, usize, u8)> = include_str!("../data/er_save_editor_flags.txt")
            .lines()
            .filter(|line| !line.starts_with('#'))
            .map(|line| {
                let parts: Vec<&str> = line.split(',').collect();
                (
                    parts[0].parse().unwrap(),
                    usize::from_str_radix(parts[1].trim_start_matches("0x"), 16).unwrap(),
                    parts[2].parse().unwrap(),
                )
            })
            .collect();
        let disagree: Vec<u32> = rows
            .iter()
            .filter(|&&(flag, byte, bit_index)| bit(flag) != Some((byte, 1 << bit_index)))
            .map(|&(flag, ..)| flag)
            .collect();

        assert_eq!(rows.len(), 135);
        assert_eq!(disagree, Vec::<u32>::new());
    }

    #[test]
    fn a_flag_placed_past_the_event_flags_is_an_error() {
        let blocks = Blocks::from([(10000, 11067), (20000, 15_000)]);
        let flags = vec![0u8; EVENT_FLAGS_SIZE];

        let inside = set_in(&flags, &blocks, &[10000800]);
        let outside = set_in(&flags, &blocks, &[10000800, 20000800]);

        assert_eq!(inside, Ok(vec![]));
        assert_eq!(
            outside,
            Err("defeat flag 20000800 is outside the event flags".to_string())
        );
    }
}
