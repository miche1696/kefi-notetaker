import tempfile
import threading
import time
import unittest
from pathlib import Path
import sys


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from services.whisper_service import WhisperService  # noqa: E402


class _NonThreadSafeModel:
    def __init__(self):
        self._lock = threading.Lock()
        self.active = 0
        self.max_active = 0

    def transcribe(self, _audio_path, fp16=False, verbose=False):
        del fp16, verbose
        with self._lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
            is_concurrent = self.active > 1
        try:
            time.sleep(0.03)
            if is_concurrent:
                raise RuntimeError("concurrent model access")
            return {
                "text": "ok",
                "language": "en",
                "segments": [{"end": 1.0}],
            }
        finally:
            with self._lock:
                self.active -= 1


class WhisperServiceThreadSafetyTestCase(unittest.TestCase):
    def _build_service(self, model):
        service = WhisperService.__new__(WhisperService)
        service.trace_logger = None
        service.model_name = "test-model"
        service.model = model
        service._transcribe_lock = threading.Lock()
        return service

    def test_transcribe_audio_serializes_model_access(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            audio_path = Path(temp_dir) / "sample.opus"
            audio_path.write_bytes(b"fake-audio")

            model = _NonThreadSafeModel()
            service = self._build_service(model)

            errors = []

            def worker():
                try:
                    result = service.transcribe_audio(str(audio_path))
                    self.assertEqual(result["text"], "ok")
                except Exception as exc:  # pragma: no cover - assertion captured below
                    errors.append(str(exc))

            threads = [threading.Thread(target=worker) for _ in range(4)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=2)

            self.assertFalse(errors, f"unexpected transcription errors: {errors}")
            self.assertEqual(
                model.max_active,
                1,
                "WhisperService should serialize shared-model transcriptions",
            )


if __name__ == "__main__":
    unittest.main()
