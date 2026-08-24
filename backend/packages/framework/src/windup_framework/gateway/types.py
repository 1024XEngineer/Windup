from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from windup_common.enums.model import ModelErrorType


class Scene(str, Enum):
    CHAT = "chat"
    CHARACTER_IMAGE = "character_image"
    CHARACTER_ACTION = "character_action"


class Family(str, Enum):
    CHAT_COMPLETIONS = "chat.completions"
    IMAGE_CHAT_DATA_URI = "image.chat_data_uri"
    VIDEO_INPUT_REFERENCE = "video.input_reference"
    VIDEO_IMAGE_LIST = "video.image_list"


class NextStep(str, Enum):
    RETRY_SAME = "retry_same"
    FALLBACK = "fallback"
    FALLBACK_KEY = "fallback_key"
    FAIL = "fail"
    OPEN_AGGREGATOR = "open_aggregator"


@dataclass(frozen=True)
class AdapterResult:
    ok: bool
    body: bytes = b""
    job_id: str | None = None
    error_type: ModelErrorType | None = None
    http_status: int | None = None
    maybe_billed: bool = False
    edge_fingerprint: str = ""
    output_bytes: int = 0
    expected_bytes: int | None = None
    provider_usage: object | None = None
    job_status: str | None = None
    retry_after_s: float | None = None
    poll_ms: int | None = None
    download_ms: int | None = None
    poll_count: int | None = None
    #: 产物地址。OpenAI 面在轮询响应里就给出它,协议层要有地方交回来,
    #: 否则只能另造一个平行的结果类型。
    result_url: str | None = None
