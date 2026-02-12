import unittest
from pathlib import Path
import sys


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from services.text_processing_service import TextProcessingService  # noqa: E402


class TextProcessingServiceTestCase(unittest.TestCase):
    def setUp(self):
        self.service = TextProcessingService(llm_client=None)

    def test_process_unknown_operation_raises(self):
        with self.assertRaises(ValueError):
            self.service.process("missing-op", "text")

    def test_clean_transcription_removes_fillers_and_normalizes_whitespace(self):
        raw = "um i mean this  is a test .it should clean"

        result = self.service.clean_transcription(raw, {})

        self.assertNotIn("i mean", result.lower())
        self.assertNotIn("  ", result)
        self.assertNotIn(" .", result)
        self.assertTrue(result.strip())

    def test_reorder_list_desc_preserves_markers(self):
        source = "- banana\n- apple\n- carrot"

        result = self.service.reorder_list(source, {"order": "desc"})

        self.assertEqual(result, "- carrot\n- banana\n- apple")

    def test_modify_requires_llm(self):
        with self.assertRaises(NotImplementedError):
            self.service.process("modify", "text", {"instruction": "rewrite"})


if __name__ == "__main__":
    unittest.main()
