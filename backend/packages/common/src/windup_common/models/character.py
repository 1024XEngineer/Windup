"""共享 DTO —— 跨层契约(common,无内部依赖)。

产品核心实体的数据模型:角色卡(一致性主键)、动作规格、生成路线枚举。
仅定义结构,不含行为。ai_engine / app 均依赖此。

**为什么受限取值一律用枚举而不是裸 str(2026-08-08 收紧)**:
``facing`` 承载的是一条实测挣得的硬约束——"提示词朝向必须与母版朝向一致"
(见 ai_engine.master_prep:给正面母版喂侧走词,模型会靠转身调和图文矛盾)。
它此前是裸 str、合法值只写在行尾注释里:写成 "Side" / "sidee" 不报错、不告警,
调用链一路放行,几分钟和一次真金白银的视频调用之后才在画面上看出角色转了身。
枚举把这类错误从"生成完靠肉眼发现"提前到"构造 ActionSpec 时 ValidationError",
成本从一次付费生成降到零。``loop`` / ``stylize`` / ``view`` 同理。
"""
from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

# 未知字段一律报错(pydantic 默认是 extra="ignore",静默丢弃)。理由与本文件用枚举取代裸
# str 完全同源:字段名也是靠字符串传递的约束。`ActionSpec(action=..., n_frame=16)`(少个 s)
# 在 ignore 下不报错、不生效,调用方以为要了 16 帧、实际拿到默认 8 帧;`CharacterCard(
# palette=...)` 这类已删字段同理会被静默吞掉。forbid 让这些当场变成 ValidationError。
_STRICT = ConfigDict(extra="forbid")


def _without(data: dict[str, Any], key: str) -> dict[str, Any]:
    """去掉某键的浅拷贝(不改调用方传进来的 dict —— before 校验器拿到的是原对象)。"""
    return {k: v for k, v in data.items() if k != key}


class ActionType(str, Enum):
    """动作类型 —— 决定走哪条生成 strategy(见 ai_engine.strategy.ROUTE_MATRIX)。

    **本枚举是"引擎能生成的动作",不是"API 能接收的动作",两者刻意分离。** 入口侧的
    ``windup_app.server.orchestrator.model.ActionType`` 另有 ``custom``,且少 run /
    jump / hit;跨越两者靠编排层的显式适配函数 ``_to_engine_action``,它对引擎没有路线
    的类型抛带原因的错误,而不是让请求走到一半失败。

    ``custom`` 是先做出履约能力(提示词构建 + 循环性显式声明 + 路线分流)才加的成员,
    不是提前留位——加了没有分流的成员等于接收一个无法履约的请求。

    入口枚举(``orchestrator.model.ActionType``)仍与本枚举分离:它少 run / hit,
    跨越靠 ``_to_engine_action``。
    """

    IDLE = "idle"
    WALK = "walk"
    RUN = "run"
    JUMP = "jump"      # 一次性动作,且要按状态切段(见 postprocess.split_jump_phases)
    ATTACK = "attack"  # slash / thrust / dash 归此
    HIT = "hit"
    # 用户自述动作。与上面几个的**结构性差异**:上面每个都自带一套写死的产线设定
    # (提示词模板、循环性、所需母版姿态),而 custom 的这些只能由调用方随请求给出。
    # 故 ``ActionSpec`` 对它多要两个字段(``custom_action`` / ``cyclic``),缺一个就报错 ——
    # 见该类的校验器。Refs 1024XEngineer/Windup#239。
    CUSTOM = "custom"


class AttackArchetype(str, Enum):
    """攻击的运动拓扑 —— 决定 ``prompts/attack.md`` 取哪一节(取值即节名前缀)。

    按"身体怎么发力"分而不按装备形状分:提示词里的形状先验(宽面、弧线)等于断言角色
    手握一件有宽面的长条物,喂空手 / 法杖 / 四足角色时模型会凭空补出那件东西来调和矛盾。
    """

    SWEEP = "sweep"      # 长条持物:横挥 / 下劈
    THRUST = "thrust"    # 短持物或空手:直出 / 戳刺
    PROJECT = "project"  # 远程:身体前压、送到位、终态保持
    LUNGE = "lunge"      # 非双足:整体前扑,头部 / 前肢领先


class GenRoute(str, Enum):
    """生成路线 —— 实测挣得的分流依据(见 ai_engine.strategy 层 docstring)。

    **只列有实现的路线。** 没有实现的枚举值等于死代码:它会让调用方以为该能力存在,
    而分流到它只能得到运行时错误。未来路线(如三渲二渲染出帧)的契约需求记在 Issue 里
    (见 #81 #122),随实现一起加成员 —— 枚举加成员是纯加法,不构成破坏性变更。
    """

    VIDEO_I2V = "video_i2v"   # 步态位移动作:图生视频(连贯交替腿)
    PER_FRAME = "per_frame"   # 离散姿势:逐帧图生图(单帧可编辑)


class Facing(str, Enum):
    """提示词朝向 —— **必须与母版朝向一致**(硬约束,见 ai_engine.master_prep)。

    - ``SIDE``:横版侧视,角色朝画面右侧行进(母版也须朝侧向)。
    - ``FRONT``:身体正对观者(俯视与 2.5D 都归此)。

    与 :class:`CharacterView` 的对应关系:SIDE→SIDE;TOP_DOWN / ISOMETRIC→FRONT。
    两者不合并成一个枚举:view 是项目级美术视角(对应 ``Project.character_perspective``,
    决定母版怎么画),facing 是提示词模板的二选一(只区分"看得到侧面"和"正对镜头")。
    """

    SIDE = "side"
    FRONT = "front"


class CharacterView(str, Enum):
    """角色美术视角 —— 与 ``Project.character_perspective``(1/2/3)一一对应。

    映射固定为 1→side、2→top-down、3→isometric。字符串取值必须逐字一致,
    免得调用方再造一套别名(如 topdown / top_down / top-down 三写)。
    """

    SIDE = "side"            # perspective=1 横版
    TOP_DOWN = "top-down"    # perspective=2 俯视
    ISOMETRIC = "isometric"  # perspective=3 2.5D


class Stylize(str, Enum):
    """风格化模式。

    ``PIXEL``=像素化(原生像素角色 i2v 后复原像素感);``NONE``=保留 i2v 的插画质感。
    不该焊死——插画风角色像素化会出不协调色块(有损近似);默认由角色画风决定。
    """

    PIXEL = "pixel"
    NONE = "none"


# 视频路线未指定帧数时的默认出帧数。原先以 `action.n_frames or 8` 的形式藏在
# strategy.concrete 里,是"契约的缺省值写在实现里"——换个 strategy 就换个默认值。
DEFAULT_N_FRAMES = 8


class CharacterCard(BaseModel):
    """角色卡 —— 一致性主键 + 资产库基础(产品核心实体)。

    注意:视频路线**不读本模型的任何字段**,角色身份由母版图像承载。
    详见 ``windup_ai_engine.ports.CharacterGeneratorPort`` 的 docstring。
    """

    model_config = _STRICT

    name: str
    desc: str                                    # 身份描述(喂模型锁一致性)
    view: CharacterView = CharacterView.SIDE
    master_ref: str = ""                         # 定妆母版的存储 ref(对象存储,非本地路径)
    version: str = "v1"

    # 注:曾有 `palette: str = ""`。2026-08-08 删除,理由是它会变成"看起来生效、实则被
    # 忽略"的第二真相源:真正锁色的色板由 postprocess.master_pixel_spec 从母版像素里量出来
    # (ndarray,喂给 _snap_to_palette),而这个字段零消费方、无格式约定。调用方填了
    # "#1a1a2e,#e94560" 期待锁色,管线照旧用母版色板,不报错也不生效——正是本项目最忌讳的
    # "看起来成功的错结果"。将来若要支持用户指定色板,连同消费它的代码一起加回,并用结构化
    # 类型(如 list[str] 且校验 hex)而不是自由 str。


class ActionSpec(BaseModel):
    """动作规格 —— 帧数 / 逐帧姿势 / 风格化 / 朝向。

    **播放时序的唯一真相源是出参的 ``durations``(逐帧 ms),不是入参的帧率。**
    这里曾有 ``fps`` 与 ``loop`` 两个字段,都已删除,理由与 :class:`GenRoute`
    docstring 里那条一致——没有实现的取值等于死代码,它让调用方以为该能力存在:

    - ``fps``:零写入方(编排层构造 ActionSpec 时从不传),而 ``postprocess.
      frame_durations`` 按动作查表、**根本不看它**。留着的后果是 ``fps=20`` 宣称
      50ms/帧、walk 实际返回 125ms/帧,两个字段描述同一段素材的不同播放速度。
    - ``loop``:零消费方。闭环行为写死在 ``slicing.pick_cycle`` 里——循环类动作
      一律抽单周期闭环,传 ``pingpong`` / ``none`` 不改变任何产出。调用方可以为一段
      往返动画付费、拿到一段线性循环,正是本项目最忌讳的"静默成功"。

    真要支持 pingpong,连同 ``pick_cycle`` 的分支、出参的时序契约一起加回。
    """

    model_config = _STRICT

    action: ActionType
    # 描述与循环性拆成两个字段并加双向校验,而不是一个无校验器的可选 motion_prompt:
    # 后者设在 walk / jump / attack 上会顶掉那几套模板,也不承载循环性,两种都不会红。

    # 出帧数。**显式字段,不再由 len(poses) 推导**:视频路线根本不读 poses(见
    # strategy.concrete.VideoFrameStrategy),推导意味着"想要 16 帧就得先编 16 条用不上的
    # 姿势描述",而那 16 条描述读者会以为真的进了提示词。
    n_frames: int = Field(default=DEFAULT_N_FRAMES, ge=1)

    # 逐帧路线专用:每帧一条姿势描述,只有 PER_FRAME 会真的读它。
    poses: list[str] = Field(default_factory=list)

    stylize: Stylize = Stylize.PIXEL
    # 两个下界抄的是实现里已经存在的真实取值域,把"实现悄悄纠正入参"提前成入参报错:
    # pixel_h  → postprocess.to_pixel_art 对 <1 直接 raise,契约没理由比实现更宽松;
    # palette_size → 同处 `quantize(colors=max(2, palette_size))` 会把 1 静默抬成 2,
    #   于是"我要 1 色"拿到 2 色且无任何提示 —— 正是本项目最忌讳的静默纠正。
    pixel_h: int = Field(default=100, ge=1)        # 像素化目标高(角色像素行数)
    palette_size: int = Field(default=32, ge=2)    # 色板色数(1 色的像素画不存在)
    # 生成提示词的朝向,**必须与母版朝向一致**(对应 Project.perspective)。
    facing: Facing = Facing.SIDE

    # ── 仅 action=CUSTOM 用的两个字段(#239)────────────────────────────────
    #
    # 其余动作各自自带一套写死的产线设定(提示词模板、循环性、所需母版姿态),
    # custom 没有 —— 只能由调用方随请求给出。缺任何一个都在构造时炸,见下面的校验器。

    # 用户自述的动作内容。**只写"做什么动作"**,不复述角色外观:身份由母版承载,
    # 身份描述再写一遍会和母版打架(见 ports.CharacterGeneratorPort)。
    custom_action: str | None = None

    # 必须显式给,不按描述关键词猜:猜错会把一次性动作强行首尾闭环,末帧接回首帧抽搐,
    # 而帧数、时长、成色全正常。名字不叫 loop 是因为它有真实消费方——决定 slicing 走
    # pick_cycle 还是 pick_oneshot、出参要不要量 loop_seam。
    cyclic: bool | None = None

    # 攻击走哪一支运动拓扑。``None`` = 不指定,由 ``build_attack_prompt`` 的默认值决定 ——
    # 这里不给默认值,否则同一个缺省被两处各写一份,改一处另一处静默不动。
    archetype: AttackArchetype | None = None

    @model_validator(mode="after")
    def _archetype_belongs_to_attack_only(self) -> ActionSpec:
        """非攻击动作带 archetype 要炸:它只被攻击提示词消费,传了不会生效。"""
        if self.action is not ActionType.ATTACK and self.archetype is not None:
            raise ValueError(
                f"action={self.action.value} 不该带 archetype;它只决定攻击提示词取哪一支,传了不会生效"
            )
        return self

    @model_validator(mode="after")
    def _custom_needs_its_own_settings(self) -> ActionSpec:
        """两个方向都卡:缺了只能猜、而猜错是静默的;多给了调用方以为能覆盖 walk 的
        循环性,实际被写死的表覆盖。
        """
        if self.action is ActionType.CUSTOM:
            if not (self.custom_action or "").strip():
                raise ValueError("action=custom 必须给 custom_action(动作描述),否则无从构建提示词")
            if self.cyclic is None:
                raise ValueError(
                    "action=custom 必须显式给 cyclic(是否循环播放)。不猜 —— "
                    "猜错会把一次性动作强行首尾闭环,而帧数/时长/成色全部正常、没有任何一道会红"
                )
        else:
            if self.custom_action is not None:
                raise ValueError(f"action={self.action.value} 不该带 custom_action;它的提示词由模板给")
            if self.cyclic is not None:
                raise ValueError(
                    f"action={self.action.value} 不该带 cyclic;循环性由 CYCLIC_ACTIONS 写死,"
                    "传了不会生效"
                )
        return self

    @model_validator(mode="before")
    @classmethod
    def _reconcile_n_frames_with_poses(cls, data: Any) -> Any:
        """兼容旧调用方(只传 poses),并让 n_frames 与 poses 打架时**炸掉而不是猜**。

        - 只给 poses:帧数仍取 len(poses),旧调用方零改动。
        - 两个都给且不等:抛错。此时规格自相矛盾,引擎无法知道调用方要 16 帧还是 12 帧
          (common 层看不到 ROUTE_MATRIX,判不出走哪条路线),猜一个的代价是静默出错帧数。
          走视频路线的调用方本就不该传 poses,删掉即可。
        - 显式 ``None`` 一律等同"没传"(两条分支一致):调用方写
          ``n_frames=form.get("n_frames")`` 时 None 表示"未指定",该走缺省,不该炸。
        """
        if not isinstance(data, dict):          # model_validate(实例) 等非 dict 入参原样放行
            return data
        n = data.get("n_frames")
        poses = data.get("poses")
        if n is None:
            # 有 poses 就回退到 len(poses),没有则删键让字段缺省值(DEFAULT_N_FRAMES)生效。
            # 不能原样留 None:`n_frames: int` 会报 "Input should be a valid integer",
            # 于是"显式 None"在有/无 poses 两种情况下行为不一致(一个回退、一个报错)。
            return {**data, "n_frames": len(poses)} if poses else _without(data, "n_frames")
        if not poses:
            return data
        # 先按 int 归一再比:pydantic 之后会把 JSON 里的 "2" 收成 2,而这里若直接 `n != len`
        # 比较,``{"n_frames": "2", "poses": ["a","b"]}`` 会得到自相矛盾的报错
        # 「n_frames=2 与 len(poses)=2 不一致」——把一次合法请求判成打架(2026-08-08 实测)。
        try:
            n_int = int(n)
        except (TypeError, ValueError):
            return data                         # 类型本就不对 → 交给字段校验报正经的 int 错
        if n_int != len(poses):
            raise ValueError(
                f"n_frames={n_int} 与 len(poses)={len(poses)} 不一致;"
                "逐帧路线要求两者相等,视频路线不该传 poses。"
            )
        return data
