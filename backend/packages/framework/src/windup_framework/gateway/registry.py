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
    "veo3.1": Family.VIDEO_FAL_QUEUE,  # 登记≠放行,还要在 USER_GATED_MODELS 的白名单里
    "agnes-video-2.5": Family.VIDEO_AGNES,
    "agnes-video-2.5-flash": Family.VIDEO_AGNES,
}


#: 型号 → 放行开关的配置字段名。登记进 :data:`FAMILIES` 只是"认识它",能不能进链另说。
#: 关着时从链上**滤掉**而不是抛错:开关的意义是出事能立刻关回去,而如果关掉它会让
#: 配置校验失败、整条视频链一起死,那这个开关就不敢在出事时按 —— 那就不是开关了。
#: 只对逐个列出的用户开放的型号 → 存放白名单的配置字段名。
#: 这类型号**永远不进自动链**:链是兜底路径,谁都可能落到它上面,而这些型号按用户授权,
#: 让它当兜底等于对所有人开放。只能由请求显式指定,并在那时逐个用户判。
USER_GATED_MODELS: dict[str, str] = {"veo3.1": "video_veo_user_ids"}


def allowed_user_ids(cfg, model: str) -> frozenset[int]:
    """某个受限型号的用户白名单。配置里写坏的条目直接跳过,不让它变成"对所有人开放"。"""
    field = USER_GATED_MODELS.get(model)
    if field is None:
        return frozenset()
    out = set()
    for part in str(getattr(cfg, field, "") or "").split(","):
        part = part.strip()
        if part.isdigit():
            out.add(int(part))
    return frozenset(out)


def is_allowed_for_user(model: str, user_id: int | None, cfg=None) -> bool:
    """受限型号是否对这个用户开放。非受限型号一律 True。"""
    if model not in USER_GATED_MODELS:
        return True
    if user_id is None:
        return False
    # 走模块里那个 default_settings 钩子,不自己 new 一个 —— 自己 new 会绕开配置注入,
    # 表现是"配置改了不生效",而权限判定不生效的方向是**放行**。
    return user_id in allowed_user_ids(cfg if cfg is not None else default_settings, model)


#: 型号 → 上游每秒牌价,**单位是美元**(与 :data:`IMAGE_UNIT_COST_USD` 同一口径:
#: ``ledger`` 把非空 cost 一律标 ``cost_currency="USD"``,填人民币会整体错一个汇率)。
#: veo3.1 按**无声**档记:有声是 $0.40/秒、无声 $0.20/秒,而本仓的调用固定关音轨
#: (见 ``VeoQueueVideoProtocol``)。哪天音轨被打开,这个数就要跟着改,否则账面少一半。
#: 表里没有的型号仍回落到 ``video_unit_cost_per_second`` 配置 —— kling 侧行为不变。
VIDEO_UNIT_COST_USD_PER_SECOND: dict[str, float] = {
    "veo3.1": 0.20,
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


def billed_seconds(model: str | None, seconds: int) -> int:
    """记账用的秒数 = 上游**真正计费的那一档**,不是调用方要的秒数。

    两者会不一样:调用方按通用参数要 5 秒,而 veo 只卖 4/6/8 三档,落到 4s。
    照 5 秒记账会让每条 veo 的账面多出 25%,而这个偏差随档位变化,事后无法回补。
    kling 系按秒连续计费,两者相等,所以这里对它是恒等函数。
    """
    if model == "veo3.1":
        from windup_framework.providers.protocol.fal_queue import veo_duration

        return int(veo_duration(seconds).rstrip("s"))
    return seconds


def candidate_models(chain: tuple[str, ...], count: int) -> tuple[str, ...]:
    """一次任务的多张候选各自用哪个型号。

    与兜底链正交:兜底是"前一个失败了才换",这里是"同一次任务里同时用不同型号"。
    同型号出 N 张时,候选之间的差异只来自采样随机性,用户挑中哪张不携带任何型号信息;
    跨型号之后那一次挑选就是一条偏好数据,而这条数据零额外成本。

    规则是最后一张交给链上第二个型号,其余走主型号 —— 多数张保持主型号的稳定表现,
    同时只要不止一张就一定有一张来自另一条协议面。链上只有一个型号时全部用它。
    """
    if not chain:
        return ()
    n = max(1, count)
    if n == 1 or len(chain) == 1:
        return (chain[0],) * n
    return (chain[0],) * (n - 1) + (chain[1],)


class RegistryError(ValueError):
    pass


def _admitted(cfg, models: tuple[str, ...], scene: Scene) -> tuple[str, ...]:
    """滤掉开关关着的型号。

    整条链被滤空时才抛错:那说明部署把**唯一**的型号配成了一个没放行的型号,
    静默返回空链会让第一次真实调用才炸,而那时错误长得像"网关挂了"。
    """
    del cfg                                   # 受限型号与部署配置无关,一律不进链
    kept = tuple(m for m in models if m not in USER_GATED_MODELS)
    if models and not kept:
        gated = ", ".join(sorted(m for m in models if m in USER_GATED_MODELS))
        raise RegistryError(
            f"{scene.value} 链上只剩按用户授权的型号 {gated};它们不能当兜底,"
            f"请另配一个面向所有人的型号"
        )
    return kept


def _parse_fallbacks(raw: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in raw.split(",") if part.strip())


class ModelRegistry:
    def __init__(self, chains: dict[Scene, tuple[str, ...]]) -> None:
        self._chains = chains

    @classmethod
    def from_settings(cls, cfg: AIProviderSettings | None = None) -> ModelRegistry:
        cfg = default_settings if cfg is None else cfg
        chains = {
            Scene.CHARACTER_IMAGE: _admitted(
                cfg, (cfg.image_model, *_parse_fallbacks(cfg.image_fallbacks)), Scene.CHARACTER_IMAGE
            ),
            Scene.CHARACTER_ACTION: _admitted(
                cfg, (cfg.video_model, *_parse_fallbacks(cfg.video_fallbacks)), Scene.CHARACTER_ACTION
            ),
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
