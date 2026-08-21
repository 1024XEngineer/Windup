use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::{PyBytes, PyDict, PyModule};
use windup_pixel_grid_detector::{detect_bytes, DetectorMode};
use windup_pixel_grid_reconstructor::reconstruct_bytes;

#[pyfunction]
#[pyo3(signature = (source, mode = "full"))]
fn detect<'py>(
    py: Python<'py>,
    source: &Bound<'py, PyBytes>,
    mode: &str,
) -> PyResult<Bound<'py, PyDict>> {
    let detector_mode = match mode {
        "full" => DetectorMode::Full,
        "fast" => DetectorMode::Fast,
        _ => return Err(PyValueError::new_err("mode must be 'full' or 'fast'")),
    };
    // The Python buffer cannot be borrowed while the interpreter is detached.
    let input = source.as_bytes().to_vec();
    let result = py
        .detach(move || detect_bytes(&input, detector_mode))
        .map_err(|error| PyValueError::new_err(error.to_string()))?;

    let payload = PyDict::new(py);
    payload.set_item("cols", result.cols)?;
    payload.set_item("rows", result.rows)?;
    payload.set_item("step_x", result.step_x)?;
    payload.set_item("step_y", result.step_y)?;
    payload.set_item("consensus", result.consensus)?;
    payload.set_item("confidence", result.confidence)?;
    Ok(payload)
}

#[pyfunction]
fn reconstruct<'py>(
    py: Python<'py>,
    source: &Bound<'py, PyBytes>,
    cols: usize,
    rows: usize,
    colors: usize,
) -> PyResult<Bound<'py, PyBytes>> {
    let input = source.as_bytes().to_vec();
    let result = py
        .detach(move || reconstruct_bytes(&input, cols, rows, colors))
        .map_err(|error| PyValueError::new_err(error.to_string()))?;
    Ok(PyBytes::new(py, &result.png))
}

#[pymodule]
fn windup_pixel_perfect_native(module: &Bound<'_, PyModule>) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(detect, module)?)?;
    module.add_function(wrap_pyfunction!(reconstruct, module)?)?;
    Ok(())
}
