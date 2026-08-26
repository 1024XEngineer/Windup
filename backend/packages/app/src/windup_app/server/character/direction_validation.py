"""按项目规格校验 CharacterData 的方向完整性。"""

from windup_app.server.character.model import (
    CharacterActionSequence,
    CharacterData,
    CharacterTemplateSequence,
)
from windup_common.directions import (
    ActionDirection,
    compass_directions_for_movement,
    derived_direction_pairs_for_movement,
    required_directions_for_movement,
)


def _real_directions(
    items: list[CharacterTemplateSequence] | list[CharacterActionSequence],
) -> set[ActionDirection]:
    return {
        ActionDirection(item.direction)
        for item in items
        if item.source_direction is None and not item.mirror_x
    }


def _format_directions(directions: set[ActionDirection]) -> str:
    return "、".join(direction.value for direction in ActionDirection if direction in directions)


def _validate_required_mirrors(
    items: list[CharacterTemplateSequence] | list[CharacterActionSequence],
    movement: int,
    *,
    label: str,
) -> None:
    by_direction = {ActionDirection(item.direction): item for item in items}
    for dst, src in derived_direction_pairs_for_movement(movement):
        item = by_direction.get(dst)
        if item is None:
            raise ValueError(f"{label}缺少镜像方向：{dst.value}")
        if not item.mirror_x or item.source_direction != src.value:
            raise ValueError(f"{label}方向 {dst.value} 必须镜像 {src.value}")


def _validate_single_derivations(data: CharacterData) -> None:
    for item in [
        *data.templates,
        *(
            sequence
            for outfit in data.outfits
            for action in outfit.actions
            for sequence in action.sequences
        ),
    ]:
        if item.source_direction is None:
            if item.direction != ActionDirection.EAST:
                raise ValueError(f"单向资产包含不支持的真实方向：{item.direction}")
            continue
        if not (
            item.direction == ActionDirection.WEST
            and item.source_direction == ActionDirection.EAST
            and item.mirror_x
        ):
            raise ValueError(f"单向资产包含无效派生方向：{item.direction}")


def validate_character_directions(
    data: CharacterData,
    movement: int,
    *,
    require_complete: bool,
) -> None:
    """校验 CharacterData 是否满足项目的 1/4/8 向合同。

    Pydantic 模型负责数据结构；此函数只处理依赖项目配置和版本的规则。
    ``require_complete=False`` 用于读取或保存尚未完成的草稿。
    """

    if not require_complete:
        return
    if data.version < 2:
        if movement == 1:
            return
        raise ValueError("旧版镜像资产不能作为完整的多方向资产发布")

    sources = set(required_directions_for_movement(movement))
    allowed = set(compass_directions_for_movement(movement))
    if movement == 1:
        _validate_single_derivations(data)

    real_templates = _real_directions(data.templates)
    missing_templates = sources - real_templates
    if missing_templates:
        raise ValueError(f"角色母版缺少真实方向：{_format_directions(missing_templates)}")
    unexpected_templates = {
        ActionDirection(template.direction) for template in data.templates
    } - allowed
    if unexpected_templates:
        raise ValueError(
            f"角色母版包含规格外方向：{_format_directions(unexpected_templates)}"
        )
    if movement != 1:
        _validate_required_mirrors(data.templates, movement, label="角色母版")

    for outfit in data.outfits:
        for action in outfit.actions:
            real_sequences = _real_directions(action.sequences)
            missing_sequences = sources - real_sequences
            if missing_sequences:
                raise ValueError(
                    f"动作 {action.id} 缺少真实方向：{_format_directions(missing_sequences)}"
                )
            unexpected_sequences = {
                ActionDirection(sequence.direction) for sequence in action.sequences
            } - allowed
            if unexpected_sequences:
                raise ValueError(
                    f"动作 {action.id} 包含规格外方向："
                    f"{_format_directions(unexpected_sequences)}"
                )
            if movement != 1:
                _validate_required_mirrors(
                    action.sequences, movement, label=f"动作 {action.id}"
                )
