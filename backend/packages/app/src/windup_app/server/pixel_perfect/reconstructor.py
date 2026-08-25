"""显式规则网格重建器。

两阶段结构投票与原色恢复源自 Retro-Diffusion/pixel-art-fixer 的 MIT 实现，
固定参考提交 ``ef376e57e1c272633ca2dbf5f29ec3fcf6596465``。这里保留显式网格
重建，不包含网格检测、生成管线或业务存储。
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from io import BytesIO

import numpy as np
from PIL import Image, UnidentifiedImageError

MAX_INPUT_PIXELS = 4_000_000
MAX_INPUT_BYTES = 32 * 1024 * 1024
MAX_WORKING_BYTES = 128 * 1024 * 1024
MIN_INPUT_SIDE = 16
_SAMPLE_LIMIT = 60_000
_ASSIGNMENT_CHUNK = 65_536
_TRAINING_CHUNK = 8_192
_COLOR_LOOKUP_BYTES = 1 << 24
_WORKING_RESERVE_BYTES = 12 * 1024 * 1024


class ReconstructorError(ValueError):
    """输入或资源边界不满足显式网格重建契约。"""


@dataclass(frozen=True, slots=True)
class ReconstructedImage:
    png: bytes
    width: int
    height: int
    visible_color_count: int


class _XorShift64Star:
    """与固定上游实现一致的确定性 k-means++ 随机序列。"""

    _MASK = (1 << 64) - 1

    def __init__(self, seed: int) -> None:
        self._state = max(seed, 1) & self._MASK

    def next_u64(self) -> int:
        value = self._state
        value ^= value >> 12
        value ^= (value << 25) & self._MASK
        value ^= value >> 27
        self._state = value & self._MASK
        return (self._state * 0x2545F4914F6CDD1D) & self._MASK

    def next_float(self) -> float:
        return (self.next_u64() >> 11) / float(1 << 53)

    def below(self, limit: int) -> int:
        return int(self.next_float() * limit) % max(limit, 1)


def reconstruct_bytes(
    source: bytes,
    cols: int,
    rows: int,
    structure_colors: int,
) -> ReconstructedImage:
    """把 PNG/JPEG 按调用方给定网格重建为每格单色的 1x PNG。"""

    rgba = _decode_source(source, cols, rows, structure_colors)
    reconstructed = _two_stage_pack(rgba, cols, rows, structure_colors)
    output = Image.fromarray(reconstructed, "RGBA")
    encoded = BytesIO()
    output.save(encoded, format="PNG")
    visible = reconstructed[reconstructed[:, :, 3] > 0, :3]
    visible_color_count = len(np.unique(visible, axis=0)) if len(visible) else 0
    return ReconstructedImage(
        png=encoded.getvalue(),
        width=cols,
        height=rows,
        visible_color_count=visible_color_count,
    )


def _decode_source(
    source: bytes,
    cols: int,
    rows: int,
    structure_colors: int,
) -> np.ndarray:
    if len(source) > MAX_INPUT_BYTES:
        raise ReconstructorError(f"encoded input exceeds {MAX_INPUT_BYTES} bytes")
    try:
        image = Image.open(BytesIO(source))
    except (UnidentifiedImageError, OSError) as error:
        raise ReconstructorError("input must be PNG or JPEG") from error
    if image.format not in {"PNG", "JPEG"}:
        raise ReconstructorError("input must be PNG or JPEG")

    width, height = image.size
    if min(width, height) < MIN_INPUT_SIDE:
        raise ReconstructorError(
            f"image is too small (minimum side is {MIN_INPUT_SIDE}px)"
        )
    pixel_count = width * height
    if pixel_count > MAX_INPUT_PIXELS:
        raise ReconstructorError(
            f"image is too large (maximum is {MAX_INPUT_PIXELS} pixels)"
        )
    if cols <= 0 or rows <= 0 or cols > width or rows > height:
        raise ReconstructorError(
            f"grid must be within source bounds (received {cols}x{rows} "
            f"for {width}x{height})"
        )
    if not 2 <= structure_colors <= 64:
        raise ReconstructorError("structure colors must be between 2 and 64")
    working_bytes = _estimated_working_bytes(
        pixel_count, cols * rows, structure_colors, width, height
    )
    if working_bytes > MAX_WORKING_BYTES:
        raise ReconstructorError(
            f"reconstruction working set exceeds {MAX_WORKING_BYTES} bytes"
        )
    try:
        return np.asarray(image.convert("RGBA"), dtype=np.uint8)
    except (OSError, ValueError) as error:
        raise ReconstructorError(f"cannot decode PNG/JPEG image: {error}") from error
    finally:
        image.close()


def _estimated_working_bytes(
    source_pixels: int,
    cell_count: int,
    structure_colors: int,
    width: int,
    height: int,
) -> int:
    # Python 版同时持有 RGBA、标签/颜色编码、规则网格和分块距离缓冲。
    source_buffers = source_pixels * 48
    bytes_per_cell = 96 + structure_colors * 8
    cell_buffers = cell_count * bytes_per_cell
    axis_buffers = (width + height) * 16
    return (
        source_buffers
        + cell_buffers
        + axis_buffers
        + _COLOR_LOOKUP_BYTES
        + _WORKING_RESERVE_BYTES
    )


def _even_sample_indices(length: int, maximum: int) -> np.ndarray:
    if length <= maximum:
        return np.arange(length, dtype=np.int64)
    positions = np.arange(maximum, dtype=np.float64)
    return np.floor(positions * (length - 1) / (maximum - 1)).astype(np.int64)


def _pack_rgb(points: np.ndarray) -> np.ndarray:
    values = points.astype(np.uint32, copy=False)
    return (values[:, 0] << 16) | (values[:, 1] << 8) | values[:, 2]


def _unpack_rgb(values: np.ndarray) -> np.ndarray:
    return np.column_stack(
        ((values >> 16) & 255, (values >> 8) & 255, values & 255)
    ).astype(np.float32)


def _squared_distances(points: np.ndarray, centers: np.ndarray) -> np.ndarray:
    """按 Rust 顺序先做 float32 差值，再以 float64 累加平方。"""

    difference = points[:, 0, None] - centers[None, :, 0]
    distances = difference.astype(np.float64)
    np.square(distances, out=distances)
    for channel in (1, 2):
        difference = points[:, channel, None] - centers[None, :, channel]
        distances += difference.astype(np.float64) ** 2
    return distances


def _distance_to_center(points: np.ndarray, center: np.ndarray) -> np.ndarray:
    difference = points - center
    return np.einsum("ij,ij->i", difference, difference, dtype=np.float64)


def _assign_labels(points: np.ndarray, centers: np.ndarray) -> np.ndarray:
    labels = np.empty(len(points), dtype=np.uint8)
    for start in range(0, len(points), _ASSIGNMENT_CHUNK):
        block = points[start : start + _ASSIGNMENT_CHUNK]
        difference = block[:, 0, None] - centers[None, :, 0]
        distances = difference * difference
        for channel in (1, 2):
            difference = block[:, channel, None] - centers[None, :, channel]
            distances += difference * difference
        labels[start : start + len(block)] = np.argmin(distances, axis=1)
    return labels


def _assign_training_labels(points: np.ndarray, centers: np.ndarray) -> np.ndarray:
    labels = np.empty(len(points), dtype=np.int32)
    for start in range(0, len(points), _TRAINING_CHUNK):
        block = points[start : start + _TRAINING_CHUNK]
        labels[start : start + len(block)] = np.argmin(
            _squared_distances(block, centers), axis=1
        )
    return labels


def _kmeans(sample: np.ndarray, cluster_count: int) -> np.ndarray:
    # 同色点共享距离结果；inverse/counts 保留原采样顺序和重复权重，因而不改变
    # k-means++ 的确定性选点或 Lloyd 更新结果。
    sample_codes = _pack_rgb(sample)
    unique_codes, inverse, counts = np.unique(
        sample_codes,
        return_inverse=True,
        return_counts=True,
    )
    points = _unpack_rgb(unique_codes)
    cluster_count = max(1, min(cluster_count, len(points)))
    point_weights = counts.astype(np.float64)

    rng = _XorShift64Star(42)
    centers = [points[inverse[rng.below(len(inverse))]]]
    nearest = _distance_to_center(points, centers[0])
    while len(centers) < cluster_count:
        cumulative = np.cumsum(nearest[inverse], dtype=np.float64)
        total = float(cumulative[-1])
        if total > 0:
            target = rng.next_float() * total
            pick = min(int(np.searchsorted(cumulative, target)), len(inverse) - 1)
            center = points[inverse[pick]]
        else:
            center = points[inverse[rng.below(len(inverse))]]
        centers.append(center)
        candidate = _distance_to_center(points, center)
        nearest = np.minimum(nearest, candidate)

    current = np.asarray(centers, dtype=np.float32)
    for _ in range(15):
        labels = _assign_training_labels(points, current)
        cluster_weights = np.bincount(
            labels,
            weights=point_weights,
            minlength=cluster_count,
        )
        updated = current.copy()
        empty_clusters = np.flatnonzero(cluster_weights == 0)
        sums_by_channel = [
            np.bincount(
                labels,
                weights=points[:, channel] * point_weights,
                minlength=cluster_count,
            )
            for channel in range(3)
        ]
        if not len(empty_clusters):
            for channel, sums in enumerate(sums_by_channel):
                updated[:, channel] = sums / cluster_weights
        else:
            for cluster in range(cluster_count):
                if cluster_weights[cluster] > 0:
                    updated[cluster] = [
                        sums[cluster] / cluster_weights[cluster]
                        for sums in sums_by_channel
                    ]
                    continue
                assigned = updated[labels]
                differences = points - assigned
                distances = np.einsum(
                    "ij,ij->i",
                    differences,
                    differences,
                    dtype=np.float64,
                )
                farthest = int(np.argmax(distances[inverse]))
                updated[cluster] = points[inverse[farthest]]
        shift = _squared_distances(updated, current).diagonal().max(initial=0.0)
        current = updated
        if not len(empty_clusters) and shift <= 0.25:
            break
    return current


def _kmeans_labels(rgba: np.ndarray, structure_colors: int) -> np.ndarray:
    flat_rgba = rgba.reshape(-1, 4)
    visible_indexes = np.flatnonzero(flat_rgba[:, 3] > 0)
    source_indexes = (
        visible_indexes
        if len(visible_indexes)
        else np.arange(len(flat_rgba), dtype=np.int64)
    )
    sample_positions = _even_sample_indices(len(source_indexes), _SAMPLE_LIMIT)
    sample = flat_rgba[source_indexes[sample_positions], :3].astype(np.float32)
    cluster_count = max(1, min(structure_colors, len(sample)))
    centers = _kmeans(sample, cluster_count)

    all_codes = _pack_rgb(flat_rgba[:, :3])
    unique_codes = np.unique(all_codes)
    unique_labels = _assign_labels(_unpack_rgb(unique_codes), centers)
    # 24-bit RGB 查表固定占用 16 MiB，避免为百万像素重复计算相同颜色的距离。
    lookup = np.empty(_COLOR_LOOKUP_BYTES, dtype=np.uint8)
    lookup[unique_codes] = unique_labels
    return lookup[all_codes]


@lru_cache(maxsize=1)
def _grid_geometry(
    width: int, height: int, cols: int, rows: int
) -> tuple[np.ndarray, np.ndarray]:
    # 动画帧通常复用尺寸与网格；只保留最近一组只读几何，限制常驻内存。
    cell_x = ((np.arange(width, dtype=np.int64) * cols) // width).astype(np.int32)
    cell_y = ((np.arange(height, dtype=np.int64) * rows) // height).astype(np.int32)
    cell_dtype = np.uint16 if cols * rows <= np.iinfo(np.uint16).max else np.uint32
    cell = (cell_y[:, None] * cols + cell_x[None, :]).astype(cell_dtype).ravel()
    cell_width = width / cols
    cell_height = height / rows
    position_x = (
        np.arange(width, dtype=np.float64) + 0.5 - cell_x * cell_width
    ) / cell_width
    position_y = (
        np.arange(height, dtype=np.float64) + 0.5 - cell_y * cell_height
    ) / cell_height
    weight_x = np.maximum(1.0 - 2.0 * np.abs(position_x - 0.5), 0.0)
    weight_y = np.maximum(1.0 - 2.0 * np.abs(position_y - 0.5), 0.0)
    weights = (weight_y[:, None] * weight_x[None, :]).ravel() + 1e-4
    cell.flags.writeable = False
    weights.flags.writeable = False
    return cell, weights


def _two_stage_pack(
    rgba: np.ndarray,
    cols: int,
    rows: int,
    structure_colors: int,
) -> np.ndarray:
    height, width = rgba.shape[:2]
    labels = _kmeans_labels(rgba, structure_colors)
    label_count = max(int(labels.max(initial=0)) + 1, 1)
    cell_count = cols * rows
    cell, weights = _grid_geometry(width, height, cols, rows)

    flat = rgba.reshape(-1, 4)
    vote_bin_count = cell_count * label_count
    label_weights = np.zeros(vote_bin_count, dtype=np.float64)
    for start in range(0, len(cell), _ASSIGNMENT_CHUNK * 2):
        stop = min(start + _ASSIGNMENT_CHUNK * 2, len(cell))
        compound = (
            cell[start:stop].astype(np.uint32) * np.uint32(label_count)
            + labels[start:stop]
        )
        label_weights += np.bincount(
            compound,
            weights=weights[start:stop],
            minlength=vote_bin_count,
        )
    label_weights = label_weights.reshape(cell_count, label_count)
    winning_label = np.argmax(label_weights, axis=1)
    del compound, label_weights

    visible = flat[:, 3] > 127
    selected = labels == winning_label[cell]
    output_rgb = np.zeros((cell_count, 3), dtype=np.float64)
    if width % cols == 0 and height % rows == 0:
        cell_width = width // cols
        cell_height = height // rows
        weighted_selected = (weights * selected).reshape(
            rows, cell_height, cols, cell_width
        )
        weighted_selected = weighted_selected.transpose(0, 2, 1, 3)
        color_weight = weighted_selected.sum(axis=(2, 3), dtype=np.float64).ravel()
        for channel in range(3):
            channel_grid = flat[:, channel].reshape(rows, cell_height, cols, cell_width)
            channel_grid = channel_grid.transpose(0, 2, 1, 3)
            output_rgb[:, channel] = ((channel_grid / 255.0) * weighted_selected).sum(
                axis=(2, 3), dtype=np.float64
            ).ravel() / np.maximum(color_weight, 1e-9)
        visible_count = (
            visible.reshape(rows, cell_height, cols, cell_width)
            .sum(axis=(1, 3))
            .ravel()
        )
    else:
        selected_weight = weights[selected]
        selected_cells = cell[selected]
        color_weight = np.bincount(
            selected_cells, weights=selected_weight, minlength=cell_count
        )
        for channel in range(3):
            output_rgb[:, channel] = np.bincount(
                selected_cells,
                weights=(flat[selected, channel] / 255.0) * selected_weight,
                minlength=cell_count,
            ) / np.maximum(color_weight, 1e-9)
        visible_count = np.bincount(cell[visible], minlength=cell_count)

    missing = color_weight <= 1e-9
    if np.any(missing):
        fallback = np.zeros((cell_count, 3), dtype=np.float64)
        missing_pixels = missing[cell]
        missing_cells = cell[missing_pixels]
        missing_count = np.bincount(missing_cells, minlength=cell_count)
        for channel in range(3):
            fallback[:, channel] = np.bincount(
                missing_cells,
                weights=flat[missing_pixels, channel] / 255.0,
                minlength=cell_count,
            ) / np.maximum(missing_count, 1)
        output_rgb[missing] = fallback[missing]

    pixel_count = np.bincount(cell, minlength=cell_count)
    alpha = (visible_count / np.maximum(pixel_count, 1) > 0.5).astype(np.uint8) * 255
    output = np.empty((cell_count, 4), dtype=np.uint8)
    output[:, :3] = np.clip(np.rint(output_rgb * 255.0), 0, 255).astype(np.uint8)
    output[:, 3] = alpha
    return output.reshape(rows, cols, 4)
