import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class NoteIndexService:
    """
    Durable note identity + revision index.

    Notes are keyed by stable note_id while paths can change due to rename/move.
    """

    def __init__(self, index_path: Path, trace_logger=None):
        self.index_path = Path(index_path)
        self.trace_logger = trace_logger
        self._lock = threading.RLock()
        self._state = self._load()

    def _empty_state(self) -> Dict:
        now = _utc_now()
        return {
            "version": 1,
            "updated_at": now,
            "notes": {},  # note_id -> {path, revision, deleted, updated_at}
            "path_to_id": {},  # path -> note_id
        }

    def _load(self) -> Dict:
        if not self.index_path.exists():
            state = self._empty_state()
            self._persist(state)
            return state
        try:
            with self.index_path.open("r", encoding="utf-8") as handle:
                raw = json.load(handle)
            if not isinstance(raw, dict):
                raise ValueError("Invalid note index payload")
        except Exception:
            raw = self._empty_state()

        state = self._empty_state()
        state.update(raw)
        state["notes"] = state.get("notes", {})
        state["path_to_id"] = state.get("path_to_id", {})
        self._persist(state)
        return state

    def _persist(self, payload: Dict) -> None:
        self.index_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.index_path.with_suffix(".tmp")
        with tmp_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        tmp_path.replace(self.index_path)

    def _touch(self) -> None:
        self._state["updated_at"] = _utc_now()
        self._persist(self._state)

    @staticmethod
    def _normalize_path(path: str) -> str:
        return (path or "").strip().replace("\\", "/")

    def sync_paths(self, current_paths: List[str]) -> None:
        with self._lock:
            normalized = {self._normalize_path(path) for path in current_paths if path}
            # Ensure all current paths have ids.
            for path in sorted(normalized):
                self._ensure_path_locked(path)

            # Mark records as deleted if path disappeared.
            for note_id, record in list(self._state["notes"].items()):
                path = record.get("path")
                if not path:
                    continue
                if path in normalized:
                    record["deleted"] = False
                    continue
                record["deleted"] = True
                record["updated_at"] = _utc_now()

            # Rebuild path_to_id from non-deleted notes.
            rebuilt = {}
            for note_id, record in self._state["notes"].items():
                if record.get("deleted"):
                    continue
                path = record.get("path")
                if path:
                    rebuilt[path] = note_id
            self._state["path_to_id"] = rebuilt
            self._touch()

    def _ensure_path_locked(self, path: str) -> Dict:
        note_id = self._state["path_to_id"].get(path)
        if note_id:
            record = self._state["notes"].get(note_id)
            if record:
                if record.get("deleted"):
                    record["deleted"] = False
                    record["updated_at"] = _utc_now()
                return {"note_id": note_id, "revision": int(record.get("revision", 1))}

        note_id = uuid.uuid4().hex
        self._state["notes"][note_id] = {
            "path": path,
            "revision": 1,
            "deleted": False,
            "updated_at": _utc_now(),
        }
        self._state["path_to_id"][path] = note_id
        if self.trace_logger:
            self.trace_logger.write(
                "note.index.created",
                data={"note_id": note_id, "path": path},
            )
        return {"note_id": note_id, "revision": 1}

    def ensure_path(self, path: str) -> Dict:
        with self._lock:
            normalized = self._normalize_path(path)
            payload = self._ensure_path_locked(normalized)
            self._touch()
            return payload

    def get_by_path(self, path: str) -> Optional[Dict]:
        with self._lock:
            normalized = self._normalize_path(path)
            note_id = self._state["path_to_id"].get(normalized)
            if not note_id:
                return None
            record = self._state["notes"].get(note_id)
            if not record or record.get("deleted"):
                return None
            return {
                "note_id": note_id,
                "path": record.get("path"),
                "revision": int(record.get("revision", 1)),
            }

    def get_by_id(self, note_id: str) -> Optional[Dict]:
        with self._lock:
            record = self._state["notes"].get(note_id)
            if not record or record.get("deleted"):
                return None
            return {
                "note_id": note_id,
                "path": record.get("path"),
                "revision": int(record.get("revision", 1)),
            }

    def increment_revision(self, note_id: str) -> Optional[int]:
        with self._lock:
            record = self._state["notes"].get(note_id)
            if not record or record.get("deleted"):
                return None
            record["revision"] = int(record.get("revision", 1)) + 1
            record["updated_at"] = _utc_now()
            self._touch()
            return int(record["revision"])

    def update_path(self, note_id: str, new_path: str) -> Optional[Dict]:
        with self._lock:
            record = self._state["notes"].get(note_id)
            if not record:
                return None

            old_path = record.get("path")
            normalized = self._normalize_path(new_path)
            record["path"] = normalized
            record["deleted"] = False
            record["updated_at"] = _utc_now()

            if old_path and old_path in self._state["path_to_id"]:
                del self._state["path_to_id"][old_path]
            self._state["path_to_id"][normalized] = note_id
            self._touch()

            if self.trace_logger:
                self.trace_logger.write(
                    "note.index.path.updated",
                    data={
                        "note_id": note_id,
                        "from": old_path,
                        "to": normalized,
                    },
                )
            return {
                "note_id": note_id,
                "path": normalized,
                "revision": int(record.get("revision", 1)),
            }

    def mark_deleted_by_path(self, path: str) -> None:
        with self._lock:
            normalized = self._normalize_path(path)
            note_id = self._state["path_to_id"].get(normalized)
            if note_id:
                self.mark_deleted_by_id(note_id)

    def mark_deleted_by_id(self, note_id: str) -> None:
        with self._lock:
            record = self._state["notes"].get(note_id)
            if not record:
                return
            path = record.get("path")
            record["deleted"] = True
            record["updated_at"] = _utc_now()
            if path and self._state["path_to_id"].get(path) == note_id:
                del self._state["path_to_id"][path]
            self._touch()
            if self.trace_logger:
                self.trace_logger.write(
                    "note.index.deleted",
                    data={"note_id": note_id, "path": path},
                )

    def check_expected_revision(self, note_id: str, expected_revision: int) -> bool:
        with self._lock:
            record = self._state["notes"].get(note_id)
            if not record or record.get("deleted"):
                return False
            return int(record.get("revision", 1)) == int(expected_revision)

    def resolve_path(self, note_id: str) -> Optional[str]:
        with self._lock:
            record = self._state["notes"].get(note_id)
            if not record or record.get("deleted"):
                return None
            return record.get("path")
