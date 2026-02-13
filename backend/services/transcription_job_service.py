import json
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional


TERMINAL_STATUSES = {"completed", "failed", "orphaned", "cancelled"}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _now_ts() -> float:
    return time.time()


class TranscriptionJobService:
    """Durable async transcription jobs with queueing, retries, and restart recovery."""

    def __init__(
        self,
        whisper_service,
        note_service,
        settings_service,
        snapshot_path: Path,
        events_path: Path,
        trace_logger=None,
        worker_slots: int = 8,
    ):
        self.whisper_service = whisper_service
        self.note_service = note_service
        self.settings_service = settings_service
        self.snapshot_path = Path(snapshot_path)
        self.events_path = Path(events_path)
        self.trace_logger = trace_logger
        self.worker_slots = max(1, min(16, int(worker_slots)))

        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._state = self._load_state()
        self._recover_after_restart()
        self._start_workers()

    def _settings(self) -> Dict:
        return self.settings_service.get().get("transcription", {})

    def _empty_state(self) -> Dict:
        now = _utc_now()
        return {
            "version": 1,
            "created_at": now,
            "updated_at": now,
            "jobs": {},  # job_id -> payload
            "queue": [],  # list[job_id]
        }

    def _load_state(self) -> Dict:
        if not self.snapshot_path.exists():
            state = self._empty_state()
            self._persist_snapshot(state)
            return state

        try:
            with self.snapshot_path.open("r", encoding="utf-8") as handle:
                raw = json.load(handle)
            if not isinstance(raw, dict):
                raise ValueError("Invalid snapshot payload")
        except Exception:
            raw = self._empty_state()

        state = self._empty_state()
        state.update(raw)
        state["jobs"] = state.get("jobs", {})
        state["queue"] = [job_id for job_id in state.get("queue", []) if job_id in state["jobs"]]
        self._persist_snapshot(state)
        return state

    def _persist_snapshot(self, payload: Dict) -> None:
        self.snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.snapshot_path.with_suffix(".tmp")
        with tmp_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        tmp_path.replace(self.snapshot_path)

    def _append_event(self, event: str, data: Dict) -> None:
        self.events_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "ts": _now_ts(),
            "iso": _utc_now(),
            "event": event,
            "data": data,
        }
        with self.events_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False) + "\n")

    def _save(self, event: Optional[str] = None, data: Optional[Dict] = None) -> None:
        self._state["updated_at"] = _utc_now()
        self._persist_snapshot(self._state)
        if event:
            self._append_event(event, data or {})

    def _trace(self, event: str, data: Dict) -> None:
        if self.trace_logger:
            self.trace_logger.write(event, data=data)

    def _recover_after_restart(self) -> None:
        with self._lock:
            tx_settings = self._settings()
            auto_requeue = bool(tx_settings.get("auto_requeue_interrupted", True))
            retry_max = int(tx_settings.get("retry_max", 2))

            for job in self._state["jobs"].values():
                status = job.get("status")
                if status not in {"running", "cancel_requested"}:
                    continue
                job["status"] = "interrupted"
                job["updated_at"] = _utc_now()
                job["error_code"] = "restart_interrupted"
                job["error"] = "Job interrupted by backend restart"
                self._trace(
                    "tx.job.interrupted.restart",
                    {
                        "job_id": job["id"],
                        "note_id": job.get("note_id"),
                    },
                )

                if auto_requeue and int(job.get("restart_requeues", 0)) < 1:
                    if int(job.get("attempts", 0)) <= retry_max:
                        job["restart_requeues"] = int(job.get("restart_requeues", 0)) + 1
                        self._queue_job_locked(job["id"], delay_ms=0, reason="restart_auto")
                        self._trace(
                            "tx.job.requeued.restart.auto",
                            {
                                "job_id": job["id"],
                                "note_id": job.get("note_id"),
                            },
                        )
            self._prune_history_locked()
            self._save(event="tx.jobs.recovered", data={"count": len(self._state["jobs"])})

    def _start_workers(self) -> None:
        self._workers = []
        for index in range(self.worker_slots):
            worker = threading.Thread(
                target=self._worker_loop,
                args=(index,),
                name=f"tx-worker-{index}",
                daemon=True,
            )
            worker.start()
            self._workers.append(worker)

    def _queue_length_locked(self) -> int:
        return sum(1 for job_id in self._state["queue"] if job_id in self._state["jobs"])

    def _queue_job_locked(self, job_id: str, delay_ms: int = 0, reason: str = "manual") -> None:
        if job_id not in self._state["jobs"]:
            return
        job = self._state["jobs"][job_id]
        if delay_ms > 0:
            job["available_at"] = _now_ts() + (delay_ms / 1000.0)
        else:
            job["available_at"] = _now_ts()
        if job_id not in self._state["queue"]:
            self._state["queue"].append(job_id)
        job["status"] = "queued"
        job["updated_at"] = _utc_now()
        self._trace(
            "tx.job.queued",
            {
                "job_id": job_id,
                "note_id": job.get("note_id"),
                "queue_depth": self._queue_length_locked(),
                "reason": reason,
            },
        )

    def create_job(
        self,
        audio_path: str,
        source_filename: str,
        note_id: str,
        marker_token: str,
        launch_source: str = "drop",
    ) -> Dict:
        with self._lock:
            tx_settings = self._settings()
            max_queued = int(tx_settings.get("max_queued_jobs", 50))
            active_queued = sum(
                1
                for job in self._state["jobs"].values()
                if job.get("status") in {"queued", "running", "cancel_requested", "interrupted"}
            )
            if active_queued >= max_queued:
                raise ValueError("Transcription queue is full")

            note_path = self.note_service.resolve_note_path(note_id)
            if not note_path:
                raise FileNotFoundError("Target note not found")

            job_id = uuid.uuid4().hex
            now = _utc_now()
            job = {
                "id": job_id,
                "status": "queued",
                "created_at": now,
                "updated_at": now,
                "started_at": None,
                "completed_at": None,
                "available_at": _now_ts(),
                "attempts": 0,
                "restart_requeues": 0,
                "note_id": note_id,
                "note_path": note_path,
                "marker_token": marker_token,
                "audio_path": str(audio_path),
                "source_filename": source_filename,
                "launch_source": launch_source,
                "transcript_text": None,
                "error_code": None,
                "error": None,
                "duration_ms": None,
                "last_result": None,
                "cancel_requested": False,
            }
            self._state["jobs"][job_id] = job
            self._queue_job_locked(job_id, reason="create")
            self._prune_history_locked()
            self._save(event="tx.job.created", data={"job_id": job_id, "note_id": note_id})
            self._trace(
                "tx.job.created",
                {
                    "job_id": job_id,
                    "note_id": note_id,
                    "note_path": note_path,
                    "source_filename": source_filename,
                    "launch_source": launch_source,
                },
            )
            return self._serialize_job_locked(job)

    def _next_queued_job_locked(self, worker_index: int) -> Optional[str]:
        tx_settings = self._settings()
        max_concurrent = int(tx_settings.get("max_concurrent_jobs", 2))
        if worker_index >= max_concurrent:
            return None

        now_ts = _now_ts()
        for job_id in list(self._state["queue"]):
            job = self._state["jobs"].get(job_id)
            if not job:
                self._state["queue"].remove(job_id)
                continue
            if job.get("status") != "queued":
                self._state["queue"].remove(job_id)
                continue
            if float(job.get("available_at") or 0) > now_ts:
                continue
            self._state["queue"].remove(job_id)
            return job_id
        return None

    def _is_transient_error(self, message: str) -> bool:
        lowered = (message or "").lower()
        needles = [
            "timeout",
            "timed out",
            "temporarily unavailable",
            "connection reset",
            "connection aborted",
            "network",
            "502",
            "503",
            "504",
        ]
        return any(needle in lowered for needle in needles)

    @staticmethod
    def _build_failure_placeholder(message: str) -> str:
        cleaned = " ".join((message or "Unknown transcription error").split())
        if len(cleaned) > 180:
            cleaned = f"{cleaned[:177]}..."
        return f"[Transcription failed: {cleaned}]"

    def _worker_loop(self, worker_index: int) -> None:
        while not self._stop.is_set():
            job_id = None
            with self._lock:
                job_id = self._next_queued_job_locked(worker_index)
                if job_id:
                    job = self._state["jobs"].get(job_id)
                    if not job:
                        continue
                    job["status"] = "running"
                    job["started_at"] = _utc_now()
                    job["updated_at"] = _utc_now()
                    job["attempts"] = int(job.get("attempts", 0)) + 1
                    job["cancel_requested"] = False
                    self._save(event="tx.job.started", data={"job_id": job_id})
                    self._trace(
                        "tx.job.started",
                        {
                            "job_id": job_id,
                            "note_id": job.get("note_id"),
                            "attempt": job["attempts"],
                        },
                    )

            if not job_id:
                time.sleep(0.2)
                continue

            self._run_job(job_id)

    def _run_job(self, job_id: str) -> None:
        started = _now_ts()
        audio_path = None
        note_id = None
        marker_token = None
        try:
            with self._lock:
                job = self._state["jobs"].get(job_id)
                if not job:
                    return
                if job.get("status") != "running":
                    return
                audio_path = job.get("audio_path")
                note_id = job.get("note_id")
                marker_token = job.get("marker_token")
                if job.get("cancel_requested"):
                    self._mark_cancelled_locked(job, code="cancel_requested_before_start")
                    self._save(event="tx.job.cancelled", data={"job_id": job_id})
                    return

            result = self.whisper_service.transcribe_audio(audio_path)
            transcript = (result.get("text") or "").strip()

            with self._lock:
                job = self._state["jobs"].get(job_id)
                if not job:
                    return
                if job.get("cancel_requested"):
                    self._mark_cancelled_locked(job, code="cancel_requested_during_run")
                    self._save(event="tx.job.cancelled", data={"job_id": job_id})
                    self._trace(
                        "tx.job.cancelled",
                        {"job_id": job_id, "note_id": note_id, "phase": "post_transcription"},
                    )
                    return

            apply_result = self.note_service.replace_marker(note_id, marker_token, transcript)
            duration_ms = int((_now_ts() - started) * 1000)

            with self._lock:
                job = self._state["jobs"].get(job_id)
                if not job:
                    return
                job["duration_ms"] = duration_ms
                job["transcript_text"] = transcript
                job["last_result"] = apply_result
                job["updated_at"] = _utc_now()
                job["completed_at"] = _utc_now()
                job["note_path"] = apply_result.get("note_path") or self.note_service.resolve_note_path(note_id)
                job["note_revision"] = apply_result.get("revision")

                status = apply_result.get("status")
                if status == "applied":
                    job["status"] = "completed"
                    self._save(event="tx.job.completed", data={"job_id": job_id})
                    self._trace(
                        "tx.job.completed",
                        {
                            "job_id": job_id,
                            "note_id": note_id,
                            "note_path": job.get("note_path"),
                            "note_revision": job.get("note_revision"),
                            "duration_ms": duration_ms,
                            "text_length": len(transcript),
                        },
                    )
                    self._trace(
                        "tx.marker.apply.success",
                        {
                            "job_id": job_id,
                            "note_id": note_id,
                            "note_path": job.get("note_path"),
                            "note_revision": job.get("note_revision"),
                        },
                    )
                elif status == "marker_missing":
                    job["status"] = "orphaned"
                    job["error_code"] = "marker_missing"
                    job["error"] = "Marker token missing in target note"
                    self._save(event="tx.job.orphaned", data={"job_id": job_id})
                    self._trace(
                        "tx.job.orphaned",
                        {
                            "job_id": job_id,
                            "note_id": note_id,
                            "note_path": job.get("note_path"),
                            "note_revision": job.get("note_revision"),
                        },
                    )
                    self._trace(
                        "tx.marker.apply.conflict",
                        {
                            "job_id": job_id,
                            "note_id": note_id,
                            "reason": "marker_missing",
                        },
                    )
                else:
                    job["status"] = "failed"
                    job["error_code"] = "target_note_missing"
                    job["error"] = "Target note was deleted before apply"
                    self._save(event="tx.job.failed", data={"job_id": job_id})
                    self._trace(
                        "tx.job.failed",
                        {
                            "job_id": job_id,
                            "note_id": note_id,
                            "error_code": job["error_code"],
                        },
                    )
            self.whisper_service.cleanup_temp_file(audio_path)

        except Exception as exc:
            message = str(exc)
            apply_result = None
            should_retry = False
            attempts = 0
            with self._lock:
                job = self._state["jobs"].get(job_id)
                if not job:
                    return
                retry_max = int(self._settings().get("retry_max", 2))
                retry_base_ms = int(self._settings().get("retry_base_ms", 1500))
                attempts = int(job.get("attempts", 0))
                should_retry = self._is_transient_error(message) and attempts <= retry_max

                if should_retry:
                    delay_ms = retry_base_ms * (2 ** max(0, attempts - 1))
                    job["error_code"] = "transient_error"
                    job["error"] = message
                    self._queue_job_locked(job_id, delay_ms=delay_ms, reason="retry")
                    self._save(event="tx.job.retry", data={"job_id": job_id, "delay_ms": delay_ms})
                    self._trace(
                        "tx.job.retry",
                        {
                            "job_id": job_id,
                            "note_id": job.get("note_id"),
                            "attempt": attempts,
                            "delay_ms": delay_ms,
                        },
                    )
            if should_retry:
                return

            failure_placeholder = self._build_failure_placeholder(message)
            self._trace(
                "tx.marker.apply.failure_message.attempt",
                {
                    "job_id": job_id,
                    "note_id": note_id,
                    "marker_token": marker_token,
                },
            )
            try:
                apply_result = self.note_service.replace_marker(note_id, marker_token, failure_placeholder)
                apply_status = (apply_result or {}).get("status")
                if apply_status == "applied":
                    self._trace(
                        "tx.marker.apply.failure_message.success",
                        {
                            "job_id": job_id,
                            "note_id": note_id,
                            "note_path": apply_result.get("note_path"),
                            "note_revision": apply_result.get("revision"),
                        },
                    )
                else:
                    self._trace(
                        "tx.marker.apply.failure_message.conflict",
                        {
                            "job_id": job_id,
                            "note_id": note_id,
                            "apply_status": apply_status,
                        },
                    )
            except Exception as apply_exc:
                self._trace(
                    "tx.marker.apply.failure_message.error",
                    {
                        "job_id": job_id,
                        "note_id": note_id,
                        "error": str(apply_exc),
                    },
                )

            with self._lock:
                job = self._state["jobs"].get(job_id)
                if not job:
                    return
                job["status"] = "failed"
                job["error_code"] = "transcription_error"
                job["error"] = message
                job["completed_at"] = _utc_now()
                job["updated_at"] = _utc_now()
                if apply_result is not None:
                    job["last_result"] = apply_result
                    if apply_result.get("note_path"):
                        job["note_path"] = apply_result.get("note_path")
                    if apply_result.get("revision") is not None:
                        job["note_revision"] = apply_result.get("revision")
                self._save(event="tx.job.failed", data={"job_id": job_id})
                self._trace(
                    "tx.job.failed",
                    {
                        "job_id": job_id,
                        "note_id": job.get("note_id"),
                        "error_code": job.get("error_code"),
                        "error": message,
                        "attempt": attempts,
                    },
                )
                if audio_path:
                    self.whisper_service.cleanup_temp_file(audio_path)

    def shutdown(self, timeout: float = 1.0) -> None:
        """Stop worker threads. Intended for tests and controlled shutdown paths."""
        self._stop.set()
        for worker in getattr(self, "_workers", []):
            worker.join(timeout=timeout)

    def __del__(self):
        try:
            self.shutdown(timeout=0.05)
        except Exception:
            # Destructors should never raise.
            pass

    def _mark_cancelled_locked(self, job: Dict, code: str) -> None:
        job["status"] = "cancelled"
        job["updated_at"] = _utc_now()
        job["completed_at"] = _utc_now()
        job["error_code"] = code
        job["error"] = "Job cancelled"
        audio_path = job.get("audio_path")
        if audio_path:
            self.whisper_service.cleanup_temp_file(audio_path)

    def _serialize_job_locked(self, job: Dict) -> Dict:
        payload = dict(job)
        note_id = payload.get("note_id")
        if note_id:
            latest_path = self.note_service.resolve_note_path(note_id)
            if latest_path:
                payload["note_path"] = latest_path
        payload["can_cancel"] = payload.get("status") in {"queued", "running", "cancel_requested", "interrupted"}
        payload["can_resume"] = payload.get("status") in {"interrupted"}
        payload["can_copy"] = bool(payload.get("transcript_text"))
        return payload

    def get_job(self, job_id: str) -> Optional[Dict]:
        with self._lock:
            job = self._state["jobs"].get(job_id)
            if not job:
                return None
            return self._serialize_job_locked(job)

    def list_jobs(self) -> List[Dict]:
        with self._lock:
            jobs = [self._serialize_job_locked(job) for job in self._state["jobs"].values()]
            jobs.sort(key=lambda item: item.get("created_at") or "", reverse=True)
            return jobs

    def cancel_job(self, job_id: str) -> Optional[Dict]:
        with self._lock:
            job = self._state["jobs"].get(job_id)
            if not job:
                return None

            status = job.get("status")
            if status in TERMINAL_STATUSES:
                return self._serialize_job_locked(job)

            if status in {"queued", "interrupted"}:
                if job_id in self._state["queue"]:
                    self._state["queue"].remove(job_id)
                self._mark_cancelled_locked(job, code="cancelled_before_run")
                self._save(event="tx.job.cancelled", data={"job_id": job_id})
                self._trace(
                    "tx.job.cancelled",
                    {"job_id": job_id, "note_id": job.get("note_id"), "phase": "pre_run"},
                )
            else:
                job["cancel_requested"] = True
                job["status"] = "cancel_requested"
                job["updated_at"] = _utc_now()
                self._save(event="tx.job.cancel_requested", data={"job_id": job_id})
                self._trace(
                    "tx.job.cancel_requested",
                    {"job_id": job_id, "note_id": job.get("note_id")},
                )
            return self._serialize_job_locked(job)

    def resume_job(self, job_id: str) -> Optional[Dict]:
        with self._lock:
            job = self._state["jobs"].get(job_id)
            if not job:
                return None
            if job.get("status") != "interrupted":
                return self._serialize_job_locked(job)
            self._queue_job_locked(job_id, reason="manual_resume")
            self._save(event="tx.job.resumed", data={"job_id": job_id})
            self._trace(
                "tx.job.requeued.restart.manual",
                {"job_id": job_id, "note_id": job.get("note_id")},
            )
            return self._serialize_job_locked(job)

    def resume_interrupted(self) -> Dict:
        with self._lock:
            resumed = 0
            for job_id, job in self._state["jobs"].items():
                if job.get("status") != "interrupted":
                    continue
                self._queue_job_locked(job_id, reason="manual_resume_all")
                resumed += 1
            self._save(event="tx.jobs.resumed.interrupted", data={"count": resumed})
            return {"resumed": resumed}

    def _prune_history_locked(self) -> None:
        tx_settings = self._settings()
        max_entries = int(tx_settings.get("history_max_entries", 200))
        ttl_days = int(tx_settings.get("history_ttl_days", 7))
        cutoff = datetime.now(timezone.utc) - timedelta(days=ttl_days)

        terminal_jobs = []
        for job_id, job in self._state["jobs"].items():
            if job.get("status") not in TERMINAL_STATUSES:
                continue
            completed_at = job.get("completed_at") or job.get("updated_at") or job.get("created_at")
            try:
                completed_dt = datetime.fromisoformat(completed_at)
            except Exception:
                completed_dt = datetime.now(timezone.utc)
            terminal_jobs.append((job_id, job, completed_dt))

        # Remove by TTL first.
        for job_id, _, completed_dt in terminal_jobs:
            if completed_dt < cutoff:
                self._remove_job_locked(job_id)

        # Recompute and enforce max entries.
        terminal_jobs = []
        for job_id, job in self._state["jobs"].items():
            if job.get("status") in TERMINAL_STATUSES:
                completed_at = job.get("completed_at") or job.get("updated_at") or job.get("created_at")
                try:
                    completed_dt = datetime.fromisoformat(completed_at)
                except Exception:
                    completed_dt = datetime.now(timezone.utc)
                terminal_jobs.append((job_id, completed_dt))
        terminal_jobs.sort(key=lambda item: item[1], reverse=True)
        for job_id, _ in terminal_jobs[max_entries:]:
            self._remove_job_locked(job_id)

    def _remove_job_locked(self, job_id: str) -> None:
        if job_id in self._state["jobs"]:
            del self._state["jobs"][job_id]
        if job_id in self._state["queue"]:
            self._state["queue"].remove(job_id)
