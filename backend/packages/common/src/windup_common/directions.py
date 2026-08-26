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
    ActionDirection.EAST: (
        "The character has a right-facing side orientation (east); the face, torso, "
        "hips, and feet point right."
    ),
    ActionDirection.WEST: (
        "The character has a left-facing side orientation (west); the face, torso, "
        "hips, and feet point left."
    ),
    ActionDirection.NORTH: (
        "The character faces away (north); the back of the head, back, and backs of "
        "the legs are the main visible surfaces."
    ),
    ActionDirection.SOUTH: (
        "The character faces forward (south); the face and chest, abdomen, and fronts "
        "of the legs are the main visible surfaces."
    ),
    ActionDirection.NORTH_EAST: (
        "The character has a back-right three-quarter orientation (north-east)."
    ),
    ActionDirection.NORTH_WEST: (
        "The character has a back-left three-quarter orientation (north-west)."
    ),
    ActionDirection.SOUTH_EAST: (
        "The character has a front-right three-quarter orientation (south-east)."
    ),
    ActionDirection.SOUTH_WEST: (
        "The character has a front-left three-quarter orientation (south-west)."
    ),
}


def direction_prompt(direction: ActionDirection) -> str:
    """返回给图片/视频模型的强方向锁，避免模型自行转身。"""

    return (
        f"{_DIRECTION_PROMPTS[direction]} Keep the camera position, angle, and "
        "projection unchanged. Throughout every frame, the character remains oriented "
        "to this screen-space heading. The body, head, torso, hips, and feet maintain "
        "this heading. Do not turn or drift toward another direction."
    )
