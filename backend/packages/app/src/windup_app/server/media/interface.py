"""媒体资产领域抽象接口。

采用策略模式：

- :class:`MediaProcessor` — 策略接口，每种媒体类型一个实现，
  封装加工、缩略图、元数据提取。
- :class:`MediaService` — 上下文，持有策略注册表，负责资产 CRUD
  并按 ``media_type`` 分发加工请求到对应策略。

新增媒体类型只需新增一个 ``MediaProcessor`` 子类并注册即可。
"""

from abc import ABC, abstractmethod

from windup_app.server.media.model import (
    Derivative,
    MediaRecord,
    MediaType,
)


# -- 策略接口 ------------------------------------------------------------

class MediaProcessor(ABC):
    """单一媒体类型的加工策略。

    子类 = 一种媒体处理能力（图片 / 视频 / 音频 / 3D 模型 / …）。
    """

    @property
    @abstractmethod
    def media_type(self) -> MediaType:
        """该策略处理的媒体类型。"""

    @abstractmethod
    def process(self, source_url: str, options: dict) -> list[Derivative]:
        """加工源文件，返回产物列表。

        子类负责将 options 反序列化为自己的选项模型。
        """

    @abstractmethod
    def thumbnail(self, source_url: str) -> Derivative:
        """生成缩略图。"""

    @abstractmethod
    def extract_metadata(self, source_url: str) -> dict:
        """提取元数据（尺寸 / 时长 / 编码 / 顶点数…）。"""


# -- 上下文接口 ----------------------------------------------------------

class MediaService(ABC):
    """媒体资产用例的稳定边界。

    持有策略注册表 :meth:`register_processor`，API 层不感知具体处理器。
    上传能力由 :class:`AssetUploader` 族提供，本接口聚焦资产管理 + 加工。
    """

    # -- 策略注册 ---------------------------------------------------------

    @abstractmethod
    def register_processor(self, processor: MediaProcessor) -> None:
        """注册媒体处理器。

        通常在应用装配层调用：
        ``service.register_processor(ImageProcessor())``
        """

    # -- 资产 CRUD --------------------------------------------------------

    @abstractmethod
    def create(
        self,
        *,
        user_id: int,
        media_type: MediaType,
        original_url: str,
        original_name: str,
        file_size: int,
        project_id: int | None = None,
    ) -> MediaRecord:
        """创建媒体记录（上传完成后调用）。"""

    @abstractmethod
    def get(self, media_id: int) -> MediaRecord | None:
        """按 ID 查询媒体资产（含加工产物列表）。"""

    @abstractmethod
    def list(
        self,
        *,
        project_id: int | None = None,
        media_type: MediaType | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[MediaRecord], int]:
        """分页查询媒体资产，可按项目和类型过滤。"""

    @abstractmethod
    def delete(self, media_id: int) -> bool:
        """删除媒体资产及其所有加工产物。"""

    # -- 加工 ------------------------------------------------------------

    @abstractmethod
    def process(
        self,
        media_id: int,
        options: dict,
    ) -> MediaRecord:
        """对已有媒体执行加工，按 media_type 分发到对应策略。

        加工产物追加到 ``derivatives`` 列表并持久化。

        :raises windup_common.exceptions.BizException: 不支持的 media_type。
        """

    @abstractmethod
    def generate_thumbnail(self, media_id: int) -> Derivative:
        """生成缩略图并追加到 derivatives。"""

    @abstractmethod
    def refresh_metadata(self, media_id: int) -> dict:
        """重新提取元数据并更新记录。"""