from __future__ import annotations

from windup_framework.config.provider import AIProviderSettings, settings as default_settings
from windup_framework.gateway.types import SCENE_FAMILIES, Family, Scene

FAMILIES: dict[str, Family] = {
    "gemini-2.5-flash-image": Family.IMAGE_CHAT_DATA_URI,
    "gemini-2.5-flash-image-alt": Family.IMAGE_CHAT_DATA_URI,  # test double; not a production default
    "gpt-image-2": Family.IMAGE_OPENAI_IMAGES,
    "gemini-3.1-flash-image-preview": Family.IMAGE_FAL_QUEUE,
    "kling-v2-5-turbo": Family.VIDEO_INPUT_REFERENCE,
    "kling-v2-6": Family.VIDEO_INPUT_REFERENCE,
    "kling-video-o1": Family.VIDEO_IMAGE_LIST,  # 登记但不允许进 chain
}


#: 型号 → 一张图的上游牌价,**单位是美元**:``ledger`` 把非空的 cost 一律标成
#: ``cost_currency="USD"``,填人民币会让成本整体错一个汇率。
#: 跨型号之后"张数 × 单一单价"不再成立 —— 同一次任务的多张候选可能出自不同型号。
#: ``image_unit_cost`` 配置仍可整体覆盖,用于网关转售价与官方牌价不一致的场合。
IMAGE_UNIT_COST_USD: dict[str, float] = {
    "gemini-2.5-flash-image": 0.0387,
    "gpt-image-2": 0.03,
    "gemini-3.1-flash-image-preview": 0.067,
}


class RegistryError(ValueError):
    pass


def _parse_fallbacks(raw: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in raw.split(",") if part.strip())


class ModelRegistry:
    def __init__(self, chains: dict[Scene, tuple[str, ...]]) -> None:
        self._chains = chains

    @classmethod
    def from_settings(cls, cfg: AIProviderSettings | None = None) -> ModelRegistry:
        cfg = default_settings if cfg is None else cfg
        chains = {
            Scene.CHARACTER_IMAGE: (cfg.image_model, *_parse_fallbacks(cfg.image_fallbacks)),
            Scene.CHARACTER_ACTION: (cfg.video_model, *_parse_fallbacks(cfg.video_fallbacks)),
        }
        for scene, models in chains.items():
            cls._validate_chain(scene, models)
        return cls(chains)

    @staticmethod
    def _validate_chain(scene: Scene, models: tuple[str, ...]) -> None:
        """按 scene 的白名单校验,不要求链上 family 一致。

        要求一致会把「主型号与兜底型号分属不同协议面」这种正常配置一并拒掉,而适配
        协议差异正是 provider 该做的事;真正要拦的是类别错误 —— 把出图型号配进视频链。
        """
        allowed = SCENE_FAMILIES[scene]
        for model in models:
            if model not in FAMILIES:
                raise RegistryError(f"未登记型号: {model}")
            family = FAMILIES[model]
            if family not in allowed:
                raise RegistryError(
                    f"family {family.value} 不允许出现在 {scene.value} 链上: {model}"
                )

    def chain(self, scene: Scene) -> tuple[str, ...]:
        return self._chains[scene]

    def family_of(self, model: str) -> Family:
        if model not in FAMILIES:
            raise RegistryError(f"未登记型号: {model}")
        return FAMILIES[model]

    def contains(self, scene: Scene, model: str) -> bool:
        return model in self._chains[scene]
