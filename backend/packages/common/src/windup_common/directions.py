"""角色动作的方向契约。"""

from enum import StrEnum


class ActionDirection(StrEnum):
    EAST = "east"
    WEST = "west"
    NORTH = "north"
    SOUTH = "south"
    NORTH_EAST = "north_east"
    NORTH_WEST = "north_west"
    SOUTH_EAST = "south_east"
    SOUTH_WEST = "south_west"


_REQUIRED_DIRECTIONS: dict[int, tuple[ActionDirection, ...]] = {
    1: (ActionDirection.EAST,),
    2: (
        ActionDirection.EAST,
        ActionDirection.WEST,
        ActionDirection.NORTH,
        ActionDirection.SOUTH,
    ),
    3: tuple(ActionDirection),
}


def required_directions_for_movement(movement: int) -> tuple[ActionDirection, ...]:
    """返回项目必须真实生成的方向；未知项目配置按单向兼容。"""

    return _REQUIRED_DIRECTIONS.get(movement, _REQUIRED_DIRECTIONS[1])


def is_required_direction(movement: int, direction: ActionDirection) -> bool:
    """判断请求方向是否属于该项目的真实生成集合。"""

    return direction in required_directions_for_movement(movement)


_DIRECTION_PROMPTS: dict[ActionDirection, str] = {
    ActionDirection.EAST: "The character's screen-space heading points to the right edge of the frame (east).",
    ActionDirection.WEST: "The character's screen-space heading points to the left edge of the frame (west).",
    ActionDirection.NORTH: "The character's screen-space heading points to the top edge of the frame (north).",
    ActionDirection.SOUTH: "The character's screen-space heading points to the bottom edge of the frame (south).",
    ActionDirection.NORTH_EAST: "The character's screen-space heading points to the upper-right corner of the frame (north-east).",
    ActionDirection.NORTH_WEST: "The character's screen-space heading points to the upper-left corner of the frame (north-west).",
    ActionDirection.SOUTH_EAST: "The character's screen-space heading points to the lower-right corner of the frame (south-east).",
    ActionDirection.SOUTH_WEST: "The character's screen-space heading points to the lower-left corner of the frame (south-west).",
}


def direction_prompt(direction: ActionDirection) -> str:
    """返回给图片/视频模型的强方向锁，避免模型自行转身。"""

    return (
        f"{_DIRECTION_PROMPTS[direction]} Keep the camera position, angle, and "
        "projection unchanged. Throughout every frame, the character remains oriented "
        "to this screen-space heading. The body, head, torso, hips, and feet maintain "
        "this heading. Do not turn or drift toward another direction."
    )
