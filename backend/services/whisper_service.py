import whisper
import threading
import time
from pathlib import Path
from typing import List, Optional
import config


class WhisperService:
    """Service for audio transcription using OpenAI Whisper."""

    def __init__(self, model_name: str = "base", trace_logger: Optional[object] = None):
        """
        Initialize Whisper service and load model.

        Args:
            model_name: Whisper model size (tiny, base, small, medium, large)
                       base is recommended for good balance of speed and accuracy
        """
        self.trace_logger = trace_logger
        resolved_model = self._resolve_model_name(model_name)

        print(f"Loading Whisper model: {resolved_model}...")
        self.model = whisper.load_model(resolved_model)
        self.model_name = resolved_model
        # Whisper model inference is not thread-safe with a shared model instance.
        # Serializing access prevents tensor-shape races under concurrent jobs.
        self._transcribe_lock = threading.Lock()
        print(f"Whisper model '{resolved_model}' loaded successfully")

        if self.trace_logger:
            self.trace_logger.write(
                "whisper.model.load",
                data={
                    "requested": model_name,
                    "resolved": resolved_model,
                },
            )

    def _resolve_model_name(self, model_name: str) -> str:
        available = whisper.available_models()
        if model_name in available:
            return model_name

        fallback = "base"
        print(
            f"Whisper model '{model_name}' not found. "
            f"Falling back to '{fallback}'. "
            f"Available: {available}"
        )
        if self.trace_logger:
            self.trace_logger.write(
                "whisper.model.fallback",
                data={
                    "requested": model_name,
                    "fallback": fallback,
                    "available": available,
                },
            )
        return fallback

    def transcribe_audio(self, audio_path: str) -> dict:
        """
        Transcribe audio file to text.

        Args:
            audio_path: Path to audio file

        Returns:
            Dictionary containing:
                - text: Transcribed text
                - language: Detected language
                - duration: Audio duration in seconds

        Raises:
            FileNotFoundError: If audio file doesn't exist
            Exception: If transcription fails
        """
        audio_file = Path(audio_path)

        if not audio_file.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        try:
            print(f"Transcribing audio: {audio_file.name}")
            if self.trace_logger:
                self.trace_logger.write(
                    "whisper.transcribe.start",
                    data={
                        "file": audio_file.name,
                        "size_bytes": audio_file.stat().st_size,
                        "model": self.model_name,
                    },
                )

            wait_started = time.perf_counter()
            with self._transcribe_lock:
                waited_ms = int((time.perf_counter() - wait_started) * 1000)
                if waited_ms > 0 and self.trace_logger:
                    self.trace_logger.write(
                        "whisper.transcribe.lock_wait",
                        data={
                            "file": audio_file.name,
                            "waited_ms": waited_ms,
                        },
                    )

                # Transcribe audio
                result = self.model.transcribe(
                    str(audio_file),
                    fp16=False,  # Disable FP16 for CPU compatibility
                    verbose=False
                )

            transcribed_text = result['text'].strip()
            detected_language = result.get('language', 'unknown')

            # Get audio duration (Whisper provides this in segments)
            duration = 0
            if 'segments' in result and result['segments']:
                last_segment = result['segments'][-1]
                duration = last_segment.get('end', 0)

            print(f"Transcription complete. Language: {detected_language}, Duration: {duration:.2f}s")
            if self.trace_logger:
                self.trace_logger.write(
                    "whisper.transcribe.complete",
                    data={
                        "file": audio_file.name,
                        "language": detected_language,
                        "duration_seconds": duration,
                        "text_length": len(transcribed_text),
                    },
                )

            return {
                'text': transcribed_text,
                'language': detected_language,
                'duration': duration
            }

        except Exception as e:
            print(f"Transcription error: {str(e)}")
            if self.trace_logger:
                self.trace_logger.write(
                    "whisper.transcribe.error",
                    data={
                        "file": audio_file.name if audio_file else None,
                        "error": str(e),
                    },
                )
            raise Exception(f"Failed to transcribe audio: {str(e)}")

    def supported_formats(self) -> List[str]:
        """
        Get list of supported audio formats.

        Returns:
            List of supported file extensions
        """
        return config.SUPPORTED_AUDIO_FORMATS

    def is_supported_format(self, filename: str) -> bool:
        """
        Check if file format is supported.

        Args:
            filename: Name of audio file

        Returns:
            True if format is supported, False otherwise
        """
        ext = Path(filename).suffix.lower()
        return ext in self.supported_formats()

    @staticmethod
    def cleanup_temp_file(file_path: str) -> None:
        """
        Delete temporary audio file.

        Args:
            file_path: Path to file to delete
        """
        try:
            Path(file_path).unlink(missing_ok=True)
            print(f"Cleaned up temp file: {file_path}")
        except Exception as e:
            print(f"Warning: Could not delete temp file {file_path}: {e}")

    def validate_audio_file(self, file_path: str, max_size_bytes: int = None) -> tuple[bool, str]:
        """
        Validate audio file size and format.

        Args:
            file_path: Path to audio file
            max_size_bytes: Maximum allowed file size in bytes

        Returns:
            Tuple of (is_valid, error_message)
            If valid, error_message is empty string
        """
        file = Path(file_path)

        # Check if file exists
        if not file.exists():
            return False, "File not found"

        # Check format
        if not self.is_supported_format(file.name):
            supported = ', '.join(self.supported_formats())
            return False, f"Unsupported format. Supported formats: {supported}"

        # Check file size
        if max_size_bytes:
            file_size = file.stat().st_size
            if file_size > max_size_bytes:
                max_mb = max_size_bytes / (1024 * 1024)
                actual_mb = file_size / (1024 * 1024)
                return False, f"File too large ({actual_mb:.1f}MB). Maximum size: {max_mb:.0f}MB"

        return True, ""
