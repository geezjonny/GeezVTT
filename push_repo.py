"""Run python push_repo.py "Commit message" [new-file ...] to commit tracked changes plus the named new files, then push.

Untracked files are never added by accident: pass their paths to include them."""

import argparse
from datetime import datetime
from pathlib import Path
import subprocess

from update_indexes import update_indexes


def git(root, *args, capture=False):
    result = subprocess.run(
        ["git", *args], cwd=root, check=True, text=True,
        stdout=subprocess.PIPE if capture else None,
    )
    return result.stdout.strip() if capture else None


def publish(root, message, paths=()):
    branch = git(root, "symbolic-ref", "--quiet", "--short", "HEAD", capture=True)
    git(root, "remote", "get-url", "origin", capture=True)
    if git(root, "ls-files", "--unmerged", capture=True):
        raise ValueError("Resolve merge conflicts before pushing.")
    update_indexes(root)
    git(root, "add", "--update")
    if paths:
        git(root, "add", "--", *paths)
    staged = git(root, "diff", "--cached", "--name-status", capture=True)
    if staged:
        with (root / "progress.md").open("a", encoding="utf-8") as progress:
            progress.write(
                f"\n## Repository save - {datetime.now():%Y-%m-%d %H:%M}\n\n"
                f"{message}\n\nCommitted files:\n\n```text\n{staged}\n```\n\n"
                "Verification is left to the user; this script runs no checks. "
                "Outstanding work: verify the saved changes.\n"
            )
        git(root, "add", "progress.md")
        git(root, "commit", "-m", message)
    skipped = git(root, "ls-files", "--others", "--exclude-standard", capture=True)
    if skipped:
        print(f"Not added (pass the path to include it):\n{skipped}")
    git(root, "push", "--set-upstream", "origin", branch)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("message", nargs="?", default="Save GeezVTT changes")
    parser.add_argument("paths", nargs="*", help="new files to include")
    args = parser.parse_args()
    if not args.message.strip():
        parser.error("Commit message must not be empty.")
    try:
        publish(Path(__file__).resolve().parent, args.message, args.paths)
    except subprocess.CalledProcessError as error:
        raise SystemExit(f"Git command failed ({error.returncode}); stopped without retrying or force pushing.")
    except (OSError, ValueError) as error:
        raise SystemExit(str(error))
