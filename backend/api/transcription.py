from flask import Blueprint, request, jsonify, current_app
from pathlib import Path
import uuid
import config

transcription_bp = Blueprint('transcription', __name__)


def _save_uploaded_audio(whisper_service, audio_file):
    if audio_file.filename == '':
        raise ValueError('No file selected')

    # Validate file format by extension
    if not whisper_service.is_supported_format(audio_file.filename):
        supported = ', '.join(whisper_service.supported_formats())
        raise ValueError(f'Unsupported audio format. Supported formats: {supported}')

    file_ext = Path(audio_file.filename).suffix
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    temp_path = config.UPLOADS_DIR / unique_filename
    audio_file.save(str(temp_path))

    is_valid, error_msg = whisper_service.validate_audio_file(
        str(temp_path),
        max_size_bytes=config.MAX_AUDIO_SIZE_BYTES
    )
    if not is_valid:
        whisper_service.cleanup_temp_file(str(temp_path))
        raise ValueError(error_msg)
    return temp_path


@transcription_bp.route('/audio', methods=['POST'])
def transcribe_audio():
    """
    Upload and transcribe audio file.

    Expects multipart/form-data with 'audio' file field.

    Returns:
        JSON with transcribed text, language, and duration
    """
    try:
        whisper_service = current_app.config.get('WHISPER_SERVICE')
        if not whisper_service:
            return jsonify({'error': 'Whisper service not initialized'}), 500

        # Check if file is in request
        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400

        audio_file = request.files['audio']

        temp_path = _save_uploaded_audio(whisper_service, audio_file)

        try:
            # Transcribe audio
            result = whisper_service.transcribe_audio(str(temp_path))

            trace_logger = current_app.config.get('TRACE_LOGGER')
            if trace_logger:
                trace_logger.write(
                    "transcription.complete",
                    data={
                        "filename": audio_file.filename,
                        "language": result.get('language'),
                        "duration": result.get('duration'),
                        "text": result.get('text'),
                    },
                )

            # Clean up temp file
            whisper_service.cleanup_temp_file(str(temp_path))

            return jsonify({
                'text': result['text'],
                'language': result['language'],
                'duration': result['duration'],
                'message': 'Transcription successful'
            }), 200

        except Exception as transcribe_error:
            # Clean up temp file on error
            whisper_service.cleanup_temp_file(str(temp_path))
            raise transcribe_error

    except FileNotFoundError as e:
        return jsonify({'error': str(e)}), 404
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        print(f"Transcription error: {str(e)}")
        return jsonify({'error': f'Transcription failed: {str(e)}'}), 500


@transcription_bp.route('/jobs', methods=['POST'])
def create_transcription_job():
    """Queue an asynchronous transcription job anchored to a note marker token."""
    temp_path = None

    def cleanup_temp():
        nonlocal temp_path
        if not temp_path:
            return
        whisper = current_app.config.get('WHISPER_SERVICE')
        if whisper:
            whisper.cleanup_temp_file(str(temp_path))
        temp_path = None

    try:
        whisper_service = current_app.config.get('WHISPER_SERVICE')
        job_service = current_app.config.get('TRANSCRIPTION_JOB_SERVICE')
        if not whisper_service or not job_service:
            return jsonify({'error': 'Transcription services not initialized'}), 500

        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400

        note_id = request.form.get('note_id')
        marker_token = request.form.get('marker_token')
        launch_source = request.form.get('launch_source', 'drop')
        if not note_id or not marker_token:
            return jsonify({'error': 'note_id and marker_token are required'}), 400

        audio_file = request.files['audio']
        temp_path = _save_uploaded_audio(whisper_service, audio_file)

        try:
            job = job_service.create_job(
                audio_path=str(temp_path),
                source_filename=audio_file.filename,
                note_id=note_id,
                marker_token=marker_token,
                launch_source=launch_source,
            )
        except Exception:
            cleanup_temp()
            raise
        return jsonify(job), 202

    except FileNotFoundError as e:
        cleanup_temp()
        return jsonify({'error': str(e)}), 404
    except ValueError as e:
        cleanup_temp()
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        cleanup_temp()
        return jsonify({'error': f'Failed to queue job: {str(e)}'}), 500


@transcription_bp.route('/jobs', methods=['GET'])
def list_transcription_jobs():
    try:
        job_service = current_app.config.get('TRANSCRIPTION_JOB_SERVICE')
        if not job_service:
            return jsonify({'error': 'Transcription job service not initialized'}), 500
        return jsonify({'jobs': job_service.list_jobs()}), 200
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500


@transcription_bp.route('/jobs/<job_id>', methods=['GET'])
def get_transcription_job(job_id):
    try:
        job_service = current_app.config.get('TRANSCRIPTION_JOB_SERVICE')
        if not job_service:
            return jsonify({'error': 'Transcription job service not initialized'}), 500
        job = job_service.get_job(job_id)
        if not job:
            return jsonify({'error': 'Job not found'}), 404
        return jsonify(job), 200
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500


@transcription_bp.route('/jobs/<job_id>/cancel', methods=['POST'])
def cancel_transcription_job(job_id):
    try:
        job_service = current_app.config.get('TRANSCRIPTION_JOB_SERVICE')
        if not job_service:
            return jsonify({'error': 'Transcription job service not initialized'}), 500
        job = job_service.cancel_job(job_id)
        if not job:
            return jsonify({'error': 'Job not found'}), 404
        return jsonify(job), 200
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500


@transcription_bp.route('/jobs/<job_id>/resume', methods=['POST'])
def resume_transcription_job(job_id):
    try:
        job_service = current_app.config.get('TRANSCRIPTION_JOB_SERVICE')
        if not job_service:
            return jsonify({'error': 'Transcription job service not initialized'}), 500
        job = job_service.resume_job(job_id)
        if not job:
            return jsonify({'error': 'Job not found'}), 404
        return jsonify(job), 200
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500


@transcription_bp.route('/jobs/resume-interrupted', methods=['POST'])
def resume_interrupted_jobs():
    try:
        job_service = current_app.config.get('TRANSCRIPTION_JOB_SERVICE')
        if not job_service:
            return jsonify({'error': 'Transcription job service not initialized'}), 500
        result = job_service.resume_interrupted()
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500


@transcription_bp.route('/formats', methods=['GET'])
def get_supported_formats():
    """Get list of supported audio formats."""
    try:
        whisper_service = current_app.config.get('WHISPER_SERVICE')
        if not whisper_service:
            return jsonify({'error': 'Whisper service not initialized'}), 500

        return jsonify({
            'formats': whisper_service.supported_formats(),
            'max_size_mb': config.MAX_AUDIO_SIZE_MB
        }), 200

    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500
