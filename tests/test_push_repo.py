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
                if args[0] == "status":
                    return " M index.html"
                if args[0] == "commit":
                    self.assertIn(" M index.html", (root / "progress.md").read_text(encoding="utf-8"))
                    raise subprocess.CalledProcessError(1, ["git", *args])
                return ""

            with patch("push_repo.git", side_effect=fake_git), patch("push_repo.update_index", return_value=0):
                with self.assertRaises(subprocess.CalledProcessError):
                    publish(root, "Save changes")
        self.assertIn(("add", "--all"), calls)
        self.assertFalse(any(args[0] == "push" for args in calls))
