from unittest.mock import MagicMock, Mock

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from windup_app.server.quick_start_conversation.model import QuickStartAgentConversation
from windup_app.server.quick_start_conversation.service import (
    QuickStartConversationService,
)


def test_concurrent_first_insert_returns_the_identical_winning_snapshot():
    turns = [{"role": "user", "content": "像素骑士"}]
    winner = QuickStartAgentConversation(
        workflow_run_id=18,
        turns=turns,
        schema_version=2,
        version=1,
    )
    session = MagicMock(spec=Session)
    session.flush.side_effect = IntegrityError("duplicate", {}, Exception("unique"))
    service = QuickStartConversationService()
    service.get = Mock(side_effect=[None, winner])

    saved = service.save(
        session,
        18,
        expected_version=0,
        schema_version=2,
        turns=turns,
    )

    assert saved is winner
    session.expire_all.assert_called_once_with()
