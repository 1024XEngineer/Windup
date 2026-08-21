# Python binding

PyO3 binding for the independent detector and reconstructor crates. It exposes only two byte-oriented functions:

```python
detect(source, mode="full")
reconstruct(source, cols, rows, colors)
```

For local development, install the extension into the active backend environment:

```bash
uv tool run --from maturin==1.14.1 maturin develop --release --locked
```

The Rust computation detaches from the Python interpreter. Input validation errors are raised as `ValueError`; loading and output validation remain the responsibility of the Python adapter.
