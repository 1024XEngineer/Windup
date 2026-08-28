"""组内账号免 3D 额度(用来做高质量素材)。

两道额度都要免,漏一道就等于没免:
  MAX_ASSETS_PER_USER       每人最多同时持有几个 3D 角色
  MAX_ACTIONS_PER_3D_ASSET  每个 3D 角色最多几个动作

判据的**默认方向是受限**:空名单、拿不到用户身份时一律照常限。反过来(默认放行)
的代价是所有人都能无限建资产,而每个是 30 积分。
"""
from __future__ import annotations

import pytest

from windup_app.web.api.render3d import _unlimited_3d_user_ids, is_unlimited_3d


@pytest.fixture
def _ids(monkeypatch):
    def _set(value: str):
        from windup_framework.config.provider import settings as cfg

        monkeypatch.setattr(cfg, "render3d_unlimited_user_ids", value, raising=False)
    return _set


def test_an_empty_allowlist_exempts_nobody(_ids):
    """拦的坏例:默认放行。空名单时所有人都能无限建资产,每个 30 积分。"""
    _ids("")
    assert _unlimited_3d_user_ids() == frozenset()
    for uid in (1, 2, 3, 99):
        assert not is_unlimited_3d(uid)


def test_the_listed_users_are_exempt(_ids):
    _ids("1,2,3")
    assert _unlimited_3d_user_ids() == frozenset({1, 2, 3})
    assert all(is_unlimited_3d(u) for u in (1, 2, 3))
    assert not is_unlimited_3d(4)


@pytest.mark.parametrize("raw", ["1, 2 ,3", " 1,2,3 ", "1,,2,3,"])
def test_whitespace_and_empty_entries_are_tolerated(_ids, raw):
    """部署时手写的配置会有空格和多余逗号,不该因此少放一个人。"""
    _ids(raw)
    assert _unlimited_3d_user_ids() == frozenset({1, 2, 3})


def test_a_malformed_entry_is_skipped_not_treated_as_everyone(_ids):
    """拦的坏例:写坏一个条目就"对所有人开放"。

    与 veo 白名单同一条判据:坏条目跳过,不放大授权范围。
    """
    _ids("1,abc,3,,x7")
    assert _unlimited_3d_user_ids() == frozenset({1, 3})
    assert not is_unlimited_3d(7), "写坏的 x7 被当成了 7"


def test_the_asset_count_gate_honours_the_allowlist(_ids, monkeypatch):
    """第一道额度:持有数。免限的用户建到第 3 个也不该被拒。"""
    from windup_app.web.api import render3d as r3d

    _ids("2")
    monkeypatch.setattr(r3d, "_owned_asset_count", lambda *a, **k: 99)
    # 直接验判据本身:超额 + 在名单里 → 不拦
    assert 99 >= r3d.MAX_ASSETS_PER_USER
    assert r3d.is_unlimited_3d(2)
    assert not r3d.is_unlimited_3d(5)


def test_the_action_quota_gate_honours_the_allowlist(_ids):
    """第二道额度:每资产的动作数。漏这道的话免限用户建得了资产、加不了动作。"""
    from windup_app.web.api.generation import _require_3d_action_quota
    from windup_app.web.api.generation import BizException

    _ids("2")

    class _Char:
        id = 1
        character_data = {
            "version": 1, "templates": [],
            "outfits": [{
                "id": "o1", "name": "默认", "model_3d_url": "https://x/m.glb",
                "actions": [
                    {"id": f"a{i}", "type": "walk", "name": "走", "frame_count": 1,
                     "frames": []} for i in range(9)
                ],
            }],
        }

    # 不在名单里 → 撞额度
    with pytest.raises(BizException):
        _require_3d_action_quota(_Char(), "o1", user_id=5)
    # 在名单里 → 放行
    _require_3d_action_quota(_Char(), "o1", user_id=2)


def test_no_user_id_still_enforces_the_quota(_ids):
    """拿不到用户身份时照常限 —— 默认方向是受限,不是放行。"""
    from windup_app.web.api.generation import _require_3d_action_quota, BizException

    _ids("2")

    class _Char:
        id = 1
        character_data = {
            "version": 1, "templates": [],
            "outfits": [{"id": "o1", "name": "默认", "model_3d_url": "https://x/m.glb",
                         "actions": [{"id": f"a{i}", "type": "walk", "name": "走",
                                      "frame_count": 1, "frames": []} for i in range(9)]}],
        }

    with pytest.raises(BizException):
        _require_3d_action_quota(_Char(), "o1", user_id=None)
