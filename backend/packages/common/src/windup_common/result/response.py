"""统一响应封装。

提供成功 / 失败两种响应格式,字段统一为 ``code`` / ``message`` / ``data``;
``timestamp`` 可选,需要时由调用方传入,默认不携带。

- :class:`Response` -- 单元素响应,``data`` 为单个对象或 ``None``。
- :class:`ListResponse` -- 列表响应,``data`` 为 ``list[T]``,带分页字段
  ``total`` / ``page`` / ``page_size``;全量(不分页)场景 ``page_size=0``、
  ``total`` 默认取 ``len(data)``(避免有数据却 total=0 误导前端)。

两者都是泛型模型:在 FastAPI 中以 ``Response[SomeModel]`` / ``ListResponse[SomeModel]``
声明响应模型时,``data`` 被约束为该模型;直接用裸类时 ``data`` 退化为 ``Any`` / ``list[Any]``。

业务码用 :class:`windup_common.enums.biz_code.BizCode` 收敛,默认值引用枚举成员;
调用方也可传任意 int 覆盖。用法::

    @router.get("/users/{uid}")
    def get_user(uid: int) -> Response[User]:
        if not (user := find(uid)):
            return Response.fail("用户不存在", code=BizCode.NOT_FOUND)
        return Response.success(user)

    @router.get("/users")
    def list_users(
        page: int = 1, page_size: int = 20,
    ) -> ListResponse[User]:
        users, total = user_service.page(page, page_size)
        return ListResponse.success(users, total=total, page=page, page_size=page_size)
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


class ListResponse(BaseModel, Generic[T]):
    """列表响应体(带分页字段)。

    与 :class:`Response` 对应,但 ``data`` 为 ``list[T]``;额外带分页字段
    ``total`` / ``page`` / ``page_size``,一个类同时覆盖分页与全量两种列表场景。

    字段:

    - ``code`` / ``message`` / ``timestamp``:同 :class:`Response`。
    - ``data``:业务数据列表,泛型;无数据时序列化为 ``[]``(非 null)。
    - ``total``:数据总数。分页时为满足查询条件的总数(由调用方传入);
      不分页时默认 ``len(data)``。
    - ``page``:当前页码,从 1 开始,默认 1。
    - ``page_size``:每页条数;``0`` 表示不分页(全量),默认 0--前端据此判断是否翻页。
    """

    code: int = Field(default=BizCode.SUCCESS, description="业务状态码:成功 200,失败非 200")
    message: str = Field(default="success", description="提示信息")
    data: list[T] = Field(default_factory=list, description="业务数据列表")
    total: int = Field(default=0, description="数据总数;分页时为查询条件总数,不分页时为 len(data)")
    page: int = Field(default=1, ge=1, description="当前页码,从 1 开始")
    page_size: int = Field(default=0, ge=0, description="每页条数;0 表示不分页(全量)")
    timestamp: datetime | None = Field(default=None, description="响应时间;默认不携带,不携带时省略")

    @model_serializer(mode="wrap")
    def _omit_null_timestamp(self, handler):
        """序列化时丢弃为 ``None`` 的 ``timestamp``(行为同 :class:`Response`)。"""
        dumped = handler(self)
        if dumped.get("timestamp") is None:
            dumped.pop("timestamp", None)
        return dumped

    @classmethod
    def success(
        cls,
        data: list[T] | None = None,
        *,
        total: int | None = None,
        page: int = 1,
        page_size: int = 0,
        message: str = "success",
        code: int = BizCode.SUCCESS,
        timestamp: datetime | None = None,
    ) -> "ListResponse[T]":
        """构造成功响应。

        - ``data`` 位置参数,可省略或传 ``None``--两者都得到空列表。
        - ``total`` 默认 ``len(data)``;**分页场景应显式传入查询条件总数**,
          否则会误把本页条数当总数。
        - ``page`` / ``page_size``:分页参数,默认 ``page=1``、``page_size=0``(不分页)。
        """
        items = data or []
        return cls(
            code=code,
            message=message,
            data=items,
            total=total if total is not None else len(items),
            page=page,
            page_size=page_size,
            timestamp=timestamp,
        )

    @classmethod
    def fail(
        cls,
        message: str = "fail",
        *,
        code: int = BizCode.INTERNAL_ERROR,
        data: list[T] | None = None,
        total: int = 0,
        page: int = 1,
        page_size: int = 0,
        timestamp: datetime | None = None,
    ) -> "ListResponse[T]":
        """构造失败响应。

        失败时一般不带业务数据;分页字段保留默认(``total=0`` / ``page=1`` / ``page_size=0``)。
        """
        return cls(
            code=code,
            message=message,
            data=data or [],
            total=total,
            page=page,
            page_size=page_size,
            timestamp=timestamp,
        )
