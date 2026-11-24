"""Run python update_token_index.py to rebuild token/index.json from image files."""

import json
from pathlib import Path
import tempfile


def update_index(folder):
    entries = sorted(
        file.name for file in folder.iterdir()
        if file.is_file() and file.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}
    )
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=folder, delete=False) as output:
            temporary = Path(output.name)
            output.write(json.dumps(entries, indent=4, ensure_ascii=False) + "\n")
        temporary.replace(folder / "index.json")
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return len(entries)


if __name__ == "__main__":
    try:
        count = update_index(Path(__file__).resolve().parent / "token")
        print(f"token/index.json: {count} images")
    except OSError as error:
        raise SystemExit(str(error))
