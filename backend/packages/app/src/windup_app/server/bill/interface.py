"""支付与订阅领域服务抽象接口。

定义账单管理、订单创建、异步通知处理、主动查询及过期处理的抽象。
"""

from abc import ABC, abstractmethod

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
    def close_expired_orders(self, session: Session, order_no: str):
        """关闭超时未支付的订单。"""

    @abstractmethod
    def process_expired_subscriptions(self, session: Session):
        """处理已到期的订阅，清零当期批次并轮转待生效订阅。"""
