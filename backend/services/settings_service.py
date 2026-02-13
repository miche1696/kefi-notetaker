import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

import config


class SettingsService:
    """Persistent application settings backed by a JSON file."""

    DEFAULTS: Dict[str, Any] = {
        "transcription": {
            "max_concurrent_jobs": config.DEFAULT_MAX_CONCURRENT_JOBS,
            "max_queued_jobs": config.DEFAULT_MAX_QUEUED_JOBS,
            "history_max_entries": config.DEFAULT_HISTORY_MAX_ENTRIES,
            "history_ttl_days": config.DEFAULT_HISTORY_TTL_DAYS,
            "retry_max": config.DEFAULT_JOB_RETRY_MAX,
            "retry_base_ms": config.DEFAULT_JOB_RETRY_BASE_MS,
            "auto_requeue_interrupted": config.DEFAULT_AUTO_REQUEUE_INTERRUPTED,
        }
    }

    def __init__(self, settings_path: Path, trace_logger=None):
        self.settings_path = Path(settings_path)
        self.trace_logger = trace_logger
        self._lock = threading.RLock()
        self._settings = self._load()

    def _load(self) -> Dict[str, Any]:
        if not self.settings_path.exists():
            self._persist(self.DEFAULTS)
            return json.loads(json.dumps(self.DEFAULTS))

        try:
            with self.settings_path.open("r", encoding="utf-8") as handle:
                raw = json.load(handle)
        except Exception:
            raw = {}

        merged = self._merge_dicts(self.DEFAULTS, raw if isinstance(raw, dict) else {})
        self._persist(merged)
        return merged

    def _persist(self, payload: Dict[str, Any]) -> None:
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.settings_path.with_suffix(".tmp")
        with tmp_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        tmp_path.replace(self.settings_path)

    def _merge_dicts(self, base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
        merged: Dict[str, Any] = {}
        for key, value in base.items():
            if key not in override:
                merged[key] = value
                continue
            override_value = override[key]
            if isinstance(value, dict) and isinstance(override_value, dict):
                merged[key] = self._merge_dicts(value, override_value)
            else:
                merged[key] = override_value
        for key, value in override.items():
            if key not in merged:
                merged[key] = value
        return merged

    def _sanitize(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        merged = self._merge_dicts(self.DEFAULTS, payload)
        tx = merged.get("transcription", {})

        def to_int(value: Any, fallback: int, minimum: int, maximum: int) -> int:
            try:
                result = int(value)
            except Exception:
                result = fallback
            return max(minimum, min(maximum, result))

        tx["max_concurrent_jobs"] = to_int(
            tx.get("max_concurrent_jobs"),
            config.DEFAULT_MAX_CONCURRENT_JOBS,
            1,
            8,
        )
        tx["max_queued_jobs"] = to_int(
            tx.get("max_queued_jobs"),
            config.DEFAULT_MAX_QUEUED_JOBS,
            1,
            500,
        )
        tx["history_max_entries"] = to_int(
            tx.get("history_max_entries"),
            config.DEFAULT_HISTORY_MAX_ENTRIES,
            10,
            5000,
        )
        tx["history_ttl_days"] = to_int(
            tx.get("history_ttl_days"),
            config.DEFAULT_HISTORY_TTL_DAYS,
            1,
            365,
        )
        tx["retry_max"] = to_int(
            tx.get("retry_max"),
            config.DEFAULT_JOB_RETRY_MAX,
            0,
            10,
        )
        tx["retry_base_ms"] = to_int(
            tx.get("retry_base_ms"),
            config.DEFAULT_JOB_RETRY_BASE_MS,
            100,
            60_000,
        )
        tx["auto_requeue_interrupted"] = bool(tx.get("auto_requeue_interrupted"))

        merged["transcription"] = tx
        return merged

    def get(self) -> Dict[str, Any]:
        with self._lock:
            return json.loads(json.dumps(self._settings))

    def update(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            merged = self._merge_dicts(self._settings, patch if isinstance(patch, dict) else {})
            self._settings = self._sanitize(merged)
            self._persist(self._settings)
            if self.trace_logger:
                self.trace_logger.write(
                    "settings.updated",
                    data={
                        "keys": sorted((patch or {}).keys()),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
            return json.loads(json.dumps(self._settings))
