import React, { useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useNotes } from '../../context/NotesContext';
import { useTranscriptionJobs } from '../../context/TranscriptionJobsContext';
import './TranscriptionJobsPanel.css';

const statusLabel = {
  queued: 'Queued',
  running: 'Running',
  cancel_requested: 'Cancelling',
  interrupted: 'Interrupted',
  completed: 'Completed',
  failed: 'Failed',
  orphaned: 'Orphaned',
  cancelled: 'Cancelled',
};

const formatTimestamp = (value) => {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const TranscriptionJobsPanel = () => {
  const { setError } = useApp();
  const { getNoteById } = useNotes();
  const {
    jobs,
    isPanelOpen,
    togglePanel,
    closePanel,
    cancelJob,
    resumeJob,
    resumeInterrupted,
    copyTranscript,
    insertJobAtCursor,
  } = useTranscriptionJobs();

  const interruptedCount = useMemo(
    () => jobs.filter((job) => job.status === 'interrupted').length,
    [jobs]
  );

  const handleOpenTarget = async (job) => {
    try {
      if (!job.note_id) return;
      await getNoteById(job.note_id);
    } catch (error) {
      setError(`Cannot open target note: ${error.message}`);
    }
  };

  const handleCopy = async (job) => {
    const ok = await copyTranscript(job.id);
    if (!ok) {
      setError('Cannot copy transcript.');
    }
  };

  const handleInsertAtCursor = async (job) => {
    const ok = await insertJobAtCursor(job.id);
    if (!ok) {
      setError('Cannot insert transcript at cursor. Open a note first.');
    }
  };

  return (
    <>
      <button
        className="tx-history-button"
        onClick={togglePanel}
        title="Transcription history"
        aria-label="Open transcription history"
      >
        ↺
      </button>

      {isPanelOpen && (
        <div className="tx-jobs-panel">
          <div className="tx-jobs-header">
            <strong>Transcription Jobs</strong>
            <div className="tx-jobs-header-actions">
              {interruptedCount > 0 && (
                <button
                  className="tx-mini-button"
                  onClick={() => resumeInterrupted().catch((err) => setError(err.message))}
                >
                  Resume Interrupted
                </button>
              )}
              <button className="tx-close-button" onClick={closePanel} aria-label="Close">
                ×
              </button>
            </div>
          </div>

          <div className="tx-jobs-body">
            {jobs.length === 0 ? (
              <div className="tx-empty">No transcription jobs yet.</div>
            ) : (
              jobs.map((job) => (
                <div key={job.id} className={`tx-job-item status-${job.status}`}>
                  <div className="tx-job-line">
                    <span className="tx-job-status">{statusLabel[job.status] || job.status}</span>
                    <span className="tx-job-time">{formatTimestamp(job.created_at)}</span>
                  </div>
                  <div className="tx-job-note">{job.note_path || 'Deleted note'}</div>
                  <div className="tx-job-meta">
                    {job.source_filename || 'Audio'}
                    {job.duration_ms ? ` • ${job.duration_ms}ms` : ''}
                  </div>
                  {job.error && <div className="tx-job-error">{job.error}</div>}
                  <div className="tx-job-actions">
                    <button
                      className="tx-mini-button"
                      onClick={() => handleOpenTarget(job)}
                      disabled={!job.note_id}
                    >
                      Open
                    </button>
                    <button
                      className="tx-mini-button"
                      onClick={() => handleCopy(job)}
                      disabled={!job.transcript_text}
                    >
                      Copy
                    </button>
                    <button
                      className="tx-mini-button"
                      onClick={() => handleInsertAtCursor(job)}
                      disabled={!job.transcript_text}
                    >
                      Insert
                    </button>
                    {job.can_cancel && (
                      <button
                        className="tx-mini-button"
                        onClick={() => cancelJob(job.id).catch((err) => setError(err.message))}
                      >
                        Cancel
                      </button>
                    )}
                    {job.can_resume && (
                      <button
                        className="tx-mini-button"
                        onClick={() => resumeJob(job.id).catch((err) => setError(err.message))}
                      >
                        Resume
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default TranscriptionJobsPanel;
