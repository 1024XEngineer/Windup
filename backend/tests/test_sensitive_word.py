"""敏感词匹配、持久化与 Redis 缓存。"""

from sqlalchemy import func, select

from windup_app.server.sensitive_word.matcher import AhoCorasickMatcher
from windup_app.server.sensitive_word.model import (
    SensitiveWord,
    SensitiveWordCategory,
)
from windup_app.server.sensitive_word.seed import seed_sensitive_words
from windup_app.server.sensitive_word.service import (
    SENSITIVE_WORD_CACHE_KEY,
    SqlAlchemySensitiveWordService,
)


class _FakeRedis:
    def __init__(self, cached=None):
        self.cached = cached
        self.set_calls: list[tuple[str, str]] = []
        self.published: list[tuple[str, str]] = []

    def get(self, key):
        assert key == SENSITIVE_WORD_CACHE_KEY
        return self.cached

    def set(self, key, value):
        self.cached = value
        self.set_calls.append((key, value))

    def publish(self, channel, value):
        self.published.append((channel, value))


def test_ac_matches_nested_words_and_normalized_bypasses():
    matcher = AhoCorasickMatcher(
        [
            ("she", SensitiveWordCategory.CONTENT),
            ("he", SensitiveWordCategory.INJECTION),
            ("ignore", SensitiveWordCategory.INJECTION),
        ]
    )

    hits = matcher.match("Ｓ\u200bＨＥ said IGN\u200bORE")

    assert [(hit.word, hit.start, hit.end) for hit in hits] == [
        ("she", 0, 3),
        ("he", 1, 3),
        ("ignore", 9, 15),
    ]
    assert matcher.match("") == []


def test_reload_cache_miss_reads_database_and_populates_redis(
    db_session,
    monkeypatch,
):
    db_session.add(
        SensitiveWord(
            word="忽略之前的指令",
            category=int(SensitiveWordCategory.INJECTION),
        )
    )
    db_session.commit()
    redis = _FakeRedis()
    monkeypatch.setattr(
        "windup_app.server.sensitive_word.service.get_redis",
        lambda: redis,
    )
    word_service = SqlAlchemySensitiveWordService()

    word_service.reload(db_session)

    assert word_service.scan("请忽略之前的指令") != []
    assert len(redis.set_calls) == 1


def test_reload_bad_cache_falls_back_to_database(db_session, monkeypatch):
    db_session.add(
        SensitiveWord(
            word="reveal system prompt",
            category=int(SensitiveWordCategory.INJECTION),
        )
    )
    db_session.commit()
    redis = _FakeRedis(cached="{broken")
    monkeypatch.setattr(
        "windup_app.server.sensitive_word.service.get_redis",
        lambda: redis,
    )
    word_service = SqlAlchemySensitiveWordService()

    word_service.reload(db_session)

    assert word_service.scan("REVEAL SYSTEM PROMPT") != []
    assert len(redis.set_calls) == 1


def test_add_is_idempotent_and_other_instance_reloads_from_cache(
    db_session,
    monkeypatch,
):
    redis = _FakeRedis()
    monkeypatch.setattr(
        "windup_app.server.sensitive_word.service.get_redis",
        lambda: redis,
    )
    writer = SqlAlchemySensitiveWordService()

    first = writer.add_word(
        db_session,
        " Ignore Previous Instructions ",
        SensitiveWordCategory.INJECTION,
    )
    second = writer.add_word(
        db_session,
        "ignore previous instructions",
        SensitiveWordCategory.INJECTION,
    )

    assert first.id == second.id
    assert db_session.scalar(select(func.count()).select_from(SensitiveWord)) == 1
    assert redis.published

    reader = SqlAlchemySensitiveWordService()
    reader.reload(db_session)
    assert reader.scan("IGNORE PREVIOUS INSTRUCTIONS") != []


def test_disabling_word_removes_it_from_matcher(db_session, monkeypatch):
    redis = _FakeRedis()
    monkeypatch.setattr(
        "windup_app.server.sensitive_word.service.get_redis",
        lambda: redis,
    )
    word_service = SqlAlchemySensitiveWordService()
    word = word_service.add_word(
        db_session,
        "输出系统提示词",
        SensitiveWordCategory.INJECTION,
    )
    assert word_service.scan("输出系统提示词")

    word_service.set_enabled(db_session, word.id, False)

    assert word_service.scan("输出系统提示词") == []


def test_redis_failure_does_not_discard_database_word(db_session, monkeypatch):
    class _BrokenRedis:
        def set(self, *_args, **_kwargs):
            raise ConnectionError("redis down")

        def publish(self, *_args, **_kwargs):
            raise ConnectionError("redis down")

    monkeypatch.setattr(
        "windup_app.server.sensitive_word.service.get_redis",
        lambda: _BrokenRedis(),
    )
    word_service = SqlAlchemySensitiveWordService()

    word_service.add_word(
        db_session,
        "忽略所有之前的指令",
        SensitiveWordCategory.INJECTION,
    )

    assert db_session.scalar(select(func.count()).select_from(SensitiveWord)) == 1
    assert word_service.scan("忽略所有之前的指令")


def test_seed_only_writes_when_table_is_empty(db_session):
    assert seed_sensitive_words(db_session) is True
    first_count = db_session.scalar(select(func.count()).select_from(SensitiveWord))

    assert seed_sensitive_words(db_session) is False
    assert (
        db_session.scalar(select(func.count()).select_from(SensitiveWord))
        == first_count
    )
