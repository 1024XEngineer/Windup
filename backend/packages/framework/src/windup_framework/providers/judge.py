"""判官 provider —— 问四个有唯一答案的问题,不问"好不好看"。

读不出结论一律抛错:兜底成"通过"会让判官坏掉与产物没问题在下游长得一样,而这两种
情形要做的事相反 —— 一个是去修判官,一个是照常交付。
"""

from __future__ import annotations

import base64
import json
import re

from windup_common.models import JudgeVerdict
from windup_framework.config.provider import AIProviderSettings, settings

from .sufy import ChatCompletionsFace, _ResendBudget

# 四问是**可数、可复核**的,所以提示词把答案形状写死成一个对象、并逐字段说清判据。
# 不要求模型解释理由:理由是自由文本,读它就等于又回到主观判断。
_PROMPT = """You are a strict visual inspector for 2D game sprite frames.

Image 1 is the MASTER reference of the character.
Image 2 is one GENERATED frame to inspect.

Only report what can be counted or verified against image 1. Do NOT rate quality,
style, beauty, anatomy or appeal. Do not explain.

Reply with exactly one JSON object and nothing else:
{{"subject_count": <integer>, "foreign_objects": [<string>, ...], \
"action_matches": <true|false>, "clipped": <true|false>}}

- subject_count: how many distinct character bodies are visible in image 2.
- foreign_objects: short names of objects visible in image 2 but absent from
  image 1; [] when there are none.
- action_matches: true when the pose in image 2 belongs to the action "{action}".
- clipped: true when any part of the character is cut off by the image border.
"""

# 模型常把 JSON 裹进 markdown 代码围栏。剥围栏是解析的一部分,不是兜底 ——
# 剥完仍不是合法 JSON 照样抛。
_FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL)

_REQUIRED = ("subject_count", "foreign_objects", "action_matches", "clipped")


class JudgeResponseError(RuntimeError):
    """判官的回答读不出四个读数 —— 仪器故障,不是产物有问题。

    单列一个类型,好让上层把它与"产物被判有问题"分开:后者可以据以拦截,前者拦谁都不对。
    """


class SufyJudgeProvider(ChatCompletionsFace):
    """看图问答判官:一帧 + 母版 → :class:`JudgeVerdict`。"""

    def __init__(
        self,
        config: AIProviderSettings = settings,
        model: str | None = None,
    ) -> None:
        super().__init__(config, model or config.judge_model)

    def judge(self, frame: bytes, master: bytes, action: str) -> JudgeVerdict:
        body = {
            "model": self._model,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": _PROMPT.format(action=action)},
                    _image_part(master),
                    _image_part(frame),
                ],
            }],
            # 判读要的是同一张图每次给同一个答案;温度一高,阈值卡的就成了采样噪声。
            "temperature": 0,
            # 提示词里已经要过 JSON,这里再要一次是因为两者的强度不同:提示词到哪个模型
            # 都生效但可以被无视,response_format 在支持它的网关上是硬约束。
            "response_format": {"type": "json_object"},
        }
        with self._client() as client:
            # 预算按一次判读建,不跨帧累积:一帧判坏了不该把下一帧的重发额度也花掉。
            payload = self._post(client, body, _ResendBudget())
        return _parse_verdict(_content(payload))


def _image_part(raw: bytes) -> dict:
    return {
        "type": "image_url",
        "image_url": {"url": "data:image/png;base64," + base64.b64encode(raw).decode()},
    }


def _content(payload: dict) -> str:
    """取出模型正文;``content`` 在不同网关下是字符串或 parts 数组,别的形状抛错。"""
    try:
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise JudgeResponseError(f"判官响应里没有 message.content:{json.dumps(payload)[:300]}") from exc
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        text = "".join(p.get("text", "") for p in content if isinstance(p, dict))
        if text:
            return text
    raise JudgeResponseError(f"判官响应的 content 形状读不了:{str(content)[:300]}")


def _parse_verdict(text: str) -> JudgeVerdict:
    """模型正文 → :class:`JudgeVerdict`;任何一项读不出来就抛 :class:`JudgeResponseError`。"""
    stripped = _FENCE.sub(r"\1", text)
    try:
        data = json.loads(stripped)
    except json.JSONDecodeError as exc:
        raise JudgeResponseError(f"判官没有返回 JSON:{text[:300]!r}") from exc
    if not isinstance(data, dict):
        raise JudgeResponseError(f"判官返回的不是 JSON 对象:{text[:300]!r}")
    missing = [k for k in _REQUIRED if k not in data]
    if missing:
        raise JudgeResponseError(f"判官回答缺字段 {missing}:{text[:300]!r}")

    return JudgeVerdict(
        subject_count=_as_count(data["subject_count"], text),
        foreign_objects=_as_names(data["foreign_objects"], text),
        action_matches=_as_bool(data["action_matches"], "action_matches", text),
        clipped=_as_bool(data["clipped"], "clipped", text),
        raw=text,
    )


def _as_count(value: object, text: str) -> int:
    # bool 是 int 的子类,不排掉的话 ``true`` 会被读成 1 个主体 —— 一个凭空捏造的读数。
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise JudgeResponseError(f"subject_count 不是非负整数({value!r}):{text[:300]!r}")
    return value


def _as_names(value: object, text: str) -> tuple[str, ...]:
    if not isinstance(value, list) or any(not isinstance(v, str) for v in value):
        raise JudgeResponseError(f"foreign_objects 不是字符串数组({value!r}):{text[:300]!r}")
    return tuple(value)


def _as_bool(value: object, field: str, text: str) -> bool:
    # 不接 "true" / 1:字符串与数字要靠一套约定才能变成布尔,而约定错了没人会发现。
    if not isinstance(value, bool):
        raise JudgeResponseError(f"{field} 不是布尔值({value!r}):{text[:300]!r}")
    return value
