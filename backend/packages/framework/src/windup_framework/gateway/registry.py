from __future__ import annotations

from windup_framework.config.provider import AIProviderSettings
from windup_framework.gateway.types import Family, Scene

FAMILIES: dict[str, Family] = {
    "gemini-2.5-flash-image": Family.IMAGE_CHAT_DATA_URI,
    "kling-v2-5-turbo": Family.VIDEO_INPUT_REFERENCE,
    "kling-v2-6": Family.VIDEO_INPUT_REFERENCE,
    "kling-video-o1": Family.VIDEO_IMAGE_LIST,  # 登记但不允许进 chain
}


class RegistryError(ValueError):
    pass


def _parse_fallbacks(raw: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in raw.split(",") if part.strip())


class ModelRegistry:
    def __init__(self, chains: dict[Scene, tuple[str, ...]]) -> None:
        self._chains = chains

    @classmethod
    def from_settings(cls, cfg: AIProviderSettings) -> ModelRegistry:
        chains = {
            Scene.CHARACTER_IMAGE: (cfg.image_model, *_parse_fallbacks(cfg.image_fallbacks)),
            Scene.CHARACTER_ACTION: (cfg.video_model, *_parse_fallbacks(cfg.video_fallbacks)),
        }
        for scene, models in chains.items():
            cls._validate_chain(scene, models)
        return cls(chains)

    @staticmethod
    def _validate_chain(scene: Scene, models: tuple[str, ...]) -> None:
        families: list[Family] = []
        for model in models:
            if model not in FAMILIES:
                raise RegistryError(f"未登记型号: {model}")
            family = FAMILIES[model]
            if scene is Scene.CHARACTER_ACTION and family is Family.VIDEO_IMAGE_LIST:
                raise RegistryError(
                    f"family {family.value} 不允许出现在 {scene.value} 链上: {model}"
                )
            families.append(family)
        if len(set(families)) > 1:
            raise RegistryError(
                f"scene {scene.value} 链上 family 不一致: {models}"
            )

    def chain(self, scene: Scene) -> tuple[str, ...]:
        return self._chains[scene]

    def family_of(self, model: str) -> Family:
        if model not in FAMILIES:
            raise RegistryError(f"未登记型号: {model}")
        return FAMILIES[model]

    def contains(self, scene: Scene, model: str) -> bool:
        return model in self._chains[scene]
