"""四向 / 八向立绘 sheet 执行器:图生图次数、翻转、3×3 拼装。"""

from __future__ import annotations

import io

import pytest
from PIL import Image
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from windup_app.server.orchestrator.model import (
    CharacterViewSheetInput,
    CharacterViewSheetOutput,
    GenerationType,
    TaskStatus,
)
from windup_app.server.orchestrator.service import AiGenerationService
from windup_app.server.orchestrator.view_sheet_executor import (
    ViewSheetTaskExecutor,
    compose_compass_sheet,
    flip_horizontal,
)
from windup_app.server.quota.model import CreditAccount
from windup_common.directions import ActionDirection
from windup_framework.db.base import Base

_MASTER_URL = "https://cdn.example.com/masters/south.png"
_W, _H = 64, 96


@pytest.fixture
def sheet_session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as session:
        session.add(
            CreditAccount(
                user_id=1,
                balance=1_000,
                frozen=0,
                total_earned=1_000,
                total_spent=0,
            )
        )
        session.commit()
    yield factory
    engine.dispose()


def _png(color: tuple[int, int, int, int], *, mark: tuple[int, int, tuple[int, int, int, int]] | None = None) -> bytes:
    im = Image.new("RGBA", (_W, _H), color)
    if mark is not None:
        x, y, mark_color = mark
        im.putpixel((x, y), mark_color)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def _sheet_input() -> CharacterViewSheetInput:
    return CharacterViewSheetInput(
        character_id=42,
        reference_image_url=_MASTER_URL,
        prompt="像素风勇者",
        width=_W,
        height=_H,
    )


def _open(png: bytes) -> Image.Image:
    return Image.open(io.BytesIO(png)).convert("RGBA")


SOUTH = _png((200, 40, 40, 255))
EAST = _png((40, 180, 40, 255), mark=(_W - 1, _H // 2, (255, 255, 255, 255)))
NORTH = _png((40, 40, 200, 255))
NORTH_EAST = _png((180, 40, 180, 255))
SOUTH_EAST = _png((40, 180, 180, 255))

_BY_PROMPT = (
    ("ninety-degree", EAST),
    ("one-hundred-eighty", NORTH),
    ("one-hundred-thirty-five", NORTH_EAST),
    ("forty-five-degree", SOUTH_EAST),
)


class _Matte:
    def cutout(self, png):
        return png


def _gen(prompts: list[str]):
    class _Gen:
        def gen_image(self, prompt, refs):
            prompts.append(prompt)
            assert refs == [SOUTH]
            for needle, png in _BY_PROMPT:
                if needle in prompt:
                    return png
            raise AssertionError(f"未识别朝向提示词: {prompt[:80]!r}")

    return _Gen()


def test_flip_horizontal_moves_mark_to_the_opposite_edge():
    flipped = _open(flip_horizontal(EAST))
    assert flipped.size == (_W, _H)
    assert flipped.getpixel((0, _H // 2)) == (255, 255, 255, 255)
    assert flipped.getpixel((_W - 1, _H // 2)) != (255, 255, 255, 255)


def test_four_view_compass_leaves_corners_and_center_empty():
    west = flip_horizontal(EAST)
    sheet = _open(
        compose_compass_sheet(
            {
                ActionDirection.NORTH: NORTH,
                ActionDirection.WEST: west,
                ActionDirection.EAST: EAST,
                ActionDirection.SOUTH: SOUTH,
            },
            _W,
            _H,
        )
    )
    assert sheet.size == (3 * _W, 3 * _H)
    empty = (0, 0, 0, 0)
    assert sheet.getpixel((0, 0)) == empty
    assert sheet.getpixel((3 * _W - 1, 0)) == empty
    assert sheet.getpixel((0, 3 * _H - 1)) == empty
    assert sheet.getpixel((3 * _W - 1, 3 * _H - 1)) == empty
    assert sheet.getpixel((_W + _W // 2, _H + _H // 2)) == empty
    assert sheet.getpixel((_W + _W // 2, 2 * _H + _H // 2)) == (200, 40, 40, 255)
    assert sheet.getpixel((2 * _W + _W - 1, _H + _H // 2)) == (255, 255, 255, 255)
    assert sheet.getpixel((0, _H + _H // 2)) == (255, 255, 255, 255)


def test_four_view_calls_model_twice_reuses_south_and_uploads_flipped_west(
    sheet_session_factory,
):
    prompts: list[str] = []
    uploaded: dict[str, bytes] = {}
    n = 0

    def upload(png: bytes) -> str:
        nonlocal n
        n += 1
        url = f"https://cdn.example.com/{n}-{id(png)}.png"
        uploaded[url] = png
        return url

    executor = ViewSheetTaskExecutor(
        image=_gen(prompts),
        matte=_Matte(),
        upload=upload,
        fetch_ref=lambda url: SOUTH if url == _MASTER_URL else pytest.fail(url),
        session_factory=sheet_session_factory,
    )
    with sheet_session_factory() as session:
        task = AiGenerationService().generate_character_four_view(
            session, user_id=1, project_id=7, input=_sheet_input(),
        )
        session.commit()
        task_id = task.id

    executor.run_four_view_task(task_id, _sheet_input(), project_id=None)

    with sheet_session_factory() as session:
        done = AiGenerationService().get_task(session, project_id=7, task_id=task_id)

    assert done.status is TaskStatus.COMPLETED
    assert isinstance(done.result, CharacterViewSheetOutput)
    assert done.result.type == GenerationType.CHARACTER_FOUR_VIEW.value
    assert len(prompts) == 2
    assert all("ninety-degree" in p or "one-hundred-eighty" in p for p in prompts)
    assert not any("forty-five-degree" in p for p in prompts)
    assert not any("two-hundred-seventy" in p for p in prompts)

    sheet = done.result.sheets[0]
    by_dir = {cell.direction: cell for cell in sheet.cells}
    assert set(by_dir) == {
        ActionDirection.SOUTH,
        ActionDirection.EAST,
        ActionDirection.NORTH,
        ActionDirection.WEST,
    }
    assert by_dir[ActionDirection.SOUTH].image_url == _MASTER_URL
    assert by_dir[ActionDirection.WEST].mirror_x is True
    assert by_dir[ActionDirection.WEST].source_direction is ActionDirection.EAST
    assert by_dir[ActionDirection.EAST].mirror_x is False

    # south 不重传;东/北/西 + sheet = 4
    assert len(uploaded) == 4
    west_png = uploaded[by_dir[ActionDirection.WEST].image_url]
    assert _open(west_png).getpixel((0, _H // 2)) == (255, 255, 255, 255)
    composed = _open(uploaded[sheet.sheet_url])
    assert composed.size == (3 * _W, 3 * _H)
    assert composed.getpixel((0, 0))[3] == 0
    assert sheet.sheet_url in uploaded


def test_eight_view_generates_diagonals_and_three_mirrors(sheet_session_factory):
    prompts: list[str] = []

    def upload(png: bytes) -> str:
        return f"https://cdn.example.com/{id(png)}.png"

    executor = ViewSheetTaskExecutor(
        image=_gen(prompts),
        matte=_Matte(),
        upload=upload,
        fetch_ref=lambda url: SOUTH,
        session_factory=sheet_session_factory,
    )
    with sheet_session_factory() as session:
        task = AiGenerationService().generate_character_eight_view(
            session, user_id=1, project_id=7, input=_sheet_input(),
        )
        session.commit()
        task_id = task.id

    executor.run_eight_view_task(task_id, _sheet_input(), project_id=None)

    with sheet_session_factory() as session:
        done = AiGenerationService().get_task(session, project_id=7, task_id=task_id)

    assert done.status is TaskStatus.COMPLETED
    assert len(prompts) == 4
    assert any("one-hundred-thirty-five" in p for p in prompts)
    assert any("forty-five-degree" in p for p in prompts)
    cells = done.result.sheets[0].cells
    assert len(cells) == 8
    mirrors = {c.direction: c for c in cells if c.mirror_x}
    assert set(mirrors) == {
        ActionDirection.WEST,
        ActionDirection.NORTH_WEST,
        ActionDirection.SOUTH_WEST,
    }
    assert mirrors[ActionDirection.NORTH_WEST].source_direction is ActionDirection.NORTH_EAST


def test_view_sheet_failure_fails_the_whole_task(sheet_session_factory):
    class _Boom:
        def gen_image(self, prompt, refs):
            raise RuntimeError("north provider failed")

    executor = ViewSheetTaskExecutor(
        image=_Boom(),
        matte=_Matte(),
        upload=lambda png: "https://cdn.example.com/x.png",
        fetch_ref=lambda url: SOUTH,
        session_factory=sheet_session_factory,
    )
    with sheet_session_factory() as session:
        task = AiGenerationService().generate_character_four_view(
            session, user_id=1, project_id=7, input=_sheet_input(),
        )
        session.commit()
        task_id = task.id

    executor.run_four_view_task(task_id, _sheet_input(), project_id=None)

    with sheet_session_factory() as session:
        done = AiGenerationService().get_task(session, project_id=7, task_id=task_id)
        account = session.scalar(select(CreditAccount).where(CreditAccount.user_id == 1))

    assert done.status is TaskStatus.FAILED
    assert done.result is None
    assert account.frozen == 0


def test_view_sheet_prompt_follows_master_not_project_style():
    from windup_app.server.orchestrator.executor import ProjectConstraints

    prompts: list[str] = []
    executor = ViewSheetTaskExecutor(
        image=_gen(prompts),
        matte=_Matte(),
        upload=lambda png: "https://cdn.example.com/x.png",
        fetch_ref=lambda url: SOUTH,
    )
    executor._produce_sheets(
        _sheet_input(),
        GenerationType.CHARACTER_FOUR_VIEW,
        ProjectConstraints(style="中世纪厚涂", perspective=2, stylize="pixel"),
    )
    assert prompts
    assert all("Art style" not in p and "中世纪厚涂" not in p for p in prompts)
    assert all("thirty to forty-five degrees" in p for p in prompts)
    assert all("像素风勇者" in p for p in prompts)
