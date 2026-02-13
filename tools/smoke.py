#!/usr/bin/env python3
import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def request_json(method, url, payload=None, timeout=10):
    data = None
    headers = {"Content-Type": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
        if not body:
            return None
    return json.loads(body)


def load_trace(path: Path, min_ts=None):
    if not path.exists():
        return []
    entries = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                if min_ts is not None:
                    try:
                        if float(entry.get("ts", 0)) < float(min_ts):
                            continue
                    except (TypeError, ValueError):
                        pass
                entries.append(entry)
            except json.JSONDecodeError:
                continue
    return entries


def has_event(entries, event, needle=None):
    for entry in entries:
        if entry.get("event") != event:
            continue
        if needle and needle not in json.dumps(entry, ensure_ascii=False):
            continue
        return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Minimal smoke test for Kefi backend trace + notes APIs")
    parser.add_argument("--base", default="http://localhost:5001", help="Backend base URL")
    parser.add_argument("--trace-backend", default="backend/trace.jsonl", help="Backend trace path")
    parser.add_argument("--trace-frontend", default="frontend/trace.jsonl", help="Frontend trace path")
    args = parser.parse_args()

    base = args.base.rstrip("/")
    start_ts = time.time()
    health = request_json("GET", f"{base}/api/health")
    if health.get("status") != "healthy":
        print("Health check failed", file=sys.stderr)
        return 1

    # Basic settings + transcription API checks
    settings = request_json("GET", f"{base}/api/settings")
    if "transcription" not in settings:
        print("Settings API failed", file=sys.stderr)
        return 1

    formats = request_json("GET", f"{base}/api/transcription/formats")
    if ".opus" not in (formats.get("formats") or []):
        print("Transcription formats missing .opus", file=sys.stderr)
        return 1

    jobs = request_json("GET", f"{base}/api/transcription/jobs")
    if not isinstance(jobs.get("jobs"), list):
        print("Transcription jobs list failed", file=sys.stderr)
        return 1

    # Create a note
    stamp = int(time.time())
    name = f"smoke_test_{stamp}"
    folder_name = f"smoke_folder_{stamp}"
    created = request_json(
        "POST",
        f"{base}/api/notes",
        {
            "name": name,
            "folder": "",
            "content": "Smoke test content",
            "file_type": "md",
        },
    )
    note_path = created.get("path")
    note_id = created.get("id")
    if not note_path:
        print("Create note failed", file=sys.stderr)
        return 1
    if not note_id:
        print("Create note did not return id", file=sys.stderr)
        return 1

    # Fetch note
    encoded = urllib.parse.quote(note_path, safe="/")
    fetched = request_json("GET", f"{base}/api/notes/{encoded}")
    if fetched.get("content") != "Smoke test content":
        print("Fetch note failed", file=sys.stderr)
        return 1

    # Fetch by stable id
    fetched_by_id = request_json("GET", f"{base}/api/notes/id/{urllib.parse.quote(note_id, safe='')}")
    if fetched_by_id.get("id") != note_id:
        print("Get note by id failed", file=sys.stderr)
        return 1

    # Update note
    marker = "[[tx:smoke-marker:Transcription ongoing...]]"
    updated = request_json(
        "PUT",
        f"{base}/api/notes/{encoded}",
        {
            "content": f"Updated smoke content {marker}",
            "expected_revision": fetched.get("revision"),
        },
    )

    # Replace marker by id
    replaced = request_json(
        "PATCH",
        f"{base}/api/notes/id/{urllib.parse.quote(note_id, safe='')}/replace-marker",
        {
            "marker_token": marker,
            "replacement_text": "transcribed smoke",
        },
    )
    if replaced.get("status") != "applied":
        print("Replace marker failed", file=sys.stderr)
        return 1

    fetched = request_json("GET", f"{base}/api/notes/{encoded}")
    content = fetched.get("content", "")
    if marker in content or "transcribed smoke" not in content:
        print("Update note failed", file=sys.stderr)
        return 1

    # Replace marker should also support markdown-escaped variants.
    escaped_marker = r"\[\[tx:smoke-marker-escaped:Transcription ongoing...]]"
    marker_unescaped = "[[tx:smoke-marker-escaped:Transcription ongoing...]]"
    updated = request_json(
        "PUT",
        f"{base}/api/notes/{encoded}",
        {
            "content": f"{content}\n\n{escaped_marker}",
            "expected_revision": fetched.get("revision"),
        },
    )
    replaced_escaped = request_json(
        "PATCH",
        f"{base}/api/notes/id/{urllib.parse.quote(note_id, safe='')}/replace-marker",
        {
            "marker_token": marker_unescaped,
            "replacement_text": "transcribed escaped smoke",
        },
    )
    if replaced_escaped.get("status") != "applied":
        print("Replace escaped marker failed", file=sys.stderr)
        return 1
    fetched = request_json("GET", f"{base}/api/notes/{encoded}")
    content = fetched.get("content", "")
    if escaped_marker in content or "transcribed escaped smoke" not in content:
        print("Escaped marker replacement failed", file=sys.stderr)
        return 1

    # Text processing
    processed = request_json(
        "POST",
        f"{base}/api/text/process",
        {
            "operation": "clean-transcription",
            "text": "um so like this is a test",
            "options": {},
        },
    )
    if "processed_text" not in processed:
        print("Text processing failed", file=sys.stderr)
        return 1

    # Folder create
    request_json(
        "POST",
        f"{base}/api/folders",
        {
            "name": folder_name,
            "parent": "",
        },
    )

    # Move note into folder
    moved = request_json(
        "PATCH",
        f"{base}/api/notes/{encoded}/move",
        {"target_folder": folder_name},
    )
    note_path = moved.get("path") or note_path
    encoded = urllib.parse.quote(note_path, safe="/")

    # Rename note
    renamed = request_json(
        "PATCH",
        f"{base}/api/notes/{encoded}/rename",
        {"new_name": f"{name}_renamed"},
    )
    note_path = renamed.get("path") or note_path
    encoded = urllib.parse.quote(note_path, safe="/")

    # Rename folder
    renamed_folder = f"{folder_name}_renamed"
    request_json(
        "PATCH",
        f"{base}/api/folders/{urllib.parse.quote(folder_name, safe='/')}/rename",
        {"new_name": renamed_folder},
    )
    if note_path.startswith(f"{folder_name}/"):
        note_path = note_path.replace(f"{folder_name}/", f"{renamed_folder}/", 1)

    # Client trace ingest
    request_json(
        "POST",
        f"{base}/api/trace/client",
        {"event": "smoke.test", "data": {"note": note_path}},
    )

    # Delete note (API expects path without extension)
    if note_path.endswith(".md"):
        note_path = note_path[:-3]
    encoded = urllib.parse.quote(note_path, safe="/")
    request_json("DELETE", f"{base}/api/notes/{encoded}")

    # Delete folder
    request_json(
        "DELETE",
        f"{base}/api/folders/{urllib.parse.quote(renamed_folder, safe='/')}?recursive=true",
    )

    # Trace verification
    repo_root = Path(__file__).resolve().parents[1]
    backend_trace = load_trace(repo_root / args.trace_backend, min_ts=start_ts)
    frontend_trace = load_trace(repo_root / args.trace_frontend, min_ts=start_ts)

    required_backend_events = [
        ("api.response", None),
        ("file.write", name),
        ("file.move", name),
        ("file.rename", name),
        ("file.delete", name),
        ("folder.create", folder_name),
        ("folder.rename", renamed_folder),
        ("folder.delete", renamed_folder),
        ("text.process", "clean-transcription"),
        ("note.marker.replaced", "smoke-marker"),
        ("note.marker.replaced", "smoke-marker-escaped"),
    ]

    for event, needle in required_backend_events:
        if not has_event(backend_trace, event, needle):
            print(f"Missing backend trace event: {event}", file=sys.stderr)
            return 1

    if not has_event(frontend_trace, "smoke.test", "smoke_test_"):
        print("Missing frontend trace event: smoke.test", file=sys.stderr)
        return 1

    print("Smoke test OK")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.URLError as exc:
        print(f"Request failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
