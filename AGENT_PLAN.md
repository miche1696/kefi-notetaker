# Agent Sidebar + Project-Wide LLM Edits — Plan

## Scope Summary
- Project scope = the opened folder ("All notes"), like Cursor/Codex/Claude.
- Changes are never auto-applied: diffs must be reviewed and accepted/rejected.
- Agent can request additional context via tools (search/read/list).
- Multi-step is the long-term goal.
- Agent sidebar keeps context rows between requests (chat mode).
- Background jobs (non-blocking UI).

## Decisions (Confirmed)
- File scope: search all files and allow edits to all files in the notes project root.
- Apply granularity: per hunk (no file-only approvals).
- Job persistence: in-memory.
- Multi-step UX: agent can ask mid-run questions via a clarification tool.
- Permission model: agent may edit any file in project root.
- Tool calls: allow multiple tool calls per job with a configurable max limit.
- Edits: support replace/insert/delete; include expected_hash for safety.
- Accept/reject behavior: apply changes immediately; reject reverts to original.
- Conflicts: if file changed since diff generation, reject apply and re-run.
- Polling: 2s interval.
- Events: stream incremental events and trace them.

## Complexity (Honest)
This is a medium-to-large change. It’s doable with the current structure, but it’s not an extension of the selection-based `Modify`. It’s a new agent subsystem with:
- multi-file edit proposals
- diff review UI
- safe apply
- session persistence
- tool-driven retrieval
- background jobs

## High-Level Architecture

### 1) Agent Session + Context Store
A persistent session object storing:
- chat history
- pinned context rows
- tool calls + results
- proposed edits + diff state

### 2) Agent API Layer (New Endpoints)
Recommended minimal endpoints:
- POST /api/agent/sessions -> create session
- GET /api/agent/sessions/<id> -> load session state
- POST /api/agent/run -> start background job
- GET /api/agent/jobs/<id> -> job progress + results
- POST /api/agent/apply -> apply accepted edits

### 3) Retrieval + Tools (Agent-Requested Context)
Start simple:
- search_project(query, glob, limit)
- read_file(path, start_line, end_line, max_bytes)
- list_files(prefix, glob)
- clarify_user(question)

The agent calls tools; backend executes and feeds results back into the agent loop.

### 4) Structured Edits + Diff Review
LLM returns structured edits (not just raw text):
- file_path
- operation (replace/insert/delete)
- start_line/end_line (or anchor)
- new_text
- optional rationale

Backend generates diffs per file; frontend renders hunks for accept/reject.

### 5) Background Jobs
- run returns job id
- UI polls for progress and final proposal

## Recommended MVP Path

### Phase 1 — Single-shot agent, manual context rows
- Sidebar to add context rows from selection or file
- Agent call returns edit list
- Diff UI with accept/reject
- Apply accepted hunks

### Phase 2 — Tool-assisted retrieval
- Agent can request search/read/list tools
- Tool results fed back into agent
- Single-shot edit proposal still OK

### Phase 3 — Multi-step behavior
- Agent can plan, ask, then edit
- Session keeps chat state
- Clarification tool for mid-run questions
- Optional “confirm before edits” step

### Phase 4 — Scalability
- Add indexing/embeddings if project grows
- Persist sessions/jobs in SQLite or small DB

## Retrieval Guidance (Pragmatic)
Typical pipeline:
- lexical search first (fast, simple)
- targeted file reads
- embeddings later if needed

For now:
- use rg/Python search across project root
- return snippets with file + line range
- allow agent to request full file read

## Edit Format Recommendation
Prefer line-based edits initially:
- easier to apply and review
- better diff UX

Character-level edits can come later if needed.

## Implications in This Codebase

Frontend:
- new agent sidebar component + styles
- context row state/actions
- job polling UI
- diff viewer with accept/reject
- apply endpoint wiring

Backend:
- agent orchestration service
- tool execution (search/read/list)
- diff generation + safe apply
- session/job storage

LLM:
- new OpenAIClient.run_agent with strict output schema
- tool-call loop support

## Next Steps (After Reopen)
1) Expand API design with request/response schemas for sessions, jobs, apply, and tool calls.
2) Define the edit schema and diff representation for per-hunk accept/reject.
3) Map backend services and new modules needed (agent service, tool runner, diff/apply).
4) Sketch frontend data flow and UI components for the agent sidebar and diff review.
5) Draft an MVP implementation plan (file-by-file changes) with milestones.

## Concrete Spec v0 (Resolved)

### 1) Functional Defaults (Configurable)
- `max_tool_calls_per_job`: `12`
- `max_search_results_default`: `20`
- `max_search_results_cap`: `50`
- `max_search_snippet_lines`: `20`
- `max_read_bytes_default`: `65536` (64 KB)
- `max_read_lines_default`: `800`
- `poll_interval_ms`: `2000`

Notes:
- Limits are common baseline defaults for interactive agents.
- Keep all limits configurable via backend config/env.

### 2) Scope and File Rules
- Project scope is the notes project root shown by the app.
- Search scope: all files under project root, excluding `.git/` and hidden system files.
- Edit scope: all files under project root.
- For safety, writes are allowed only to UTF-8 decodable text files.

### 3) Session and Job Model
`AgentSession` (in-memory):
- `id`
- `created_at`
- `updated_at`
- `status` (`active`, `archived`)
- `chat` (messages and tool summaries)
- `context_rows` (manually added/pinned context blocks)
- `last_job_id`
- `pending_review` (current review state, if any)

`AgentJob` (in-memory):
- `id`
- `session_id`
- `status` (`queued`, `running`, `waiting_for_user`, `awaiting_review`, `completed`, `failed`)
- `created_at`
- `started_at`
- `finished_at`
- `cursor` (monotonic event index)
- `events` (append-only event log)
- `proposed_edits`
- `diff_bundle`
- `error` (if failed)

### 4) API Contract v0

#### `POST /api/agent/sessions`
Creates a new session.

Response:
```json
{
  "session_id": "sess_123",
  "status": "active",
  "created_at": "2026-02-05T12:00:00Z"
}
```

#### `GET /api/agent/sessions/<session_id>`
Loads session state.

#### `POST /api/agent/run`
Starts a background job.

Request:
```json
{
  "session_id": "sess_123",
  "instruction": "Refactor these notes into sections",
  "context_rows": [
    {
      "id": "ctx_1",
      "kind": "selection",
      "file_path": "notes/meeting.md",
      "start_line": 10,
      "end_line": 40,
      "content": "..."
    }
  ],
  "tool_config": {
    "max_tool_calls": 12
  }
}
```

Response:
```json
{
  "job_id": "job_456",
  "status": "queued"
}
```

#### `GET /api/agent/jobs/<job_id>/events?cursor=<n>`
Returns incremental events after the provided cursor.

Response:
```json
{
  "job_id": "job_456",
  "status": "running",
  "next_cursor": 24,
  "events": [
    {
      "cursor": 23,
      "type": "tool.call.completed",
      "ts": "2026-02-05T12:00:10Z",
      "data": {
        "tool": "search_project",
        "result_count": 12
      }
    }
  ]
}
```

#### `POST /api/agent/jobs/<job_id>/clarify`
Replies to a clarification question.

Request:
```json
{
  "question_id": "q_1",
  "answer": "Use concise headings only"
}
```

#### `GET /api/agent/jobs/<job_id>`
Returns current job snapshot, including `diff_bundle` when status is `awaiting_review`.

#### `POST /api/agent/apply`
Applies accepted hunks and rejects others.

Request:
```json
{
  "session_id": "sess_123",
  "job_id": "job_456",
  "accepted_hunk_ids": ["h_1", "h_2", "h_5"]
}
```

Response:
```json
{
  "status": "completed",
  "applied_files": [
    {
      "file_path": "notes/meeting.md",
      "applied_hunks": 2,
      "rejected_hunks": 1
    }
  ]
}
```

### 5) Tool Contracts v0

#### `search_project`
Input:
```json
{
  "query": "onboarding checklist",
  "glob": "**/*",
  "limit": 20
}
```

Output:
```json
{
  "results": [
    {
      "file_path": "notes/team/onboarding.md",
      "start_line": 14,
      "end_line": 22,
      "snippet": "..."
    }
  ]
}
```

#### `read_file`
Input:
```json
{
  "file_path": "notes/team/onboarding.md",
  "start_line": 1,
  "end_line": 200,
  "max_bytes": 65536
}
```

Output:
```json
{
  "file_path": "notes/team/onboarding.md",
  "content": "...",
  "start_line": 1,
  "end_line": 200
}
```

#### `list_files`
Input:
```json
{
  "prefix": "notes/team",
  "glob": "**/*"
}
```

Output:
```json
{
  "files": [
    "notes/team/onboarding.md",
    "notes/team/weekly.md"
  ]
}
```

#### `clarify_user`
Input:
```json
{
  "question": "Do you want terse or detailed section summaries?"
}
```

Behavior:
- Job status changes to `waiting_for_user`.
- Resume when `POST /api/agent/jobs/<job_id>/clarify` is received.

### 6) Edit and Diff Schema v0

`ProposedEdit`:
```json
{
  "edit_id": "e_1",
  "file_path": "notes/team/onboarding.md",
  "operation": "replace",
  "start_line": 14,
  "end_line": 22,
  "new_text": "...",
  "expected_hash": "sha256:...",
  "rationale": "Split long paragraph into checklist bullets"
}
```

Operation semantics:
- `replace`: replace inclusive line range `[start_line, end_line]` with `new_text`.
- `insert`: insert `new_text` before `start_line`; `end_line` is optional.
- `delete`: delete inclusive line range `[start_line, end_line]`; `new_text` must be empty.

`DiffBundle`:
```json
{
  "job_id": "job_456",
  "files": [
    {
      "file_path": "notes/team/onboarding.md",
      "base_file_hash": "sha256:...",
      "hunks": [
        {
          "hunk_id": "h_1",
          "patch": "@@ -14,9 +14,11 @@ ...",
          "accepted": null,
          "edit_ids": ["e_1"]
        }
      ]
    }
  ]
}
```

Hunk sizing rule:
- Ask the LLM for focused hunks.
- Backend additionally splits oversized hunks by edit boundaries when possible.

### 7) Review and Apply Behavior v0
- After job completion, backend returns a `diff_bundle`.
- Frontend immediately shows staged content (new version) for review.
- Per-hunk controls: `accept`, `reject`; convenience action: `accept_all_file`.
- Reject rewinds that hunk to original content.
- While review is active, pause autosave on files with pending hunks.
- Final apply writes only accepted hunks to disk.

### 8) Safety Checks v0
- Per-edit precheck: verify the target lines still match `expected_hash` before composing hunks.
- Apply-time precheck: verify `base_file_hash` equals current file hash on disk.
- On hash mismatch: reject apply with `conflict` error and require re-run.

This implements the required test: "the line I want to modify is still there" before changing content.

### 9) Event Streaming and Tracing v0
Event stream is polled every 2s via cursor-based endpoint.

Core event types:
- `job.started`
- `tool.call.requested`
- `tool.call.completed`
- `clarification.requested`
- `clarification.received`
- `edits.proposed`
- `diff.generated`
- `review.updated`
- `apply.started`
- `apply.completed`
- `job.failed`

Trace all major events with payload summaries for debugging and postmortem analysis.

### 10) Implementation Sequence
1) Backend models and in-memory stores for sessions/jobs/events.
2) Tool runner (`search_project`, `read_file`, `list_files`, `clarify_user`) with limits.
3) Agent loop with configurable tool-call budget and structured edit output.
4) Diff generation, hunk metadata, safety checks (`expected_hash`, `base_file_hash`).
5) Apply endpoint (accepted hunks only, conflict handling).
6) Frontend agent sidebar state, 2s event polling, clarification UI, diff UI, per-hunk actions.
7) Trace instrumentation for stream/events/tool calls/apply.

## Next Steps (Execution-Ready)
1) Convert this spec into backend API stubs and schemas first.
2) Implement event stream and tool runner before wiring frontend.
3) Build diff review UI and apply workflow with reject rewind behavior.
4) Add smoke tests for conflict paths and per-hunk accept/reject persistence.

## Provider Architecture v0 (Local + Remote + Hybrid)

### 11) Provider Abstraction (Required Early)
Add a provider interface so model backend can switch without changing tools, diffs, or UI.

`AgentProvider` contract:
- `run_step(state, messages, tool_results, config) -> ProviderStepResult`
- `stream_step(...)` optional
- `supports_native_tools() -> bool`
- `provider_name() -> str`

`ProviderStepResult` normalized fields:
- `assistant_message`
- `tool_calls[]` (canonical format)
- `proposed_edits[]` (canonical `ProposedEdit`)
- `stop_reason` (`needs_tools`, `needs_clarification`, `proposed_edits`, `done`, `error`)
- `raw_usage` (tokens, latency, model id when available)

Keep all provider-specific payloads inside adapters only.

### 12) Routing Modes and Settings
Expose runtime setting:
- `agent_mode`: `local`, `remote`, `hybrid_auto`

Hybrid policy defaults:
- Start with local provider.
- Fallback to remote if one of these triggers:
- tool-call budget exhausted without usable edits
- invalid edit schema repeated `N` times
- context window limit reached
- confidence/validation gate fails

Configurable routing controls:
- `hybrid_max_local_attempts`
- `hybrid_remote_on_schema_fail`
- `hybrid_remote_on_context_overflow`
- `hybrid_remote_on_timeout_ms`

### 13) Tools Stay Local and Stable
Tools remain backend-owned and identical across providers:
- `search_project`
- `read_file`
- `list_files`
- `clarify_user`

This preserves retrieval ownership and traceability independent of model backend.

### 14) Normalized Tool Call Protocol
Canonical tool call object:
```json
{
  "tool_call_id": "tc_1",
  "name": "search_project",
  "arguments": {
    "query": "onboarding checklist",
    "glob": "**/*",
    "limit": 20
  }
}
```

Canonical tool result object:
```json
{
  "tool_call_id": "tc_1",
  "name": "search_project",
  "ok": true,
  "result": {
    "results": []
  },
  "error": null
}
```

Adapters must map provider-native tool syntax to this canonical shape.

### 15) Provider-Specific Differences (Handled in Adapter)
- tool-calling API format
- streaming event format
- JSON/schema reliability
- context length and truncation behavior
- usage/cost metadata shape

No provider-specific branching in core orchestration code.

### 16) Eval Plan (Fast Shipping + Deep Learning)
Create an eval set from real tasks and traces:
- 30 to 50 representative tasks
- each task includes: prompt, initial files, expected outcome checks
- include conflict/retry cases and clarification-required cases

Primary metrics:
- task success rate
- accepted-hunk ratio
- conflict rate
- tool calls per successful task
- p50/p95 latency
- cost per task (remote only)
- clarification rate

Comparison matrix:
- `remote` baseline first (golden traces)
- `local` run against same tasks
- `hybrid_auto` run against same tasks

### 17) Delivery Strategy (Recommended)
1) Implement provider abstraction + remote adapter first.
2) Stabilize full flow end-to-end and collect golden traces.
3) Implement local adapter and run the same eval suite.
4) Turn on `hybrid_auto` with explicit fallback triggers.
5) Optimize local model prompts, schemas, and limits based on eval failures.

### 18) Guardrails
- Always validate provider output against canonical schemas before use.
- Never apply edits directly from provider output without hash checks.
- Keep an option to disable provider fallback for strict local-only experiments.
- Trace provider selection and fallback reason for every job.

## Spec Decisions v1 (Locked For Implementation)

### 19) Review State Model (Cursor-like)
- Disable autosave globally; use explicit save (`Ctrl+S`) and dirty-close prompts.
- On agent proposal, apply proposed hunks to the editor working buffer immediately.
- Keep `base_snapshot` (file content before agent run), `working_buffer` (live view), and `change_log` (ordered changes).
- `change_log` includes both agent hunks and user edits:
- `id`, `origin` (`agent` or `user`), `forward_patch`, `reverse_patch`, `status`, `file_hash_before`.
- Accept/reject updates status and recomputes the working buffer by replaying non-rejected changes from `base_snapshot`.
- Reject restores original content for that hunk via `reverse_patch`.
- `Ctrl+Z` remains editor-native; integration maps undo/redo to change-log status transitions.

### 20) Manual Edits During Pending Review
- Manual edits create new `origin=user` hunks and stay inside the same accept/reject system.
- This keeps a single live-diff mechanism for all modifications while review is open.

### 21) Clarification and Retry
- Clarification model: one pending question at a time, no timeout.
- `skip clarification` sends explicit answer token: `no_user_answer`.
- Schema retry policy: `max_schema_retries = 5`.

### 22) Conflict Ownership and Behavior
- Backend owns conflict detection and rerun orchestration.
- Frontend only renders conflict/rerun events and statuses.
- Hash mismatch (`expected_hash` or `base_file_hash`) triggers conflict path and rerun requirement.

### 23) Hunk Sizing Guard (v0 Defaults)
- `max_hunk_lines = 80`
- `max_hunk_bytes = 8192`
- Split order:
- by edit boundaries
- then blank-line boundaries
- then paragraph/sentence boundaries
- If still oversized: mark `oversized_hunk` and require manual split or accept-as-one.

### 24) Encoding and Line Endings
- Text files only, UTF-8 decode required.
- Preserve file-native line endings (`LF` or `CRLF`) when writing.
- Reject binary/non-text targets.

### 25) In-Memory Lifecycle Baseline (v0)
- Keep all `active`, `waiting_for_user`, and `pending_review` entities.
- Purge only `completed` and `failed` entities.
- Baseline limits:
- `max_sessions = 25`
- `max_jobs_per_session = 40`
- `max_events_per_job = 3000`
- `completed_ttl_hours = 72`
- GC trigger points:
- server startup
- after job creation

### 26) Remote-First Scope (v0)
- Run `remote` mode only in initial implementation.
- Keep provider abstraction in place.
- Defer `hybrid_auto` fallback thresholds to TODO after baseline evals.

### 27) Checkpointing and Rollback (New Requirement)
Each agent run creates a checkpoint with:
- `checkpoint_id`
- `session_id`
- `job_id`
- `created_at`
- `affected_files[]`
- per-file `base_snapshot_hash`
- per-file list of hunk ids and reverse patches

Checkpoint semantics:
- A checkpoint is the file state before that agent run (`back_then_files_before_agent_modification`).
- Preserve run artifacts so user can reopen and inspect later.
- Provide 3-way compare view:
- `current_file` (current working state)
- `checkpoint_base` (pre-run state)
- `agent_proposed` (post-run proposed state)

Rollback operations:
- `rollback_all_to_checkpoint`: revert all hunks from that checkpoint.
- `rollback_selected_hunks`: revert only selected hunks from that checkpoint.
- Rollback updates working buffer first; persistence still requires explicit save.

Rollback modes:
- `hard rollback` (enabled): revert every change after the checkpoint, including later manual edits.
- `scoped rollback` (enabled): revert only selected hunks from the checkpoint/run.

Hard rollback semantics (v0):
- Reset each affected file working buffer to `checkpoint_base`.
- Drop/truncate change-log entries created after the checkpoint for those files.
- Keep rollback as an explicit user action with confirmation prompt.
- Persist to disk only on explicit save.

Rollback safety:
- Revert by applying stored `reverse_patch` hunks.
- For `scoped rollback`, preserve unrelated newer edits when patches do not overlap.
- For `hard rollback`, do not preserve newer edits after checkpoint on affected files.
- If overlap/conflict occurs during scoped rollback, mark conflict and require manual resolution for affected hunks.

Checkpoint API (v0 draft):
- `GET /api/agent/checkpoints/<checkpoint_id>`
- `GET /api/agent/checkpoints/<checkpoint_id>/diff3?file_path=...`
- `POST /api/agent/checkpoints/<checkpoint_id>/rollback`

Rollback request draft:
```json
{
  "mode": "hard_all",
  "hunk_ids": []
}
```

Mode values:
- `hard_all`: hard rollback to checkpoint base for affected files.
- `scoped_selected`: rollback only listed hunk ids.

Rollback events:
- `checkpoint.created`
- `checkpoint.rollback.started`
- `checkpoint.rollback.completed`
- `checkpoint.rollback.failed`

## TODO (Deferred Decisions)
- `hybrid_auto` fallback thresholds (activate after remote-first baseline and eval data).
- advanced GC policy tuning (after real memory/latency profiling).
