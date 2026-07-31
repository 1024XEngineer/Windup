from windup_app.bootstrap.app import create_app


def test_create_app():
    app = create_app()
    assert app.title == "windup"
