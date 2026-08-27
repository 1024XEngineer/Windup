"""白名单账号默认就用最好的型号。

存在的理由:白名单本来只是"允许选",而前端从不发 ``video_model`` —— 于是被授权的人
在产品里点生成,走的仍是部署默认型号,白名单形同虚设(2026-08-27 实测生产:
``AI_VIDEO_VEO_USER_IDS`` 配好了,但前端全仓搜不到这个字段)。
"""
from __future__ import annotations

import pytest

from windup_framework.config.provider import AIProviderSettings
from windup_framework.gateway.registry import preferred_model_for

CFG = AIProviderSettings(video_veo_user_ids="1,2,3")


def test_a_whitelisted_user_gets_the_premium_model_without_asking():
    """拦的坏例:授权了却还是走部署默认。

    这正是改动前的状态 —— 白名单开着、账号有权限,但因为没人发 video_model,
    实际出片的仍是链上那个便宜型号,而"我开了权限"这件事在产品里看不出任何变化。
    """
    for uid in (1, 2, 3):
        assert preferred_model_for(uid, CFG) == "veo3.1"


@pytest.mark.parametrize("uid", [9, 0, None])
def test_everyone_else_is_untouched(uid):
    """拦的坏例:把受限型号变成所有人的默认值。

    它按秒计费、比链上的贵一档。返回 None 表示"照旧走部署默认",
    非白名单用户的行为必须与改动前一字不差。
    """
    assert preferred_model_for(uid, CFG) is None


def test_an_empty_whitelist_gives_nobody_a_premium_default():
    """忘配 = 谁都拿不到,而不是忘配 = 所有人升舱。"""
    assert preferred_model_for(1, AIProviderSettings()) is None


def test_the_executor_entry_returns_the_premium_default(monkeypatch):
    """端到端到编排层入口:不传型号时,白名单用户拿到 veo,别人拿到 None。"""
    from windup_app.server.orchestrator import executor

    monkeypatch.setattr("windup_framework.gateway.registry.default_settings", CFG)
    assert executor._resolve_video_model(None, 1) == "veo3.1"
    assert executor._resolve_video_model(None, 9) is None
    assert executor._resolve_video_model(None) is None


def test_an_explicit_model_still_wins_over_the_premium_default():
    """显式指定优先 —— 否则白名单用户没法回退去跑便宜型号做对照。"""
    from windup_app.server.orchestrator import executor
    import pytest as _p

    # 链上型号:白名单用户也能显式选
    chain_model = AIProviderSettings().video_model
    assert executor._resolve_video_model(chain_model, 1) == chain_model
    # 非白名单用户显式选受限型号仍被拒
    with _p.raises(ValueError, match="未对当前用户开放"):
        executor._resolve_video_model("veo3.1", 9)
