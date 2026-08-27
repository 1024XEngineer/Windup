"""Quick Start Agent 对话快照的 SQLAlchemy 服务。"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException

from .model import QuickStartAgentConversation


def _version_conflict() -> None:
    raise BizException(
        "Agent 对话版本冲突，请刷新后重试",
        code=BizCode.CONFLICT,
    )


class QuickStartConversationService:
    """读取和乐观锁写入每条 WorkflowRun 的完整对话快照。"""

    def get(
        self,
        session: Session,
        workflow_run_id: int,
    ) -> QuickStartAgentConversation | None:
        return session.get(QuickStartAgentConversation, workflow_run_id)

    def save(
        self,
        session: Session,
        workflow_run_id: int,
        *,
        expected_version: int,
        schema_version: int,
        turns: list[dict],
    ) -> QuickStartAgentConversation:
        conversation = self.get(session, workflow_run_id)
        if conversation is None:
            if expected_version != 0:
                _version_conflict()
            candidate = QuickStartAgentConversation(
                workflow_run_id=workflow_run_id,
                turns=turns,
                schema_version=schema_version,
            )
            try:
                # 两个首次 PUT 可同时读到空记录；savepoint 只回滚输掉的 INSERT，
                # 不破坏外层请求事务，随后按幂等规则读取胜出的快照。
                with session.begin_nested():
                    session.add(candidate)
                    session.flush()
                return candidate
            except IntegrityError:
                session.expire_all()
                conversation = self.get(session, workflow_run_id)
                if conversation is None:
                    raise
                if (
                    conversation.turns == turns
                    and conversation.schema_version == schema_version
                ):
                    return conversation
                _version_conflict()

        if (
            conversation.turns == turns
            and conversation.schema_version == schema_version
        ):
            return conversation
        if conversation.version != expected_version:
            _version_conflict()

        result = session.execute(
            update(QuickStartAgentConversation)
            .where(
                QuickStartAgentConversation.workflow_run_id == workflow_run_id,
                QuickStartAgentConversation.version == expected_version,
            )
            .values(
                turns=turns,
                schema_version=schema_version,
                version=expected_version + 1,
                updated_at=datetime.now(timezone.utc),
            )
            .execution_options(synchronize_session="fetch")
        )
        if result.rowcount == 0:
            _version_conflict()
        session.refresh(conversation)
        return conversation


service = QuickStartConversationService()
