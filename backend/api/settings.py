from flask import Blueprint, current_app, jsonify, request
from werkzeug.exceptions import BadRequest

settings_bp = Blueprint("settings", __name__)


@settings_bp.route("", methods=["GET"])
def get_settings():
    try:
        settings_service = current_app.config.get("SETTINGS_SERVICE")
        if not settings_service:
            return jsonify({"error": "Settings service not initialized"}), 500
        return jsonify(settings_service.get()), 200
    except Exception as exc:
        return jsonify({"error": f"Internal server error: {str(exc)}"}), 500


@settings_bp.route("", methods=["PUT"])
def update_settings():
    try:
        settings_service = current_app.config.get("SETTINGS_SERVICE")
        if not settings_service:
            return jsonify({"error": "Settings service not initialized"}), 500

        payload = request.get_json(silent=True)
        if payload is None:
            raise BadRequest("Request body must be JSON")

        updated = settings_service.update(payload)
        return jsonify(updated), 200
    except BadRequest as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": f"Internal server error: {str(exc)}"}), 500
