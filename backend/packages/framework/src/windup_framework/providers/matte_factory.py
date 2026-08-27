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
import pathlib

from .interfaces import MatteProvider

logger = logging.getLogger("windup.matte.factory")

#: 环境变量名。取值 ``u2net``(默认) / ``birefnet``。
ENV = "WINDUP_MATTE_PROVIDER"
_U2NET = "u2net"
_BIREFNET = "birefnet"

#: BiRefNet 跑得起来所需的内存下限。
#:
#: 实测(部署机 4 核 / 7.7GiB / 无 GPU / ORT 1.23.2,输入形状与实现一致):单帧前向峰值
#: **6.85GB**,而 worker 进程自身稳态就占 1.7–3.9GB,且本 provider 默认与 u2net 取并集
#: (两份 ONNX 会话同时在)。cgroup 2g / 3g / 4g 实测全部 rc=137。
#: 8GiB 是"6.85 峰值 + worker 自身"取整,不是拍的。
_BIREFNET_MIN_BYTES = 8 * 1024**3

#: cgroup v2 / v1 的内存上限文件。**必须读它,不能只读 /proc/meminfo** ——
#: OOM killer 按 cgroup 判,而容器里 ``/proc/meminfo`` 报的是宿主的总量:
#: 生产宿主 7.7GiB、worker 容器上限 5GiB,只看前者会得出"够用"的错结论。
_CGROUP_MAX = ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes")


def _read_int(path: str) -> int | None:
    try:
        raw = pathlib.Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if raw == "max":            # cgroup v2 的"不限"
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    # cgroup v1 用一个接近 2^63 的哨兵表示"不限",别把它当成真上限。
    return None if value <= 0 or value >= 2**62 else value


def memory_budget_bytes() -> int | None:
    """这个进程实际能用到的内存上限;判不出来时给 None。

    取 cgroup 上限与宿主总量的较小者。``None`` 表示两处都读不到(非 Linux 的开发机),
    这时**不拦** —— 拦一台判不出内存的机器,等于因为量不到就把功能关掉。
    """
    limits = [v for p in _CGROUP_MAX if (v := _read_int(p)) is not None]
    try:
        for line in pathlib.Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            if line.startswith("MemTotal:"):
                limits.append(int(line.split()[1]) * 1024)
                break
    except (OSError, ValueError, IndexError):
        pass
    return min(limits) if limits else None


def make_matte_provider(name: str | None = None) -> MatteProvider:
    """按名字造 provider;不认识的名字回落 u2net 并留一条 WARNING。

    不认识就抛错的话,一个拼错的环境变量会让整个 worker 起不来;而回落是安全方向 ——
    u2net 在任何机器上都跑得起来,坏处只是抠图差一点,且这条 WARNING 说明了原因。
    """
    choice = (name or os.environ.get(ENV) or _U2NET).strip().lower()
    if choice == _BIREFNET:
        budget = memory_budget_bytes()
        if budget is not None and budget < _BIREFNET_MIN_BYTES:
            # 回落而不是抛错,理由与下面那条不认识的值一样:抛错会让一次配置失误变成
            # 整个 worker 起不来。但级别是 ERROR 不是 WARNING —— 它是被明确要求了却
            # 没能给上,而不是没配。
            #
            # 这道闸拦的坏例:在 5GiB 的生产 worker 上把这个变量设成 birefnet。
            # 没有它时,进程会一路跑到第一帧推理才被 OOM killer 杀掉,而现场看到的是
            # worker 无声重启、任务卡在 RUNNING —— 没有任何一行提到内存。
            logger.error(
                "%s=%s 但本进程内存上限只有 %.1fGiB(需要 ≥%.0fGiB),回落 u2net。"
                "BiRefNet 单帧峰值约 6.85GB,在这里开会被 OOM kill 而不是抠得差一点。"
                "要用它请换内存更大的机器或调高容器上限。",
                ENV, _BIREFNET, budget / 1024**3, _BIREFNET_MIN_BYTES / 1024**3,
            )
        else:
            from .matte_birefnet import BiRefNetMatteProvider

            logger.info(
                "抠图用 BiRefNet(与 u2net 取并集);单帧峰值约 6.85GB,内存上限 %s",
                f"{budget / 1024**3:.1f}GiB" if budget else "判不出(非 Linux?)",
            )
            return BiRefNetMatteProvider()
    if choice != _U2NET:
        logger.warning("%s=%r 不认识,回落 u2net;可选:%s / %s", ENV, choice, _U2NET, _BIREFNET)
    from .matte import OnnxU2NetMatteProvider

    return OnnxU2NetMatteProvider()
