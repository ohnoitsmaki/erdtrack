// What `vod read` writes and `vod score` reads: a header line, then a line
// for each frame with what OCR read in its regions, all as JSON. Reading is the
// slow part, so it's done once per video and scored as often as needed.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct Header {
    pub video: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
}

// A line OCR read, with where it is, as fractions of the frame.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Line {
    pub text: String,
    pub left: f64,
    pub top: f64,
    pub bottom: f64,
}

#[derive(Serialize, Deserialize, Default)]
pub struct Reading {
    // Seconds into the video.
    pub t: f64,
    // Each line read from the FELLED region raw.
    pub felled: Vec<String>,
    // Each line read from the Name bar region raw, and cleaned up.
    pub bars: Vec<Line>,
    pub bars_clean: Vec<Line>,
}

pub fn parse(text: &str) -> Result<(Header, Vec<Reading>), String> {
    let mut lines = text.lines().filter(|l| !l.trim().is_empty());
    let header = lines.next().ok_or("the readings are empty")?;
    let header = serde_json::from_str(header).map_err(|e| format!("header: {e}"))?;
    let readings = lines
        .enumerate()
        .map(|(n, line)| serde_json::from_str(line).map_err(|e| format!("line {}: {e}", n + 2)))
        .collect::<Result<_, _>>()?;
    Ok((header, readings))
}
