from flask import Flask, jsonify, request, g
from flask_cors import CORS
import time
import uuid
import config
from services.file_service import FileService
from services.note_service import NoteService
from services.note_index_service import NoteIndexService
from services.folder_service import FolderService
from services.whisper_service import WhisperService
from services.text_processing_service import TextProcessingService
from services.openai_client import OpenAIClient
from services.settings_service import SettingsService
from services.transcription_job_service import TranscriptionJobService
from api.notes import notes_bp
from api.folders import folders_bp
from api.transcription import transcription_bp
from api.text_processing import text_processing_bp
from api.trace import trace_bp
from api.settings import settings_bp
from utils.trace import TraceLogger


def create_app():
    """Create and configure the Flask application."""
    app = Flask(__name__)

    # Enable CORS for all routes
    CORS(app, resources={
        r"/api/*": {
            "origins": ["http://localhost:5173", "http://localhost:3000"],
            "methods": ["GET", "POST", "PUT", "DELETE", "PATCH"],
            "allow_headers": ["Content-Type"]
        }
    })

    # Configuration
    app.config['DEBUG'] = config.DEBUG
    app.config['NOTES_DIR'] = config.NOTES_DIR
    app.config['UPLOADS_DIR'] = config.UPLOADS_DIR

    # Initialize tracing
    trace_logger = TraceLogger(config.TRACE_PATH, source="backend")
    frontend_trace_logger = TraceLogger(config.FRONTEND_TRACE_PATH, source="frontend")

    # Initialize services
    file_service = FileService(config.NOTES_DIR, trace_logger=trace_logger)
    settings_service = SettingsService(config.SETTINGS_PATH, trace_logger=trace_logger)
    note_index_service = NoteIndexService(config.NOTE_INDEX_PATH, trace_logger=trace_logger)
    note_service = NoteService(file_service, note_index_service, trace_logger=trace_logger)
    folder_service = FolderService(file_service)
    note_service.sync_index()

    # Initialize Whisper service (this may take a moment to load the model)
    print("Initializing Whisper service...")
    whisper_service = WhisperService(
        model_name=config.WHISPER_MODEL,
        trace_logger=trace_logger,
    )

    # Initialize text processing service
    print("Initializing text processing service...")
    llm_client = None
    if config.OPENAI_API_KEY and config.OPENAI_MODEL:
        llm_client = OpenAIClient(
            api_key=config.OPENAI_API_KEY,
            model=config.OPENAI_MODEL,
            trace_logger=trace_logger,
        )
    text_processing_service = TextProcessingService(llm_client=llm_client)
    transcription_job_service = TranscriptionJobService(
        whisper_service=whisper_service,
        note_service=note_service,
        settings_service=settings_service,
        snapshot_path=config.TRANSCRIPTION_JOBS_SNAPSHOT_PATH,
        events_path=config.TRANSCRIPTION_JOBS_EVENTS_PATH,
        trace_logger=trace_logger,
    )

    # Store services in app config for access in routes
    app.config['FILE_SERVICE'] = file_service
    app.config['SETTINGS_SERVICE'] = settings_service
    app.config['NOTE_INDEX_SERVICE'] = note_index_service
    app.config['NOTE_SERVICE'] = note_service
    app.config['FOLDER_SERVICE'] = folder_service
    app.config['WHISPER_SERVICE'] = whisper_service
    app.config['TRANSCRIPTION_JOB_SERVICE'] = transcription_job_service
    app.config['TEXT_PROCESSING_SERVICE'] = text_processing_service
    app.config['TRACE_LOGGER'] = trace_logger
    app.config['FRONTEND_TRACE_LOGGER'] = frontend_trace_logger

    # Register blueprints
    app.register_blueprint(notes_bp, url_prefix='/api/notes')
    app.register_blueprint(folders_bp, url_prefix='/api/folders')
    app.register_blueprint(transcription_bp, url_prefix='/api/transcription')
    app.register_blueprint(text_processing_bp, url_prefix='/api/text')
    app.register_blueprint(trace_bp, url_prefix='/api/trace')
    app.register_blueprint(settings_bp, url_prefix='/api/settings')

    @app.before_request
    def start_request_timer():
        g.request_id = uuid.uuid4().hex
        g.request_start = time.time()

    @app.after_request
    def log_request_trace(response):
        # Avoid recursive tracing from client trace ingestion.
        if request.path.startswith("/api/trace/client"):
            return response

        trace = app.config.get('TRACE_LOGGER')
        if not trace:
            return response

        duration_ms = int((time.time() - g.get("request_start", time.time())) * 1000)
        request_data = None
        if request.is_json:
            try:
                request_data = request.get_json(silent=True)
            except Exception:
                request_data = None
        elif request.files:
            request_data = {
                "files": {
                    key: {
                        "filename": file.filename,
                        "content_type": file.mimetype,
                    }
                    for key, file in request.files.items()
                }
            }

        response_data = None
        if response.content_type and "application/json" in response.content_type:
            try:
                response_data = response.get_json(silent=True)
            except Exception:
                response_data = None

        trace.write(
            "api.response",
            data={
                "method": request.method,
                "path": request.path,
                "query": request.args.to_dict(flat=True),
                "status": response.status_code,
                "duration_ms": duration_ms,
                "request": request_data,
                "response": response_data,
            },
            request_id=g.get("request_id"),
        )
        return response

    # Health check endpoint
    @app.route('/api/health', methods=['GET'])
    def health_check():
        return jsonify({
            'status': 'healthy',
            'message': 'Note-taking API is running'
        }), 200

    # Root endpoint
    @app.route('/', methods=['GET'])
    def root():
        return jsonify({
            'name': 'Note-Taking API',
            'version': '1.0.0',
            'endpoints': {
                'notes': '/api/notes',
                'folders': '/api/folders',
                'transcription': '/api/transcription',
                'text': '/api/text',
                'settings': '/api/settings',
                'health': '/api/health'
            }
        }), 200

    return app


if __name__ == '__main__':
    app = create_app()
    print(f"Starting Flask server on port {config.FLASK_PORT}")
    print(f"Notes directory: {config.NOTES_DIR}")
    print(f"Uploads directory: {config.UPLOADS_DIR}")
    app.run(
        host='0.0.0.0',
        port=config.FLASK_PORT,
        debug=config.DEBUG
    )
