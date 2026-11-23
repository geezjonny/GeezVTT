"""Run python update_indexes.py to append new battlemap and scene files."""

import json
from pathlib import Path
import tempfile


def update_index(folder, extension):
    index = folder / "index.json"
    entries = json.loads(index.read_text(encoding="utf-8-sig")) if index.exists() else []
    if not isinstance(entries, list) or any(
        not isinstance(entry, dict) or not isinstance(entry.get("file"), str)
        for entry in entries
    ):
        raise ValueError(f"{index}: expected an array of entries with a file string")
    known = {entry["file"] for entry in entries}
    added = 0
    for file in sorted(folder.iterdir(), key=lambda path: path.name):
        if file.is_file() and file.suffix.lower() == extension and file.name not in known:
            entries.append({"file": file.name, "name": file.stem.replace("_", " ").replace("-", " ")})
            added += 1
    if added or not index.exists():
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=folder, delete=False) as output:
                temporary = Path(output.name)
                output.write(json.dumps(entries, indent=4, ensure_ascii=False) + "\n")
            temporary.replace(index)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    return added


if __name__ == "__main__":
    root = Path(__file__).resolve().parent
    try:
        for directory, extension in (("battlemap", ".dd2vtt"), ("scene", ".geezvtt")):
            count = update_index(root / directory, extension)
            print(f"{directory}/index.json: added {count}")
    except (OSError, ValueError) as error:
        raise SystemExit(str(error))
