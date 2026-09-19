"""i2v 首帧的对象存储上传器。

只吃公网 URL 的 i2v 接口(veo 走的 FAL 队列面)需要先把首帧传上去。实现住在 app 层
而不是 framework:它要碰对象存储凭证,而 framework 只认 ``FirstFrameUploader`` 这个 port。
"""

from __future__ import annotations

from windup_common.enums.media import MediaCategory

from windup_app.server.media.model import MediaUploadInput


class MediaFirstFrameUploader:
    """复用既有媒体上传服务,不另起一套对象存储客户端。

    另起一套的代价不是多写几十行,是**两套凭证与两套桶策略**会各自漂移:一套改了
    下载域名、另一套没改,而这里传坏了的表现是上游取不到图、任务在生成阶段才 failed。
    """

    def upload(self, first_frame: bytes, content_type: str) -> str:
        # 惰性导入:``service`` 在模块级实例化,顶层导入会把对象存储配置拉进每个引用者。
        from windup_app.server.media.service import service as media_service

        meta = MediaUploadInput(
            filename="i2v-first-frame.jpg",
            content_type=content_type,
            size=len(first_frame),
            # 沿用 ACTION_FRAME 而不新开一个分类:``MediaCategory`` 是 ``POST /media/upload``
            # 请求体里的公开枚举,加一个值等于给客户端多开一个可上传的分类 ——
            # 一个纯内部的中转文件不该改动对外契约(openapi.json 会跟着变)。
            category=MediaCategory.ACTION_FRAME,
        )
        return media_service.upload(first_frame, meta).url
