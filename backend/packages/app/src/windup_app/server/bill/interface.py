"""支付与订阅领域服务抽象接口。

定义账单管理、订单创建、异步通知处理、主动查询及过期处理的抽象。
"""

from abc import ABC, abstractmethod
from typing import Literal

from sqlalchemy.orm import Session


class BillService(ABC):
    """支付与订阅业务服务抽象。"""

    @abstractmethod
    def create_order(
        self,
        session: Session,
        user_id: int,
        product_id: int | None,
        amount_fen: int | None,
        channel: str,
    ):
        """创建支付订单。"""

    @abstractmethod
    def handle_notify(self, session: Session, payload: dict):
        """处理支付回调异步通知。"""

    @abstractmethod
    def query_order(self, session: Session, order_no: str):
        """查询订单详情（必要时向上游渠道补偿查询）。"""

    @abstractmethod
    def close_expired_orders(
        self, session: Session, order_no: str
    ) -> Literal["closed", "paid", "retry", "skipped"]:
        """关闭超时未支付的订单。

        先向上游核实支付结果：确认未支付才迁移 CLOSED；上游已支付的补发货；
        结果不确定时保持 PENDING 并返回 "retry"，由调用方延后重试。
        """

    @abstractmethod
    def process_expired_subscriptions(self, session: Session):
        """处理已到期的订阅，清零当期批次并轮转待生效订阅。"""
