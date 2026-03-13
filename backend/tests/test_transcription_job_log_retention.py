import json
import tempfile
import unittest
from pathlib import Path
import sys
import time


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from services.transcription_job_service import TranscriptionJobService  # noqa: E402


class _FakeSettingsService:
    def get(self):
        return {
            "transcription": {
                "max_concurrent_jobs": 1,
                "max_queued_jobs": 20,
                "history_max_entries": 200,
                "history_ttl_days": 7,
                "retry_max": 0,
                "retry_base_ms": 5,
                "auto_requeue_interrupted": False,
            }
        }


class _FakeWhisperService:
    def cleanup_temp_file(self, path):
        Path(path).unlink(missing_ok=True)


class _FakeNoteService:
    def resolve_note_path(self, note_id):
        return "inbox/note" if note_id == "note-1" else None

    def replace_marker(self, note_id, marker_token, replacement_text):
        return {
            "status": "applied",
            "note_id": note_id,
            "note_path": "inbox/note",
            "revision": 2,
        }


def _write_jsonl(path: Path, entries) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for entry in entries:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _read_jsonl(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


class TranscriptionJobLogRetentionTestCase(unittest.TestCase):
    def test_events_log_keeps_only_last_week(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            snapshot_path = temp_path / "jobs.snapshot.json"
            events_path = temp_path / "jobs.events.jsonl"
            now_ts = time.time()
            _write_jsonl(
                events_path,
                [
                    {"ts": now_ts - (9 * 24 * 60 * 60), "iso": "2026-03-01T10:00:00+00:00", "event": "old"},
                    {"ts": now_ts - (5 * 24 * 60 * 60), "iso": "2026-03-09T10:00:00+00:00", "event": "recent"},
                ],
            )

            service = TranscriptionJobService(
                whisper_service=_FakeWhisperService(),
                note_service=_FakeNoteService(),
                settings_service=_FakeSettingsService(),
                snapshot_path=snapshot_path,
                events_path=events_path,
                worker_slots=1,
            )
            try:
                entries = _read_jsonl(events_path)
                self.assertEqual([entry["event"] for entry in entries], ["recent", "tx.jobs.recovered"])
            finally:
                service.shutdown()
