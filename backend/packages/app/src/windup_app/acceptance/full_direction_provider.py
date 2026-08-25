"""使用生产 ImageGateway 生成八个真实方向并保存验收证据。"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from PIL import Image, UnidentifiedImageError

from windup_common.directions import ActionDirection, direction_prompt
from windup_framework.config.provider import AIProviderSettings
from windup_framework.gateway import build_image_gateway, fresh_gateway_request


class AcceptanceConfigurationError(RuntimeError):
    """验收未取得付费授权或缺少真实 Provider 配置。"""


@dataclass(frozen=True)
class ImageInspection:
    format: str
    width: int
    height: int
    byte_count: int
    sha256: str


_EXTENSIONS = {
    "JPEG": ".jpg",
    "PNG": ".png",
    "WEBP": ".webp",
}


def require_live_configuration(
    settings: AIProviderSettings,
    *,
    allow_spend: bool,
) -> None:
    """在任何网络请求前阻止误触付费任务或空凭据调用。"""

    if not allow_spend:
        raise AcceptanceConfigurationError(
            "真实八方向验收会产生最多八次图片生成费用；请明确传入 --allow-spend"
        )
    if not settings.effective_route_primary_api_key.strip():
        raise AcceptanceConfigurationError(
            "未配置真实 Provider 凭据；请设置 AI_API_KEY 或 AI_ROUTE_PRIMARY_API_KEY"
        )
    if not settings.effective_route_primary_base_url.strip():
        raise AcceptanceConfigurationError("未配置 AI_BASE_URL")
    if not settings.image_model.strip():
        raise AcceptanceConfigurationError("未配置 AI_IMAGE_MODEL")


def inspect_image(body: bytes) -> ImageInspection:
    """确认 Provider 返回的是可完整解码的图片并记录不可抵赖摘要。"""

    try:
        with Image.open(io.BytesIO(body)) as image:
            image_format = image.format or ""
            width, height = image.size
            image.verify()
    except (UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise ValueError("Provider 返回内容无法解码为图片") from exc

    if image_format not in _EXTENSIONS:
        raise ValueError(
            f"Provider 返回了不支持的图片格式：{image_format or 'unknown'}"
        )
    if width <= 0 or height <= 0:
        raise ValueError(f"Provider 返回了无效图片尺寸：{width}x{height}")

    return ImageInspection(
        format=image_format,
        width=width,
        height=height,
        byte_count=len(body),
        sha256=hashlib.sha256(body).hexdigest(),
    )


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _provider_origin(settings: AIProviderSettings) -> str:
    parsed = urlsplit(settings.effective_route_primary_base_url)
    return f"{parsed.scheme}://{parsed.netloc}"


def _prompt(base_prompt: str, direction: ActionDirection) -> str:
    return " ".join(
        (
            base_prompt.strip(),
            "2D game character sprite, full body head to feet, centered.",
            direction_prompt(direction),
            "Plain light-gray background, no shadow.",
        )
    )


def _write_manifest(path: Path, manifest: dict) -> None:
    path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def run_live_acceptance(
    settings: AIProviderSettings,
    *,
    allow_spend: bool,
    base_prompt: str,
    output_dir: Path,
) -> Path:
    """顺序调用八次生产图片网关，产物与摘要写入本地忽略目录。"""

    require_live_configuration(settings, allow_spend=allow_spend)
    settings = settings.model_copy(update={"gateway_ledger_enabled": False})
    output_dir.mkdir(parents=True, exist_ok=False)
    manifest_path = output_dir / "manifest.json"
    directions = tuple(ActionDirection)
    manifest: dict = {
        "schema_version": 1,
        "status": "running",
        "started_at": _utc_now(),
        "completed_at": None,
        "provider_origin": _provider_origin(settings),
        "image_model": settings.image_model,
        "gateway_ledger_enabled": settings.gateway_ledger_enabled,
        "expected_directions": [direction.value for direction in directions],
        "base_prompt": base_prompt,
        "results": [],
    }
    _write_manifest(manifest_path, manifest)

    try:
        gateway = build_image_gateway(settings)
        for direction in directions:
            prompt = _prompt(base_prompt, direction)
            reset = fresh_gateway_request(task_id=f"acceptance-{direction.value}")
            try:
                body = gateway.gen_image(prompt, [])
            finally:
                reset()

            inspection = inspect_image(body)
            filename = f"{direction.value}{_EXTENSIONS[inspection.format]}"
            (output_dir / filename).write_bytes(body)
            manifest["results"].append(
                {
                    "direction": direction.value,
                    "filename": filename,
                    "prompt": prompt,
                    **asdict(inspection),
                }
            )
            _write_manifest(manifest_path, manifest)

        hashes = [item["sha256"] for item in manifest["results"]]
        if len(set(hashes)) != len(directions):
            raise RuntimeError("真实 Provider 返回了内容完全相同的方向图片")
    except Exception as exc:
        manifest["status"] = "failed"
        manifest["completed_at"] = _utc_now()
        manifest["error_type"] = type(exc).__name__
        _write_manifest(manifest_path, manifest)
        raise

    manifest["status"] = "awaiting_visual_review"
    manifest["completed_at"] = _utc_now()
    _write_manifest(manifest_path, manifest)
    return manifest_path


def _default_output_dir() -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return Path("output") / "full-direction-provider" / stamp


def main() -> None:
    parser = argparse.ArgumentParser(
        description="调用生产 ImageGateway 生成八个真实方向并保存本地验收证据",
    )
    parser.add_argument(
        "--allow-spend",
        action="store_true",
        help="确认允许八个方向分别调用图片 Provider；网关重试或回退可能增加调用次数",
    )
    parser.add_argument(
        "--prompt",
        default="An original heroic adventurer wearing a blue travel cloak.",
        help="八个方向共用的角色描述",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="本地验收产物目录；默认写入被 Git 忽略的 output/",
    )
    args = parser.parse_args()

    try:
        manifest = run_live_acceptance(
            AIProviderSettings(),
            allow_spend=args.allow_spend,
            base_prompt=args.prompt,
            output_dir=args.output_dir or _default_output_dir(),
        )
    except AcceptanceConfigurationError as exc:
        parser.error(str(exc))
    print(f"八方向真实 Provider 产物已生成，等待人工视觉复核：{manifest}")


if __name__ == "__main__":
    main()
