"""积分模块共享枚举与定价常量。

CreditReason  — 积分变动原因
BillingMode   — 预付费 / 后付费
定价常量       — 注册赠送、邀请奖励、生成任务扣减
TOKEN_RATES   — Agent token 汇率（初期全 0，后续按模型配置）
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
    CAPTURED = 8           # 预付费实际扣减（冻结转消耗）
    AGENT_TOKEN = 9        # Agent token 消耗（后付费）


class BillingMode(IntEnum):
    """计费模式。

    对应 ``windup_credit_transaction.billing_mode`` 列。
    """

    PREPAID = 0    # 预付费（生成任务：冻结→扣减/解冻）
    POSTPAID = 1   # 后付费（Agent token：用完再扣）


# -- 积分定价 ---------------------------------------------------------------

REGISTER_GIFT_AMOUNT: int = 100        # 注册赠送积分
INVITE_REWARD_AMOUNT: int = 50         # 邀请奖励（双方各得）

GENERATE_IMAGE_COST: int = 10          # 生成角色参考图
GENERATE_ACTION_COST: int = 50         # 生成角色动作

# -- Token 汇率（每 token 消耗多少积分，初期全 0）----------------------------

TOKEN_RATES: dict[str, float] = {
    # "gpt-4o": 0.01,
    # "gemini-2.5-flash": 0.005,
}
