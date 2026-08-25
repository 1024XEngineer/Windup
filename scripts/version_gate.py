"""产品版本闸口:根目录 VERSION 决定发不发版、发哪一版。

发版时机由「改 VERSION 的那个 PR」决定,而不是由流水线按提交类型自动进位。判定逻辑
放在这里而不是 workflow 的 shell 里,是为了能被测试覆盖 —— 发版逻辑写错的代价是
打出一个指向错误提交的 tag,而部署只认 Release。

两个入口:
  check   PR 阶段跑,版本非法或比已发布的最新版更低时直接红,不留到发版那一刻才炸;
  decide  发版阶段跑,直接吐 ``key=value`` 供 ``$GITHUB_OUTPUT`` 消费。

decide 吐的是成品行而不是 JSON,是为了不在 workflow 的 YAML 块里再套一层 heredoc —
那层缩进由 YAML、shell、Python 三方共同决定,改一次缩进就可能静默产出空的 output。
"""

from __future__ import annotations

import argparse
import pathlib
import re
import subprocess
import sys

SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


class VersionError(ValueError):
    """VERSION 的内容不合法,或比已发布的版本更低。"""


def parse(text: str) -> tuple[int, int, int]:
    """``1.2.3`` → ``(1, 2, 3)``。前导零与 ``v`` 前缀一律拒绝。

    拒绝而不是宽容地接受:``v1.2.3`` 与 ``1.2.3`` 都能被人读懂,但 tag 名会因此出现
    ``vv1.2.3``,而 tag 名是部署的寻址方式。
    """
    m = SEMVER.match(text.strip())
    if not m:
        raise VersionError(f"VERSION 必须是 X.Y.Z 形式的语义化版本,读到 {text.strip()!r}")
    return tuple(int(g) for g in m.groups())  # type: ignore[return-value]


def latest_release(tags: list[str]) -> tuple[int, int, int] | None:
    """已发布的最新版本。认不出的 tag 直接忽略,不猜。"""
    seen = []
    for t in tags:
        if t.startswith("v"):
            try:
                seen.append(parse(t[1:]))
            except VersionError:
                continue
    return max(seen) if seen else None


def check(version_text: str, tags: list[str], previous: str | None = None) -> dict:
    """PR 阶段的校验。

    ``previous`` 是本 PR 基点上的 VERSION。它与当前一致时只校验格式,不比对 tag ——
    单调性约束的是「改 VERSION 这个动作」,不是「VERSION 任何时刻都不低于最新 tag」。
    按后者判会让所有开着的 PR 在 main 发新版的那一刻集体变红,而它们一个字都没改。
    """
    parse(version_text)
    if previous is not None and previous.strip() and previous.strip() == version_text.strip():
        return {"changed": False, "reason": "VERSION 未变更,只校验格式"}
    d = decide(version_text, tags)
    return {"changed": True, "reason": d["reason"]}


def decide(version_text: str, tags: list[str]) -> dict:
    """回答发不发版。相等即「本次没有发版意图」,不是错误。"""
    cur = parse(version_text)
    last = latest_release(tags)
    tag = "v" + ".".join(str(x) for x in cur)
    if last is None:
        return {"release": True, "tag": tag, "prev": "", "reason": "仓库尚无版本 tag"}
    prev = "v" + ".".join(str(x) for x in last)
    if cur == last:
        return {"release": False, "tag": tag, "prev": prev, "reason": "VERSION 未变更"}
    if cur < last:
        raise VersionError(f"VERSION {version_text.strip()} 低于已发布的 {prev},不允许回退")
    return {"release": True, "tag": tag, "prev": prev, "reason": "VERSION 已进位"}


def _tags() -> list[str]:
    out = subprocess.run(
        ["git", "tag", "--list", "v*"], capture_output=True, text=True, check=True
    )
    return [line.strip() for line in out.stdout.splitlines() if line.strip()]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("mode", choices=["check", "decide"])
    ap.add_argument("path", nargs="?", default="VERSION")
    ap.add_argument("--previous", default=None,
                    help="本 PR 基点上的 VERSION 内容;与当前一致时只校验格式")
    args = ap.parse_args(argv)
    text = pathlib.Path(args.path).read_text(encoding="utf-8")
    try:
        if args.mode == "check":
            r = check(text, _tags(), args.previous)
            print(f"VERSION {text.strip()} 合法;{r['reason']}")
            return 0
        result = decide(text, _tags())
    except VersionError as exc:
        print(f"::error::{exc}", file=sys.stderr)
        return 1
    print(f"go={str(result['release']).lower()}")
    print(f"next={result['tag']}")
    print(f"prev={result['prev']}")
    print(f"range={result['prev'] + '..HEAD' if result['prev'] else ''}")
    print(f"reason={result['reason']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
