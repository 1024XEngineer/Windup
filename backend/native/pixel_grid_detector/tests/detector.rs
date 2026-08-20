use std::collections::BTreeSet;
use std::io::{Cursor, Write};
use std::process::{Command, Stdio};

use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use windup_pixel_grid_detector::{detect_bytes, DetectorMode};

fn upscaled_pixel_art() -> Vec<u8> {
    let mut logical = RgbaImage::new(16, 16);
    let palette = [
        Rgba([35, 28, 24, 255]),
        Rgba([201, 135, 77, 255]),
        Rgba([237, 224, 197, 255]),
        Rgba([75, 119, 132, 255]),
    ];
    for y in 0..16 {
        for x in 0..16 {
            let index = (x * 7 + y * 11) as usize % palette.len();
            logical.put_pixel(x, y, palette[index]);
        }
    }
    let enlarged = image::imageops::resize(&logical, 64, 64, image::imageops::Nearest);
    let mut encoded = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(enlarged)
        .write_to(&mut encoded, ImageFormat::Png)
        .expect("encode fixture");
    encoded.into_inner()
}

#[test]
fn full_detector_recovers_a_regular_pixel_grid() {
    let result = detect_bytes(&upscaled_pixel_art(), DetectorMode::Full).expect("detect grid");

    assert!((15..=17).contains(&result.cols));
    assert!((15..=17).contains(&result.rows));
    assert!((3.7..=4.3).contains(&result.step_x));
    assert!((3.7..=4.3).contains(&result.step_y));
}

#[test]
fn full_detector_exercises_the_arbitrated_consensus_path() {
    let source = include_bytes!("frog-500.png");

    let result = detect_bytes(source, DetectorMode::Full).expect("detect distorted grid");

    assert_eq!((result.cols, result.rows), (121, 114));
    assert_eq!(result.consensus, "arbitrated");
    assert_eq!(result.confidence, "medium");
}

#[test]
fn sub_three_pixel_results_are_reported_as_low_confidence() {
    let source = encode(RgbaImage::new(64, 64));

    let result = detect_bytes(&source, DetectorMode::Full).expect("detect ambiguous grid");

    assert!(result.step_x < 3.0 || result.step_y < 3.0);
    assert_eq!(result.confidence, "low");
}

#[test]
fn cli_emits_only_the_six_field_grid_contract() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_windup-pixel-grid-detector"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn detector CLI");
    child
        .stdin
        .take()
        .expect("open stdin")
        .write_all(&upscaled_pixel_art())
        .expect("write fixture");

    let output = child.wait_with_output().expect("wait for detector CLI");
    assert!(output.status.success());
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).expect("parse JSON");
    let keys: BTreeSet<&str> = json
        .as_object()
        .expect("JSON object")
        .keys()
        .map(String::as_str)
        .collect();

    assert_eq!(
        keys,
        BTreeSet::from([
            "cols",
            "confidence",
            "consensus",
            "rows",
            "step_x",
            "step_y"
        ])
    );
}

#[test]
fn cli_rejects_an_oversized_encoded_input_before_decoding() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_windup-pixel-grid-detector"))
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn detector CLI");
    child
        .stdin
        .take()
        .expect("open stdin")
        .write_all(&vec![0u8; 32 * 1024 * 1024 + 1])
        .expect("write oversized input");

    let output = child.wait_with_output().expect("wait for detector CLI");
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("encoded input exceeds"));
}

#[test]
fn detector_rejects_images_outside_its_resource_boundary() {
    let image = RgbaImage::new(15, 32);
    let mut encoded = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut encoded, ImageFormat::Png)
        .expect("encode fixture");

    let error = detect_bytes(&encoded.into_inner(), DetectorMode::Full).unwrap_err();

    assert!(error.to_string().contains("minimum side is 16px"));
}

fn encode(image: RgbaImage) -> Vec<u8> {
    let mut encoded = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut encoded, ImageFormat::Png)
        .expect("encode fixture");
    encoded.into_inner()
}
