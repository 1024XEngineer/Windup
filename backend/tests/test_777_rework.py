"""#777 整改:三条各自会静默产出错东西的缺陷。

两位审查者(FennoAI + 内部审查)独立指出了其中两条,第三条是内部审查用真实产物量出来的。
"""
from __future__ import annotations

import pytest


def test_root_motion_is_not_unwrapped_twice():
    """拦的坏例:按片段名再取一层,位移轨恒为 None。

    ``bake_driver.mjs`` 交回 meta 时已经拆过(``root_motion: rootMotion[clip] ?? null``),
    ``sprite.py`` 原样透传 —— 到 ``_root_motion_of`` 时 ``sheet.root_motion`` 就是那一段本身。
    再 ``.get(clip)`` 一次恒得 None,而服务端渲那条 **100% 走这里**:任务照常 COMPLETED、
    帧数时长成色全对,只是位移轨永远是空的。
    """
    from windup_ai_engine.strategy.concrete import _root_motion_of

    class _Sheet:
        root_motion = {"unit": "1.0 = 角色总高",
                       "disp": [[0.0, 0.0], [0.1, 0.0]], "total_span": 0.1}

    assert _root_motion_of(_Sheet(), "walk") == [(0.0, 0.0), (0.1, 0.0)]


@pytest.mark.parametrize("bad", [
    [[0.0]],                    # 长度不是 2 —— 解包会 ValueError
    [[0.0, "x"]],               # z 是脏值 —— float(z) 会抛,穿出 derive 把任务打失败
    [["x", 0.0]],
    "不是列表",
])
def test_a_dirty_displacement_track_is_dropped_whole_not_half(bad):
    """拦的坏例:守卫只校验 x、且解包发生在守卫之前。

    原来写成 ``for x, z in disp if isinstance(x, ...)``:解包先于守卫,长度不对照样 ValueError;
    而守卫命中时是**丢掉那一条**,于是位移轨比帧数短,索引静默错位。脏数据整条作废才对。
    """
    from windup_ai_engine.strategy.concrete import _root_motion_of

    class _Sheet:
        root_motion = {"disp": bad}

    assert _root_motion_of(_Sheet(), "walk") is None


def test_derived_facts_do_not_live_on_the_shared_strategy_instance():
    """拦的坏例:把每次渲染的结果写在进程级共用的 strategy 实例上。

    ``ActionTaskExecutor`` 是进程级单例,缓存的 generator / strategy 被所有任务线程共用,
    而 action 并发默认 8 —— A 的 ``derive`` 写完、A 的 ``_finish`` 读之前,B 的 ``derive``
    会覆盖它,于是 A 的帧带着 B 的骨架事实和 B 的位移轨落库。帧、时长、成色全对,零报错。
    """
    import inspect

    from windup_ai_engine.strategy import concrete

    src = inspect.getsource(concrete)
    assert "_last_rig" not in src and "_last_root_motion" not in src, (
        "派生结果又挂回实例字段了 —— 并发下会串味"
    )
    assert hasattr(concrete, "take_derived"), "缺按请求隔离的取值口"


def test_take_derived_clears_after_reading():
    """取完即清 —— 否则下一次没算出来时会读到上一次的,而那正是串味的另一种形态。"""
    from windup_ai_engine.strategy.concrete import _DERIVED, take_derived

    _DERIVED.set(("rig", "motion"))
    assert take_derived() == ("rig", "motion")
    assert take_derived() == (None, None)


def test_rig_facts_survive_the_round_trip_through_the_database():
    """拦的坏例:只写进结果 JSON、不进出参模型 → 落库再读回就没了。

    查询接口与断线重连拿到的已完成任务缺这两样,而实时事件那条路有 —— 两条路给出不同结果。
    同一个坑 ``geometry`` 已经踩过一次,注释就写在它旁边。(FennoAI 在 #777 上指出。)
    """
    from windup_app.server.orchestrator.task_repo import _deserialize_result

    out = _deserialize_result("character_action", {
        "type": "character_action", "action_type": "walk", "frames": [],
        "rig_facts": {"bones": 28, "root_bone": "root"},
        "root_motion": [[0.0, 0.0], [0.1, 0.0]],
    })
    assert out.rig_facts == {"bones": 28, "root_bone": "root"}
    assert out.root_motion == [[0.0, 0.0], [0.1, 0.0]]
