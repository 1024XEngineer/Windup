"""全局业务码。

统一 ``Response`` / ``BizException`` 族 / 异常处理器用到的业务状态码,
消除散落的魔数。成员值即对外返回的 ``code``(int);``message`` 仍由调用方
按场景自定义,不在此绑定。

与 HTTP 状态码解耦:对外 HTTP 恒 200,业务码放 body(见
:mod:`windup_common.result.response`)。
"""

from enum import Enum


class BizCode(int, Enum):
    """业务状态码。

    只收全局常用默认值;调用方需要其他码时直接传 int 即可(签名类型为 ``int``),
    不必在此穷举。
    """

    SUCCESS = 200              # 成功
    BAD_REQUEST = 400          # 请求参数校验失败
    UNAUTHORIZED = 401         # 未登录 / token 无效
    NOT_FOUND = 404            # 资源不存在
    CONFLICT = 409             # 乐观锁 / 资源版本冲突
    TOO_MANY_REQUESTS = 429    # 请求过于频繁
    INTERNAL_ERROR = 500       # 服务器内部错误 / 兜底
    MODEL_UNAVAILABLE = 503    # 模型服务不可用
