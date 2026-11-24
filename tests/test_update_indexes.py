import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("update_indexes", Path(__file__).resolve().parents[1] / "update_indexes.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class UpdateIndexesTest(unittest.TestCase):
    def test_scans_all_three_directories(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, filename in (("token", "portrait.PNG"), ("battlemap", "new_map.dd2vtt"), ("scene", "new_scene.geezvtt")):
                folder = root / name
                folder.mkdir()
                (folder / filename).touch()
            module.update_indexes(root)
            self.assertEqual(json.loads((root / "token/index.json").read_text(encoding="utf-8")), ["portrait.PNG"])
            for name, filename in (("battlemap", "new_map.dd2vtt"), ("scene", "new_scene.geezvtt")):
                self.assertEqual(json.loads((root / name / "index.json").read_text(encoding="utf-8")), [
                    {"file": filename, "name": Path(filename).stem.replace("_", " ")}
                ])

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

    def test_appends_matching_files_and_preserves_existing_entries(self):
        for extension in (".dd2vtt", ".geezvtt"):
            with self.subTest(extension=extension), tempfile.TemporaryDirectory() as directory:
                folder = Path(directory)
                index = folder / "index.json"
                existing = {"file": "old" + extension, "name": "Custom label", "bytes": 123}
                index.write_text(json.dumps([existing]), encoding="utf-8")
                (folder / ("new_file" + extension)).touch()
                (folder / "ignored.txt").touch()
                self.assertEqual(module.update_index(folder, extension), 1)
                self.assertEqual(json.loads(index.read_text(encoding="utf-8")), [
                    existing, {"file": "new_file" + extension, "name": "new file"}
                ])
                saved = index.read_bytes()
                self.assertEqual(module.update_index(folder, extension), 0)
                self.assertEqual(index.read_bytes(), saved)
                index.write_text("broken JSON", encoding="utf-8")
                with self.assertRaises(ValueError):
                    module.update_index(folder, extension)
                self.assertEqual(index.read_text(encoding="utf-8"), "broken JSON")
