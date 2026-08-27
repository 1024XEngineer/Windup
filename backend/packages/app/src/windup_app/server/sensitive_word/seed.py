"""首批敏感词种子。"""

import json
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from windup_app.server.sensitive_word.matcher import normalize_text
from windup_app.server.sensitive_word.model import SensitiveWord


def seed_sensitive_words(session: Session) -> bool:
    """仅在整张表为空时写入种子，返回是否发生写入。"""

    if session.scalar(select(func.count()).select_from(SensitiveWord)):
        return False

    seed_path = Path(__file__).with_name("sensitive_words.json")
    payload = json.loads(seed_path.read_text(encoding="utf-8"))
    for item in payload:
        word = normalize_text(str(item["word"])).strip()
        if not word:
            continue
        session.add(
            SensitiveWord(
                word=word,
                category=int(item["category"]),
                enabled=True,
            )
        )
    session.flush()
    return True
