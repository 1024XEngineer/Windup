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
    IMAGE_OPENAI_IMAGES = "image.openai_images"
    IMAGE_FAL_QUEUE = "image.fal_queue"
    VIDEO_INPUT_REFERENCE = "video.input_reference"
    VIDEO_IMAGE_LIST = "video.image_list"
    VIDEO_FAL_QUEUE = "video.fal_queue"


#: 每个 scene 允许出现哪些 family。链上混不同 family 是合法的 —— 兜底型号与主型号
#: 分属不同协议面时,它仍是同一个 scene 的同一件事;拒绝的只是把出图型号配进视频链
#: 这种类别错误。
SCENE_FAMILIES: dict[Scene, frozenset[Family]] = {
    Scene.CHARACTER_IMAGE: frozenset({
        Family.IMAGE_CHAT_DATA_URI,
        Family.IMAGE_OPENAI_IMAGES,
        Family.IMAGE_FAL_QUEUE,
    }),
    Scene.CHARACTER_ACTION: frozenset({
        Family.VIDEO_INPUT_REFERENCE,
        Family.VIDEO_FAL_QUEUE,
    }),
}


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
