// Cleaning up a Name bar crop for OCR (ADR 0017): each pixel that is light
// and nearly grey turns black, the rest white, and the image doubles in size.
// A Name bar's text is light grey, so this drops the scene behind it.

use crate::regions::Image;

const LIGHT: u8 = 150;
const GREY: u8 = 60;

pub fn clean_up(image: &Image, double: bool) -> Image {
    let scale = if double { 2 } else { 1 };
    let (width, height) = (image.width * scale, image.height * scale);
    let mut rgba = Vec::with_capacity((width * height * 4) as usize);
    for row in 0..height {
        for col in 0..width {
            let at = (((row / scale) * image.width + col / scale) * 4) as usize;
            let [r, g, b] = [image.rgba[at], image.rgba[at + 1], image.rgba[at + 2]];
            let text = r.min(g).min(b) >= LIGHT && r.max(g).max(b) - r.min(g).min(b) <= GREY;
            let v = if text { 0 } else { 255 };
            rgba.extend([v, v, v, 255]);
        }
    }
    Image {
        width,
        height,
        rgba,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn light_grey_turns_black_and_the_rest_white_at_twice_the_size() {
        // Light grey, dark grey, light gold, white.
        let image = Image {
            width: 4,
            height: 1,
            rgba: [
                [200, 200, 190, 255],
                [90, 90, 90, 255],
                [230, 190, 110, 255],
                [255, 255, 255, 255],
            ]
            .concat(),
        };

        let cleaned = clean_up(&image, true);

        assert_eq!((cleaned.width, cleaned.height), (8, 2));
        let shades: Vec<u8> = cleaned.rgba.chunks(4).map(|p| p[0]).collect();
        let row = [0, 0, 255, 255, 255, 255, 0, 0];
        assert_eq!(shades, [row, row].concat());
    }

    #[test]
    fn it_can_keep_the_size() {
        let image = Image {
            width: 1,
            height: 1,
            rgba: vec![200, 200, 200, 255],
        };
        let cleaned = clean_up(&image, false);
        assert_eq!((cleaned.width, cleaned.height, cleaned.rgba[0]), (1, 1, 0));
    }
}
