"""统一响应封装。

提供成功 / 失败两种响应格式,字段统一为 ``code`` / ``message`` / ``data``;
``timestamp`` 可选,需要时由调用方传入,默认不携带。

``Response`` 是泛型模型:在 FastAPI 中以 ``Response[SomeModel]`` 声明响应模型时,
``data`` 被约束为该模型;直接用 ``Response`` 时 ``data`` 退化为 ``Any``。

业务码用 :class:`windup_common.enums.biz_code.BizCode` 收敛,默认值引用枚举成员;
调用方也可传任意 int 覆盖。用法::

    @router.get("/users/{uid}")
    def get_user(uid: int) -> Response[User]:
        user = ...
        return Response.success(user)

    @router.get("/users/{uid}")
    def get_user(uid: int) -> Response[User]:
        if not (user := find(uid)):
            return Response.fail("用户不存在", code=BizCode.NOT_FOUND)
        return Response.success(user)
"""

from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, Field, model_serializer

from windup_common.enums.biz_code import BizCode

T = TypeVar("T")


class Response(BaseModel, Generic[T]):
    """统一响应体。

    字段:

    - ``code``:业务状态码,成功 :attr:`BizCode.SUCCESS` (200),失败非 200
      (默认 :attr:`BizCode.INTERNAL_ERROR` / 500)。
    - ``message``:提示信息,成功默认 ``"success"``,失败默认 ``"fail"``。
    - ``data``:业务数据,泛型;无数据时序列化为 ``null``(字段保留)。
    - ``timestamp``:响应生成时间,默认不携带;不传时该字段从输出中整体省略
      (而非输出 ``null``),由 ``_omit_null_timestamp`` 序列化器处理。
    """

    code: int = Field(default=BizCode.SUCCESS, description="业务状态码:成功 200,失败非 200")
    message: str = Field(default="success", description="提示信息")
    data: T | None = Field(default=None, description="业务数据")
    timestamp: datetime | None = Field(default=None, description="响应时间;默认不携带,不携带时省略")

    @model_serializer(mode="wrap")
    def _omit_null_timestamp(self, handler):
        """序列化时丢弃为 ``None`` 的 ``timestamp``,其余字段保持默认行为。

        这样不传时间戳时输出里压根没有 ``timestamp`` 键(而非 ``null``);
        ``data`` 为 ``None`` 时仍保留为 ``null``,不影响。
        """
        dumped = handler(self)
        if dumped.get("timestamp") is None:
            dumped.pop("timestamp", None)
        return dumped

    @classmethod
    def success(
        cls,
        data: T | None = None,
        *,
        message: str = "success",
        code: int = BizCode.SUCCESS,
        timestamp: datetime | None = None,
    ) -> "Response[T]":
        """构造成功响应。

        - ``data`` 位置参数,可省略(无数据返回时)。
        - ``message`` / ``code`` / ``timestamp`` 为关键字参数,均有默认值。
        """
        return cls(code=code, message=message, data=data, timestamp=timestamp)

    @classmethod
    def fail(
        cls,
        message: str = "fail",
        *,
        code: int = BizCode.INTERNAL_ERROR,
        data: T | None = None,
        timestamp: datetime | None = None,
    ) -> "Response[T]":
        """构造失败响应。

        - ``message`` 位置参数,默认 ``"fail"``。
        - ``code`` 默认 :attr:`BizCode.INTERNAL_ERROR` (500),可按需覆盖
          (如 :attr:`BizCode.NOT_FOUND` / :attr:`BizCode.BAD_REQUEST`)。
        - ``data`` 一般为空,需要时也可携带错误明细。
        """
        return cls(code=code, message=message, data=data, timestamp=timestamp)
