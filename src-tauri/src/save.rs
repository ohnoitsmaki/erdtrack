// Reads a PC save (ER0000.sl2). The layout follows ER-Save-Lib
// (ClayAmore/ER-Save-Lib @ 664ff9e, src/save/). The slot is walked from the
// start rather than searched for the Save Total, because the fields around it
// change in multiplayer, and the walk checks what it passes, so a game patch
// that moves things is an error rather than a wrong Save Total.

use crate::defeat_flags::{set_defeat_flags, EVENT_FLAGS_SIZE};

const HEADER: usize = 0x300;
const SLOT_SIZE: usize = 0x280010;
const SLOT_DATA: usize = 0x280000;
const USER_DATA_10: usize = HEADER + 10 * SLOT_SIZE;
const USER_DATA_10_DATA: usize = 0x60000;
const PROFILE_STRIDE: usize = 0x24c;

// One character slot in use.
pub struct Slot {
    pub index: u8,
    // The MD5 the game stored, which changes on every write to the slot.
    pub digest: [u8; 16],
    pub character_name: String,
    // The Play Time, in seconds, as the profile summary last saved it. The
    // game writes it only on loading in, respawning, resting and quitting.
    pub seconds_played: u32,
    // Err when the layout isn't what the parse expects, as after a game patch.
    pub read: Result<SlotRead, String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SlotRead {
    pub total: u32,
    // The bosses' Defeat Flags set in the slot, in ascending order.
    pub defeat_flags: Vec<u32>,
    // Where the character is, as the save stores it: m60_42_36_00 is
    // [0, 36, 42, 60]. The Spotter will tell same-named bosses apart by the
    // map (ADR 0017); the screen spike logs both, to time when they change.
    #[allow(dead_code)]
    pub map_id: [u8; 4],
    #[allow(dead_code)]
    pub last_rested_grace: u32,
}

// Every slot in use, and the MD5 the game stored for the profile summaries,
// which changes whenever it rewrites them, as it does to save the Play Time.
pub struct Save {
    pub slots: Vec<Slot>,
    pub profile_digest: [u8; 16],
}

// A read whose MD5s don't match the data: the game was mid-write.
#[derive(Debug, PartialEq)]
pub struct Torn;

// Torn if any slot in use, or the profile summaries holding the names, failed
// its MD5.
pub fn read_save(bytes: &[u8]) -> Result<Save, Torn> {
    if !checksum_ok(bytes, USER_DATA_10, USER_DATA_10_DATA) {
        return Err(Torn);
    }
    let user_data = USER_DATA_10 + 0x10;
    let mut at = user_data + 4 + 8 + 0x140;
    at += 8 + u32_at(bytes, at + 4).ok_or(Torn)? as usize; // menu system save load
    let in_use = at;
    let profiles = at + 10;

    let mut slots = Vec::new();
    for index in 0..10 {
        if bytes.get(in_use + index) != Some(&1) {
            continue;
        }
        let start = HEADER + index * SLOT_SIZE;
        if !checksum_ok(bytes, start, SLOT_DATA) {
            return Err(Torn);
        }
        let data = &bytes[start + 0x10..start + 0x10 + SLOT_DATA];
        let profile = profiles + index * PROFILE_STRIDE;
        slots.push(Slot {
            index: index as u8,
            digest: bytes[start..start + 0x10].try_into().unwrap(),
            character_name: wstring(bytes, profile, 0x20),
            seconds_played: u32_at(bytes, profile + 0x26).ok_or(Torn)?,
            read: read_slot(data),
        });
    }
    Ok(Save {
        slots,
        profile_digest: bytes[USER_DATA_10..USER_DATA_10 + 0x10].try_into().unwrap(),
    })
}

fn checksum_ok(bytes: &[u8], at: usize, size: usize) -> bool {
    match bytes.get(at..at + 0x10 + size) {
        Some(entry) => md5::compute(&entry[0x10..]).0 == entry[..0x10],
        None => false,
    }
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn wstring(bytes: &[u8], at: usize, max_bytes: usize) -> String {
    let units: Vec<u16> = bytes[at..at + max_bytes]
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&pair| u16::from_le_bytes(pair))
        .take_while(|&unit| unit != 0)
        .collect();
    String::from_utf16_lossy(&units)
}

struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Cursor<'_> {
    fn skip(&mut self, n: usize) {
        self.at += n;
    }
    fn u8(&mut self) -> Result<u8, String> {
        let v = *self.bytes.get(self.at).ok_or("slot ends early")?;
        self.at += 1;
        Ok(v)
    }
    fn u32(&mut self) -> Result<u32, String> {
        let v = u32_at(self.bytes, self.at).ok_or("slot ends early")?;
        self.at += 4;
        Ok(v)
    }
    fn check(&self, ok: bool, what: &str) -> Result<(), String> {
        if ok {
            Ok(())
        } else {
            Err(format!("{what} at {:#x}", self.at))
        }
    }
}

// Walks the slot to the Save Total, checking the fields ER-Save-Lib asserts
// on the way, so a changed layout is an error rather than a wrong Save Total.
fn read_slot(data: &[u8]) -> Result<SlotRead, String> {
    let mut c = Cursor { bytes: data, at: 0 };
    let version = c.u32()?;
    let map_id = c.u32()?.to_le_bytes();
    c.skip(8 + 0x10);

    let gaitem_count = if version <= 81 { 0x13fe } else { 0x1400 };
    for _ in 0..gaitem_count {
        let handle = c.u32()?;
        let kind = handle & 0xf000_0000;
        c.check(
            matches!(kind, 0 | 0x8000_0000 | 0x9000_0000 | 0xc000_0000),
            &format!("bad gaitem handle {handle:#x}"),
        )?;
        c.skip(4); // item id
        if handle != 0 && kind != 0xc000_0000 {
            c.skip(8);
        }
        if handle != 0 && kind == 0x8000_0000 {
            c.skip(5);
        }
    }

    c.skip(0x1b0); // player game data
    c.skip(0xd * 0x10); // sp effects
    c.skip(0x58 + 0x1c + 0x58 + 0x58); // equip indexes, active slots, item ids, handles
    c.skip(4 + 0xa80 * 12 + 4 + 0x180 * 12 + 8); // held inventory
    c.skip(0x74 + 0x8c + 0x18); // spells, items, gestures
    let projectiles = c.u32()?;
    c.check(projectiles < 0x1000, "implausible projectile count")?;
    c.skip(projectiles as usize * 8);
    c.skip(0x9c + 0xc + 0x12f); // equipped armaments and items, physics, face data
    c.skip(4 + 0x780 * 12 + 4 + 0x80 * 12 + 8); // storage box
    c.skip(0x100); // gestures
    let regions = c.u32()?;
    c.check(regions < 0x1000, "implausible region count")?;
    c.skip(regions as usize * 4);
    c.skip(0x28); // horse
    let control = c.u8()?;
    c.check(control <= 1, "bad control byte")?;
    c.skip(0x44 + 8); // blood stain, gamedataman
    c.skip(4);
    let menu_size = c.u32()?;
    c.check(menu_size < 0x10000, "implausible menu size")?;
    c.skip(menu_size as usize);
    c.skip(0x34); // trophy equip data
    c.skip(8 + 7000 * 16); // gaitem game data
    c.skip(4);
    let tutorial_size = c.u32()?;
    c.check(tutorial_size < 0x10000, "implausible tutorial size")?;
    let tutorial_count = c.u32()?;
    if tutorial_count != 0 {
        c.skip((tutorial_size as usize).saturating_sub(4));
    }
    c.skip(3);

    let total = c.u32()?;
    c.skip(4); // character type
    c.u8()?; // in online session
    let character_type_online = c.u32()?;
    c.check(
        character_type_online == 0 || character_type_online == 8,
        "bad character type online",
    )?;
    let last_rested_grace = c.u32()?;
    let not_alone = c.u8()?;
    c.check(not_alone <= 1, "bad not-alone flag")?;
    c.skip(4 + 4);
    let event_flags = c.at;
    c.skip(EVENT_FLAGS_SIZE);
    let terminator = c.u8()?;
    c.check(terminator == 0, "missing event flags terminator")?;
    let defeat_flags = set_defeat_flags(&data[event_flags..event_flags + EVENT_FLAGS_SIZE])?;
    Ok(SlotRead {
        total,
        defeat_flags,
        map_id,
        last_rested_grace,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::synthetic_save::{build_save, SlotSpec};

    #[test]
    fn a_slot_reads_with_its_map_and_last_rested_grace() {
        let mut stormveil = SlotSpec::new("Yawn", 3);
        stormveil.map_id = [0, 0, 10, 10];
        stormveil.last_rested_grace = 10002950;

        let save = read_save(&build_save(&[Some(stormveil)])).unwrap();
        let read = save.slots[0].read.as_ref().unwrap();

        assert_eq!(read.map_id, [0, 0, 10, 10]);
        assert_eq!(read.last_rested_grace, 10002950);
    }
}
