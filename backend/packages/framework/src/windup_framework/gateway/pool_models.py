"""Gateway 凭证池配置表 ORM。

成员表是唯一真相：Admit 与 Gateway 都通过 :mod:`pool_registry` 物化路由边。
在途 / 冷却 / shot 仍在 Redis，不入库。

密钥只存 ``api_key_ciphertext``；运行时解密后仅在进程内使用，禁止写入 ledger / 日志。
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from windup_framework.db import Base

_BIGINT = BigInteger().with_variant(Integer, "sqlite")

# ── 枚举值（CHECK 约束，不用 DB enum 以便 sqlite 测试）────────────────────

POOL_STATUS_ACTIVE = "active"
POOL_STATUS_DISABLED = "disabled"
POOL_STATUS_DRAINING = "draining"

QUOTA_SCOPE_CREDENTIAL = "credential"
QUOTA_SCOPE_ACCOUNT = "account"


class GatewayPoolAccount(Base):
    """上游计费主体；账号级在途与 429 冷却挂在此实体上。"""

    __tablename__ = "windup_gateway_pool_account"
    __table_args__ = (
        CheckConstraint(
            f"status IN ('{POOL_STATUS_ACTIVE}', '{POOL_STATUS_DISABLED}', '{POOL_STATUS_DRAINING}')",
            name="ck_gateway_pool_account_status",
        ),
        CheckConstraint(
            f"quota_scope IN ('{QUOTA_SCOPE_CREDENTIAL}', '{QUOTA_SCOPE_ACCOUNT}')",
            name="ck_gateway_pool_account_quota_scope",
        ),
        CheckConstraint("inflight_max >= 1", name="ck_gateway_pool_account_inflight_max"),
    )

    account_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    display_name: Mapped[str] = mapped_column(Text, nullable=False, default="")
    quota_scope: Mapped[str] = mapped_column(
        String(16), nullable=False, default=QUOTA_SCOPE_CREDENTIAL
    )
    inflight_max: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=POOL_STATUS_ACTIVE
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class GatewayPoolEndpoint(Base):
    """聚合入口；故障域是 TLS / 522 / 525。"""

    __tablename__ = "windup_gateway_pool_endpoint"
    __table_args__ = (
        CheckConstraint(
            f"status IN ('{POOL_STATUS_ACTIVE}', '{POOL_STATUS_DISABLED}', '{POOL_STATUS_DRAINING}')",
            name="ck_gateway_pool_endpoint_status",
        ),
        Index("ix_gateway_pool_endpoint_status", "status"),
    )

    endpoint_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    display_name: Mapped[str] = mapped_column(Text, nullable=False, default="")
    base_url: Mapped[str] = mapped_column(Text, nullable=False)
    provider_name: Mapped[str] = mapped_column(Text, nullable=False, default="openai-compatible")
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=POOL_STATUS_ACTIVE
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class GatewayPoolCredential(Base):
    """鉴权材料；job 粘在此实体上。"""

    __tablename__ = "windup_gateway_pool_credential"
    __table_args__ = (
        CheckConstraint(
            f"status IN ('{POOL_STATUS_ACTIVE}', '{POOL_STATUS_DISABLED}', '{POOL_STATUS_DRAINING}')",
            name="ck_gateway_pool_credential_status",
        ),
        CheckConstraint(
            "credential_inflight_max IS NULL OR credential_inflight_max >= 1",
            name="ck_gateway_pool_credential_inflight_max",
        ),
        Index("ix_gateway_pool_credential_account", "account_id", "status"),
        Index("ix_gateway_pool_credential_status", "status"),
    )

    credential_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("windup_gateway_pool_account.account_id"),
        nullable=False,
    )
    api_key_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    api_key_hint: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    credential_inflight_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=POOL_STATUS_ACTIVE
    )
    disabled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class GatewayPoolCredentialEndpoint(Base):
    """Credential × Endpoint × route_group 挂载边；``priority`` 决定 Gateway 候选顺序。"""

    __tablename__ = "windup_gateway_pool_credential_endpoint"
    __table_args__ = (
        CheckConstraint(
            f"status IN ('{POOL_STATUS_ACTIVE}', '{POOL_STATUS_DISABLED}', '{POOL_STATUS_DRAINING}')",
            name="ck_gateway_pool_cred_ep_status",
        ),
        CheckConstraint(
            "route_group IN ('character_image', 'character_action', 'chat')",
            name="ck_gateway_pool_cred_ep_route_group",
        ),
        UniqueConstraint(
            "credential_id",
            "endpoint_id",
            "route_group",
            name="uq_gateway_pool_cred_ep",
        ),
        Index(
            "ix_gateway_pool_cred_ep_route",
            "route_group",
            "status",
            "priority",
        ),
    )

    id: Mapped[int] = mapped_column(_BIGINT, primary_key=True, autoincrement=True)
    credential_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("windup_gateway_pool_credential.credential_id"),
        nullable=False,
    )
    endpoint_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("windup_gateway_pool_endpoint.endpoint_id"),
        nullable=False,
    )
    route_group: Mapped[str] = mapped_column(String(32), nullable=False)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=POOL_STATUS_ACTIVE
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


class GatewayPoolCapability(Base):
    """P2：显式型号授权边。无行时 Registry 退回「同 family 全型号可打」。"""

    __tablename__ = "windup_gateway_pool_capability"
    __table_args__ = (
        UniqueConstraint(
            "credential_id",
            "endpoint_id",
            "model",
            name="uq_gateway_pool_capability",
        ),
        Index("ix_gateway_pool_capability_lookup", "endpoint_id", "model", "enabled"),
    )

    id: Mapped[int] = mapped_column(_BIGINT, primary_key=True, autoincrement=True)
    credential_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("windup_gateway_pool_credential.credential_id"),
        nullable=True,
    )
    endpoint_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("windup_gateway_pool_endpoint.endpoint_id"),
        nullable=False,
    )
    model: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
