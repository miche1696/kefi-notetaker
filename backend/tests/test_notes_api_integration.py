import tempfile
import unittest
from pathlib import Path
import sys

from flask import Flask


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from api.notes import notes_bp  # noqa: E402
from services.file_service import FileService  # noqa: E402
from services.note_index_service import NoteIndexService  # noqa: E402
from services.note_service import NoteService  # noqa: E402


class NotesApiIntegrationTestCase(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        notes_dir = Path(self.temp_dir.name)
        self.index_path = notes_dir / "notes_index.json"

        app = Flask(__name__)
        app.config["TESTING"] = True
        file_service = FileService(notes_dir)
        note_index = NoteIndexService(self.index_path)
        app.config["NOTE_SERVICE"] = NoteService(file_service, note_index)
        app.register_blueprint(notes_bp, url_prefix="/api/notes")

        self.client = app.test_client()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_note_lifecycle(self):
        create_resp = self.client.post(
            "/api/notes",
            json={
                "name": "integration_note",
                "content": "first version",
                "file_type": "md",
            },
        )
        self.assertEqual(create_resp.status_code, 201)
        created_note = create_resp.get_json()
        self.assertEqual(created_note["path"], "integration_note")
        self.assertEqual(created_note["content"], "first version")

        get_resp = self.client.get("/api/notes/integration_note")
        self.assertEqual(get_resp.status_code, 200)
        self.assertEqual(get_resp.get_json()["content"], "first version")

        update_resp = self.client.put(
            "/api/notes/integration_note",
            json={
                "content": "updated version",
                "expected_revision": created_note["revision"],
            },
        )
        self.assertEqual(update_resp.status_code, 200)
        self.assertEqual(update_resp.get_json()["content"], "updated version")

        delete_resp = self.client.delete("/api/notes/integration_note")
        self.assertEqual(delete_resp.status_code, 200)

        missing_resp = self.client.get("/api/notes/integration_note")
        self.assertEqual(missing_resp.status_code, 404)

    def test_replace_marker_supports_markdown_escaped_variant(self):
        marker_token = "[[tx:marker-1:Transcription ongoing...]]"
        escaped_marker = r"\[\[tx:marker-1:Transcription ongoing...]]"

        create_resp = self.client.post(
            "/api/notes",
            json={
                "name": "escaped_marker_note",
                "content": f"before {escaped_marker} after",
                "file_type": "md",
            },
        )
        self.assertEqual(create_resp.status_code, 201)
        created_note = create_resp.get_json()

        replace_resp = self.client.patch(
            f"/api/notes/id/{created_note['id']}/replace-marker",
            json={
                "marker_token": marker_token,
                "replacement_text": "done",
            },
        )
        self.assertEqual(replace_resp.status_code, 200)
        replace_payload = replace_resp.get_json()
        self.assertEqual(replace_payload["status"], "applied")

        get_resp = self.client.get("/api/notes/escaped_marker_note")
        self.assertEqual(get_resp.status_code, 200)
        content = get_resp.get_json()["content"]
        self.assertIn("done", content)
        self.assertNotIn(escaped_marker, content)


if __name__ == "__main__":
    unittest.main()
