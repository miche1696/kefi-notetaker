import os
from pathlib import Path
from dotenv import load_dotenv

# Base directory
BASE_DIR = Path(__file__).parent.parent

# Load environment variables (repo root .env)
load_dotenv(dotenv_path=BASE_DIR / ".env")

# Flask configuration
FLASK_ENV = os.getenv('FLASK_ENV', 'development')
FLASK_PORT = int(os.getenv('FLASK_PORT', 5001))
DEBUG = FLASK_ENV == 'development'

# Directory paths
NOTES_DIR = BASE_DIR / os.getenv('NOTES_DIR', 'notes')
UPLOADS_DIR = BASE_DIR / os.getenv('UPLOADS_DIR', 'uploads')
TRACE_PATH = BASE_DIR / os.getenv('TRACE_PATH', 'backend/trace.jsonl')
FRONTEND_TRACE_PATH = BASE_DIR / os.getenv('FRONTEND_TRACE_PATH', 'frontend/trace.jsonl')
STATE_DIR = BASE_DIR / os.getenv('STATE_DIR', 'backend/state')
SETTINGS_PATH = STATE_DIR / os.getenv('SETTINGS_FILE', 'settings.json')
NOTE_INDEX_PATH = STATE_DIR / os.getenv('NOTE_INDEX_FILE', 'notes_index.json')
TRANSCRIPTION_JOBS_SNAPSHOT_PATH = STATE_DIR / os.getenv(
    'TRANSCRIPTION_JOBS_SNAPSHOT_FILE',
    'transcription_jobs.snapshot.json',
)
TRANSCRIPTION_JOBS_EVENTS_PATH = STATE_DIR / os.getenv(
    'TRANSCRIPTION_JOBS_EVENTS_FILE',
    'transcription_jobs.events.jsonl',
)

# Whisper configuration
WHISPER_MODEL = os.getenv('WHISPER_MODEL', 'base')
MAX_AUDIO_SIZE_MB = int(os.getenv('MAX_AUDIO_SIZE_MB', 100))
MAX_AUDIO_SIZE_BYTES = MAX_AUDIO_SIZE_MB * 1024 * 1024

# OpenAI configuration
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
OPENAI_MODEL = os.getenv('OPENAI_MODEL')

# Ensure directories exist
NOTES_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
TRACE_PATH.parent.mkdir(parents=True, exist_ok=True)
FRONTEND_TRACE_PATH.parent.mkdir(parents=True, exist_ok=True)
STATE_DIR.mkdir(parents=True, exist_ok=True)

# Supported file formats
SUPPORTED_AUDIO_FORMATS = ['.mp3', '.wav', '.m4a', '.ogg', '.opus', '.flac', '.webm']
SUPPORTED_TEXT_FORMATS = ['.txt','.md']

# Transcription job defaults
DEFAULT_MAX_CONCURRENT_JOBS = int(os.getenv('DEFAULT_MAX_CONCURRENT_JOBS', 2))
DEFAULT_MAX_QUEUED_JOBS = int(os.getenv('DEFAULT_MAX_QUEUED_JOBS', 50))
DEFAULT_HISTORY_MAX_ENTRIES = int(os.getenv('DEFAULT_HISTORY_MAX_ENTRIES', 200))
DEFAULT_HISTORY_TTL_DAYS = int(os.getenv('DEFAULT_HISTORY_TTL_DAYS', 7))
DEFAULT_JOB_RETRY_MAX = int(os.getenv('DEFAULT_JOB_RETRY_MAX', 2))
DEFAULT_JOB_RETRY_BASE_MS = int(os.getenv('DEFAULT_JOB_RETRY_BASE_MS', 1500))
DEFAULT_AUTO_REQUEUE_INTERRUPTED = os.getenv(
    'DEFAULT_AUTO_REQUEUE_INTERRUPTED',
    'true',
).lower() == 'true'
