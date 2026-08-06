"""部署形态的两颗钉子：镜像装齐运行期依赖 + 探针可达。

两条都属于"容器能起来 ≠ 请求能成功"这一类问题，只在真实部署后才暴露，
所以在 CI 里各钉一颗。CORS 相关的断言在 ``test_cors.py``。
"""

import importlib.util

from fastapi.testclient import TestClient

from windup_app.bootstrap.app import create_app


def test_media_upload_dependency_is_declared():
    """``server/media/service.py`` 在函数体里延迟 import qiniu。

    不在 pyproject/uv.lock 里声明的话，镜像照样能构建、能启动、``/docs`` 也正常，
    直到第一次 ``POST /media/upload`` 才 ``ModuleNotFoundError: qiniu``。
    """
    assert importlib.util.find_spec("qiniu") is not None


def test_health_endpoint_is_reachable():
    """容器 HEALTHCHECK 打的是 /health，不是 /docs。

    /docs 在生产会被关掉（``docs_url=None``），那时探针永远失败、容器被反复判死。
    """
    resp = TestClient(create_app()).get("/health")

    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
