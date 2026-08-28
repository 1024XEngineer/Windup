-- 为存量角色资产补齐 PlayTest / Export 共享的资产版本字段。
-- 这些字段位于 windup_character.character_data JSONB，不是独立 SQL 列。
-- COALESCE + jsonb_set 使迁移可安全重复执行，并保留已有处理结果。
BEGIN;

UPDATE windup_character AS character
SET character_data = jsonb_set(
    character.character_data,
    '{outfits}',
    (
        SELECT COALESCE(jsonb_agg(
            jsonb_set(
                outfit_item.outfit,
                '{actions}',
                (
                    SELECT COALESCE(jsonb_agg(
                        jsonb_set(
                            action_item.action,
                            '{sequences}',
                            (
                                SELECT COALESCE(jsonb_agg(
                                    jsonb_set(
                                        sequence_item.sequence,
                                        '{frames}',
                                        (
                                            SELECT COALESCE(jsonb_agg(
                                                jsonb_set(
                                                    frame_item.frame,
                                                    '{pixel_perfect_image_url}',
                                                    COALESCE(frame_item.frame->'pixel_perfect_image_url', 'null'::jsonb),
                                                    true
                                                )
                                                ORDER BY frame_item.frame_ord
                                            ), '[]'::jsonb)
                                            FROM jsonb_array_elements(
                                                COALESCE(sequence_item.sequence->'frames', '[]'::jsonb)
                                            ) WITH ORDINALITY AS frame_item(frame, frame_ord)
                                        ),
                                        true
                                    )
                                    ORDER BY sequence_item.sequence_ord
                                ), '[]'::jsonb)
                                FROM jsonb_array_elements(
                                    COALESCE(action_item.action->'sequences', '[]'::jsonb)
                                ) WITH ORDINALITY AS sequence_item(sequence, sequence_ord)
                            ),
                            true
                        )
                        ORDER BY action_item.action_ord
                    ), '[]'::jsonb)
                    FROM jsonb_array_elements(
                        COALESCE(outfit_item.outfit->'actions', '[]'::jsonb)
                    ) WITH ORDINALITY AS action_item(action, action_ord)
                ),
                true
            )
            ORDER BY outfit_item.outfit_ord
        ), '[]'::jsonb)
        FROM jsonb_array_elements(
            COALESCE(character.character_data->'outfits', '[]'::jsonb)
        ) WITH ORDINALITY AS outfit_item(outfit, outfit_ord)
    ),
    true
)
WHERE jsonb_typeof(character.character_data->'outfits') = 'array';

-- 顶层 frames 是旧版 / 单向动作的兼容入口，也要补齐同一字段。
UPDATE windup_character AS character
SET character_data = jsonb_set(
    character.character_data,
    '{outfits}',
    (
        SELECT COALESCE(jsonb_agg(
            jsonb_set(
                outfit_item.outfit,
                '{actions}',
                (
                    SELECT COALESCE(jsonb_agg(
                        jsonb_set(
                            action_item.action,
                            '{preferred_version}',
                            COALESCE(action_item.action->'preferred_version', '"original"'::jsonb),
                            true
                        )
                        || jsonb_build_object(
                            'frames', COALESCE((
                                SELECT jsonb_agg(
                                    jsonb_set(
                                        frame_item.frame,
                                        '{pixel_perfect_image_url}',
                                        COALESCE(frame_item.frame->'pixel_perfect_image_url', 'null'::jsonb),
                                        true
                                    )
                                    ORDER BY frame_item.frame_ord
                                )
                                FROM jsonb_array_elements(
                                    COALESCE(action_item.action->'frames', '[]'::jsonb)
                                ) WITH ORDINALITY AS frame_item(frame, frame_ord)
                            ), '[]'::jsonb)
                        )
                        ORDER BY action_item.action_ord
                    ), '[]'::jsonb)
                    FROM jsonb_array_elements(
                        COALESCE(outfit_item.outfit->'actions', '[]'::jsonb)
                    ) WITH ORDINALITY AS action_item(action, action_ord)
                ),
                true
            )
            ORDER BY outfit_item.outfit_ord
        ), '[]'::jsonb)
        FROM jsonb_array_elements(
            COALESCE(character.character_data->'outfits', '[]'::jsonb)
        ) WITH ORDINALITY AS outfit_item(outfit, outfit_ord)
    ),
    true
)
WHERE jsonb_typeof(character.character_data->'outfits') = 'array';

COMMIT;
