"""角色名称解析：用户输入优先，空名称才走 LLM / 兜底。"""

import pytest

from windup_app.server.character.naming import FALLBACK_NAME, resolve_character_name


class _FakeNamer:
    def __init__(self, result: str = "赤发旅人", error: Exception | None = None) -> None:
        self.result = result
        self.error = error
        self.calls: list[str] = []

    def name_from_description(self, description: str) -> str:
        self.calls.append(description)
        if self.error is not None:
            raise self.error
        return self.result


def test_keeps_user_name_and_does_not_call_namer():
    namer = _FakeNamer()
    assert resolve_character_name(" 勇者 ", "一段很长的描述", namer) == "勇者"
    assert namer.calls == []


def test_trims_user_name_to_20_chars():
    assert resolve_character_name("龙" * 25, None, _FakeNamer()) == "龙" * 20


def test_blank_name_uses_namer_on_description():
    namer = _FakeNamer("雾港少年")
    assert resolve_character_name("   ", "红发少年站在雾港码头", namer) == "雾港少年"
    assert namer.calls == ["红发少年站在雾港码头"]


def test_namer_output_is_trimmed_to_20_chars():
    namer = _FakeNamer("超" * 30)
    assert resolve_character_name(None, "很长的描述", namer) == "超" * 20


def test_namer_failure_falls_back_to_description():
    namer = _FakeNamer(error=RuntimeError("timeout"))
    assert resolve_character_name(None, "码头上的红发剑士在等船", namer) == "码头上的红发剑士在等船"


def test_namer_failure_truncates_long_description():
    namer = _FakeNamer(error=RuntimeError("timeout"))
    description = "这是一段超过二十个字的角色描述用来兜底"
    assert resolve_character_name(None, description, namer) == description[:20]


def test_empty_name_and_description_use_fallback():
    namer = _FakeNamer()
    assert resolve_character_name(None, None, namer) == FALLBACK_NAME
    assert namer.calls == []


def test_empty_namer_result_falls_back_to_description():
    namer = _FakeNamer("   ")
    assert resolve_character_name(None, "银发法师", namer) == "银发法师"


def test_service_create_skips_namer_when_workflow_run_exists(db_session):
    from conftest import insert_project
    from windup_app.server.character.service import SqlAlchemyCharacterService

    project = insert_project(db_session)
    namer = _FakeNamer("第一次")
    service = SqlAlchemyCharacterService(namer=namer)
    first = service.create_character(
        db_session,
        project_id=project.id,
        workflow_run_id=77,
        name=None,
        description="红发少年",
        character_data={},
    )
    namer.result = "第二次"
    second = service.create_character(
        db_session,
        project_id=project.id,
        workflow_run_id=77,
        name=None,
        description="红发少年",
        character_data={},
    )

    assert second.id == first.id
    assert second.name == "第一次"
    assert namer.calls == ["红发少年"]


def test_service_create_skips_namer_on_cross_project_workflow_run(db_session):
    from sqlalchemy.exc import IntegrityError

    from conftest import insert_project
    from windup_app.server.character.service import SqlAlchemyCharacterService

    first_project = insert_project(db_session, project_name="项目一")
    second_project = insert_project(db_session, project_name="项目二")
    namer = _FakeNamer("第一次")
    service = SqlAlchemyCharacterService(namer=namer)
    service.create_character(
        db_session,
        project_id=first_project.id,
        workflow_run_id=88,
        name=None,
        description="红发少年",
        character_data={},
    )

    with pytest.raises(IntegrityError):
        service.create_character(
            db_session,
            project_id=second_project.id,
            workflow_run_id=88,
            name=None,
            description="另一段描述",
            character_data={},
        )

    assert namer.calls == ["红发少年"]


def test_service_create_uses_namer_when_name_missing(db_session):
    from conftest import insert_project
    from windup_app.server.character.service import SqlAlchemyCharacterService

    project = insert_project(db_session)
    service = SqlAlchemyCharacterService(namer=_FakeNamer("雾港少年"))
    character = service.create_character(
        db_session,
        project_id=project.id,
        workflow_run_id=901,
        name=None,
        description="红发少年站在雾港码头",
        character_data={},
    )
    assert character.name == "雾港少年"
