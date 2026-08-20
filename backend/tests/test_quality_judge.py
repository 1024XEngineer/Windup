"""判官 provider 与出门闸口(不联网:httpx MockTransport,不产生任何费用)。

桩是个真去数提交上来的图里有几个主体的假模型,不是一条写死的回答:写死回答只能证明
"我们会解析 JSON",而请求形状、base64、参考图顺序错了它一条都发现不了。
"""

from __future__ import annotations

import base64
import io
import json
import re

import httpx
import pytest
from PIL import Image

from conftest import seed_credit_account
from windup_ai_engine.ports import JudgePort
from windup_app.server.orchestrator import quality_gate
from windup_common.models import JudgeVerdict
from windup_framework.config.provider import AIProviderSettings
from windup_framework.config.quality_gate import QualityGateSettings
from windup_framework.providers.judge import (
    JudgeResponseError,
    SufyJudgeProvider,
    _parse_verdict,
)

GATEWAY = "https://gw.invalid/v1"


def _cfg() -> AIProviderSettings:
    return AIProviderSettings(base_url=GATEWAY, api_key="test-key", judge_model="judge-x")


def _png(subjects: int, size: int = 96) -> bytes:
    """白底 + N 个不相接的黑块 —— "已知有几个主体"的合成图。"""
    im = Image.new("RGB", (size, size), (255, 255, 255))
    px = im.load()
    for n in range(subjects):
        left = 8 + n * 40
        for x in range(left, left + 20):
            for y in range(20, size - 20):
                px[x, y] = (0, 0, 0)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def _count_subjects(png: bytes) -> int:
    """数图里有几段互不相接的暗列 —— 假模型的"视觉"。"""
    im = Image.open(io.BytesIO(png)).convert("L")
    w, h = im.size
    px = im.load()
    dark = [any(px[x, y] < 128 for y in range(h)) for x in range(w)]
    return sum(1 for x in range(w) if dark[x] and not (x and dark[x - 1]))


def _oracle_handler(seen: list[dict]):
    """假模型:记下请求体,数**第二张**图(生成帧)的主体数,按契约回一段 JSON。"""

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(body)
        parts = body["messages"][0]["content"]
        images = [p for p in parts if p["type"] == "image_url"]
        frame = base64.b64decode(images[1]["image_url"]["url"].split(",", 1)[1])
        answer = {
            "subject_count": _count_subjects(frame),
            "foreign_objects": [],
            "action_matches": True,
            "clipped": False,
        }
        return httpx.Response(200, json={
            "choices": [{"message": {"content": json.dumps(answer)}}]
        })

    return handler


def _provider(monkeypatch, handler) -> SufyJudgeProvider:
    """把 provider 的 client 换成走 MockTransport 的,保留它自己组的 headers / base_url。"""
    provider = SufyJudgeProvider(config=_cfg())
    real = httpx.Client

    def factory(**kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real(**kwargs)

    monkeypatch.setattr("windup_framework.providers.sufy.httpx.Client", factory)
    return provider


# ── 控制样本:已知答案的合成图 ──────────────────────────────────────────────


def test_control_sample_two_subjects(monkeypatch):
    """喂已知双主体的合成图 → subject_count ≥ 2。"""
    seen: list[dict] = []
    provider = _provider(monkeypatch, _oracle_handler(seen))
    verdict = provider.judge(_png(2), _png(1), "walk")
    assert verdict.subject_count >= 2


def test_control_sample_single_subject(monkeypatch):
    """喂已知单主体的合成图 → subject_count == 1。"""
    seen: list[dict] = []
    provider = _provider(monkeypatch, _oracle_handler(seen))
    verdict = provider.judge(_png(1), _png(1), "walk")
    assert verdict.subject_count == 1


def test_control_sample_fixture_itself_is_discriminating():
    """先验仪器:合成图本身若数不出差别,上面两条就是同一个断言跑了两遍。"""
    assert _count_subjects(_png(1)) == 1
    assert _count_subjects(_png(2)) == 2


# ── 请求形状 ────────────────────────────────────────────────────────────────


def test_request_carries_both_images_and_demands_json(monkeypatch):
    """母版在前、生成帧在后,两张都以 image_url 送出,且明确要了 JSON。"""
    seen: list[dict] = []
    provider = _provider(monkeypatch, _oracle_handler(seen))
    master, frame = _png(1), _png(2)
    provider.judge(frame, master, "attack")

    body = seen[0]
    assert body["model"] == "judge-x"
    parts = body["messages"][0]["content"]
    images = [p for p in parts if p["type"] == "image_url"]
    assert len(images) == 2, "母版与生成帧都要送,少一张就答不了'多出来的物体'"
    urls = [p["image_url"]["url"] for p in images]
    assert all(u.startswith("data:image/png;base64,") for u in urls)
    assert base64.b64decode(urls[0].split(",", 1)[1]) == master
    assert base64.b64decode(urls[1].split(",", 1)[1]) == frame

    assert body["response_format"] == {"type": "json_object"}
    prompt = next(p["text"] for p in parts if p["type"] == "text")
    assert "JSON" in prompt
    assert "attack" in prompt, "动作类别要进提示词,否则第三问无从判起"
    assert body["temperature"] == 0


def test_request_hits_chat_completions_with_bearer(monkeypatch):
    seen_requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_requests.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({
            "subject_count": 1, "foreign_objects": [],
            "action_matches": True, "clipped": False,
        })}}]})

    provider = _provider(monkeypatch, handler)
    provider.judge(_png(1), _png(1), "idle")

    request = seen_requests[0]
    assert str(request.url) == f"{GATEWAY}/chat/completions"
    assert request.headers["Authorization"] == "Bearer test-key"


# ── 读不出结论必须抛错,不得兜底成"通过" ────────────────────────────────────


@pytest.mark.parametrize("text", [
    "sure, the frame looks great!",
    "",
    "[1, 2, 3]",
    '{"subject_count": 1, "foreign_objects": []}',
    '{"subject_count": "one", "foreign_objects": [], "action_matches": true, "clipped": false}',
    '{"subject_count": true, "foreign_objects": [], "action_matches": true, "clipped": false}',
    '{"subject_count": -1, "foreign_objects": [], "action_matches": true, "clipped": false}',
    '{"subject_count": 1, "foreign_objects": "none", "action_matches": true, "clipped": false}',
    '{"subject_count": 1, "foreign_objects": [7], "action_matches": true, "clipped": false}',
    '{"subject_count": 1, "foreign_objects": [], "action_matches": "yes", "clipped": false}',
    '{"subject_count": 1, "foreign_objects": [], "action_matches": true, "clipped": 0}',
])
def test_unreadable_answer_raises(text):
    with pytest.raises(JudgeResponseError):
        _parse_verdict(text)


def test_provider_propagates_parse_failure(monkeypatch):
    """整条通路上也不能被吞掉 —— 静默放行比拦错更糟。"""
    provider = _provider(monkeypatch, lambda req: httpx.Response(
        200, json={"choices": [{"message": {"content": "looks fine to me"}}]}
    ))
    with pytest.raises(JudgeResponseError):
        provider.judge(_png(1), _png(1), "walk")


def test_content_as_parts_array_is_accepted(monkeypatch):
    """有的网关把正文包成 parts 数组;两种形状都要读得出来。"""
    answer = json.dumps({
        "subject_count": 1, "foreign_objects": [],
        "action_matches": True, "clipped": False,
    })
    provider = _provider(monkeypatch, lambda req: httpx.Response(200, json={
        "choices": [{"message": {"content": [{"type": "text", "text": answer}]}}]
    }))
    assert provider.judge(_png(1), _png(1), "walk").subject_count == 1


def test_unreadable_content_shape_raises(monkeypatch):
    provider = _provider(monkeypatch, lambda req: httpx.Response(200, json={
        "choices": [{"message": {"content": {"unexpected": "shape"}}}]
    }))
    with pytest.raises(JudgeResponseError):
        provider.judge(_png(1), _png(1), "walk")


def test_missing_content_raises(monkeypatch):
    provider = _provider(monkeypatch, lambda req: httpx.Response(200, json={"choices": []}))
    with pytest.raises(JudgeResponseError):
        provider.judge(_png(1), _png(1), "walk")


def test_code_fence_is_stripped_not_a_fallback():
    verdict = _parse_verdict(
        '```json\n{"subject_count": 2, "foreign_objects": ["sword"], '
        '"action_matches": false, "clipped": true}\n```'
    )
    assert verdict.subject_count == 2
    assert verdict.foreign_objects == ("sword",)
    assert verdict.action_matches is False
    assert verdict.clipped is True
    assert "sword" in verdict.raw, "原话要原样留着,复核判读对不对全靠它"


def test_verdict_has_no_score_field():
    """出参里不能有分数:一有分数就会有人拿它卡阈值,而那卡的是噪声。"""
    assert not any(
        re.search(r"score|rating|grade", name)
        for name in JudgeVerdict.__dataclass_fields__
    )


def test_provider_satisfies_judge_port():
    assert isinstance(SufyJudgeProvider(config=_cfg()), JudgePort)


def test_shared_face_keeps_each_capability_own_timeout():
    """共用管道不能抹掉各能力自己的超时:出图比一次问答慢得多。"""
    from windup_framework.providers.sufy import _IMAGE_TIMEOUT_MULTIPLIER, SufyImageProvider

    config = _cfg()
    for provider, want in (
        (SufyJudgeProvider(config=config), config.timeout),
        (SufyImageProvider(config=config), config.timeout * _IMAGE_TIMEOUT_MULTIPLIER),
    ):
        client = provider._client()
        try:
            assert client.timeout.read == want
        finally:
            client.close()


# ── 闸口:shadow 记录、不拦截 ───────────────────────────────────────────────


class _StubJudge:
    def __init__(self, verdict: JudgeVerdict | Exception) -> None:
        self._verdict = verdict
        self.calls: list[tuple[bytes, bytes, str]] = []

    def judge(self, frame: bytes, master: bytes, action: str) -> JudgeVerdict:
        self.calls.append((frame, master, action))
        if isinstance(self._verdict, Exception):
            raise self._verdict
        return self._verdict


def _verdict(**kw) -> JudgeVerdict:
    base = {
        "subject_count": 1, "foreign_objects": (), "action_matches": True,
        "clipped": False, "raw": "{}",
    }
    return JudgeVerdict(**{**base, **kw})


_FRAMES = [b"f0", b"f1", b"f2"]
_MASTER = b"m"
_SHADOW = QualityGateSettings(enabled=True, enforce=False)
_ENFORCING = QualityGateSettings(enabled=True, enforce=True)


def test_gate_off_never_calls_the_judge():
    """默认关 = 一次付费调用都不发。"""
    judge = _StubJudge(_verdict())
    decision = quality_gate.review(
        judge, _FRAMES, _MASTER, "walk", config=QualityGateSettings(),
    )
    assert decision is None
    assert judge.calls == []


def test_no_judge_injected_returns_none():
    assert quality_gate.review(None, _FRAMES, _MASTER, "walk", config=_SHADOW) is None


def test_no_master_returns_none_instead_of_judging_against_nothing():
    """三渲二路线没有母版图,而判官的四问全是冲生成漂移设的。

    实测这一支会 UnboundLocalError:编排层只在 i2v 那支取母版,而闸口无条件读它 ——
    崩只发生在造型带 3D 资产时,i2v 的测试一条都不会红。
    """
    judge = _StubJudge(_verdict())
    assert quality_gate.review(judge, _FRAMES, None, "walk", config=_SHADOW) is None
    assert judge.calls == [], "没有参照还是把图送去判了,那笔钱是白花的"


def test_shadow_records_problems_without_blocking():
    judge = _StubJudge(_verdict(subject_count=2, clipped=True))
    decision = quality_gate.review(judge, _FRAMES, _MASTER, "walk", config=_SHADOW)
    assert decision.problems == (
        quality_gate.PROBLEM_MULTIPLE_SUBJECTS, quality_gate.PROBLEM_CLIPPED,
    )
    assert decision.blocked is False
    payload = decision.as_payload()
    assert payload["subject_count"] == 2 and payload["blocked"] is False


def test_clean_verdict_has_no_problems():
    decision = quality_gate.review(
        _StubJudge(_verdict()), _FRAMES, _MASTER, "walk", config=_SHADOW,
    )
    assert decision.problems == ()
    assert decision.blocked is False


@pytest.mark.parametrize("kw,expected", [
    ({"subject_count": 0}, quality_gate.PROBLEM_NO_SUBJECT),
    ({"subject_count": 3}, quality_gate.PROBLEM_MULTIPLE_SUBJECTS),
    ({"foreign_objects": ("chair",)}, quality_gate.PROBLEM_FOREIGN_OBJECTS),
    ({"action_matches": False}, quality_gate.PROBLEM_ACTION_MISMATCH),
    ({"clipped": True}, quality_gate.PROBLEM_CLIPPED),
])
def test_each_question_maps_to_its_own_problem(kw, expected):
    decision = quality_gate.review(
        _StubJudge(_verdict(**kw)), _FRAMES, _MASTER, "walk", config=_SHADOW,
    )
    assert decision.problems == (expected,)


def test_enforce_blocks_only_when_switched_on():
    judge = _StubJudge(_verdict(action_matches=False))
    assert quality_gate.review(
        judge, _FRAMES, _MASTER, "walk", config=_ENFORCING,
    ).blocked is True


def test_judge_failure_never_blocks_and_is_not_a_pass():
    """仪器坏了不许拦 —— 拦的是用户已付费的产物;但也不能记成"判了没问题"。"""
    judge = _StubJudge(JudgeResponseError("判官没有返回 JSON"))
    decision = quality_gate.review(judge, _FRAMES, _MASTER, "walk", config=_ENFORCING)
    assert decision.blocked is False
    assert decision.verdict is None
    assert "JSON" in decision.error
    payload = decision.as_payload()
    assert payload["problems"] == [] and "error" in payload
    assert "subject_count" not in payload, "没判出来就不能在结果里留下任何读数"


def test_middle_frame_is_judged():
    """只判一帧,而且不是首帧 —— 首帧最像母版,动作对不对在那里最看不出来。"""
    judge = _StubJudge(_verdict())
    decision = quality_gate.review(judge, _FRAMES, _MASTER, "walk", config=_SHADOW)
    assert decision.frame_index == 1
    assert len(judge.calls) == 1
    assert judge.calls[0] == (b"f1", _MASTER, "walk")


def test_empty_frames_is_not_judged():
    judge = _StubJudge(_verdict())
    assert quality_gate.review(judge, [], _MASTER, "walk", config=_SHADOW) is None
    assert judge.calls == []


# ── 接进编排:shadow 结论落进任务结果,交付不受影响 ────────────────────────


@pytest.fixture
def session_factory():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from windup_framework.db import Base

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


class _SpyGenerator:
    """出两帧 256×256 的桩引擎(不联网、不解码视频)。"""

    def generate(self, card, action, master, progress, canvas=None):
        from windup_ai_engine.ports import ActionQuality, GeneratedAction

        w, h = canvas or (256, 256)
        frame = _blank_png(w, h)
        return GeneratedAction(
            frames=[frame, frame],
            durations=[100, 100],
            quality=ActionQuality(
                motion_scale=1.0, dead_frames=(), loop_seam=None, subject_blobs=(1,)
            ),
            prompt_version="test-v0",
        )


def _blank_png(w: int, h: int) -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", (w, h), (0, 0, 0, 0)).save(buf, "PNG")
    return buf.getvalue()


def _run_task(
    session_factory, judge, gate_enabled: bool, enforce: bool, monkeypatch, action_input=None
):
    from windup_app.server.orchestrator.executor import ActionTaskExecutor
    from windup_app.server.orchestrator.model import ActionType, CharacterActionInput
    from windup_app.server.orchestrator.service import AiGenerationService

    live = quality_gate.settings
    monkeypatch.setattr(live, "enabled", gate_enabled)
    monkeypatch.setattr(live, "enforce", enforce)

    executor = ActionTaskExecutor(
        generator=_SpyGenerator(),
        judge=judge,
        upload=lambda _png: "https://cdn.example.invalid/f.png",
        fetch_master=lambda _input: b"master-bytes",
        session_factory=session_factory,
    )
    if action_input is None:
        action_input = CharacterActionInput(
            character_id=1, action_type=ActionType.WALK, num_frames=2,
        )
    service = AiGenerationService()
    with session_factory() as s:
        # #351 起任务终态要结清预付费,没有积分账户会在 _settle_credit 那步炸。
        seed_credit_account(s, 1)
        task_id = service.generate_character_action(s, user_id=1, input=action_input).id
        s.commit()
    executor.run_action_task(task_id, action_input)
    with session_factory() as s:
        return service.get_task(s, project_id=None, task_id=task_id)


def test_shadow_verdict_lands_in_task_result(session_factory, monkeypatch):
    judge = _StubJudge(_verdict(subject_count=2))
    task = _run_task(session_factory, judge, True, False, monkeypatch)

    from windup_app.server.orchestrator.model import TaskStatus

    assert task.status is TaskStatus.COMPLETED, "shadow 期判官说有问题也照常交付"
    assert len(task.result.frames) == 2
    assert task.result.judge["problems"] == [quality_gate.PROBLEM_MULTIPLE_SUBJECTS]
    assert task.result.judge["blocked"] is False
    assert judge.calls[0][1] == b"master-bytes", "判官要拿到母版才答得了'多出来的物体'"


def test_gate_disabled_leaves_no_reading_and_costs_nothing(session_factory, monkeypatch):
    judge = _StubJudge(_verdict())
    task = _run_task(session_factory, judge, False, False, monkeypatch)
    assert task.result.judge is None, "没判就该是 None,不能看起来像'判了没问题'"
    assert judge.calls == []


def test_enforce_fails_the_task(session_factory, monkeypatch):
    task = _run_task(
        session_factory, _StubJudge(_verdict(clipped=True)), True, True, monkeypatch,
    )

    from windup_app.server.orchestrator.model import TaskStatus

    assert task.status is TaskStatus.FAILED
    assert quality_gate.PROBLEM_CLIPPED in task.error_message


def test_custom_action_sends_the_description_not_the_enum(session_factory, monkeypatch):
    """判官收到的必须是用户那句描述,不是枚举值 "custom"。

    传枚举值等于问判官"这帧是不是 custom":拦截档下所有自定义动作都会被误判成不匹配,
    shadow 期的自定义读数也全是噪声。
    """
    from windup_app.server.orchestrator.model import ActionType, CharacterActionInput

    judge = _StubJudge(_verdict())
    _run_task(
        session_factory, judge, True, False, monkeypatch,
        action_input=CharacterActionInput(
            character_id=1, action_type=ActionType.CUSTOM, num_frames=2,
            custom_prompt="  向观众挥手打招呼  ",
        ),
    )

    assert judge.calls, "闸口开着就该判一次"
    assert judge.calls[0][2] == "向观众挥手打招呼", "描述要送到判官,且两端空白已剥掉"


def test_builtin_action_still_sends_the_enum_label(session_factory, monkeypatch):
    """内置动作没有 custom_prompt,仍送枚举值 —— 别为了修 custom 把这条也改了。"""
    judge = _StubJudge(_verdict())
    _run_task(session_factory, judge, True, False, monkeypatch)

    assert judge.calls[0][2] == "walk"


def test_blank_custom_description_falls_back_to_the_enum():
    """空描述退回枚举值,而不是把空串送给判官 —— 空串会让判官去判"这帧是不是空"。

    直接测函数而不走整条任务:空 ``custom_prompt`` 在 ``ActionSpec`` 那一步就被校验拦掉,
    整条链路根本走不到判官。这个分支是防御性的,拿假路径去测等于什么都没测。
    """
    from windup_app.server.orchestrator.executor import _judged_action
    from windup_app.server.orchestrator.model import ActionType, CharacterActionInput

    blank = CharacterActionInput(
        character_id=1, action_type=ActionType.CUSTOM, num_frames=2, custom_prompt="   ",
    )
    assert _judged_action(blank) == "custom"
