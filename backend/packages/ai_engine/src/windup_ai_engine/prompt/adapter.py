"""零模型的 :class:`~windup_ai_engine.ports.PromptAdapterPort` 实现。

用户描述先经 :mod:`rewrite` 用 Chat Gateway 大模型预改写,再跑措辞门禁与骨架装配。
改写失败时回退原文;门禁的拒绝逻辑不变。

放在 ai_engine 而不是 framework:分层门禁(``lint-imports`` 的"包分层链")规定
framework 在 ai_engine 之下,framework 里的模块 import 不到本层的门禁与骨架。
将来的 LLM 版同样住这一层,按 ``VideoFrameStrategy`` 与 ``VideoProvider`` 的成例,
把模型调用作为 framework 的 provider 注入进来。
"""
from __future__ import annotations

import re

from windup_common.models import CharacterStance, Facing

from windup_ai_engine.ports import AdaptedPrompt, PromptRejectCode, PromptRejected
from windup_ai_engine.prompt.custom import MAX_ACTION_CHARS, build_custom_body
from windup_ai_engine.prompt.lint import Kind, lint
from windup_ai_engine.prompt.rewrite import rewrite_prompt

__all__ = ["RuleBasedPromptAdapter"]

# 统一后缀。全是正向措辞:这条通路没有 negative_prompt,"背景里没有别人"会把别人请进来。
_COMPOSITION = (
    "One single character alone in the frame, the whole body inside the frame, "
    "on one plain flat background."
)

# 静态模型没有时间轴,一段多阶段描述会被摊平成并排的分解姿势图 —— 一张图里好几个身位,
# 而它对切片来说是废的。故给静态模型的必须是单一瞬间。
_SINGLE_INSTANT = "ONE single frozen instant of that motion, one single pose."

_STAGE_MARKERS = (
    "then", "after that", "afterwards", "followed by", "next,", "and finally",
    "然后", "接着", "紧接着", "之后", "再", "最后", "先", "收势",
)
_ARM_WORDS = ("arm", "arms", "elbow", "hand", "hands", "手臂", "胳膊", "手肘")

# 上面漏掉最常用的写法:裸"手"。"举起左手"不命中 _ARM_WORDS,而英文 raise the left hand
# 会被拒 —— 同一句话中英文两种结果。
#
# **不能直接把"手"加进上面那张表**:选手 / 对手 / 高手 / 新手 / 助手 / 手段 / 手法 /
# 顺手 / 棘手 里的"手"都不是身体部位,加了会把合法描述拒掉,而拒错的代价是用户改不动。
# 故只认"手"真的当部位用的那几种组合:方位或数量修饰、身体部位后缀、以及动作动词带它。
_HAND_RE = re.compile(
    r"(?:[左右双两单前后]手"
    r"|手(?:掌|指|腕|背|心)"
    r"|(?:举|抬|挥|伸|摆|张|握|收|放下|抱|拍)(?:起|开)?手)"
)

# 每个非双足体型自带一套可替换的部位说法:拒绝理由要给得出改法,"这个词不行"给不了。
# 缺一支就是拒了却说不出改哪儿,故 :class:`CharacterStance` 加成员必须同时加这里。
_STANCE_PARTS = {
    CharacterStance.QUADRUPED: "前肢 / 头颈 / 尾",
    CharacterStance.SERPENTINE: "躯干起伏 / 尾 / 头颈",
}

# 门禁类别 → 拒绝码。直查不 get:漏配一条是引擎侧的装配缺口(该 5xx 让人介入),
# 兜个通用码会把它伪装成用户的输入问题,而用户按那条文案改多少遍都过不了。
_CODE_BY_CATEGORY = {
    "negation": PromptRejectCode.NEGATION,
    "hazard_noun": PromptRejectCode.HAZARD_NOUN,
    "shape_prior": PromptRejectCode.SHAPE_PRIOR,
    "subthreshold": PromptRejectCode.SUBTHRESHOLD,
    "unanchored_prop": PromptRejectCode.UNANCHORED_PROP,
}


class RuleBasedPromptAdapter:
    """确定性适配:能判的当场判,判不了的照原样嵌进骨架。"""

    def adapt(
        self,
        user_text: str,
        *,
        kind: Kind = "i2v",
        facing: Facing = Facing.SIDE,
        stance: CharacterStance | str = CharacterStance.BIPED,
        on_template: bool = False,
    ) -> AdaptedPrompt:
        """Raises ``PromptRejected``:这段描述送进模型必然出坏产物,理由带 code 与机制。

        ``on_template``:这段话是叠在动作模板之上的细节句(#838),见 ``lint``。
        """
        stance = CharacterStance(stance)      # 非法体型要炸,不静默按双足放行
        clause = (user_text or "").strip()
        if not clause:
            raise PromptRejected(
                PromptRejectCode.EMPTY,
                "没写动作内容。空描述不会报错,只会拿回一段站着不动的视频,"
                "而帧数和时长全对、看不出描述丢了。",
            )

        if len(clause) > MAX_ACTION_CHARS:
            raise PromptRejected(
                PromptRejectCode.TOO_LONG,
                f"描述有 {len(clause)} 字,超过上限 {MAX_ACTION_CHARS}。描述越长越容易"
                f"夹带角色外观,而外观由母版承载,写两遍会打架。只留动作本身。",
            )

        clause = rewrite_prompt(clause, kind=kind, stance=stance)

        issues = lint(clause, kind=kind, on_template=on_template)
        blockers = [
            (_CODE_BY_CATEGORY[i.category], i.message) for i in issues if i.level == "error"
        ]
        low = clause.lower()

        if kind == "still":
            marker = next((m for m in _STAGE_MARKERS if m in low), None)
            if marker:
                blockers.append((
                    PromptRejectCode.MULTI_STAGE,
                    f"「{marker}」把这段描述分成了好几个阶段,而静态模型没有时间轴:"
                    f"它会把各阶段并排画成一张分解姿势图,一张图里好几个身位。"
                    f"只描述其中一个瞬间。",
                ))

        if stance is not CharacterStance.BIPED:
            hit = next((w for w in _ARM_WORDS if w in low), None)
            if hit is None:
                m = _HAND_RE.search(low)
                hit = m.group(0) if m else None
            if hit:
                blockers.append((
                    PromptRejectCode.STANCE_MISMATCH,
                    f"这个角色的体型是 {stance.value},不是双足,而「{hit}」会让模型给它凭空"
                    f"接上人的上肢。改写成发力的那个部位({_STANCE_PARTS[stance]})。",
                ))

        if blockers:
            raise PromptRejected(
                blockers[0][0], "\n".join(f"· {m}" for _, m in blockers)
            )

        body = build_custom_body(clause, facing=facing)
        parts = [body, _SINGLE_INSTANT, _COMPOSITION] if kind == "still" else [body, _COMPOSITION]
        return AdaptedPrompt(text=" ".join(parts), issues=tuple(issues))
