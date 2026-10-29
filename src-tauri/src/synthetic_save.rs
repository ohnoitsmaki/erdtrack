// Builds synthetic PC saves laid out after ER-Save-Lib's UserDataX and
// UserData10. Everything not named here is zeroed, so there's no Steam ID and
// no real character.

pub struct SlotSpec {
    pub name: &'static str,
    pub total: u32,
    // The Play Time in the profile summary, in seconds.
    pub seconds_played: u32,
    // Also in the profile summary, so a test can rewrite it with the same
    // Play Time, as the game does on loading in.
    pub level: u32,
    pub version: u32,
    // -1 alone or host, 1 phantom.
    pub character_type: i32,
    pub in_online_session: u8,
    // 8 normally, 0 for phantoms.
    pub character_type_online: u32,
    pub not_alone: u8,
    // As the save stores it: m60_42_36_00 is [0, 36, 42, 60].
    pub map_id: [u8; 4],
    pub last_rested_grace: u32,
    // Placed at the start of the gaitem map; the rest are empty.
    pub gaitem_handles: Vec<u32>,
    pub projectiles: u32,
    pub regions: u32,
    pub menu_size: u32,
    pub tutorial_size: u32,
    // Bytes of the event flags to set, each by its mask.
    pub event_flags: Vec<(usize, u8)>,
}

impl SlotSpec {
    pub fn new(name: &'static str, total: u32) -> Self {
        SlotSpec {
            name,
            total,
            seconds_played: 0,
            level: 1,
            version: 262,
            character_type: -1,
            in_online_session: 0,
            character_type_online: 8,
            not_alone: 0,
            map_id: [0, 36, 42, 60],
            last_rested_grace: 1042362951,
            gaitem_handles: Vec::new(),
            projectiles: 0,
            regions: 0,
            menu_size: 0x1008,
            tutorial_size: 0x408,
            event_flags: Vec::new(),
        }
    }
}

use crate::defeat_flags::EVENT_FLAGS_SIZE;

const HEADER: usize = 0x300;
const SLOT_SIZE: usize = 0x280010;
const SLOT_DATA: usize = 0x280000;
const USER_DATA_10_SIZE: usize = 0x60010;
const PROFILE_STRIDE: usize = 0x24c;

struct Writer {
    bytes: Vec<u8>,
    at: usize,
}

impl Writer {
    fn new(size: usize) -> Self {
        Writer {
            bytes: vec![0; size],
            at: 0,
        }
    }
    fn skip(&mut self, n: usize) {
        self.at += n;
    }
    fn u8(&mut self, v: u8) {
        self.bytes[self.at] = v;
        self.at += 1;
    }
    fn u32(&mut self, v: u32) {
        self.bytes[self.at..self.at + 4].copy_from_slice(&v.to_le_bytes());
        self.at += 4;
    }
    fn i32(&mut self, v: i32) {
        self.u32(v as u32);
    }
    fn wstring(&mut self, s: &str, bytes: usize) {
        for (i, unit) in s.encode_utf16().take(bytes / 2).enumerate() {
            self.bytes[self.at + i * 2..self.at + i * 2 + 2].copy_from_slice(&unit.to_le_bytes());
        }
        self.at += bytes;
    }
}

fn slot_data(spec: &SlotSpec) -> Vec<u8> {
    let mut w = Writer::new(SLOT_DATA);
    w.u32(spec.version);
    w.u32(u32::from_le_bytes(spec.map_id));
    w.skip(8 + 0x10); // unk, unk

    let gaitem_count = if spec.version <= 81 { 0x13fe } else { 0x1400 };
    for i in 0..gaitem_count {
        let handle = spec.gaitem_handles.get(i).copied().unwrap_or(0);
        w.u32(handle);
        w.u32(if handle == 0 { 0 } else { 0x1000 });
        let kind = handle & 0xf000_0000;
        if handle != 0 && kind != 0xc000_0000 {
            w.skip(8);
        }
        if handle != 0 && kind == 0x8000_0000 {
            w.skip(5);
        }
    }

    w.skip(0x1b0); // player game data

    w.skip(0xd * 0x10); // sp effects
    w.skip(0x58 + 0x1c + 0x58 + 0x58); // equip indexes, active slots, item ids, handles
    w.skip(4 + 0xa80 * 12 + 4 + 0x180 * 12 + 8); // held inventory
    w.skip(0x74 + 0x8c + 0x18); // spells, items, gestures
    w.u32(spec.projectiles);
    w.skip(spec.projectiles as usize * 8);
    w.skip(0x9c + 0xc + 0x12f); // equipped armaments and items, physics, face data
    w.skip(4 + 0x780 * 12 + 4 + 0x80 * 12 + 8); // storage box
    w.skip(0x100); // gestures
    w.u32(spec.regions);
    w.skip(spec.regions as usize * 4);
    w.skip(0x28 + 1 + 0x44 + 8); // horse, control byte, blood stain, gamedataman
    w.skip(4);
    w.u32(spec.menu_size);
    w.skip(spec.menu_size as usize);
    w.skip(0x34); // trophy equip data
    w.skip(8 + 7000 * 16); // gaitem game data
    w.skip(4);
    w.u32(spec.tutorial_size);
    w.u32(if spec.tutorial_size > 4 { 1 } else { 0 });
    w.skip(spec.tutorial_size as usize - 4);
    w.skip(3); // gameman 0x8c..0x8e

    w.u32(spec.total);
    w.i32(spec.character_type);
    w.u8(spec.in_online_session);
    w.u32(spec.character_type_online);
    w.u32(spec.last_rested_grace);
    w.u8(spec.not_alone);
    w.u32(0); // countdown timer
    w.u32(0);
    for &(byte, mask) in &spec.event_flags {
        w.bytes[w.at + byte] |= mask;
    }
    w.skip(EVENT_FLAGS_SIZE);
    w.u8(0); // event flags terminator
    w.bytes
}

fn user_data_10(slots: &[Option<SlotSpec>]) -> Vec<u8> {
    let mut w = Writer::new(USER_DATA_10_SIZE - 0x10);
    w.u32(262);
    w.skip(8); // Steam ID left as zero
    w.skip(0x140); // settings
    let menu_size = 0x1800;
    w.skip(4);
    w.u32(menu_size);
    w.skip(menu_size as usize);
    for i in 0..10 {
        w.u8(u8::from(matches!(slots.get(i), Some(Some(_)))));
    }
    let profiles = w.at;
    for (i, slot) in slots.iter().enumerate() {
        if let Some(slot) = slot {
            w.at = profiles + i * PROFILE_STRIDE;
            w.wstring(slot.name, 0x20);
            w.skip(2); // name terminator
            w.u32(slot.level);
            w.u32(slot.seconds_played);
        }
    }
    w.bytes
}

fn with_checksum(data: &[u8]) -> Vec<u8> {
    let mut out = md5::compute(data).0.to_vec();
    out.extend_from_slice(data);
    out
}

// A whole save with up to ten slots; `None` leaves a slot empty and inactive.
pub fn build_save(slots: &[Option<SlotSpec>]) -> Vec<u8> {
    let mut out = vec![0; HEADER + 10 * SLOT_SIZE + USER_DATA_10_SIZE];
    out[..4].copy_from_slice(b"BND4");
    for i in 0..10 {
        let data = match slots.get(i) {
            Some(Some(slot)) => slot_data(slot),
            _ => vec![0; SLOT_DATA],
        };
        let start = HEADER + i * SLOT_SIZE;
        out[start..start + SLOT_SIZE].copy_from_slice(&with_checksum(&data));
    }
    let start = HEADER + 10 * SLOT_SIZE;
    out[start..].copy_from_slice(&with_checksum(&user_data_10(slots)));
    out
}

// Flips a byte inside a slot's data, so its MD5 no longer matches, as when
// the game was mid-write.
pub fn tear(save: &mut [u8], slot: usize) {
    save[HEADER + slot * SLOT_SIZE + 0x5000] ^= 0xff;
}
