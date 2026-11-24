"""Run python update_indexes.py to update token, battlemap, scene, and soundboard indexes."""

import json
from pathlib import Path
import tempfile


def update_index(folder, extension=None):
    folder.mkdir(exist_ok=True)
    if extension == "audio":
        entries = [{"file": file.name, "name": file.stem.replace("_", " ")} for file in sorted(folder.iterdir())
                   if file.is_file() and file.suffix.lower() in {".mp3", ".ogg", ".wav", ".m4a", ".aac", ".flac"}]
        write_index(folder / "index.json", entries)
        return len(entries)
    index = folder / "index.json"
    if extension is None:
        entries = sorted(
            file.name for file in folder.iterdir()
            if file.is_file() and file.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}
        )
        write_index(index, entries)
        return len(entries)
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
        write_index(index, entries)
    return added


def write_index(index, entries):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=index.parent, delete=False) as output:
            temporary = Path(output.name)
            output.write(json.dumps(entries, indent=4, ensure_ascii=False) + "\n")
        temporary.replace(index)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def update_indexes(root):
    for directory, extension in (("token", None), ("battlemap", ".dd2vtt"), ("scene", ".geezvtt"), ("ambience", "audio"), ("sfx", "audio"), ("music", "audio")):
        count = update_index(root / directory, extension)
        status = f"{count} images" if extension is None else f"added {count}"
        print(f"{directory}/index.json: {status}", flush=True)


if __name__ == "__main__":
    root = Path(__file__).resolve().parent
    try:
        update_indexes(root)
    except (OSError, ValueError) as error:
        raise SystemExit(str(error))
