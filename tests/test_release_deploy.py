"""Release selection and production failure boundaries; no live services are used."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "release_deploy", Path(__file__).resolve().parents[1] / "scripts/release_deploy.py"
)
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)
SHA = "a" * 40
NEW_SHA = "b" * 40


class ReleaseSelectionTests(unittest.TestCase):
    def select(self, tag_sha=SHA, **release):
        responses = [SHA, tag_sha]
        if tag_sha == SHA:
            responses.append(json.dumps({"isDraft": False, "isPrerelease": False, **release}))
        with tempfile.TemporaryDirectory() as directory:
            version = Path(directory) / "VERSION"
            version.write_text("1.2.3\n")
            with patch.object(deploy, "read", side_effect=responses):
                return deploy.release_target(version)

    def test_release_commit_produces_exact_tag_and_sha(self):
        self.assertEqual(self.select(), {"tag": "v1.2.3", "sha": SHA})

    def test_later_commits_with_unchanged_version_do_not_deploy(self):
        self.assertEqual(self.select(tag_sha=NEW_SHA), {})

    def test_draft_and_prerelease_do_not_deploy(self):
        self.assertEqual(self.select(isDraft=True), {})
        self.assertEqual(self.select(isPrerelease=True), {})

    def test_missing_tag_does_not_deploy(self):
        with tempfile.TemporaryDirectory() as directory:
            version = Path(directory) / "VERSION"
            version.write_text("1.2.3")
            with patch.object(deploy, "read", side_effect=[SHA, subprocess.CalledProcessError(1, "git")]):
                self.assertEqual(deploy.release_target(version), {})


class ProductionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name) / "deployed.json"
        self.public = Path(self.tmp.name) / "public.json"
        self.commands = []
        self.dirty = ""
        self.tag_sha = SHA
        self.failure = None

    def read(self, *args):
        if args[:2] == ("git", "status"):
            return self.dirty
        if args[:2] == ("git", "rev-parse"):
            return self.tag_sha
        raise AssertionError(args)

    def execute(self, *args):
        self.commands.append(args)
        if self.failure and self.failure(args):
            raise subprocess.CalledProcessError(1, args)

    def run_deploy(self, tag="v1.2.3", sha=SHA):
        with patch.object(deploy, "read", side_effect=self.read), patch.object(
            deploy, "execute", side_effect=self.execute
        ):
            deploy.deploy(tag, sha, self.state, self.public)

    def test_success_records_release_only_after_health_check(self):
        self.run_deploy()
        self.assertEqual(json.loads(self.state.read_text()), {"tag": "v1.2.3", "sha": SHA})
        self.assertEqual(self.public.read_text(), self.state.read_text())
        self.assertIn(("git", "checkout", "--detach", SHA), self.commands)
        self.assertEqual(self.commands[-1][0], "curl")

    def test_tag_mismatch_prevents_checkout_and_build(self):
        self.tag_sha = NEW_SHA
        with self.assertRaisesRegex(ValueError, "tag"):
            self.run_deploy()
        self.assertFalse(any(c[:2] == ("git", "checkout") or c[0] == "docker" for c in self.commands))

    def test_dirty_checkout_is_not_overwritten(self):
        self.dirty = " M docker-compose.yml"
        with self.assertRaisesRegex(ValueError, "modified"):
            self.run_deploy()
        self.assertEqual(self.commands, [])

    def test_commit_outside_main_cannot_be_deployed(self):
        self.failure = lambda c: c[:2] == ("git", "merge-base")
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_deploy()
        self.assertFalse(any(c[0] == "docker" for c in self.commands))

    def test_image_build_failure_never_restarts_services(self):
        self.failure = lambda c: "build" in c
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_deploy()
        self.assertFalse(any("up" in c or "run" in c for c in self.commands))
        self.assertFalse(self.state.exists())

    def test_frontend_compile_failure_never_restarts_backend(self):
        self.failure = lambda c: "run" in c
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_deploy()
        self.assertFalse(any("up" in c for c in self.commands))
        self.assertFalse(self.state.exists())

    def test_health_failure_preserves_last_successful_version(self):
        previous = json.dumps({"tag": "v1.2.2", "sha": NEW_SHA})
        self.state.write_text(previous)
        self.public.write_text(previous)
        self.failure = lambda c: c[0] == "curl"
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_deploy()
        self.assertEqual(self.state.read_text(), previous)
        self.assertEqual(self.public.read_text(), previous)

    def test_old_release_rerun_cannot_roll_back_newer_production(self):
        self.state.write_text(json.dumps({"tag": "v1.3.0", "sha": NEW_SHA}))
        self.run_deploy()
        self.assertFalse(any(c[0] == "docker" for c in self.commands))

    def test_successful_release_rerun_only_checks_health(self):
        self.state.write_text(json.dumps({"tag": "v1.2.3", "sha": SHA}))
        self.run_deploy()
        self.assertFalse(any(c[0] == "docker" for c in self.commands))
        self.assertEqual(self.commands[-1][0], "curl")

    def test_invalid_inputs_do_not_reach_commands(self):
        for tag, sha in [("v1;echo bad", SHA), ("v1.2.3", "main")]:
            with self.assertRaises(ValueError):
                self.run_deploy(tag, sha)
        self.assertEqual(self.commands, [])


class GitIntegrationTests(unittest.TestCase):
    def test_deploy_pins_tag_and_preserves_untracked_server_configuration(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            remote = temporary / "remote.git"
            checkout = temporary / "production"

            def git(*args, cwd=root):
                return subprocess.check_output(
                    ["git", *map(str, args)], cwd=cwd, text=True, stderr=subprocess.DEVNULL
                ).strip()

            git("clone", "--bare", "--shared", root, remote)
            sha = git("rev-parse", "HEAD", cwd=remote)
            git("update-ref", "refs/heads/main", sha, cwd=remote)
            git("tag", "v99.0.1", sha, cwd=remote)
            git("clone", "--shared", "--branch", "main", remote, checkout)
            # origin/main can advance after a tag is selected; the deployed tree
            # must still be the tag, never whatever a later pull would return.
            (checkout / "release-fixture.txt").write_text("later main commit")
            git("add", "release-fixture.txt", cwd=checkout)
            git("-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                "commit", "-m", "advance fixture main", cwd=checkout)
            git("push", "origin", "main", cwd=checkout)
            (checkout / ".env").write_text("KEEP=local\n")
            (checkout / "docker-compose.override.yml").write_text("services: {}\n")

            def execute(*args):
                if args[0] == "git":
                    subprocess.run(args, cwd=checkout, check=True, capture_output=True)

            with patch.object(deploy, "read", side_effect=lambda *args: git(*args[1:], cwd=checkout)), patch.object(
                deploy, "execute", side_effect=execute
            ):
                deploy.deploy("v99.0.1", sha, temporary / "state.json", temporary / "public.json")
            self.assertEqual(git("rev-parse", "HEAD", cwd=checkout), sha)
            self.assertFalse((checkout / "release-fixture.txt").exists())
            self.assertEqual((checkout / ".env").read_text(), "KEEP=local\n")
            self.assertEqual((checkout / "docker-compose.override.yml").read_text(), "services: {}\n")


if __name__ == "__main__":
    unittest.main()
