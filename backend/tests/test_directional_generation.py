"""多方向生成契约的最小测试。

这些测试先锁住跨层共同约定，再让 API、编排器和前端分别实现：
真实源方向各自生成，镜像方向只保存关系，不重复调用模型。
"""

from windup_ai_engine.strategy.concrete import VideoFrameStrategy
from windup_common.directions import (
    ActionDirection,
    compass_directions_for_movement,
    derived_direction_pairs_for_movement,
    required_directions_for_movement,
)
from windup_common.models import ActionSpec, ActionType, CharacterStance, Facing


def test_direction_profile_requires_one_four_or_eight_real_tasks():
    assert required_directions_for_movement(1) == (ActionDirection.EAST,)
    assert required_directions_for_movement(2) == (
        ActionDirection.EAST,
        ActionDirection.NORTH,
        ActionDirection.SOUTH,
    )
    assert required_directions_for_movement(3) == (
        ActionDirection.EAST,
        ActionDirection.NORTH,
        ActionDirection.SOUTH,
        ActionDirection.NORTH_EAST,
        ActionDirection.SOUTH_EAST,
    )


def test_west_side_directions_are_mirrors_not_generation_sources():
    assert ActionDirection.WEST not in required_directions_for_movement(2)
    assert ActionDirection.NORTH_WEST not in required_directions_for_movement(3)
    assert ActionDirection.SOUTH_WEST not in required_directions_for_movement(3)
    assert derived_direction_pairs_for_movement(2) == (
        (ActionDirection.WEST, ActionDirection.EAST),
    )
    assert compass_directions_for_movement(2) == (
        ActionDirection.EAST,
        ActionDirection.WEST,
        ActionDirection.NORTH,
        ActionDirection.SOUTH,
    )


def test_every_action_direction_has_an_independent_provider_prompt_lock():
    strategy = VideoFrameStrategy(video=None, matte=None)  # type: ignore[arg-type]
    prompts = {
        direction: strategy._build_prompt(
            ActionSpec(
                action=ActionType.WALK,
                facing=Facing.SIDE,
                direction=direction,
            ),
            CharacterStance.BIPED,
        )
        for direction in ActionDirection
    }

    assert len(set(prompts.values())) == len(ActionDirection)
    for direction, prompt in prompts.items():
        assert direction.value.replace("_", "-") in prompt.lower()
        assert "throughout every frame" in prompt.lower()
        assert "maintain this heading" in prompt.lower()
        assert "rotate" not in prompt.lower()
        assert "do not turn" in prompt.lower()
