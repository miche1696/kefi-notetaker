import json
import tempfile
import time
import unittest
from pathlib import Path
import sys


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from utils.trace import TraceLogger  # noqa: E402


def _write_jsonl(path: Path, entries) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for entry in entries:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _read_jsonl(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


class TraceRetentionTestCase(unittest.TestCase):
    def test_trace_logger_keeps_only_last_week(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            trace_path = Path(temp_dir) / "trace.jsonl"
            now_ts = time.time()
            _write_jsonl(
                trace_path,
                [
                    {"ts": now_ts - (8 * 24 * 60 * 60), "iso": "2026-03-01T10:00:00+00:00", "event": "old"},
                    {"ts": now_ts - (6 * 24 * 60 * 60), "iso": "2026-03-07T10:00:00+00:00", "event": "recent"},
                ],
            )

            logger = TraceLogger(trace_path, source="backend")
            logger.write("fresh", data={"ok": True})

            entries = _read_jsonl(trace_path)
            self.assertEqual([entry["event"] for entry in entries], ["recent", "fresh"])

