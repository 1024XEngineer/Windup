"""AI Provider 配置。"""

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
    # 分成字段而不是共用上面那个 ``model``:各能力同时在用不同模型,共用一个
    # 字段意味着换其中一个就把另外两个也换了。默认值即当前实测在用的型号,
    # 部署侧可用 AI_CHAT_MODEL / AI_VIDEO_MODEL / AI_IMAGE_MODEL 覆盖。
    #
    # **只有型号可配,请求形状不可配**:哪个模型吃 image_list、哪个吃
    # input_reference、FAL 队列路径长什么样,都是该模型的 API 事实而非运行参数,
    # 写在 providers.sufy 的映射表里。放进配置会把"填错了会怎样"从部署期推到
    # 运行期 —— 字段塞错不会立刻报错,任务照常 queued,直到生成阶段才 failed,
    # 而费用可能已经产生(2026-07-29 实测)。
    chat_model: str = "gpt-4o-mini"
    video_model: str = "kling-v2-5-turbo"
    image_model: str = "gemini-2.5-flash-image"
    # 判官是**看图的聊天模型**,不是图像生成模型:它要读一张图然后回一段 JSON,而
    # ``image_model`` 那个型号只会回图;共用一个字段的话,换判官会连带把出图换掉。
    # 本默认值未在本仓实测过 —— 网关目录里没有它时,``_post`` 的 400/404 分支会指到
    # ``GET /models`` 去核对。
    judge_model: str = "gemini-2.5-flash"

    @property
    def normalized_base_url(self) -> str:
        return self.base_url.rstrip("/")


settings = AIProviderSettings()
