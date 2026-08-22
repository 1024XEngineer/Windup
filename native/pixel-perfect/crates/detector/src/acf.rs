//! Banded autocorrelation / cepstrum machinery. Mirrors detector/autocorr.py
//! (band_profiles, band_acf, band_cepstrum, comb scores, train_quality,
//! refine_step_acf, ceps_score).

use rustfft::num_complex::Complex;
use rustfft::FftPlanner;

pub const MIN_STEP: f64 = 2.0;
pub const MAX_STEP: f64 = 24.0;
pub const STEP_GRID: f64 = 0.02;
pub const BAND: usize = 24;

/// Sum feature map (row-major, lines x extent) over groups of `band` lines.
/// Returns (n_bands, extent) profiles.
pub fn band_profiles(feat: &[f32], lines: usize, extent: usize, band: usize) -> Vec<Vec<f64>> {
    let nb = std::cmp::max(1, lines / band);
    let group = if lines >= band { band } else { lines };
    let mut out = vec![vec![0f64; extent]; nb];
    for b in 0..nb {
        let dst = &mut out[b];
        for r in 0..group {
            let row = (b * group + r) * extent;
            for x in 0..extent {
                dst[x] += feat[row + x] as f64;
            }
        }
        // the reference accumulates in float32; round through f32 so the
        // FFT sees the same profile values (razor-thin comb ties flip on
        // less than this)
        for v in dst.iter_mut() {
            *v = *v as f32 as f64;
        }
    }
    out
}

fn next_pow2(n: usize) -> usize {
    let mut p = 1;
    while p < n {
        p <<= 1;
    }
    p
}

/// Mean unbiased ACF over band profiles, ac[0] == 1. `prof` rows share length n.
pub fn band_acf(prof: &[Vec<f64>], planner: &mut FftPlanner<f64>) -> Vec<f64> {
    let n = prof[0].len();
    let nfft = next_pow2(2 * n);
    let fft = planner.plan_fft_forward(nfft);
    let ifft = planner.plan_fft_inverse(nfft);
    let half = nfft / 2;

    // accumulate per-band power spectra (each normalised by its own
    // half-spectrum power, matching numpy's rfft-bin normalisation)
    let mut psum = vec![0f64; nfft];
    let mut buf = vec![Complex::new(0f64, 0f64); nfft];
    for row in prof {
        let mean = (row.iter().sum::<f64>() / n as f64) as f32;
        for c in buf.iter_mut() {
            *c = Complex::new(0.0, 0.0);
        }
        for (i, &v) in row.iter().enumerate() {
            buf[i] = Complex::new((v as f32 - mean) as f64, 0.0);
        }
        fft.process(&mut buf);
        let mut ssum = 0f64;
        for k in 0..=half {
            ssum += buf[k].norm_sqr();
        }
        let ssum = ssum.max(1e-12);
        for k in 0..=half {
            let p = buf[k].norm_sqr() / ssum;
            psum[k] += p;
            if k != 0 && k != half {
                psum[nfft - k] += p;
            }
        }
    }
    // one inverse FFT of the summed (Hermitian, real) spectrum
    for (k, c) in buf.iter_mut().enumerate() {
        *c = Complex::new(psum[k], 0.0);
    }
    ifft.process(&mut buf);
    let mut ac = vec![0f64; n];
    for lag in 0..n {
        let unbias = n as f64 / ((n - lag).max(1) as f64);
        ac[lag] = buf[lag].re / nfft as f64 * unbias;
    }
    let a0 = ac[0].max(1e-12);
    for v in ac.iter_mut() {
        *v /= a0;
    }
    ac
}

fn median(v: &mut [f64]) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = v.len();
    if n == 0 {
        return 0.0;
    }
    if n % 2 == 1 {
        v[n / 2]
    } else {
        0.5 * (v[n / 2 - 1] + v[n / 2])
    }
}

/// Cepstrum of the mean log power spectrum over band profiles (first n/2).
pub fn band_cepstrum(prof: &[Vec<f64>], planner: &mut FftPlanner<f64>) -> Vec<f64> {
    let n = prof[0].len();
    let nfft = next_pow2(2 * n);
    let fft = planner.plan_fft_forward(nfft);
    let ifft = planner.plan_fft_inverse(nfft);
    let half = nfft / 2;

    let mut pmean = vec![0f64; half + 1];
    let mut buf = vec![Complex::new(0f64, 0f64); nfft];
    for row in prof {
        let mean = (row.iter().sum::<f64>() / n as f64) as f32;
        for c in buf.iter_mut() {
            *c = Complex::new(0.0, 0.0);
        }
        for (i, &v) in row.iter().enumerate() {
            buf[i] = Complex::new((v as f32 - mean) as f64, 0.0);
        }
        fft.process(&mut buf);
        for k in 0..=half {
            pmean[k] += buf[k].norm_sqr();
        }
    }
    let nb = prof.len() as f64;
    let mut logp: Vec<f64> = pmean.iter().map(|&p| (p / nb + 1e-6).ln()).collect();
    let lmean = logp.iter().sum::<f64>() / logp.len() as f64;
    for v in logp.iter_mut() {
        *v -= lmean;
    }
    for (k, c) in buf.iter_mut().enumerate() {
        let v = if k <= half { logp[k] } else { logp[nfft - k] };
        *c = Complex::new(v, 0.0);
    }
    ifft.process(&mut buf);
    let m = n / 2;
    let mut c: Vec<f64> = (0..m).map(|i| buf[i].re / nfft as f64).collect();
    let mut tmp = c.clone();
    let med = median(&mut tmp);
    let cm = c.iter().sum::<f64>() / m.max(1) as f64;
    let var = c.iter().map(|&v| (v - cm) * (v - cm)).sum::<f64>() / m.max(1) as f64;
    let std = var.sqrt();
    for v in c.iter_mut() {
        *v = (*v - med) / (std + 1e-12);
    }
    c
}

/// Linear interp with numpy-matching clipping: i clipped to [0, n-2],
/// fractional part NOT re-clamped (extrapolates past the end like the ref).
pub fn interp_at(arr: &[f64], pos: f64) -> f64 {
    let n = arr.len();
    let i = (pos as i64).clamp(0, n as i64 - 2) as usize;
    let f = pos - i as f64;
    arr[i] * (1.0 - f) + arr[i + 1] * f
}

/// Comb minus anti-comb on the ACF at multiples of s.
pub fn comb_score(ac: &[f64], s: f64, k_max: usize, k0: f64) -> f64 {
    let n = ac.len();
    let kf = ((n as f64 - 2.0) / s).floor() as i64;
    let kcap = std::cmp::min(kf.max(0) as usize, k_max);
    if kcap < 2 {
        return -1.0;
    }
    let mut num = 0f64;
    let mut den = 0f64;
    for k in 1..=kcap {
        let kd = k as f64;
        let w = (-(kd - 1.0) / k0).exp();
        let pk = interp_at(ac, kd * s);
        let tr = 0.5 * (interp_at(ac, (kd - 0.5) * s) + interp_at(ac, (kd + 0.5) * s));
        num += w * (pk - tr);
        den += w;
    }
    num / den
}

/// Comb sum only (no anti-comb).
pub fn plain_comb(ac: &[f64], s: f64, k_max: usize, k0: f64) -> f64 {
    let n = ac.len();
    let kf = ((n as f64 - 2.0) / s).floor() as i64;
    let kcap = std::cmp::min(kf.max(0) as usize, k_max);
    if kcap < 1 {
        return 0.0;
    }
    let mut num = 0f64;
    let mut den = 0f64;
    for k in 1..=kcap {
        let kd = k as f64;
        let w = (-(kd - 1.0) / k0).exp();
        num += w * interp_at(ac, kd * s);
        den += w;
    }
    num / den
}

/// Peak-train fit quality: coverage-weighted inlier mass * exp(-4*rms/s0).
pub fn train_quality(ac: &[f64], s0: f64, k_max: usize) -> f64 {
    let n = ac.len();
    let kf = ((n as f64 - 3.0) / s0).floor() as i64;
    let kcap = std::cmp::min(kf.max(0) as usize, k_max);
    if kcap < 2 {
        return 0.0;
    }
    let mut res: Vec<f64> = Vec::new();
    let mut mass = 0f64;
    let mut tot = 0usize;
    for k in 1..=kcap {
        let c0 = k as f64 * s0;
        let r = ((0.35 * s0) as i64).max(2) as f64;
        let lo = ((c0 - r) as i64).max(1) as usize;
        let hi = std::cmp::min(n - 2, (c0 + r).ceil() as usize);
        if hi <= lo {
            continue;
        }
        tot += 1;
        let mut i = lo;
        for j in lo..=hi {
            if ac[j] > ac[i] {
                i = j;
            }
        }
        if i <= lo || i >= hi || ac[i] <= 0.0 {
            continue;
        }
        let d = (ac[i - 1] - ac[i + 1]) / (2.0 * (ac[i - 1] - 2.0 * ac[i] + ac[i + 1]) + 1e-12);
        let p = i as f64 + d.clamp(-1.0, 1.0);
        res.push((p - c0) / s0);
        mass += ac[i];
    }
    if res.is_empty() || tot == 0 {
        return 0.0;
    }
    let rms = (res.iter().map(|r| r * r).sum::<f64>() / res.len() as f64).sqrt();
    (mass / tot as f64) * (-4.0 * rms).exp()
}

/// Refine step by robust line fit through the ACF peak-train positions.
pub fn refine_step_acf(ac: &[f64], s0: f64, k_max: usize) -> f64 {
    let n = ac.len();
    let kf = ((n as f64 - 3.0) / s0).floor() as i64;
    let kcap = std::cmp::min(kf.max(0) as usize, k_max);
    if kcap < 2 {
        return s0;
    }
    let mut pos: Vec<f64> = Vec::new();
    let mut ks: Vec<f64> = Vec::new();
    let mut wts: Vec<f64> = Vec::new();
    for k in 1..=kcap {
        let c0 = k as f64 * s0;
        let r = ((0.3 * s0) as i64).max(2) as f64;
        let lo = ((c0 - r) as i64).max(1) as usize;
        let hi = std::cmp::min(n - 2, (c0 + r).ceil() as usize);
        if hi <= lo {
            continue;
        }
        let mut i = lo;
        for j in lo..=hi {
            if ac[j] > ac[i] {
                i = j;
            }
        }
        if i <= lo || i >= hi {
            continue;
        }
        let d = (ac[i - 1] - ac[i + 1]) / (2.0 * (ac[i - 1] - 2.0 * ac[i] + ac[i + 1]) + 1e-12);
        pos.push(i as f64 + d.clamp(-1.0, 1.0));
        ks.push(k as f64);
        wts.push(ac[i].max(1e-6));
    }
    if pos.len() < 2 {
        return s0;
    }
    let mut s = s0;
    for _ in 0..3 {
        let tol = (0.3 * s0).max(1.5);
        let mut num = 0f64;
        let mut den = 0f64;
        let mut kept = 0usize;
        for j in 0..pos.len() {
            if (pos[j] - ks[j] * s).abs() <= tol {
                num += wts[j] * pos[j] * ks[j];
                den += wts[j] * ks[j] * ks[j];
                kept += 1;
            }
        }
        if kept < 2 {
            break;
        }
        s = num / den;
    }
    if !(0.8 * s0 <= s && s <= 1.25 * s0) {
        return s0;
    }
    s
}

pub fn ceps_score(c: &[f64], s: f64) -> f64 {
    let n = c.len();
    let kf = ((n as f64 - 2.0) / s).floor() as i64;
    let kcap = std::cmp::min(kf.max(0) as usize, 6);
    if kcap < 1 {
        return 0.0;
    }
    let mut num = 0f64;
    let mut den = 0f64;
    for k in 1..=kcap {
        let kd = k as f64;
        let w = (-(kd - 1.0) / 3.0).exp();
        num += w * interp_at(c, kd * s);
        den += w;
    }
    num / den
}
