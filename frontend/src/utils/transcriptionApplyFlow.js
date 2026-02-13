export const applyCompletedJobToEditor = async ({
  payload,
  currentNoteId,
  replaceMarkerInCurrentNote,
  getNoteById,
  isMarkdown,
  markdownEditor,
  traceEvent,
  setError,
}) => {
  if (!payload || payload.type !== 'status-change') {
    return { handled: false, reason: 'ignored_payload' };
  }

  if (!['completed', 'failed'].includes(payload.status)) {
    return { handled: false, reason: 'ignored_payload' };
  }

  const job = payload.job;
  if (!job || job.note_id !== currentNoteId) {
    return { handled: false, reason: 'ignored_note' };
  }

  const refreshFromBackend = async (eventName) => {
    const latest = await getNoteById(job.note_id);
    traceEvent(eventName, {
      job_id: job.id,
      note_id: job.note_id,
      revision: latest?.revision || null,
    });

    if (isMarkdown && markdownEditor && latest?.content !== undefined) {
      markdownEditor.syncExternalContent(latest.content);
    }

    return latest;
  };

  if (payload.status === 'failed') {
    if (job.last_result?.status !== 'applied') {
      traceEvent('tx.editor.apply.skip.backend_status', {
        job_id: job.id,
        note_id: job.note_id,
        backend_status: job.last_result?.status || null,
      });
      return { handled: false, reason: 'backend_not_applied' };
    }

    try {
      const latest = await refreshFromBackend('tx.editor.apply.failed.fallback.fetch');
      return { handled: true, mode: 'failed_fallback', latest };
    } catch (error) {
      traceEvent('tx.editor.apply.error', {
        job_id: job?.id || null,
        note_id: job?.note_id || null,
        message: error?.message || 'unknown',
      });
      setError('Failed to apply transcription result in editor.');
      return { handled: false, reason: 'error', error };
    }
  }

  if (!job.marker_token || !job.transcript_text) {
    return { handled: false, reason: 'ignored_missing_data' };
  }

  traceEvent('tx.editor.apply.attempt', {
    job_id: job.id,
    note_id: job.note_id,
    marker_token: job.marker_token,
  });

  try {
    const applied = await replaceMarkerInCurrentNote(job.marker_token, job.transcript_text, {
      persist: false,
    });
    if (applied) {
      traceEvent('tx.editor.apply.local.success', {
        job_id: job.id,
        note_id: job.note_id,
      });
      return { handled: true, mode: 'local' };
    }

    traceEvent('tx.editor.apply.local.miss', {
      job_id: job.id,
      note_id: job.note_id,
    });

    if (job.last_result?.status !== 'applied') {
      traceEvent('tx.editor.apply.skip.backend_status', {
        job_id: job.id,
        note_id: job.note_id,
        backend_status: job.last_result?.status || null,
      });
      return { handled: false, reason: 'backend_not_applied' };
    }

    const latest = await refreshFromBackend('tx.editor.apply.fallback.fetch');
    return { handled: true, mode: 'fallback', latest };
  } catch (error) {
    traceEvent('tx.editor.apply.error', {
      job_id: job?.id || null,
      note_id: job?.note_id || null,
      message: error?.message || 'unknown',
    });
    setError('Failed to apply transcription result in editor.');
    return { handled: false, reason: 'error', error };
  }
};
