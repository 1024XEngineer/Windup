//! Explicit regular-grid reconstruction extracted from Pixel Art Fixer.

pub struct Reconstruction {
    pub rgba: Vec<u8>,
    pub cols: usize,
    pub rows: usize,
}

pub fn estimated_working_bytes(
    source_pixels: usize,
    cell_count: usize,
    structure_colors: usize,
    width: usize,
    height: usize,
) -> Option<usize> {
    // Source buffers cover RGBA, per-pixel labels and opaque-index sampling.
    // Per-cell buffers cover voting, winning labels, color/alpha accumulators
    // and encoded-output overlap; 4 MiB reserves k-means samples and centers.
    let source_buffers = source_pixels.checked_mul(16)?;
    let bytes_per_cell = 96usize.checked_add(structure_colors.checked_mul(8)?)?;
    let cell_buffers = cell_count.checked_mul(bytes_per_cell)?;
    let axis_buffers = width.checked_add(height)?.checked_mul(16)?;
    source_buffers
        .checked_add(cell_buffers)?
        .checked_add(axis_buffers)?
        .checked_add(4 * 1024 * 1024)
}

#[cfg(test)]
mod tests {
    use super::estimated_working_bytes;

    #[test]
    fn dense_high_color_grid_exceeds_the_bounded_working_set() {
        let bytes = estimated_working_bytes(512 * 512, 512 * 512, 64, 512, 512)
            .expect("estimate fits usize");

        assert!(bytes > 128 * 1024 * 1024);
    }

    #[test]
    fn game_sized_grid_stays_inside_the_bounded_working_set() {
        let bytes = estimated_working_bytes(1024 * 1024, 142 * 142, 64, 1024, 1024)
            .expect("estimate fits usize");

        assert!(bytes < 128 * 1024 * 1024);
    }
}

fn pyround(value: f64) -> f64 {
    value.round_ties_even()
}

pub fn two_stage_pack(
    rgba: &[u8],
    width: usize,
    height: usize,
    cols: usize,
    rows: usize,
    structure_colors: usize,
) -> Reconstruction {
    let (labels, label_count) = crate::kmeans::kmeans_labels(rgba, width, height, structure_colors);
    let label_count = label_count.max(1);
    let cell_count = cols * rows;
    let cell_width = width as f64 / cols as f64;
    let cell_height = height as f64 / rows as f64;

    let mut cell_x = vec![0usize; width];
    let mut weight_x = vec![0f64; width];
    for x in 0..width {
        let column = ((x * cols) / width).min(cols - 1);
        cell_x[x] = column;
        let position = (x as f64 + 0.5 - column as f64 * cell_width) / cell_width;
        // Dense grids can put source-pixel centres just outside an even-grid
        // cell. A negative triangular weight extrapolates colors instead of
        // averaging them, so it must contribute zero weight.
        weight_x[x] = (1.0 - 2.0 * (position - 0.5).abs()).max(0.0);
    }
    let mut cell_y = vec![0usize; height];
    let mut weight_y = vec![0f64; height];
    for y in 0..height {
        let row = ((y * rows) / height).min(rows - 1);
        cell_y[y] = row;
        let position = (y as f64 + 0.5 - row as f64 * cell_height) / cell_height;
        weight_y[y] = (1.0 - 2.0 * (position - 0.5).abs()).max(0.0);
    }

    // Structure stage: each output cell votes for one clean k-means label.
    let mut label_weights = vec![0f64; cell_count * label_count];
    for y in 0..height {
        for x in 0..width {
            let source_index = y * width + x;
            let cell = cell_y[y] * cols + cell_x[x];
            let weight = weight_y[y] * weight_x[x] + 1e-4;
            label_weights[cell * label_count + labels[source_index] as usize] += weight;
        }
    }
    let mut winning_label = vec![0u32; cell_count];
    for (cell, winning) in winning_label.iter_mut().enumerate().take(cell_count) {
        let base = cell * label_count;
        let mut best_label = 0usize;
        let mut best_weight = label_weights[base];
        for label in 1..label_count {
            if label_weights[base + label] > best_weight {
                best_weight = label_weights[base + label];
                best_label = label;
            }
        }
        *winning = best_label as u32;
    }

    // Color stage: average original colors that carry the winning label.
    let mut color_sum = vec![[0f64; 3]; cell_count];
    let mut color_weight = vec![0f64; cell_count];
    let mut selected_count = vec![0f64; cell_count];
    let mut pixel_count = vec![0f64; cell_count];
    let mut fallback_sum = vec![[0f64; 3]; cell_count];
    let mut transparent_fallback_sum = vec![[0f64; 3]; cell_count];
    let mut opaque_count = vec![0f64; cell_count];
    for y in 0..height {
        for x in 0..width {
            let source_index = y * width + x;
            let source_offset = source_index * 4;
            let cell = cell_y[y] * cols + cell_x[x];
            let weight = weight_y[y] * weight_x[x] + 1e-4;
            let rgb = [
                rgba[source_offset] as f64 / 255.0,
                rgba[source_offset + 1] as f64 / 255.0,
                rgba[source_offset + 2] as f64 / 255.0,
            ];
            pixel_count[cell] += 1.0;
            for channel in 0..3 {
                transparent_fallback_sum[cell][channel] += rgb[channel];
            }
            let is_opaque = rgba[source_offset + 3] > 127;
            if is_opaque {
                opaque_count[cell] += 1.0;
                for channel in 0..3 {
                    fallback_sum[cell][channel] += rgb[channel];
                }
            }
            if is_opaque && labels[source_index] == winning_label[cell] {
                selected_count[cell] += 1.0;
                color_weight[cell] += weight;
                for channel in 0..3 {
                    color_sum[cell][channel] += rgb[channel] * weight;
                }
            }
        }
    }

    let mut output = vec![0u8; cell_count * 4];
    for cell in 0..cell_count {
        let color = if selected_count[cell] >= 0.5 && color_weight[cell] > 1e-9 {
            [
                color_sum[cell][0] / color_weight[cell],
                color_sum[cell][1] / color_weight[cell],
                color_sum[cell][2] / color_weight[cell],
            ]
        } else {
            if opaque_count[cell] > 0.0 {
                [
                    fallback_sum[cell][0] / opaque_count[cell],
                    fallback_sum[cell][1] / opaque_count[cell],
                    fallback_sum[cell][2] / opaque_count[cell],
                ]
            } else {
                let count = pixel_count[cell].max(1.0);
                [
                    transparent_fallback_sum[cell][0] / count,
                    transparent_fallback_sum[cell][1] / count,
                    transparent_fallback_sum[cell][2] / count,
                ]
            }
        };
        for channel in 0..3 {
            output[cell * 4 + channel] = pyround(color[channel] * 255.0).clamp(0.0, 255.0) as u8;
        }
        output[cell * 4 + 3] = if opaque_count[cell] / pixel_count[cell].max(1.0) > 0.5 {
            255
        } else {
            0
        };
    }

    Reconstruction {
        rgba: output,
        cols,
        rows,
    }
}
