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
    ActionDirection.EAST: "The character faces and moves to the right, in the east direction.",
    ActionDirection.WEST: "The character faces and moves to the left, in the west direction.",
    ActionDirection.NORTH: "The character faces away from the viewer, toward the north direction.",
    ActionDirection.SOUTH: "The character faces toward the viewer, toward the south direction.",
    ActionDirection.NORTH_EAST: "The character faces diagonally away from the viewer and to the right, toward north-east.",
    ActionDirection.NORTH_WEST: "The character faces diagonally away from the viewer and to the left, toward north-west.",
    ActionDirection.SOUTH_EAST: "The character faces diagonally toward the viewer and to the right, toward south-east.",
    ActionDirection.SOUTH_WEST: "The character faces diagonally toward the viewer and to the left, toward south-west.",
}


def direction_prompt(direction: ActionDirection) -> str:
    """返回给图片/视频模型的强方向锁，避免模型自行转身。"""

    return (
        f"{_DIRECTION_PROMPTS[direction]} Keep this direction unchanged; do not turn."
    )
