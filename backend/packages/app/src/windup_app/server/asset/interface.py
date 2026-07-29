"""资产库领域抽象接口。

资产库是项目级的统一文件存储层，只关心"文件是什么"。
角色模块通过三张关联表引用资产，负责"谁在用、怎么用"。

调用链::

    上传 API → AssetService.create → 资产入库
    角色管理 API → CharacterService.add_template / add_action / equip_wearable
                   → 内部调用 AssetService.get 校验资产存在性
                   → 写入关联表
"""

from abc import ABC, abstractmethod

from windup_app.server.asset.model import (
    Asset,
    AssetType,
    CreateAssetInput,
    ListAssetsFilter,
    UpdateAssetInput,
)


class AssetService(ABC):
    """资产库用例的稳定边界。"""

    # -- CRUD ------------------------------------------------------------

    @abstractmethod
    def create(self, input: CreateAssetInput) -> Asset:
        """创建资产记录（上传完成后调用）。"""

    @abstractmethod
    def get(self, asset_id: int) -> Asset | None:
        """按 ID 查询资产。"""

    @abstractmethod
    def list_by_project(
        self,
        *,
        project_id: int,
        filter: ListAssetsFilter | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[Asset], int]:
        """分页查询项目下的资产。

        可按 asset_type / keyword / status 筛选。
        """

    @abstractmethod
    def update(self, asset_id: int, input: UpdateAssetInput) -> Asset | None:
        """更新资产（名称 / 描述 / 缩略图 / 元数据）。"""

    @abstractmethod
    def delete(self, asset_id: int) -> bool:
        """删除资产（同时删除关联表中的引用）。"""

    # -- 批量 ------------------------------------------------------------

    @abstractmethod
    def get_by_ids(self, asset_ids: list[int]) -> list[Asset]:
        """按 ID 列表批量查询，保持输入顺序。"""

    @abstractmethod
    def count_by_type(self, project_id: int) -> dict[AssetType, int]:
        """统计项目下各类型资产数量。

        返回::

            {
                AssetType.CHARACTER_TEMPLATE: 3,
                AssetType.CHARACTER_ACTION: 12,
                AssetType.WEARABLE: 5,
            }
        """