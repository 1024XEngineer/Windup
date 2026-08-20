"""完美像素工具可以映射为稳定 API 结果的失败类型。"""


class PixelPerfectError(Exception):
    """本地工具可预期失败的基类。"""


class PixelPerfectBusyError(PixelPerfectError):
    pass


class PixelPerfectInputError(PixelPerfectError):
    pass


class PixelPerfectUnavailableError(PixelPerfectError):
    pass
