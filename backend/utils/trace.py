import json
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional


LOG_RETENTION_DAYS = 7
LOG_RETENTION_WINDOW = timedelta(days=LOG_RETENTION_DAYS)
LOG_PRUNE_INTERVAL_SECONDS = 300


def _parse_iso_timestamp(value: Any) -> Optional[float]:
    if not isinstance(value, str) or not value:
        return None
    try:
        normalized = value.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized).timestamp()
    except Exception:
        return None


def _extract_entry_ts(payload: Dict[str, Any]) -> Optional[float]:
    raw_ts = payload.get("ts")
    if raw_ts is not None:
        try:
            return float(raw_ts)
        except (TypeError, ValueError):
            pass
    return _parse_iso_timestamp(payload.get("iso"))


@dataclass
class RetainedJsonlWriter:
    path: Path
    safe: bool = True
    _lock: threading.Lock = field(init=False, repr=False)
    _last_pruned_at: float = field(init=False, default=0.0, repr=False)

    def __post_init__(self) -> None:
        self.path = Path(self.path)
        self._lock = threading.Lock()
        self.prune(force=True)

    def append(self, payload: Dict[str, Any]) -> None:
        def _append() -> None:
            line = json.dumps(payload, ensure_ascii=False)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self._lock:
                self._prune_locked(now_ts=time.time(), force=False)
                with self.path.open("a", encoding="utf-8") as handle:
                    handle.write(line + "\n")

        self._run(_append)

    def prune(self, force: bool = False) -> None:
        def _prune() -> None:
            with self._lock:
                self._prune_locked(now_ts=time.time(), force=force)

        self._run(_prune)

    def _run(self, operation) -> None:
        if self.safe:
            try:
                operation()
            except Exception:
                return
            return
        operation()

    def _prune_locked(self, now_ts: float, force: bool) -> None:
        if not force and (now_ts - self._last_pruned_at) < LOG_PRUNE_INTERVAL_SECONDS:
            return
        if not self.path.exists():
            self._last_pruned_at = now_ts
            return

        cutoff_ts = now_ts - LOG_RETENTION_WINDOW.total_seconds()
        kept_lines = []
        changed = False

        with self.path.open("r", encoding="utf-8") as handle:
            for raw_line in handle:
                stripped = raw_line.strip()
                if not stripped:
                    changed = True
                    continue
                try:
                    payload = json.loads(stripped)
                except json.JSONDecodeError:
                    changed = True
                    continue
                entry_ts = _extract_entry_ts(payload)
                if entry_ts is None or entry_ts < cutoff_ts:
                    changed = True
                    continue
                kept_lines.append(raw_line if raw_line.endswith("\n") else raw_line + "\n")

        if changed:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp_path = self.path.with_suffix(self.path.suffix + ".tmp")
            with tmp_path.open("w", encoding="utf-8") as handle:
                handle.writelines(kept_lines)
            tmp_path.replace(self.path)

        self._last_pruned_at = now_ts


@dataclass
class TraceLogger:
    path: Path
    source: str

    def __post_init__(self) -> None:
        self.path = Path(self.path)
        self._writer = RetainedJsonlWriter(self.path, safe=True)

    def write(self, event: str, data: Optional[Dict[str, Any]] = None, **extra: Any) -> None:
        payload: Dict[str, Any] = {
            "ts": time.time(),
            "iso": datetime.now(timezone.utc).isoformat(),
            "pid": os.getpid(),
            "source": self.source,
            "event": event,
        }
        if data is not None:
            payload["data"] = data
        if extra:
            payload.update(extra)

        self._writer.append(payload)
