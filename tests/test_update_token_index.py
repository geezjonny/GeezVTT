import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("update_token_index", Path(__file__).resolve().parents[1] / "update_token_index.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class UpdateTokenIndexTest(unittest.TestCase):
    def test_rebuilds_sorted_image_filenames(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / "index.json").write_text('["removed.png"]', encoding="utf-8")
            for name in ("zombie.png", "Liora.PNG", "portrait.webp", "ignored.zip"):
                (folder / name).touch()
            (folder / "directory.png").mkdir()
            self.assertEqual(module.update_index(folder), 3)
            self.assertEqual(json.loads((folder / "index.json").read_text(encoding="utf-8")),
                             ["Liora.PNG", "portrait.webp", "zombie.png"])
