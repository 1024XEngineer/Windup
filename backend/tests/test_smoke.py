from unittest.mock import Mock

from fastapi.testclient import TestClient

from windup_app.bootstrap.app import create_app


def test_create_app():
    app = create_app()
    assert app.title == "windup"


def test_health_endpoint_reports_ok_without_auth(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_lifespan_shuts_down_generation_dispatcher(monkeypatch):
    import windup_app.bootstrap.app as app_module

    create_all = Mock()
    monkeypatch.setattr(app_module.Base.metadata, "create_all", create_all)
    app = create_app()
    dispatcher = Mock()
    app.state.generation_dispatcher = dispatcher

    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        dispatcher.shutdown.assert_not_called()

    create_all.assert_called_once_with(app_module.engine)
    dispatcher.shutdown.assert_called_once_with()
