// The OCR built into Windows (Windows.Media.Ocr), with its English recognizer,
// as the Spotter will use it (ADR 0017).

use windows::core::{Result, HSTRING};
use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Security::Cryptography::CryptographicBuffer;

use crate::readings::Line;
use crate::regions::{Image, Region};

pub struct Ocr {
    engine: OcrEngine,
    // The longest side of an image it reads.
    pub max_side: u32,
}

impl Ocr {
    pub fn english() -> std::result::Result<Ocr, String> {
        let language =
            Language::CreateLanguage(&HSTRING::from("en-US")).map_err(|e| e.to_string())?;
        if !OcrEngine::IsLanguageSupported(&language).unwrap_or(false) {
            return Err(
                "Windows has no English OCR recognizer. In an administrator PowerShell: \
                Add-WindowsCapability -Online -Name Language.OCR~~~en-US~0.0.1.0"
                    .into(),
            );
        }
        Ok(Ocr {
            engine: OcrEngine::TryCreateFromLanguage(&language).map_err(|e| e.to_string())?,
            max_side: OcrEngine::MaxImageDimension().map_err(|e| e.to_string())?,
        })
    }

    // Each line of text it reads in `image`, cropped from `region` of the
    // frame, placed in the frame.
    pub fn lines(&self, image: &Image, region: &Region) -> Result<Vec<Line>> {
        let mut bgra = image.rgba.clone();
        for pixel in bgra.as_chunks_mut::<4>().0 {
            pixel.swap(0, 2);
        }
        let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
            &CryptographicBuffer::CreateFromByteArray(&bgra)?,
            BitmapPixelFormat::Bgra8,
            image.width as i32,
            image.height as i32,
        )?;
        let result = self.engine.RecognizeAsync(&bitmap)?.join()?;
        result
            .Lines()?
            .into_iter()
            .map(|line| {
                // A line's box is its words' boxes together.
                let (mut left, mut top, mut bottom) = (f64::MAX, f64::MAX, 0.0f64);
                for word in line.Words()? {
                    let rect = word.BoundingRect()?;
                    left = left.min(f64::from(rect.X));
                    top = top.min(f64::from(rect.Y));
                    bottom = bottom.max(f64::from(rect.Y + rect.Height));
                }
                let x = |px: f64| region.x + px / f64::from(image.width) * region.width;
                let y = |px: f64| region.y + px / f64::from(image.height) * region.height;
                Ok(Line {
                    text: line.Text()?.to_string(),
                    left: x(left),
                    top: y(top),
                    bottom: y(bottom),
                })
            })
            .collect()
    }
}
