import threading
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from services.file_service import FileService
from services.note_index_service import NoteIndexService


class RevisionConflictError(Exception):
    def __init__(self, note_id: str, expected_revision: int, current_revision: int):
        super().__init__(
            f"Revision conflict for note '{note_id}': expected {expected_revision}, current {current_revision}"
        )
        self.note_id = note_id
        self.expected_revision = expected_revision
        self.current_revision = current_revision


class NoteService:
    """High-level service for note operations with stable note IDs and revisions."""

    def __init__(
        self,
        file_service: FileService,
        note_index_service: NoteIndexService,
        trace_logger=None,
    ):
        self.file_service = file_service
        self.note_index = note_index_service
        self.trace_logger = trace_logger
        self._write_lock = threading.RLock()

    def _strip_extension(self, path: str) -> str:
        normalized = path.replace("\\", "/")
        for ext in self.file_service.SUPPORTED_EXTENSIONS:
            if normalized.endswith(ext):
                return normalized[:-len(ext)]
        return normalized

    def _build_note_dict(self, path_without_ext: str) -> dict:
        resolved_path = self.file_service._resolve_note_path(path_without_ext)
        content = self.file_service.read_note(resolved_path)
        full_path = self.file_service._get_full_path(resolved_path)
        stat = full_path.stat()
        extension = Path(resolved_path).suffix.lower()
        file_type = "md" if extension == ".md" else "txt"

        from models.note import Note

        note = Note(
            path=self._strip_extension(resolved_path),
            name=Path(resolved_path).stem,
            content=content,
            created_at=datetime.fromtimestamp(stat.st_ctime),
            modified_at=datetime.fromtimestamp(stat.st_mtime),
            size=stat.st_size,
            file_type=file_type,
        )
        payload = note.to_dict()
        identity = self.note_index.ensure_path(note.path)
        payload["id"] = identity["note_id"]
        payload["revision"] = identity["revision"]
        return payload

    def sync_index(self) -> None:
        notes = self.file_service.list_all_notes()
        paths = [self._strip_extension(note.get("path", "")) for note in notes]
        self.note_index.sync_paths(paths)

    def get_note(self, note_path: str) -> dict:
        return self._build_note_dict(note_path)

    def get_note_by_id(self, note_id: str) -> dict:
        record = self.note_index.get_by_id(note_id)
        if not record:
            raise FileNotFoundError(f"Note not found for id: {note_id}")
        return self._build_note_dict(record["path"])

    def resolve_note_path(self, note_id: str) -> Optional[str]:
        return self.note_index.resolve_path(note_id)

    def list_notes(self, folder_path: str = "") -> List[dict]:
        notes = self.file_service.list_notes(folder_path)
        for note in notes:
            note_path = self._strip_extension(note.get("path", ""))
            identity = self.note_index.ensure_path(note_path)
            note["id"] = identity["note_id"]
            note["revision"] = identity["revision"]
        return notes

    def list_all_notes(self) -> List[dict]:
        notes = self.file_service.list_all_notes()
        for note in notes:
            note_path = self._strip_extension(note.get("path", ""))
            identity = self.note_index.ensure_path(note_path)
            note["id"] = identity["note_id"]
            note["revision"] = identity["revision"]
        return notes

    def create_note(self, folder_path: str, name: str, content: str = "", file_type: str = "txt") -> dict:
        if file_type not in ["txt", "md"]:
            raise ValueError(f"Invalid file type: {file_type}")

        name = self.file_service._sanitize_filename(name)
        if not name:
            raise ValueError("Invalid note name")

        extension = f".{file_type}"
        if folder_path:
            note_path = f"{folder_path}/{name}{extension}"
        else:
            note_path = f"{name}{extension}"

        if self.file_service.note_exists(note_path):
            raise FileExistsError(f"Note already exists: {note_path}")

        self.file_service.write_note(note_path, content)
        path_without_ext = self._strip_extension(note_path)
        self.note_index.ensure_path(path_without_ext)
        return self.get_note(path_without_ext)

    def update_note(self, note_path: str, content: str, expected_revision: Optional[int]) -> dict:
        if not self.file_service.note_exists(note_path):
            raise FileNotFoundError(f"Note not found: {note_path}")
        if expected_revision is None:
            raise ValueError("expected_revision is required")

        with self._write_lock:
            resolved_path = self.file_service._resolve_note_path(note_path)
            path_without_ext = self._strip_extension(resolved_path)
            identity = self.note_index.ensure_path(path_without_ext)
            current_revision = identity["revision"]
            note_id = identity["note_id"]

            if int(expected_revision) != int(current_revision):
                raise RevisionConflictError(
                    note_id=note_id,
                    expected_revision=int(expected_revision),
                    current_revision=int(current_revision),
                )

            self.file_service.write_note(path_without_ext, content)
            self.note_index.increment_revision(note_id)
            return self.get_note_by_id(note_id)

    def replace_marker(
        self,
        note_id: str,
        marker_token: str,
        replacement_text: str,
    ) -> Dict:
        if not marker_token:
            raise ValueError("marker_token is required")

        with self._write_lock:
            record = self.note_index.get_by_id(note_id)
            if not record:
                return {
                    "status": "note_deleted",
                    "note_id": note_id,
                }

            note_path = record["path"]
            revision = int(record["revision"])
            content = self.file_service.read_note(note_path)
            matched_marker = None
            for candidate in self._marker_candidates(marker_token):
                if candidate in content:
                    matched_marker = candidate
                    break

            if matched_marker is None:
                return {
                    "status": "marker_missing",
                    "note_id": note_id,
                    "note_path": note_path,
                    "revision": revision,
                }

            updated_content = content.replace(matched_marker, replacement_text, 1)
            self.file_service.write_note(note_path, updated_content)
            new_revision = self.note_index.increment_revision(note_id)
            if self.trace_logger:
                self.trace_logger.write(
                    "note.marker.replaced",
                    data={
                        "note_id": note_id,
                        "note_path": note_path,
                        "revision": new_revision,
                        "marker_token": marker_token,
                        "matched_marker": matched_marker,
                        "replacement_length": len(replacement_text),
                    },
                )
            return {
                "status": "applied",
                "note_id": note_id,
                "note_path": note_path,
                "revision": new_revision,
            }

    @staticmethod
    def _marker_candidates(marker_token: str) -> List[str]:
        """Return marker spellings that can appear after markdown-editor escaping."""
        if not marker_token:
            return []

        candidates = [
            marker_token,
            marker_token.replace("[[", r"\[\["),
            marker_token.replace("[[", r"\[\[").replace("]]", r"\]\]"),
            marker_token.replace("[", r"\[").replace("]", r"\]"),
        ]

        seen = set()
        ordered = []
        for token in candidates:
            if token in seen:
                continue
            seen.add(token)
            ordered.append(token)
        return ordered

    def delete_note(self, note_path: str) -> None:
        resolved = self.file_service._resolve_note_path(note_path)
        canonical = self._strip_extension(resolved)
        identity = self.note_index.get_by_path(canonical)
        self.file_service.delete_note(note_path)
        if identity:
            self.note_index.mark_deleted_by_id(identity["note_id"])
        else:
            self.note_index.mark_deleted_by_path(canonical)

    def rename_note(self, note_path: str, new_name: str) -> dict:
        resolved = self.file_service._resolve_note_path(note_path)
        old_canonical = self._strip_extension(resolved)
        identity = self.note_index.ensure_path(old_canonical)
        note_id = identity["note_id"]

        new_path_with_ext = self.file_service.rename_note(note_path, new_name)
        new_canonical = self._strip_extension(new_path_with_ext)
        self.note_index.update_path(note_id, new_canonical)
        return self.get_note_by_id(note_id)

    def move_note(self, note_path: str, target_folder: str) -> dict:
        resolved = self.file_service._resolve_note_path(note_path)
        old_canonical = self._strip_extension(resolved)
        identity = self.note_index.ensure_path(old_canonical)
        note_id = identity["note_id"]

        new_path = self.file_service.move_note(note_path, target_folder)
        new_canonical = self._strip_extension(new_path)
        self.note_index.update_path(note_id, new_canonical)
        return self.get_note_by_id(note_id)
