import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { transcriptionJobsApi } from '../api/transcriptionJobs';
import { settingsApi } from '../api/settings';
import { traceEvent } from '../api/trace';
import { replaceMarkerInText } from '../utils/transcriptionMarkers';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'orphaned', 'cancelled']);

const TranscriptionJobsContext = createContext(null);

export const useTranscriptionJobs = () => {
  const context = useContext(TranscriptionJobsContext);
  if (!context) {
    throw new Error('useTranscriptionJobs must be used within TranscriptionJobsProvider');
  }
  return context;
};

const sortJobs = (jobs) =>
  [...jobs].sort((a, b) => {
    const left = a.created_at || '';
    const right = b.created_at || '';
    return left < right ? 1 : -1;
  });

export const TranscriptionJobsProvider = ({ children }) => {
  const [jobs, setJobs] = useState([]);
  const [settings, setSettings] = useState(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const listenersRef = useRef(new Set());
  const insertHandlerRef = useRef(null);
  const previousStatusRef = useRef(new Map());

  const emit = useCallback((payload) => {
    listenersRef.current.forEach((listener) => {
      try {
        listener(payload);
      } catch (_) {
        // Event listeners are isolated by design.
      }
    });
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      const response = await settingsApi.get();
      setSettings(response);
      return response;
    } catch (error) {
      return null;
    }
  }, []);

  const refreshJobs = useCallback(async () => {
    try {
      const response = await transcriptionJobsApi.list();
      const next = sortJobs(response.jobs || []);
      setJobs(next);
      return next;
    } catch (error) {
      return [];
    }
  }, []);

  useEffect(() => {
    refreshSettings();
    refreshJobs();
  }, [refreshJobs, refreshSettings]);

  useEffect(() => {
    const hasActiveJobs = jobs.some((job) => !TERMINAL_STATUSES.has(job.status));
    if (!hasActiveJobs) return undefined;

    const timer = setInterval(() => {
      refreshJobs();
    }, 1200);
    return () => clearInterval(timer);
  }, [jobs, refreshJobs]);

  useEffect(() => {
    const previousMap = previousStatusRef.current;
    for (const job of jobs) {
      const previousStatus = previousMap.get(job.id);
      if (previousStatus && previousStatus !== job.status) {
        emit({
          type: 'status-change',
          previousStatus,
          status: job.status,
          job,
        });
      }
      previousMap.set(job.id, job.status);
    }
  }, [jobs, emit]);

  const upsertJob = useCallback((job) => {
    if (!job?.id) return;
    setJobs((prev) => {
      const existingIndex = prev.findIndex((entry) => entry.id === job.id);
      if (existingIndex === -1) {
        return sortJobs([job, ...prev]);
      }
      const next = [...prev];
      next[existingIndex] = { ...next[existingIndex], ...job };
      return sortJobs(next);
    });
  }, []);

  const enqueueAudioJob = useCallback(
    async ({ audioFile, noteId, markerToken, launchSource }) => {
      setIsLoading(true);
      try {
        const job = await transcriptionJobsApi.create({
          audioFile,
          noteId,
          markerToken,
          launchSource,
        });
        upsertJob(job);
        traceEvent('tx.job.created.client', {
          job_id: job.id,
          note_id: noteId,
          launch_source: launchSource,
        });
        return job;
      } finally {
        setIsLoading(false);
      }
    },
    [upsertJob]
  );

  const cancelJob = useCallback(
    async (jobId) => {
      const job = await transcriptionJobsApi.cancel(jobId);
      upsertJob(job);
      return job;
    },
    [upsertJob]
  );

  const resumeJob = useCallback(
    async (jobId) => {
      const job = await transcriptionJobsApi.resume(jobId);
      upsertJob(job);
      return job;
    },
    [upsertJob]
  );

  const resumeInterrupted = useCallback(async () => {
    const result = await transcriptionJobsApi.resumeInterrupted();
    await refreshJobs();
    return result;
  }, [refreshJobs]);

  const copyTranscript = useCallback(async (jobId) => {
    const job = jobs.find((item) => item.id === jobId);
    if (!job || !job.transcript_text) {
      return false;
    }
    try {
      await navigator.clipboard.writeText(job.transcript_text);
      traceEvent('tx.panel.copy', {
        job_id: job.id,
        note_id: job.note_id,
        length: job.transcript_text.length,
      });
      return true;
    } catch (error) {
      return false;
    }
  }, [jobs]);

  const subscribeToJobEvents = useCallback((listener) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);

  const registerInsertAtCursorHandler = useCallback((handler) => {
    insertHandlerRef.current = handler;
    return () => {
      if (insertHandlerRef.current === handler) {
        insertHandlerRef.current = null;
      }
    };
  }, []);

  const insertJobAtCursor = useCallback(
    async (jobId) => {
      const job = jobs.find((item) => item.id === jobId);
      if (!job || !job.transcript_text || !insertHandlerRef.current) {
        return false;
      }
      const inserted = await insertHandlerRef.current(job.transcript_text, job);
      if (inserted) {
        traceEvent('tx.panel.insert_at_cursor', {
          job_id: job.id,
          note_id: job.note_id,
        });
      }
      return !!inserted;
    },
    [jobs]
  );

  const resolveMarkersInContent = useCallback(
    (noteId, input) => {
      let output = input || '';
      jobs.forEach((job) => {
        if (job.note_id !== noteId) return;
        if (job.status !== 'completed') return;
        if (!job.marker_token || !job.transcript_text) return;
        const result = replaceMarkerInText(output, job.marker_token, job.transcript_text);
        output = result.output;
      });
      return output;
    },
    [jobs]
  );

  const openPanel = useCallback(() => {
    setIsPanelOpen(true);
    traceEvent('tx.panel.open');
  }, []);

  const closePanel = useCallback(() => setIsPanelOpen(false), []);
  const togglePanel = useCallback(() => {
    setIsPanelOpen((prev) => {
      const next = !prev;
      if (next) traceEvent('tx.panel.open');
      return next;
    });
  }, []);

  const value = useMemo(() => ({
    jobs,
    settings,
    isLoading,
    isPanelOpen,
    enqueueAudioJob,
    refreshJobs,
    cancelJob,
    resumeJob,
    resumeInterrupted,
    copyTranscript,
    insertJobAtCursor,
    resolveMarkersInContent,
    subscribeToJobEvents,
    registerInsertAtCursorHandler,
    openPanel,
    closePanel,
    togglePanel,
  }), [
    jobs,
    settings,
    isLoading,
    isPanelOpen,
    enqueueAudioJob,
    refreshJobs,
    cancelJob,
    resumeJob,
    resumeInterrupted,
    copyTranscript,
    insertJobAtCursor,
    resolveMarkersInContent,
    subscribeToJobEvents,
    registerInsertAtCursorHandler,
    openPanel,
    closePanel,
    togglePanel,
  ]);

  return (
    <TranscriptionJobsContext.Provider value={value}>
      {children}
    </TranscriptionJobsContext.Provider>
  );
};
