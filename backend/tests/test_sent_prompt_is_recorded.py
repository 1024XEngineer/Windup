"""发给上游的提示词正文要落进网关台账(#841)。

拦的坏例:用户说"这不是我要的动作",而我们答不上来到底发了什么。

生产 #564 就是这个形状 —— 用户选 attack、写了"炸开分裂成小史莱姆",拿回来一段
金发人形武者。任务结果里只有:

    {type, frames, quality, geometry, direction, action_type, prompt_version: "v2"}

没有正文。要证明"我们发的和他写的不是一回事",只能读代码反推运动拓扑,再去上游
按 job_id 捞源视频 —— 而上游的视频会过期,捞不到就再也说不清了。

``input_hash`` 答不了这个问题:哈希能证明两次发的一样,答不了发的是什么。
"""
from __future__ import annotations

from windup_framework.gateway.ledger import _PROMPT_MAX_CHARS, _audit_extra
from windup_framework.gateway.trace import AttemptDetail

# #564 发出去的那段(节选)。它与用户写的那句毫无关系,而这正是要能查出来的东西。
THRUST = (
    "coiled low with the weight on the back foot and the striking side pulled in "
    "at waist height, the hips snap forward"
)


def test_the_prompt_text_reaches_the_ledger_row():
    """正文要真的落进 extra —— 字段加了没人写,是本仓最典型的静默失败。"""
    extra = _audit_extra(AttemptDetail(input_hash="h", prompt=THRUST))
    assert extra is not None
    assert extra["prompt"] == THRUST


def test_a_hash_alone_does_not_answer_what_we_sent():
    """只有 input_hash 时,extra 里没有任何能回答"发了什么"的东西。

    这条钉的是**为什么要加这个字段**:没有它,台账里关于提示词的全部信息就是一个
    64 位十六进制串。
    """
    extra = _audit_extra(AttemptDetail(input_hash="a" * 64))
    assert extra is None or "prompt" not in extra


def test_no_prompt_leaves_the_extra_untouched():
    """没提示词的场次(轮询、纯失败跳)不该凭空多出一个空键。"""
    assert _audit_extra(AttemptDetail(input_hash="h", prompt=None)) is None
    assert _audit_extra(AttemptDetail(input_hash="h", prompt="")) is None


def test_a_runaway_prompt_is_truncated_not_dropped():
    """超长时截断,不是整条丢掉。

    丢掉等于回到"查不出发了什么";而不设上限,将来某次把整份 md 塞进提示词时,
    这张按跳记录的表会被撑爆(一次生成在 429 换 key 时能记十几跳)。
    """
    extra = _audit_extra(AttemptDetail(prompt="字" * (_PROMPT_MAX_CHARS + 500)))
    assert extra is not None
    assert len(extra["prompt"]) == _PROMPT_MAX_CHARS


def test_the_video_gateway_records_the_prompt_it_actually_sent():
    """接线检查:真跑一次网关,断言台账那条记录里带着这一跳发出去的正文。

    只测 ``_audit_extra`` 的话,字段可以完美地落库、却永远是 None —— 因为没人填。
    这条从 ``i2v`` 发起,走的是生产那条路径。
    """
    from windup_framework.config.provider import AIProviderSettings
    from windup_framework.gateway.circuit import CircuitBreaker
    from windup_framework.gateway.registry import ModelRegistry
    from windup_framework.gateway.types import AdapterResult
    from windup_framework.gateway.video import VideoGateway

    from test_gateway_video import FakeVideoAdapter

    cfg = AIProviderSettings(video_model="kling-v2-5-turbo", video_fallbacks="")
    adapter = FakeVideoAdapter(
        submits={"kling-v2-5-turbo": [AdapterResult(ok=True, job_id="j1", maybe_billed=True)]},
        follows={"j1": AdapterResult(ok=True, body=b"\x00\x00\x00\x18ftypmp42",
                                     maybe_billed=True, job_id="j1")},
    )
    gw = VideoGateway(
        registry=ModelRegistry.from_settings(cfg), adapter=adapter,
        circuit=CircuitBreaker(cooldown_s=60), settings=cfg,
    )

    seen: list = []
    original = gw._emit

    def _capture(trace):
        seen.append(trace)
        return original(trace)

    gw._emit = _capture
    gw.i2v(b"frame", THRUST)

    prompts = [t.detail.prompt for t in seen if t.detail is not None]
    assert THRUST in prompts, f"台账里没有这一跳发出去的正文,只有 {prompts!r}"
