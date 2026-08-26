"""任务失败原因 → 交给用户看的一句话。

``error_message`` 会原样出现在前端界面上。此前它存的是 ``str(exc)``,于是对象存储
域名、上游网关地址、内部端点路径、环境变量名都随着报错一起显示给了用户
(线上实测:``只允许拉自家对象存储（https://media.windup.xin）…请先经 POST /media/upload``、
``Server error '525 SSL Handshake Failed with Origin Server' for url 'https://<上游>/v1/videos'``)。

分类只看异常类型与少量稳定特征,不解析上游文案:上游随时会改措辞,按文案分类等于把
分类正确性押在别人的字符串上。分不出来时给最保守的那句,而不是把原文透出去。

完整原因仍进日志(``logger.exception`` 已在各调用点),排障看日志不看这里。
"""
from __future__ import annotations

import httpx

_GENERIC = "生成没能完成，请稍后重试。若反复失败请联系我们。"

# 判官问题码 → 用户能据以行动的一句话。键取自 quality_gate 的 PROBLEM_* 常量。
_QUALITY_TEXT = {
    "multiple_subjects": "画面里出现了不止一个角色，建议换一张单人母版",
    "no_subject": "画面里找不到角色",
    "foreign_objects": "出现了母版里没有的物件，建议在描述里去掉装备与道具名词",
    "action_mismatch": "动作与描述对不上，换一种说法再试",
    "clipped": "角色被画面边缘裁到，建议换一张留白更多的母版",
}


def user_message(exc: BaseException) -> str:
    """把异常翻成一句用户能据以行动、又不含内部信息的话。"""
    # 全部按类名判,不 import 具体异常类:本模块被 web 层调用,而 web 层不得直连
    # ai_engine(分层契约「入口层不经 ai_engine 直连」)。为了拿一个类型注解把整条
    # 依赖链牵进入口层,不值得。
    name = type(exc).__name__

    # 用户自己能改的输入错 —— 这类必须说清楚,否则用户不知道改什么。
    if name == "PromptRejected":
        detail = getattr(exc, "detail", "")
        return f"动作描述没通过检查：{detail}" if detail else "动作描述没通过检查，换一种说法再试。"
    if name == "FetchNotAllowed":
        return "参考图地址不被接受，请重新上传图片后再试。"
    if name == "QualityBlocked":
        # 判官给的是产品级原因,不是基础设施信息 —— 翻成人话交给用户,
        # 抹成"没通过检查"会让用户不知道改什么,那是脱敏脱过头。
        hits = [_QUALITY_TEXT[p] for p in getattr(exc, "problems", ()) if p in _QUALITY_TEXT]
        return "产物没通过检查：" + "；".join(hits) + "。" if hits else \
            "产物没通过检查，建议换一张母版或调整描述后重试。"

    text = str(exc)
    if "no_subject" in text:
        return "母版里找不到主体，请换一张主体清晰、背景干净的图。"
    if "reference_image_urls" in text or "缺少母版" in text:
        return "这次生成缺少母版，请先确认母版再继续。"

    # 上游网关的一切故障 —— 状态码、URL、厂商域名一律不透出。
    if isinstance(exc, (httpx.HTTPError, httpx.HTTPStatusError)):
        return "生成服务暂时不可用，请稍后重试。这次不计费。"
    if name in ("IncompleteDownloadError", "UnsafeDownloadUrlError"):
        return "产物下载失败，请重试。"
    if "风控" in text or "risk control" in text.lower():
        return "这次生成被内容审核拦下，换一种描述或换一张母版再试。"

    return _GENERIC
