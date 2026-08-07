"""OnnxU2NetMatteProvider 契约测试(不加载模型 / 不联网:构造 + 协议合规)。"""

from windup_framework.providers import MatteProvider, OnnxU2NetMatteProvider


def test_onnx_matte_satisfies_matte_provider_protocol():
    # 运行时可检查协议:有 cutout 即满足 MatteProvider(server/ai_engine 依赖此契约)
    provider = OnnxU2NetMatteProvider(model_path="/nonexistent/u2netp.onnx")
    assert isinstance(provider, MatteProvider)
    assert callable(provider.cutout)


def test_onnx_matte_lazy_no_model_load_on_construct():
    # 构造不触发下载 / 会话创建(惰性),模型缺失也不报错
    provider = OnnxU2NetMatteProvider(model_path="/nonexistent/u2netp.onnx")
    assert provider._session is None
