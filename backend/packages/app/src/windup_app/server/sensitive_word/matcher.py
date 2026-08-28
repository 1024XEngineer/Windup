"""纯内存 Aho-Corasick 多模式匹配。"""

from __future__ import annotations

import unicodedata
from collections import deque
from dataclasses import dataclass, field
from typing import Iterable

from windup_app.server.sensitive_word.model import (
    SensitiveHit,
    SensitiveWordCategory,
)


def normalize_text(text: str) -> str:
    """规范化检测副本，不改写调用方原文。"""

    normalized = unicodedata.normalize("NFKC", text).casefold()
    return "".join(
        character for character in normalized if unicodedata.category(character) != "Cf"
    )


@dataclass
class _Node:
    children: dict[str, int] = field(default_factory=dict)
    fail: int = 0
    outputs: list[tuple[str, SensitiveWordCategory]] = field(default_factory=list)


class AhoCorasickMatcher:
    """构建后只读的 AC 自动机。"""

    def __init__(
        self,
        words: Iterable[tuple[str, SensitiveWordCategory | int]],
    ) -> None:
        self._nodes = [_Node()]
        for raw_word, raw_category in words:
            word = normalize_text(raw_word.strip())
            if not word:
                continue
            category = SensitiveWordCategory(raw_category)
            state = 0
            for character in word:
                child = self._nodes[state].children.get(character)
                if child is None:
                    child = self._new_node()
                    self._nodes[state].children[character] = child
                state = child
            output = (word, category)
            if output not in self._nodes[state].outputs:
                self._nodes[state].outputs.append(output)
        self._build_failures()

    def _new_node(self) -> int:
        self._nodes.append(_Node())
        return len(self._nodes) - 1

    def _build_failures(self) -> None:
        queue: deque[int] = deque(self._nodes[0].children.values())
        while queue:
            state = queue.popleft()
            for character, child in self._nodes[state].children.items():
                queue.append(child)
                fallback = self._nodes[state].fail
                while fallback and character not in self._nodes[fallback].children:
                    fallback = self._nodes[fallback].fail
                self._nodes[child].fail = self._nodes[fallback].children.get(
                    character,
                    0,
                )
                inherited = self._nodes[self._nodes[child].fail].outputs
                self._nodes[child].outputs.extend(
                    output
                    for output in inherited
                    if output not in self._nodes[child].outputs
                )

    def match(self, text: str) -> list[SensitiveHit]:
        normalized = normalize_text(text)
        if not normalized:
            return []

        hits: list[SensitiveHit] = []
        state = 0
        for index, character in enumerate(normalized):
            while state and character not in self._nodes[state].children:
                state = self._nodes[state].fail
            state = self._nodes[state].children.get(character, 0)
            end = index + 1
            hits.extend(
                SensitiveHit(
                    word=word,
                    category=category,
                    start=end - len(word),
                    end=end,
                )
                for word, category in self._nodes[state].outputs
            )
        return hits
