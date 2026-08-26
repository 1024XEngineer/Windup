"""积分模块共享枚举。

CreditReason  — 积分变动原因
BillingMode   — 预付费 / 后付费

定价参数由 ``windup_framework.config.quota.settings`` 提供，此处不硬编码。
"""

from enum import IntEnum


class CreditReason(IntEnum):
    """积分变动原因。

    对应 ``windup_credit_transaction.reason`` 列。
    """

    REGISTER_GIFT = 1      # 注册赠送
    INVITE_REWARD = 2      # 邀请奖励
    GENERATE_IMAGE = 3     # 生成角色参考图
    GENERATE_ACTION = 4    # 生成角色动作
    ADMIN_ADJUST = 5       # 管理员手动调整
    REFUND = 6             # 退款 / 回退 / 解冻退回
    FROZEN = 7             # 预付费冻结（占用余额）
    CAPTURED = 8    # 预付费实际扣减（冻结转消耗）
    REDEMPTION = 9  # 兑换码入账
    # AGENT_TOKEN = 9        # Agent token 消耗（后付费）先不实现后付费场景


class BillingMode(IntEnum):
    """计费模式。

    对应 ``windup_credit_transaction.billing_mode`` 列。
    """

    PREPAID = 0    # 预付费（生成任务：冻结→扣减/解冻）
    # POSTPAID = 1   # 后付费（Agent token：用完再扣）
