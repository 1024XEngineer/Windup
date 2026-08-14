"""腾讯云 TC3-HMAC-SHA256 / COS 签名与 HTTP —— **零依赖,只用标准库**。

自带一份而不是 import 管线仓的 ``pipeline.tencent_sign``:整个包要能一次性搬进产品仓,
带着一条对管线私有模块的 import 就搬不动。产品仓若已有自己的腾讯云凭证层,
搬过去时把本文件整份换掉即可 —— 上层只用到 :class:`TencentCredentials` 与 :func:`call`。

凭证:环境变量优先,其次 ``~/.config/windup/tencent.env``(600)。**绝不硬编码、绝不进 git、
绝不进日志** —— 注意 COS 预签名 URL 里带着 ``q-ak=<SecretId>`` 与 ``q-signature``,
所以任何要把 URL 拼进异常/日志的地方都必须先过 :func:`redact`。
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import pathlib
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone

__all__ = ["TencentCredentials", "call", "redact", "TencentApiError"]

ENVFILE = pathlib.Path.home() / ".config" / "windup" / "tencent.env"

# 预签名 URL 里会出现的敏感查询参数。redact 只保留形状,不保留值。
_SECRET_QS = re.compile(r"(q-ak|q-signature|q-sign-time|q-key-time|Signature|SecretId)=[^&\s]*")


def redact(text: str) -> str:
    """把签名 / SecretId 从任意文本里抹掉,再往日志或异常里放。

    存在的理由很具体:COS 预签名 URL 的 ``q-ak`` **就是 SecretId**。一条"下载失败:
    https://...q-ak=AKID...&q-signature=..." 的错误日志等于把半副凭证写进了日志文件。
    """
    return _SECRET_QS.sub(lambda m: m.group(0).split("=", 1)[0] + "=<redacted>", text)


class TencentApiError(RuntimeError):
    """腾讯云返回了 ``Response.Error``。``code`` 是 ``Error.Code`` 原文。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


@dataclass(frozen=True)
class TencentCredentials:
    """腾讯云凭证。``repr=False`` 是有意的 —— dataclass 的默认 repr 会把 key 打出来,
    而 provider 出错时的 traceback 常常带上构造参数。"""

    secret_id: str = field(repr=False)
    secret_key: str = field(repr=False)
    region: str = "ap-guangzhou"

    @classmethod
    def resolve(cls, region: str | None = None) -> TencentCredentials:
        """环境变量 → 加锁文件。两处都没有就抛,不静默用空串(空串会得到一个
        看不懂的鉴权错,而不是"你没配凭证")。"""
        sid = os.environ.get("TENCENT_SECRET_ID", "")
        skey = os.environ.get("TENCENT_SECRET_KEY", "")
        if not (sid and skey) and ENVFILE.exists():
            kv = {}
            for line in ENVFILE.read_text().splitlines():
                if "=" in line and not line.lstrip().startswith("#"):
                    k, v = line.split("=", 1)
                    # 去掉包裹引号:.env 里写 KEY="AKID..." 是常见写法,带引号的值
                    # 会变成一个看不懂的鉴权错,而错在哪一层完全看不出来。
                    kv[k.strip()] = v.strip().strip("\"'")
            sid = sid or kv.get("TENCENT_SECRET_ID", "")
            skey = skey or kv.get("TENCENT_SECRET_KEY", "")
        if not (sid and skey):
            raise RuntimeError(
                "缺腾讯云凭证:请设 TENCENT_SECRET_ID / TENCENT_SECRET_KEY,"
                f"或写入 {ENVFILE}(chmod 600)"
            )
        return cls(sid, skey, region or os.environ.get("TENCENT_REGION", "ap-guangzhou"))


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def call(action: str, params: dict, *, service: str, version: str,
         creds: TencentCredentials, retries: int = 3, timeout: int = 60,
         idempotent: bool = False) -> dict:
    """调一个腾讯云接口,返回 ``Response`` 体(含 ``Error`` 时原样返回,由调用方判断)。

    重试范围按"重发一次的代价"划,不按"看起来像不像临时故障"划:
    网络/超时与 429 限流一律重试(请求没被执行);网关 5xx 只在 ``idempotent`` 时重试
    —— 它意味着请求可能已经到达后端,提交类重发会重复扣积分。业务错误从不重试。
    """
    host = f"{service}.tencentcloudapi.com"
    payload = json.dumps(params, ensure_ascii=False)
    ct = "application/json; charset=utf-8"

    last: Exception | None = None
    for attempt in range(retries):
        ts = int(time.time())
        date = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
        canonical = "\n".join([
            "POST", "/", "",
            f"content-type:{ct}\nhost:{host}\nx-tc-action:{action.lower()}\n",
            "content-type;host;x-tc-action",
            hashlib.sha256(payload.encode()).hexdigest(),
        ])
        scope = f"{date}/{service}/tc3_request"
        to_sign = "\n".join(["TC3-HMAC-SHA256", str(ts), scope,
                             hashlib.sha256(canonical.encode()).hexdigest()])
        k = _hmac(("TC3" + creds.secret_key).encode(), date)
        k = _hmac(k, service)
        k = _hmac(k, "tc3_request")
        sig = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()

        req = urllib.request.Request(
            f"https://{host}",
            data=payload.encode(),
            headers={
                "Authorization": (f"TC3-HMAC-SHA256 Credential={creds.secret_id}/{scope}, "
                                  f"SignedHeaders=content-type;host;x-tc-action, "
                                  f"Signature={sig}"),
                "Content-Type": ct, "Host": host,
                "X-TC-Action": action, "X-TC-Timestamp": str(ts),
                "X-TC-Version": version, "X-TC-Region": creds.region,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode()).get("Response", {})
        except urllib.error.HTTPError as e:
            # 腾讯云的**业务**错误走 HTTP 200 + Response.Error,到不了这里;能到这里的
            # 只有网关层的状态码。两者的安全性不同,不能一起处理:
            #   429 限流 = 请求被网关挡下、后端没执行 → 重发安全,提交类也不会重复扣费。
            #   5xx     = 请求**可能已经到达后端**并建了任务 → 提交类重发会重复扣积分,
            #             只有幂等调用(查询 / 取件)才可以重试。
            # 此前一律不重试,于是 5xx 的空响应经 `.get("Response", {})` 变成 {},
            # 一路走到 `_raise_for_error({})` 返回 {},最后以"没拿到 JobId"的面目出现 ——
            # 一次网关抖动被报成业务失败,排查方向整个跑偏。
            if e.code == 429 or (idempotent and e.code >= 500):
                last = e
                time.sleep(2 + attempt * 2)
                continue
            return json.loads(e.read().decode()).get("Response", {})
        except Exception as e:                          # 网络抖动才重试
            last = e
            time.sleep(2 + attempt * 2)
    raise last                                          # type: ignore[misc]


# ── COS(对象存储)最小客户端 ────────────────────────────────────────────────
# 存在的理由:绑骨的 ``File3D.Url`` 只接受**公网可拉取的 URL**,本地路径和 base64 都不行。
# 桶保持私有,用预签名 URL 给限时读取权限 —— 不开公有读,避免模型资产长期裸奔。


def cos_sign(creds: TencentCredentials, method: str, uri: str, host: str,
             expire: int = 3600) -> str:
    """COS 请求签名(只把 host 纳入签名头,与实际请求保持一致)。

    注意签名与 **HTTP 方法**绑定:签的是 GET 就只能 GET;拿 HEAD 去验会 403,
    验请用 GET(可加 Range 只取头几字节)。
    """
    now = int(time.time())
    key_time = f"{now - 60};{now + int(expire)}"
    sign_key = hmac.new(creds.secret_key.encode(), key_time.encode(), hashlib.sha1).hexdigest()
    http_string = f"{method.lower()}\n{uri}\n\nhost={urllib.parse.quote(host, safe='')}\n"
    to_sign = f"sha1\n{key_time}\n{hashlib.sha1(http_string.encode()).hexdigest()}\n"
    sig = hmac.new(sign_key.encode(), to_sign.encode(), hashlib.sha1).hexdigest()
    return (f"q-sign-algorithm=sha1&q-ak={creds.secret_id}&q-sign-time={key_time}"
            f"&q-key-time={key_time}&q-header-list=host&q-url-param-list=&q-signature={sig}")


def cos_request(creds: TencentCredentials, method: str, uri: str, host: str,
                data: bytes | None = None, timeout: int = 300) -> tuple[int, str]:
    req = urllib.request.Request(
        f"https://{host}{uri}", data=data,
        headers={"Authorization": cos_sign(creds, method, uri, host), "Host": host},
        method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")[:500]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:500]
