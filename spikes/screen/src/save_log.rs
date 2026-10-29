// What each save write is logged as: every slot the write changed, with its
// Save Total, map and last rested grace. The game writes only the slot being
// played, so the slot that changed is the active one.

use std::collections::HashMap;

use crate::save::Save;

pub struct SaveLog {
    // Each slot's MD5 at the last read, which changes on every write to it.
    digests: HashMap<u8, [u8; 16]>,
}

impl SaveLog {
    pub fn new() -> Self {
        SaveLog {
            digests: HashMap::new(),
        }
    }

    // One line per slot the write changed, or every slot on the first read.
    pub fn write(&mut self, save: &Save) -> Vec<String> {
        let first = self.digests.is_empty();
        let mut lines = Vec::new();
        for slot in &save.slots {
            if !first && self.digests.get(&slot.index) == Some(&slot.digest) {
                continue;
            }
            let read = match &slot.read {
                Ok(read) => format!(
                    "Save Total {}, map {}, last grace {}",
                    read.total,
                    map_name(read.map_id),
                    read.last_rested_grace
                ),
                Err(why) => format!("unreadable ({why})"),
            };
            lines.push(format!(
                "slot {} {:?}: {read}",
                slot.index, slot.character_name
            ));
        }
        self.digests = save.slots.iter().map(|s| (s.index, s.digest)).collect();
        if lines.is_empty() {
            lines.push("no slot changed".to_string());
        }
        lines
    }
}

// As the game and the modding tools name maps: [0, 36, 42, 60] is
// m60_42_36_00.
fn map_name([d, c, b, a]: [u8; 4]) -> String {
    format!("m{a:02}_{b:02}_{c:02}_{d:02}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::save::read_save;
    use crate::synthetic_save::{build_save, SlotSpec};

    fn slot(name: &'static str, total: u32) -> SlotSpec {
        let mut spec = SlotSpec::new(name, total);
        spec.map_id = [0, 36, 42, 60];
        spec.last_rested_grace = 1042362951;
        spec
    }

    fn write(log: &mut SaveLog, slots: [SlotSpec; 2]) -> Vec<String> {
        let [a, b] = slots;
        log.write(&read_save(&build_save(&[Some(a), Some(b)])).unwrap())
    }

    #[test]
    fn the_first_read_lists_every_slot_and_later_writes_only_the_active_one() {
        let mut log = SaveLog::new();

        let first = write(&mut log, [slot("Yawn", 3), slot("Alt", 0)]);
        let same = write(&mut log, [slot("Yawn", 3), slot("Alt", 0)]);
        let mut moved = slot("Yawn", 4);
        moved.map_id = [0, 0, 10, 10];
        moved.last_rested_grace = 10002950;
        let died = write(&mut log, [moved, slot("Alt", 0)]);

        assert_eq!(
            first,
            [
                "slot 0 \"Yawn\": Save Total 3, map m60_42_36_00, last grace 1042362951",
                "slot 1 \"Alt\": Save Total 0, map m60_42_36_00, last grace 1042362951",
            ]
        );
        assert_eq!(same, ["no slot changed"]);
        assert_eq!(
            died,
            ["slot 0 \"Yawn\": Save Total 4, map m10_10_00_00, last grace 10002950"]
        );
    }

    #[test]
    fn a_slot_the_parse_cant_read_says_why() {
        let mut log = SaveLog::new();
        let mut patched = slot("Yawn", 3);
        patched.not_alone = 7;

        let lines = log.write(&read_save(&build_save(&[Some(patched)])).unwrap());

        assert_eq!(lines.len(), 1);
        assert!(lines[0].starts_with("slot 0 \"Yawn\": unreadable (bad not-alone flag"));
    }
}
