"""按配置选抠图 provider。

为什么要这个开关:BiRefNet 在同一帧上把主体内部非实心从 5,541 px 降到 106 px(-98%),
但单帧峰值 6.85GB —— 生产 worker 容器上限 5GiB、宿主总共 7.7GB,**跑不了**,而组员
本机 16GB 跑得很轻松。同一份代码两种装配,好过为它开一条分支:分支一定会漂,而漂出来
的"更好的管线"产出的素材,产品复现不出来。

默认必须是 u2net:忘配等于用得起的那个,而不是忘配就把生产打 OOM。
"""

from __future__ import annotations

import logging
import os

from .interfaces import MatteProvider

logger = logging.getLogger("windup.matte.factory")

#: 环境变量名。取值 ``u2net``(默认) / ``birefnet``。
ENV = "WINDUP_MATTE_PROVIDER"
_U2NET = "u2net"
_BIREFNET = "birefnet"


def make_matte_provider(name: str | None = None) -> MatteProvider:
    """按名字造 provider;不认识的名字回落 u2net 并留一条 WARNING。

    不认识就抛错的话,一个拼错的环境变量会让整个 worker 起不来;而回落是安全方向 ——
    u2net 在任何机器上都跑得起来,坏处只是抠图差一点,且这条 WARNING 说明了原因。
    """
    choice = (name or os.environ.get(ENV) or _U2NET).strip().lower()
    if choice == _BIREFNET:
        from .matte_birefnet import BiRefNetMatteProvider

        logger.info("抠图用 BiRefNet(与 u2net 取并集);单帧峰值约 6.85GB,别在小内存机器上开")
        return BiRefNetMatteProvider()
    if choice != _U2NET:
        logger.warning("%s=%r 不认识,回落 u2net;可选:%s / %s", ENV, choice, _U2NET, _BIREFNET)
    from .matte import OnnxU2NetMatteProvider

    return OnnxU2NetMatteProvider()
