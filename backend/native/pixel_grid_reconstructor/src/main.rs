use std::io::{Read, Write};

use windup_pixel_grid_reconstructor::{reconstruct_bytes, MAX_INPUT_BYTES};

fn fail(message: impl std::fmt::Display) -> ! {
    eprintln!("{message}");
    std::process::exit(1);
}

fn parse_args() -> (usize, usize, usize) {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut cols = None;
    let mut rows = None;
    let mut colors = 32usize;
    let mut index = 0;
    while index < args.len() {
        let value = args
            .get(index + 1)
            .unwrap_or_else(|| fail("missing option value"));
        match args[index].as_str() {
            "--cols" => cols = Some(value.parse().unwrap_or_else(|_| fail("invalid cols"))),
            "--rows" => rows = Some(value.parse().unwrap_or_else(|_| fail("invalid rows"))),
            "--colors" => {
                colors = value.parse().unwrap_or_else(|_| fail("invalid colors"));
            }
            option => fail(format!("unknown option: {option}")),
        }
        index += 2;
    }
    (
        cols.unwrap_or_else(|| fail("--cols is required")),
        rows.unwrap_or_else(|| fail("--rows is required")),
        colors,
    )
}

fn main() {
    let (cols, rows, colors) = parse_args();
    let mut source = Vec::with_capacity(MAX_INPUT_BYTES.min(1024 * 1024));
    std::io::stdin()
        .take((MAX_INPUT_BYTES + 1) as u64)
        .read_to_end(&mut source)
        .unwrap_or_else(|error| fail(format!("cannot read image: {error}")));
    if source.len() > MAX_INPUT_BYTES {
        fail(format!("encoded input exceeds {MAX_INPUT_BYTES} bytes"));
    }
    let result = reconstruct_bytes(&source, cols, rows, colors).unwrap_or_else(|error| fail(error));
    std::io::stdout()
        .write_all(&result.png)
        .unwrap_or_else(|error| fail(format!("cannot write PNG: {error}")));
}
