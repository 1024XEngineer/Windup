"""三渲二动作条数上限。

限的是本期试用范围,不是成本 —— 三渲二的动作由浏览器出帧,对我们几乎零成本。
但闸口本身要拦对:拦错的方向是把走 i2v 的用户一起卡住,而 i2v 那条路线不归它管。
"""
from __future__ import annotations

import pytest

from windup_app.web.api.generation import (
    MAX_ACTIONS_PER_3D_ASSET,
    _require_3d_action_quota,
)
from windup_common.exceptions import BizException


class _Char:
    def __init__(self, data):
        self.id = 1
        self.character_data = data


def _outfit(*, model_3d_url, n_actions):
    return {
        "version": 1,
        "templates": [],
        "outfits": [{
            "id": "o1", "name": "默认", "model_3d_url": model_3d_url,
            # 字段名必须与 ``CharacterAction`` 一致(``type`` / ``frame_count``)。
            # 写错的话 model_validate 会失败,请求被"脏数据放行"那条兜住,
            # 于是用例明明在测上限却什么都没测到(本用例第一版就是这么绿的)。
            "actions": [
                {"id": f"a{i}", "name": f"动作{i}", "type": "walk", "frame_count": 8}
                for i in range(n_actions)
            ],
        }],
    }


def test_a_3d_asset_at_the_cap_is_refused():
    """到上限就拒 —— 这是这个闸唯一要做的事。"""
    c = _Char(_outfit(model_3d_url="https://media/x.glb", n_actions=MAX_ACTIONS_PER_3D_ASSET))
    with pytest.raises(BizException) as e:
        _require_3d_action_quota(c, "o1")
    assert str(MAX_ACTIONS_PER_3D_ASSET) in str(e.value)


def test_below_the_cap_passes():
    c = _Char(_outfit(model_3d_url="https://media/x.glb", n_actions=MAX_ACTIONS_PER_3D_ASSET - 1))
    _require_3d_action_quota(c, "o1")


def test_an_outfit_without_a_3d_model_is_not_capped():
    """拦的坏例:把走 i2v 的用户一起卡住。

    这个闸只管三渲二。没有 3D 资产的造型走的是视频路线,它有自己的成本与限额,
    在这里被拒的话用户会被一个跟他无关的限额挡住,而且看不出原因。
    """
    c = _Char(_outfit(model_3d_url=None, n_actions=99))
    _require_3d_action_quota(c, "o1")


def test_no_outfit_id_means_i2v_and_is_not_capped():
    """不带 outfit_id 就是 i2v 路线(判据与 ``_outfit_model_3d_url`` 一致),不归本闸管。"""
    c = _Char(_outfit(model_3d_url="https://media/x.glb", n_actions=99))
    _require_3d_action_quota(c, None)


def test_unparseable_character_data_lets_the_request_through():
    """拦的坏例:``character_data`` 里某个无关字段脏了就把用户卡死。

    与 ``_outfit_model_3d_url`` 同一个取舍:放行的后果只是少拦一次,
    拦错的后果是用户被卡住且看不出原因。
    """
    _require_3d_action_quota(_Char({"outfits": "不是列表"}), "o1")


def test_an_unknown_outfit_is_left_to_the_route_resolver():
    """未知造型不在这里报错 —— ``_outfit_model_3d_url`` 已经会报 NOT_FOUND,
    两处各报一次的话,先跑的那个决定了用户看到哪句话,而这里这句是错的。"""
    _require_3d_action_quota(_Char(_outfit(model_3d_url="u", n_actions=99)), "不存在")
