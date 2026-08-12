"""积分领域服务抽象接口。

API 层只依赖本模块定义的抽象，不感知具体实现（ORM / SQL）。
"""

from abc import ABC, abstractmethod

from sqlalchemy.orm import Session

from windup_app.server.quota.model import (
    CreditAccountView,
    CreditTransactionView,
    InviteCodeView,
)


class QuotaService(ABC):
    """积分用例的稳定边界。"""

    # -- 账户 ------------------------------------------------------------

    @abstractmethod
    def get_account(self, session: Session, user_id: int) -> CreditAccountView | None:
        """查询用户积分账户。"""

    # -- 预付费：冻结 / 扣减 / 解冻 ----------------------------------------

    @abstractmethod
    def reserve_credit(
        self, session: Session, user_id: int, amount: int, ref_id: str
    ) -> None:
        """预付费冻结：从可用余额转移到冻结。

        :raises BizException: 积分不足。
        """

    @abstractmethod
    def capture_credit(
        self, session: Session, user_id: int, actual_amount: int, ref_id: str, frozen_amount: int
    ) -> None:
        """预付费扣减：冻结转消耗。

        若 actual_amount < frozen_amount，差额自动退回可用余额。

        :raises BizException: 冻结额度不足。
        """

    @abstractmethod
    def release_credit(
        self, session: Session, user_id: int, amount: int, ref_id: str
    ) -> None:
        """预付费解冻：冻结退回可用余额（任务失败时调用）。

        :raises BizException: 冻结额度不足。
        """

    # -- 后付费：原子扣减 --------------------------------------------------

    @abstractmethod
    def deduct_postpaid(
        self, session: Session, user_id: int, amount: int, ref_id: str
    ) -> None:
        """后付费原子扣减（Agent token 等）。

        使用 UPDATE ... WHERE balance >= :amount，数据库层面防负。

        :raises BizException: 积分不足。
        """

    # -- 入账（赠送 / 奖励 / 管理员调整）----------------------------------

    @abstractmethod
    def credit(
        self, session: Session, user_id: int, amount: int, reason: int, ref_id: str | None = None
    ) -> None:
        """入账：增加可用余额与累计获得。"""

    # -- 流水查询 ---------------------------------------------------------

    @abstractmethod
    def list_transactions(
        self, session: Session, user_id: int, page: int = 1, page_size: int = 20
    ) -> tuple[list[CreditTransactionView], int]:
        """分页查询积分流水，返回 (列表, 总数)。"""

    # -- 邀请码 -----------------------------------------------------------

    @abstractmethod
    def get_invite_code(self, session: Session, user_id: int) -> InviteCodeView | None:
        """获取用户当前邀请码。"""

    @abstractmethod
    def generate_invite_code(self, session: Session, user_id: int) -> InviteCodeView:
        """生成新邀请码（替换旧码）。"""

    @abstractmethod
    def redeem_invite_code(self, session: Session, user_id: int, code: str) -> None:
        """兑换邀请码，双方各得积分。

        :raises BizException: 邀请码无效 / 已达上限 / 已填过码。
        """
