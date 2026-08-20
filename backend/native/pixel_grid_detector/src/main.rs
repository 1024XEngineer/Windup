use std::io::{Read, Write};

use windup_pixel_grid_detector::{detect_bytes, DetectorMode, MAX_INPUT_BYTES};

fn fail(message: impl std::fmt::Display) -> ! {
    eprintln!("{message}");
    std::process::exit(1);
}

fn main() {
    let mode = match std::env::args().nth(1).as_deref() {
        None | Some("--full") => DetectorMode::Full,
        Some("--fast") => DetectorMode::Fast,
        Some(option) => fail(format!("unknown option: {option}")),
    };
    if std::env::args().nth(2).is_some() {
        fail("too many arguments");
    }

    let mut source = Vec::with_capacity(MAX_INPUT_BYTES.min(1024 * 1024));
    std::io::stdin()
        .take((MAX_INPUT_BYTES + 1) as u64)
        .read_to_end(&mut source)
        .unwrap_or_else(|error| fail(format!("cannot read image: {error}")));
    if source.len() > MAX_INPUT_BYTES {
        fail(format!("encoded input exceeds {MAX_INPUT_BYTES} bytes"));
    }
    let result = detect_bytes(&source, mode).unwrap_or_else(|error| fail(error));
    serde_json::to_writer(std::io::stdout(), &result)
        .unwrap_or_else(|error| fail(format!("cannot encode detection: {error}")));
    std::io::stdout()
        .write_all(b"\n")
        .unwrap_or_else(|error| fail(format!("cannot write detection: {error}")));
}
