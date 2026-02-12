import tempfile
import unittest
from pathlib import Path
import sys


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from services.file_service import FileService  # noqa: E402


class FileServiceTestCase(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.notes_dir = Path(self.temp_dir.name)
        self.service = FileService(self.notes_dir)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_write_and_read_note_without_extension(self):
        self.service.write_note("ideas/todo", "hello world")

        expected_file = self.notes_dir / "ideas" / "todo.txt"
        self.assertTrue(expected_file.exists())
        self.assertEqual(self.service.read_note("ideas/todo"), "hello world")
        self.assertTrue(self.service.note_exists("ideas/todo"))

    def test_validate_path_rejects_traversal(self):
        self.assertFalse(self.service.validate_path("../secret.txt"))
        self.assertFalse(self.service.validate_path("/etc/passwd"))

        with self.assertRaises(ValueError):
            self.service._get_full_path("../secret.txt")

    def test_move_note_returns_path_without_extension(self):
        self.service.write_note("draft", "move me")
        self.service.create_folder("archive")

        moved_path = self.service.move_note("draft", "archive")

        self.assertEqual(moved_path, "archive/draft")
        self.assertTrue((self.notes_dir / "archive" / "draft.txt").exists())


if __name__ == "__main__":
    unittest.main()
