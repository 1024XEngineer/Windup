"""多方向生成契约的最小测试。

这些测试先锁住跨层共同约定，再让 API、编排器和前端分别实现：
真实源方向各自生成，镜像方向只保存关系，不重复调用模型。
"""

from windup_ai_engine.strategy.concrete import VideoFrameStrategy
from windup_common.directions import (
    ActionDirection,
    required_directions_for_movement,
)
from windup_common.models import ActionSpec, ActionType, CharacterStance, Facing


def test_direction_profile_requires_one_four_or_eight_real_tasks():
    assert required_directions_for_movement(1) == (ActionDirection.EAST,)
    assert required_directions_for_movement(2) == (
        ActionDirection.EAST,
        ActionDirection.WEST,
        ActionDirection.NORTH,
        ActionDirection.SOUTH,
    )
    assert required_directions_for_movement(3) == tuple(ActionDirection)


def test_west_side_directions_are_real_generation_sources_for_multi_direction_projects():
    assert ActionDirection.WEST in required_directions_for_movement(2)
    assert ActionDirection.NORTH_WEST in required_directions_for_movement(3)
    assert ActionDirection.SOUTH_WEST in required_directions_for_movement(3)


def test_action_prompt_contains_direction_lock():
    strategy = VideoFrameStrategy(video=None, matte=None)  # type: ignore[arg-type]
    prompt = strategy._build_prompt(
        ActionSpec(
            action=ActionType.WALK,
            facing=Facing.SIDE,
            direction=ActionDirection.NORTH_EAST,
        ),
        CharacterStance.BIPED,
    )

    assert "north-east" in prompt.lower()
    assert "do not turn" in prompt.lower()
