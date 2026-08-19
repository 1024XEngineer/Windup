"""积分定价配置。

所有定价参数通过环境变量 / .env 文件注入，支持后续配置管理平台。
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class QuotaSettings(BaseSettings):
    """积分定价配置。

    环境变量前缀 ``QUOTA_``，例如 ``QUOTA_REGISTER_GIFT_AMOUNT=300``。
    """

    model_config = SettingsConfigDict(
        env_prefix="QUOTA_",
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # -- 注册 / 邀请 -------------------------------------------------------
    register_gift_amount: int = 300         # 注册赠送积分
    invite_reward_amount: int = 200         # 邀请奖励（双方各得）
    invite_reward_daily_limit: int = 3      # 邀请人每日可获奖励的邀请人数（3×200=600）
    invite_code_ttl_days: int = 30          # 邀请码有效期（天）

    # -- 生成任务 -----------------------------------------------------------
    generate_image_cost: int = 10           # 生成角色参考图
    generate_action_cost: int = 50          # 生成角色动作


settings = QuotaSettings()
