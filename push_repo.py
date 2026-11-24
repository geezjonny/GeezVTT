"""Run python push_repo.py "Commit message" to save and push all repo changes."""

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


def publish(root, message):
    branch = git(root, "symbolic-ref", "--quiet", "--short", "HEAD", capture=True)
    git(root, "remote", "get-url", "origin", capture=True)
    if git(root, "ls-files", "--unmerged", capture=True):
        raise ValueError("Resolve merge conflicts before pushing.")
    update_indexes(root)
    changes = git(root, "status", "--short", capture=True)
    if changes:
        with (root / "progress.md").open("a", encoding="utf-8") as progress:
            progress.write(
                f"\n## Repository save - {datetime.now():%Y-%m-%d %H:%M}\n\n"
                f"{message}\n\nChanged files before save:\n\n```text\n{changes}\n```\n\n"
                "Verification is left to the user; this script runs no checks. "
                "Outstanding work: verify the saved changes.\n"
            )
        git(root, "add", "--all")
        git(root, "commit", "-m", message)
    git(root, "push", "--set-upstream", "origin", branch)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("message", nargs="?", default="Save GeezVTT changes")
    args = parser.parse_args()
    if not args.message.strip():
        parser.error("Commit message must not be empty.")
    try:
        publish(Path(__file__).resolve().parent, args.message)
    except subprocess.CalledProcessError as error:
        raise SystemExit(f"Git command failed ({error.returncode}); stopped without retrying or force pushing.")
    except (OSError, ValueError) as error:
        raise SystemExit(str(error))
