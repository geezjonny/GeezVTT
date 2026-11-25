import sys
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from push_repo import publish


class PushRepoTest(unittest.TestCase):
    def test_commit_failure_stops_push_and_records_progress_first(self):
        calls = []
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def fake_git(repo, *args, capture=False):
                calls.append(args)
                if args[0] == "symbolic-ref":
                    return "main"
                if args[:2] == ("diff", "--cached"):
                    return "M	index.html"
                if args[0] == "commit":
                    self.assertIn("M	index.html", (root / "progress.md").read_text(encoding="utf-8"))
                    raise subprocess.CalledProcessError(1, ["git", *args])
                return ""

            with patch("push_repo.git", side_effect=fake_git), patch("push_repo.update_indexes") as update:
                with self.assertRaises(subprocess.CalledProcessError):
                    publish(root, "Save changes")
                update.assert_called_once_with(root)
        self.assertIn(("add", "--update"), calls)
        self.assertFalse(any("--all" in args for args in calls), "untracked files must not be added implicitly")
        self.assertFalse(any(args[0] == "push" for args in calls))

    def test_named_new_files_are_added_and_nothing_else(self):
        calls = []
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def fake_git(repo, *args, capture=False):
                calls.append(args)
                if args[0] == "symbolic-ref":
                    return "main"
                if args[:2] == ("diff", "--cached"):
                    return "A	battlemap/new.dd2vtt"
                return ""

            with patch("push_repo.git", side_effect=fake_git), patch("push_repo.update_indexes"):
                publish(root, "Add map", ["battlemap/new.dd2vtt"])
        self.assertIn(("add", "--", "battlemap/new.dd2vtt"), calls)
        self.assertTrue(any(args[0] == "push" for args in calls))
