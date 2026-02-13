import tempfile
import time
import unittest
from io import BytesIO
from pathlib import Path
import sys

from flask import Flask


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import config  # noqa: E402
from api.transcription import transcription_bp  # noqa: E402
from services.transcription_job_service import TranscriptionJobService  # noqa: E402


class _FakeSettingsService:
    def __init__(self, tx_settings=None):
        self._tx_settings = tx_settings or {
            "max_concurrent_jobs": 1,
            "max_queued_jobs": 20,
            "history_max_entries": 200,
            "history_ttl_days": 7,
            "retry_max": 2,
            "retry_base_ms": 5,
            "auto_requeue_interrupted": False,
        }

    def get(self):
        return {"transcription": dict(self._tx_settings)}


class _FakeNoteService:
    def __init__(self):
        self._paths = {"note-1": "inbox/note"}
        self._revisions = {"note-1": 1}
        self.replace_calls = []

    def resolve_note_path(self, note_id):
        return self._paths.get(note_id)

    def replace_marker(self, note_id, marker_token, replacement_text):
        self.replace_calls.append(
            {
                "note_id": note_id,
                "marker_token": marker_token,
                "replacement_text": replacement_text,
            }
        )
        path = self._paths.get(note_id)
        if not path:
            return {"status": "note_deleted", "note_id": note_id}
        self._revisions[note_id] = int(self._revisions.get(note_id, 1)) + 1
        return {
            "status": "applied",
            "note_id": note_id,
            "note_path": path,
            "revision": self._revisions[note_id],
        }


class _RetryWhisperService:
    def __init__(self):
        self.calls = 0
        self.cleaned_paths = []

    def transcribe_audio(self, audio_path):
        self.calls += 1
        if self.calls == 1:
            raise Exception("network timeout")
        if not Path(audio_path).exists():
            raise Exception("audio file missing before retry")
        return {"text": "hello world", "language": "en", "duration": 1.23}

    def cleanup_temp_file(self, path):
        self.cleaned_paths.append(path)
        Path(path).unlink(missing_ok=True)


class _FailingWhisperService:
    def __init__(self):
        self.cleaned_paths = []

    def transcribe_audio(self, audio_path):
        raise Exception("decoder runtime exploded")

    def cleanup_temp_file(self, path):
        self.cleaned_paths.append(path)
        Path(path).unlink(missing_ok=True)


class _UploadWhisperService:
    def __init__(self):
        self.cleaned_paths = []

    def is_supported_format(self, filename):
        return filename.endswith(".wav")

    def supported_formats(self):
        return [".wav"]

    def validate_audio_file(self, path, max_size_bytes=None):
        return True, ""

    def cleanup_temp_file(self, path):
        self.cleaned_paths.append(path)
        Path(path).unlink(missing_ok=True)


class _FailingJobService:
    def create_job(self, **kwargs):
        raise ValueError("Transcription queue is full")


class TranscriptionJobServiceTestCase(unittest.TestCase):
    def test_retry_keeps_audio_until_terminal_state(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            audio_path = temp_path / "sample.webm"
            audio_path.write_bytes(b"fake-audio")

            whisper = _RetryWhisperService()
            note_service = _FakeNoteService()
            settings_service = _FakeSettingsService(
                {
                    "max_concurrent_jobs": 1,
                    "max_queued_jobs": 20,
                    "history_max_entries": 200,
                    "history_ttl_days": 7,
                    "retry_max": 2,
                    "retry_base_ms": 5,
                    "auto_requeue_interrupted": False,
                }
            )

            service = TranscriptionJobService(
                whisper_service=whisper,
                note_service=note_service,
                settings_service=settings_service,
                snapshot_path=temp_path / "jobs.snapshot.json",
                events_path=temp_path / "jobs.events.jsonl",
                worker_slots=1,
            )
            try:
                job = service.create_job(
                    audio_path=str(audio_path),
                    source_filename="sample.webm",
                    note_id="note-1",
                    marker_token="[[tx:test:Transcription ongoing...]]",
                    launch_source="test",
                )
                final_job = self._wait_for_terminal_job(
                    service,
                    job["id"],
                    timeout_seconds=5,
                )

                self.assertEqual(final_job["status"], "completed")
                self.assertGreaterEqual(whisper.calls, 2)
                self.assertEqual(len(whisper.cleaned_paths), 1)
                self.assertFalse(audio_path.exists())
            finally:
                service.shutdown()

    def _wait_for_terminal_job(self, service, job_id, timeout_seconds):
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            job = service.get_job(job_id)
            if job and job.get("status") in {"completed", "failed", "orphaned", "cancelled"}:
                return job
            time.sleep(0.05)
        self.fail("Timed out waiting for transcription job to complete")

    def test_terminal_transcription_failure_replaces_marker_with_failure_message(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            audio_path = temp_path / "sample.webm"
            audio_path.write_bytes(b"fake-audio")

            whisper = _FailingWhisperService()
            note_service = _FakeNoteService()
            settings_service = _FakeSettingsService(
                {
                    "max_concurrent_jobs": 1,
                    "max_queued_jobs": 20,
                    "history_max_entries": 200,
                    "history_ttl_days": 7,
                    "retry_max": 0,
                    "retry_base_ms": 5,
                    "auto_requeue_interrupted": False,
                }
            )

            service = TranscriptionJobService(
                whisper_service=whisper,
                note_service=note_service,
                settings_service=settings_service,
                snapshot_path=temp_path / "jobs.snapshot.json",
                events_path=temp_path / "jobs.events.jsonl",
                worker_slots=1,
            )
            try:
                marker_token = "[[tx:test:Transcription ongoing...]]"
                job = service.create_job(
                    audio_path=str(audio_path),
                    source_filename="sample.webm",
                    note_id="note-1",
                    marker_token=marker_token,
                    launch_source="test",
                )
                final_job = self._wait_for_terminal_job(service, job["id"], timeout_seconds=5)

                self.assertEqual(final_job["status"], "failed")
                self.assertEqual(final_job["error_code"], "transcription_error")
                self.assertEqual(final_job["last_result"]["status"], "applied")
                self.assertEqual(len(note_service.replace_calls), 1)
                replace_call = note_service.replace_calls[0]
                self.assertEqual(replace_call["marker_token"], marker_token)
                self.assertIn("[Transcription failed:", replace_call["replacement_text"])
                self.assertEqual(len(whisper.cleaned_paths), 1)
                self.assertFalse(audio_path.exists())
            finally:
                service.shutdown()


class TranscriptionApiCleanupTestCase(unittest.TestCase):
    def test_failed_job_creation_cleans_uploaded_temp_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            uploads_dir = Path(temp_dir) / "uploads"
            uploads_dir.mkdir(parents=True, exist_ok=True)
            original_uploads_dir = config.UPLOADS_DIR
            config.UPLOADS_DIR = uploads_dir

            try:
                whisper = _UploadWhisperService()
                app = Flask(__name__)
                app.config["TESTING"] = True
                app.config["WHISPER_SERVICE"] = whisper
                app.config["TRANSCRIPTION_JOB_SERVICE"] = _FailingJobService()
                app.register_blueprint(transcription_bp, url_prefix="/api/transcription")

                client = app.test_client()
                response = client.post(
                    "/api/transcription/jobs",
                    data={
                        "note_id": "note-1",
                        "marker_token": "[[tx:test:Transcription ongoing...]]",
                        "audio": (BytesIO(b"fake"), "audio.wav"),
                    },
                    content_type="multipart/form-data",
                )

                self.assertEqual(response.status_code, 400)
                self.assertEqual(len(whisper.cleaned_paths), 1)
                self.assertFalse(Path(whisper.cleaned_paths[0]).exists())
            finally:
                config.UPLOADS_DIR = original_uploads_dir


if __name__ == "__main__":
    unittest.main()
