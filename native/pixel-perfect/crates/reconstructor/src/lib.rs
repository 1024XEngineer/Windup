//! 独立显式网格重建器：图片与网格参数输入，原生 1x PNG 输出。

mod kmeans;
mod reconstruct;

use std::collections::HashSet;
use std::io::Cursor;

use image::{DynamicImage, ImageFormat, ImageReader, Limits, RgbaImage};

pub const MAX_INPUT_PIXELS: usize = 4_000_000;
pub const MAX_INPUT_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_WORKING_BYTES: usize = 128 * 1024 * 1024;
pub const MIN_INPUT_SIDE: usize = 16;

#[derive(Debug)]
pub struct ReconstructedImage {
    pub png: Vec<u8>,
    pub width: usize,
    pub height: usize,
    pub visible_color_count: usize,
}

#[derive(Debug)]
pub struct ReconstructorError(String);

impl std::fmt::Display for ReconstructorError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ReconstructorError {}

pub fn reconstruct_bytes(
    source: &[u8],
    cols: usize,
    rows: usize,
    structure_colors: usize,
) -> Result<ReconstructedImage, ReconstructorError> {
    if source.len() > MAX_INPUT_BYTES {
        return Err(ReconstructorError(format!(
            "encoded input exceeds {MAX_INPUT_BYTES} bytes"
        )));
    }

    let dimensions_reader = reader_for(source)?;
    let (width, height) = dimensions_reader
        .into_dimensions()
        .map_err(|error| ReconstructorError(format!("cannot read image dimensions: {error}")))?;
    let (width, height) = (width as usize, height as usize);
    if width.min(height) < MIN_INPUT_SIDE {
        return Err(ReconstructorError(format!(
            "image is too small (minimum side is {MIN_INPUT_SIDE}px)"
        )));
    }
    let pixel_count = width
        .checked_mul(height)
        .ok_or_else(|| ReconstructorError("image dimensions overflow pixel count".into()))?;
    if pixel_count > MAX_INPUT_PIXELS {
        return Err(ReconstructorError(format!(
            "image is too large (maximum is {MAX_INPUT_PIXELS} pixels)"
        )));
    }
    if cols == 0 || rows == 0 || cols > width || rows > height {
        return Err(ReconstructorError(format!(
            "grid must be within source bounds (received {cols}x{rows} for {width}x{height})"
        )));
    }
    if !(2..=64).contains(&structure_colors) {
        return Err(ReconstructorError(
            "structure colors must be between 2 and 64".into(),
        ));
    }
    let cell_count = cols
        .checked_mul(rows)
        .ok_or_else(|| ReconstructorError("grid dimensions overflow cell count".into()))?;
    let working_bytes = reconstruct::estimated_working_bytes(
        pixel_count,
        cell_count,
        structure_colors,
        width,
        height,
    )
    .ok_or_else(|| ReconstructorError("reconstruction working set overflow".into()))?;
    if working_bytes > MAX_WORKING_BYTES {
        return Err(ReconstructorError(format!(
            "reconstruction working set exceeds {MAX_WORKING_BYTES} bytes"
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
        .map_err(|error| ReconstructorError(format!("cannot decode PNG/JPEG image: {error}")))?
        .to_rgba8();

    let reconstructed =
        reconstruct::two_stage_pack(image.as_raw(), width, height, cols, rows, structure_colors);
    let visible_colors: HashSet<[u8; 3]> = reconstructed
        .rgba
        .chunks_exact(4)
        .filter(|pixel| pixel[3] > 0)
        .map(|pixel| [pixel[0], pixel[1], pixel[2]])
        .collect();
    let output = RgbaImage::from_raw(
        reconstructed.cols as u32,
        reconstructed.rows as u32,
        reconstructed.rgba,
    )
    .ok_or_else(|| ReconstructorError("invalid reconstruction buffer".into()))?;
    let mut encoded = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(output)
        .write_to(&mut encoded, ImageFormat::Png)
        .map_err(|error| ReconstructorError(format!("cannot encode PNG: {error}")))?;

    Ok(ReconstructedImage {
        png: encoded.into_inner(),
        width: cols,
        height: rows,
        visible_color_count: visible_colors.len(),
    })
}

fn reader_for(source: &[u8]) -> Result<ImageReader<Cursor<&[u8]>>, ReconstructorError> {
    let reader = ImageReader::new(Cursor::new(source))
        .with_guessed_format()
        .map_err(|error| ReconstructorError(format!("cannot inspect image: {error}")))?;
    match reader.format() {
        Some(ImageFormat::Png | ImageFormat::Jpeg) => Ok(reader),
        _ => Err(ReconstructorError("input must be PNG or JPEG".into())),
    }
}
