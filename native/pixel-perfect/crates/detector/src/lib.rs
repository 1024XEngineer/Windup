//! 独立像素网格识别器：图片字节输入，网格元数据输出。

pub mod acf;
pub mod autocorr;
pub mod core;
pub mod fusionchan;
pub mod gray;
pub mod kmeans;
pub mod reconsearch;
pub mod runlengths;
pub mod selfsim;
pub mod sigproc;
pub mod varcontrast;

use std::io::Cursor;

use image::{ImageFormat, ImageReader, Limits};

pub const MAX_INPUT_PIXELS: usize = 4_000_000;
pub const MAX_INPUT_BYTES: usize = 32 * 1024 * 1024;
pub const MIN_INPUT_SIDE: usize = 16;
pub const MIN_RELIABLE_PIXEL_SIZE: f64 = 3.0;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DetectorMode {
    Full,
    Fast,
}

#[derive(Debug)]
pub struct GridDetection {
    pub step_x: f64,
    pub step_y: f64,
    pub cols: i64,
    pub rows: i64,
    pub consensus: String,
    pub confidence: &'static str,
}

#[derive(Debug)]
pub struct DetectorError(String);

impl std::fmt::Display for DetectorError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for DetectorError {}

pub fn detect_bytes(source: &[u8], mode: DetectorMode) -> Result<GridDetection, DetectorError> {
    if source.len() > MAX_INPUT_BYTES {
        return Err(DetectorError(format!(
            "encoded input exceeds {MAX_INPUT_BYTES} bytes"
        )));
    }

    let dimensions_reader = reader_for(source)?;
    let (width, height) = dimensions_reader
        .into_dimensions()
        .map_err(|error| DetectorError(format!("cannot read image dimensions: {error}")))?;
    let (width, height) = (width as usize, height as usize);
    if width.min(height) < MIN_INPUT_SIDE {
        return Err(DetectorError(format!(
            "image is too small (minimum side is {MIN_INPUT_SIDE}px)"
        )));
    }
    let pixel_count = width
        .checked_mul(height)
        .ok_or_else(|| DetectorError("image dimensions overflow pixel count".into()))?;
    if pixel_count > MAX_INPUT_PIXELS {
        return Err(DetectorError(format!(
            "image is too large (maximum is {MAX_INPUT_PIXELS} pixels)"
        )));
    }

    let mut decode_reader = reader_for(source)?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(width as u32);
    limits.max_image_height = Some(height as u32);
    limits.max_alloc = Some(64 * 1024 * 1024);
    decode_reader.limits(limits);
    let image = decode_reader
        .decode()
        .map_err(|error| DetectorError(format!("cannot decode PNG/JPEG image: {error}")))?
        .to_rgba8();

    let detected = match mode {
        DetectorMode::Full => core::detect_full(image.as_raw(), width, height),
        DetectorMode::Fast => core::detect_fast(image.as_raw(), width, height),
    };
    let confidence = confidence_for(&detected.consensus, detected.step_x, detected.step_y);
    Ok(GridDetection {
        step_x: detected.step_x,
        step_y: detected.step_y,
        cols: detected.cols,
        rows: detected.rows,
        consensus: detected.consensus,
        confidence,
    })
}

fn reader_for(source: &[u8]) -> Result<ImageReader<Cursor<&[u8]>>, DetectorError> {
    let reader = ImageReader::new(Cursor::new(source))
        .with_guessed_format()
        .map_err(|error| DetectorError(format!("cannot inspect image: {error}")))?;
    match reader.format() {
        Some(ImageFormat::Png | ImageFormat::Jpeg) => Ok(reader),
        _ => Err(DetectorError("input must be PNG or JPEG".into())),
    }
}

fn confidence_for(consensus: &str, step_x: f64, step_y: f64) -> &'static str {
    if step_x < MIN_RELIABLE_PIXEL_SIZE || step_y < MIN_RELIABLE_PIXEL_SIZE {
        return "low";
    }
    if consensus.starts_with("fast:") {
        "high"
    } else if consensus == "arbitrated"
        || consensus.starts_with("fastmode:") && consensus.contains('+')
    {
        "medium"
    } else {
        "low"
    }
}

#[cfg(test)]
mod tests {
    use super::confidence_for;

    #[test]
    fn confidence_reflects_the_detector_decision_path() {
        assert_eq!(confidence_for("fast:ac+rl(S)", 4.0, 4.0), "high");
        assert_eq!(confidence_for("arbitrated", 4.0, 4.0), "medium");
        assert_eq!(confidence_for("fastmode:ac+ss", 4.0, 4.0), "medium");
        assert_eq!(confidence_for("fastmode:lowconf", 4.0, 4.0), "low");
        assert_eq!(confidence_for("fast:ac+rl(S)", 2.9, 4.0), "low");
    }
}
