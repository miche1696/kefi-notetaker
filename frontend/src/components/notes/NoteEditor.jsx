import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNotes } from '../../context/NotesContext';
import { useApp } from '../../context/AppContext';
import { useSelection } from '../../context/SelectionContext';
import { useTranscriptionJobs } from '../../context/TranscriptionJobsContext';
import { useTextOperations } from '../../hooks/useTextOperations';
import NoteToolbar from './NoteToolbar';
import VoiceRecorder from './VoiceRecorder';
import MarkdownEditor from './MarkdownEditor';
import TranscriptionJobsPanel from './TranscriptionJobsPanel';
import { SelectionToolbar } from '../selection';
import { replaceMarkerInText } from '../../utils/transcriptionMarkers';
import { applyCompletedJobToEditor } from '../../utils/transcriptionApplyFlow';
import { traceEvent } from '../../api/trace';
import './NoteEditor.css';

const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'orphaned', 'cancelled']);

const NoteEditor = () => {
  const { currentNote, updateNote, getNoteById } = useNotes();
  const { setError } = useApp();
  const {
    enqueueAudioJob,
    jobs,
    resolveMarkersInContent,
    subscribeToJobEvents,
    registerInsertAtCursorHandler,
  } = useTranscriptionJobs();
  const {
    selectedText,
    selectionStart,
    selectionEnd,
    hasSelection,
    isToolbarVisible,
    toolbarPosition,
    activeOperation,
    operationStatus,
    updateSelection,
    clearSelection,
    hideToolbar,
  } = useSelection();

  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [editorMode, setEditorMode] = useState('render');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const textareaRef = useRef(null);
  const markdownEditorRef = useRef(null);
  const markdownDropZoneRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const lastMousePositionRef = useRef({ x: 0, y: 0 });
  const isInitializingRef = useRef(false);
  const currentNotePathRef = useRef(null);
  const currentRevisionRef = useRef(1);

  const isMarkdown = currentNote?.file_type === 'md';

  const isTranscribing = useMemo(
    () =>
      jobs.some(
        (job) =>
          job.note_id === currentNote?.id &&
          !TERMINAL_JOB_STATUSES.has(job.status)
      ),
    [jobs, currentNote?.id]
  );

  const saveNote = useCallback(
    async (contentToSave, options = {}) => {
      if (!currentNote) return null;

      const { suppressError = false } = options;
      try {
        setIsSaving(true);
        const expectedRevision = currentRevisionRef.current || currentNote.revision || 1;
        const saved = await updateNote(currentNote.path, contentToSave, expectedRevision);
        currentRevisionRef.current = saved?.revision || expectedRevision;
        return saved;
      } catch (error) {
        const status = error?.response?.status;
        if (status === 409 && currentNote?.id) {
          try {
            const latest = await getNoteById(currentNote.id);
            currentRevisionRef.current = latest?.revision || currentRevisionRef.current;
            const mergedContent = resolveMarkersInContent(currentNote.id, contentToSave);
            const hasUnresolvedMarker = /\[\[tx:[^\]]+\]\]/.test(mergedContent);

            if (mergedContent !== latest.content && !hasUnresolvedMarker) {
              const retried = await updateNote(latest.path, mergedContent, latest.revision);
              currentRevisionRef.current = retried?.revision || currentRevisionRef.current;
              if (currentNotePathRef.current === latest.path) {
                setContent(mergedContent);
              }
              return retried;
            }
            if (currentNotePathRef.current === latest.path) {
              setContent(latest.content || '');
            }
            return latest;
          } catch (retryError) {
            if (!suppressError) {
              setError('Failed to save note: ' + retryError.message);
            }
            throw retryError;
          }
        }

        if (!suppressError) {
          setError('Failed to save note: ' + error.message);
        }
        throw error;
      } finally {
        setIsSaving(false);
      }
    },
    [currentNote, getNoteById, resolveMarkersInContent, setError, updateNote]
  );

  const triggerSave = useCallback(
    (newContent) => {
      if (!currentNote) return;
      saveNote(newContent).catch(() => {
        // saveNote already handled error reporting.
      });
    },
    [currentNote, saveNote]
  );

  const getActiveTextareaRef = useCallback(() => {
    if (isMarkdown) {
      if (editorMode === 'source' && markdownEditorRef.current) {
        return markdownEditorRef.current.getTextareaRef();
      }
      return null;
    }
    return textareaRef;
  }, [editorMode, isMarkdown]);

  const replaceSelectionInRender = useCallback(
    async (replacement) => {
      if (!isMarkdown || editorMode !== 'render' || !markdownEditorRef.current) {
        return;
      }
      markdownEditorRef.current.restoreRenderSelection?.();
      markdownEditorRef.current.insertText(replacement, { preserveSelection: true });
    },
    [isMarkdown, editorMode]
  );

  const { executeOperation, getAvailableOperations } = useTextOperations(
    content,
    setContent,
    getActiveTextareaRef(),
    triggerSave,
    isMarkdown && editorMode === 'render' ? replaceSelectionInRender : null
  );

  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    const noteChanged = currentNote?.path !== currentNotePathRef.current;
    if (noteChanged) {
      isInitializingRef.current = true;
      currentNotePathRef.current = currentNote?.path || null;
      setTimeout(() => {
        isInitializingRef.current = false;
      }, 100);
    }

    if (currentNote) {
      setContent(currentNote.content || '');
      currentRevisionRef.current = currentNote.revision || 1;
    } else {
      setContent('');
      currentRevisionRef.current = 1;
    }
    clearSelection();
  }, [currentNote, clearSelection]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    clearSelection();
  }, [editorMode, clearSelection]);

  const handleContentChange = (e) => {
    const newContent = e.target.value;
    setContent(newContent);
    setCursorPosition(e.target.selectionStart);

    if (hasSelection) {
      clearSelection();
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    const notePathAtChange = currentNote?.path;

    saveTimeoutRef.current = setTimeout(() => {
      if (currentNote && currentNote.path === notePathAtChange) {
        saveNote(newContent, { suppressError: true }).catch(() => {
          // saveNote already handled error reporting.
        });
      }
    }, 500);
  };

  const handleMarkdownChange = useCallback(
    (newContent) => {
      if (isInitializingRef.current) {
        return;
      }

      setContent(newContent);

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      const notePathAtChange = currentNote?.path;
      saveTimeoutRef.current = setTimeout(() => {
        if (isInitializingRef.current) {
          return;
        }
        if (currentNotePathRef.current === notePathAtChange) {
          saveNote(newContent, { suppressError: true }).catch(() => {
            // saveNote already handled error reporting.
          });
        }
      }, 500);
    },
    [currentNote, saveNote]
  );

  const getCaretCoordinates = useCallback(
    (textarea, position) => {
      const mirror = document.createElement('div');
      const style = window.getComputedStyle(textarea);

      const styleProps = [
        'font',
        'fontSize',
        'fontFamily',
        'fontWeight',
        'fontStyle',
        'lineHeight',
        'paddingTop',
        'paddingLeft',
        'paddingRight',
        'paddingBottom',
        'borderLeftWidth',
        'borderTopWidth',
        'borderRightWidth',
        'borderBottomWidth',
        'boxSizing',
        'width',
        'wordWrap',
        'whiteSpace',
        'letterSpacing',
        'textIndent',
        'textTransform',
        'wordSpacing',
        'textAlign',
      ];

      styleProps.forEach((prop) => {
        mirror.style[prop] = style[prop];
      });

      mirror.style.position = 'absolute';
      mirror.style.visibility = 'hidden';
      mirror.style.whiteSpace = 'pre-wrap';
      mirror.style.wordWrap = 'break-word';
      mirror.style.overflow = 'hidden';
      mirror.style.height = 'auto';
      mirror.style.top = '0';
      mirror.style.left = '0';

      const textareaRect = textarea.getBoundingClientRect();
      const scrollTop = textarea.scrollTop;
      const scrollLeft = textarea.scrollLeft;

      const paddingLeft = parseFloat(style.paddingLeft) || 0;
      const paddingRight = parseFloat(style.paddingRight) || 0;
      mirror.style.width = `${textareaRect.width - paddingLeft - paddingRight}px`;

      const textBeforeCaret = content.substring(0, position);
      mirror.textContent = textBeforeCaret;

      const marker = document.createElement('span');
      marker.textContent = '|';
      mirror.appendChild(marker);

      document.body.appendChild(mirror);

      const markerRect = marker.getBoundingClientRect();
      const mirrorRect = mirror.getBoundingClientRect();

      const x = textareaRect.left + paddingLeft + (markerRect.left - mirrorRect.left) - scrollLeft;
      const y = textareaRect.top + (markerRect.top - mirrorRect.top) - scrollTop;

      document.body.removeChild(mirror);
      return { x, y };
    },
    [content]
  );

  const handleSelectionChange = useCallback(
    (position) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const { selectionStart: start, selectionEnd: end, selectionDirection } = textarea;
      if (start !== end) {
        const selected = content.substring(start, end);

        let toolbarPos;
        if (position) {
          toolbarPos = position;
        } else {
          const focusPosition = selectionDirection === 'backward' ? start : end;
          toolbarPos = getCaretCoordinates(textarea, focusPosition);
        }

        updateSelection(start, end, selected, toolbarPos);
      } else {
        clearSelection();
      }
    },
    [content, updateSelection, clearSelection, getCaretCoordinates]
  );

  const handleMarkdownSourceSelection = useCallback(
    (e, textarea) => {
      if (!textarea) return;
      const { selectionStart: start, selectionEnd: end, selectionDirection } = textarea;
      if (start !== end) {
        const selected = content.substring(start, end);

        let toolbarPos;
        if (e.type === 'mouseup') {
          toolbarPos = { x: e.clientX, y: e.clientY - 15 };
        } else {
          const focusPosition = selectionDirection === 'backward' ? start : end;
          toolbarPos = getCaretCoordinates(textarea, focusPosition);
        }

        updateSelection(start, end, selected, toolbarPos);
      } else {
        clearSelection();
      }
    },
    [content, updateSelection, clearSelection, getCaretCoordinates]
  );

  const handleMarkdownRenderSelection = useCallback(
    (info) => {
      if (!info || !info.text) {
        clearSelection();
        return;
      }
      const position = info.position || lastMousePositionRef.current;
      updateSelection(0, info.text.length, info.text, position);
    },
    [updateSelection, clearSelection]
  );

  const handleMouseMove = useCallback((e) => {
    lastMousePositionRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseUp = useCallback(
    (e) => {
      lastMousePositionRef.current = { x: e.clientX, y: e.clientY };
      setTimeout(() => {
        handleSelectionChange({ x: e.clientX, y: e.clientY - 15 });
      }, 10);
    },
    [handleSelectionChange]
  );

  const handleKeyUp = useCallback(
    (e) => {
      if (e.shiftKey || e.key === 'Shift') {
        handleSelectionChange(null);
      }
    },
    [handleSelectionChange]
  );

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (currentNote) {
        saveNote(content).catch(() => {
          // saveNote already handled error reporting.
        });
      }
    }
  };

  const handleOperationSelect = useCallback(
    async (operationId, options = {}) => {
      try {
        let mergedOptions = options;
        if (operationId === 'modify') {
          const totalLength = content.length;
          let start = selectionStart;
          let end = selectionEnd;

          let canUseContext = true;
          if (isMarkdown && editorMode === 'render') {
            const matchIndex = selectedText ? content.indexOf(selectedText) : -1;
            if (matchIndex !== -1) {
              start = matchIndex;
              end = matchIndex + selectedText.length;
            } else {
              canUseContext = false;
            }
          }

          const beforeStart = Math.max(0, start - 200);
          const afterEnd = Math.min(totalLength, end + 200);
          const before = canUseContext ? content.substring(beforeStart, start) : '';
          const after = canUseContext ? content.substring(end, afterEnd) : '';

          mergedOptions = {
            ...options,
            before,
            after,
          };
        }

        await executeOperation(operationId, mergedOptions);
      } catch (error) {
        setError(`Operation failed: ${error.message}`);
      }
    },
    [
      executeOperation,
      setError,
      content,
      selectionStart,
      selectionEnd,
      selectedText,
      isMarkdown,
      editorMode,
    ]
  );

  const insertTextAtPlainCursor = useCallback(
    async (textToInsert, saveImmediately = true) => {
      const textarea = textareaRef.current;
      if (!textarea) return null;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const textBefore = content.substring(0, start);
      const textAfter = content.substring(end);
      const newContent = textBefore + textToInsert + textAfter;

      setContent(newContent);
      const newCursorPos = start + textToInsert.length;
      setCursorPosition(newCursorPos);
      setTimeout(() => {
        textarea.selectionStart = newCursorPos;
        textarea.selectionEnd = newCursorPos;
        textarea.focus();
      }, 0);

      if (saveImmediately && currentNote) {
        await saveNote(newContent);
      }
      return newContent;
    },
    [content, currentNote, saveNote]
  );

  const insertTextAtCurrentCursor = useCallback(
    async (textToInsert, saveImmediately = true) => {
      if (isMarkdown && markdownEditorRef.current) {
        markdownEditorRef.current.insertText(textToInsert);
        await new Promise((resolve) => setTimeout(resolve, 120));
        const latestContent = markdownEditorRef.current?.getContent?.() ?? `${content}${textToInsert}`;
        setContent(latestContent);
        if (saveImmediately && currentNote) {
          await saveNote(latestContent);
        }
        return latestContent;
      }
      return insertTextAtPlainCursor(textToInsert, saveImmediately);
    },
    [content, currentNote, insertTextAtPlainCursor, isMarkdown, saveNote]
  );

  const replaceMarkerInCurrentNote = useCallback(
    async (markerToken, replacementText, options = {}) => {
      const { persist = true } = options;
      if (!markerToken) return false;
      let changed = false;
      let nextContent = '';
      let matchedMarker = null;
      setContent((previous) => {
        const result = replaceMarkerInText(previous, markerToken, replacementText);
        changed = result.replaced;
        matchedMarker = result.matchedMarker;
        nextContent = result.output;
        return result.output;
      });

      if (!changed) {
        return false;
      }

      if (isMarkdown && markdownEditorRef.current && matchedMarker) {
        markdownEditorRef.current.replaceText(matchedMarker, replacementText);
      }
      if (persist && currentNote && currentNotePathRef.current === currentNote.path) {
        await saveNote(nextContent, { suppressError: true });
      }
      return true;
    },
    [currentNote, isMarkdown, saveNote]
  );

  const generateMarkerToken = useCallback(() => {
    const uuid =
      (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    return `[[tx:${uuid}:Transcription ongoing...]]`;
  }, []);

  const createLaunchAnchor = useCallback(async () => {
    if (!currentNote?.id) {
      throw new Error('No active note selected');
    }
    const markerToken = generateMarkerToken();
    await insertTextAtCurrentCursor(markerToken, true);
    return {
      noteId: currentNote.id,
      markerToken,
    };
  }, [currentNote, generateMarkerToken, insertTextAtCurrentCursor]);

  const queueAudioForTranscription = useCallback(
    async (audioFile, launchSource, launchContext = null) => {
      const context = launchContext || (await createLaunchAnchor());
      try {
        return await enqueueAudioJob({
          audioFile,
          noteId: context.noteId,
          markerToken: context.markerToken,
          launchSource,
        });
      } catch (error) {
        await replaceMarkerInCurrentNote(
          context.markerToken,
          '[Error queuing transcription]'
        );
        setError('Transcription queue failed: ' + error.message);
        throw error;
      }
    },
    [createLaunchAnchor, enqueueAudioJob, replaceMarkerInCurrentNote, setError]
  );

  useEffect(() => {
    const unsubscribe = subscribeToJobEvents((payload) => {
      applyCompletedJobToEditor({
        payload,
        currentNoteId: currentNote?.id,
        replaceMarkerInCurrentNote,
        getNoteById,
        isMarkdown,
        markdownEditor: markdownEditorRef.current,
        traceEvent,
        setError,
      });
    });
    return unsubscribe;
  }, [currentNote?.id, getNoteById, isMarkdown, replaceMarkerInCurrentNote, setError, subscribeToJobEvents]);

  useEffect(() => {
    const unregister = registerInsertAtCursorHandler(async (text) => {
      if (!currentNote) return false;
      try {
        await insertTextAtCurrentCursor(text, true);
        return true;
      } catch (error) {
        setError('Failed to insert transcript: ' + error.message);
        return false;
      }
    });
    return unregister;
  }, [currentNote, insertTextAtCurrentCursor, registerInsertAtCursorHandler, setError]);

  const handleRecordingStart = useCallback(async () => {
    return createLaunchAnchor();
  }, [createLaunchAnchor]);

  const handleRecordingReady = useCallback(
    async (audioFile, launchContext) => {
      await queueAudioForTranscription(audioFile, 'recording', launchContext);
    },
    [queueAudioForTranscription]
  );

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    if (!isMarkdown) {
      const textarea = textareaRef.current;
      if (textarea) {
        const savedCursorPosition = textarea.selectionStart || cursorPosition;
        textarea.focus();
        textarea.selectionStart = savedCursorPosition;
        textarea.selectionEnd = savedCursorPosition;
      }
    }

    for (const file of files) {
      try {
        if (file.name.endsWith('.txt')) {
          const textContent = await file.text();
          await insertTextAtCurrentCursor(textContent, true);
        } else if (file.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|opus|flac|webm)$/i.test(file.name)) {
          await queueAudioForTranscription(file, 'drop');
        } else {
          setError(`Unsupported file type: ${file.name}`);
        }
      } catch (error) {
        setError(`Failed to process file ${file.name}: ${error.message}`);
      }
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (isMarkdown && !isDraggingOver) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      setIsDraggingOver(false);
    }
  };

  if (!currentNote) {
    return (
      <div className="note-editor">
        <div className="editor-placeholder">
          <p>Select a note from the sidebar or create a new one</p>
        </div>
      </div>
    );
  }

  const availableOperations = hasSelection ? getAvailableOperations() : [];

  return (
    <div className="note-editor">
      <NoteToolbar
        note={currentNote}
        isSaving={isSaving}
        isTranscribing={isTranscribing}
        isMarkdown={isMarkdown}
        editorMode={editorMode}
        onEditorModeChange={setEditorMode}
      />
      <div
        className="editor-content-container"
        onDragOver={isMarkdown ? handleDragOver : undefined}
        onDragLeave={isMarkdown ? handleDragLeave : undefined}
      >
        {isMarkdown ? (
          <div ref={markdownDropZoneRef} className="markdown-drop-zone">
            <MarkdownEditor
              key={currentNote?.path}
              ref={markdownEditorRef}
              initialContent={currentNote?.content || ''}
              content={content}
              onChange={handleMarkdownChange}
              mode={editorMode}
              onSourceSelection={handleMarkdownSourceSelection}
              onRenderSelection={handleMarkdownRenderSelection}
            />
            {isDraggingOver && (
              <div
                className="markdown-drop-overlay"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                <div className="drop-overlay-content">
                  <span>Drop audio file to transcribe</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            className="editor-textarea"
            value={content}
            onChange={handleContentChange}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            placeholder="Start typing or drop a file here..."
            spellCheck="true"
          />
        )}

        {hasSelection && isToolbarVisible && availableOperations.length > 0 && (
          <SelectionToolbar
            position={toolbarPosition}
            operations={availableOperations}
            onOperationSelect={handleOperationSelect}
            isProcessing={operationStatus === 'pending'}
            activeOperation={activeOperation}
            onDismiss={hideToolbar}
          />
        )}

        <TranscriptionJobsPanel />
        <VoiceRecorder
          onRecordingStart={handleRecordingStart}
          onRecordingReady={handleRecordingReady}
          onError={setError}
          disabled={!currentNote}
        />
      </div>
    </div>
  );
};

export default NoteEditor;
