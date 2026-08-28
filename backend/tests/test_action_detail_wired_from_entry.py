"""入口的 custom_prompt 必须一路走到引擎的 ActionSpec.detail(#838)。

引擎侧修好而入口不接,是本仓最典型的静默失败:契约字段填了却没人写,生产链路照旧
走缺省值,而单测全绿。这条从 ``CharacterActionInput`` 出发,断言的是**生产真正调用
的那个方法**(``ActionTaskExecutor._action_spec``)造出来的 ActionSpec。
"""
from __future__ import annotations

import pytest

from windup_app.server.orchestrator.executor import (
    ActionTaskExecutor,
    ProjectConstraints,
)
from windup_app.server.orchestrator.model import ActionType, CharacterActionInput
from windup_common.models import ActionSpec

DOG = "一只小狗低头在饭碗里吃饭，前爪支撑身体，持续舔食或咀嚼。"
CONS = ProjectConstraints(facing="side", stylize="pixel", sprite_w=256, sprite_h=256)


def _spec(**kw) -> ActionSpec:
    inp = CharacterActionInput(character_id=1, num_frames=6, **kw)
    # 只测输入→ActionSpec 这一段,不构造整个 executor(它要 DB / 网关 / 会话工厂)。
    _card, spec, _canvas = ActionTaskExecutor._action_spec(object(), inp, CONS)
    return spec


@pytest.mark.parametrize(
    "action_type",
    [ActionType.WALK, ActionType.IDLE, ActionType.JUMP, ActionType.ATTACK],
    ids=lambda a: a.value,
)
def test_custom_prompt_lands_in_action_spec_detail(action_type):
    """写死的四个动作:用户那句话必须出现在 ActionSpec.detail 上。

    生产 124/124 条这类任务原先都丢在这一步 —— custom_prompt 只进了
    CharacterCard.desc,而视频路线不读 desc。
    """
    assert _spec(action_type=action_type, custom_prompt=DOG).detail == DOG


def test_custom_action_type_still_uses_custom_action_not_detail():
    """custom 走的是另一半契约:整条描述进 custom_action,detail 必须为空。

    两个都填会让同一段话进两次提示词(ActionSpec 的校验器会炸)。
    """
    spec = _spec(action_type=ActionType.CUSTOM, custom_prompt=DOG, loop=False)
    assert spec.custom_action == DOG
    assert spec.detail is None


@pytest.mark.parametrize("blank", [None, "", "   "])
def test_a_blank_custom_prompt_leaves_detail_unset(blank):
    """绝大多数存量任务这里是空的,不能因此掉进带细节那一支。"""
    assert _spec(action_type=ActionType.WALK, custom_prompt=blank).detail is None
