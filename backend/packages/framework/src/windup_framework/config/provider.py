"""AI Provider 配置。"""

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class AIProviderSettings(BaseSettings):
    """OpenAI-compatible AI 服务配置。"""

    model_config = SettingsConfigDict(
        env_prefix="AI_",
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    provider: str = "openai-compatible"
    base_url: str = "https://api.openai.com/v1"
    api_key: str = ""
    model: str = ""                      # 通用兜底(chat 类调用),下面三个各自专用
    timeout: float = 120.0
    max_retries: int = 2
    chat_completions_path: str = "/chat/completions"

    # ── 各能力用哪个模型 ──────────────────────────────────────────────────
    # 分成三个字段而不是共用上面那个 ``model``:三条能力同时在用不同模型,共用一个
    # 字段意味着换其中一个就把另外两个也换了。默认值即当前实测在用的型号,
    # 部署侧可用 AI_VIDEO_MODEL / AI_IMAGE_MODEL 覆盖。
    #
    # **只有型号可配,请求形状不可配**:哪个模型吃 image_list、哪个吃
    # input_reference、FAL 队列路径长什么样,都是该模型的 API 事实而非运行参数,
    # 写在 providers.sufy 的映射表里。放进配置会把"填错了会怎样"从部署期推到
    # 运行期 —— 字段塞错不会立刻报错,任务照常 queued,直到生成阶段才 failed,
    # 而费用可能已经产生(2026-07-29 实测)。
    video_model: str = "kling-v2-5-turbo"
    image_model: str = "gemini-2.5-flash-image"

    chat_fallbacks: str = ""
    image_fallbacks: str = ""
    video_fallbacks: str = ""
    image_unit_cost: float | None = None
    video_unit_cost_per_second: float | None = None
    price_version: str = "2026-08-16"

    # ── Gateway route spike: base_url / key route candidates ────────────────
    # 第一版仍以 env 管理。primary 留空时复用上面的 AI_BASE_URL / AI_API_KEY;
    # fallback 三个字段都填才表示启用一个备用入口。
    # *_API_KEYS 是同入口额外 key（逗号分隔）：429 换 key，UNREACHED 跳过剩余 key。
    route_primary_name: str = "primary"
    route_primary_base_url: str = ""
    route_primary_api_key: str = ""
    route_primary_api_keys: str = ""
    route_fallback_name: str = ""
    route_fallback_base_url: str = ""
    route_fallback_api_key: str = ""
    route_fallback_api_keys: str = ""
    gateway_ledger_enabled: bool = True

    @field_validator("image_unit_cost", "video_unit_cost_per_second", mode="before")
    @classmethod
    def _empty_cost_is_none(cls, v):
        if v == "" or v is None:
            return None
        return v

    @property
    def normalized_base_url(self) -> str:
        return self.base_url.rstrip("/")

    @property
    def effective_route_primary_base_url(self) -> str:
        return (self.route_primary_base_url or self.base_url).rstrip("/")

    @property
    def effective_route_primary_api_key(self) -> str:
        return self.route_primary_api_key or self.api_key

    @property
    def route_fallback_enabled(self) -> bool:
        return all((
            self.route_fallback_name.strip(),
            self.route_fallback_base_url.strip(),
            self.route_fallback_api_key.strip(),
        ))


settings = AIProviderSettings()
