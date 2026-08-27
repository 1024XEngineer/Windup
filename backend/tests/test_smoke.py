from unittest.mock import Mock

from fastapi.testclient import TestClient

from windup_app.bootstrap.app import create_app


def test_create_app():
    app = create_app()
    assert app.title == "windup"


def test_create_app_does_not_construct_chat_model(monkeypatch):
    """CI 没有 AI_API_KEY，装配期不能去建 ChatOpenAI。"""
    from windup_app.server.character.service import service as character_service

    def boom(*_args, **_kwargs):
        raise AssertionError("create_chat_model should not run during create_app")

    monkeypatch.setattr(
        "windup_ai_engine.impl.character_namer.create_chat_model",
        boom,
    )
    character_service._namer = None
    app = create_app()
    assert app.title == "windup"


def test_health_endpoint_reports_ok_without_auth(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_lifespan_stops_sse_subscriber(monkeypatch):
    import windup_app.bootstrap.app as app_module

    create_all = Mock()
    monkeypatch.setattr(app_module.Base.metadata, "create_all", create_all)
    monkeypatch.setattr(app_module, "relay_pending_messages", Mock())
    session = Mock()
    monkeypatch.setattr(app_module, "SessionLocal", Mock(return_value=session))
    monkeypatch.setattr(
        app_module,
        "seed_sensitive_words",
        Mock(return_value=False),
    )
    reload_words = Mock()
    monkeypatch.setattr(app_module.sensitive_word_service, "reload", reload_words)

    subscriber = Mock()
    monkeypatch.setattr(app_module, "RedisTaskEventSubscriber", Mock(return_value=subscriber))
    word_subscriber = Mock()
    monkeypatch.setattr(
        app_module,
        "SensitiveWordReloadSubscriber",
        Mock(return_value=word_subscriber),
    )

    app = create_app()

    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        subscriber.start.assert_called_once()
        word_subscriber.start.assert_called_once()
        subscriber.stop.assert_not_called()

    create_all.assert_called_once_with(app_module.engine)
    session.commit.assert_called_once_with()
    reload_words.assert_called_once_with(session, prefer_cache=True)
    session.close.assert_called_once_with()
    word_subscriber.stop.assert_called_once_with()
    subscriber.stop.assert_called_once_with()
