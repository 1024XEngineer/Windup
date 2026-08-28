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
    # 2026-08-27 起默认 kling v3 turbo:同一角色同一提示词的对照里它明显更好。
    # 交付率也支持这个方向 —— 按首选型号统计线上动作任务的最终状态:
    # agnes-video-2.5-flash 15 完成 / 6 失败(71%),kling-v2-5-turbo 56 完成 / 1 失败(95%)。
    # 口径注意:``windup_ai_gateway_attempt`` 只记 ``submit`` 这一相,提交成功 ≠ 出片
    # (agnes 21 次提交全部 200,但其中 6 个任务最终 failed),所以交付率必须回到任务状态看。
    # **部署侧的 AI_VIDEO_MODEL 会覆盖这里**,改默认值不等于线上生效,还要动 .env。
    video_model: str = "kling-v3-turbo-std"
    image_model: str = "gpt-image-2"
    # 判官是**看图的聊天模型**,不是图像生成模型:它要读一张图然后回一段 JSON,而
    # ``image_model`` 那个型号只会回图;共用一个字段的话,换判官会连带把出图换掉。
    # 本默认值未在本仓实测过 —— 网关目录里没有它时,``_post`` 的 400/404 分支会指到
    # ``GET /models`` 去核对。
    judge_model: str = "gemini-2.5-flash"

    # veo 走 FAL 队列面,与 kling 的 OpenAI 面是两套请求形状与两条计费档。默认关的理由
    # 不是"没实现",而是**开着就会被选中**:它一旦进链,兜底那一跳就可能落到它身上,
    # 而它最贵的一档(8s + 有声)是最便宜一档的 4 倍。关着时它不进链,
    # ``_resolve_video_model`` 也就选不到它 —— 对客户不可见,出事随时能关回去。
    # veo3.1 只对**逐个列出的用户**开放,不是部署级开关。它按秒计费且比 kling 贵,
    # 用途是组内做高质量素材,不面向客户。空值 = 没有任何人可用(默认)。
    # 逗号分隔的用户 id,如 "1,7,12"。
    video_veo_user_ids: str = ""

    # 不受 3D 资产额度限制的用户。用途与 ``video_veo_user_ids`` 一样是**组内做素材**,
    # 但**单独一个字段** —— 两件事的开关合并的话,给某人开 veo 会连带解掉他的 3D 额度,
    # 而那两笔钱的量级完全不同(veo 按秒计费,3D 是每资产 30 积分且可无限累积)。
    # 空值 = 所有人都受额度限制(默认)。逗号分隔的用户 id,如 "1,2,3"。
    render3d_unlimited_user_ids: str = ""

    chat_fallbacks: str = ""
    image_fallbacks: str = "gemini-3.1-flash-image-preview"
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
