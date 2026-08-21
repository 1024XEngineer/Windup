use std::io::{Cursor, Write};
use std::process::{Command, Stdio};

use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use windup_pixel_grid_reconstructor::reconstruct_bytes;

fn encode(image: RgbaImage) -> Vec<u8> {
    let mut output = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut output, ImageFormat::Png)
        .expect("encode fixture");
    output.into_inner()
}

#[test]
fn explicit_grid_rebuilds_one_color_per_output_cell() {
    let mut logical = RgbaImage::new(4, 4);
    let palette = [
        Rgba([0, 0, 0, 255]),
        Rgba([220, 60, 50, 255]),
        Rgba([50, 120, 210, 255]),
        Rgba([240, 235, 220, 255]),
    ];
    for y in 0..4 {
        for x in 0..4 {
            logical.put_pixel(x, y, palette[((x + y) % 4) as usize]);
        }
    }
    let source = image::imageops::resize(&logical, 32, 32, image::imageops::Nearest);

    let result = reconstruct_bytes(&encode(source), 4, 4, 4).expect("reconstruct grid");

    assert_eq!((result.width, result.height), (4, 4));
    assert_eq!(result.visible_color_count, 4);
    let decoded = image::load_from_memory(&result.png).expect("decode output");
    assert_eq!((decoded.width(), decoded.height()), (4, 4));
    assert_eq!(decoded.to_rgba8(), logical);
}

#[test]
fn structure_color_count_does_not_cap_the_final_palette() {
    let mut logical = RgbaImage::new(4, 4);
    let palette = [
        Rgba([10, 20, 30, 255]),
        Rgba([220, 60, 50, 255]),
        Rgba([50, 120, 210, 255]),
        Rgba([240, 235, 220, 255]),
    ];
    for y in 0..4 {
        for x in 0..4 {
            logical.put_pixel(x, y, palette[((x + y) % 4) as usize]);
        }
    }
    let source = image::imageops::resize(&logical, 32, 32, image::imageops::Nearest);

    let result = reconstruct_bytes(&encode(source), 4, 4, 2).expect("reconstruct grid");

    assert_eq!(result.visible_color_count, 4);
    assert_eq!(
        image::load_from_memory(&result.png)
            .expect("decode output")
            .to_rgba8(),
        logical
    );
}

#[test]
fn transparent_rgb_does_not_tint_a_majority_opaque_cell() {
    let mut source = RgbaImage::from_pixel(16, 16, Rgba([255, 0, 0, 255]));
    for y in 0..4 {
        for x in 0..16 {
            source.put_pixel(x, y, Rgba([0, 0, 255, 0]));
        }
    }

    let result = reconstruct_bytes(&encode(source), 1, 1, 2).expect("reconstruct cell");
    let decoded = image::load_from_memory(&result.png)
        .expect("decode output")
        .to_rgba8();

    assert_eq!(decoded.get_pixel(0, 0), &Rgba([255, 0, 0, 255]));
}

#[test]
fn dense_grid_color_reconstruction_stays_within_source_color_bounds() {
    let size = 64;
    let mut source = RgbaImage::new(size, size);
    for y in 0..size {
        for x in 0..size {
            source.put_pixel(
                x,
                y,
                Rgba([
                    100 + (x % 11) as u8,
                    100 + (y % 11) as u8,
                    100 + ((x + y) % 11) as u8,
                    255,
                ]),
            );
        }
    }

    let result = reconstruct_bytes(&encode(source), 36, 36, 2).expect("reconstruct dense grid");
    let decoded = image::load_from_memory(&result.png)
        .expect("decode output")
        .to_rgb8();
    let channels: Vec<u8> = decoded.pixels().flat_map(|pixel| pixel.0).collect();

    assert!(channels
        .iter()
        .all(|&channel| (100..=110).contains(&channel)));
}

#[test]
fn reconstructor_rejects_a_grid_larger_than_the_source() {
    let source = encode(RgbaImage::new(32, 32));

    let error = reconstruct_bytes(&source, 33, 32, 16).unwrap_err();

    assert!(error
        .to_string()
        .contains("grid must be within source bounds"));
}

#[test]
fn reconstructor_rejects_a_dense_grid_before_large_algorithm_allocations() {
    let source = encode(RgbaImage::new(512, 512));

    let error = reconstruct_bytes(&source, 512, 512, 64).unwrap_err();

    assert!(error.to_string().contains("working set exceeds"));
}

#[test]
fn reconstructor_rejects_more_than_four_million_pixels_before_decoding() {
    let source = encode(RgbaImage::new(2001, 2000));

    let error = reconstruct_bytes(&source, 16, 16, 16).unwrap_err();

    assert!(error.to_string().contains("maximum is 4000000 pixels"));
}

#[test]
fn cli_rejects_an_oversized_encoded_input_before_decoding() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_windup-pixel-grid-reconstructor"))
        .args(["--cols", "16", "--rows", "16"])
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn reconstructor CLI");
    child
        .stdin
        .take()
        .expect("open stdin")
        .write_all(&vec![0u8; 32 * 1024 * 1024 + 1])
        .expect("write oversized input");

    let output = child
        .wait_with_output()
        .expect("wait for reconstructor CLI");
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("encoded input exceeds"));
}
