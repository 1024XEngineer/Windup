"""Deploy a published Release's exact commit using the existing production Compose."""
from __future__ import annotations

import fcntl
import json
from pathlib import Path
import re
import subprocess
import sys


def read(*args: str) -> str:
    return subprocess.check_output(args, text=True).strip()


def execute(*args: str) -> None:
    subprocess.run(args, check=True)


def version(tag: str) -> tuple[int, ...]:
    if not re.fullmatch(r"v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", tag):
        raise ValueError("Invalid release tag")
    return tuple(map(int, tag[1:].split(".")))


def release_target(path: Path = Path("VERSION")) -> dict[str, str]:
    tag = "v" + path.read_text().strip()
    version(tag)
    sha = read("git", "rev-parse", "HEAD")
    try:
        tag_sha = read("git", "rev-parse", "--verify", f"refs/tags/{tag}^{{commit}}")
    except subprocess.CalledProcessError:
        return {}
    # A later main commit can retain VERSION without representing a new release.
    if sha != tag_sha:
        return {}
    release = json.loads(read("gh", "release", "view", tag, "--json", "isDraft,isPrerelease"))
    if release["isDraft"] or release["isPrerelease"]:
        return {}
    return {"tag": tag, "sha": sha}


def health() -> None:
    execute(
        "curl", "--fail", "--silent", "--show-error", "--retry", "12",
        "--retry-all-errors", "--retry-delay", "5", "--max-time", "10",
        "http://127.0.0.1:8000/api/health",
    )


def deploy(tag: str, sha: str, state: Path, public: Path) -> None:
    desired_version = version(tag)
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Invalid release SHA")
    if read("git", "status", "--porcelain", "--untracked-files=no"):
        raise ValueError("Tracked production files are modified; refusing to overwrite")
    execute("git", "fetch", "origin", "main", "--tags")
    if read("git", "rev-parse", f"refs/tags/{tag}^{{commit}}") != sha:
        raise ValueError("Release tag does not match the approved SHA")
    execute("git", "merge-base", "--is-ancestor", sha, "origin/main")
    if state.exists():
        previous = json.loads(state.read_text())
        if version(previous["tag"]) > desired_version:
            print(f"Skip obsolete release {tag}; production is {previous['tag']}")
            return
        if previous == {"tag": tag, "sha": sha} and read("git", "rev-parse", "HEAD") == sha:
            health()
            print(f"{tag} already deployed")
            return

    # Detached HEAD pins the release even when origin/main has moved ahead.
    # Git refuses conflicting untracked files; .env and override are never cleaned.
    execute("git", "checkout", "--detach", sha)
    compose = ("docker", "compose", "-p", "windup")
    execute(*compose, "build", "backend", "worker", "frontend")
    # The image's normal CMD builds directly into nginx's directory. Compile in a
    # container-local directory first so a failed build cannot empty the live site.
    # Keep old hashed assets for browsers that still hold the previous index.
    execute(
        *compose, "run", "--rm", "--no-deps", "frontend", "sh", "-ec",
        "npm run build -- --outDir /tmp/windup-release-dist && "
        "cp -a /tmp/windup-release-dist/. /var/www/react-windup/",
    )
    execute(*compose, "up", "-d", "--no-build", "--wait", "--wait-timeout", "120", "backend", "worker")
    health()
    record = json.dumps({"tag": tag, "sha": sha}) + "\n"
    # These markers describe the last verified release, not a partially failed one.
    for path in (public, state):
        temporary = path.with_suffix(".tmp")
        temporary.write_text(record)
        temporary.replace(path)
    print(f"Deployed {tag} ({sha})")


def main() -> None:
    if sys.argv[1:] == ["target"]:
        for key, value in release_target().items():
            print(f"{key}={value}")
        return
    if len(sys.argv) != 4 or sys.argv[1] != "deploy":
        raise ValueError("Usage: release_deploy.py target | deploy TAG SHA")
    git_dir = Path(read("git", "rev-parse", "--absolute-git-dir"))
    # Serializes direct manual invocations with workflow deployments.
    with (git_dir / "windup-deploy.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        deploy(sys.argv[2], sys.argv[3], git_dir / "windup-deployed.json",
               Path("/var/www/react-windup/release.json"))


if __name__ == "__main__":
    main()
