// The screen regions the Spotter will read, as fractions of the frame, and
// saving them as PNGs. The fractions are first guesses for a 16:9 frame: a
// whole frame is saved alongside them so they can be measured again.

use std::fs::File;
use std::io::BufWriter;
use std::path::Path;

pub struct Region {
    pub name: &'static str,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub const FRAME: Region = Region {
    name: "frame",
    x: 0.0,
    y: 0.0,
    width: 1.0,
    height: 1.0,
};

pub const REGIONS: [Region; 3] = [
    // Centred, across the red band.
    Region {
        name: "you-died",
        x: 0.25,
        y: 0.42,
        width: 0.5,
        height: 0.16,
    },
    // The same band, wider for GREAT ENEMY FELLED.
    Region {
        name: "felled",
        x: 0.15,
        y: 0.40,
        width: 0.7,
        height: 0.2,
    },
    // Low in the middle, with room for up to three Name bars above the first.
    Region {
        name: "name-bars",
        x: 0.18,
        y: 0.66,
        width: 0.64,
        height: 0.26,
    },
];

// A frame as the capture maps it: BGRA rows, each `row_pitch` bytes apart,
// which can be longer than the row.
pub struct Frame<'a> {
    pub bgra: &'a [u8],
    pub width: u32,
    pub height: u32,
    pub row_pitch: usize,
}

pub struct Image {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

pub fn crop(frame: &Frame, region: &Region) -> Image {
    let span = |start: f64, length: f64, of: u32| {
        let at = |f: f64| ((f * f64::from(of)).round() as u32).min(of);
        (at(start), at(start + length))
    };
    let (left, right) = span(region.x, region.width, frame.width);
    let (top, bottom) = span(region.y, region.height, frame.height);
    let mut rgba = Vec::with_capacity(((right - left) * (bottom - top) * 4) as usize);
    for row in top..bottom {
        let start = row as usize * frame.row_pitch + left as usize * 4;
        let end = start + (right - left) as usize * 4;
        for [b, g, r, a] in frame.bgra[start..end].as_chunks::<4>().0 {
            rgba.extend([*r, *g, *b, *a]);
        }
    }
    Image {
        width: right - left,
        height: bottom - top,
        rgba,
    }
}

pub fn save_png(path: &Path, image: &Image) -> std::io::Result<()> {
    let mut encoder = png::Encoder::new(
        BufWriter::new(File::create(path)?),
        image.width,
        image.height,
    );
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.write_header()?.write_image_data(&image.rgba)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // A 4x2 frame with 4 bytes of padding on each row; each pixel's blue is
    // its index, green 100, red 200 and alpha 255.
    fn frame_bytes() -> Vec<u8> {
        let mut bytes = Vec::new();
        for row in 0..2u8 {
            for col in 0..4u8 {
                bytes.extend([row * 4 + col, 100, 200, 255]);
            }
            bytes.extend([9; 4]);
        }
        bytes
    }

    fn frame(bytes: &[u8]) -> Frame<'_> {
        Frame {
            bgra: bytes,
            width: 4,
            height: 2,
            row_pitch: 20,
        }
    }

    #[test]
    fn a_region_is_cropped_by_its_fractions_into_rgba() {
        let bytes = frame_bytes();
        let right_half_bottom = Region {
            name: "test",
            x: 0.5,
            y: 0.5,
            width: 0.5,
            height: 0.5,
        };

        let image = crop(&frame(&bytes), &right_half_bottom);

        assert_eq!((image.width, image.height), (2, 1));
        assert_eq!(image.rgba, [200, 100, 6, 255, 200, 100, 7, 255]);
    }

    #[test]
    fn a_saved_png_holds_the_cropped_pixels() {
        let bytes = frame_bytes();
        let image = crop(&frame(&bytes), &FRAME);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("frame.png");

        save_png(&path, &image).unwrap();

        let decoder = png::Decoder::new(std::io::BufReader::new(File::open(&path).unwrap()));
        let mut reader = decoder.read_info().unwrap();
        let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
        let info = reader.next_frame(&mut pixels).unwrap();
        assert_eq!((info.width, info.height), (4, 2));
        assert_eq!(&pixels[..8], [200, 100, 0, 255, 200, 100, 1, 255]);
        assert_eq!(pixels[4 * 4 * 2 - 2], 7);
    }
}
