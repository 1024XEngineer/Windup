"""零模型的 :class:`~windup_ai_engine.ports.PromptAdapterPort` 实现。

先做规则版而不是直接上 LLM:它不花钱、确定性、可测,且换成 LLM 版之后它仍然是兜底
(模型不可用时的降级)与对照组(判断 LLM 改写到底有没有比规则更好)。

它只做确定性做得到的三件事:跑门禁并在 error 级上拒掉、把用户那句话嵌进已验证的骨架、
追加统一的单主体与构图后缀。**翻译、改写措辞、把"轻微"换成一个具体幅度,规则做不到**
—— 那些是 LLM 版的活,这里只负责讲清楚拦在哪、为什么。

放在 ai_engine 而不是 framework:分层门禁(``lint-imports`` 的"包分层链")规定
framework 在 ai_engine 之下,framework 里的模块 import 不到本层的门禁与骨架。
将来的 LLM 版同样住这一层,按 ``VideoFrameStrategy`` 与 ``VideoProvider`` 的成例,
把模型调用作为 framework 的 provider 注入进来。
"""
from __future__ import annotations

from windup_common.models import CharacterStance, Facing

from windup_ai_engine.ports import AdaptedPrompt, PromptRejectCode, PromptRejected
from windup_ai_engine.prompt.custom import MAX_ACTION_CHARS, build_custom_body
from windup_ai_engine.prompt.lint import Kind, lint

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
    ) -> AdaptedPrompt:
        """Raises ``PromptRejected``:这段描述送进模型必然出坏产物,理由带 code 与机制。"""
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

        issues = lint(clause, kind=kind)
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
