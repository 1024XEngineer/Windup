//! Signal-processing helpers mirroring the scipy pieces the detector uses:
//! percentile, profile normalisation, gaussian_filter1d, find_peaks
//! (height + distance), 1-D median filter (mode="nearest").

/// numpy linear-interpolation percentile (q in [0,100]).
pub fn percentile(values: &[f64], q: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut v = values.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let pos = q / 100.0 * (v.len() as f64 - 1.0);
    let lo = pos.floor() as usize;
    let hi = pos.ceil() as usize;
    let f = pos - lo as f64;
    v[lo] + (v[hi] - v[lo]) * f
}

/// channels.py _normalise: clip(profile / (p95_interior + 1e-9), 0, 1.5)
pub fn normalise(profile: &[f64]) -> Vec<f64> {
    let n = profile.len();
    if n <= 2 {
        return profile.to_vec();
    }
    let interior = &profile[1..n - 1];
    let mut scale = percentile(interior, 95.0);
    if scale <= 0.0 {
        let m = interior.iter().cloned().fold(f64::MIN, f64::max);
        scale = if m > 0.0 { m } else { 1.0 };
    }
    profile
        .iter()
        .map(|&v| (v / (scale + 1e-9)).clamp(0.0, 1.5))
        .collect()
}

/// scipy gaussian_filter1d(sigma, truncate=4.0, mode="reflect").
pub fn gaussian_filter1d(x: &[f64], sigma: f64) -> Vec<f64> {
    let radius = (4.0 * sigma + 0.5) as i64;
    let mut kern: Vec<f64> = (-radius..=radius)
        .map(|i| (-0.5 * (i as f64 / sigma).powi(2)).exp())
        .collect();
    let s: f64 = kern.iter().sum();
    for k in kern.iter_mut() {
        *k /= s;
    }
    let n = x.len() as i64;
    let refl = |mut i: i64| -> usize {
        // scipy "reflect": (d c b a | a b c d | d c b a)
        loop {
            if i < 0 {
                i = -i - 1;
            } else if i >= n {
                i = 2 * n - 1 - i;
            } else {
                return i as usize;
            }
        }
    };
    (0..n)
        .map(|i| {
            let mut acc = 0f64;
            for (j, &kv) in kern.iter().enumerate() {
                // scipy correlate1d applies weights reversed relative to
                // convolution; the gaussian kernel is symmetric so it
                // doesn't matter
                acc += kv * x[refl(i + j as i64 - radius)];
            }
            acc
        })
        .collect()
}

/// scipy find_peaks with `height` and `distance`. Returns (positions,
/// heights). Plateau peaks resolve to the plateau midpoint like scipy.
pub fn find_peaks(x: &[f64], height: f64, distance: f64) -> (Vec<usize>, Vec<f64>) {
    let n = x.len();
    let mut peaks: Vec<usize> = Vec::new();
    let mut i = 1usize;
    while n >= 3 && i < n - 1 {
        if x[i - 1] < x[i] {
            let mut ahead = i + 1;
            while ahead < n - 1 && x[ahead] == x[i] {
                ahead += 1;
            }
            if x[ahead] < x[i] {
                let left = i;
                let right = ahead - 1;
                peaks.push((left + right) / 2);
                i = ahead;
                continue;
            }
        }
        i += 1;
    }
    // height filter first (scipy order)
    let mut kept: Vec<usize> = peaks.into_iter().filter(|&p| x[p] >= height).collect();
    // distance filter: highest priority first, remove neighbours closer
    // than ceil(distance)
    if distance > 1.0 && kept.len() > 1 {
        let dmin = distance.ceil();
        let m = kept.len();
        let mut keep = vec![true; m];
        let mut priority: Vec<usize> = (0..m).collect();
        priority.sort_by(|&a, &b| x[kept[a]].partial_cmp(&x[kept[b]]).unwrap());
        for pi in (0..m).rev() {
            let j = priority[pi];
            if !keep[j] {
                continue;
            }
            let mut k = j as i64 - 1;
            while k >= 0 && (kept[j] - kept[k as usize]) < dmin as usize {
                keep[k as usize] = false;
                k -= 1;
            }
            let mut k = j + 1;
            while k < m && (kept[k] - kept[j]) < dmin as usize {
                keep[k] = false;
                k += 1;
            }
        }
        kept = kept
            .into_iter()
            .zip(keep)
            .filter(|&(_, k)| k)
            .map(|(p, _)| p)
            .collect();
    }
    let heights: Vec<f64> = kept.iter().map(|&p| x[p]).collect();
    (kept, heights)
}

/// scipy.ndimage.median_filter 1-D, mode="nearest", odd size.
pub fn median_filter1d(x: &[f64], size: usize) -> Vec<f64> {
    let n = x.len();
    let half = size as i64 / 2;
    let mut buf = vec![0f64; size];
    (0..n as i64)
        .map(|i| {
            for (bi, k) in (-half..=half).enumerate() {
                let j = (i + k).clamp(0, n as i64 - 1) as usize;
                buf[bi] = x[j];
            }
            buf.sort_by(|a, b| a.partial_cmp(b).unwrap());
            buf[size / 2]
        })
        .collect()
}

/// np.median
pub fn median(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut v = values.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        0.5 * (v[n / 2 - 1] + v[n / 2])
    }
}

/// np.interp with clamped ends (xp ascending).
pub fn interp(x: f64, xp: &[f64], fp: &[f64]) -> f64 {
    let n = xp.len();
    if x <= xp[0] {
        return fp[0];
    }
    if x >= xp[n - 1] {
        return fp[n - 1];
    }
    let mut lo = 0usize;
    let mut hi = n - 1;
    while hi - lo > 1 {
        let mid = (lo + hi) / 2;
        if xp[mid] <= x {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let f = (x - xp[lo]) / (xp[hi] - xp[lo]);
    fp[lo] * (1.0 - f) + fp[hi] * f
}
