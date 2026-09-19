"""编排层往消费层抛的信号异常。

单独一个**零依赖**模块:这些异常要被 ``worker.handlers`` import,而 ``executor`` 依赖
``ai_engine``,从那里 import 会让入口层经由 handlers 间接连上 ai_engine —— 分层契约
"入口层不经 ai_engine 直连"就是拦这个的。信号本身不需要任何依赖,分出来即可。
"""

from __future__ import annotations

__all__ = ["ActionAwaitingAdmit", "ActionRateLimited"]


class ActionAwaitingAdmit(Exception):
    """在途名额满了或账号在 429 冷却里。任务保持 RUNNING，延迟后再打上游。"""


class ActionRateLimited(Exception):
    """上游限流把重试与兜底都用完了,而这次**一分钱没花** —— 任务应稍后重投,不是失败。

    与 ``ActionAwaitingClientBake`` 同一个模式:编排层抛,消费层接。区别是那个表示
    "已挂给别人、任务保持 RUNNING",这个表示"没开始、放回队列"。

    为什么值得单开一条路:限流被拒时上游没有建单、没有消耗配额,判失败等于凭空丢掉一个
    本来能成的任务。实测近三天 143 个动作任务里有 40 个是这么失败的。
    """
