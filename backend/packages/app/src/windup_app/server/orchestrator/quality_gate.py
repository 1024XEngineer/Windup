"""出门那道闸:把判官读数翻成"交不交付"。

在 server 而不是 ai_engine,因为判出问题之后的每一种处置(退款、重跑、换母版)都要
再花一次钱,那是产品决策;引擎的分工是如实报数,判决归调用方。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from windup_ai_engine.ports import JudgePort, JudgeVerdict
from windup_framework.config.quality_gate import QualityGateSettings, settings

logger = logging.getLogger("windup.generation.quality_gate")

# 稳定的机器可读标签。用槽位名而不是句子,是因为下游要按它分桶统计;
# 给人看的解释在 :func:`_problems` 的判据里,不在这几个字符串里。
PROBLEM_MULTIPLE_SUBJECTS = "multiple_subjects"
PROBLEM_NO_SUBJECT = "no_subject"
PROBLEM_FOREIGN_OBJECTS = "foreign_objects"
PROBLEM_ACTION_MISMATCH = "action_mismatch"
PROBLEM_CLIPPED = "clipped"

_EXPECTED_SUBJECTS = 1


@dataclass(frozen=True)
class GateDecision:
    """一次判读的结论。

    ``verdict`` 有值 = 判过了,``problems`` 可能为空;``error`` 有值 = 判官坏了、
    什么都没判出来,那不是"通过"。压成一个布尔的话这两种状态就没法分开了。
    """

    frame_index: int
    problems: tuple[str, ...] = ()
    blocked: bool = False
    verdict: JudgeVerdict | None = None
    error: str | None = None

    def as_payload(self) -> dict:
        """写进任务结果的形状 —— 复核要用的东西一样不少(含模型原话)。"""
        data: dict = {
            "frame_index": self.frame_index,
            "problems": list(self.problems),
            "blocked": self.blocked,
        }
        if self.error is not None:
            data["error"] = self.error
        if self.verdict is not None:
            data["subject_count"] = self.verdict.subject_count
            data["foreign_objects"] = list(self.verdict.foreign_objects)
            data["action_matches"] = self.verdict.action_matches
            data["clipped"] = self.verdict.clipped
            data["raw"] = self.verdict.raw
        return data


class QualityBlocked(ValueError):
    """判官判出问题且闸口处于拦截档 —— 不交付。"""

    def __init__(self, problems: tuple[str, ...]) -> None:
        super().__init__(f"交付被判官拦下:{', '.join(problems)}")
        self.problems = problems


def pick_frame(count: int) -> int:
    """只判一帧 —— 判满一段等于把成本乘上帧数。

    取中间那帧而不是首帧:首帧最接近母版,正是"动作对不对"最看不出来的一帧。
    """
    return count // 2


def review(
    judge: JudgePort | None,
    frames: list[bytes],
    master: bytes | None,
    action: str,
    *,
    config: QualityGateSettings = settings,
) -> GateDecision | None:
    """判一段交付物;``None`` = 没判(没注入判官、闸口未启用,或没有可比的参照)。

    "没判"要与"判了没问题"分得开:只有后者能支持"这批产物是干净的"这句话。

    ``master`` 允许为 None:三渲二路线的帧是渲出来的,没有母版图,而判官的四问
    (主体数 / 多出的东西 / 动作对不对 / 有没有被裁)全是冲生成漂移设的,渲染路线上
    没有那个漂移。这种情形按"没判"返回 None,不是"判了没问题"。
    """
    if judge is None or master is None or not config.enabled or not frames:
        return None

    index = pick_frame(len(frames))
    try:
        verdict = judge.judge(frames[index], master, action)
    except Exception as exc:  # noqa: BLE001 —— 判官的任何故障都归"仪器坏了"
        # 仪器故障绝不拦截:拦下去等于因为我们自己的判官挂了,把用户已付费的产物扣住。
        logger.warning("判官判读失败(第 %d 帧,动作 %s):%s", index, action, exc)
        return GateDecision(frame_index=index, error=str(exc))

    problems = _problems(verdict)
    # shadow 档(``enforce`` 默认 false)只记不拦:阈值要拿 shadow 数据定,反过来先开
    # 拦截就是拍脑袋定判据,而误杀掉的是用户已付费、退不回来的产物。
    blocked = bool(problems) and config.enforce
    if problems:
        logger.info("判官在第 %d 帧读出 %s(拦截=%s)", index, problems, blocked)
    return GateDecision(
        frame_index=index, problems=problems, blocked=blocked, verdict=verdict,
    )


def _problems(verdict: JudgeVerdict) -> tuple[str, ...]:
    """四问 → 问题标签。每一条都有唯一答案,不含任何阈值。"""
    found: list[str] = []
    if verdict.subject_count > _EXPECTED_SUBJECTS:
        found.append(PROBLEM_MULTIPLE_SUBJECTS)
    elif verdict.subject_count < _EXPECTED_SUBJECTS:
        found.append(PROBLEM_NO_SUBJECT)
    if verdict.foreign_objects:
        found.append(PROBLEM_FOREIGN_OBJECTS)
    if not verdict.action_matches:
        found.append(PROBLEM_ACTION_MISMATCH)
    if verdict.clipped:
        found.append(PROBLEM_CLIPPED)
    return tuple(found)
