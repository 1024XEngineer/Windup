"""敏感词服务：Postgres 真相、Redis 缓存、进程内 AC 匹配。"""

from __future__ import annotations

import json
import logging
import threading
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from windup_app.server.sensitive_word.interface import SensitiveWordService
from windup_app.server.sensitive_word.matcher import AhoCorasickMatcher, normalize_text
from windup_app.server.sensitive_word.model import (
    SensitiveHit,
    SensitiveWord,
    SensitiveWordCategory,
    SensitiveWordView,
)
from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_framework.db import SessionLocal
from windup_framework.db.redis import get_redis

logger = logging.getLogger("windup.sensitive_word")

SENSITIVE_WORD_CACHE_KEY = "windup:sensitive_word:enabled"
SENSITIVE_WORD_RELOAD_CHANNEL = "windup:pubsub:sensitive-word-reload"
_RECONNECT_BASE_SECONDS = 1.0
_RECONNECT_MAX_SECONDS = 30.0

WordEntry = tuple[str, SensitiveWordCategory]


def _to_view(row: SensitiveWord) -> SensitiveWordView:
    return SensitiveWordView(
        id=row.id,
        word=row.word,
        category=SensitiveWordCategory(row.category),
        enabled=row.enabled,
        create_at=row.create_at,
        update_at=row.update_at,
    )


class SqlAlchemySensitiveWordService(SensitiveWordService):
    """SQLAlchemy 词库管理 + 无 I/O 匹配热路径。"""

    def __init__(self) -> None:
        self._matcher = AhoCorasickMatcher([])
        self._reload_lock = threading.Lock()

    def scan(self, text: str) -> list[SensitiveHit]:
        matcher = self._matcher
        return matcher.match(text)

    def assert_clean(
        self,
        text: str,
        *,
        user_id: int | None = None,
        source: str | None = None,
    ) -> None:
        hits = self.scan(text)
        if not hits:
            return
        logger.warning(
            "敏感词命中 user_id=%s source=%s words=%s categories=%s",
            user_id,
            source,
            sorted({hit.word for hit in hits}),
            sorted({hit.category.name.lower() for hit in hits}),
        )
        raise BizException("请求包含不允许的内容", code=BizCode.BAD_REQUEST)

    def list_words(
        self,
        session: Session,
        *,
        enabled: bool | None = None,
        category: SensitiveWordCategory | None = None,
    ) -> list[SensitiveWordView]:
        statement = select(SensitiveWord).order_by(SensitiveWord.id)
        if enabled is not None:
            statement = statement.where(SensitiveWord.enabled.is_(enabled))
        if category is not None:
            statement = statement.where(SensitiveWord.category == int(category))
        return [_to_view(row) for row in session.scalars(statement).all()]

    def add_word(
        self,
        session: Session,
        word: str,
        category: SensitiveWordCategory,
    ) -> SensitiveWordView:
        normalized = normalize_text(word).strip()
        if not normalized:
            raise ValueError("敏感词不能为空")
        if len(normalized) > 128:
            raise ValueError("敏感词不能超过 128 个字符")

        row = session.scalar(
            select(SensitiveWord).where(SensitiveWord.word == normalized)
        )
        if row is None:
            row = SensitiveWord(
                word=normalized,
                category=int(category),
                enabled=True,
            )
            session.add(row)
        else:
            row.category = int(category)
            row.enabled = True
        session.flush()
        self._reload_from_database(session, publish=True)
        return _to_view(row)

    def set_enabled(
        self,
        session: Session,
        word_id: int,
        enabled: bool,
    ) -> SensitiveWordView | None:
        row = session.get(SensitiveWord, word_id)
        if row is None:
            return None
        row.enabled = enabled
        session.flush()
        self._reload_from_database(session, publish=True)
        return _to_view(row)

    def reload(self, session: Session, *, prefer_cache: bool = True) -> None:
        entries = self._entries_from_cache() if prefer_cache else None
        if entries is None:
            entries = self._entries_from_database(session)
            self._write_cache(entries)
        self._install(entries)

    def _reload_from_database(self, session: Session, *, publish: bool) -> None:
        entries = self._entries_from_database(session)
        self._install(entries)
        self._write_cache(entries)
        if publish:
            self._publish_reload()

    @staticmethod
    def _entries_from_database(session: Session) -> list[WordEntry]:
        rows = session.execute(
            select(SensitiveWord.word, SensitiveWord.category)
            .where(SensitiveWord.enabled.is_(True))
            .order_by(SensitiveWord.id)
        ).all()
        return [(word, SensitiveWordCategory(category)) for word, category in rows]

    @staticmethod
    def _decode_cache(raw: str | bytes) -> list[WordEntry]:
        if isinstance(raw, bytes):
            raw = raw.decode()
        payload = json.loads(raw)
        if not isinstance(payload, list):
            raise ValueError("敏感词缓存不是列表")
        entries: list[WordEntry] = []
        for item in payload:
            if not isinstance(item, dict):
                raise ValueError("敏感词缓存项不是对象")
            word = normalize_text(str(item["word"])).strip()
            if not word:
                raise ValueError("敏感词缓存包含空词")
            entries.append((word, SensitiveWordCategory(int(item["category"]))))
        return entries

    def _entries_from_cache(self) -> list[WordEntry] | None:
        try:
            raw = get_redis().get(SENSITIVE_WORD_CACHE_KEY)
        except Exception:
            logger.exception("读取敏感词 Redis 缓存失败，回源数据库")
            return None
        if raw is None:
            logger.warning("敏感词 Redis 缓存 miss，回源数据库")
            return None
        try:
            return self._decode_cache(raw)
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            logger.exception("敏感词 Redis 缓存损坏，回源数据库")
            return None

    @staticmethod
    def _cache_payload(entries: Iterable[WordEntry]) -> str:
        return json.dumps(
            [{"word": word, "category": int(category)} for word, category in entries],
            ensure_ascii=False,
            separators=(",", ":"),
        )

    def _write_cache(self, entries: list[WordEntry]) -> None:
        try:
            get_redis().set(
                SENSITIVE_WORD_CACHE_KEY,
                self._cache_payload(entries),
            )
        except Exception:
            logger.exception("写入敏感词 Redis 缓存失败")

    @staticmethod
    def _publish_reload() -> None:
        try:
            get_redis().publish(
                SENSITIVE_WORD_RELOAD_CHANNEL,
                json.dumps({"v": 1}, separators=(",", ":")),
            )
        except Exception:
            logger.exception("发布敏感词重载通知失败")

    def _install(self, entries: list[WordEntry]) -> None:
        matcher = AhoCorasickMatcher(entries)
        with self._reload_lock:
            self._matcher = matcher
        if entries:
            logger.info("敏感词自动机已加载 words=%d", len(entries))
        else:
            logger.warning("敏感词词库为空，当前请求将放行")


class SensitiveWordReloadSubscriber:
    """订阅跨进程词库变更并重建当前 web 进程的自动机。"""

    def __init__(
        self,
        word_service: SqlAlchemySensitiveWordService,
        *,
        channel: str = SENSITIVE_WORD_RELOAD_CHANNEL,
    ) -> None:
        self._service = word_service
        self._channel = channel
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run,
            name="windup-sensitive-word-subscriber",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None

    def _run(self) -> None:
        backoff = _RECONNECT_BASE_SECONDS
        while not self._stop.is_set():
            try:
                self._listen_once()
                backoff = _RECONNECT_BASE_SECONDS
            except Exception:
                if self._stop.is_set():
                    break
                logger.exception(
                    "敏感词订阅连接中断，%.1fs 后重连 channel=%s",
                    backoff,
                    self._channel,
                )
                if self._stop.wait(timeout=backoff):
                    break
                backoff = min(backoff * 2, _RECONNECT_MAX_SECONDS)

    def _listen_once(self) -> None:
        pubsub = get_redis().pubsub(ignore_subscribe_messages=True)
        pubsub.subscribe(self._channel)
        logger.info("敏感词订阅已启动 channel=%s", self._channel)
        try:
            while not self._stop.is_set():
                message = pubsub.get_message(timeout=1.0)
                if not message or message.get("type") != "message":
                    continue
                session = SessionLocal()
                try:
                    self._service.reload(session)
                finally:
                    session.close()
        finally:
            pubsub.close()


service = SqlAlchemySensitiveWordService()
