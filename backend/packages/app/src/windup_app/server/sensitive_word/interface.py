"""敏感词领域服务接口。"""

from abc import ABC, abstractmethod

from sqlalchemy.orm import Session

from windup_app.server.sensitive_word.model import (
    SensitiveHit,
    SensitiveWordCategory,
    SensitiveWordView,
)


class SensitiveWordService(ABC):
    """内部敏感词过滤与词库管理边界。"""

    @abstractmethod
    def scan(self, text: str) -> list[SensitiveHit]:
        """扫描文本并返回全部命中。"""

    @abstractmethod
    def assert_clean(
        self,
        text: str,
        *,
        user_id: int | None = None,
        source: str | None = None,
    ) -> None:
        """命中时抛出业务异常。"""

    @abstractmethod
    def list_words(
        self,
        session: Session,
        *,
        enabled: bool | None = None,
        category: SensitiveWordCategory | None = None,
    ) -> list[SensitiveWordView]:
        """列出词库。"""

    @abstractmethod
    def add_word(
        self,
        session: Session,
        word: str,
        category: SensitiveWordCategory,
    ) -> SensitiveWordView:
        """新增或重新启用一个词。"""

    @abstractmethod
    def set_enabled(
        self,
        session: Session,
        word_id: int,
        enabled: bool,
    ) -> SensitiveWordView | None:
        """启用或禁用一个词。"""

    @abstractmethod
    def reload(self, session: Session, *, prefer_cache: bool = True) -> None:
        """从 Redis 缓存或数据库重建当前进程的自动机。"""
