import assert from 'node:assert/strict';
import { applyCompletedJobToEditor } from '../src/utils/transcriptionApplyFlow.js';

const basePayload = {
  type: 'status-change',
  status: 'completed',
  job: {
    id: 'job-1',
    note_id: 'note-1',
    marker_token: '[[tx:abc:Transcription ongoing...]]',
    transcript_text: 'transcribed text',
    last_result: { status: 'applied' },
  },
};

const createTraceCollector = () => {
  const events = [];
  return {
    events,
    traceEvent: (event, data) => {
      events.push({ event, data });
    },
  };
};

{
  const trace = createTraceCollector();
  let fetched = false;

  const result = await applyCompletedJobToEditor({
    payload: basePayload,
    currentNoteId: 'note-1',
    replaceMarkerInCurrentNote: async () => true,
    getNoteById: async () => {
      fetched = true;
      return null;
    },
    isMarkdown: true,
    markdownEditor: { syncExternalContent: () => {} },
    traceEvent: trace.traceEvent,
    setError: () => {},
  });

  assert.equal(result.handled, true);
  assert.equal(result.mode, 'local');
  assert.equal(fetched, false, 'local success must not fallback-fetch');
  assert.deepEqual(
    trace.events.map((entry) => entry.event),
    ['tx.editor.apply.attempt', 'tx.editor.apply.local.success']
  );
}

{
  const trace = createTraceCollector();
  const synced = [];
  let fetchedCount = 0;

  const result = await applyCompletedJobToEditor({
    payload: basePayload,
    currentNoteId: 'note-1',
    replaceMarkerInCurrentNote: async () => false,
    getNoteById: async () => {
      fetchedCount += 1;
      return { revision: 23, content: 'fresh content from backend' };
    },
    isMarkdown: true,
    markdownEditor: {
      syncExternalContent: (value) => synced.push(value),
    },
    traceEvent: trace.traceEvent,
    setError: () => {},
  });

  assert.equal(result.handled, true);
  assert.equal(result.mode, 'fallback');
  assert.equal(fetchedCount, 1, 'fallback should fetch note once');
  assert.deepEqual(synced, ['fresh content from backend']);
  assert.deepEqual(
    trace.events.map((entry) => entry.event),
    ['tx.editor.apply.attempt', 'tx.editor.apply.local.miss', 'tx.editor.apply.fallback.fetch']
  );
}

{
  const trace = createTraceCollector();
  const synced = [];
  let fetchedCount = 0;

  const result = await applyCompletedJobToEditor({
    payload: {
      ...basePayload,
      status: 'failed',
      job: {
        ...basePayload.job,
        transcript_text: null,
        last_result: { status: 'applied' },
      },
    },
    currentNoteId: 'note-1',
    replaceMarkerInCurrentNote: async () => {
      throw new Error('failed flow should not call local replace');
    },
    getNoteById: async () => {
      fetchedCount += 1;
      return { revision: 99, content: 'failed marker replaced server-side' };
    },
    isMarkdown: true,
    markdownEditor: {
      syncExternalContent: (value) => synced.push(value),
    },
    traceEvent: trace.traceEvent,
    setError: () => {},
  });

  assert.equal(result.handled, true);
  assert.equal(result.mode, 'failed_fallback');
  assert.equal(fetchedCount, 1, 'failed applied marker should refresh from backend once');
  assert.deepEqual(synced, ['failed marker replaced server-side']);
  assert.deepEqual(
    trace.events.map((entry) => entry.event),
    ['tx.editor.apply.failed.fallback.fetch']
  );
}

{
  const trace = createTraceCollector();
  let fetched = false;

  const result = await applyCompletedJobToEditor({
    payload: {
      ...basePayload,
      job: {
        ...basePayload.job,
        last_result: { status: 'marker_missing' },
      },
    },
    currentNoteId: 'note-1',
    replaceMarkerInCurrentNote: async () => false,
    getNoteById: async () => {
      fetched = true;
      return null;
    },
    isMarkdown: true,
    markdownEditor: { syncExternalContent: () => {} },
    traceEvent: trace.traceEvent,
    setError: () => {},
  });

  assert.equal(result.handled, false);
  assert.equal(result.reason, 'backend_not_applied');
  assert.equal(fetched, false, 'non-applied backend status should skip fallback fetch');
  assert.deepEqual(
    trace.events.map((entry) => entry.event),
    ['tx.editor.apply.attempt', 'tx.editor.apply.local.miss', 'tx.editor.apply.skip.backend_status']
  );
}

{
  const trace = createTraceCollector();
  let fetched = false;

  const result = await applyCompletedJobToEditor({
    payload: {
      ...basePayload,
      status: 'failed',
      job: {
        ...basePayload.job,
        transcript_text: null,
        last_result: { status: 'marker_missing' },
      },
    },
    currentNoteId: 'note-1',
    replaceMarkerInCurrentNote: async () => true,
    getNoteById: async () => {
      fetched = true;
      return null;
    },
    isMarkdown: true,
    markdownEditor: { syncExternalContent: () => {} },
    traceEvent: trace.traceEvent,
    setError: () => {},
  });

  assert.equal(result.handled, false);
  assert.equal(result.reason, 'backend_not_applied');
  assert.equal(fetched, false);
  assert.deepEqual(
    trace.events.map((entry) => entry.event),
    ['tx.editor.apply.skip.backend_status']
  );
}

{
  const trace = createTraceCollector();
  const errors = [];

  const result = await applyCompletedJobToEditor({
    payload: basePayload,
    currentNoteId: 'note-1',
    replaceMarkerInCurrentNote: async () => {
      throw new Error('forced failure');
    },
    getNoteById: async () => null,
    isMarkdown: true,
    markdownEditor: { syncExternalContent: () => {} },
    traceEvent: trace.traceEvent,
    setError: (message) => errors.push(message),
  });

  assert.equal(result.handled, false);
  assert.equal(result.reason, 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0], 'Failed to apply transcription result in editor.');
  assert.deepEqual(
    trace.events.map((entry) => entry.event),
    ['tx.editor.apply.attempt', 'tx.editor.apply.error']
  );
}

{
  const trace = createTraceCollector();
  const result = await applyCompletedJobToEditor({
    payload: basePayload,
    currentNoteId: 'different-note',
    replaceMarkerInCurrentNote: async () => true,
    getNoteById: async () => null,
    isMarkdown: true,
    markdownEditor: { syncExternalContent: () => {} },
    traceEvent: trace.traceEvent,
    setError: () => {},
  });

  assert.equal(result.handled, false);
  assert.equal(result.reason, 'ignored_note');
  assert.equal(trace.events.length, 0);
}

console.log('transcription apply flow tests OK');
